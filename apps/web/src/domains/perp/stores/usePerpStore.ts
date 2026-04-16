/**
 * Perp Trading Store — Zustand
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PerpStore } from '../types/perp.types';

export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%

const DEFAULT_ORDER_FORM = {
  side: 'long' as const,
  type: 'limit' as const,
  price: '',
  size: '',
  leverage: 10,
  reduceOnly: false,
  timeInForce: 'gtc' as const,
  triggerPrice: '',
  tpPrice: '',
  slPrice: '',
};

export const usePerpStore = create<PerpStore>()(persist((set) => ({
  selectedDex: 'hyperliquid',
  selectedSymbol: 'BTC',
  orderForm: { ...DEFAULT_ORDER_FORM },
  chartInterval: '15m',
  marginMode: 'cross',
  slippageBps: DEFAULT_SLIPPAGE_BPS,

  setSelectedDex: (dex) => set({ selectedDex: dex, selectedSymbol: 'BTC' }),
  setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
  setOrderSide: (side) => set((s) => ({ orderForm: { ...s.orderForm, side } })),
  setOrderType: (type) => set((s) => ({ orderForm: { ...s.orderForm, type } })),
  setOrderPrice: (price) => set((s) => ({ orderForm: { ...s.orderForm, price } })),
  setOrderSize: (size) => set((s) => ({ orderForm: { ...s.orderForm, size } })),
  setLeverage: (leverage) => set((s) => ({ orderForm: { ...s.orderForm, leverage } })),
  setReduceOnly: (reduceOnly) => set((s) => ({ orderForm: { ...s.orderForm, reduceOnly } })),
  setTimeInForce: (timeInForce) => set((s) => ({ orderForm: { ...s.orderForm, timeInForce } })),
  setTriggerPrice: (triggerPrice) => set((s) => ({ orderForm: { ...s.orderForm, triggerPrice } })),
  setTpPrice: (tpPrice) => set((s) => ({ orderForm: { ...s.orderForm, tpPrice } })),
  setSlPrice: (slPrice) => set((s) => ({ orderForm: { ...s.orderForm, slPrice } })),
  setChartInterval: (interval) => set({ chartInterval: interval }),
  setMarginMode: (mode) => set({ marginMode: mode }),
  setSlippageBps: (bps) => set({ slippageBps: bps }),
  resetOrderForm: () => set({ orderForm: { ...DEFAULT_ORDER_FORM } }),
}), {
  name: 'perp-store',
  // Bump version to force-reset legacy persisted symbol (e.g. stale HYPE)
  // back to the BTC default on next page load. Keep dex/interval/slippage
  // choices that carry meaning across sessions.
  version: 2,
  migrate: (persisted, fromVersion) => {
    const raw = (persisted ?? {}) as Partial<PerpStore>;
    if (fromVersion < 2) {
      // Older persisted state might hold a stale selectedSymbol (e.g. HYPE)
      // the user last traded. Reset to BTC so first-paint always starts on
      // the canonical default market.
      raw.selectedSymbol = 'BTC';
    }
    return {
      selectedDex: raw.selectedDex ?? 'hyperliquid',
      selectedSymbol: raw.selectedSymbol ?? 'BTC',
      chartInterval: raw.chartInterval ?? '15m',
      slippageBps: raw.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    };
  },
  partialize: (state) => ({
    selectedDex: state.selectedDex,
    selectedSymbol: state.selectedSymbol,
    chartInterval: state.chartInterval,
    slippageBps: state.slippageBps,
  }),
}));
