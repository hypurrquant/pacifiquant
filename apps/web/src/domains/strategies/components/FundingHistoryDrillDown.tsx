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

/**
 * Per-venue taker fees as percentage (0.045 = 0.045%). Numbers reflect each
 * venue's default public taker tier (doc sources cross-checked 2026-04) and
 * include the app's own builder/integrator cut where the adapter applies one.
 * A round-trip arb pays taker on BOTH legs twice (entry + exit), so the
 * fee_pct below is summed and multiplied by 4 inside `netAprAfterFees`.
 */
const DEX_TAKER_FEE_PCT: Record<PerpDexId, number> = {
  hyperliquid: 0.045 + 0.01, // 0.045% taker + 0.01% builder
  pacifica: 0.05 + 0.01,     // 0.05% taker + 0.01% builder
  lighter: 0.03 + 0.01,      // 0.03% taker + 0.01% integrator
  aster: 0.045,              // 0.045% taker
};

/** Hold period (days) used to amortize round-trip fees into an APR figure.
 *  7 days is the middle-of-the-road assumption: short enough to catch the
 *  "this is too expensive to arb for 1 day" signal, long enough not to
 *  trivialise fee drag for long-term carry. */
const NET_APR_HOLD_DAYS = 7;

function netAprAfterFees(grossApr: number, dexA: PerpDexId, dexB: PerpDexId): number {
  const roundTripFeePct = 2 * (DEX_TAKER_FEE_PCT[dexA] + DEX_TAKER_FEE_PCT[dexB]);
  return grossApr - (roundTripFeePct * 365) / NET_APR_HOLD_DAYS;
}

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
 * `{ ts, spreadApr }` plus persistence stats that answer "how long has
 * this spread actually held?" and the two DEX legs that generated the
 * median spread (needed for fee-adjusted APR).
 */
