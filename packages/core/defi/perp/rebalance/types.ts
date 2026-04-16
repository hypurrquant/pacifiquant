/**
 * Rebalance Module Types
 *
 * Cross-exchange balance equalization types.
 */

export interface ExchangeBalanceSnapshot {
  readonly exchange: string;
  readonly equity: number;
  readonly available: number;
  readonly marginUsed: number;
}

export interface RebalanceMove {
  readonly from: string;
  readonly to: string;
  readonly amount: number;
  readonly reason: string;
}

export interface RebalancePlan {
  readonly snapshots: readonly ExchangeBalanceSnapshot[];
  readonly totalEquity: number;
  readonly targetPerExchange: number;
  readonly moves: readonly RebalanceMove[];
}
