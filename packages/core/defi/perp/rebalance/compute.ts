/**
 * Rebalance Computation Engine
 *
 * Equal-weight strategy: target = totalAvailable / numExchanges.
 * Reserve floor: $20 per exchange.
 * Greedy surplus → deficit matching, min move $50.
 */

import type { ExchangeBalanceSnapshot, RebalancePlan, RebalanceMove } from './types';

const DEFAULT_MIN_MOVE = 50;
const DEFAULT_RESERVE = 20;

/**
 * Compute a rebalancing plan to equalize available balance across exchanges.
 *
 * Algorithm:
 * 1. Default: equal-weight (target = totalAvailable / numExchanges)
 * 2. Reserve floor: $20 per exchange
 * 3. Compute deltas (surplus/deficit vs target)
 * 4. Sort surpluses desc, deficits asc
 * 5. Greedily match surplus → deficit, min move $50
 */
export function computeRebalancePlan(
  snapshots: readonly ExchangeBalanceSnapshot[],
  strategy: 'equal' = 'equal',
): RebalancePlan {
  // strategy 매개변수는 향후 weighted 전략 확장용. 현재는 equal만.
  void strategy;

  const totalEquity = snapshots.reduce((s, e) => s + e.equity, 0);
  const totalAvailable = snapshots.reduce((s, e) => s + e.available, 0);
  const targetPerExchange = snapshots.length > 0 ? totalAvailable / snapshots.length : 0;

  // Calculate deltas (positive = surplus, negative = deficit)
  const deltas: Array<[string, number]> = snapshots.map((snap) => {
    const movable = Math.max(0, snap.available - DEFAULT_RESERVE);
    const delta = movable - Math.max(0, targetPerExchange - DEFAULT_RESERVE);
    return [snap.exchange, delta];
  });

  // Match surplus → deficit
  const moves: RebalanceMove[] = [];
  const surpluses = deltas.filter(([, d]) => d > DEFAULT_MIN_MOVE).sort((a, b) => b[1] - a[1]);
  const deficits = deltas.filter(([, d]) => d < -DEFAULT_MIN_MOVE).sort((a, b) => a[1] - b[1]);

  for (const [fromEx, surplus] of surpluses) {
    let remaining = surplus;
    for (const deficit of deficits) {
      if (remaining < DEFAULT_MIN_MOVE) break;
      const [toEx, deficitAmt] = deficit;
      if (deficitAmt >= -DEFAULT_MIN_MOVE) continue;

      const moveAmt = Math.min(remaining, Math.abs(deficitAmt));
      if (moveAmt < DEFAULT_MIN_MOVE) continue;

      moves.push({
        from: fromEx,
        to: toEx,
        amount: Math.floor(moveAmt),
        reason: `Rebalance: ${fromEx} has $${Math.floor(surplus)} surplus, ${toEx} needs $${Math.floor(Math.abs(deficitAmt))}`,
      });

      remaining -= moveAmt;
      deficit[1] += moveAmt; // reduce deficit
    }
  }

  return {
    snapshots,
    totalEquity,
    targetPerExchange,
    moves,
  };
}
