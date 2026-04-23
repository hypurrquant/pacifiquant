'use client';

/**
 * TradingLayout — Hyperliquid 스타일 거래 화면
 *
 * Desktop (lg+):
 * ┌──────────────────────────────────────────────┐
 * │ MarketSelector (full width)                  │
 * ├──────────────┬──────────┬────────────────────┤
 * │  Chart       │ Orderbook│ OrderForm          │
 * │              │          │ AccountInfo        │
 * ├──────────────┴──────────┴────────────────────┤
 * │ PositionTable (full width)                   │
 * └──────────────────────────────────────────────┘
 *
 * Mobile (<lg):
 * ┌──────────────────────┐
 * │ Market + Price       │
 * ├──────────────────────┤
 * │ Chart│OrderBook│Trade│  ← tabs
 * ├──────────────────────┤
 * │ [tab content]        │
 * ├──────────────────────┤
 * │ Positions            │
 * ├──────────────────────┤
 * │ Markets│Trade│Account│  ← bottom nav
 * └──────────────────────┘
 */

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getErrorMessage } from '@hq/core/lib/error';
import { usePerpStore } from '../stores/usePerpStore';
import { usePerpDeps } from '../providers/PerpDepsProvider';
// Per-DEX data hooks live in usePerpData — each switches adapter via
// `usePerpAdapter()` so Pacifica / Lighter queries hit their own API
// rather than HL. Pull the dex-agnostic pieces from there; HL-only
// specifics (spot balances, per-coin available-to-trade, HL user-fee
// endpoint) stay in useHyperliquid and are gated to dexId === 'hyperliquid'.
import {
  useMarkets,
  useRecentTrades,
  useAccountState,
  usePositions,
  useOpenOrders,
  useFills,
  useOrderHistory,
  useFundingHistory,
  useUserFees,
  useInfiniteCandles,
} from '../hooks/usePerpData';
import {
  useSpotBalances,
  useActiveAssetData,
} from '../hooks/useHyperliquid';
import { useLighterAgentStore } from '../stores/useLighterAgentStore';
import { useAsterAgentStore } from '../stores/useAsterAgentStore';
import { MarketSelector } from './MarketSelector';
import { DexSelector } from './DexSelector';
import { TradingChart } from './TradingChart';
import { OrderbookPanel } from './OrderbookPanel';
import { OrderForm } from './OrderForm';
import type { ScaleState } from './OrderForm';
import { PositionTable } from './PositionTable';
import { RecentTrades } from './RecentTrades';
import { OrderbookTradesPanel } from './OrderbookTradesPanel';
import { AccountInfoPanel } from './AccountInfoPanel';
import { AgentWalletPanel } from './AgentWalletPanel';
import { AgentKeyManager } from './AgentKeyManager';
import { ConfirmModal } from './ConfirmModal';
import { usePerpUiStore } from '../stores/usePerpUiStore';
import { fmtPriceByTick, fmtSizeByLot } from '../utils/displayComputations';
import { getAdapterByDex, usePerpAdapter } from '../hooks/usePerpAdapter';
import type { PacificaPerpAdapter, LighterPerpAdapter, AsterPerpAdapter } from '@hq/core/defi/perp';
import { useAgentWalletStore } from '../stores/useAgentWalletStore';
import { useActiveAccount } from '../hooks/useActiveAccount';
import {
  useRealtimeOrderbook,
  useRealtimeTrades,
  useRealtimeCandles,
  useRealtimeAllMids,
  useRealtimeActiveAssetCtx,
  useRealtimeActiveAssetData,
  useRealtimeAllDexsAssetCtxs,
  useRealtimeSpotAssetCtxs,
  useRealtimeClearinghouseState,
  useRealtimeOpenOrdersLive,
  useRealtimeUserFillsLive,
  useRealtimeSpotState,
  useRealtimeHistoricalOrdersLive,
  useRealtimeFundingsLive,
  useRealtimePacificaAccount,
  useRealtimePacificaPositions,
  useRealtimePacificaOrders,
  useRealtimePacificaFills,
} from '../hooks/useRealtimeData';

type MobileTab = 'chart' | 'orderbook' | 'trades';
type MobileNav = 'markets' | 'trade' | 'account';

const MOBILE_TABS: ReadonlyArray<{ key: MobileTab; label: string }> = [
  { key: 'chart', label: 'Chart' },
  { key: 'orderbook', label: 'Order Book' },
  { key: 'trades', label: 'Trades' },
];

interface Props {
  walletAddress: `0x${string}` | null;
}

