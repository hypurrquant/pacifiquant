'use client';

/**
 * StrategyPostureCard — Cross-DEX exposure classifier.
 *
 * Aggregates perp positions (all 4 DEXs) + HL spot tokens into a net delta per
 * base asset, then classifies the account stance:
 *   - Delta-Neutral  — every asset's |delta| is a small fraction of equity.
 *   - Directional Long / Short — >70% of absolute gross exposure is long/short.
 *   - Mixed — otherwise.
 *
 * The classifier lives on Strategies (risk-aware surface) rather than Perp
 * (per-DEX execution) because the user's question is cross-venue: "am I
 * actually delta-neutral across my four exchanges or am I fooling myself?"
 */

import { useMemo } from 'react';
import type { PerpPosition, SpotBalance } from '@hq/core/defi/perp';
import type { PerpDexId } from '@/domains/perp/types/perp.types';
import { useCrossDexIntel } from '../hooks/useCrossDexIntel';
import { useStrategyExchangeAccounts } from '../hooks/useStrategyExchangeAccounts';
import { useSpotBalances } from '@/domains/perp/hooks/useHyperliquid';
import { PERP_DEX_META } from '@/shared/config/perp-dex-display';

interface Props {
  readonly walletAddress: string | null;
}

interface AssetRow {
  readonly symbol: string;
  readonly netDelta: number;       // in base units, signed
  readonly netDeltaUsd: number;    // |netDelta| * mark, signed
  readonly grossLongUsd: number;
  readonly grossShortUsd: number;
  readonly perLeg: ReadonlyArray<{ dex: PerpDexId | 'spot'; side: 'long' | 'short'; sizeUsd: number }>;
}

type Posture =
  | { kind: 'idle' }
  | { kind: 'neutral'; maxAbsDeltaPct: number }
  | { kind: 'long'; longShare: number }
  | { kind: 'short'; shortShare: number }
  | { kind: 'mixed' };

const NEUTRAL_THRESHOLD_PCT = 5;  // |net|/gross under 5% per asset → neutral
const DIRECTIONAL_THRESHOLD = 0.7; // 70% of gross one-way → directional

function classify(rows: readonly AssetRow[]): Posture {
  if (rows.length === 0) return { kind: 'idle' };

  const totalGrossLong = rows.reduce((s, r) => s + r.grossLongUsd, 0);
  const totalGrossShort = rows.reduce((s, r) => s + r.grossShortUsd, 0);
  const totalGross = totalGrossLong + totalGrossShort;
  if (totalGross === 0) return { kind: 'idle' };

  // Per-asset neutrality check — each asset's residual delta should be small
  // relative to that asset's gross exposure. A portfolio that's globally
  // balanced but each asset is wildly directional isn't "delta-neutral."
  let maxAbsDeltaPct = 0;
  for (const r of rows) {
    const assetGross = r.grossLongUsd + r.grossShortUsd;
    if (assetGross === 0) continue;
    const pct = Math.abs(r.netDeltaUsd) / assetGross * 100;
    if (pct > maxAbsDeltaPct) maxAbsDeltaPct = pct;
  }
  if (maxAbsDeltaPct < NEUTRAL_THRESHOLD_PCT) {
    return { kind: 'neutral', maxAbsDeltaPct };
  }

  const longShare = totalGrossLong / totalGross;
  const shortShare = totalGrossShort / totalGross;
  if (longShare >= DIRECTIONAL_THRESHOLD) return { kind: 'long', longShare };
  if (shortShare >= DIRECTIONAL_THRESHOLD) return { kind: 'short', shortShare };
  return { kind: 'mixed' };
}

function postureLabel(p: Posture): { title: string; accent: string; blurb: string } {
  switch (p.kind) {
    case 'idle':
      return { title: 'No open exposure', accent: '#5a6469', blurb: 'Open a position to see your cross-DEX stance.' };
    case 'neutral':
      return {
        title: 'Delta-Neutral',
        accent: '#5fd8ee',
        blurb: `Every asset's residual delta is under ${NEUTRAL_THRESHOLD_PCT}% of its gross size.`,
      };
    case 'long':
      return {
        title: 'Directional — Long',
        accent: '#FFA94D',
        blurb: `${(p.longShare * 100).toFixed(0)}% of gross notional is long. Funding + spot moves will hit you.`,
      };
    case 'short':
      return {
        title: 'Directional — Short',
        accent: '#FFA94D',
        blurb: `${(p.shortShare * 100).toFixed(0)}% of gross notional is short. Funding + spot moves will hit you.`,
      };
    case 'mixed':
      return {
        title: 'Mixed',
        accent: '#ED7088',
        blurb: 'Exposure is split but not balanced per asset — consider hedging the largest deltas.',
      };
  }
}

