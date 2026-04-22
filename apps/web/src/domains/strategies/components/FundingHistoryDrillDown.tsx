'use client';

/**
 * FundingHistoryDrillDown — inline panel rendered under a scanner row when
 * the user wants to see whether a spread has been durable. Shows one line per
 * DEX over the last 24h of hourly funding rates plus a compact per-venue
 * stats block (last / min / max / avg).
 */

import { useMemo } from 'react';
import { annualizeRate } from '@hq/core/defi/perp';
import { useMarketFundingHistory, type DexFundingSeries } from '../hooks/useMarketFundingHistory';
import { PERP_DEX_META } from '@/shared/config/perp-dex-display';
import type { PerpDexId } from '@/domains/perp/types/perp.types';

/** Anything under this APR counts as "not an edge" for persistence stats. */
const SUSTAINED_THRESHOLD_APR = 10;

interface PersistenceStats {
  /** Hours the dataset actually covers. */
  readonly observedHours: number;
  /** % of hour slots where the cross-DEX spread was ≥ threshold APR. */
  readonly stablePct: number;
  /** Longest consecutive hour run above threshold (in hours). */
  readonly maxRunHours: number;
  /** Median spread across all slots, annualized %. */
  readonly medianSpreadApr: number;
  /** Peak spread across the window, annualized %. */
  readonly maxSpreadApr: number;
  /** How many hour slots we had ≥ 2 DEXs reporting to compute a spread. */
  readonly slotsWithSpread: number;
}

/**
 * Bucket each series by hour (UTC floor) and, for every hour where we have
 * data on ≥ 2 DEXs, compute spread = max-min. Returns the sequence of
 * `{ tsHourStart, spreadApr }` plus persistence stats that answer
 * "how long has this spread actually held?".
 */
function computeCrossDexSpread(series: readonly DexFundingSeries[]): {
  points: Array<{ ts: number; spreadApr: number }>;
  stats: PersistenceStats | null;
} {
  const hourBuckets = new Map<number, number[]>();
  for (const s of series) {
    if (!s.hasPublicFeed || s.points.length === 0) continue;
    for (const p of s.points) {
      const hourMs = Math.floor(p.ts / 3_600_000) * 3_600_000;
      const arr = hourBuckets.get(hourMs) ?? [];
      arr.push(p.hourlyRate);
      hourBuckets.set(hourMs, arr);
    }
  }
  const points: Array<{ ts: number; spreadApr: number }> = [];
  for (const [ts, rates] of hourBuckets) {
    if (rates.length < 2) continue;
    const hi = Math.max(...rates);
    const lo = Math.min(...rates);
    points.push({ ts, spreadApr: annualizeRate(hi - lo) });
  }
  points.sort((a, b) => a.ts - b.ts);
  if (points.length === 0) return { points, stats: null };

  const sorted = [...points].map(p => p.spreadApr).sort((a, b) => a - b);
  const medianSpreadApr = sorted[Math.floor(sorted.length / 2)];
  const maxSpreadApr = sorted[sorted.length - 1];
  const above = points.filter(p => p.spreadApr >= SUSTAINED_THRESHOLD_APR);
  const stablePct = (above.length / points.length) * 100;
  let maxRunHours = 0;
  let runStart: number | null = null;
  for (let i = 0; i < points.length; i++) {
    if (points[i].spreadApr >= SUSTAINED_THRESHOLD_APR) {
      if (runStart === null) runStart = points[i].ts;
      const runHours = (points[i].ts - runStart) / 3_600_000 + 1;
      if (runHours > maxRunHours) maxRunHours = runHours;
    } else {
      runStart = null;
    }
  }
  const observedHours = (points[points.length - 1].ts - points[0].ts) / 3_600_000 + 1;
  return {
    points,
    stats: {
      observedHours,
      stablePct,
      maxRunHours,
      medianSpreadApr,
      maxSpreadApr,
      slotsWithSpread: points.length,
    },
  };
}

interface Props {
  readonly symbol: string;
  readonly onClose: () => void;
}

interface DexStats {
  readonly last: number | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly avg: number | null;
}

