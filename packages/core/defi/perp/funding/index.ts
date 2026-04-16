/**
 * Funding Rate Module — barrel export
 */

export type { FundingExchange, FundingRateEntry, FundingArbOpportunity } from './types';
export { toHourlyRate, annualizeRate, computeSpread } from './normalize';
