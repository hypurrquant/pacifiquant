'use client';

/**
 * usePerpData — Adapter-agnostic perp data hooks
 *
 * 모든 hooks가 usePerpAdapter() + useDexId()를 사용하여
 * 선택된 DEX에 맞는 어댑터로 데이터를 가져온다.
 * React Query 키에 dexId를 포함하여 DEX간 데이터 격리.
 *
 * HL 전용 hooks (useActiveAssetData, useSpotBalances)는
 * useHyperliquid.ts에 유지.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePerpAdapter, useDexId } from './usePerpAdapter';
import { userDataRefetchInterval, slowUserDataRefetchInterval, marketDataRefetchInterval } from '../lib/dexCapabilities';
import type { Candle, CandleInterval, PerpMarket, WsMessage } from '@hq/core/defi/perp';

// ── Markets ──
const MARKETS_REFRESH_MS = 5 * 60_000;

export function useMarkets() {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['perp', dexId, 'markets'],
    queryFn: async () => {
      const fresh = await adapter.getMarkets();
      // Preserve live fields that WS hooks have been patching into the
      // cache — otherwise every 5-min meta refetch would flash stale
      // mark prices until the next WS push arrives.
      const prev = queryClient.getQueryData<PerpMarket[]>(['perp', dexId, 'markets']);
      if (!prev) return fresh;
      const prevBySymbol = new Map(prev.map(m => [m.symbol, m]));
      return fresh.map(m => {
        const cached = prevBySymbol.get(m.symbol);
        if (!cached) return m;
        return {
          ...m,
          markPrice: cached.markPrice,
          indexPrice: cached.indexPrice,
          fundingRate: cached.fundingRate,
          openInterest: cached.openInterest,
          volume24h: cached.volume24h,
          prevDayPx: cached.prevDayPx,
        };
      });
    },
    staleTime: MARKETS_REFRESH_MS,
    refetchInterval: MARKETS_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

// ── Orderbook ──

export function useOrderbook(symbol: string, nSigFigs?: number) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const isDefault = nSigFigs === undefined;
  // Custom nSigFigs: 2s poll regardless of DEX (WS channels don't honor the
  // precision param). Default precision: poll only when the DEX lacks a
  // reliable WS orderbook feed (Lighter/Aster); HL + Pacifica stream via WS.
  const refetchMs = isDefault ? marketDataRefetchInterval(dexId) : 2_000;
  return useQuery({
    queryKey: ['perp', dexId, 'orderbook', symbol, nSigFigs ?? 'default'],
    queryFn: () => adapter.getOrderbook(symbol, nSigFigs),
    staleTime: isDefault ? 60_000 : 2_000,
    refetchInterval: refetchMs,
    enabled: !!symbol,
  });
}

// ── Recent Trades ──

export function useRecentTrades(symbol: string) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  return useQuery({
    queryKey: ['perp', dexId, 'trades', symbol],
    queryFn: () => adapter.getTrades(symbol, 50),
    staleTime: 60_000,
    // Poll on DEXs without WS trades (Lighter/Aster). HL + Pacifica stream.
    refetchInterval: marketDataRefetchInterval(dexId),
    enabled: !!symbol,
  });
}

// ── Candles ──

export function useCandles(symbol: string, interval: CandleInterval) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  // Candles mutate both by appending new bars AND updating the current-bar
  // close. WS DEXs stream both; non-WS DEXs need periodic refetches — else
  // the chart freezes on reload. staleTime stays generous because a full
  // REST refetch replaces the cached array.
  const refetchMs = marketDataRefetchInterval(dexId);
  return useQuery({
    queryKey: ['perp', dexId, 'candles', symbol, interval],
    queryFn: () => adapter.getCandles(symbol, interval, 300),
    staleTime: refetchMs === false ? Infinity : 2_000,
    refetchInterval: refetchMs,
    enabled: !!symbol,
  });
}

/**
 * Candles with infinite-scroll support for historical data.
 *
 * The initial page is the last 300 candles. Callers invoke `loadOlder()`
 * when the chart's visible range approaches the left edge; the adapter
 * fetches the next older 300 candles ending at the current oldest
 * timestamp and prepends them. Duplicates at the boundary are stripped.
 *
 * State is reset whenever `symbol` or `interval` changes.
 */
