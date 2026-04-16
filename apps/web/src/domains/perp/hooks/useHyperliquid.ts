/**
 * useHyperliquid — Hyperliquid-only helpers.
 *
 * Adapter-agnostic queries (markets / positions / openOrders / fills / etc.)
 * live in `usePerpData.ts` with `['perp', dexId, ...]` cache keys so each DEX
 * gets its own cache slot. Duplicate HL-only versions of those hooks used to
 * live here but had `['perp', ...]` keys without the dexId — deleted to
 * avoid cache collisions.
 *
 * What stays here are the two genuinely HL-only REST queries
 * (`activeAssetData` + `spotBalances`) plus the HL adapter singleton used
 * by `useRealtimeData.ts` for WS parse helpers.
 */

'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HyperliquidPerpAdapter } from '@hq/core/defi/perp';

// Singleton adapter instance reused across the app — `useRealtimeData.ts`
// relies on static parse helpers from this class, and REST queries share
// the same instance for consistent HIP-3 metadata caching.
let adapterInstance: HyperliquidPerpAdapter | null = null;

function getAdapter(): HyperliquidPerpAdapter {
  if (!adapterInstance) {
    adapterInstance = new HyperliquidPerpAdapter();
  }
  return adapterInstance;
}

export function useHyperliquidAdapter() {
  return useMemo(() => getAdapter(), []);
}

/**
 * HL `activeAssetData` — per-user, per-coin available-to-trade + max size.
 * Initial REST snapshot; `useRealtimeActiveAssetData` keeps it fresh via WS.
 *
 * queryKey MUST match `useRealtimeActiveAssetData`'s write target
 * (`['perp', dexId, 'activeAssetData', address, symbol]` with
 * dexId='hyperliquid'), otherwise WS pushes land in a sibling cache slot
 * that nobody reads.
 */
export function useActiveAssetData(address: string | null, symbol: string) {
  const adapter = useHyperliquidAdapter();
  return useQuery({
    queryKey: ['perp', 'hyperliquid', 'activeAssetData', address, symbol],
    queryFn: () => adapter.getActiveAssetData(address!, symbol),
    staleTime: Infinity,
    refetchInterval: false,
    enabled: !!address && !!symbol,
  });
}

/**
 * HL spot balances. WS `spotState` patches this cache via `setQueryData`;
 * this query provides the initial snapshot + a fallback refetch when the
 * component remounts after long idle.
 *
 * queryKey MUST match `useRealtimeSpotState`'s write target
 * (`['perp', dexId, 'spotBalances', address]` with dexId='hyperliquid'),
 * otherwise WS pushes land in a sibling cache slot that nobody reads.
 */
export function useSpotBalances(address: string | null) {
  const adapter = useHyperliquidAdapter();
  return useQuery({
    queryKey: ['perp', 'hyperliquid', 'spotBalances', address],
    queryFn: () => adapter.getSpotBalances(address!),
    staleTime: 60_000,
    refetchInterval: false,
    enabled: !!address,
  });
}
