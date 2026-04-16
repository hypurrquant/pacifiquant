/**
 * Perp Trading UI Types
 */

import type {
  PerpMarket,
  PerpPosition,
  PerpOrder,
  PerpAccountState,
  SpotBalance,
  Orderbook,
  OrderbookLevel,
  Trade,
  Candle,
  Fill,
  OrderSide,
  OrderType,
  TimeInForce,
  MarginMode,
  CandleInterval,
} from '@hq/core/defi/perp';

// ============================================================
// Store State
// ============================================================

/** Supported perp DEX protocols */
export type PerpDexId = 'hyperliquid' | 'pacifica' | 'lighter' | 'aster';

export interface PerpStoreState {
  // 현재 선택된 DEX
  selectedDex: PerpDexId;
  // 현재 선택된 마켓
  selectedSymbol: string;
  // 주문 폼 상태
  orderForm: OrderFormState;
  // UI 상태
  chartInterval: CandleInterval;
  marginMode: MarginMode;
  slippageBps: number;
}

export interface OrderFormState {
  side: OrderSide;
  type: OrderType;
  price: string;
  size: string;
  leverage: number;
  reduceOnly: boolean;
  timeInForce: TimeInForce;
  triggerPrice: string;
  tpPrice: string;
  slPrice: string;
}

export interface PerpStoreActions {
  setSelectedDex: (dex: PerpDexId) => void;
  setSelectedSymbol: (symbol: string) => void;
  setOrderSide: (side: OrderSide) => void;
  setOrderType: (type: OrderType) => void;
  setOrderPrice: (price: string) => void;
  setOrderSize: (size: string) => void;
  setLeverage: (leverage: number) => void;
  setReduceOnly: (reduceOnly: boolean) => void;
  setTimeInForce: (tif: TimeInForce) => void;
  setTriggerPrice: (price: string) => void;
  setTpPrice: (price: string) => void;
  setSlPrice: (price: string) => void;
  setChartInterval: (interval: CandleInterval) => void;
  setMarginMode: (mode: MarginMode) => void;
  setSlippageBps: (bps: number) => void;
  resetOrderForm: () => void;
}

export type PerpStore = PerpStoreState & PerpStoreActions;

// ============================================================
// Component Props
// ============================================================

export interface OrderbookProps {
  orderbook: Orderbook | null;
  lastPrice: number | null;
  onPriceClick: (price: number) => void;
}

export interface OrderFormProps {
  market: PerpMarket | null;
  accountState: PerpAccountState | null;
  onSubmit: () => void;
  isSubmitting: boolean;
}

export interface PositionTableProps {
  positions: PerpPosition[];
  onClose: (symbol: string) => void;
  onModify: (symbol: string) => void;
}

export interface TradeHistoryProps {
  trades: Trade[];
}

export interface OpenOrdersProps {
  orders: PerpOrder[];
  onCancel: (orderId: string, symbol: string) => void;
}

export interface FillHistoryProps {
  fills: Fill[];
}

// ============================================================
// Re-exports
// ============================================================

export type {
  PerpMarket,
  PerpPosition,
  PerpOrder,
  PerpAccountState,
  SpotBalance,
  Orderbook,
  OrderbookLevel,
  Trade,
  Candle,
  Fill,
  OrderSide,
  OrderType,
  TimeInForce,
  MarginMode,
  CandleInterval,
};
