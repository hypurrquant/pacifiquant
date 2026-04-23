'use client';

import { useQuery } from '@tanstack/react-query';

// Alternative.me publishes a free, CORS-open Fear & Greed JSON with no key
// and a stable shape — exactly what WorldMonitor wraps in GetFearGreedIndex.
export interface FearGreedPoint {
  readonly value: number;
  readonly classification: string;
  readonly timestamp: number;
}

export function useFearGreedIndex() {
  return useQuery<FearGreedPoint | null>({
    queryKey: ['macro', 'fear-greed'],
    queryFn: async () => {
      const res = await fetch('https://api.alternative.me/fng/?limit=1');
      if (!res.ok) return null;
      const json = (await res.json()) as {
        data?: Array<{ value: string; value_classification: string; timestamp: string }>;
      };
      const row = json.data?.[0];
      if (!row) return null;
      return {
        value: Number(row.value),
        classification: row.value_classification,
        timestamp: Number(row.timestamp) * 1000,
      };
    },
    staleTime: 10 * 60_000,
    refetchInterval: 15 * 60_000,
  });
}

// 365-day F&G history so the gauge can show Previous close / 1W / 1M / 1Y
// comparisons CNN-style without a second request path.
export function useFearGreedHistory() {
  return useQuery<FearGreedPoint[]>({
    queryKey: ['macro', 'fear-greed', 'history'],
    queryFn: async () => {
      const res = await fetch('https://api.alternative.me/fng/?limit=365');
      if (!res.ok) return [];
      const json = (await res.json()) as {
        data?: Array<{ value: string; value_classification: string; timestamp: string }>;
      };
      return (json.data ?? []).map((r) => ({
        value: Number(r.value),
        classification: r.value_classification,
        timestamp: Number(r.timestamp) * 1000,
      }));
    },
    staleTime: 30 * 60_000,
  });
}

// Upcoming high-volatility macro events. Hand-curated for the hackathon —
// funding rates historically spike around FOMC/CPI/NFP releases, so having
// these surfaced above the portfolio lets the user decide whether to
// unwind DN positions before the vol cliff.
//
// TODO(next-iteration): replace with FRED release calendar API (free key)
// so the dates auto-refresh past 2026-05.
export interface MacroEvent {
  readonly id: string;
  readonly label: string;
  readonly kind: 'FOMC' | 'CPI' | 'NFP' | 'PCE' | 'ECB';
  readonly occursAt: number; // epoch ms
  readonly note?: string;
}

const HARDCODED_EVENTS: MacroEvent[] = [
  { id: 'cpi-apr', label: 'US CPI (Apr)', kind: 'CPI', occursAt: Date.parse('2026-05-13T12:30:00Z'), note: 'Monthly inflation print' },
  { id: 'fomc-may', label: 'FOMC Rate Decision', kind: 'FOMC', occursAt: Date.parse('2026-05-07T18:00:00Z'), note: 'Fed funds + press conference' },
  { id: 'nfp-may', label: 'US NFP', kind: 'NFP', occursAt: Date.parse('2026-05-02T12:30:00Z'), note: 'Nonfarm payrolls' },
  { id: 'pce-may', label: 'Core PCE', kind: 'PCE', occursAt: Date.parse('2026-05-30T12:30:00Z') },
  { id: 'ecb-jun', label: 'ECB Rate Decision', kind: 'ECB', occursAt: Date.parse('2026-06-05T12:15:00Z') },
];

export function useEconomicCalendar() {
  return useQuery<MacroEvent[]>({
    queryKey: ['macro', 'calendar'],
    queryFn: async () => HARDCODED_EVENTS.filter((e) => e.occursAt > Date.now()).sort((a, b) => a.occursAt - b.occursAt),
    staleTime: 60 * 60_000,
  });
}

// Composite "macro signal" — proxy for WorldMonitor's GetMacroSignals.
// We approximate via Fear&Greed delta from neutral (50) plus BTC volatility
// (via 24h change magnitude). Real implementation would also include VIX
// and Treasury yield curve, but this gives a defensible single-number
// market-stress readout without extra API keys.
export interface MacroStress {
  readonly score: number;       // 0-100, higher = more stress
  readonly label: string;       // 'Calm' | 'Elevated' | 'Stressed' | 'Crisis'
  readonly inputs: { fearGreed: number; btcVol: number };
}

function classifyStress(score: number): string {
  if (score < 25) return 'Calm';
  if (score < 50) return 'Elevated';
  if (score < 75) return 'Stressed';
  return 'Crisis';
}

