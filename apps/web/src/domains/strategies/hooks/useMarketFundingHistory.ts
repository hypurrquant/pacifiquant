'use client';

/**
 * useMarketFundingHistory — fan-out fetch of per-exchange historical funding
 * rates for a single symbol. Used by the Cross-DEX Funding Scanner's row
 * drill-down to show whether a spread has been durable or a spike.
 */

import { useQuery } from '@tanstack/react-query';
import { toHourlyRate } from '@hq/core/defi/perp';
import type { MarketFundingPoint } from '@hq/core/defi/perp';
import { getAdapterByDex } from '@/domains/perp/hooks/usePerpAdapter';
import type { PerpDexId } from '@/domains/perp/types/perp.types';
import { PERP_DEX_ORDER } from '@/shared/config/perp-dex-display';

export interface DexFundingSeries {
  readonly dex: PerpDexId;
  /** Hourly-normalized series so callers can plot all four on one y-axis. */
  readonly points: ReadonlyArray<{ ts: number; hourlyRate: number }>;
  /** Whether this DEX exposes a public market-wide funding endpoint. Lighter
   *  returns `false` here so the UI can render an explicit "no public feed"
   *  label instead of an empty line. */
  readonly hasPublicFeed: boolean;
  /** Surface a fetch error or empty payload with a venue-scoped message so a
   *  single DEX failure doesn't hide the others. */
  readonly error: string | null;
}

const DEX_HAS_PUBLIC_FEED: Record<PerpDexId, boolean> = {
  hyperliquid: true,
  pacifica: true,
  lighter: false,
  aster: true,
};

async function fetchOne(dex: PerpDexId, symbol: string, startTime: number): Promise<DexFundingSeries> {
  if (!DEX_HAS_PUBLIC_FEED[dex]) {
    return { dex, points: [], hasPublicFeed: false, error: null };
  }
  try {
    const raw: MarketFundingPoint[] = await getAdapterByDex(dex).getMarketFundingHistory(symbol, startTime);
    const points = raw.map((p) => ({
      ts: p.ts,
      hourlyRate: toHourlyRate(p.fundingRate, dex),
    }));
    return { dex, points, hasPublicFeed: true, error: null };
  } catch (err) {
    return {
      dex,
      points: [],
      hasPublicFeed: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Returns one series per DEX, all normalized to hourly rate so they share a
 * single y-axis. `windowMs` defaults to 24h. React-Query keeps the data warm
 * for 5 minutes — funding prints at most hourly so we don't need to thrash.
 */
export function useMarketFundingHistory(
  symbol: string | null,
  windowMs: number = 24 * 60 * 60 * 1000,
) {
  return useQuery({
    queryKey: ['cross-dex-funding-history', symbol, windowMs],
    queryFn: async () => {
      if (!symbol) return [] as DexFundingSeries[];
      const startTime = Date.now() - windowMs;
      const results = await Promise.allSettled(
        PERP_DEX_ORDER.map((dex) => fetchOne(dex, symbol, startTime)),
      );
      return results.map((r, i): DexFundingSeries =>
        r.status === 'fulfilled'
          ? r.value
          : { dex: PERP_DEX_ORDER[i], points: [], hasPublicFeed: DEX_HAS_PUBLIC_FEED[PERP_DEX_ORDER[i]], error: 'fetch failed' },
      );
    },
    enabled: !!symbol,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
