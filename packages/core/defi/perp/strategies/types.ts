/**
 * Bot Strategy Engine Types — Grid, DCA, TWAP
 *
 * Pure config + state types for automated trading strategies.
 * No runtime or adapter dependencies — computation helpers live
 * in their own files and the UI drives execution.
 */

// ============================================================
// Strategy Identity
// ============================================================

export type StrategyType = 'grid' | 'dca' | 'twap';
export type StrategyStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';

// ============================================================
// Config — immutable after creation
// ============================================================

export interface StrategyConfig {
  readonly type: StrategyType;
  readonly symbol: string;
  readonly exchange: string;
}

export interface GridConfig extends StrategyConfig {
  readonly type: 'grid';
  readonly upperPrice: number;
  readonly lowerPrice: number;
  readonly gridCount: number;      // number of grid lines
  readonly totalSize: number;      // total USDC
  readonly side: 'long' | 'short' | 'neutral';
}

export interface DcaConfig extends StrategyConfig {
  readonly type: 'dca';
  readonly side: 'long' | 'short';
  readonly orderSize: number;      // USDC per order
  readonly intervalMs: number;     // ms between orders
  readonly totalOrders: number;
  readonly priceLimit: number | null;  // stop if price exceeds
}

export interface TwapConfig extends StrategyConfig {
  readonly type: 'twap';
  readonly side: 'long' | 'short';
  readonly totalSize: number;      // total USDC
  readonly durationMs: number;     // total execution time
  readonly slices: number;         // number of order slices
}

// ============================================================
// Runtime State
// ============================================================

export interface StrategyState {
  readonly config: GridConfig | DcaConfig | TwapConfig;
  readonly status: StrategyStatus;
  readonly ordersPlaced: number;
  readonly ordersFilled: number;
  readonly totalSpent: number;
  readonly avgPrice: number;
  readonly startedAt: number;
  readonly error: string | null;
}
