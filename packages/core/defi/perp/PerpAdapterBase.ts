/**
 * PerpAdapterBase — Abstract base class for perp trading adapters
 *
 * LP 어댑터 패턴(FarmAdapterBase, MintAdapterBase)과 동일 구조.
 * 프로토콜별 concrete adapter가 상속하여 구현.
 */

import { ValidationError } from '@hq/core/lib/error';
import type {
  IPerpAdapter,
  PerpMarket,
  Orderbook,
  Trade,
  Candle,
  CandleInterval,
  PerpAccountState,
  PerpPosition,
  PerpOrder,
  Fill,
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
  UserFeeInfo,
  PerpDex,
  FundingHistoryEntry,
} from './types';
export abstract class PerpAdapterBase implements IPerpAdapter {
  abstract readonly protocolId: string;
  abstract readonly displayName: string;

  // ── Market Data ──
  abstract getMarkets(): Promise<PerpMarket[]>;
  abstract getOrderbook(symbol: string, nSigFigs?: number): Promise<Orderbook>;
  abstract getTrades(symbol: string, limit?: number): Promise<Trade[]>;
  /**
   * Fetch candles ending at `endTime` (inclusive, ms). Defaults to now.
   * Chart's infinite-scroll passes the oldest loaded candle timestamp to
   * fetch the next older page.
   */
  abstract getCandles(symbol: string, interval: CandleInterval, limit?: number, endTime?: number): Promise<Candle[]>;

  // ── Fees ──
  abstract getUserFees(address: string): Promise<UserFeeInfo>;

  // ── HIP-3 ──
  abstract getPerpDexs(): Promise<PerpDex[]>;

  // ── Account ──
  abstract getAccountState(address: string): Promise<PerpAccountState>;
  abstract getPositions(address: string): Promise<PerpPosition[]>;
  abstract getOpenOrders(address: string): Promise<PerpOrder[]>;
  abstract getOrderHistory(address: string, limit?: number): Promise<PerpOrder[]>;
  abstract getFills(address: string, limit?: number): Promise<Fill[]>;
  abstract getFundingHistory(address: string, startTime?: number): Promise<FundingHistoryEntry[]>;
  abstract getMarketFundingHistory(symbol: string, startTime?: number): Promise<MarketFundingPoint[]>;

  // ── Trading ──
  abstract placeOrder(params: PlaceOrderParams, signFn: EIP712SignFn): Promise<OrderResult>;
  abstract placeScaleOrder(params: PlaceScaleOrderParams, signFn: EIP712SignFn): Promise<OrderResult>;
  abstract placeTwapOrder(params: PlaceTwapOrderParams, signFn: EIP712SignFn): Promise<OrderResult>;
  abstract cancelOrder(params: CancelOrderParams, signFn: EIP712SignFn): Promise<OrderResult>;
  abstract modifyOrder(params: ModifyOrderParams, signFn: EIP712SignFn): Promise<OrderResult>;
  abstract updateLeverage(params: UpdateLeverageParams, signFn: EIP712SignFn): Promise<void>;

  // ── WebSocket ──
  abstract subscribe(channel: WsChannel, callback: (msg: WsMessage) => void): Unsubscribe;
  abstract disconnect(): void;

  // ── Transfers ──
  abstract deposit(params: DepositParams, signFn: EIP712SignFn): Promise<string>;
  abstract withdraw(params: WithdrawParams, signFn: EIP712SignFn): Promise<string>;

  // ── Shared helpers ──

  /** 레버리지 범위 검증 */
  protected validateLeverage(leverage: number, maxLeverage: number): void {
    if (leverage < 1 || leverage > maxLeverage) {
      throw new ValidationError(`Leverage must be between 1 and ${maxLeverage}`);
    }
  }

  /** 주문 사이즈 검증 */
  protected validateOrderSize(size: number, minSize: number): void {
    if (size < minSize) {
      throw new ValidationError(`Order size ${size} is below minimum ${minSize}`);
    }
  }

  /** PnL 계산 — long/short 공통 */
  protected calculatePnl(
    side: 'long' | 'short',
    entryPrice: number,
    markPrice: number,
    size: number,
  ): number {
    const priceDiff = side === 'long'
      ? markPrice - entryPrice
      : entryPrice - markPrice;
    return priceDiff * size;
  }

  /** ROE(Return on Equity) 계산 */
  protected calculateRoe(
    unrealizedPnl: number,
    marginUsed: number,
  ): number {
    if (marginUsed === 0) return 0;
    return (unrealizedPnl / marginUsed) * 100;
  }

  /** Liquidation price 추정 (cross margin 근사) */
  protected estimateLiquidationPrice(
    side: 'long' | 'short',
    entryPrice: number,
    leverage: number,
    maintenanceMarginRate: number = 0.005,
  ): number {
    const rate = 1 / leverage - maintenanceMarginRate;
    return side === 'long'
      ? entryPrice * (1 - rate)
      : entryPrice * (1 + rate);
  }
}
