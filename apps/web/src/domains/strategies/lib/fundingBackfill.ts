import { annualizeRate, toHourlyRate } from '@hq/core/defi/perp';
import type { FundingExchange } from '@hq/core/defi/perp';
import type { FundingSpreadBucket } from './fundingSpreadHistory';
import { FUNDING_SPREAD_BUCKET_MS } from './fundingSpreadHistory';

const HYPERLIQUID_API_URL = 'https://api.hyperliquid.xyz';
const PACIFICA_API_URL = 'https://api.pacifica.fi/api/v1';
const LIGHTER_API_URL = 'https://mainnet.zklighter.elliot.ai';
const ASTER_API_URL = 'https://fapi.asterdex.com';
const HYPERLIQUID_PAGE_LIMIT = 500;
const PACIFICA_PAGE_LIMIT = 4000;
const PACIFICA_MAX_PAGES = 3;

export const FUNDING_SPREAD_BACKFILL_MS = 30 * 24 * FUNDING_SPREAD_BUCKET_MS;
export const FUNDING_SPREAD_BACKFILL_SYMBOL_LIMIT = 6;

interface FundingRatePoint {
  readonly ts: number;
  readonly hourlyRate: number;
}

interface ExchangeFundingSeries {
  readonly exchange: FundingExchange;
  readonly points: readonly FundingRatePoint[];
}

const FUNDING_WINDOW_HOURS: Record<FundingExchange, number> = {
  hyperliquid: 1,
  pacifica: 1,
  lighter: 8,
  aster: 8,
};

let lighterMarketIdsPromise: Promise<Map<string, number>> | null = null;

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractArray(value: unknown, keys: readonly string[]): readonly unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  for (const key of keys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function unwrapEnvelope(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  return record.data ?? value;
}

function toTimestampMs(timestamp: number): number {
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function bucketStart(timestamp: number): number {
  return Math.floor(timestamp / FUNDING_SPREAD_BUCKET_MS) * FUNDING_SPREAD_BUCKET_MS;
}

function isFundingRatePoint(value: FundingRatePoint | null): value is FundingRatePoint {
  return value !== null;
}

function dedupeAndSortPoints(points: readonly FundingRatePoint[]): FundingRatePoint[] {
  const sorted = [...points].sort((left, right) => left.ts - right.ts);
  const byBucket = new Map<number, FundingRatePoint>();
  for (const point of sorted) {
    byBucket.set(bucketStart(point.ts), point);
  }
  return [...byBucket.values()].sort((left, right) => left.ts - right.ts);
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<unknown>;
}

function parseHyperliquidPoint(value: unknown): FundingRatePoint | null {
  const record = asRecord(value);
  if (!record) return null;
  const timestamp = toNumber(record.time);
  const rate = toNumber(record.fundingRate ?? record.funding);
  if (timestamp === null || rate === null) return null;
  return {
    ts: toTimestampMs(timestamp),
    hourlyRate: toHourlyRate(rate, 'hyperliquid'),
  };
}

async function fetchHyperliquidFundingPoints(
  symbol: string,
  startTime: number,
  endTime: number,
): Promise<readonly FundingRatePoint[]> {
  const points: FundingRatePoint[] = [];
  let cursor = startTime;

  while (cursor < endTime) {
    const raw = await fetchJson(`${HYPERLIQUID_API_URL}/info`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'fundingHistory',
        coin: symbol,
        startTime: cursor,
        endTime,
      }),
    });

    const parsed = extractArray(raw, [])
      .map(parseHyperliquidPoint)
      .filter(isFundingRatePoint);

    if (parsed.length === 0) break;
    points.push(...parsed);

    const lastTs = parsed[parsed.length - 1].ts;
    if (parsed.length < HYPERLIQUID_PAGE_LIMIT || lastTs <= cursor) break;
    cursor = lastTs + FUNDING_SPREAD_BUCKET_MS;
  }

  return dedupeAndSortPoints(points).filter((point) => point.ts >= startTime && point.ts <= endTime);
}

