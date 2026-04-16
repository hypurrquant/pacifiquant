'use client';

/**
 * useRealtimeData — WebSocket 기반 실시간 데이터 hooks
 *
 * 공통 채널(orderbook, trades, candles, allMids)은 usePerpAdapter()를 통해
 * 선택된 DEX의 WebSocket으로 라우팅된다.
 *
 * HL 전용 채널(allDexsClearinghouseState, openOrdersLive, userFillsLive 등)은
 * dexId === 'hyperliquid'일 때만 활성화되며, HyperliquidPerpAdapter의
 * static parse 메서드를 사용한다.
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePerpAdapter, useDexId } from './usePerpAdapter';
import { useHyperliquidAdapter } from './useHyperliquid';
import { HyperliquidPerpAdapter } from '@hq/core/defi/perp';
import type { PerpDexId } from '../types/perp.types';

/** Named predicate for the 11 HL-exclusive WS hooks below — every such hook
 *  must bail out on non-HL DEXs. Centralising the string compare here means
 *  adding a 5th DEX touches one line instead of eleven. */
const hasHlOnlyWsChannels = (dexId: PerpDexId): boolean => dexId === 'hyperliquid';
import type {
  WsMessage,
  Trade,
  PerpMarket,
  PerpAccountState,
  PerpActiveAssetData,
  PerpPosition,
  PerpOrder,
  Candle,
  CandleInterval,
  Fill,
  SpotBalance,
  FundingHistoryEntry,
} from '@hq/core/defi/perp';

// ============================================================
// Common hooks — work for all adapters (HL, Pacifica, Lighter)
// ============================================================

/** Orderbook 실시간 구독 */
export function useRealtimeOrderbook(symbol: string) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!symbol) return;
    return adapter.subscribe(
      { type: 'orderbook', symbol },
      (msg: WsMessage) => {
        if (msg.channel !== 'orderbook') return;
        queryClient.setQueryData(['perp', dexId, 'orderbook', symbol, 'default'], msg.data);
      },
    );
  }, [symbol, adapter, dexId, queryClient]);
}

/** Recent trades 실시간 구독 */
export function useRealtimeTrades(symbol: string) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!symbol) return;
    return adapter.subscribe(
      { type: 'trades', symbol },
      (msg: WsMessage) => {
        if (msg.channel !== 'trades') return;
        queryClient.setQueryData(
          ['perp', dexId, 'trades', symbol],
          (prev: Trade[] | undefined) => [...(msg.data as Trade[]), ...(prev ?? [])].slice(0, 100),
        );
      },
    );
  }, [symbol, adapter, dexId, queryClient]);
}

/**
 * allMids 실시간 구독 — 모든 심볼의 mid 가격 push.
 * rAF throttled: 수 Hz로 들어오는 메시지를 버퍼링해서 다음 rAF에 한 번만 머지.
 */
export function useRealtimeAllMids() {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const queryClient = useQueryClient();

  useEffect(() => {
    const buffer = new Map<string, number>();
    let rafId: number | null = null;

    const flush = () => {
      rafId = null;
      if (buffer.size === 0) return;
      const snapshot = new Map(buffer);
      buffer.clear();
      queryClient.setQueryData<PerpMarket[]>(['perp', dexId, 'markets'], (prev) => {
        if (!prev) return prev;
        let mutated = false;
        const next = prev.map((m) => {
          const mid = snapshot.get(m.symbol);
          if (mid === undefined || !isFinite(mid)) return m;
          mutated = true;
          return { ...m, markPrice: mid };
        });
        return mutated ? next : prev;
      });
    };

    const unsub = adapter.subscribe(
      { type: 'allMids', dex: 'ALL_DEXS' },
      (msg: WsMessage) => {
        if (msg.channel !== 'allMids') return;
        for (const [coin, mid] of Object.entries(msg.data.mids)) buffer.set(coin, mid);
        if (rafId === null && typeof requestAnimationFrame !== 'undefined') {
          rafId = requestAnimationFrame(flush);
        }
      },
    );

    return () => {
      if (rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(rafId);
      }
      unsub();
    };
  }, [adapter, dexId, queryClient]);
}

/**
 * Candle 실시간 구독 — forming bar 교체 + 새 bar append.
 * WS 재연결 시 REST snapshot으로 backfill.
 */
