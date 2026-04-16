/**
 * Dalen Market-Making Model (Avellaneda-Stoikov simplification)
 *
 * Ported from Python: outcome/src/mm_bot_v2.py
 * Original constants: GAMMA=0.3, KAPPA=2.0, SIGMA_B_DEFAULT=3.0, SIGMA_B_WINDOW=20
 *
 * Formula:
 *   reservationPrice = mid − inventory × gamma × sigmaB²
 *   halfSpread       = (gamma × sigmaB²) / 2 + (1 / gamma) × ln(1 + gamma / kappa)
 *   bid              = reservationPrice − halfSpread
 *   ask              = reservationPrice + halfSpread
 */

// ============================================================
// Constants
// ============================================================

/** Risk aversion parameter — higher = tighter quotes + faster inventory reduction */
export const GAMMA_DEFAULT = 0.3;

/** Order arrival rate — higher = tighter half-spread */
export const KAPPA_DEFAULT = 2.0;

/** Short-horizon volatility proxy (default used when fewer than 2 mid-price samples) */
export const SIGMA_B_DEFAULT = 3.0;

/** Rolling window size for computing sigmaB from recent mid prices */
export const SIGMA_B_WINDOW = 20;

// ============================================================
// Types
// ============================================================

/**
 * Input parameters for the Dalen quote computation.
 * Optional fields fall back to module-level defaults.
 */
export type DalenParams = {
  /** Current mid price of the market. Must be > 0. */
  mid: number;
  /** Signed inventory quantity: positive = long, negative = short. */
  inventory: number;
  /** Risk aversion. Defaults to GAMMA_DEFAULT. Must be > 0. */
  gamma?: number;
  /** Order arrival rate. Defaults to KAPPA_DEFAULT. Must be > 0. */
  kappa?: number;
  /** Short-horizon volatility proxy. Defaults to SIGMA_B_DEFAULT. Must be >= 0. */
  sigmaB?: number;
};

/**
 * Output quotes produced by the Dalen model.
 */
export type DalenQuotes = {
  /** Inventory-adjusted fair value (skewed away from current position). */
  readonly reservationPrice: number;
  /** Half of the total bid-ask spread. */
  readonly halfSpread: number;
  /** Limit bid price = reservationPrice − halfSpread. */
  readonly bid: number;
  /** Limit ask price = reservationPrice + halfSpread. */
  readonly ask: number;
};

// ============================================================
// Core computation
// ============================================================

/**
 * Compute Dalen market-making quotes from current market state.
 *
 * @throws Error when mid ≤ 0, gamma ≤ 0, kappa ≤ 0, or sigmaB < 0.
 */
export function computeDalenQuotes(params: DalenParams): DalenQuotes {
  const gamma = params.gamma ?? GAMMA_DEFAULT;
  const kappa = params.kappa ?? KAPPA_DEFAULT;
  const sigmaB = params.sigmaB ?? SIGMA_B_DEFAULT;
  const { mid, inventory } = params;

  if (mid <= 0) throw new Error(`mid must be > 0, got ${mid}`);
  if (gamma <= 0) throw new Error(`gamma must be > 0, got ${gamma}`);
  if (kappa <= 0) throw new Error(`kappa must be > 0, got ${kappa}`);
  if (sigmaB < 0) throw new Error(`sigmaB must be >= 0, got ${sigmaB}`);

  const sigmaB2 = sigmaB * sigmaB;
  const reservationPrice = mid - inventory * gamma * sigmaB2;
  const halfSpread = (gamma * sigmaB2) / 2 + (1 / gamma) * Math.log(1 + gamma / kappa);

  return {
    reservationPrice,
    halfSpread,
    bid: reservationPrice - halfSpread,
    ask: reservationPrice + halfSpread,
  };
}

// ============================================================
// Rolling volatility estimate
// ============================================================

/**
 * Compute the rolling standard deviation of the last `window` mid prices.
 *
 * Returns SIGMA_B_DEFAULT when fewer than 2 data points are available
 * (insufficient history to estimate volatility).
 */
export function rollingSigmaB(
  midHistory: readonly number[],
  window: number = SIGMA_B_WINDOW,
): number {
  const slice = midHistory.slice(-window);
  if (slice.length < 2) return SIGMA_B_DEFAULT;

  const n = slice.length;
  const mean = slice.reduce((acc, x) => acc + x, 0) / n;
  const variance = slice.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}
