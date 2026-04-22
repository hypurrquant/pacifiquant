'use client';

/**
 * VaultCard — strategy hero tile modeled on Pacifica's Vaults/Lakes grid.
 * Status pill on the left, APR pill on the right, title row, 2×2 stats,
 * single CTA. Accent colors per risk tier stay subtle so the palette matches
 * the Pacifica surface (soft purple + muted green).
 */

import type { ReactNode } from 'react';

export type VaultRisk = 'low' | 'med' | 'high';

const RISK_META: Record<VaultRisk, { label: string; chipColor: string; chipBg: string; chipBorder: string }> = {
  low:  { label: 'Low risk',    chipColor: '#6EE7B7', chipBg: 'rgba(110,231,183,0.08)', chipBorder: 'rgba(110,231,183,0.25)' },
  med:  { label: 'Medium risk', chipColor: '#FFD08A', chipBg: 'rgba(255,208,138,0.08)', chipBorder: 'rgba(255,208,138,0.25)' },
  high: { label: 'High risk',   chipColor: '#FFA3B4', chipBg: 'rgba(255,163,180,0.08)', chipBorder: 'rgba(255,163,180,0.25)' },
};

const PACIFICA_ACCENT = '#AB9FF2';

interface VaultCardProps {
  readonly title: string;
  readonly description: string;
  readonly risk: VaultRisk;
  readonly apyLabel: string;
  readonly apySubtitle: string;
  /** Retained for API compatibility with callers; visual accents are unified
   *  to the Pacifica purple and the risk chip. */
  readonly accent?: string;
  readonly icon: ReactNode;
  readonly stats: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly agentReady: boolean;
  readonly onConfigure: () => void;
}

export function VaultCard({
  title,
  description,
  risk,
  apyLabel,
  apySubtitle,
  icon,
  stats,
  agentReady,
  onConfigure,
}: VaultCardProps) {
  const rm = RISK_META[risk];
  const aprIsNumeric = /^[+-]?\d/.test(apyLabel);

  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-4 transition-colors"
      style={{
        backgroundColor: '#111820',
        border: '1px solid #1F2A33',
      }}
    >
      {/* Top pills row — lakes pattern: status pill left, APR pill right */}
      <div className="flex items-center justify-between">
        <span
          className="text-[10px] font-medium px-2 py-0.5 rounded-full"
          style={{ color: rm.chipColor, backgroundColor: rm.chipBg, border: `1px solid ${rm.chipBorder}` }}
        >
          {rm.label}
        </span>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{
            color: aprIsNumeric ? PACIFICA_ACCENT : '#949E9C',
            backgroundColor: aprIsNumeric ? 'rgba(171,159,242,0.1)' : 'rgba(148,158,156,0.08)',
            border: `1px solid ${aprIsNumeric ? 'rgba(171,159,242,0.3)' : 'rgba(148,158,156,0.2)'}`,
          }}
        >
          {aprIsNumeric ? `${apyLabel} APR` : apyLabel}
        </span>
      </div>

      {/* Title + icon */}
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: 'rgba(171,159,242,0.08)', border: '1px solid rgba(171,159,242,0.2)' }}
        >
          <span className="text-lg" style={{ color: PACIFICA_ACCENT }}>{icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-white leading-tight">{title}</h3>
          <p className="text-xs mt-1 leading-snug" style={{ color: '#8F9BA4' }}>
            {description}
          </p>
        </div>
      </div>

      {/* APR caption */}
      <p className="text-[11px]" style={{ color: '#6B7580' }}>{apySubtitle}</p>

      {/* Stats grid — Pacifica lakes uses a 2×2 icon+label+value grid */}
      {stats.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5">
              <span className="text-[10px]" style={{ color: '#6B7580' }}>{s.label}</span>
              <span className="text-xs text-white tabular-nums">{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* CTA — lakes uses outline buttons; we keep a single action per card */}
      <button
        onClick={onConfigure}
        className="w-full py-2 rounded-lg text-xs font-semibold transition-colors"
        style={{
          backgroundColor: agentReady ? PACIFICA_ACCENT : 'transparent',
          color: agentReady ? '#0B1018' : PACIFICA_ACCENT,
          border: `1px solid ${PACIFICA_ACCENT}${agentReady ? '' : '55'}`,
        }}
      >
        {agentReady ? 'Configure & Deploy' : 'Enable Trading to Deploy'}
      </button>
    </div>
  );
}