function parsePacificaPoint(value: unknown): FundingRatePoint | null {
  const record = asRecord(value);
  if (!record) return null;
  const timestamp = toNumber(record.created_at ?? record.timestamp ?? record.time);
  const rate = toNumber(record.funding_rate ?? record.rate);
  if (timestamp === null || rate === null) return null;
  return {
    ts: toTimestampMs(timestamp),
    hourlyRate: toHourlyRate(rate, 'pacifica'),
  };
}

function getPacificaNextCursor(data: unknown): number | null {
  const record = asRecord(data);
  if (!record) return null;
  return toNumber(record.next_cursor ?? record.nextCursor ?? record.cursor);
}

async function fetchPacificaFundingPoints(
  symbol: string,
  startTime: number,
  endTime: number,
): Promise<readonly FundingRatePoint[]> {
  const points: FundingRatePoint[] = [];
  let cursor = 0;

  for (let page = 0; page < PACIFICA_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      symbol,
      limit: String(PACIFICA_PAGE_LIMIT),
      cursor: String(cursor),
    });
    const raw = await fetchJson(`${PACIFICA_API_URL}/funding_rate/history?${params.toString()}`, {
      method: 'GET',
    });
    const data = unwrapEnvelope(raw);
    const parsed = extractArray(data, ['funding_rates', 'history', 'items', 'rows'])
      .map(parsePacificaPoint)
      .filter(isFundingRatePoint);

    if (parsed.length === 0) break;
    points.push(...parsed);

    const oldestTs = Math.min(...parsed.map((point) => point.ts));
    const nextCursor = getPacificaNextCursor(data);
    if (oldestTs <= startTime || nextCursor === null || nextCursor <= cursor) break;
    cursor = nextCursor;
  }

  return dedupeAndSortPoints(points).filter((point) => point.ts >= startTime && point.ts <= endTime);
}

function parseLighterMarketIds(value: unknown): Map<string, number> {
  const records = extractArray(unwrapEnvelope(value), ['order_book_details', 'markets', 'items']);
  const map = new Map<string, number>();
  for (const entry of records) {
    const record = asRecord(entry);
    if (!record) continue;
    const symbol = typeof record.symbol === 'string' ? record.symbol : null;
    const marketId = toNumber(record.market_id ?? record.marketId);
    if (symbol === null || marketId === null) continue;
    map.set(symbol, marketId);
  }
  return map;
}

async function getLighterMarketIds(): Promise<Map<string, number>> {
  if (lighterMarketIdsPromise) return lighterMarketIdsPromise;

  lighterMarketIdsPromise = fetchJson(`${LIGHTER_API_URL}/api/v1/orderBookDetails?filter=perp`, {
    method: 'GET',
  }).then(parseLighterMarketIds);

  return lighterMarketIdsPromise;
}

function parseLighterPoint(value: unknown): FundingRatePoint | null {
  const record = asRecord(value);
  if (!record) return null;
  const timestamp = toNumber(record.timestamp ?? record.time);
  const rate = toNumber(record.rate ?? record.value);
  if (timestamp === null || rate === null) return null;
  return {
    ts: toTimestampMs(timestamp),
    hourlyRate: toHourlyRate(rate, 'lighter'),
  };
}

async function fetchLighterFundingPoints(
  symbol: string,
  startTime: number,
  endTime: number,
): Promise<readonly FundingRatePoint[]> {
  const marketIds = await getLighterMarketIds();
  const marketId = marketIds.get(symbol) ?? null;
  if (marketId === null) return [];

  const params = new URLSearchParams({
    market_id: String(marketId),
    resolution: '1h',
    timestamp: String(startTime),
  });
  const raw = await fetchJson(`${LIGHTER_API_URL}/api/v1/fundings?${params.toString()}`, {
    method: 'GET',
  });
  const parsed = extractArray(unwrapEnvelope(raw), ['fundings', 'items', 'history', 'data'])
    .map(parseLighterPoint)
    .filter(isFundingRatePoint);

  return dedupeAndSortPoints(parsed).filter((point) => point.ts >= startTime && point.ts <= endTime);
}

function parseAsterPoint(value: unknown): FundingRatePoint | null {
  const record = asRecord(value);
  if (!record) return null;
  const timestamp = toNumber(record.fundingTime ?? record.time);
  const rate = toNumber(record.fundingRate ?? record.rate);
  if (timestamp === null || rate === null) return null;
  return {
    ts: toTimestampMs(timestamp),
    hourlyRate: toHourlyRate(rate, 'aster'),
  };
}

