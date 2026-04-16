'use client';

/**
 * FundingRateChart — cross-DEX funding snapshot + exchange-backed spread history.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  HyperliquidPerpAdapter,
  PacificaPerpAdapter,
  LighterPerpAdapter,
  AsterPerpAdapter,
  annualizeRate,
  toHourlyRate,
} from '@hq/core/defi/perp';
import type { PerpMarket } from '@hq/core/defi/perp';
import {
  FUNDING_SPREAD_BACKFILL_MS,
  FUNDING_SPREAD_BACKFILL_SYMBOL_LIMIT,
  backfillFundingSpreadHistory,
} from '../lib/fundingBackfill';
import {
  FUNDING_SPREAD_BUCKET_MS,
  hasFundingSpreadLookback,
  loadFundingSpreadHistory,
  recordFundingSpreadSnapshot,
  replaceFundingSpreadHistorySymbols,
  saveFundingSpreadHistory,
} from '../lib/fundingSpreadHistory';
import type { FundingSpreadBucket } from '../lib/fundingSpreadHistory';

const EXCHANGES = [
  { id: 'hyperliquid', name: 'HL', color: '#5fd8ee', period: 'hyperliquid' as const },
  { id: 'pacifica', name: 'PAC', color: '#AB9FF2', period: 'pacifica' as const },
  { id: 'lighter', name: 'LT', color: '#4A9EF5', period: 'lighter' as const },
  { id: 'aster', name: 'AST', color: '#FFA94D', period: 'aster' as const },
];

const adapters = [
  new HyperliquidPerpAdapter(),
  new PacificaPerpAdapter(),
  new LighterPerpAdapter(),
  new AsterPerpAdapter(),
];

const RANGE_OPTIONS = [
  { id: '24h', label: '24H', ms: 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7D', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: '30d', label: '30D', ms: 30 * 24 * 60 * 60 * 1000 },
] as const;

const STABLE_THRESHOLD_APR = 10;

type RangeKey = typeof RANGE_OPTIONS[number]['id'];
type HistoryStatus = 'idle' | 'backfilling' | 'ready' | 'error';

interface SymbolRates {
  readonly symbol: string;
  readonly rates: readonly number[];
  readonly maxSpread: number;
}

interface SpreadHistoryStats {
  readonly symbol: string;
  readonly buckets: readonly FundingSpreadBucket[];
  readonly avgSpread: number;
  readonly medianSpread: number;
  readonly latestSpread: number;
  readonly minSpread: number;
  readonly maxSpread: number;
  readonly observedHours: number;
  readonly coveragePct: number;
  readonly stablePct: number;
  readonly estDay: number;
  readonly estRange: number;
  readonly estMonth: number;
}

function fmtUsd(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtHours(hours: number): string {
  if (hours >= 24) return `${(hours / 24).toFixed(1)}d`;
  return `${hours.toFixed(0)}h`;
}

function HistorySparkline({ buckets }: { buckets: readonly FundingSpreadBucket[] }) {
  if (buckets.length === 0) return null;

  const width = 180;
  const height = 56;
  const spreads = buckets.map((bucket) => bucket.avgSpread);
  const min = Math.min(0, ...spreads);
  const max = Math.max(STABLE_THRESHOLD_APR * 1.2, ...spreads);
  const range = max - min || 1;
  const scaleY = (value: number) => height - ((value - min) / range) * height;
  const points = buckets.map((bucket, index) => {
    const x = buckets.length === 1 ? width : (index / (buckets.length - 1)) * width;
    return `${x.toFixed(2)},${scaleY(bucket.avgSpread).toFixed(2)}`;
  });
  const thresholdY = scaleY(STABLE_THRESHOLD_APR);
  const latest = buckets[buckets.length - 1];
  const latestY = scaleY(latest.avgSpread);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <line
        x1={0}
        x2={width}
        y1={thresholdY}
        y2={thresholdY}
        stroke="#273035"
        strokeDasharray="3 3"
        strokeWidth={0.75}
      />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="#5fd8ee"
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={width} cy={latestY} r={2.5} fill="#5fd8ee" />
    </svg>
  );
}

export function FundingRateChart() {
  const [data, setData] = useState<readonly SymbolRates[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>('7d');
  const [estimateNotional, setEstimateNotional] = useState('1000');
  const [history, setHistory] = useState<Map<string, FundingSpreadBucket[]>>(() => loadFundingSpreadHistory());
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>('idle');
  const hasBackfilledHistoryRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchFundingSnapshot() {
      const results = await Promise.allSettled(adapters.map((adapter) => adapter.getMarkets()));
      if (cancelled) return;

      const marketsByExchange: PerpMarket[][] = results.map((result) =>
        result.status === 'fulfilled' ? result.value.filter((market) => market.assetType === 'perp') : [],
      );

      const symbolSet = new Set<string>();
      for (const markets of marketsByExchange) {
        for (const market of markets) symbolSet.add(market.symbol);
      }

      const rows: SymbolRates[] = [];
      for (const symbol of symbolSet) {
        const rates = EXCHANGES.map((exchange, index) => {
          const market = marketsByExchange[index].find((entry) => entry.symbol === symbol);
          if (!market) return 0;
          return annualizeRate(toHourlyRate(market.fundingRate, exchange.period));
        });

        const activeRates = rates.filter((rate) => rate !== 0);
        if (activeRates.length < 2) continue;

        rows.push({
          symbol,
          rates,
          maxSpread: Math.max(...activeRates) - Math.min(...activeRates),
        });
      }

      rows.sort((left, right) => right.maxSpread - left.maxSpread);
      const nextRows = rows.slice(0, 12);
      setData(nextRows);
      setLoading(false);

      setHistory((current) => {
        const next = recordFundingSpreadSnapshot(
          current,
          nextRows.map((row) => ({ symbol: row.symbol, spread: row.maxSpread })),
        );
        saveFundingSpreadHistory(next);
        return next;
      });
    }

    void fetchFundingSnapshot();
    const intervalId = setInterval(() => {
      void fetchFundingSnapshot();
    }, 60_000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (hasBackfilledHistoryRef.current) return;
    if (data.length === 0) return;

    const candidates = data
      .slice(0, FUNDING_SPREAD_BACKFILL_SYMBOL_LIMIT)
      .map((row) => row.symbol)
      .filter((symbol) => !hasFundingSpreadLookback(history.get(symbol) ?? [], FUNDING_SPREAD_BACKFILL_MS));

    hasBackfilledHistoryRef.current = true;
    if (candidates.length === 0) {
      setHistoryStatus('ready');
      return;
    }

    let cancelled = false;
    setHistoryStatus('backfilling');

    void backfillFundingSpreadHistory(candidates)
      .then((backfilled) => {
        if (cancelled || backfilled.size === 0) {
          if (!cancelled) setHistoryStatus('ready');
          return;
        }

        setHistory((current) => {
          const replaced = replaceFundingSpreadHistorySymbols(current, backfilled);
          const withCurrentSnapshot = recordFundingSpreadSnapshot(
            replaced,
            data.map((row) => ({ symbol: row.symbol, spread: row.maxSpread })),
          );
          saveFundingSpreadHistory(withCurrentSnapshot);
          return withCurrentSnapshot;
        });
        setHistoryStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setHistoryStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [data, history]);

  const maxAbs = Math.max(1, ...data.flatMap((row) => row.rates.map(Math.abs)));
  const estimateNotionalNum = parseFloat(estimateNotional) || 0;
  const selectedRange = RANGE_OPTIONS.find((option) => option.id === range) ?? RANGE_OPTIONS[1];

  const spreadHistoryRows = useMemo<readonly SpreadHistoryStats[]>(() => {
    const now = Date.now();
    const expectedHours = Math.max(1, Math.round(selectedRange.ms / FUNDING_SPREAD_BUCKET_MS));
    const rows: SpreadHistoryStats[] = [];

    for (const [symbol, buckets] of history) {
      const inRange = buckets.filter((bucket) => now - bucket.ts <= selectedRange.ms);
      if (inRange.length === 0) continue;

      const spreads = inRange.map((bucket) => bucket.avgSpread);
      const sorted = [...spreads].sort((left, right) => left - right);
      const avgSpread = spreads.reduce((sum, spread) => sum + spread, 0) / inRange.length;
      const medianSpread = sorted[Math.floor(sorted.length / 2)] ?? 0;
      const latestSpread = inRange[inRange.length - 1]?.latestSpread ?? 0;
      const minSpread = Math.min(...inRange.map((bucket) => bucket.minSpread));
      const maxSpread = Math.max(...inRange.map((bucket) => bucket.maxSpread));
      const stableBuckets = inRange.filter((bucket) => bucket.avgSpread >= STABLE_THRESHOLD_APR).length;
      const stablePct = (stableBuckets / inRange.length) * 100;
      const observedHours = inRange.length;
      const coveragePct = Math.min(100, (observedHours / expectedHours) * 100);
      const estDay = (avgSpread / 100 / 365) * estimateNotionalNum;
      const estRange = estDay * (selectedRange.ms / (24 * 60 * 60 * 1000));
      const estMonth = estDay * 30;

      rows.push({
        symbol,
        buckets: inRange,
        avgSpread,
        medianSpread,
        latestSpread,
        minSpread,
        maxSpread,
        observedHours,
        coveragePct,
        stablePct,
        estDay,
        estRange,
        estMonth,
      });
    }

    rows.sort((left, right) => {
      if (right.avgSpread !== left.avgSpread) return right.avgSpread - left.avgSpread;
      return right.latestSpread - left.latestSpread;
    });
    return rows.slice(0, 6);
  }, [estimateNotionalNum, history, selectedRange.ms]);

  return (
    <div className="rounded-lg p-4" style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Funding Snapshot + History</h2>
            <p className="text-[10px] mt-0.5" style={{ color: '#949E9C' }}>
              Current annualized rates, plus settled 30D spread history backfilled from exchange APIs and kept current locally.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {EXCHANGES.map((exchange) => (
              <span key={exchange.id} className="flex items-center gap-1 text-[10px]" style={{ color: exchange.color }}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: exchange.color }} />
                {exchange.name}
              </span>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-xs" style={{ color: '#949E9C' }}>
            Loading funding rates...
          </div>
        ) : (
          <div className="space-y-1.5">
            {data.map((row) => (
              <div key={row.symbol} className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 w-12 text-right flex-shrink-0 tabular-nums">{row.symbol}</span>
                <div className="flex-1 flex items-center gap-0.5">
                  {row.rates.map((rate, index) => {
                    const width = (Math.abs(rate) / maxAbs) * 100;
                    const isPositive = rate >= 0;
                    return (
                      <div key={EXCHANGES[index].id} className="flex-1 flex items-center" style={{ height: 14 }}>
                        <div
                          className="h-full rounded-sm transition-all duration-300"
                          style={{
                            width: `${Math.max(width, 2)}%`,
                            backgroundColor: rate === 0 ? '#273035' : isPositive ? EXCHANGES[index].color : '#ED7088',
                            opacity: rate === 0 ? 0.3 : 0.8,
                          }}
                          title={`${EXCHANGES[index].name}: ${rate.toFixed(2)}%`}
                        />
                      </div>
                    );
                  })}
                </div>
                <span
                  className="text-[10px] tabular-nums w-14 text-right"
                  style={{ color: row.maxSpread > 10 ? '#5fd8ee' : '#949E9C' }}
                >
                  {row.maxSpread.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-md p-3 flex flex-col gap-3" style={{ backgroundColor: '#1B2429', border: '1px solid #273035' }}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="text-xs font-medium text-white">Spread History</div>
                {historyStatus === 'backfilling' && (
                  <span className="rounded px-1.5 py-0.5 text-[9px] font-medium" style={{ color: '#5fd8ee', backgroundColor: '#5fd8ee14', border: '1px solid #5fd8ee40' }}>
                    Backfilling 30D...
                  </span>
                )}
              </div>
              <div className="text-[10px]" style={{ color: '#949E9C' }}>
                Average spread, coverage, and estimated funding income over the selected range.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-md px-1 py-1" style={{ border: '1px solid #273035' }}>
                {RANGE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setRange(option.id)}
                    className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                      range === option.id ? 'text-white' : 'text-gray-500 hover:text-gray-300'
                    }`}
                    style={{
                      backgroundColor: range === option.id ? '#0F1A1F' : 'transparent',
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <label
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[10px]"
                style={{ border: '1px solid #273035', color: '#949E9C' }}
              >
                <span>Notional</span>
                <input
                  type="number"
                  value={estimateNotional}
                  onChange={(event) => setEstimateNotional(event.target.value)}
                  className="w-20 bg-transparent text-right text-white font-mono tabular-nums focus:outline-none"
                  min={0}
                  step={0.01}
                />
              </label>
            </div>
          </div>

          {spreadHistoryRows.length === 0 ? (
            <div className="text-center py-6 text-xs" style={{ color: '#949E9C' }}>
              {historyStatus === 'backfilling'
                ? 'Backfilling settled funding history from the exchanges...'
                : 'Historical funding spread data is not available yet for the current top markets.'}
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {spreadHistoryRows.map((row) => {
                const latestColor = row.latestSpread >= STABLE_THRESHOLD_APR ? '#5fd8ee' : row.latestSpread >= 0 ? '#FFA94D' : '#ED7088';
                return (
                  <div
                    key={row.symbol}
                    className="rounded-md p-3 flex flex-col gap-3"
                    style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-white">{row.symbol}</div>
                        <div className="text-[10px]" style={{ color: '#949E9C' }}>
                          Observed {fmtHours(row.observedHours)} · {row.coveragePct.toFixed(0)}% coverage · stable {row.stablePct.toFixed(0)}% above {STABLE_THRESHOLD_APR}% APR
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-semibold font-mono tabular-nums" style={{ color: latestColor }}>
                          {row.latestSpread.toFixed(1)}%
                        </div>
                        <div className="text-[10px]" style={{ color: '#949E9C' }}>
                          latest spread
                        </div>
                      </div>
                    </div>

                    <HistorySparkline buckets={row.buckets} />

                    <div className="grid grid-cols-3 gap-2 text-[10px] tabular-nums">
                      <Metric label="Avg Spread" value={`${row.avgSpread.toFixed(1)}%`} valueColor="#5fd8ee" />
                      <Metric label="Median" value={`${row.medianSpread.toFixed(1)}%`} />
                      <Metric label="Range" value={`${row.minSpread.toFixed(1)}%–${row.maxSpread.toFixed(1)}%`} />
                      <Metric label="Est. / day" value={fmtUsd(row.estDay)} valueColor={row.estDay >= 0 ? '#5fd8ee' : '#ED7088'} />
                      <Metric label={`Est. / ${selectedRange.label}`} value={fmtUsd(row.estRange)} valueColor={row.estRange >= 0 ? '#5fd8ee' : '#ED7088'} />
                      <Metric label="Est. / 30d" value={fmtUsd(row.estMonth)} valueColor={row.estMonth >= 0 ? '#5fd8ee' : '#ED7088'} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span style={{ color: '#5a6469' }}>{label}</span>
      <span className="font-mono text-white" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
    </div>
  );
}
