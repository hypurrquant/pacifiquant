'use client';

/**
 * useGlobalIntel — external market-intel feeds inspired by pacifica-fi/global-intel.
 *
 * Public read-only APIs (no auth, CORS-friendly) so the Strategies page gets
 * a "what's happening outside this app" surface without extra infrastructure.
 *
 *   - CoinGecko /api/v3/search/trending → top trending coins (24h rolling)
 *   - CoinGecko /api/v3/global          → global cap + BTC dominance
 *   - alternative.me/fng                 → Fear & Greed Index (daily)
 *
 * React Query caches generously because these signals move on the order of
 * minutes/hours, not ticks.
 */

import { useQuery } from '@tanstack/react-query';

const COINGECKO = 'https://api.coingecko.com/api/v3';
const FEAR_GREED = 'https://api.alternative.me/fng/';
const CRYPTOCOMPARE_NEWS = 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN';

export interface TrendingCoin {
  /** Base symbol in UPPERCASE — matches our PerpMarket.baseAsset convention. */
  readonly symbol: string;
  /** Human-readable name. */
  readonly name: string;
  /** CoinGecko rank of search interest (1 = most searched). */
  readonly rank: number;
  /** Market cap rank (smaller = bigger coin). */
  readonly marketCapRank: number | null;
  /** Small thumbnail URL from CoinGecko. */
  readonly thumb: string;
}

interface CoingeckoTrendingResponse {
  coins?: Array<{
    item?: {
      symbol?: string;
      name?: string;
      score?: number;
      market_cap_rank?: number | null;
      thumb?: string;
    };
  }>;
}

/**
 * Fetches the top 7 trending coins from CoinGecko's public endpoint.
 * Returns an empty array on failure — this is a nice-to-have surface, not
 * a blocker, so the Strategies page should stay usable when CoinGecko is
 * rate-limiting.
 */
export function useTrendingCoins() {
  return useQuery<readonly TrendingCoin[]>({
    queryKey: ['strategies', 'globalIntel', 'trending'],
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
    queryFn: async () => {
      try {
        const res = await fetch(`${COINGECKO}/search/trending`, {
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) return [];
        const raw = (await res.json()) as CoingeckoTrendingResponse;
        return (raw.coins ?? [])
          .map((c, idx) => {
            const item = c.item;
            if (!item?.symbol || !item.name) return null;
            return {
              symbol: item.symbol.toUpperCase(),
              name: item.name,
              rank: idx + 1,
              marketCapRank: item.market_cap_rank ?? null,
              thumb: item.thumb ?? '',
            } satisfies TrendingCoin;
          })
          .filter((x): x is TrendingCoin => x !== null);
      } catch {
        return [];
      }
    },
  });
}

// ============================================================
// Fear & Greed Index (alternative.me)
// ============================================================

export interface FearGreed {
  /** 0–100 score. 0 = extreme fear, 100 = extreme greed. */
  readonly score: number;
  /** Short label: "Fear" / "Greed" / "Extreme Fear" / etc. */
  readonly label: string;
  /** Unix seconds when the reading was taken. */
  readonly timestamp: number;
}

interface FearGreedResponse {
  data?: ReadonlyArray<{
    value?: string;
    value_classification?: string;
    timestamp?: string;
  }>;
}

/**
 * Crypto Fear & Greed Index from alternative.me. CORS-enabled, no auth.
 * Returns `null` on fetch failure so the card can silently hide the row.
 */
export function useFearGreedIndex() {
  return useQuery<FearGreed | null>({
    queryKey: ['strategies', 'globalIntel', 'fearGreed'],
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
    retry: 1,
    queryFn: async () => {
      try {
        const res = await fetch(`${FEAR_GREED}?limit=1`);
        if (!res.ok) return null;
        const raw = (await res.json()) as FearGreedResponse;
        const row = raw.data?.[0];
        if (!row?.value || !row.value_classification) return null;
        return {
          score: parseInt(row.value, 10),
          label: row.value_classification,
          timestamp: row.timestamp ? parseInt(row.timestamp, 10) : Date.now() / 1000,
        };
      } catch {
        return null;
      }
    },
  });
}

// ============================================================
// Global Market Cap + BTC Dominance (CoinGecko)
// ============================================================

export interface GlobalMarketStats {
  /** Total crypto market cap in USD. */
  readonly totalMarketCapUsd: number;
  /** Rolling 24h % change in total cap. */
  readonly marketCapChangePct24h: number;
  /** BTC dominance as a percent (0-100). */
  readonly btcDominancePct: number;
  /** ETH dominance as a percent. */
  readonly ethDominancePct: number;
}

interface CoingeckoGlobalResponse {
  data?: {
    total_market_cap?: { usd?: number };
    market_cap_change_percentage_24h_usd?: number;
    market_cap_percentage?: { btc?: number; eth?: number };
  };
}

/**
 * Total crypto market-cap + BTC/ETH dominance. Macro context for traders:
 * when BTC dominance rises, altcoins usually underperform — handy regime
 * signal for MM / funding-arb sizing decisions.
 */
export function useGlobalMarketStats() {
  return useQuery<GlobalMarketStats | null>({
    queryKey: ['strategies', 'globalIntel', 'globalMarketStats'],
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
    queryFn: async () => {
      try {
        const res = await fetch(`${COINGECKO}/global`);
        if (!res.ok) return null;
        const raw = (await res.json()) as CoingeckoGlobalResponse;
        const d = raw.data;
        if (!d) return null;
        return {
          totalMarketCapUsd: d.total_market_cap?.usd ?? 0,
          marketCapChangePct24h: d.market_cap_change_percentage_24h_usd ?? 0,
          btcDominancePct: d.market_cap_percentage?.btc ?? 0,
          ethDominancePct: d.market_cap_percentage?.eth ?? 0,
        };
      } catch {
        return null;
      }
    },
  });
}

// ============================================================
// Crypto News Feed (CryptoCompare)
// ============================================================

export interface NewsItem {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly source: string;
  /** Unix seconds published at. */
  readonly publishedAt: number;
  /** First 120 chars of body as a teaser. */
  readonly teaser: string;
}

interface CryptoCompareNewsResponse {
  Data?: ReadonlyArray<{
    id?: string | number;
    title?: string;
    url?: string;
    source?: string;
    published_on?: number;
    body?: string;
  }>;
}

/**
 * Top 10 crypto news headlines from CryptoCompare. CORS-enabled, no auth.
 * Ordered by published-date DESC.
 */
export function useCryptoNews() {
  return useQuery<readonly NewsItem[]>({
    queryKey: ['strategies', 'globalIntel', 'news'],
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
    queryFn: async () => {
      try {
        const res = await fetch(CRYPTOCOMPARE_NEWS);
        if (!res.ok) return [];
        const raw = (await res.json()) as CryptoCompareNewsResponse;
        return (raw.Data ?? [])
          .slice(0, 10)
          .map((n): NewsItem | null => {
            if (!n.title || !n.url) return null;
            return {
              id: String(n.id ?? n.url),
              title: n.title,
              url: n.url,
              source: n.source ?? 'unknown',
              publishedAt: n.published_on ?? Date.now() / 1000,
              teaser: (n.body ?? '').slice(0, 120),
            };
          })
          .filter((x): x is NewsItem => x !== null);
      } catch {
        return [];
      }
    },
  });
}