async function fetchAsterFundingPoints(
  symbol: string,
  startTime: number,
  endTime: number,
): Promise<readonly FundingRatePoint[]> {
  const params = new URLSearchParams({
    symbol: `${symbol}USDT`,
    startTime: String(startTime),
    endTime: String(endTime),
    limit: '1000',
  });
  const raw = await fetchJson(`${ASTER_API_URL}/fapi/v1/fundingRate?${params.toString()}`, {
    method: 'GET',
  });
  const parsed = extractArray(raw, [])
    .map(parseAsterPoint)
    .filter(isFundingRatePoint);

  return dedupeAndSortPoints(parsed).filter((point) => point.ts >= startTime && point.ts <= endTime);
}

async function fetchExchangeFundingSeries(
  symbol: string,
  startTime: number,
  endTime: number,
): Promise<readonly ExchangeFundingSeries[]> {
  const results = await Promise.allSettled([
    fetchHyperliquidFundingPoints(symbol, startTime, endTime),
    fetchPacificaFundingPoints(symbol, startTime, endTime),
    fetchLighterFundingPoints(symbol, startTime, endTime),
    fetchAsterFundingPoints(symbol, startTime, endTime),
  ]);

  const exchanges: readonly FundingExchange[] = ['hyperliquid', 'pacifica', 'lighter', 'aster'];
  const series: ExchangeFundingSeries[] = [];

  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    if (result.value.length === 0) return;
    series.push({ exchange: exchanges[index], points: result.value });
  });

  return series;
}

function buildSpreadBuckets(
  series: readonly ExchangeFundingSeries[],
  startTime: number,
  endTime: number,
): FundingSpreadBucket[] {
  const ratesByBucket = new Map<number, Map<FundingExchange, number>>();

  for (const entry of series) {
    const windowHours = FUNDING_WINDOW_HOURS[entry.exchange];
    for (const point of entry.points) {
      const startBucket = bucketStart(point.ts);
      for (let hourOffset = 0; hourOffset < windowHours; hourOffset += 1) {
        const bucketTs = startBucket + hourOffset * FUNDING_SPREAD_BUCKET_MS;
        if (bucketTs < startTime || bucketTs > endTime) continue;
        const bucketRates = ratesByBucket.get(bucketTs) ?? new Map<FundingExchange, number>();
        bucketRates.set(entry.exchange, point.hourlyRate);
        ratesByBucket.set(bucketTs, bucketRates);
      }
    }
  }

  const buckets: FundingSpreadBucket[] = [];
  for (const [ts, exchangeRates] of [...ratesByBucket.entries()].sort((left, right) => left[0] - right[0])) {
    if (exchangeRates.size < 2) continue;
    const annualizedRates = [...exchangeRates.values()].map((rate) => annualizeRate(rate));
    const spread = Math.max(...annualizedRates) - Math.min(...annualizedRates);
    buckets.push({
      ts,
      avgSpread: spread,
      minSpread: spread,
      maxSpread: spread,
      latestSpread: spread,
      samples: exchangeRates.size,
    });
  }

  return buckets;
}

export async function backfillFundingSpreadHistory(
  symbols: readonly string[],
  now: number = Date.now(),
): Promise<Map<string, FundingSpreadBucket[]>> {
  const endTime = bucketStart(now);
  const startTime = endTime - FUNDING_SPREAD_BACKFILL_MS;
  const uniqueSymbols = [...new Set(symbols)].filter((symbol) => symbol.length > 0);

  const results = await Promise.allSettled(
    uniqueSymbols.map(async (symbol) => {
      const series = await fetchExchangeFundingSeries(symbol, startTime, endTime);
      const buckets = buildSpreadBuckets(series, startTime, endTime);
      return { symbol, buckets };
    }),
  );

  const history = new Map<string, FundingSpreadBucket[]>();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    if (result.value.buckets.length === 0) continue;
    history.set(result.value.symbol, result.value.buckets);
  }

  return history;
}
