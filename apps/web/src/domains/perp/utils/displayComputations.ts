/**
 * Pure display computation functions extracted from perp React components.
 * These are the exact formulas that produce the numbers shown to the user.
 * Having them as pure functions makes them unit-testable without React.
 */

import type { PerpPosition, PerpAccountState, SpotBalance } from '@hq/core/defi/perp';

// ═══════════════════════════════════════
// MarketSelector display values
// ═══════════════════════════════════════

/** 24h change (absolute) */
export function change24h(markPrice: number, prevDayPx: number): number {
  return prevDayPx > 0 ? markPrice - prevDayPx : 0;
}

/** 24h change (percentage) */
export function change24hPct(markPrice: number, prevDayPx: number): number {
  return prevDayPx > 0 ? ((markPrice - prevDayPx) / prevDayPx) * 100 : 0;
}

/** Open Interest in USD notional (base × markPrice) */
export function oiUsd(openInterest: number, markPrice: number): number {
  return openInterest * markPrice;
}

/** Funding rate as display percentage (raw × 100) */
export function fundingPct(fundingRate: number): number {
  return fundingRate * 100;
}

/** Format large numbers: >1B → "1.23B", >1M → "1.23M", else comma-formatted */
export function fmtLarge(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// ═══════════════════════════════════════
// PositionTable display values
// ═══════════════════════════════════════

/** Position Value = |size| × markPrice */
export function positionValue(size: number, markPrice: number): number {
  return Math.abs(size) * markPrice;
}

/** Price decimal count from a market's tickSize */
export function priceDecimals(tickSize: number): number {
  if (!tickSize || !(tickSize > 0)) return 2;
  const d = Math.round(-Math.log10(tickSize));
  return Math.max(0, Math.min(8, d));
}

/** Format price with dynamic decimals based on tickSize */
export function fmtPriceByTick(price: number, tickSize: number): string {
  const d = priceDecimals(tickSize);
  return price.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Size decimal count from a market's lotSize (= 10^-szDecimals) */
export function sizeDecimals(lotSize: number): number {
  if (!lotSize || !(lotSize > 0)) return 4;
  const d = Math.round(-Math.log10(lotSize));
  return Math.max(0, Math.min(8, d));
}

/** Format size with dynamic decimals based on lotSize */
export function fmtSizeByLot(size: number, lotSize: number): string {
  const d = sizeDecimals(lotSize);
  return size.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

// ═══════════════════════════════════════
// OrderForm display values
// ═══════════════════════════════════════

/** Maintenance margin rate: MMR = 1 / (2 × maxLeverage) */
export function maintenanceMarginRate(maxLeverage: number): number {
  return 1 / (2 * maxLeverage);
}

/** Order value (notional) = size × price */
export function orderValue(size: number, price: number): number {
  return size * price;
}

/** Margin required = orderValue / leverage */
export function marginRequired(notional: number, leverage: number): number {
  return leverage > 0 ? notional / leverage : 0;
}

/**
 * Liquidation price estimate.
 *   long:  entry × (1 - equity/notional) / (1 - MMR)
 *   short: entry × (1 + equity/notional) / (1 + MMR)
 *
 * For cross margin: equity = availableToTrade (full account equity)
 * For isolated: equity = notional / leverage (position margin only)
 */
export function estimateLiqPrice(params: {
  side: 'long' | 'short';
  entryPrice: number;
  notional: number;
  equity: number;
  maxLeverage: number;
}): number | null {
  const { side, entryPrice, notional, equity, maxLeverage } = params;
  if (notional <= 0 || entryPrice <= 0) return null;
  const mmr = maintenanceMarginRate(maxLeverage);
  if (side === 'long') {
    return entryPrice * (1 - equity / notional) / (1 - mmr);
  }
  return entryPrice * (1 + equity / notional) / (1 + mmr);
}

/** Size percentage of available balance */
export function sizePercent(
  size: number,
  price: number,
  availableToTrade: number,
  leverage: number,
): number {
  if (availableToTrade <= 0 || leverage <= 0) return 0;
  const notional = size * price;
  const maxNotional = availableToTrade * leverage;
  return Math.min(100, Math.round((notional / maxNotional) * 100));
}

// ═══════════════════════════════════════
// AccountInfoPanel display values
// ═══════════════════════════════════════

/**
 * Unified Account Summary computations.
 * HL formula (from docs):
 *   available = USDC spotTotal - Σ isolated marginUsed
 *   ratio = crossMaintenanceMarginUsed / available × 100
 *   leverage = totalNtlPos / available
 *   portfolioValue = perp accountValue + spot (non-hold USDC + other tokens)
 */
export function unifiedAccountSummary(
  accountState: PerpAccountState,
  positions: PerpPosition[],
  spotBalances: SpotBalance[],
  marketPriceMap: Map<string, number>,
): {
  portfolioValue: number;
  unifiedRatio: number;
  unifiedLeverage: number;
  maintMargin: number;
} {
  // Spot USD value (subtract USDC hold to avoid double-count with perp equity)
  const spotUsd = spotBalances.reduce((sum, b) => {
    const total = parseFloat(b.total);
    const hold = parseFloat(b.hold);
    const countable = b.coin === 'USDC' ? Math.max(0, total - hold) : total;
    if (!(countable > 0)) return sum;
    const price = b.coin === 'USDC' ? 1 : (marketPriceMap.get(b.coin) ?? 0);
    return sum + countable * price;
  }, 0);

  const portfolioValue = accountState.totalEquity + spotUsd;
  const maintMargin = accountState.maintenanceMargin;

  // HL per-token formula (simplified for USDC-only)
  const usdcBalance = spotBalances.find(b => b.coin === 'USDC');
  const usdcSpotTotal = usdcBalance ? parseFloat(usdcBalance.total) : 0;
  const isolatedMarginSum = positions
    .filter(p => p.leverageType === 'isolated')
    .reduce((s, p) => s + p.marginUsed, 0);
  const available = usdcSpotTotal - isolatedMarginSum;

  const unifiedRatio = available > 0 ? (maintMargin / available) * 100 : 0;
  const unifiedLeverage = available > 0 ? accountState.totalNotional / available : 0;

  return { portfolioValue, unifiedRatio, unifiedLeverage, maintMargin };
}

// ═══════════════════════════════════════
// Balances tab computations
// ═══════════════════════════════════════

export function spotBalanceRow(b: SpotBalance, priceMap: Map<string, number>) {
  const total = parseFloat(b.total);
  const hold = parseFloat(b.hold);
  const available = total - hold;
  const entryNtl = parseFloat(b.entryNtl);
  const isUsdc = b.coin === 'USDC';
  const usdcValue = isUsdc ? total : (priceMap.get(b.coin) ?? 0) * total;
  const pnl = entryNtl > 0 ? usdcValue - entryNtl : 0;
  const pnlPct = entryNtl > 0 ? (pnl / entryNtl) * 100 : 0;
  return { total, hold, available, entryNtl, usdcValue, pnl, pnlPct, isUsdc };
}
