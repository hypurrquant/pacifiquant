'use client';

import { useEffect, useState } from 'react';
import { useFearGreedIndex, useEconomicCalendar, useMacroStress } from '../hooks/useMarketMacro';

function fgColor(v: number): string {
  if (v <= 25) return '#ED7088';
  if (v <= 45) return '#FFA94D';
  if (v <= 55) return '#8F9BA4';
  if (v <= 75) return '#6EE7B7';
  return '#5fd8ee';
}

function stressColor(score: number): string {
  if (score < 25) return '#6EE7B7';
  if (score < 50) return '#FFA94D';
  if (score < 75) return '#ED7088';
  return '#FF4D4D';
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now';
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export function MarketContextStrip() {
  const { data: fg } = useFearGreedIndex();
  const { data: events = [] } = useEconomicCalendar();
  const stress = useMacroStress(fg?.value ?? null);
  const nextEvent = events[0];
  const [now, setNow] = useState(Date.now());

  // 1-minute tick so the event countdown stays fresh without the whole
  // strip re-rendering on unrelated state changes.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="flex items-center flex-wrap gap-4 px-4 py-2.5 rounded-lg text-[11px]"
      style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}
    >
      {/* Fear & Greed */}
      {fg ? (
        <div className="flex items-center gap-2">
          <span style={{ color: '#8F9BA4' }}>Fear & Greed</span>
          <span
            className="font-semibold tabular-nums px-1.5 py-0.5 rounded"
            style={{ color: fgColor(fg.value), backgroundColor: `${fgColor(fg.value)}1A` }}
          >
            {fg.value} · {fg.classification}
          </span>
        </div>
      ) : (
        <div style={{ color: '#6B7580' }}>Fear & Greed —</div>
      )}

      {/* Next macro event */}
      {nextEvent ? (
        <div className="flex items-center gap-2">
          <span style={{ color: '#8F9BA4' }}>Next event</span>
          <span className="text-white font-medium">{nextEvent.label}</span>
          <span className="tabular-nums" style={{ color: nextEvent.kind === 'FOMC' || nextEvent.kind === 'CPI' ? '#FFA94D' : '#8F9BA4' }}>
            in {formatCountdown(nextEvent.occursAt - now)}
          </span>
          {(nextEvent.kind === 'FOMC' || nextEvent.kind === 'CPI') && (
            <span className="text-[9px] px-1 py-0.5 rounded" style={{ color: '#FFA94D', backgroundColor: 'rgba(255,169,77,0.1)' }}>
              high-vol
            </span>
          )}
        </div>
      ) : (
        <div style={{ color: '#6B7580' }}>No upcoming events</div>
      )}

      {/* Macro stress composite */}
      {stress ? (
        <div className="flex items-center gap-2">
          <span style={{ color: '#8F9BA4' }}>Macro stress</span>
          <span
            className="font-semibold tabular-nums px-1.5 py-0.5 rounded"
            style={{ color: stressColor(stress.score), backgroundColor: `${stressColor(stress.score)}1A` }}
          >
            {stress.score} · {stress.label}
          </span>
        </div>
      ) : null}
    </div>
  );
}
