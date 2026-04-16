/**
 * Perp Strategies Module — barrel export
 */

// Funding Arb
export type { FundingArbParams, FundingArbResult } from './funding-arb';
export { executeFundingArb } from './funding-arb';

// Bot strategy types
export type {
  StrategyType,
  StrategyStatus,
  StrategyConfig,
  GridConfig,
  DcaConfig,
  TwapConfig,
  StrategyState,
} from './types';

// Grid
export type { GridLevel } from './grid';
export { computeGridLevels } from './grid';

// DCA
export type { DcaScheduleEntry } from './dca';
export { computeDcaSchedule } from './dca';

// TWAP
export type { TwapSlice } from './twap';
export { computeTwapSlices } from './twap';

// Market Making
export * from './mm';