export function useRealtimeCandles(symbol: string, interval: CandleInterval) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!symbol) return;

    const unsubSub = adapter.subscribe(
      { type: 'candles', symbol, interval },
      (msg: WsMessage) => {
        if (msg.channel !== 'candles') return;
        const c = (msg.data as Candle[])[0];
        if (!c) return;
        queryClient.setQueryData<Candle[]>(['perp', dexId, 'candles', symbol, interval], (prev) => {
          if (!prev || prev.length === 0) return [c];
          const last = prev[prev.length - 1];
          if (c.timestamp === last.timestamp) return [...prev.slice(0, -1), c];
          if (c.timestamp > last.timestamp) return [...prev, c];
          return prev;
        });
      },
    );

    // onReconnect is HL-specific but we try it anyway — other adapters
    // simply don't expose it (subscribe handles reconnection internally).
    const hlAdapter = adapter as HyperliquidPerpAdapter;
    const unsubReconnect = typeof hlAdapter.onReconnect === 'function'
      ? hlAdapter.onReconnect(() => {
          queryClient.invalidateQueries({ queryKey: ['perp', dexId, 'candles', symbol, interval] });
        })
      : () => {};

    return () => {
      unsubSub();
      unsubReconnect();
    };
  }, [symbol, interval, adapter, dexId, queryClient]);
}

// ============================================================
// HL-specific hooks — only active when dexId === 'hyperliquid'
// ============================================================

/**
 * activeAssetCtx 실시간 구독 — 현재 심볼의 상세 컨텍스트
 * (funding rate, openInterest, mark, oracle) push.
 */
export function useRealtimeActiveAssetCtx(symbol: string) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!symbol || !hasHlOnlyWsChannels(dexId)) return;
    return adapter.subscribe(
      { type: 'activeAssetCtx', symbol },
      (msg: WsMessage) => {
        if (msg.channel !== 'activeAssetCtx') return;
        const { coin, ctx } = msg.data;
        queryClient.setQueryData<PerpMarket[]>(['perp', dexId, 'markets'], (prev) => {
          if (!prev) return prev;
          return prev.map((m) => {
            if (m.symbol !== coin) return m;
            return {
              ...m,
              markPrice: parseFloat(ctx.markPx),
              indexPrice: parseFloat(ctx.oraclePx),
              fundingRate: parseFloat(ctx.funding),
              openInterest: parseFloat(ctx.openInterest),
              volume24h: parseFloat(ctx.dayNtlVlm),
              prevDayPx: parseFloat(ctx.prevDayPx),
            };
          });
        });
      },
    );
  }, [symbol, dexId, adapter, queryClient]);
}

/**
 * activeAssetData 실시간 구독 — per-user per-coin available-to-trade.
 */
export function useRealtimeActiveAssetData(address: string | null, symbol: string) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!address || !symbol || !hasHlOnlyWsChannels(dexId)) return;
    return adapter.subscribe(
      { type: 'activeAssetData', address, symbol },
      (msg: WsMessage) => {
        if (msg.channel !== 'activeAssetData') return;
        const raw = msg.data as Parameters<typeof HyperliquidPerpAdapter.parseActiveAssetData>[0];
        if (!raw || raw.coin !== symbol) return;
        const parsed: PerpActiveAssetData = HyperliquidPerpAdapter.parseActiveAssetData(raw);
        queryClient.setQueryData(['perp', dexId, 'activeAssetData', address, symbol], parsed);
      },
    );
  }, [address, symbol, dexId, adapter, queryClient]);
}

/**
 * allDexsAssetCtxs 실시간 구독 — 모든 perp dex의 asset ctx push.
 */
export function useRealtimeAllDexsAssetCtxs() {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!hasHlOnlyWsChannels(dexId)) return;
    return adapter.subscribe(
      { type: 'allDexsAssetCtxs' },
      (msg: WsMessage) => {
        if (msg.channel !== 'allDexsAssetCtxs') return;
        const ctxsByDex = new Map<string | null, readonly {
          funding: string;
          openInterest: string;
          oraclePx: string;
          markPx: string;
          dayNtlVlm: string;
          prevDayPx: string;
        }[]>();
        for (const [groupName, ctxList] of msg.data.ctxs) {
          ctxsByDex.set(groupName === '' ? null : groupName, ctxList);
        }

        queryClient.setQueryData<PerpMarket[]>(['perp', dexId, 'markets'], (prev) => {
          if (!prev) return prev;
          const idxByDex = new Map<string | null, number>();
          let mutated = false;
          const next = prev.map((m) => {
            if (m.category === 'spot') return m;
            const dexKey = m.dex ?? null;
            const list = ctxsByDex.get(dexKey);
            if (!list) return m;
            const i = idxByDex.get(dexKey) ?? 0;
            idxByDex.set(dexKey, i + 1);
            const ctx = list[i];
            if (!ctx) return m;
            mutated = true;
            return {
              ...m,
              markPrice: parseFloat(ctx.markPx),
              indexPrice: parseFloat(ctx.oraclePx),
              fundingRate: parseFloat(ctx.funding),
              openInterest: parseFloat(ctx.openInterest),
              volume24h: parseFloat(ctx.dayNtlVlm),
              prevDayPx: parseFloat(ctx.prevDayPx),
            };
          });
          return mutated ? next : prev;
        });
      },
    );
  }, [dexId, adapter, queryClient]);
}

