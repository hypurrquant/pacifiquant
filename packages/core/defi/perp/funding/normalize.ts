/**
 * Funding rate normalization.
 *
 * Exchange funding rate periods:
 * - Hyperliquid: per 1 HOUR (settles every 1h)
 * - Pacifica: per 1 HOUR (settles every 1h)
 * - Lighter: per 8 HOURS (API returns 8h rate, settles every 1h)
 *
 * To compare rates across exchanges, we normalize everything to
 * a per-hour basis, then annualize from there.
 */

import type { FundingExchange } from './types';

/** Funding periods per year (hours in a year) */
const HOURLY_PERIODS = 24 * 365; // 8760

/** How many hours each exchange's raw rate covers */
const EXCHANGE_FUNDING_HOURS: Record<FundingExchange, number> = {
  hyperliquid: 1,
  pacifica: 1,
  lighter: 8,
  aster: 8,  // BNB Chain / Binance Futures convention: 8h settlement
};

/** Convert a raw funding rate to per-hour rate */
export function toHourlyRate(rate: number, exchange: FundingExchange): number {
  return rate / EXCHANGE_FUNDING_HOURS[exchange];
}

/** Annualize an already-normalized hourly rate. Returns percentage (e.g. 87.6 = 87.6%) */
export function annualizeRate(hourlyRate: number): number {
  return hourlyRate * HOURLY_PERIODS * 100;
}

/** Compute spread between two hourly rates (short - long). Always positive. */
export function computeSpread(longRate: number, shortRate: number): number {
  return Math.abs(shortRate - longRate);
}