function computeCrossDexSpread(series: readonly DexFundingSeries[]): {
  points: Array<{ ts: number; spreadApr: number }>;
  stats: PersistenceStats | null;
  /** The two DEXs that produced the max-min spread at the median-ranked
   *  sample. Used to pick taker-fee levels for net-APR calculation. */
  legs: { hi: PerpDexId; lo: PerpDexId } | null;
} {
  const hourBuckets = new Map<number, Array<{ dex: PerpDexId; rate: number }>>();
  for (const s of series) {
    if (!s.hasPublicFeed || s.points.length === 0) continue;
    for (const p of s.points) {
      const hourMs = Math.floor(p.ts / 3_600_000) * 3_600_000;
      const arr = hourBuckets.get(hourMs) ?? [];
      arr.push({ dex: s.dex, rate: p.hourlyRate });
      hourBuckets.set(hourMs, arr);
    }
  }
  const points: Array<{ ts: number; spreadApr: number; hiDex: PerpDexId; loDex: PerpDexId }> = [];
  for (const [ts, rates] of hourBuckets) {
    if (rates.length < 2) continue;
    let hi = rates[0];
    let lo = rates[0];
    for (const r of rates) {
      if (r.rate > hi.rate) hi = r;
      if (r.rate < lo.rate) lo = r;
    }
    points.push({ ts, spreadApr: annualizeRate(hi.rate - lo.rate), hiDex: hi.dex, loDex: lo.dex });
  }
  points.sort((a, b) => a.ts - b.ts);
  if (points.length === 0) return { points: [], stats: null, legs: null };

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
  // Pick the legs from the point whose spread is closest to the median, so
  // the net-APR fee calc reflects the typical pairing users would actually
  // arb — not a one-off spike with an unusual DEX combination.
  const medianTarget = medianSpreadApr;
  let medianPoint = points[0];
  let bestDiff = Math.abs(points[0].spreadApr - medianTarget);
  for (const p of points) {
    const diff = Math.abs(p.spreadApr - medianTarget);
    if (diff < bestDiff) { medianPoint = p; bestDiff = diff; }
  }
  return {
    points: points.map(p => ({ ts: p.ts, spreadApr: p.spreadApr })),
    stats: {
      observedHours,
      stablePct,
      maxRunHours,
      medianSpreadApr,
      maxSpreadApr,
      slotsWithSpread: points.length,
    },
    legs: { hi: medianPoint.hiDex, lo: medianPoint.loDex },
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
  const { points: spreadPoints, stats: persistenceStats, legs: medianLegs } = useMemo(
    () => computeCrossDexSpread(series),
    [series],
  );

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
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
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
                label="Median"
                value={`${persistenceStats.medianSpreadApr >= 0 ? '+' : ''}${persistenceStats.medianSpreadApr.toFixed(1)}%`}
                sub={`APR gross · typical`}
                good={persistenceStats.medianSpreadApr >= SUSTAINED_THRESHOLD_APR}
              />
              <PersistenceStat
                label={`Net (${NET_APR_HOLD_DAYS}d hold)`}
                value={medianLegs
                  ? (() => {
                      const net = netAprAfterFees(persistenceStats.medianSpreadApr, medianLegs.hi, medianLegs.lo);
                      return `${net >= 0 ? '+' : ''}${net.toFixed(1)}%`;
                    })()
                  : '—'}
                sub={medianLegs
                  ? `after taker+builder on both legs`
                  : 'needs two DEXs with data'}
                good={medianLegs
                  ? netAprAfterFees(persistenceStats.medianSpreadApr, medianLegs.hi, medianLegs.lo) >= SUSTAINED_THRESHOLD_APR
                  : false}
              />
              <PersistenceStat
                label="Peak"
                value={`${persistenceStats.maxSpreadApr >= 0 ? '+' : ''}${persistenceStats.maxSpreadApr.toFixed(1)}%`}
                sub={`APR · window high over ${persistenceStats.observedHours.toFixed(0)}h`}
                good={false}
              />
            </div>
          )}

          {/* Cross-DEX spread timeline — bars colored green above threshold
              so a user can see at-a-glance if the edge has been continuous. */}
          {spreadPoints.length > 0 && (
            <SpreadOverlay points={spreadPoints} thresholdApr={SUSTAINED_THRESHOLD_APR} />
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

function SpreadOverlay({
  points,
  thresholdApr,
}: {
  points: Array<{ ts: number; spreadApr: number }>;
  thresholdApr: number;
}) {
  const width = 720;
  const height = 54;
  const padLeft = 40;
  const padRight = 16;
  const padTop = 6;
  const padBottom = 14;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const tsMin = points[0].ts;
  const tsMax = points[points.length - 1].ts + 3_600_000; // include the last hour's width
  const maxSpread = Math.max(thresholdApr * 1.2, ...points.map(p => p.spreadApr));
  const x = (ts: number) => padLeft + ((ts - tsMin) / Math.max(1, tsMax - tsMin)) * plotW;
  const y = (apr: number) => padTop + (1 - apr / maxSpread) * plotH;
  const barW = Math.max(2, plotW / points.length - 1);

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: '#6B7580' }}>
          Cross-DEX spread · hourly
        </span>
        <span className="text-[10px]" style={{ color: '#6B7580' }}>
          green = ≥{thresholdApr}% APR
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full h-[54px]">
        <line
          x1={padLeft}
          x2={padLeft + plotW}
          y1={y(thresholdApr)}
          y2={y(thresholdApr)}
          stroke="#273035"
          strokeDasharray="3 3"
        />
        <text x={padLeft - 4} y={y(thresholdApr) + 3} textAnchor="end" fontSize="8" fill="#6B7580">
          {thresholdApr}%
        </text>
        {points.map((p) => {
          const good = p.spreadApr >= thresholdApr;
          return (
            <rect
              key={p.ts}
              x={x(p.ts)}
              y={y(p.spreadApr)}
              width={barW}
              height={Math.max(1, plotH - (y(p.spreadApr) - padTop))}
              fill={good ? '#6EE7B7' : '#3a4852'}
              opacity={good ? 0.8 : 0.5}
            />
          );
        })}
      </svg>
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