export function TradingLayout({ walletAddress }: Props) {
  const store = usePerpStore();
  const deps = usePerpDeps();
  const queryClient = useQueryClient();
  // DEX-aware adapter: submits/cancels go to the currently-selected DEX's
  // adapter instance. Using `useHyperliquidAdapter()` here would (a) route
  // Pacifica/Lighter/Aster orders through the HL adapter's signing stack,
  // and (b) use a different HL instance than `useMarkets()` — so spot/HIP-3
  // symbols would be missing from its assetIndexMap and throw
  // "Unknown symbol". Both problems go away when the same instance is
  // shared between the data layer (usePerpData) and the action layer.
  const adapter = usePerpAdapter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scaleState, setScaleState] = useState<ScaleState>({
    active: false, start: '', end: '', totalOrders: '5', sizeSkew: '1.00',
  });
  const [mobileTab, setMobileTab] = useState<MobileTab>('chart');
  const [mobileNav, setMobileNav] = useState<MobileNav>('trade');
  const [showMobileOrder, setShowMobileOrder] = useState(false);
  const [showAgentSetup, setShowAgentSetup] = useState(false);
  // When true, the setup modal swaps from the 3-DEX AgentKeyManager view
  // to the HL-specific approveAgent flow. Reset on modal close so the
  // next open starts on the overview again.
  const [hlSetupMode, setHlSetupMode] = useState(false);

  // ── Confirmation modal state ─────────────────────────────────────────
  type ConfirmKind = 'close' | 'cancel';
  interface ConfirmPending {
    kind: ConfirmKind;
    symbol: string;
    orderId: string;
    skipChecked: boolean;
  }
  const [confirmPending, setConfirmPending] = useState<ConfirmPending | null>(null);
  const skipClosePositionConfirm = usePerpUiStore((s) => s.skipClosePositionConfirm);
  const skipCancelOrderConfirm = usePerpUiStore((s) => s.skipCancelOrderConfirm);
  const setSkipClosePositionConfirm = usePerpUiStore((s) => s.setSkipClosePositionConfirm);
  const setSkipCancelOrderConfirm = usePerpUiStore((s) => s.setSkipCancelOrderConfirm);

  // ── Per-DEX account identifier ──────────────────────────────────────
  //
  // The "user" axis for perp data queries is DEX-specific:
  //   - Hyperliquid: EVM 0x address. When the agent wallet is approved
  //     and we stored its master address, use that (the agent signs, but
  //     HL indexes positions by the master); otherwise fall back to the
  //     connected wallet. Lowercased to match HL's WebSocket user-channel
  //     keying — if we mix checksummed and lowercased forms between REST
  //     and WS, we get two disjoint caches and the panels look empty.
  //   - Pacifica: base58 Solana pubkey of the main Phantom account that
  //     bound the agent. Held in the Pacifica agent store.
  //   - Lighter: the EVM L1 address tied to the registered API key (or
  //     the connected wallet as a fallback before registration).
  //
  // The generic query/realtime hooks all take `string | null`, so Solana
  // pubkeys flow through without a type change. `useActiveAccount` does
  // the per-DEX address-field dispatch — see its JSDoc.
  const { address: accountAddress, hlOnlyAddress, pacificaOnlyAddress, isHlAgentActive, hlMasterAddress } = useActiveAccount(walletAddress ?? null);
  // Pacifica's agent address (Solana pk) can't collide with an EVM wallet,
  // so only Lighter + Aster need the mismatch guard below.
  const lighterPersisted = useLighterAgentStore((s) => s.persisted);
  const asterPersisted = useAsterAgentStore((s) => s.persisted);
  const isAgentActive = isHlAgentActive; // preserved name for the order-submit guard below

  // ── Agent ↔ connected wallet mismatch guard ─────────────────────────
  //
  // The agent wallet stores (HL/Aster/Lighter) persist `masterAddress` /
  // `user` / `l1Address` in localStorage so trading survives reloads.
  // When the user connects a *different* EVM wallet from the one the
  // agent was approved for, every /info + WS query would otherwise keep
  // hitting the old address — the panels appear empty or show the old
  // account's data. HL's agent is also bound server-side to the master
  // address, so any order we sign for the new wallet would be rejected
  // ("User or API Wallet does not exist"). Detect the mismatch and clear
  // the stored agent so the UI falls back to the connected wallet for
  // queries and prompts the user to re-approve.
  useEffect(() => {
    if (!walletAddress) return;
    const current = walletAddress.toLowerCase();
    if (isHlAgentActive && hlMasterAddress && hlMasterAddress.toLowerCase() !== current) {
      useAgentWalletStore.getState().disconnect();
    }
    if (asterPersisted.type === 'registered' && asterPersisted.user.toLowerCase() !== current) {
      useAsterAgentStore.getState().disconnect();
    }
    if (lighterPersisted.type === 'registered' && lighterPersisted.l1Address.toLowerCase() !== current) {
      useLighterAgentStore.getState().disconnect();
    }
  }, [walletAddress, isHlAgentActive, hlMasterAddress, asterPersisted, lighterPersisted]);

  // Data queries
  const { data: markets = [] } = useMarkets();
  const selectedMarket = markets.find(m => m.symbol === store.selectedSymbol) ?? null;
  const { data: trades = [] } = useRecentTrades(store.selectedSymbol);
  const {
    candles,
    loadOlder: loadOlderCandles,
    isLoadingInitial: candlesLoading,
    isLoadingOlder: isLoadingOlderCandles,
  } = useInfiniteCandles(store.selectedSymbol, store.chartInterval);
  const { data: accountState } = useAccountState(accountAddress);
  const { data: positions = [] } = usePositions(accountAddress);
  const { data: openOrders = [] } = useOpenOrders(accountAddress);
  const { data: fills = [] } = useFills(accountAddress);
  const { data: orderHistory = [] } = useOrderHistory(accountAddress);
  const { data: fundingHistory = [] } = useFundingHistory(accountAddress);
  const { data: userFees = null } = useUserFees(accountAddress);
  // HL-only: spot wallet balances (USDC + spot coins) and per-coin
  // available-to-trade. For Pacifica / Lighter these concepts are either
  // unused or delivered through a different channel, so we gate by dexId.
  const { data: spotBalances = [] } = useSpotBalances(hlOnlyAddress);

  // HL `activeAssetData` only supports PERP coins — calling it with a spot
  // symbol (`PURR/USDC`, `@107`) triggers HL /info 500. The `@` prefix
  // catches non-canonical spot, and `/` catches canonical pairs. HIP-3
  // perps (e.g. `xyz:CL`) still flow through.
  const isSpotSymbol = store.selectedSymbol.startsWith('@') || store.selectedSymbol.includes('/');
  const activeAssetDataAddress = isSpotSymbol ? null : hlOnlyAddress;
  const { data: activeAssetData = null } = useActiveAssetData(activeAssetDataAddress, store.selectedSymbol);

  // WebSocket real-time subscriptions
  useRealtimeOrderbook(store.selectedSymbol);
  useRealtimeTrades(store.selectedSymbol);
  useRealtimeCandles(store.selectedSymbol, store.chartInterval);
  useRealtimeAllMids();
  useRealtimeActiveAssetCtx(store.selectedSymbol);
  useRealtimeActiveAssetData(activeAssetDataAddress, store.selectedSymbol);
  useRealtimeAllDexsAssetCtxs();
  useRealtimeSpotAssetCtxs();
  // HL-only streams — pass null for other DEXs to disable
  useRealtimeClearinghouseState(hlOnlyAddress);
  useRealtimeOpenOrdersLive(hlOnlyAddress);
  useRealtimeUserFillsLive(hlOnlyAddress);
  useRealtimeSpotState(hlOnlyAddress);
  useRealtimeHistoricalOrdersLive(hlOnlyAddress);
  useRealtimeFundingsLive(hlOnlyAddress);
  // Pacifica-only streams — pass null for other DEXs to disable
  useRealtimePacificaAccount(pacificaOnlyAddress);
  useRealtimePacificaPositions(pacificaOnlyAddress);
  useRealtimePacificaOrders(pacificaOnlyAddress);
  useRealtimePacificaFills(pacificaOnlyAddress);

  const handlePriceClick = useCallback((price: number) => {
    store.setOrderPrice(price.toString());
  }, [store]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        if (!Array.isArray(key) || key[0] !== 'perp') return false;
        const resource = key[2];
        return resource === 'positions' || resource === 'openOrders' || resource === 'account' || resource === 'fills';
      },
    });
  }, [queryClient]);

  // Pacifica / Lighter / Aster index a newly-placed order asynchronously —
  // the immediate post-submit refetch often hits before the order shows up
  // in `GET /orders`. Without staggered re-invalidations the user sees
  // empty Open Orders until the next 5 s poll, then blames the UI ("need
  // to refresh to see my order"). A couple of delayed re-fetches close
  // that gap without touching the poll cadence.
  const invalidateWithRetries = useCallback(() => {
    invalidate();
    const t1 = setTimeout(invalidate, 1500);
    const t2 = setTimeout(invalidate, 4000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [invalidate]);

  // ── Place Order ──
  const handleSubmitOrder = useCallback(async () => {
    if ((!walletAddress && !isAgentActive) || isSubmitting) return;

    const { orderForm } = store;
    const size = parseFloat(orderForm.size);

    if (!size || size <= 0) {
      deps.showToast({ title: 'Invalid order size', type: 'warning' });
      return;
    }
    if (selectedMarket && size < selectedMarket.minOrderSize) {
      deps.showToast({ title: `Minimum size: ${selectedMarket.minOrderSize}`, type: 'warning' });
      return;
    }
    if (selectedMarket && orderForm.leverage > selectedMarket.maxLeverage) {
      deps.showToast({ title: `Max leverage: ${selectedMarket.maxLeverage}x`, type: 'warning' });
      return;
    }
    // Clamp size to HL's maxTradeSzs — prevents "Insufficient margin"
    // rejection when the user manually types a size exceeding what
    // their balance can support at the current leverage.
    if (activeAssetData && activeAssetData.symbol === selectedMarket?.symbol) {
      const sideIdx = orderForm.side === 'long' ? 0 : 1;
      const maxSize = activeAssetData.maxTradeSizes[sideIdx];
      if (isFinite(maxSize) && size > maxSize) {
        deps.showToast({
          title: 'Size exceeds maximum',
          message: `Max: ${fmtSizeByLot(maxSize, selectedMarket.lotSize)} ${selectedMarket.baseAsset}`,
          type: 'warning',
        });
        return;
      }
    }
    // Margin pre-check. HL's `activeAssetData.availableToTrade[side]` is
    // the authoritative per-coin, per-direction number — it already
    // folds in unified-account spot collateral, isolated margin held
    // elsewhere, and open-order reservations. Use it directly. Only
    // fall back to `accountState.availableBalance` (perp withdrawable)
    // when activeAssetData hasn't pushed yet, and even then SKIP the
    // check for a unified-suspected case (withdrawable = 0 but account
    // might still have spot collateral) so we don't block HL-valid
    // orders with a stale frontend guard.
    if (activeAssetData && activeAssetData.symbol === selectedMarket?.symbol) {
      const sideIdx = orderForm.side === 'long' ? 0 : 1;
      const available = activeAssetData.availableToTrade[sideIdx] ?? 0;
      const price = parseFloat(orderForm.price) || selectedMarket?.markPrice || 0;
      const marginRequired = (size * price) / orderForm.leverage;
      if (marginRequired > available) {
        deps.showToast({
          title: 'Insufficient available margin',
          message: `Required: $${marginRequired.toFixed(2)} · Available: $${available.toFixed(2)}`,
          type: 'warning',
        });
        return;
      }
    }
    // No activeAssetData yet → defer to HL's server-side margin check.
    // HL will reject with a clear error if under-margined, and the
    // adapter surfaces it via `result.error`.

    setIsSubmitting(true);
    try {
      const signFn = deps.getSignFn();
      const currentVaultAddress = deps.getVaultAddress() ?? undefined;
      const result = await adapter.placeOrder(
        {
          symbol: store.selectedSymbol,
          side: orderForm.side,
          type: orderForm.type,
          size,
          price: orderForm.price ? parseFloat(orderForm.price) : selectedMarket?.markPrice,
          leverage: orderForm.leverage,
          reduceOnly: orderForm.reduceOnly,
          timeInForce: orderForm.timeInForce,
          slippageBps: store.slippageBps,
          triggerPrice: orderForm.triggerPrice ? parseFloat(orderForm.triggerPrice) : undefined,
          tpsl: (orderForm.tpPrice || orderForm.slPrice)
            ? {
                tp: orderForm.tpPrice ? { price: parseFloat(orderForm.tpPrice), trigger: 'mark' as const } : undefined,
                sl: orderForm.slPrice ? { price: parseFloat(orderForm.slPrice), trigger: 'mark' as const } : undefined,
              }
            : undefined,
          vaultAddress: currentVaultAddress,
        },
        signFn,
      );
      if (result.success) {
        deps.showToast({ title: 'Order placed', message: `Order ID: ${result.orderId}`, type: 'success' });
        store.resetOrderForm();
        invalidateWithRetries();
      } else {
        deps.showToast({ title: 'Order failed', message: result.error ?? 'Unknown error', type: 'warning' });
      }
    } catch (err) {
      deps.showToast({ title: 'Order error', message: getErrorMessage(err), type: 'warning' });
    } finally {
      setIsSubmitting(false);
    }
  }, [walletAddress, isAgentActive, isSubmitting, store, adapter, deps, invalidate, selectedMarket]);

  // ── Place Scale Order ──
  const handleSubmitScale = useCallback(async () => {
    if ((!walletAddress && !isAgentActive) || isSubmitting) return;

    const { orderForm } = store;
    const size = parseFloat(orderForm.size);
    const start = parseFloat(scaleState.start);
    const end = parseFloat(scaleState.end);
    const totalOrders = parseInt(scaleState.totalOrders, 10);
    const sizeSkew = parseFloat(scaleState.sizeSkew);

    if (!size || size <= 0) { deps.showToast({ title: 'Invalid order size', type: 'warning' }); return; }
    if (!start || !end) { deps.showToast({ title: 'Invalid start/end price', type: 'warning' }); return; }
    if (totalOrders < 2 || totalOrders > 20) { deps.showToast({ title: 'Total orders must be 2-20', type: 'warning' }); return; }
    if (sizeSkew <= 0) { deps.showToast({ title: 'Size skew must be > 0', type: 'warning' }); return; }

    setIsSubmitting(true);
    try {
      const signFn = deps.getSignFn();
      const currentVaultAddress = deps.getVaultAddress() ?? undefined;
      const result = await adapter.placeScaleOrder({
        symbol: store.selectedSymbol,
        side: orderForm.side,
        startPrice: start,
        endPrice: end,
        totalSize: size,
        totalOrders,
        sizeSkew,
        timeInForce: orderForm.timeInForce,
        reduceOnly: orderForm.reduceOnly,
        vaultAddress: currentVaultAddress,
      }, signFn);

      if (result.success) {
        deps.showToast({ title: `Scale order placed: ${totalOrders} limits`, type: 'success' });
        store.resetOrderForm();
        invalidateWithRetries();
      } else {
        deps.showToast({ title: 'Scale order failed', message: result.error, type: 'warning' });
      }
    } catch (err) {
      deps.showToast({ title: 'Scale order error', message: getErrorMessage(err), type: 'warning' });
    } finally {
      setIsSubmitting(false);
    }
  }, [walletAddress, isAgentActive, isSubmitting, store, scaleState, adapter, deps, invalidate]);

  // ── Close Position (with confirmation) ──
  const executeClosePosition = useCallback(async (symbol: string) => {
    const pos = positions.find(p => p.symbol === symbol);
    if (!pos) return;
    try {
      const signFn = deps.getSignFn();
      const result = await adapter.placeOrder(
        { symbol, side: pos.side === 'long' ? 'short' : 'long', type: 'market', size: pos.size, price: pos.markPrice, leverage: pos.leverage, reduceOnly: true, vaultAddress: deps.getVaultAddress() ?? undefined },
        signFn,
      );
      if (result.success) {
        deps.showToast({ title: 'Position closed', type: 'success' });
        invalidateWithRetries();
      } else {
        deps.showToast({ title: 'Close failed', message: result.error ?? 'Unknown error', type: 'warning' });
      }
    } catch (err) {
      deps.showToast({ title: 'Close error', message: getErrorMessage(err), type: 'warning' });
    }
  }, [positions, adapter, deps, invalidateWithRetries]);

  const handleClosePosition = useCallback((symbol: string) => {
    if (!positions.find(p => p.symbol === symbol) || (!walletAddress && !isAgentActive)) return;
    if (skipClosePositionConfirm) {
      void executeClosePosition(symbol);
      return;
    }
    setConfirmPending({ kind: 'close', symbol, orderId: '', skipChecked: false });
  }, [positions, walletAddress, isAgentActive, skipClosePositionConfirm, executeClosePosition]);

  // ── Cancel Order (with confirmation) ──
  const executeCancelOrder = useCallback(async (orderId: string, symbol: string) => {
    try {
      const signFn = deps.getSignFn();
      const result = await adapter.cancelOrder({ symbol, orderId, vaultAddress: deps.getVaultAddress() ?? undefined }, signFn);
      if (result.success) {
        deps.showToast({ title: 'Order cancelled', type: 'success' });
        invalidateWithRetries();
      } else {
        deps.showToast({ title: 'Cancel failed', message: result.error ?? 'Unknown error', type: 'warning' });
      }
    } catch (err) {
      deps.showToast({ title: 'Cancel error', message: getErrorMessage(err), type: 'warning' });
    }
  }, [adapter, deps, invalidateWithRetries]);

  const handleCancelOrder = useCallback((orderId: string, symbol: string) => {
    if (!walletAddress && !isAgentActive) return;
    if (skipCancelOrderConfirm) {
      void executeCancelOrder(orderId, symbol);
      return;
    }
    setConfirmPending({ kind: 'cancel', symbol, orderId, skipChecked: false });
  }, [walletAddress, isAgentActive, skipCancelOrderConfirm, executeCancelOrder]);

  const priceChange = selectedMarket && selectedMarket.prevDayPx > 0
    ? ((selectedMarket.markPrice - selectedMarket.prevDayPx) / selectedMarket.prevDayPx * 100)
    : 0;

  // ═══════════════════════════════════════
  // DESKTOP LAYOUT
  // ═══════════════════════════════════════
  const desktopLayout = (
    <div
      className="hidden md:grid gap-0.5 h-[calc(100vh-4rem)] [grid-template-columns:1fr_220px_280px] lg:[grid-template-columns:1fr_260px_320px] xl:[grid-template-columns:1fr_300px_360px]"
      style={{ backgroundColor: '#0F1A1E', gridTemplateRows: 'auto 620px 1fr' }}
    >
      {/* Row 1: MarketSelector + DEX Selector */}
      <div className="col-span-3 flex items-center">
        <div className="flex-1">
          <MarketSelector markets={markets} selectedMarket={selectedMarket} />
        </div>
        <div className="px-3 flex-shrink-0">
          <DexSelector />
        </div>
      </div>

      {/* Row 2 Col 1: Chart */}
      <div className="min-h-0 overflow-hidden">
        <TradingChart candles={candles} symbol={store.selectedSymbol} tickSize={selectedMarket?.tickSize ?? 0.01} isLoading={candlesLoading} onLoadMoreHistory={loadOlderCandles} isLoadingHistory={isLoadingOlderCandles} />
      </div>

      {/* Row 2 Col 2: Orderbook / Trades (same height as chart) */}
      <div className="min-h-0 overflow-hidden" style={{ borderLeft: '1px solid #273035' }}>
        <OrderbookTradesPanel trades={trades} symbol={store.selectedSymbol} tickSize={selectedMarket?.tickSize} lotSize={selectedMarket?.lotSize} onPriceClick={handlePriceClick} />
      </div>

      {/* Row 2-3 Col 3: Order Form + Account Info (full height, HL style) */}
      <div className="row-span-2 flex flex-col gap-0.5 overflow-y-auto scrollbar-hide" style={{ borderLeft: '1px solid #273035' }}>
        <OrderForm market={selectedMarket} accountState={accountState ?? null} userFees={userFees} activeAssetData={activeAssetData ?? null} spotBalances={spotBalances} positions={positions} onSubmit={handleSubmitOrder} isSubmitting={isSubmitting} onEnableTrading={() => setShowAgentSetup(true)} scaleState={scaleState} setScaleState={setScaleState} onSubmitScale={handleSubmitScale} />
        <AccountInfoPanel accountState={accountState ?? null} positions={positions} spotBalances={spotBalances} markets={markets} walletAddress={walletAddress} onSendTransaction={deps.sendTransaction} onOpenAgentSetup={() => setShowAgentSetup(true)} />
      </div>

      {/* Row 3 Col 1-2: Positions (below chart + orderbook) */}
      <div className="col-span-2 min-h-0 overflow-hidden" style={{ borderTop: '1px solid #273035' }}>
        <PositionTable accountState={accountState ?? null} spotBalances={spotBalances} positions={positions} openOrders={openOrders} fills={fills} orderHistory={orderHistory} fundingHistory={fundingHistory} markets={markets} onClosePosition={handleClosePosition} onCancelOrder={handleCancelOrder} />
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // MOBILE LAYOUT
  // ═══════════════════════════════════════
  const mobileLayout = (
    <div className="md:hidden flex flex-col h-[calc(100vh-4rem)]" style={{ backgroundColor: '#0F1A1E' }}>
      {/* Top: Market + Price */}
      <div className="flex items-center justify-between px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid #273035' }}>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMobileNav('markets')}
            className="text-white font-semibold text-sm"
          >
            {selectedMarket?.name ?? 'Select Market'}
            <svg className="w-3 h-3 inline ml-1 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {selectedMarket && (
            <span className="text-xs text-[#5fd8ee]">{selectedMarket.maxLeverage}x</span>
          )}
        </div>
        <div className="text-right">
          <div className="text-white text-sm font-bold tabular-nums">
            {selectedMarket ? fmtPriceByTick(selectedMarket.markPrice, selectedMarket.tickSize) : '—'}
          </div>
          <div className={`text-xs ${priceChange >= 0 ? 'text-[#5fd8ee]' : 'text-[#ED7088]'}`}>
            {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Tab navigation: Chart / Order Book / Trades */}
      <div className="flex flex-shrink-0" style={{ borderBottom: '1px solid #273035' }}>
        {MOBILE_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setMobileTab(tab.key)}
            className={`flex-1 py-2.5 text-xs font-medium text-center transition-colors ${
              mobileTab === tab.key
                ? 'text-white'
                : 'text-gray-500'
            }`}
            style={mobileTab === tab.key ? { borderBottom: '2px solid #5fd8ee' } : undefined}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {mobileTab === 'chart' && (
          <TradingChart
            candles={candles}
            symbol={store.selectedSymbol}
            tickSize={selectedMarket?.tickSize ?? 0.01}
            isLoading={candlesLoading}
            onLoadMoreHistory={loadOlderCandles}
            isLoadingHistory={isLoadingOlderCandles}
          />
        )}
        {mobileTab === 'orderbook' && (
          <div className="h-full overflow-y-auto scrollbar-hide">
            <OrderbookPanel symbol={store.selectedSymbol} baseToken={store.selectedSymbol.split('-')[0]} lotSize={selectedMarket?.lotSize} onPriceClick={handlePriceClick} />
          </div>
        )}
        {mobileTab === 'trades' && (
          <div className="h-full overflow-y-auto scrollbar-hide">
            <RecentTrades trades={trades} baseToken={store.selectedSymbol.split('-')[0]} lotSize={selectedMarket?.lotSize} />
          </div>
        )}
      </div>

      {/* Positions section */}
      <div className="h-[180px] flex-shrink-0" style={{ borderTop: '1px solid #273035' }}>
        <PositionTable accountState={accountState ?? null} spotBalances={spotBalances} positions={positions} openOrders={openOrders} fills={fills} orderHistory={orderHistory} fundingHistory={fundingHistory} markets={markets} onClosePosition={handleClosePosition} onCancelOrder={handleCancelOrder} />
      </div>

      {/* Bottom Navigation */}
      <div className="flex flex-shrink-0 py-2" style={{ borderTop: '1px solid #273035', backgroundColor: '#0F1A1E' }}>
        <button
          onClick={() => setMobileNav('markets')}
          className={`flex-1 flex flex-col items-center gap-0.5 text-xs ${mobileNav === 'markets' ? 'text-[#5fd8ee]' : 'text-gray-500'}`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13h2v8H3v-8zm6-4h2v12H9V9zm6-2h2v14h-2V7zm6-4h2v18h-2V3z" />
          </svg>
          Markets
        </button>
        <button
          onClick={() => setShowMobileOrder(true)}
          className={`flex-1 flex flex-col items-center gap-0.5 text-xs ${mobileNav === 'trade' ? 'text-[#5fd8ee]' : 'text-gray-500'}`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Trade
        </button>
        <button
          onClick={() => setMobileNav('account')}
          className={`flex-1 flex flex-col items-center gap-0.5 text-xs ${mobileNav === 'account' ? 'text-[#5fd8ee]' : 'text-gray-500'}`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Account
        </button>
      </div>

      {/* Mobile Order Sheet */}
      {showMobileOrder && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowMobileOrder(false)} />
          <div className="relative rounded-t-2xl p-4 max-h-[85vh] overflow-y-auto scrollbar-hide" style={{ backgroundColor: '#0F1A1F' }}>
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-semibold text-white">Place Order</span>
              <button onClick={() => setShowMobileOrder(false)} className="text-gray-400 hover:text-white">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <OrderForm
              market={selectedMarket}
              accountState={accountState ?? null}
              userFees={userFees} activeAssetData={activeAssetData ?? null}
              spotBalances={spotBalances}
              positions={positions}
              onSubmit={() => { handleSubmitOrder(); setShowMobileOrder(false); }}
              isSubmitting={isSubmitting}
                            onEnableTrading={() => { setShowMobileOrder(false); setShowAgentSetup(true); }}
              scaleState={scaleState}
              setScaleState={setScaleState}
              onSubmitScale={() => { handleSubmitScale(); setShowMobileOrder(false); }}
            />
          </div>
        </div>
      )}

      {/* Mobile Markets Overlay */}
      {mobileNav === 'markets' && (
        <div className="fixed inset-0 z-50 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ backgroundColor: '#0F1A1E', borderBottom: '1px solid #273035' }}>
            <span className="text-white font-semibold">Markets</span>
            <button onClick={() => setMobileNav('trade')} className="text-gray-400 hover:text-white">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-hide" style={{ backgroundColor: '#0F1A1E' }}>
            <div className="p-3">
              <input
                placeholder="Search markets..."
                className="w-full rounded-md px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none"
                style={{ backgroundColor: '#1B2429', border: '1px solid #273035' }}
                onChange={(e) => {
                  // Filter handled by rendering
                  const q = e.target.value.toLowerCase();
                  document.querySelectorAll('[data-market-item]').forEach(el => {
                    const name = el.getAttribute('data-market-name') ?? '';
                    (el as HTMLElement).style.display = name.includes(q) ? '' : 'none'; // @ci-exception(type-assertion-count) — querySelectorAll returns Element, need HTMLElement for .style
                  });
                }}
              />
            </div>
            {markets.map(m => (
              <button
                key={m.symbol}
                data-market-item
                data-market-name={m.symbol.toLowerCase()}
                onClick={() => { store.setSelectedSymbol(m.symbol); setMobileNav('trade'); }}
                className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-white/5 transition-colors"
                style={{ borderBottom: '1px solid #1B2429' }}
              >
                <div>
                  <span className="text-white font-medium">{m.name}</span>
                  <span className="ml-2 text-xs text-gray-500">{m.maxLeverage}x</span>
                </div>
                <div className="text-right">
                  <div className="text-white text-xs tabular-nums">${m.markPrice.toLocaleString()}</div>
                  <div className={`text-xs ${m.fundingRate >= 0 ? 'text-[#5fd8ee]' : 'text-[#ED7088]'}`}>
                    {m.volume24h >= 1e6 ? `$${(m.volume24h / 1e6).toFixed(1)}M` : `$${m.volume24h.toFixed(0)}`}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mobile Account Overlay */}
      {mobileNav === 'account' && (
        <div className="fixed inset-0 z-50 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ backgroundColor: '#0F1A1E', borderBottom: '1px solid #273035' }}>
            <span className="text-white font-semibold">Account</span>
            <button onClick={() => setMobileNav('trade')} className="text-gray-400 hover:text-white">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-hide p-4" style={{ backgroundColor: '#0F1A1E' }}>
            <AccountInfoPanel
              accountState={accountState ?? null}
              positions={positions}
              spotBalances={spotBalances}
              markets={markets}
              walletAddress={walletAddress}
              onSendTransaction={deps.sendTransaction}
              onOpenAgentSetup={() => { setMobileNav('trade'); setShowAgentSetup(true); }}
            />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="scrollbar-hide [&_*]:scrollbar-hide">
      {desktopLayout}
      {mobileLayout}

      {/* Confirm Modal — close position / cancel order */}
      <ConfirmModal
        open={confirmPending !== null}
        title={confirmPending?.kind === 'close' ? 'Close Position' : 'Cancel Order'}
        message={
          confirmPending?.kind === 'close'
            ? (() => {
                const pos = positions.find(p => p.symbol === confirmPending.symbol);
                return pos
                  ? `Close ${pos.side.toUpperCase()} ${pos.size} ${confirmPending.symbol}? PnL: $${pos.unrealizedPnl.toFixed(2)}`
                  : `Close position for ${confirmPending.symbol}?`;
              })()
            : `Cancel order ${confirmPending?.orderId ?? ''} for ${confirmPending?.symbol ?? ''}?`
        }
        confirmText="Confirm"
        cancelText="Cancel"
        allowSkip={true}
        skipChecked={confirmPending?.skipChecked ?? false}
        onSkipToggle={(checked) => {
          if (confirmPending !== null) {
            setConfirmPending({ ...confirmPending, skipChecked: checked });
          }
        }}
        onConfirm={() => {
          if (confirmPending === null) return;
          if (confirmPending.skipChecked) {
            if (confirmPending.kind === 'close') setSkipClosePositionConfirm(true);
            else setSkipCancelOrderConfirm(true);
          }
          const pending = confirmPending;
          setConfirmPending(null);
          if (pending.kind === 'close') {
            void executeClosePosition(pending.symbol);
          } else {
            void executeCancelOrder(pending.orderId, pending.symbol);
          }
        }}
        onCancel={() => setConfirmPending(null)}
      />

      {/* Agent Wallet Setup Modal — 3-DEX unified panel with HL drill-down */}
      {showAgentSetup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => { setShowAgentSetup(false); setHlSetupMode(false); }}
        >
          <div
            className="w-full max-w-sm mx-4 rounded-xl overflow-hidden"
            style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #273035' }}>
              <div className="flex items-center gap-2">
                {hlSetupMode && (
                  <button onClick={() => setHlSetupMode(false)} className="text-gray-400 hover:text-white" aria-label="Back">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                <span className="text-sm font-semibold text-white">
                  {hlSetupMode ? 'Hyperliquid Agent Setup' : 'Agent Wallet Setup'}
                </span>
              </div>
              <button
                onClick={() => { setShowAgentSetup(false); setHlSetupMode(false); }}
                className="text-gray-400 hover:text-white"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {hlSetupMode ? (
              <AgentWalletPanel
                walletAddress={walletAddress}
                onComplete={() => { setShowAgentSetup(false); setHlSetupMode(false); }}
              />
            ) : (
              <AgentKeyManager
                pacificaAdapter={getAdapterByDex('pacifica') as PacificaPerpAdapter}
                lighterAdapter={getAdapterByDex('lighter') as LighterPerpAdapter}
                asterAdapter={getAdapterByDex('aster') as AsterPerpAdapter}
                pacificaAddress={null}
                onSetupHyperliquid={() => setHlSetupMode(true)}
                defaultCollapsed={false}
                onRegistrationSuccess={() => { setShowAgentSetup(false); setHlSetupMode(false); }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