/**
 * spotAssetCtxs 실시간 구독 — 스팟 마켓 context push.
 */
export function useRealtimeSpotAssetCtxs() {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!hasHlOnlyWsChannels(dexId)) return;
    return adapter.subscribe(
      { type: 'spotAssetCtxs' },
      (msg: WsMessage) => {
        if (msg.channel !== 'spotAssetCtxs') return;
        const bySymbol = new Map<string, { markPx: string; midPx: string; dayNtlVlm: string; prevDayPx: string }>();
        for (const ctx of msg.data) {
          bySymbol.set(ctx.coin, {
            markPx: ctx.markPx,
            midPx: ctx.midPx,
            dayNtlVlm: ctx.dayNtlVlm,
            prevDayPx: ctx.prevDayPx,
          });
        }

        queryClient.setQueryData<PerpMarket[]>(['perp', dexId, 'markets'], (prev) => {
          if (!prev) return prev;
          let mutated = false;
          const next = prev.map((m) => {
            if (m.category !== 'spot') return m;
            const ctx = bySymbol.get(m.symbol);
            if (!ctx) return m;
            mutated = true;
            return {
              ...m,
              markPrice: parseFloat(ctx.markPx),
              indexPrice: parseFloat(ctx.markPx),
              volume24h: parseFloat(ctx.dayNtlVlm),
              prevDayPx: parseFloat(ctx.prevDayPx),
            };
          });
          return mutated ? next : prev;
        });
      },
    );
  }, [dexId, adapter, queryClient]);
}

/**
 * allDexsClearinghouseState 실시간 구독 — HL 전용.
 * account + positions 쿼리 캐시를 WS push로 갱신.
 */
export function useRealtimeClearinghouseState(address: string | null) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!address || !hasHlOnlyWsChannels(dexId)) return;
    return adapter.subscribe(
      { type: 'allDexsClearinghouseState', address },
      (msg: WsMessage) => {
        if (msg.channel !== 'allDexsClearinghouseState') return;
        const list = msg.data?.clearinghouseStates;
        if (!Array.isArray(list)) return;
        const regular = list.find(([name]) => name === '');
        if (!regular) return;
        const rawState = regular[1] as Parameters<typeof HyperliquidPerpAdapter.parseAccountState>[1] | undefined;
        if (!rawState || typeof rawState !== 'object' || !('marginSummary' in rawState)) return;
        const account: PerpAccountState = HyperliquidPerpAdapter.parseAccountState(address, rawState);
        queryClient.setQueryData(['perp', dexId, 'account', address], account);
        const positions: PerpPosition[] = HyperliquidPerpAdapter.parsePositions(rawState);
        queryClient.setQueryData(['perp', dexId, 'positions', address], positions);
      },
    );
  }, [address, dexId, adapter, queryClient]);
}

/**
 * openOrders (WS) 실시간 구독 — HL 전용.
 */
export function useRealtimeOpenOrdersLive(address: string | null) {
  const hlAdapter = useHyperliquidAdapter();
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!address || !hasHlOnlyWsChannels(dexId)) return;
    return adapter.subscribe(
      { type: 'openOrdersLive', address, dex: 'ALL_DEXS' },
      (msg: WsMessage) => {
        if (msg.channel !== 'openOrdersLive') return;
        const rawPayload = msg.data as unknown;
        let ordersRaw: unknown = rawPayload;
        if (rawPayload && typeof rawPayload === 'object' && 'openOrders' in rawPayload) {
          ordersRaw = (rawPayload as { openOrders: unknown }).openOrders;
        }
        if (!Array.isArray(ordersRaw)) return;
        const parsed: PerpOrder[] = hlAdapter.parseOpenOrders(
          ordersRaw as Parameters<HyperliquidPerpAdapter['parseOpenOrders']>[0],
        );
        queryClient.setQueryData(['perp', dexId, 'openOrders', address], parsed);
      },
    );
  }, [address, dexId, adapter, hlAdapter, queryClient]);
}

