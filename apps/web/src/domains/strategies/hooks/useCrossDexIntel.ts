'use client';

/**
 * useCrossDexIntel — cross-DEX markets + positions for Strategies surfaces.
 *
 * Hits all 4 DEX adapters in parallel and aggregates the shape the
 * `MarketIntelCard` + any future cross-venue surfaces need. React Query
 * caches the result so multiple consumers (Intel card today, more later)
 * share one fetch per stale window.
 */

import { useQuery } from '@tanstack/react-query';
import { getAdapterByDex } from '@/domains/perp/hooks/usePerpAdapter';
import type { PerpDexId } from '@/domains/perp/types/perp.types';
import type { PerpMarket, PerpPosition } from '@hq/core/defi/perp';
import type { StrategyExchangeAccounts } from './useStrategyExchangeAccounts';

const DEX_IDS: readonly PerpDexId[] = ['hyperliquid', 'pacifica', 'lighter', 'aster'];

export interface CrossDexIntel {
  readonly markets: ReadonlyArray<{ readonly dex: PerpDexId; readonly market: PerpMarket }>;
  readonly positions: ReadonlyArray<{
    readonly dex: PerpDexId;
    readonly positions: readonly PerpPosition[];
    readonly markets: readonly PerpMarket[];
  }>;
}

/**
 * Fetches markets + positions across all 4 DEXs in parallel. Graceful per-DEX
 * failure: if any adapter throws we drop that slice rather than failing the
 * whole query — the Strategies page stays useful when one venue is down.
 */
export function useCrossDexIntel(accounts: StrategyExchangeAccounts) {
  const hasAnyAccount =
    accounts.hyperliquid !== null ||
    accounts.pacifica !== null ||
    accounts.lighter !== null ||
    accounts.aster !== null;

  return useQuery<CrossDexIntel>({
    queryKey: [
      'strategies',
      'crossDexIntel',
      accounts.hyperliquid,
      accounts.pacifica,
      accounts.lighter,
      accounts.aster,
    ],
    enabled: hasAnyAccount,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const results = await Promise.all(
        DEX_IDS.map(async (dex) => {
          try {
            const adapter = getAdapterByDex(dex);
            const address = accounts.byDex[dex];
            const [marketsForDex, positionsForDex] = await Promise.all([
              adapter.getMarkets(),
              // Some adapters require credentials to call getPositions — if
              // they throw, swallow so the markets slice still makes it
              // into the cross-DEX aggregate.
              address
                ? adapter.getPositions(address).catch(() => [] as PerpPosition[])
                : Promise.resolve([] as PerpPosition[]),
            ]);
            return { dex, marketsForDex, positionsForDex };
          } catch {
            return { dex, marketsForDex: [] as PerpMarket[], positionsForDex: [] as PerpPosition[] };
          }
        }),
      );

      const markets: Array<{ dex: PerpDexId; market: PerpMarket }> = [];
      const positions: Array<{ dex: PerpDexId; positions: PerpPosition[]; markets: PerpMarket[] }> = [];
      for (const { dex, marketsForDex, positionsForDex } of results) {
        for (const m of marketsForDex) markets.push({ dex, market: m });
        if (positionsForDex.length > 0) {
          positions.push({ dex, positions: positionsForDex, markets: marketsForDex });
        }
      }
      return { markets, positions };
    },
  });
}
