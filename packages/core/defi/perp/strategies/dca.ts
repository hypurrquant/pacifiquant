/**
 * DCA Strategy — compute a schedule of equal-sized orders at fixed intervals
 *
 * Returns an array of { delayMs, size } entries — one per order.
 * The first order has delayMs = 0 (immediate).
 */

import type { DcaConfig } from './types';

export interface DcaScheduleEntry {
  readonly delayMs: number;
  readonly size: number;
}

/**
 * Compute the DCA schedule from config.
 *
 * @returns Array of { delayMs, size } for each order.
 * @throws Error if totalOrders < 1 or orderSize <= 0.
 */
export function computeDcaSchedule(config: DcaConfig): DcaScheduleEntry[] {
  const { orderSize, intervalMs, totalOrders } = config;

  if (totalOrders < 1) {
    throw new Error('totalOrders must be at least 1');
  }
  if (orderSize <= 0) {
    throw new Error('orderSize must be positive');
  }

  const schedule: DcaScheduleEntry[] = [];

  for (let i = 0; i < totalOrders; i++) {
    schedule.push({
      delayMs: i * intervalMs,
      size: orderSize,
    });
  }

  return schedule;
}