function computeStats(series: DexFundingSeries): DexStats {
  if (series.points.length === 0) {
    return { last: null, min: null, max: null, avg: null };
  }
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const p of series.points) {
    if (p.hourlyRate < min) min = p.hourlyRate;
    if (p.hourlyRate > max) max = p.hourlyRate;
    sum += p.hourlyRate;
  }
  return {
    last: series.points[series.points.length - 1].hourlyRate,
    min,
    max,
    avg: sum / series.points.length,
  };
}

export function FundingHistoryDrillDown({ symbol, onClose }: Props) {
  const { data, isLoading, error } = useMarketFundingHistory(symbol);
  const series = useMemo<readonly DexFundingSeries[]>(() => data ?? [], [data]);
  const { stats: persistenceStats } = useMemo(() => computeCrossDexSpread(series), [series]);

  const { tsMin, tsMax, rateMin, rateMax } = useMemo(() => {
    let tsMin = Infinity;
    let tsMax = -Infinity;
    let rateMin = Infinity;
    let rateMax = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        if (p.ts < tsMin) tsMin = p.ts;
        if (p.ts > tsMax) tsMax = p.ts;
        if (p.hourlyRate < rateMin) rateMin = p.hourlyRate;
        if (p.hourlyRate > rateMax) rateMax = p.hourlyRate;
      }
    }
    if (!Number.isFinite(tsMin)) {
      tsMin = Date.now() - 24 * 60 * 60 * 1000;
      tsMax = Date.now();
    }
    if (!Number.isFinite(rateMin)) { rateMin = 0; rateMax = 0; }
    if (rateMin === rateMax) { rateMin -= 0.0001; rateMax += 0.0001; }
    return { tsMin, tsMax, rateMin, rateMax };
  }, [series]);

  const width = 720;
  const height = 160;
  const padLeft = 40;
  const padRight = 16;
  const padTop = 12;
  const padBottom = 20;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const x = (ts: number) => padLeft + ((ts - tsMin) / Math.max(1, tsMax - tsMin)) * plotW;
  const y = (rate: number) => padTop + (1 - (rate - rateMin) / Math.max(1e-9, rateMax - rateMin)) * plotH;

  return (
    <div
      className="px-4 py-3"
      style={{ backgroundColor: '#0B141A', borderTop: '1px solid #273035', borderBottom: '1px solid #273035' }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold tracking-wider uppercase" style={{ color: '#949E9C' }}>
          {symbol}-PERP · last 24h hourly funding (per DEX)
        </span>
        <button
          onClick={onClose}
          className="text-[10px] px-2 py-0.5 rounded hover:bg-[#1a2830]"
          style={{ color: '#8F9BA4', border: '1px solid #273035' }}
        >
          Close
        </button>
      </div>

      {isLoading && (
        <div className="text-[11px] py-3 text-center" style={{ color: '#6B7580' }}>Loading…</div>
      )}
      {error && (
        <div className="text-[11px] py-3 text-center" style={{ color: '#ED7088' }}>
          Failed to load funding history.
        </div>
      )}

      {!isLoading && !error && (
        <>
          {/* Persistence headline — directly answers "has this spread held?" */}
          {persistenceStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              <PersistenceStat
                label="Sustained"
                value={`${persistenceStats.maxRunHours.toFixed(1)}h`}
                sub={`longest run ≥${SUSTAINED_THRESHOLD_APR}% APR`}
                good={persistenceStats.maxRunHours >= 1}
              />
              <PersistenceStat
                label="Stable %"
                value={`${persistenceStats.stablePct.toFixed(0)}%`}
                sub={`of ${persistenceStats.slotsWithSpread} hourly samples`}
                good={persistenceStats.stablePct >= 50}
              />
              <PersistenceStat
                label="Median spread"
                value={`${persistenceStats.medianSpreadApr >= 0 ? '+' : ''}${persistenceStats.medianSpreadApr.toFixed(1)}%`}
                sub={`APR · typical level`}
                good={persistenceStats.medianSpreadApr >= SUSTAINED_THRESHOLD_APR}
              />
              <PersistenceStat
                label="Peak"
                value={`${persistenceStats.maxSpreadApr >= 0 ? '+' : ''}${persistenceStats.maxSpreadApr.toFixed(1)}%`}
                sub={`APR · window high over ${persistenceStats.observedHours.toFixed(0)}h`}
                good={false}
              />
            </div>
          )}

          {/* Chart */}
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            className="w-full h-[160px]"
            style={{ color: '#273035' }}
          >
            {/* Zero line */}
            {rateMin < 0 && rateMax > 0 && (
              <line
                x1={padLeft}
                x2={padLeft + plotW}
                y1={y(0)}
                y2={y(0)}
                stroke="#273035"
                strokeDasharray="3 3"
              />
            )}
            {/* Axis labels */}
            <text x={padLeft - 4} y={padTop + 6} textAnchor="end" fontSize="9" fill="#6B7580">
              {(rateMax * 100).toFixed(3)}%
            </text>
            <text x={padLeft - 4} y={padTop + plotH} textAnchor="end" fontSize="9" fill="#6B7580">
              {(rateMin * 100).toFixed(3)}%
            </text>

            {series.map((s) => {
              if (!s.hasPublicFeed || s.points.length === 0) return null;
              const meta = PERP_DEX_META[s.dex];
              const points = s.points.map((p) => `${x(p.ts).toFixed(2)},${y(p.hourlyRate).toFixed(2)}`).join(' ');
              return (
                <polyline
                  key={s.dex}
                  points={points}
                  fill="none"
                  stroke={meta.color}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              );
            })}
          </svg>

          {/* Per-DEX stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
            {series.map((s) => {
              const meta = PERP_DEX_META[s.dex];
              const stats = computeStats(s);
              return <DexStatsCard key={s.dex} dex={s.dex} color={meta.color} name={meta.name} series={s} stats={stats} />;
            })}
          </div>
        </>
      )}
    </div>
  );
}

function PersistenceStat({
  label,
  value,
  sub,
  good,
}: {
  label: string;
  value: string;
  sub: string;
  good: boolean;
}) {
  return (
    <div
      className="rounded-md px-3 py-2"
      style={{ backgroundColor: '#0F1A1F', border: '1px solid #1F2A33' }}
    >
      <div className="text-[10px] uppercase tracking-wider" style={{ color: '#6B7580' }}>{label}</div>
      <div className="text-base font-semibold tabular-nums mt-0.5" style={{ color: good ? '#6EE7B7' : '#AB9FF2' }}>
        {value}
      </div>
      <div className="text-[10px] leading-snug" style={{ color: '#6B7580' }}>{sub}</div>
    </div>
  );
}

function DexStatsCard({
  dex,
  color,
  name,
  series,
  stats,
}: {
  dex: PerpDexId;
  color: string;
  name: string;
  series: DexFundingSeries;
  stats: DexStats;
}) {
  const fmt = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(4)}%`);
  return (
    <div
      className="rounded-md px-3 py-2"
      style={{ backgroundColor: '#0F1A1F', border: '1px solid #1F2A33' }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[10px] font-medium" style={{ color }}>{name}</span>
      </div>
      {!series.hasPublicFeed ? (
        <p className="text-[10px]" style={{ color: '#6B7580' }}>
          No public feed — {dex} does not publish historical funding rates.
        </p>
      ) : series.error ? (
        <p className="text-[10px]" style={{ color: '#FFA94D' }}>{series.error}</p>
      ) : series.points.length === 0 ? (
        <p className="text-[10px]" style={{ color: '#6B7580' }}>No data in window.</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] tabular-nums">
          <span style={{ color: '#6B7580' }}>Last</span>
          <span className="text-right text-white">{fmt(stats.last)}</span>
          <span style={{ color: '#6B7580' }}>Avg</span>
          <span className="text-right text-white">{fmt(stats.avg)}</span>
          <span style={{ color: '#6B7580' }}>Min</span>
          <span className="text-right text-white">{fmt(stats.min)}</span>
          <span style={{ color: '#6B7580' }}>Max</span>
          <span className="text-right text-white">{fmt(stats.max)}</span>
        </div>
      )}
    </div>
  );
}