function fmtUsd(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function StrategyPostureCard({ walletAddress }: Props) {
  const accounts = useStrategyExchangeAccounts();
  const { data: intel } = useCrossDexIntel(accounts);
  const { data: spotBalances = [] } = useSpotBalances(accounts.hyperliquid);

  const assetRows: readonly AssetRow[] = useMemo(() => {
    if (!intel) return [];
    const bySymbol = new Map<string, {
      netDelta: number;
      netDeltaUsd: number;
      grossLongUsd: number;
      grossShortUsd: number;
      perLeg: Array<{ dex: PerpDexId | 'spot'; side: 'long' | 'short'; sizeUsd: number }>;
    }>();

    const ensure = (sym: string) => {
      let row = bySymbol.get(sym);
      if (!row) {
        row = { netDelta: 0, netDeltaUsd: 0, grossLongUsd: 0, grossShortUsd: 0, perLeg: [] };
        bySymbol.set(sym, row);
      }
      return row;
    };

    // Perp legs across all 4 DEXs
    for (const dp of intel.positions) {
      for (const pos of dp.positions as readonly PerpPosition[]) {
        const mark = pos.markPrice || pos.entryPrice;
        const signedSize = pos.side === 'long' ? pos.size : -pos.size;
        const sizeUsd = Math.abs(pos.size * mark);
        const row = ensure(pos.symbol);
        row.netDelta += signedSize;
        row.netDeltaUsd += signedSize * mark;
        if (pos.side === 'long') row.grossLongUsd += sizeUsd;
        else row.grossShortUsd += sizeUsd;
        row.perLeg.push({ dex: dp.dex, side: pos.side, sizeUsd });
      }
    }

    // HL spot legs (non-USDC, treated as spot-long exposure).
    // `entryNtl` is the USD value at entry; good enough for posture sizing.
    for (const b of spotBalances as readonly SpotBalance[]) {
      if (b.coin === 'USDC') continue;
      const qty = parseFloat(b.total);
      if (!Number.isFinite(qty) || qty === 0) continue;
      const entryNtl = parseFloat(b.entryNtl);
      if (!Number.isFinite(entryNtl) || entryNtl === 0) continue;
      const row = ensure(b.coin);
      row.netDelta += qty;
      row.netDeltaUsd += entryNtl;
      row.grossLongUsd += Math.abs(entryNtl);
      row.perLeg.push({ dex: 'spot', side: 'long', sizeUsd: Math.abs(entryNtl) });
    }

    return Array.from(bySymbol.entries())
      .map(([symbol, r]) => ({ symbol, ...r }))
      .sort((a, b) => Math.abs(b.netDeltaUsd) - Math.abs(a.netDeltaUsd));
  }, [intel, spotBalances]);

  const posture = useMemo(() => classify(assetRows), [assetRows]);
  const label = postureLabel(posture);

  const top = assetRows.slice(0, 4);

  return (
    <div className="rounded-lg p-4" style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Strategy Posture</h2>
          <p className="text-[10px] mt-0.5" style={{ color: '#949E9C' }}>
            Aggregated across HL / Pacifica / Lighter / Aster perps + HL spot
          </p>
        </div>
        <div
          className="text-[10px] font-semibold px-2 py-1 rounded tabular-nums"
          style={{ color: label.accent, backgroundColor: `${label.accent}1A` }}
        >
          {label.title.toUpperCase()}
        </div>
      </div>

      <p className="text-[11px] mb-3" style={{ color: '#949E9C' }}>{label.blurb}</p>

      {top.length === 0 ? (
        <p className="text-[11px] py-4 text-center" style={{ color: '#5a6469' }}>
          {walletAddress ? 'No positions or spot holdings yet.' : 'Connect wallet to analyze posture.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr style={{ borderBottom: '1px solid #273035' }}>
                <th className="text-left py-1 pr-3 font-medium" style={{ color: '#949E9C' }}>Asset</th>
                <th className="text-right py-1 pr-3 font-medium" style={{ color: '#949E9C' }}>Net Delta (USD)</th>
                <th className="text-right py-1 pr-3 font-medium" style={{ color: '#949E9C' }}>Gross Long</th>
                <th className="text-right py-1 pr-3 font-medium" style={{ color: '#949E9C' }}>Gross Short</th>
                <th className="text-left py-1 font-medium" style={{ color: '#949E9C' }}>Legs</th>
              </tr>
            </thead>
            <tbody>
              {top.map((r) => {
                const deltaColor = r.netDeltaUsd > 0 ? '#5fd8ee' : r.netDeltaUsd < 0 ? '#ED7088' : '#949E9C';
                return (
                  <tr key={r.symbol} style={{ borderBottom: '1px solid #1B2429' }}>
                    <td className="py-1 pr-3 text-white tabular-nums">{r.symbol}</td>
                    <td className="py-1 pr-3 text-right font-semibold tabular-nums" style={{ color: deltaColor }}>
                      {r.netDeltaUsd >= 0 ? '+' : ''}{fmtUsd(r.netDeltaUsd)}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums" style={{ color: '#5fd8ee' }}>{fmtUsd(r.grossLongUsd)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums" style={{ color: '#ED7088' }}>{fmtUsd(r.grossShortUsd)}</td>
                    <td className="py-1">
                      <div className="flex items-center gap-1 flex-wrap">
                        {r.perLeg.map((leg, i) => {
                          const logo = leg.dex === 'spot' ? null : PERP_DEX_META[leg.dex].logo;
                          const color = leg.side === 'long' ? '#5fd8ee' : '#ED7088';
                          return (
                            <span
                              key={`${r.symbol}-${leg.dex}-${i}`}
                              className="inline-flex items-center gap-0.5 px-1 rounded tabular-nums"
                              style={{ fontSize: 9, border: `1px solid ${color}33`, color }}
                            >
                              {logo ? (
                                <img src={logo} alt="" className="w-2.5 h-2.5 rounded-full" />
                              ) : (
                                <span style={{ color: '#949E9C' }}>S</span>
                              )}
                              <span>{leg.side === 'long' ? 'L' : 'S'}</span>
                              <span>{fmtUsd(leg.sizeUsd)}</span>
                            </span>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
