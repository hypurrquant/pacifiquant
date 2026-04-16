/**
 * Funding Rate Types — cross-DEX funding rate comparison
 *
 * Used by the Funding Rate Arb Scanner to normalize and compare
 * funding rates across Hyperliquid, Pacifica, and Lighter.
 */

/** Exchanges with known funding period conventions */
export type FundingExchange = 'hyperliquid' | 'pacifica' | 'lighter' | 'aster';

export interface FundingRateEntry {
  readonly symbol: string;
  readonly exchange: FundingExchange;
  readonly rate: number;           // raw rate from API
  readonly hourlyRate: number;     // normalized to per-hour
  readonly annualizedRate: number; // annualized (hourlyRate * 8760 * 100, as %)
}

export interface FundingArbOpportunity {
  readonly symbol: string;
  readonly longExchange: FundingExchange;   // exchange with lowest rate (go long here)
  readonly shortExchange: FundingExchange;  // exchange with highest rate (go short here)
  readonly longRate: number;       // hourly rate
  readonly shortRate: number;      // hourly rate
  readonly spreadHourly: number;   // shortRate - longRate
  readonly spreadAnnualized: number; // as percentage
}
