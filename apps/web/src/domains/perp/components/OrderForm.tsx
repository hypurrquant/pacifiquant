'use client';

/**
 * OrderForm — Hyperliquid 스타일 주문 입력 폼
 *
 * Layout:
 * ┌──────────────────────────────────┐
 * │ Cross │ {leverage}x │            │  ← margin mode + leverage
 * ├──────────────────────────────────┤
 * │ Market │ Limit │ Stop ▾         │  ← order type tabs
 * ├──────────────────────────────────┤
 * │ Buy / Long  │  Sell / Short     │  ← side toggle
 * ├──────────────────────────────────┤
 * │ Available to Trade    19.20 USDC│
 * │ Current Position      280 PURR  │
 * ├──────────────────────────────────┤
 * │ Price (USDC)          0.077 Mid │
 * │ Size (BTC)            0.00   ▾  │
 * │ ●────●────●────●────○  100%     │
 * ├──────────────────────────────────┤
 * │ ☐ Reduce Only    TIF  GTC  ▾   │
 * │ ☐ Take Profit / Stop Loss      │
 * ├──────────────────────────────────┤
 * │ [Enable Trading] or [Long BTC]  │
 * └──────────────────────────────────┘
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePerpStore } from '../stores/usePerpStore';
import { usePerpAdapter } from '../hooks/usePerpAdapter';
import { useAgentActive } from '../hooks/useAgentActive';
import { usePerpDeps } from '../providers/PerpDepsProvider';
import { sizeDecimals, fmtSizeByLot } from '../utils/displayComputations';
import type { PerpMarket, PerpAccountState, PerpPosition, TimeInForce } from '../types/perp.types';
import type { UserFeeInfo, PerpActiveAssetData, SpotBalance } from '@hq/core/defi/perp';

export interface ScaleState {
  active: boolean;
  start: string;
  end: string;
  totalOrders: string;
  sizeSkew: string;
}

interface Props {
  market: PerpMarket | null;
  accountState: PerpAccountState | null;
  /** HL per-coin per-direction availableToTrade. Drives the order form's
   *  "Available to Trade" row + size slider. Falls back to a derived value
   *  when null (unauthenticated / pre-fetch). */
  activeAssetData: PerpActiveAssetData | null;
  /** Spot balances — drives "Available to Trade" for SPOT markets (HL's
   *  activeAssetData is perp-only; spot buys pull from the spot USDC pool). */
  spotBalances: SpotBalance[];
  userFees: UserFeeInfo | null;
  positions: PerpPosition[];
  onSubmit: () => void;
  isSubmitting: boolean;
  onEnableTrading: () => void;
  scaleState: ScaleState;
  setScaleState: (updater: (prev: ScaleState) => ScaleState) => void;
  onSubmitScale: () => void;
}

const SIZE_PCTS = [0, 25, 50, 75, 100];

const TIF_OPTIONS: { value: TimeInForce; label: string }[] = [
  { value: 'gtc', label: 'GTC' },
  { value: 'ioc', label: 'IOC' },
  { value: 'alo', label: 'ALO' },
];

