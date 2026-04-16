/**
 * Grid Strategy — compute evenly-spaced grid levels between price bounds
 *
 * Distributes orders evenly between upperPrice and lowerPrice.
 * For 'long' side all orders are buys, for 'short' all sells,
 * for 'neutral' orders below mid are buys and above are sells.
 */

import type { GridConfig } from './types';

export interface GridLevel {
  readonly price: number;
  readonly size: number;
  readonly side: 'long' | 'short';
}

/**
 * Compute grid levels from config.
 *
 * @returns Array of { price, size, side } for each grid line, sorted by price ascending.
 * @throws Error if upperPrice <= lowerPrice or gridCount < 2.
 */
export function computeGridLevels(config: GridConfig): GridLevel[] {
  const { upperPrice, lowerPrice, gridCount, totalSize, side } = config;

  if (upperPrice <= lowerPrice) {
    throw new Error('upperPrice must be greater than lowerPrice');
  }
  if (gridCount < 2) {
    throw new Error('gridCount must be at least 2');
  }

  const step = (upperPrice - lowerPrice) / (gridCount - 1);
  const sizePerGrid = totalSize / gridCount;
  const midPrice = (upperPrice + lowerPrice) / 2;

  const levels: GridLevel[] = [];

  for (let i = 0; i < gridCount; i++) {
    const price = lowerPrice + step * i;
    let levelSide: 'long' | 'short';

    if (side === 'long') {
      levelSide = 'long';
    } else if (side === 'short') {
      levelSide = 'short';
    } else {
      // neutral: buy below mid, sell above mid
      levelSide = price < midPrice ? 'long' : 'short';
    }

    levels.push({ price, size: sizePerGrid, side: levelSide });
  }

  return levels;
}
