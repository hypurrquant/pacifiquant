'use client';

/**
 * VaultCard — hero-style card for a single strategy vault.
 *
 * The Strategies page used to drop users straight into configuration forms
 * (DeltaNeutralCard / MarketMakingCard / …). That forced people to understand
 * every knob before deciding which strategy even fits their risk appetite.
 *
 * VaultCard inverts the flow: first you pick a product (risk tier → expected
 * APY → one CTA), then you fine-tune. It's the same UX pattern cross-chain
 * yield vaults (Yearn, Beefy, Morpho) use, adapted for our 4-DEX perp stack.
 */

import type { ReactNode } from 'react';

export type VaultRisk = 'low' | 'med' | 'high';

const RISK_META: Record<VaultRisk, { label: string; color: string; chip: string }> = {
  low: { label: 'LOW RISK', color: '#5fd8ee', chip: 'bg-[#5fd8ee]/10 text-[#5fd8ee]' },
  med: { label: 'MEDIUM',   color: '#FFA94D', chip: 'bg-[#FFA94D]/10 text-[#FFA94D]' },
  high: { label: 'HIGH',    color: '#ED7088', chip: 'bg-[#ED7088]/10 text-[#ED7088]' },
};

interface VaultCardProps {
  readonly title: string;
  readonly description: string;
  readonly risk: VaultRisk;
  /** "12.3%" or "Variable" — pre-formatted so the card stays presentational. */
  readonly apyLabel: string;
  /** Short caption under the APY number ("Top cross-DEX spread (APR)"). */
  readonly apySubtitle: string;
  /** Brand accent used on the header pill + CTA border. */
  readonly accent: string;
  /** Small icon or emoji in the header — purely decorative. */
  readonly icon: ReactNode;
  /** 2–3 secondary stats shown below the APY. */
  readonly stats: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  /** Whether the user has an agent wallet on at least one supported DEX. */
  readonly agentReady: boolean;
  readonly onConfigure: () => void;
}

export function VaultCard({
  title,
  description,
  risk,
  apyLabel,
  apySubtitle,
  accent,
  icon,
  stats,
  agentReady,
  onConfigure,
}: VaultCardProps) {
  const riskMeta = RISK_META[risk];

  return (
    <div
      className="rounded-lg flex flex-col overflow-hidden transition-all hover:border-[#3a4852]"
      style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}
    >
      {/* Accent ribbon — thin colored strip on top, a "vault card" visual convention. */}
      <div style={{ height: 3, backgroundColor: accent }} />

      <div className="p-5 flex flex-col gap-4">
        {/* Header: icon + title + risk chip */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${accent}14`, border: `1px solid ${accent}33` }}
            >
              <span className="text-base" style={{ color: accent }}>{icon}</span>
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white truncate">{title}</h3>
              <p className="text-[10px] mt-0.5 line-clamp-1" style={{ color: '#949E9C' }}>
                {description}
              </p>
            </div>
          </div>
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${riskMeta.chip} flex-shrink-0`}>
            {riskMeta.label}
          </span>
        </div>

        {/* APY hero */}
        <div>
          <div className="flex items-baseline gap-1.5">
            <span
              className="text-3xl font-semibold font-mono tabular-nums tracking-tight"
              style={{ color: accent }}
            >
              {apyLabel}
            </span>
            <span className="text-[10px]" style={{ color: '#5a6469' }}>est. APR</span>
          </div>
          <p className="text-[10px] mt-0.5" style={{ color: '#949E9C' }}>{apySubtitle}</p>
        </div>

        {/* Stats grid — 2 or 3 stats stacked responsively. */}
        {stats.length > 0 && (
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${stats.length}, 1fr)` }}>
            {stats.map(s => (
              <div
                key={s.label}
                className="rounded-md px-2.5 py-2"
                style={{ backgroundColor: '#1B2429', border: '1px solid #273035' }}
              >
                <div className="text-[9px] uppercase tracking-wide" style={{ color: '#949E9C' }}>
                  {s.label}
                </div>
                <div className="text-xs font-mono tabular-nums text-white mt-0.5 truncate">
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* CTA + agent readiness hint */}
        <button
          onClick={onConfigure}
          className="w-full py-2 rounded-md text-xs font-semibold transition-colors"
          style={{
            backgroundColor: agentReady ? accent : `${accent}22`,
            color: agentReady ? '#0F1A1E' : accent,
            border: `1px solid ${accent}`,
          }}
        >
          {agentReady ? 'Configure & Deploy' : 'Enable Trading to Deploy'}
        </button>
      </div>
    </div>
  );
}