export function OrderForm({ market, accountState, activeAssetData, spotBalances, userFees, positions, onSubmit, isSubmitting, onEnableTrading, scaleState, setScaleState, onSubmitScale }: Props) {
  const store = usePerpStore();
  const { orderForm } = store;
  const adapter = usePerpAdapter();
  // Per-DEX agent activation — dispatched in `useAgentActive` so the
  // OrderForm doesn't carry one import per store.
  const isAgentActiveFromStore = useAgentActive();
  const deps = usePerpDeps();
  const [isUpdatingLeverage, setIsUpdatingLeverage] = useState(false);
  const [isUpdatingMargin, setIsUpdatingMargin] = useState(false);
  const [showProMenu, setShowProMenu] = useState(false);
  // Pacifica has no native TWAP endpoint so the menu item is gated below.
  const [twapModal, setTwapModal] = useState<{ size: string; durationMin: string; reduceOnly: boolean } | null>(null);
  const [twapSubmitting, setTwapSubmitting] = useState(false);
  const twapSupported = store.selectedDex !== 'pacifica';
  const handleTwapSubmit = useCallback(async () => {
    if (!twapModal || !market) return;
    if (!isAgentActiveFromStore) { onEnableTrading(); return; }
    const total = parseFloat(twapModal.size);
    const mins = parseFloat(twapModal.durationMin);
    if (!(total > 0) || !(mins > 0)) {
      deps.showToast({ title: 'Enter size and duration', type: 'warning' });
      return;
    }
    setTwapSubmitting(true);
    try {
      const signFn = deps.getSignFn();
      const vaultAddress = deps.getVaultAddress() ?? undefined;
      const res = await adapter.placeTwapOrder({
        symbol: market.symbol,
        side: orderForm.side,
        totalSize: total,
        durationMinutes: mins,
        reduceOnly: twapModal.reduceOnly,
        vaultAddress,
      }, signFn);
      if (res.success) {
        deps.showToast({ title: 'TWAP started', type: 'success' });
        setTwapModal(null);
      } else {
        deps.showToast({ title: 'TWAP failed', message: res.error ?? 'Unknown error', type: 'warning' });
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      deps.showToast({ title: 'TWAP failed', message: m, type: 'warning' });
    } finally {
      setTwapSubmitting(false);
    }
  }, [twapModal, market, isAgentActiveFromStore, onEnableTrading, adapter, deps, orderForm.side]);
  const [showTpSl, setShowTpSl] = useState(false);
  const [showTifMenu, setShowTifMenu] = useState(false);
  const [showLevModal, setShowLevModal] = useState(false);
  const [levInput, setLevInput] = useState(String(orderForm.leverage));
  // Size unit: 'base' shows the order amount in the coin's native unit
  // (e.g. BTC), 'usdc' shows it as notional USDC. Toggled by clicking the
  // unit label on the Size input. `orderForm.size` in the store is always
  // the base amount so the rest of the codebase (submit, scale, etc.)
  // doesn't need to care which unit the user is currently looking at.
  const [sizeUnit, setSizeUnit] = useState<'base' | 'usdc'>('base');

  // Per-coin per-direction availableToTrade for PERP markets comes from HL's
  // activeAssetData WS channel. SPOT markets use the spot USDC pool directly
  // (HL's perp withdrawable is unrelated to spot buying power). Fallback to
  // account-wide withdrawable only when the per-coin channel hasn't loaded.
  const sideIdx = orderForm.side === 'long' ? 0 : 1;
  const currentPos = positions.find(p => p.symbol === market?.symbol) ?? null;
  const isSpotMarket = market?.assetType === 'spot';
  const spotUsdc = spotBalances.find(b => b.coin === 'USDC');
  const spotUsdcAvailable = spotUsdc
    ? Math.max(0, parseFloat(spotUsdc.total) - parseFloat(spotUsdc.hold))
    : 0;
  const availableToTrade = isSpotMarket
    ? spotUsdcAvailable
    : (activeAssetData?.availableToTrade[sideIdx]
      ?? accountState?.availableBalance
      ?? 0);

  // Per-asset leverage + margin mode — HL tracks both per-coin. When the
  // user switches markets we sync the order-form state from the live
  // activeAssetData push so the displayed leverage / margin mode matches
  // what HL has on chain for this coin.
  //
  // Sync ONLY on the first activeAssetData arrival per symbol. Subsequent
  // WS pushes must not overwrite the user's optimistic click on
  // Cross/Isolated/Leverage: HL's updateLeverage action settles before
  // the next activeAssetData push reflects it, so syncing on every push
  // replays stale state over the local update and the pill reverts.
  const syncedSymbolRef = useRef<string | null>(null);
  useEffect(() => {
    if (!market) return;
    if (activeAssetData && activeAssetData.symbol === market.symbol) {
      if (syncedSymbolRef.current !== market.symbol) {
        store.setLeverage(activeAssetData.leverageValue);
        store.setMarginMode(activeAssetData.leverageType);
        syncedSymbolRef.current = market.symbol;
      }
      return;
    }
    // No activeAssetData for this symbol yet — clamp the existing leverage
    // to the market's max so switching from a 20x market to a 3x market
    // doesn't leave an invalid "10x" pill on screen.
    if (orderForm.leverage > market.maxLeverage) {
      store.setLeverage(market.maxLeverage);
    }
  }, [market, activeAssetData, orderForm.leverage, store]);

  // HL's maxTradeSzs is the authoritative ceiling for the current
  // leverage + margin. Clamp to it so the slider can't produce an
  // order that HL rejects with "Insufficient margin".
  const maxTradeSize = activeAssetData
    ? activeAssetData.maxTradeSizes[sideIdx]
    : Infinity;

  const handleSizePercent = useCallback((pct: number) => {
    if (!market) return;
    const notional = (availableToTrade * pct * orderForm.leverage) / 100;
    let size = notional / (market.markPrice || 1);
    // Clamp to HL's maxTradeSzs so slider 100% never exceeds what
    // HL will actually accept.
    if (isFinite(maxTradeSize) && size > maxTradeSize) size = maxTradeSize;
    // Snap to lotSize granularity. Previously used `toFixed` which rounds
    // to nearest — on markets where a single lot is large relative to
    // availableToTrade (Aster BTC @ $73k with ~$14 balance) this rounded
    // everything under 50% down to 0, making the slider unusable.
    //   - pct = 0          → size 0 (explicit zero)
    //   - pct > 0, size > 0 → floor to the nearest lot, but never below 1 lot
    //                        (user has to see the smallest placeable quantity)
    //   - pct > 0, size = 0 → still 0 (user has no balance at all)
    const lotSize = market.lotSize;
    let snapped: number;
    if (pct <= 0 || size <= 0) {
      snapped = 0;
    } else {
      const lots = Math.floor(size / lotSize);
      snapped = lots >= 1 ? lots * lotSize : lotSize;
    }
    store.setOrderSize(snapped.toFixed(sizeDecimals(lotSize)));
  }, [availableToTrade, market, orderForm.leverage, maxTradeSize, store]);

  const handleMidPrice = useCallback(() => {
    if (!market) return;
    store.setOrderPrice(market.markPrice.toString());
  }, [market, store]);

  // Slider position. We keep a LOCAL state that drives the slider's visual
  // thumb rather than re-deriving from `orderForm.size`. The re-derive path
  // snaps the thumb to the next-lot position after each drag — on markets
  // where the lotSize step is large relative to availableToTrade (Aster BTC
  // at small balances), a 1% drag rounds straight to 60% and the slider
  // "jumps". Keeping slider state independent lets the user drag smoothly
  // while the stored size still respects the exchange's lotSize.
  const [sliderPct, setSliderPct] = useState<number>(0);
  // When size changes from outside the slider (quick buttons / manual type /
  // availableToTrade refresh / leverage change), sync the slider back.
  useEffect(() => {
    if (!market || !orderForm.size || availableToTrade <= 0) {
      setSliderPct(0);
      return;
    }
    const derived = Math.min(100, Math.round(((parseFloat(orderForm.size) || 0) * (parseFloat(orderForm.price) || market.markPrice)) / (availableToTrade * orderForm.leverage / 100 || 1)));
    setSliderPct(derived);
    // Intentionally omit `sliderPct` from deps — this syncs EXTERNAL size
    // changes into the slider; local drags already called setSliderPct.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderForm.size, orderForm.price, orderForm.leverage, market?.markPrice, availableToTrade]);
  const sizePercent = sliderPct;

  const isTriggerType = orderForm.type === 'stop_limit' || orderForm.type === 'stop_market' || orderForm.type === 'take_limit' || orderForm.type === 'take_market';
  const isProActive = scaleState.active || isTriggerType;
  const proLabel = scaleState.active
    ? 'Scale'
    : orderForm.type === 'stop_limit'
      ? 'Stop Limit'
      : orderForm.type === 'stop_market'
        ? 'Stop Market'
        : orderForm.type === 'take_limit'
          ? 'Take Limit'
          : orderForm.type === 'take_market'
            ? 'Take Market'
            : 'Pro';

  return (
    <div className="flex flex-col gap-0" style={{ backgroundColor: '#0F1A1F' }}>

      {/* Row 1: Cross | Isolated | Leverage — 3 pill buttons (HL style)
          Perp-only. Spot markets have no margin mode / leverage, so this
          whole row is hidden when the current market is a spot pair. */}
      {/*
        HL updateLeverage (L1 action) carries both leverage AND isCross. Switching
        margin mode therefore requires a signed updateLeverage call, not just a
        local toggle — same as the leverage change. Agent wallet can sign both.
       */}
      {market?.assetType !== 'spot' && (() => {
        // HL HIP-3 자산(심볼 "xyz:CL" 등)은 cross margin 불가 — 각 deployer는
        // 독립 universe이기 때문에 cross는 오직 메인 perp(dex="")안에서만 동작한다.
        // 서버가 "Unknown symbol"로 거절하기 전에 UI에서 비활성화한다.
        const isCrossUnsupported = market?.category === 'hip3';
        const crossUnsupportedReason = 'HIP-3 deployer assets support isolated margin only.';
        return (
      <div className="grid grid-cols-3 gap-1.5 px-3 pt-2 pb-1.5">
        <button
          disabled={isUpdatingMargin || store.marginMode === 'cross' || isCrossUnsupported}
          title={isCrossUnsupported ? crossUnsupportedReason : undefined}
          onClick={async () => {
            if (!market?.symbol) return;
            if (isCrossUnsupported) {
              deps.showToast({ title: 'Cross margin unavailable', message: crossUnsupportedReason, type: 'info' });
              return;
            }
            // No agent yet → open the setup modal instead of running
            // the sign flow. Buttons stay visible as normal so the user
            // can see what they'll control once trading is enabled.
            if (!isAgentActiveFromStore) { onEnableTrading(); return; }
            setIsUpdatingMargin(true);
            try {
              const signFn = deps.getSignFn();
              const vaultAddress = deps.getVaultAddress() ?? undefined;
              await adapter.updateLeverage({ symbol: market.symbol, leverage: orderForm.leverage, marginMode: 'cross', vaultAddress }, signFn);
              store.setMarginMode('cross');
              deps.showToast({ title: 'Margin mode → Cross', type: 'success' });
            } catch (err) {
              const e = err as { message?: string } | null;
              deps.showToast({ title: 'Margin mode update failed', message: e?.message, type: 'warning' });
            } finally {
              setIsUpdatingMargin(false);
            }
          }}
          className={`py-1.5 text-xs font-medium rounded transition-colors disabled:cursor-not-allowed ${
            store.marginMode === 'cross'
              ? 'bg-[#1a2830] text-white'
              : isUpdatingMargin ? 'text-gray-600' : 'text-gray-500 hover:text-gray-300'
          } ${isCrossUnsupported ? 'opacity-40' : ''}`}
          style={{ border: store.marginMode === 'cross' ? '1px solid #5fd8ee' : '1px solid #273035' }}
        >
          {isUpdatingMargin && store.marginMode !== 'cross' ? 'Signing…' : 'Cross'}
        </button>
        <button
          disabled={isUpdatingMargin || store.marginMode === 'isolated'}
          onClick={async () => {
            if (!market?.symbol) return;
            if (!isAgentActiveFromStore) { onEnableTrading(); return; }
            setIsUpdatingMargin(true);
            try {
              const signFn = deps.getSignFn();
              const vaultAddress = deps.getVaultAddress() ?? undefined;
              await adapter.updateLeverage({ symbol: market.symbol, leverage: orderForm.leverage, marginMode: 'isolated', vaultAddress }, signFn);
              store.setMarginMode('isolated');
              deps.showToast({ title: 'Margin mode → Isolated', type: 'success' });
            } catch (err) {
              const e = err as { message?: string } | null;
              deps.showToast({ title: 'Margin mode update failed', message: e?.message, type: 'warning' });
            } finally {
              setIsUpdatingMargin(false);
            }
          }}
          className={`py-1.5 text-xs font-medium rounded transition-colors disabled:cursor-not-allowed ${
            store.marginMode === 'isolated'
              ? 'bg-[#1a2830] text-white'
              : isUpdatingMargin ? 'text-gray-600' : 'text-gray-500 hover:text-gray-300'
          }`}
          style={{ border: store.marginMode === 'isolated' ? '1px solid #5fd8ee' : '1px solid #273035' }}
        >
          {isUpdatingMargin && store.marginMode !== 'isolated' ? 'Signing…' : 'Isolated'}
        </button>
        <button
          onClick={() => {
            if (!isAgentActiveFromStore) { onEnableTrading(); return; }
            setLevInput(String(orderForm.leverage));
            setShowLevModal(true);
          }}
          className="py-1.5 text-xs font-medium rounded text-white hover:bg-[#1a2830] transition-colors"
          style={{ border: '1px solid #273035' }}
        >
          {orderForm.leverage}x
        </button>
      </div>
        );
      })()}

      {/* Row 2: Order Type Tabs (full-width distributed) */}
      <div className="grid grid-cols-3 px-3 pb-2" style={{ borderBottom: '1px solid #273035' }}>
        <button
          onClick={() => { store.setOrderType('market'); setScaleState(prev => ({ ...prev, active: false })); }}
          className={`pb-1 text-xs font-medium transition-colors text-center ${
            orderForm.type === 'market' && !scaleState.active ? 'text-white' : 'text-gray-500 hover:text-gray-300'
          }`}
          style={{ borderBottom: orderForm.type === 'market' && !scaleState.active ? '2px solid #5fd8ee' : '2px solid transparent', marginBottom: '-13px' }}
        >
          Market
        </button>
        <button
          onClick={() => { store.setOrderType('limit'); setScaleState(prev => ({ ...prev, active: false })); }}
          className={`pb-1 text-xs font-medium transition-colors text-center ${
            orderForm.type === 'limit' && !scaleState.active ? 'text-white' : 'text-gray-500 hover:text-gray-300'
          }`}
          style={{ borderBottom: orderForm.type === 'limit' && !scaleState.active ? '2px solid #5fd8ee' : '2px solid transparent', marginBottom: '-13px' }}
        >
          Limit
        </button>
        <div className="relative">
          <button
            onClick={() => setShowProMenu(!showProMenu)}
            className={`w-full pb-1 text-xs font-medium flex items-center justify-center gap-1 transition-colors ${
              isProActive ? 'text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
            style={{ borderBottom: isProActive ? '2px solid #5fd8ee' : '2px solid transparent', marginBottom: '-13px' }}
          >
            {proLabel}
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showProMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowProMenu(false)} />
              <div className="absolute top-full right-0 mt-2 z-40 rounded shadow-lg py-1" style={{ backgroundColor: '#1B2429', border: '1px solid #273035', minWidth: '130px' }}>
                <button
                  onClick={() => { setScaleState(prev => ({ ...prev, active: true })); setShowProMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-[#273035]"
                >
                  Scale
                </button>
                <button
                  onClick={() => { store.setOrderType('stop_limit'); setScaleState(prev => ({ ...prev, active: false })); setShowProMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-[#273035]"
                >
                  Stop Limit
                </button>
                <button
                  onClick={() => { store.setOrderType('stop_market'); setScaleState(prev => ({ ...prev, active: false })); setShowProMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-[#273035]"
                >
                  Stop Market
                </button>
                <button
                  onClick={() => { store.setOrderType('take_limit'); setScaleState(prev => ({ ...prev, active: false })); setShowProMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-[#273035]"
                >
                  Take Limit
                </button>
                <button
                  onClick={() => { store.setOrderType('take_market'); setScaleState(prev => ({ ...prev, active: false })); setShowProMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-[#273035]"
                >
                  Take Market
                </button>
                <button
                  disabled={!twapSupported}
                  title={twapSupported ? undefined : 'Not supported on Pacifica'}
                  onClick={() => {
                    if (!twapSupported) return;
                    setTwapModal({ size: orderForm.size ?? '', durationMin: '30', reduceOnly: false });
                    setShowProMenu(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs ${twapSupported ? 'text-gray-300 hover:bg-[#273035]' : 'text-gray-600 cursor-not-allowed'}`}
                >
                  TWAP{!twapSupported && <span className="ml-2 text-[9px] text-gray-600">(Pacifica unsupported)</span>}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Row 3: Buy / Long — Sell / Short */}
      <div className="grid grid-cols-2 gap-1.5 mx-3 mt-2 mb-2">
        <button
          onClick={() => store.setOrderSide('long')}
          className={`py-2 text-xs font-medium rounded transition-colors ${
            orderForm.side === 'long'
              ? 'bg-[#5fd8ee] text-[#0F1A1E]'
              : 'text-gray-500 hover:text-gray-300'
          }`}
          style={orderForm.side !== 'long' ? { border: '1px solid #273035' } : undefined}
        >
          Buy / Long
        </button>
        <button
          onClick={() => store.setOrderSide('short')}
          className={`py-2 text-xs font-medium rounded transition-colors ${
            orderForm.side === 'short'
              ? 'bg-[#ED7088] text-white'
              : 'text-gray-500 hover:text-gray-300'
          }`}
          style={orderForm.side !== 'short' ? { border: '1px solid #273035' } : undefined}
        >
          Sell / Short
        </button>
      </div>

      {/* Available + Current Position */}
      <div className="px-3 pb-3 space-y-1.5">
        <div className="flex justify-between items-center">
          <span className="text-xs" style={{ color: '#949E9C' }}>Available to Trade</span>
          <span className="text-xs text-white tabular-nums">
            {availableToTrade.toFixed(2)}
            <span className="text-gray-500 ml-1">USDC</span>
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs" style={{ color: '#949E9C' }}>Current Position</span>
          <span className="text-xs text-white tabular-nums">
            {currentPos && market ? `${currentPos.side === 'short' ? '-' : ''}${fmtSizeByLot(currentPos.size, market.lotSize)}` : '0.00'}
            <span className="text-gray-500 ml-1">{market?.baseAsset ?? '—'}</span>
          </span>
        </div>
      </div>

      {/* Price Input — hidden in market/stop_market/take_market and scale mode */}
      {orderForm.type !== 'market' && orderForm.type !== 'stop_market' && orderForm.type !== 'take_market' && !scaleState.active && (
        <div className="px-3 pb-2">
          <div className="flex items-center rounded-md px-3 py-2.5" style={{ border: '1px solid #273035', backgroundColor: '#1B2429' }}>
            <span className="text-xs text-gray-500 flex-shrink-0 mr-2">Price (USDC)</span>
            <input
              type="number"
              value={orderForm.price}
              onChange={(e) => store.setOrderPrice(e.target.value)}
              placeholder="0.00"
              className="flex-1 min-w-0 bg-transparent text-right text-xs text-white focus:outline-none"
            />
            <button
              onClick={handleMidPrice}
              className="ml-2 text-xs text-[#5fd8ee] hover:text-[#93E3F3] flex-shrink-0"
            >
              Mid
            </button>
          </div>
        </div>
      )}

      {/* Trigger Price (Stop/Take orders) — hidden in scale mode */}
      {isTriggerType && !scaleState.active && (
        <div className="px-3 pb-2">
          <div className="flex items-center rounded-md px-3 py-2.5" style={{ border: '1px solid #273035', backgroundColor: '#1B2429' }}>
            <span className="text-xs text-gray-500 flex-shrink-0 mr-2">Trigger</span>
            <input
              type="number"
              value={orderForm.triggerPrice}
              onChange={(e) => store.setTriggerPrice(e.target.value)}
              placeholder="0.00"
              className="flex-1 min-w-0 bg-transparent text-right text-xs text-white focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* Scale Inputs — shown only in scale mode */}
      {scaleState.active && (
        <>
          <div className="px-3 pb-2">
            <div className="flex items-center rounded-md px-3 py-2.5" style={{ border: '1px solid #273035', backgroundColor: '#1B2429' }}>
              <span className="text-xs text-gray-500 flex-shrink-0 mr-2">Start (USDC)</span>
              <input
                type="number"
                value={scaleState.start}
                onChange={(e) => setScaleState(prev => ({ ...prev, start: e.target.value }))}
                placeholder="0.00"
                className="flex-1 min-w-0 bg-transparent text-right text-xs text-white focus:outline-none"
              />
              <button
                onClick={() => setScaleState(prev => ({ ...prev, start: market ? market.markPrice.toString() : prev.start }))}
                className="ml-2 text-xs text-[#5fd8ee] hover:text-[#93E3F3] flex-shrink-0"
              >
                Mid
              </button>
            </div>
          </div>
          <div className="px-3 pb-2">
            <div className="flex items-center rounded-md px-3 py-2.5" style={{ border: '1px solid #273035', backgroundColor: '#1B2429' }}>
              <span className="text-xs text-gray-500 flex-shrink-0 mr-2">End (USDC)</span>
              <input
                type="number"
                value={scaleState.end}
                onChange={(e) => setScaleState(prev => ({ ...prev, end: e.target.value }))}
                placeholder="0.00"
                className="flex-1 min-w-0 bg-transparent text-right text-xs text-white focus:outline-none"
              />
              <button
                onClick={() => setScaleState(prev => ({ ...prev, end: market ? market.markPrice.toString() : prev.end }))}
                className="ml-2 text-xs text-[#5fd8ee] hover:text-[#93E3F3] flex-shrink-0"
              >
                Mid
              </button>
            </div>
          </div>
          <div className="px-3 pb-2 grid grid-cols-2 gap-2">
            <div className="flex items-center rounded-md px-3 py-2.5" style={{ border: '1px solid #273035', backgroundColor: '#1B2429' }}>
              <span className="text-xs text-gray-500 flex-shrink-0 mr-2">Orders</span>
              <input
                type="number"
                min={2}
                max={20}
                value={scaleState.totalOrders}
                onChange={(e) => setScaleState(prev => ({ ...prev, totalOrders: e.target.value }))}
                placeholder="5"
                className="flex-1 min-w-0 bg-transparent text-right text-xs text-white focus:outline-none"
              />
            </div>
            <div className="flex items-center rounded-md px-3 py-2.5" style={{ border: '1px solid #273035', backgroundColor: '#1B2429' }}>
              <span className="text-xs text-gray-500 flex-shrink-0 mr-2">Skew</span>
              <input
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                value={scaleState.sizeSkew}
                onChange={(e) => setScaleState(prev => ({ ...prev, sizeSkew: e.target.value }))}
                placeholder="1.00"
                className="flex-1 min-w-0 bg-transparent text-right text-xs text-white focus:outline-none"
              />
            </div>
          </div>
        </>
      )}

      {/* Size Input — unit can toggle between base asset and USDC notional.
          Store always holds the base amount; USDC view is a conversion on
          display + inverse conversion on input. */}
      {(() => {
        const effectivePrice = (parseFloat(orderForm.price) || market?.markPrice || 0);
        const baseSize = parseFloat(orderForm.size) || 0;
        const sizeDisplay = sizeUnit === 'usdc'
          ? (baseSize > 0 && effectivePrice > 0 ? (baseSize * effectivePrice).toFixed(2) : orderForm.size)
          : orderForm.size;
        const placeholder = sizeUnit === 'usdc' ? '0.00' : '0.0000';
        const unitLabel = sizeUnit === 'usdc' ? 'USDC' : (market?.baseAsset ?? '—');
        const handleSizeChange = (raw: string) => {
          if (sizeUnit === 'usdc') {
            if (raw === '' || raw === '0' || raw === '0.') {
              store.setOrderSize(raw);
              return;
            }
            const usd = parseFloat(raw);
            if (!isFinite(usd) || effectivePrice <= 0) return;
            // If market hasn't loaded yet, we don't know lotSize — don't
            // guess with a 4dp fallback that would ship wrong-precision
            // values to the venue. A one-tick delay is cheaper than a
            // "-1111 Precision over maximum" rejection.
            if (!market) return;
            const newBase = usd / effectivePrice;
            // FLOOR to lotSize (not nearest). The user typed a USDC
            // amount — rounding UP could store more base than the user's
            // intent (over-buy). Floor snaps down to the largest lot
            // whose notional does NOT exceed the typed USDC.
            const lotSize = market.lotSize;
            const snapped = Math.floor(newBase / lotSize) * lotSize;
            const dp = sizeDecimals(lotSize);
            store.setOrderSize(snapped.toFixed(dp).replace(/\.?0+$/, ''));
          } else {
            store.setOrderSize(raw);
          }
        };
        return (
          <div className="px-3 pb-2">
            <div className="flex items-center rounded-md px-3 py-2.5" style={{ border: '1px solid #273035', backgroundColor: '#1B2429' }}>
              <span className="text-xs text-gray-500 flex-shrink-0 mr-2">Size</span>
              <input
                type="number"
                value={sizeDisplay}
                onChange={(e) => handleSizeChange(e.target.value)}
                placeholder={placeholder}
                className="flex-1 min-w-0 bg-transparent text-right text-xs text-white focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setSizeUnit(u => u === 'base' ? 'usdc' : 'base')}
                className="ml-2 flex items-center gap-0.5 text-xs text-gray-400 flex-shrink-0 hover:text-white transition-colors"
                title="Toggle size unit"
              >
                <span>{unitLabel}</span>
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
                </svg>
              </button>
            </div>
          </div>
        );
      })()}

      {/* Size Slider — continuous 0-100% of availableToTrade */}
      <div className="px-3 pb-2">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={sizePercent}
          onChange={(e) => {
            const pct = Number(e.target.value);
            setSliderPct(pct);         // thumb follows drag smoothly
            handleSizePercent(pct);    // store size also updates
          }}
          className="perp-size-slider w-full"
          style={{
            background: `linear-gradient(to right, #5fd8ee 0%, #5fd8ee ${sizePercent}%, #273035 ${sizePercent}%, #273035 100%)`,
          }}
          aria-label="Order size percent"
        />
      </div>

      {/* Size Percentage — quick-select buttons */}
      <div className="px-3 pb-2 flex items-center gap-1.5">
        {SIZE_PCTS.map(p => (
          <button
            key={p}
            onClick={() => handleSizePercent(p)}
            className={`flex-1 py-1 rounded text-[10px] font-medium transition-colors ${
              sizePercent === p
                ? 'bg-[#1a2830] text-[#5fd8ee]'
                : 'text-gray-500 hover:text-gray-300 hover:bg-[#1a2830]/50'
            }`}
            style={{ border: sizePercent === p ? '1px solid #5fd8ee' : '1px solid #273035' }}
          >
            {p}%
          </button>
        ))}
        <div className="flex items-center rounded px-2 py-1 text-[10px] text-white flex-shrink-0" style={{ border: '1px solid #273035', backgroundColor: '#1B2429', minWidth: '44px' }}>
          <input
            type="number"
            min={0}
            max={100}
            value={sizePercent}
            onChange={(e) => handleSizePercent(Math.min(100, Math.max(0, Number(e.target.value))))}
            className="w-6 bg-transparent text-right text-white text-[10px] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-gray-500 ml-0.5">%</span>
        </div>
      </div>

      {/* Reduce Only + TIF */}
      <div className="px-3 pb-2 flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={orderForm.reduceOnly}
            onChange={(e) => store.setReduceOnly(e.target.checked)}
            className="accent-[#5fd8ee] w-4 h-4"
          />
          Reduce Only
        </label>
        <div className="relative flex items-center gap-1.5">
          <span className="text-xs text-gray-600 underline decoration-dotted">TIF</span>
          <button
            onClick={() => setShowTifMenu(!showTifMenu)}
            className="flex items-center gap-0.5 text-xs text-white"
          >
            {orderForm.timeInForce.toUpperCase()}
            <svg className="w-3 h-3 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showTifMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowTifMenu(false)} />
              <div className="absolute top-full right-0 mt-1 z-40 rounded shadow-lg py-1" style={{ backgroundColor: '#1B2429', border: '1px solid #273035', minWidth: '70px' }}>
                {TIF_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { store.setTimeInForce(opt.value); setShowTifMenu(false); }}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                      orderForm.timeInForce === opt.value ? 'text-[#5fd8ee]' : 'text-gray-300 hover:bg-[#273035]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Take Profit / Stop Loss Toggle — hidden in scale mode */}
      {!scaleState.active && (
        <div className="px-3 pb-3">
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showTpSl}
              onChange={(e) => setShowTpSl(e.target.checked)}
              className="accent-[#5fd8ee] w-4 h-4"
            />
            Take Profit / Stop Loss
          </label>
        </div>
      )}

      {/* TP/SL Inputs */}
      {showTpSl && !scaleState.active && (
        <div className="px-3 pb-2 grid grid-cols-2 gap-2">
          <div className="flex items-center rounded px-2 py-1.5" style={{ border: '1px solid #273035', backgroundColor: '#1B2429' }}>
            <span className="text-xs text-gray-500 mr-1">TP</span>
            <input
              type="number"
              value={orderForm.tpPrice}
              onChange={(e) => store.setTpPrice(e.target.value)}
              placeholder="—"
              className="flex-1 bg-transparent text-right text-xs text-white focus:outline-none w-0"
            />
          </div>
          <div className="flex items-center rounded px-2 py-1.5" style={{ border: '1px solid #273035', backgroundColor: '#1B2429' }}>
            <span className="text-xs text-gray-500 mr-1">SL</span>
            <input
              type="number"
              value={orderForm.slPrice}
              onChange={(e) => store.setSlPrice(e.target.value)}
              placeholder="—"
              className="flex-1 bg-transparent text-right text-xs text-white focus:outline-none w-0"
            />
          </div>
        </div>
      )}

      {/* Submit / Enable Trading */}
      <div className="px-3 pb-3">
        {/* Gate by the currently-selected DEX's agent, not HL's. The
            `isAgentActive` prop is HL-only; using it here would keep the
            submit button hidden on Pacifica / Lighter even after a
            successful registration on those venues. */}
        {isAgentActiveFromStore ? (
          <button
            onClick={scaleState.active ? onSubmitScale : onSubmit}
            disabled={isSubmitting || !orderForm.size}
            className={`w-full py-3 rounded-md text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              orderForm.side === 'long'
                ? 'bg-[#5fd8ee] hover:bg-[#93E3F3] text-[#0F1A1E]'
                : 'bg-[#ED7088] hover:bg-[#F08DA0] text-white'
            }`}
          >
            {isSubmitting
              ? 'Placing Order...'
              : scaleState.active
                ? `Scale ${orderForm.side === 'long' ? 'Buy' : 'Sell'} ${market?.baseAsset ?? ''}`
                : orderForm.type === 'stop_limit'
                  ? `Stop Limit ${orderForm.side === 'long' ? 'Buy' : 'Sell'} ${market?.baseAsset ?? ''}`
                  : orderForm.type === 'stop_market'
                    ? `Stop Market ${orderForm.side === 'long' ? 'Buy' : 'Sell'} ${market?.baseAsset ?? ''}`
                    : orderForm.type === 'take_limit'
                      ? `Take Limit ${orderForm.side === 'long' ? 'Buy' : 'Sell'} ${market?.baseAsset ?? ''}`
                      : orderForm.type === 'take_market'
                        ? `Take Market ${orderForm.side === 'long' ? 'Buy' : 'Sell'} ${market?.baseAsset ?? ''}`
                        : `${orderForm.side === 'long' ? 'Buy / Long' : 'Sell / Short'} ${market?.baseAsset ?? ''}`
            }
          </button>
        ) : (
          <button
            onClick={onEnableTrading}
            className="w-full py-2 rounded-md text-xs font-medium transition-colors bg-[#5fd8ee] hover:bg-[#93E3F3] text-[#0F1A1E]"
          >
            Enable Trading
          </button>
        )}
      </div>

      {/* Order Info — HL 스타일 (Liquidation / Order Value / Margin / Fees) */}
      <div className="px-3 pb-3 pt-2 space-y-1" style={{ borderTop: '1px solid #273035' }}>
        {(() => {
          const size = parseFloat(orderForm.size) || 0;
          const execPrice = parseFloat(orderForm.price) || market?.markPrice || 0;
          const orderValue = size * execPrice;
          const marginRequired = orderValue > 0 && orderForm.leverage > 0 ? orderValue / orderForm.leverage : 0;

          // Liquidation price estimate.
          // From HL docs: MMR = 1 / (2 × maxLeverage).
          // For CROSS margin: total account equity (availableToTrade) backs
          // the position, so liq is further away than just position margin.
          //   liq_long  = entry × (1 - equity/notional) / (1 - MMR)
          //   liq_short = entry × (1 + equity/notional) / (1 + MMR)
          // For ISOLATED: only the position's own margin backs it.
          //   equity = notional / leverage
          // See: https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations
          const maxLev = market?.maxLeverage ?? 20;
          const MMR = 1 / (2 * maxLev);
          const notional = size * execPrice;
          // Cross: full available balance backs the position
          // Isolated: only the order's own margin (notional / leverage)
          const equity = store.marginMode === 'cross'
            ? availableToTrade
            : notional / orderForm.leverage;
          const liqPrice = notional > 0 && execPrice > 0 && orderForm.leverage > 1
            ? (orderForm.side === 'long'
                ? execPrice * (1 - equity / notional) / (1 - MMR)
                : execPrice * (1 + equity / notional) / (1 + MMR))
            : null;

          // 실제 user fee rate 사용 (userFees가 없으면 default HL rate)
          // HL API rate는 소수점 (0.00045 = 0.045%), 표시는 % (0.0450)
          const isSpot = market?.assetType === 'spot';
          const defaultTaker = isSpot ? 0.00070 : 0.00045;
          const defaultMaker = isSpot ? 0.00040 : 0.00015;
          const baseTakerPct = defaultTaker * 100;
          const baseMakerPct = defaultMaker * 100;

          const userTakerRate = userFees
            ? (isSpot ? userFees.spotTaker : userFees.perpTaker)
            : defaultTaker;
          const userMakerRate = userFees
            ? (isSpot ? userFees.spotMaker : userFees.perpMaker)
            : defaultMaker;
          // Referral + staking 할인 적용 (multiplicative)
          const totalDiscount = userFees
            ? (1 - userFees.referralDiscount) * (1 - userFees.stakingDiscount)
            : 1;
          const discountedTakerPct = userTakerRate * totalDiscount * 100;
          const discountedMakerPct = userMakerRate * totalDiscount * 100;
          const hasDiscount = totalDiscount < 1 || userTakerRate !== defaultTaker;

          return (
            <>
              <div className="flex justify-between items-center">
                <span className="text-xs underline decoration-dotted" style={{ color: '#949E9C' }}>Liquidation Price</span>
                <span className="text-xs text-white tabular-nums">
                  {liqPrice !== null ? liqPrice.toFixed(liqPrice < 1 ? 6 : liqPrice < 100 ? 3 : 2) : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs" style={{ color: '#949E9C' }}>Order Value</span>
                <span className="text-xs text-white tabular-nums">
                  {orderValue > 0 ? `${orderValue.toFixed(2)} USDC` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs" style={{ color: '#949E9C' }}>Margin Required</span>
                <span className="text-xs text-white tabular-nums">
                  {marginRequired > 0 ? `${marginRequired.toFixed(2)} USDC` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-xs underline decoration-dotted" style={{ color: '#949E9C' }}>Fees</span>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {hasDiscount && (
                      <svg className="w-3 h-3 text-[#5fd8ee]" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2L2 12l10 10 10-10L12 2zm0 3l7 7-7 7-7-7 7-7z" />
                      </svg>
                    )}
                    <span className={`text-xs tabular-nums ${hasDiscount ? 'text-[#5fd8ee]' : 'text-white'}`}>
                      {discountedTakerPct.toFixed(4)}% / {discountedMakerPct.toFixed(4)}%
                    </span>
                  </div>
                  {hasDiscount && (
                    <div className="text-xs text-gray-600 tabular-nums line-through">
                      {baseTakerPct.toFixed(4)}% / {baseMakerPct.toFixed(4)}%
                    </div>
                  )}
                </div>
              </div>
            </>
          );
        })()}
      </div>

      {/* Leverage Modal */}
      {showLevModal && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setShowLevModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="rounded-xl p-4 w-72" style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-white">Leverage</span>
                <button onClick={() => setShowLevModal(false)} className="text-gray-400 hover:text-white">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {/* Slider on the left, numeric value on the right */}
              <div className="flex items-center gap-2 mb-3">
                <input
                  type="range"
                  min={1}
                  max={market?.maxLeverage ?? 50}
                  value={levInput}
                  onChange={(e) => setLevInput(e.target.value)}
                  className="flex-1 accent-[#5fd8ee] h-1 cursor-pointer"
                />
                <input
                  type="number"
                  min={1}
                  max={market?.maxLeverage ?? 50}
                  value={levInput}
                  onChange={(e) => setLevInput(e.target.value)}
                  className="w-16 bg-transparent text-center text-sm text-white rounded px-2 py-1.5 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  style={{ border: '1px solid #273035', backgroundColor: '#1B2429' }}
                />
                <span className="text-sm text-gray-400">x</span>
              </div>
              {/* Quick-select leverage buttons */}
              <div className="flex gap-1 mb-3">
                {[1, 2, 3, 5, 10, 20, 50].filter(l => l <= (market?.maxLeverage ?? 50)).map(l => (
                  <button
                    key={l}
                    onClick={() => setLevInput(String(l))}
                    className={`flex-1 py-1 text-[10px] font-medium rounded transition-colors ${
                      String(l) === levInput
                        ? 'bg-[#1a2830] text-[#5fd8ee]'
                        : 'text-gray-500 hover:text-gray-300 hover:bg-[#1a2830]/50'
                    }`}
                    style={{ border: String(l) === levInput ? '1px solid #5fd8ee' : '1px solid #273035' }}
                  >
                    {l}x
                  </button>
                ))}
              </div>
              <button
                disabled={isUpdatingLeverage}
                onClick={async () => {
                  // The leverage pill is only rendered when the agent is
                  // active, so reaching this handler guarantees a signer.
                  if (!market?.symbol) return;
                  const newLev = Math.min(Math.max(1, Number(levInput) || 1), market?.maxLeverage ?? 50);
                  setIsUpdatingLeverage(true);
                  try {
                    const signFn = deps.getSignFn();
                    const vaultAddress = deps.getVaultAddress() ?? undefined;
                    await adapter.updateLeverage({ symbol: market.symbol, leverage: newLev, marginMode: store.marginMode, vaultAddress }, signFn);
                    store.setLeverage(newLev);
                    setShowLevModal(false);
                    deps.showToast({ title: `Leverage updated to ${newLev}x`, type: 'success' });
                  } catch (err) {
                    const e = err as { message?: string } | null;
                    deps.showToast({ title: 'Leverage update failed', message: e?.message, type: 'warning' });
                  } finally {
                    setIsUpdatingLeverage(false);
                  }
                }}
                className="w-full py-2 rounded text-xs font-semibold bg-[#5fd8ee] text-[#0F1A1E] hover:bg-[#93E3F3] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isUpdatingLeverage ? 'Updating...' : 'Confirm'}
              </button>
            </div>
          </div>
        </>
      )}

      {twapModal && (
        <>
          <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={() => setTwapModal(null)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[320px] rounded-lg p-4" style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-white">TWAP · {market?.symbol ?? ''}</span>
              <button onClick={() => setTwapModal(null)} className="text-gray-500 hover:text-white" aria-label="Close">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-2.5">
              <label className="block">
                <span className="block text-[10px] mb-1" style={{ color: '#949E9C' }}>Total Size ({market?.baseAsset ?? ''})</span>
                <input
                  value={twapModal.size}
                  onChange={(e) => setTwapModal((prev) => prev ? { ...prev, size: e.target.value } : prev)}
                  inputMode="decimal"
                  className="w-full bg-[#0B141A] text-white text-sm px-2.5 py-1.5 rounded tabular-nums focus:outline-none"
                  style={{ border: '1px solid #273035' }}
                />
              </label>
              <label className="block">
                <span className="block text-[10px] mb-1" style={{ color: '#949E9C' }}>Duration (minutes)</span>
                <input
                  value={twapModal.durationMin}
                  onChange={(e) => setTwapModal((prev) => prev ? { ...prev, durationMin: e.target.value } : prev)}
                  inputMode="numeric"
                  className="w-full bg-[#0B141A] text-white text-sm px-2.5 py-1.5 rounded tabular-nums focus:outline-none"
                  style={{ border: '1px solid #273035' }}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={twapModal.reduceOnly}
                  onChange={(e) => setTwapModal((prev) => prev ? { ...prev, reduceOnly: e.target.checked } : prev)}
                />
                Reduce Only
              </label>
              <div className="text-[10px] pt-1" style={{ color: '#5a6469' }}>
                Side: <span className="text-white">{orderForm.side === 'long' ? 'Buy / Long' : 'Sell / Short'}</span> · Venue handles slicing.
              </div>
              <button
                onClick={handleTwapSubmit}
                disabled={twapSubmitting}
                className="w-full py-2 rounded text-xs font-semibold bg-[#5fd8ee] text-[#0F1A1E] hover:bg-[#93E3F3] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {twapSubmitting ? 'Starting…' : 'Start TWAP'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