export function useInfiniteCandles(symbol: string, interval: CandleInterval) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const [candles, setCandles] = useState<Candle[]>([]);
  const [isLoadingInitial, setIsLoadingInitial] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const oldestRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);

  // Initial page + reset on symbol/interval change.
  useEffect(() => {
    if (!symbol) return;
    const reqId = ++requestIdRef.current;
    setCandles([]);
    setExhausted(false);
    oldestRef.current = null;
    setIsLoadingInitial(true);
    adapter
      .getCandles(symbol, interval, 300)
      .then(initial => {
        if (reqId !== requestIdRef.current) return; // stale
        setCandles(initial);
        if (initial.length > 0) oldestRef.current = initial[0].timestamp;
        setIsLoadingInitial(false);
      })
      .catch(() => setIsLoadingInitial(false));
  }, [adapter, symbol, interval]);

  // Live updates — merge forming-bar replacements and new bars into the local
  // candle array so the chart updates without the caller calling loadOlder().
  // HL + Pacifica push via WS; Lighter + Aster poll REST on the cadence
  // declared in dexCapabilities. This mirrors `useRealtimeCandles` but
  // targets our local state (the chart reads `candles` directly, not from
  // React Query cache).
  useEffect(() => {
    if (!symbol) return;

    const mergeCandle = (c: Candle) => {
      setCandles((prev) => {
        if (prev.length === 0) return [c];
        const last = prev[prev.length - 1];
        if (c.timestamp === last.timestamp) return [...prev.slice(0, -1), c];
        if (c.timestamp > last.timestamp) return [...prev, c];
        return prev;
      });
    };

    const unsubSub = adapter.subscribe(
      { type: 'candles', symbol, interval },
      (msg: WsMessage) => {
        if (msg.channel !== 'candles') return;
        const c = (msg.data as Candle[])[0];
        if (c) mergeCandle(c);
      },
    );

    const pollMs = marketDataRefetchInterval(dexId);
    let pollId: ReturnType<typeof setInterval> | null = null;
    if (pollMs !== false) {
      pollId = setInterval(async () => {
        try {
          const latest = await adapter.getCandles(symbol, interval, 2);
          for (const c of latest) mergeCandle(c);
        } catch { /* transient fetch errors are non-fatal — next tick retries */ }
      }, pollMs);
    }

    return () => {
      unsubSub();
      if (pollId !== null) clearInterval(pollId);
    };
  }, [adapter, dexId, symbol, interval]);

  const loadOlder = useCallback(async () => {
    if (isLoadingOlder || exhausted || oldestRef.current === null) return;
    setIsLoadingOlder(true);
    try {
      const reqId = requestIdRef.current;
      const olderEnd = oldestRef.current - 1;
      const older = await adapter.getCandles(symbol, interval, 300, olderEnd);
      if (reqId !== requestIdRef.current) return; // stale
      // Keep strictly older (the API may include the boundary candle).
      const olderCutoff = oldestRef.current ?? olderEnd;
      const fresh = older.filter(c => c.timestamp < olderCutoff);
      if (fresh.length === 0) {
        setExhausted(true);
        return;
      }
      oldestRef.current = fresh[0].timestamp;
      setCandles(prev => [...fresh, ...prev]);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [adapter, symbol, interval, isLoadingOlder, exhausted]);

  return { candles, loadOlder, isLoadingOlder, isLoadingInitial, exhausted };
}

// User-data polling is driven by `lib/dexCapabilities.ts`:
// HL publishes WS push → `refetchInterval: false`.
// Pacifica/Lighter/Aster have no user-data WS → poll every 5s.

// ── Account State ──

export function useAccountState(address: string | null) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  return useQuery({
    queryKey: ['perp', dexId, 'account', address],
    queryFn: () => adapter.getAccountState(address!),
    staleTime: 15_000,
    refetchInterval: userDataRefetchInterval(dexId),
    enabled: !!address,
  });
}

// ── Positions ──

export function usePositions(address: string | null) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  return useQuery({
    queryKey: ['perp', dexId, 'positions', address],
    queryFn: () => adapter.getPositions(address!),
    staleTime: 15_000,
    refetchInterval: userDataRefetchInterval(dexId),
    enabled: !!address,
  });
}

// ── Open Orders ──

export function useOpenOrders(address: string | null) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  return useQuery({
    queryKey: ['perp', dexId, 'openOrders', address],
    queryFn: () => adapter.getOpenOrders(address!),
    staleTime: 15_000,
    refetchInterval: userDataRefetchInterval(dexId),
    enabled: !!address,
  });
}

// ── Fills ──
// Slow-poll: fills only append on order match. TradingLayout invalidates
// this cache explicitly after each place/cancel success.

export function useFills(address: string | null) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  return useQuery({
    queryKey: ['perp', dexId, 'fills', address],
    queryFn: () => adapter.getFills(address!, 50),
    staleTime: 30_000,
    refetchInterval: slowUserDataRefetchInterval(dexId),
    enabled: !!address,
  });
}

// ── Order History ──
// Slow-poll: appended only on order termination (filled/canceled/rejected).

export function useOrderHistory(address: string | null) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  return useQuery({
    queryKey: ['perp', dexId, 'orderHistory', address],
    queryFn: () => adapter.getOrderHistory(address!, 200),
    staleTime: 30_000,
    refetchInterval: slowUserDataRefetchInterval(dexId),
    enabled: !!address,
  });
}

// ── Funding History ──
// Slow-poll: funding accrues at hourly/8h cadence depending on venue.

export function useFundingHistory(address: string | null) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  return useQuery({
    queryKey: ['perp', dexId, 'fundingHistory', address],
    queryFn: () => adapter.getFundingHistory(address!),
    staleTime: 60_000,
    refetchInterval: slowUserDataRefetchInterval(dexId),
    enabled: !!address,
  });
}

// ── HIP-3 Deployers ──

export function usePerpDexs() {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  return useQuery({
    queryKey: ['perp', dexId, 'perpDexs'],
    queryFn: () => adapter.getPerpDexs(),
    staleTime: 60_000,
    refetchInterval: false,
  });
}

// ── User Fees ──

export function useUserFees(address: string | null) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  return useQuery({
    queryKey: ['perp', dexId, 'userFees', address],
    queryFn: () => adapter.getUserFees(address!),
    staleTime: 60_000,
    enabled: !!address,
  });
}