export function useMacroStress(fearGreed: number | null): MacroStress | null {
  const { data } = useQuery({
    queryKey: ['macro', 'btc-24h'],
    queryFn: async () => {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true');
      if (!res.ok) return null;
      const j = (await res.json()) as { bitcoin?: { usd_24h_change?: number } };
      return Math.abs(j.bitcoin?.usd_24h_change ?? 0);
    },
    staleTime: 5 * 60_000,
  });
  if (fearGreed == null) return null;
  const fgStress = Math.abs(50 - fearGreed) * 2;        // 0-100
  const btcStress = Math.min((data ?? 0) * 20, 100);    // 5% daily → 100
  const score = Math.round(0.6 * fgStress + 0.4 * btcStress);
  return { score, label: classifyStress(score), inputs: { fearGreed, btcVol: data ?? 0 } };
}

// CryptoPanic's public feed endpoint — no auth key needed for the public
// lane. Covers most crypto news in near real-time and maps cleanly to the
// ListFeedDigest shape WorldMonitor exposes.
export interface NewsItem {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly source: string;
  readonly sourceDomain: string | null;
  readonly publishedAt: number;
  readonly currencies: string[];
  readonly kind: 'news' | 'media' | string;
  readonly sentiment: 'bullish' | 'bearish' | 'neutral';
  readonly important: boolean;
}

// rss2json is a free RSS→JSON proxy with CORS headers. Combining multiple
// crypto-native feeds gives us enough coverage without needing a paid API
// key (CryptoPanic/CryptoCompare both gate their public endpoints now).
const RSS_FEEDS: Array<{ url: string; name: string; domain: string }> = [
  { url: 'https://cointelegraph.com/rss', name: 'Cointelegraph', domain: 'cointelegraph.com' },
  { url: 'https://decrypt.co/feed', name: 'Decrypt', domain: 'decrypt.co' },
];

// Heuristic sentiment tagger — title-only, no LLM. Catches the obvious
// "surge/crash" patterns; everything else falls through as 'neutral'.
const BULL_WORDS = ['surge', 'rally', 'breakout', 'all-time high', 'ath', 'soars', 'jump', 'gain', 'bullish', 'pump', 'rocket', 'record'];
const BEAR_WORDS = ['crash', 'plunge', 'tumble', 'sell-off', 'bearish', 'drop', 'hack', 'exploit', 'rug', 'liquidation', 'dump', 'fall', 'slump'];
const TICKER_RX = /\b(BTC|ETH|SOL|XRP|ADA|DOGE|HYPE|ARB|OP|AVAX|BNB|MATIC|TRUMP|PEPE|SUI|LINK|UNI|AAVE|ONDO|TAO|TIA|LDO|CRV|MKR|USDC|USDT)\b/g;

function classifyFromTitle(title: string): NewsItem['sentiment'] {
  const t = title.toLowerCase();
  if (BEAR_WORDS.some((w) => t.includes(w))) return 'bearish';
  if (BULL_WORDS.some((w) => t.includes(w))) return 'bullish';
  return 'neutral';
}

function extractTickers(title: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = TICKER_RX.exec(title)) !== null) {
    out.add(m[1]);
    if (out.size >= 4) break;
  }
  return Array.from(out);
}

export function useCryptoNews(limit = 15) {
  return useQuery<NewsItem[]>({
    queryKey: ['macro', 'cryptonews-rss', limit],
    queryFn: async () => {
      const batches = await Promise.allSettled(
        RSS_FEEDS.map(async (feed) => {
          const res = await fetch(
            `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.url)}`,
          );
          if (!res.ok) return [] as NewsItem[];
          const json = (await res.json()) as {
            status?: string;
            items?: Array<{ title?: string; link?: string; guid?: string; pubDate?: string; author?: string }>;
          };
          if (json.status !== 'ok') return [];
          return (json.items ?? []).map((r): NewsItem => {
            const title = r.title ?? '';
            return {
              id: r.guid ?? r.link ?? `${feed.name}-${title.slice(0, 40)}`,
              title,
              url: r.link ?? '',
              source: feed.name,
              sourceDomain: feed.domain,
              publishedAt: r.pubDate ? Date.parse(r.pubDate.replace(' ', 'T') + 'Z') : Date.now(),
              currencies: extractTickers(title),
              kind: 'news',
              sentiment: classifyFromTitle(title),
              important: false,
            };
          });
        }),
      );
      const flat = batches.flatMap((b) => (b.status === 'fulfilled' ? b.value : []));
      flat.sort((a, b) => b.publishedAt - a.publishedAt);
      return flat.slice(0, limit);
    },
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });
}
