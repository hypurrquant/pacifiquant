'use client';

import { useMemo } from 'react';
import { useFearGreedHistory, type FearGreedPoint } from '../hooks/useMarketMacro';
import { NewsPanel } from './NewsPanel';

const SEGMENTS = [
  { from: 0,  to: 25, label: 'EXTREME FEAR',  color: '#ED7088' },
  { from: 25, to: 45, label: 'FEAR',          color: '#FF8A5B' },
  { from: 45, to: 55, label: 'NEUTRAL',       color: '#949E9C' },
  { from: 55, to: 75, label: 'GREED',         color: '#5fd8ee' },
  { from: 75, to: 100, label: 'EXTREME GREED',color: '#6EE7B7' },
];

function classify(v: number): { label: string; color: string } {
  for (const seg of SEGMENTS) {
    if (v >= seg.from && v <= seg.to) return { label: seg.label, color: seg.color };
  }
  return { label: '—', color: '#8F9BA4' };
}

// SVG half-donut geometry — arc spans 180° (left to right) across the top.
// The gauge is wide (viewBox 400 x 220) so the labels fit on each segment
// without overlapping the ticks below.
const CX = 200;
const CY = 200;
const R_OUTER = 180;
const R_INNER = 120;

function polar(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg - 180) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(from: number, to: number): string {
  // value 0..100 → angle 0..180 degrees (left=0, right=180)
  const a0 = (from / 100) * 180;
  const a1 = (to / 100) * 180;
  const p0 = polar(CX, CY, R_OUTER, a0);
  const p1 = polar(CX, CY, R_OUTER, a1);
  const p2 = polar(CX, CY, R_INNER, a1);
  const p3 = polar(CX, CY, R_INNER, a0);
  const largeArc = a1 - a0 > 180 ? 1 : 0;
  return [
    `M ${p0.x} ${p0.y}`,
    `A ${R_OUTER} ${R_OUTER} 0 ${largeArc} 1 ${p1.x} ${p1.y}`,
    `L ${p2.x} ${p2.y}`,
    `A ${R_INNER} ${R_INNER} 0 ${largeArc} 0 ${p3.x} ${p3.y}`,
    'Z',
  ].join(' ');
}

