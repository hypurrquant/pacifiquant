/**
 * usePerpAdapter — adapter factory that returns the correct adapter
 * based on the selectedDex in the perp store.
 *
 * Each adapter is a singleton per protocol — switching dex just returns
 * a different pre-created instance. React Query caches are namespaced
 * by dexId so switching doesn't pollute cross-dex data.
 */

'use client';

import { useMemo } from 'react';
import { HyperliquidPerpAdapter, PacificaPerpAdapter, LighterPerpAdapter, AsterPerpAdapter } from '@hq/core/defi/perp';
import type { PerpAdapterBase } from '@hq/core/defi/perp';
import { usePerpStore } from '../stores/usePerpStore';
import type { PerpDexId } from '../types/perp.types';

// Singleton instances per protocol
const adapters: Record<PerpDexId, PerpAdapterBase> = {
  hyperliquid: new HyperliquidPerpAdapter(),
  pacifica: new PacificaPerpAdapter(),
  lighter: new LighterPerpAdapter(),
  aster: new AsterPerpAdapter(),
};

/**
 * Returns the active adapter instance based on the store's selectedDex.
 * Memoized — only changes when selectedDex changes.
 */
export function usePerpAdapter(): PerpAdapterBase {
  const selectedDex = usePerpStore(s => s.selectedDex);
  return useMemo(() => adapters[selectedDex], [selectedDex]);
}

/**
 * Returns the current dexId for use in React Query key namespacing.
 * All perp query keys should include this: ['perp', dexId, 'markets']
 */
export function useDexId(): PerpDexId {
  return usePerpStore(s => s.selectedDex);
}

/**
 * Get adapter instance by dexId (non-hook, for use outside React).
 */
export function getAdapterByDex(dexId: PerpDexId): PerpAdapterBase {
  return adapters[dexId];
}
