/**
 * Perp Trading Module — barrel export
 */

// Types
export type {
  IPerpAdapter,
  PerpMarket,
  Orderbook,
  OrderbookLevel,
  Trade,
  Candle,
  CandleInterval,
  PerpAccountState,
  PerpActiveAssetData,
  SpotBalance,
  PerpPosition,
  PerpOrder,
  Fill,
  FundingHistoryEntry,
  MarketFundingPoint,
  PlaceOrderParams,
  PlaceScaleOrderParams,
  PlaceTwapOrderParams,
  CancelOrderParams,
  ModifyOrderParams,
  UpdateLeverageParams,
  OrderResult,
  DepositParams,
  WithdrawParams,
  WsChannel,
  WsMessage,
  Unsubscribe,
  EIP712SignFn,
  OrderSide,
  OrderType,
  OrderStatus,
  TimeInForce,
  TpSlTrigger,
  MarginMode,
  AgentWalletState,
  ApproveAgentParams,
  ApproveAsterAgentParams,
  ApproveBuilderFeeParams,
  MarketCategory,
  AssetType,
  UserFeeInfo,
  PerpDex,
} from './types';

// Base class
export { PerpAdapterBase } from './PerpAdapterBase';

// Adapters
export { HyperliquidPerpAdapter } from './adapters/HyperliquidPerpAdapter';
export { LighterPerpAdapter } from './adapters/LighterPerpAdapter';
export { PacificaPerpAdapter } from './adapters/PacificaPerpAdapter';
export { AsterPerpAdapter } from './adapters/AsterPerpAdapter';

// Funding rate normalization
export type { FundingExchange, FundingRateEntry, FundingArbOpportunity } from './funding';
export { toHourlyRate, annualizeRate, computeSpread } from './funding';

// Rebalance
export type { ExchangeBalanceSnapshot, RebalanceMove, RebalancePlan } from './rebalance';
export { computeRebalancePlan } from './rebalance';

// Strategies
export type { FundingArbParams, FundingArbResult } from './strategies';
export { executeFundingArb } from './strategies';

// Bot strategy engine
export type {
  StrategyType,
  StrategyStatus,
  StrategyConfig,
  GridConfig,
  DcaConfig,
  TwapConfig,
  StrategyState,
  GridLevel,
  DcaScheduleEntry,
  TwapSlice,
} from './strategies';
export { computeGridLevels, computeDcaSchedule, computeTwapSlices } from './strategies';

// Market Making (Dalen model)
export type { DalenParams, DalenQuotes } from './strategies';
export {
  computeDalenQuotes,
  rollingSigmaB,
  GAMMA_DEFAULT,
  KAPPA_DEFAULT,
  SIGMA_B_DEFAULT,
  SIGMA_B_WINDOW,
} from './strategies';