export function FearGreedGauge() {
  const { data: history = [], isLoading } = useFearGreedHistory();

  const snapshots = useMemo(() => {
    if (history.length === 0) return null;
    const byAge = (days: number): FearGreedPoint | null => {
      // alternative.me returns newest-first; offsets map directly to days
      return history[Math.min(days, history.length - 1)] ?? null;
    };
    return {
      current: history[0],
      prevClose: byAge(1),
      oneWeek: byAge(7),
      oneMonth: byAge(30),
      oneYear: byAge(365),
    };
  }, [history]);

  if (isLoading || !snapshots) {
    return (
      <div
        className="rounded-lg p-4 text-center text-xs"
        style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035', color: '#6B7580' }}
      >
        Loading Fear & Greed index...
      </div>
    );
  }

  const current = snapshots.current;
  const activeSeg = classify(current.value);
  // Needle angle — center of gauge is at (CX, CY), needle points from CY
  // up-left (when low) to up-right (when high). A small vertical offset
  // brings the pivot just below the arc's centreline so the tip sits
  // inside the colored band.
  const needleAngle = (current.value / 100) * 180;
  const needleTip = polar(CX, CY, R_OUTER - 16, needleAngle);

  return (
    <div
      className="rounded-lg p-3"
      style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}
    >
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-xs font-semibold text-white">Crypto Fear & Greed</h3>
        <span className="text-[9px]" style={{ color: '#6B7580' }}>
          via alternative.me
        </span>
      </div>

      <div className="flex flex-col md:flex-row gap-3 md:gap-4 items-center">
        {/* Gauge — capped width so the card stays compact on wide screens
            while remaining responsive on mobile. viewBox expanded to 260h
            so the big value number below the arc isn't clipped. */}
        <div className="relative w-full md:w-[260px] flex-shrink-0">
          <svg viewBox="0 0 400 260" className="w-full h-auto">
            {SEGMENTS.map((seg) => (
              <path
                key={seg.label}
                d={arcPath(seg.from, seg.to)}
                fill={seg.color}
                opacity={seg.color === activeSeg.color ? 1 : 0.55}
              />
            ))}
            {/* Labels on each arc — dark text on bright fills, kept at
                full opacity so all five zones read at a glance. */}
            {SEGMENTS.map((seg) => {
              const mid = (seg.from + seg.to) / 2;
              const angle = (mid / 100) * 180;
              const p = polar(CX, CY, (R_OUTER + R_INNER) / 2, angle);
              return (
                <text
                  key={seg.label + '-t'}
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="10"
                  fontWeight="700"
                  fill="#0B1018"
                  style={{ letterSpacing: '0.5px' }}
                >
                  {seg.label}
                </text>
              );
            })}
            {/* Tick marks 0/25/50/75/100 — brighter so they don't disappear
                against the gauge's dark canvas. */}
            {[0, 25, 50, 75, 100].map((v) => {
              const angle = (v / 100) * 180;
              const p = polar(CX, CY, R_INNER - 14, angle);
              return (
                <text
                  key={v}
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="11"
                  fontWeight="600"
                  fill="#C4CDD5"
                >
                  {v}
                </text>
              );
            })}
            {/* Needle — thicker + colored to match the active zone so the
                reading is unmistakable even with the arc fully saturated. */}
            <line
              x1={CX}
              y1={CY}
              x2={needleTip.x}
              y2={needleTip.y}
              stroke={activeSeg.color}
              strokeWidth="4"
              strokeLinecap="round"
            />
            <circle cx={CX} cy={CY} r="8" fill="#0F1A1F" stroke={activeSeg.color} strokeWidth="3" />
            {/* Value — colored to match the active zone for immediate
                read-at-a-glance sentiment. */}
            <text
              x={CX}
              y={CY + 40}
              textAnchor="middle"
              fontSize="34"
              fontWeight="800"
              fill={activeSeg.color}
            >
              {current.value}
            </text>
            <text
              x={CX}
              y={CY + 58}
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
              fill={activeSeg.color}
              style={{ letterSpacing: '0.8px' }}
            >
              {activeSeg.label}
            </text>
          </svg>
        </div>

        {/* Timeline comparisons */}
        <div
          className="flex flex-col gap-1.5 w-full md:w-[280px] flex-shrink-0 rounded-md p-3"
          style={{ backgroundColor: '#1B2429', border: '1px solid #273035' }}
        >
          <HistoryRow label="Previous close" point={snapshots.prevClose} />
          <HistoryRow label="1 week ago"     point={snapshots.oneWeek} />
          <HistoryRow label="1 month ago"    point={snapshots.oneMonth} />
          <HistoryRow label="1 year ago"     point={snapshots.oneYear} />
        </div>

        {/* Market news — fills the right-side whitespace on wide screens so
            the card becomes a single "market context" dashboard instead of
            leaving the desktop gap blank + a duplicate news card below. */}
        <div className="flex-1 min-w-0 w-full">
          <NewsPanel embedded maxItems={15} />
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ label, point }: { label: string; point: FearGreedPoint | null }) {
  if (!point) {
    return (
      <div className="flex items-center justify-between text-[11px]">
        <span style={{ color: '#8F9BA4' }}>{label}</span>
        <span style={{ color: '#6B7580' }}>—</span>
      </div>
    );
  }
  const cls = classify(point.value);
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span style={{ color: '#C4CDD5' }}>{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-semibold" style={{ color: cls.color }}>{point.classification}</span>
        <span
          className="tabular-nums font-bold px-2 py-0.5 rounded-full text-[11px]"
          style={{ color: cls.color, backgroundColor: `${cls.color}26`, border: `1.5px solid ${cls.color}66` }}
        >
          {point.value}
        </span>
      </div>
    </div>
  );
}
