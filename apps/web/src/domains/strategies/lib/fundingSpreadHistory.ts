'use client';

export interface FundingSpreadBucket {
  readonly ts: number;
  readonly avgSpread: number;
  readonly minSpread: number;
  readonly maxSpread: number;
  readonly latestSpread: number;
  readonly samples: number;
}

export interface FundingSpreadSnapshot {
  readonly symbol: string;
  readonly spread: number;
}

export const FUNDING_SPREAD_BUCKET_MS = 60 * 60 * 1000;
export const FUNDING_SPREAD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const HISTORY_KEY = 'hq-strategies-funding-spread-hourly-v2';

function bucketStart(timestamp: number): number {
  return Math.floor(timestamp / FUNDING_SPREAD_BUCKET_MS) * FUNDING_SPREAD_BUCKET_MS;
}

export function pruneFundingSpreadBuckets(
  buckets: readonly FundingSpreadBucket[],
  now: number,
): FundingSpreadBucket[] {
  return buckets.filter((bucket) => now - bucket.ts < FUNDING_SPREAD_RETENTION_MS);
}

export function loadFundingSpreadHistory(): Map<string, FundingSpreadBucket[]> {
  if (typeof window === 'undefined') return new Map();
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, FundingSpreadBucket[]>;
    const now = Date.now();
    const map = new Map<string, FundingSpreadBucket[]>();
    for (const [symbol, buckets] of Object.entries(parsed)) {
      const fresh = pruneFundingSpreadBuckets(buckets, now);
      if (fresh.length > 0) map.set(symbol, fresh);
    }
    return map;
  } catch {
    return new Map();
  }
}

export function saveFundingSpreadHistory(history: Map<string, FundingSpreadBucket[]>): void {
  if (typeof window === 'undefined') return;
  try {
    const serialized: Record<string, FundingSpreadBucket[]> = {};
    for (const [symbol, buckets] of history) {
      serialized[symbol] = buckets;
    }
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(serialized));
  } catch {
    // localStorage quota / privacy mode — keep UI functional without persistence
  }
}

export function hasFundingSpreadLookback(
  buckets: readonly FundingSpreadBucket[],
  lookbackMs: number,
  now: number = Date.now(),
): boolean {
  if (buckets.length === 0) return false;
  const earliest = buckets[0].ts;
  const latest = buckets[buckets.length - 1].ts;
  const coversRange = now - earliest >= lookbackMs - FUNDING_SPREAD_BUCKET_MS;
  const isFresh = now - latest <= 6 * FUNDING_SPREAD_BUCKET_MS;
  return coversRange && isFresh;
}

export function replaceFundingSpreadHistorySymbols(
  history: Map<string, FundingSpreadBucket[]>,
  replacement: Map<string, FundingSpreadBucket[]>,
  now: number = Date.now(),
): Map<string, FundingSpreadBucket[]> {
  const next = new Map<string, FundingSpreadBucket[]>();

  for (const [symbol, buckets] of history) {
    const fresh = pruneFundingSpreadBuckets(buckets, now);
    if (fresh.length > 0) next.set(symbol, [...fresh]);
  }

  for (const [symbol, buckets] of replacement) {
    const fresh = pruneFundingSpreadBuckets(buckets, now);
    if (fresh.length > 0) next.set(symbol, [...fresh]);
  }

  return next;
}

export function recordFundingSpreadSnapshot(
  history: Map<string, FundingSpreadBucket[]>,
  snapshots: readonly FundingSpreadSnapshot[],
  now: number = Date.now(),
): Map<string, FundingSpreadBucket[]> {
  const next = new Map<string, FundingSpreadBucket[]>();
  for (const [symbol, buckets] of history) {
    const fresh = pruneFundingSpreadBuckets(buckets, now);
    if (fresh.length > 0) next.set(symbol, [...fresh]);
  }

  const ts = bucketStart(now);
  for (const snapshot of snapshots) {
    const buckets = next.get(snapshot.symbol) ?? [];
    const last = buckets[buckets.length - 1] ?? null;
    if (last && last.ts === ts) {
      const sampleCount = last.samples + 1;
      const merged: FundingSpreadBucket = {
        ts,
        avgSpread: ((last.avgSpread * last.samples) + snapshot.spread) / sampleCount,
        minSpread: Math.min(last.minSpread, snapshot.spread),
        maxSpread: Math.max(last.maxSpread, snapshot.spread),
        latestSpread: snapshot.spread,
        samples: sampleCount,
      };
      buckets[buckets.length - 1] = merged;
    } else {
      buckets.push({
        ts,
        avgSpread: snapshot.spread,
        minSpread: snapshot.spread,
        maxSpread: snapshot.spread,
        latestSpread: snapshot.spread,
        samples: 1,
      });
    }
    next.set(snapshot.symbol, buckets);
  }

  return next;
}
