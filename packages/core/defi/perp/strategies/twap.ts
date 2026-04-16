/**
 * TWAP Strategy — split totalSize into N slices over durationMs
 *
 * Returns an array of { delayMs, size } entries. The first slice
 * has delayMs = 0 (immediate). The last slice absorbs rounding dust
 * so the sum of all sizes equals totalSize exactly.
 */

import type { TwapConfig } from './types';

export interface TwapSlice {
  readonly delayMs: number;
  readonly size: number;
}

/**
 * Compute TWAP slices from config.
 *
 * @returns Array of { delayMs, size } for each slice.
 * @throws Error if slices < 2 or totalSize <= 0.
 */
export function computeTwapSlices(config: TwapConfig): TwapSlice[] {
  const { totalSize, durationMs, slices } = config;

  if (slices < 2) {
    throw new Error('slices must be at least 2');
  }
  if (totalSize <= 0) {
    throw new Error('totalSize must be positive');
  }

  const intervalMs = durationMs / slices;
  const baseSize = totalSize / slices;
  const result: TwapSlice[] = [];

  let allocated = 0;

  for (let i = 0; i < slices; i++) {
    const isLast = i === slices - 1;
    // Last slice absorbs rounding dust
    const size = isLast ? totalSize - allocated : baseSize;

    result.push({
      delayMs: i * intervalMs,
      size,
    });

    allocated += size;
  }

  return result;
}