/**
 * userFills (WS, aggregateByTime) 실시간 구독 — HL 전용.
 */
export function useRealtimeUserFillsLive(address: string | null) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!address || !hasHlOnlyWsChannels(dexId)) return;
    return adapter.subscribe(
      { type: 'userFillsLive', address, aggregateByTime: true },
      (msg: WsMessage) => {
        if (msg.channel !== 'userFillsLive') return;
        const { isSnapshot, fills } = msg.data;
        if (isSnapshot) {
          queryClient.setQueryData(['perp', dexId, 'fills', address], fills);
          return;
        }
        queryClient.setQueryData<Fill[]>(['perp', dexId, 'fills', address], (prev) => {
          if (!prev) return fills;
          const seen = new Set(prev.map(f => f.id));
          const fresh = fills.filter(f => !seen.has(f.id));
          if (fresh.length === 0) return prev;
          return [...fresh, ...prev].slice(0, 100);
        });
      },
    );
  }, [address, dexId, adapter, queryClient]);
}

/**
 * spotState 실시간 구독 — HL 전용.
 */
export function useRealtimeSpotState(address: string | null) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!address || !hasHlOnlyWsChannels(dexId)) return;
    const unsubSub = adapter.subscribe(
      { type: 'spotState', address },
      (msg: WsMessage) => {
        if (msg.channel !== 'spotState') return;
        const incoming: SpotBalance[] = msg.data.balances;
        if (!Array.isArray(incoming)) return;
        queryClient.setQueryData<SpotBalance[]>(
          ['perp', dexId, 'spotBalances', address],
          (prev) => {
            if (!prev) return incoming;
            const prevByToken = new Map(prev.map(b => [b.token, b]));
            return incoming.map(b => {
              const cached = prevByToken.get(b.token);
              if (!cached) return b;
              const incomingHold = parseFloat(b.hold);
              const cachedHold = parseFloat(cached.hold);
              if (incomingHold === 0 && cachedHold > 0) {
                return { ...b, hold: cached.hold };
              }
              return b;
            });
          },
        );
      },
    );

    // On WS reconnect, invalidate to force a fresh REST snapshot — otherwise
    // stale balances can linger until the next spotState push arrives (same
    // pattern used by useRealtimeCandles; see also docs/report/common/
    // perp-ws-coverage.md).
    const hlAdapter = adapter as HyperliquidPerpAdapter;
    const unsubReconnect = typeof hlAdapter.onReconnect === 'function'
      ? hlAdapter.onReconnect(() => {
          queryClient.invalidateQueries({ queryKey: ['perp', dexId, 'spotBalances', address] });
        })
      : () => {};

    return () => {
      unsubSub();
      unsubReconnect();
    };
  }, [address, dexId, adapter, queryClient]);
}

/**
 * userHistoricalOrders 실시간 구독 — HL 전용.
 */
export function useRealtimeHistoricalOrdersLive(address: string | null) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!address || !hasHlOnlyWsChannels(dexId)) return;
    return adapter.subscribe(
      { type: 'userHistoricalOrdersLive', address },
      (msg: WsMessage) => {
        if (msg.channel !== 'userHistoricalOrdersLive') return;
        const { isSnapshot, orders } = msg.data;
        if (isSnapshot) {
          queryClient.setQueryData(['perp', dexId, 'orderHistory', address], orders);
          return;
        }
        queryClient.setQueryData<PerpOrder[]>(['perp', dexId, 'orderHistory', address], (prev) => {
          if (!prev) return orders;
          const seen = new Set(prev.map(o => o.orderId));
          const fresh = orders.filter(o => !seen.has(o.orderId));
          if (fresh.length === 0) return prev;
          return [...fresh, ...prev].slice(0, 200);
        });
      },
    );
  }, [address, dexId, adapter, queryClient]);
}

// ============================================================
// Pacifica user-data hooks — only active when dexId === 'pacifica'
// ============================================================

/** Named predicate for the 4 Pacifica-exclusive WS hooks below. */
const hasPacificaOnlyWsChannels = (dexId: PerpDexId): boolean => dexId === 'pacifica';

/**
 * Pacifica account info 실시간 구독.
 * Replaces 5 s REST polling for account state.
 */
export function useRealtimePacificaAccount(address: string | null) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!address || !hasPacificaOnlyWsChannels(dexId)) return;
    return adapter.subscribe(
      { type: 'pacificaAccountInfo', address },
      (msg: WsMessage) => {
        if (msg.channel !== 'pacificaAccountInfo') return;
        queryClient.setQueryData(['perp', dexId, 'account', address], msg.data);
      },
    );
  }, [address, dexId, adapter, queryClient]);
}

/**
 * Pacifica positions 실시간 구독.
 * markPrice is entryPrice as WS placeholder; unrealizedPnl is 0.
 * The REST slow poll fills real values on next refetch.
 */
export function useRealtimePacificaPositions(address: string | null) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!address || !hasPacificaOnlyWsChannels(dexId)) return;
    return adapter.subscribe(
      { type: 'pacificaAccountPositions', address },
      (msg: WsMessage) => {
        if (msg.channel !== 'pacificaAccountPositions') return;
        queryClient.setQueryData(['perp', dexId, 'positions', address], msg.data);
      },
    );
  }, [address, dexId, adapter, queryClient]);
}

/**
 * Pacifica open-orders delta 실시간 구독.
 *
 * Pacifica's `account_order_updates` WS delivers *incremental* order events
 * (new / fill / cancel), not a full snapshot on subscribe. Folding deltas
 * into an adapter-local `Map` clobbered whatever REST had already fetched
 * into `['perp','pacifica','openOrders',address]` on mount — users saw
 * "only the newly-placed order" (or nothing, if no events arrived).
 *
 * Fix: merge each delta INTO the React Query cache (which REST populated on
 * mount) rather than treating the WS stream as the sole source of truth.
 * Terminal statuses (`filled | cancelled | rejected`) remove the entry;
 * anything else is an insert or update.
 */
export function useRealtimePacificaOrders(address: string | null) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!address || !hasPacificaOnlyWsChannels(dexId)) return;

    const terminalStatuses = new Set<string>(['filled', 'cancelled', 'rejected']);

    return adapter.subscribe(
      { type: 'pacificaAccountOrders', address },
      (msg: WsMessage) => {
        if (msg.channel !== 'pacificaAccountOrders') return;
        queryClient.setQueryData<PerpOrder[]>(
          ['perp', dexId, 'openOrders', address],
          (prev) => {
            const map = new Map<string, PerpOrder>((prev ?? []).map(o => [o.orderId, o]));
            for (const order of msg.data as PerpOrder[]) {
              if (terminalStatuses.has(order.status)) {
                map.delete(order.orderId);
              } else {
                map.set(order.orderId, order);
              }
            }
            return Array.from(map.values());
          },
        );
      },
    );
  }, [address, dexId, adapter, queryClient]);
}

/**
 * Pacifica fills 실시간 구독.
 * Prepends new fills to the cache, dedupes by id, caps at 100.
 */
export function useRealtimePacificaFills(address: string | null) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!address || !hasPacificaOnlyWsChannels(dexId)) return;
    return adapter.subscribe(
      { type: 'pacificaAccountFills', address },
      (msg: WsMessage) => {
        if (msg.channel !== 'pacificaAccountFills') return;
        const incoming = msg.data as Fill[];
        queryClient.setQueryData<Fill[]>(['perp', dexId, 'fills', address], (prev) => {
          if (!prev) return incoming.slice(0, 100);
          const seen = new Set(prev.map(f => f.id));
          const fresh = incoming.filter(f => !seen.has(f.id));
          if (fresh.length === 0) return prev;
          return [...fresh, ...prev].slice(0, 100);
        });
      },
    );
  }, [address, dexId, adapter, queryClient]);
}

/**
 * userFundings 실시간 구독 — HL 전용.
 */
export function useRealtimeFundingsLive(address: string | null) {
  const adapter = usePerpAdapter();
  const dexId = useDexId();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!address || !hasHlOnlyWsChannels(dexId)) return;
    return adapter.subscribe(
      { type: 'userFundingsLive', address },
      (msg: WsMessage) => {
        if (msg.channel !== 'userFundingsLive') return;
        const { isSnapshot, fundings } = msg.data;
        if (isSnapshot) {
          queryClient.setQueryData(['perp', dexId, 'fundingHistory', address], fundings);
          return;
        }
        queryClient.setQueryData<FundingHistoryEntry[]>(['perp', dexId, 'fundingHistory', address], (prev) => {
          if (!prev) return fundings;
          const seen = new Set(prev.map(f => `${f.timestamp}:${f.symbol}`));
          const fresh = fundings.filter(f => !seen.has(`${f.timestamp}:${f.symbol}`));
          if (fresh.length === 0) return prev;
          return [...fresh, ...prev];
        });
      },
    );
  }, [address, dexId, adapter, queryClient]);
}
