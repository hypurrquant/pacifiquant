'use client';

/**
 * StrategiesDashboard — Vault-picker layout for the Multi-DEX strategy hub.
 *
 * Two modes:
 *   - Browse (no selection) — shows all 3 vaults + all strategy surfaces.
 *   - Focus  (one vault chosen) — hides the non-selected vaults and their
 *     detail sections so the chosen strategy is the sole surface. A breadcrumb
 *     lets the user return to browse mode.
 */

import { useState } from 'react';
import { useAccountStore, selectActiveAddress } from '@/infra/auth/stores';
import { useMarkets } from '@/domains/perp/hooks/usePerpData';
import { PortfolioOverview } from './PortfolioOverview';
import { FundingRateChart } from './FundingRateChart';
import { FundingArbScanner } from './FundingArbScanner';
import { MarketMakingCard } from './MarketMakingCard';
import { DeltaNeutralCard } from './DeltaNeutralCard';
import { RebalanceCard } from './RebalanceCard';
import { BotStrategyCard } from './BotStrategyCard';
import { MarketIntelCard } from './MarketIntelCard';
import { VaultPicker, type StrategyVaultId } from './VaultPicker';
import { CollapsibleSection } from './CollapsibleSection';
import { AgentStatusStrip } from './AgentStatusStrip';
import { StrategyPostureCard } from './StrategyPostureCard';
import { useCrossDexIntel } from '../hooks/useCrossDexIntel';
import { useStrategyExchangeAccounts } from '../hooks/useStrategyExchangeAccounts';

const VAULT_LABELS: Record<StrategyVaultId, string> = {
  stable: 'Stable Yield',
  dn: 'Delta-Neutral',
  mm: 'Market Making',
};

const VAULT_ACCENTS: Record<StrategyVaultId, string> = {
  stable: '#5fd8ee',
  dn: '#FFA94D',
  mm: '#ED7088',
};

export function StrategiesDashboard() {
  const { data: markets = [] } = useMarkets();
  const perpMarkets = markets.filter(m => m.assetType === 'perp');
  const walletAddress = useAccountStore(selectActiveAddress);
  const accounts = useStrategyExchangeAccounts();
  const { data: intel } = useCrossDexIntel(accounts);
  const [selectedVault, setSelectedVault] = useState<StrategyVaultId | null>(null);

  const showStable = selectedVault === null || selectedVault === 'stable';
  const showDn     = selectedVault === null || selectedVault === 'dn';
  const showMm     = selectedVault === null || selectedVault === 'mm';

  return (
    <div className="min-h-[calc(100vh-4rem)] p-4 md:p-6" style={{ backgroundColor: '#0F1A1E' }}>
      <div className="max-w-[1600px] mx-auto space-y-6">
        {/* Page heading */}
        <div>
          <h1 className="text-xl font-semibold text-white">Strategies</h1>
          <p className="text-xs mt-1" style={{ color: '#949E9C' }}>
            Pick a vault by risk tier. Your agent wallet executes across 4 DEXs.
          </p>
        </div>

        {/* 1 — Portfolio (donut + sparklines) */}
        <PortfolioOverview walletAddress={walletAddress} />

        {/* 1b — Agent wallet status strip: shows per-DEX readiness with an
              inline "Enable" that opens the same modal as the Perp page,
              so DN/MM "Agent Wallet Required" CTAs resolve in place. */}
        <AgentStatusStrip />

        {/* 1c — Strategy posture: classifies net delta across all 4 DEXs +
              HL spot so the user can verify they're actually delta-neutral
              (or see where they're unbalanced). */}
        <StrategyPostureCard walletAddress={walletAddress} />

        {/* 2 — Vault selector: either the picker hero or a focus breadcrumb */}
        {selectedVault === null ? (
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-sm font-semibold text-white">Choose your strategy</h2>
              <span className="text-[10px]" style={{ color: '#5a6469' }}>
                APR estimates are live, from the same feeds the detail cards use
              </span>
            </div>
            <VaultPicker markets={intel?.markets ?? []} onSelect={setSelectedVault} />
          </div>
        ) : (
          <div
            className="flex items-center gap-3 rounded-lg px-4 py-3"
            style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}
          >
            <button
              onClick={() => setSelectedVault(null)}
              className="flex items-center gap-1.5 text-xs text-white px-2 py-1 rounded hover:bg-[#1a2830] transition-colors"
              style={{ border: '1px solid #273035' }}
            >
              <span aria-hidden>←</span>
              <span>All strategies</span>
            </button>
            <div className="flex items-center gap-2">
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                style={{ color: VAULT_ACCENTS[selectedVault], backgroundColor: `${VAULT_ACCENTS[selectedVault]}1A` }}
              >
                ACTIVE
              </span>
              <span className="text-sm font-semibold text-white">{VAULT_LABELS[selectedVault]}</span>
            </div>
          </div>
        )}

        {/* 3a — Stable Yield surface: funding scanner + market insights */}
        {showStable && (
          <>
            <CollapsibleSection
              title="Cross-DEX Funding Scanner"
              subtitle="Compare funding rates across HL, Pacifica, Lighter, Aster"
              badge="ARB"
              accent="#ED7088"
              defaultOpen
            >
              <FundingArbScanner />
            </CollapsibleSection>

            <CollapsibleSection
              title="Market Insights"
              subtitle="Funding trends, cross-DEX intel, news"
              badge="INSIGHTS"
              accent="#7DB4FF"
              defaultOpen={selectedVault === 'stable'}
            >
              <div className="p-4 grid gap-4 lg:grid-cols-2">
                <MarketIntelCard
                  markets={intel?.markets ?? []}
                  dexPositions={intel?.positions ?? []}
                />
                <FundingRateChart />
              </div>
            </CollapsibleSection>
          </>
        )}

        {/* 3b — Delta-Neutral & Market Making surfaces
              In browse mode, pair them in a 2-col grid; in focus mode,
              only the selected one renders full-width. */}
        {showDn && showMm ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <DeltaNeutralCard />
            <MarketMakingCard markets={perpMarkets} />
          </div>
        ) : (
          <>
            {showDn && <DeltaNeutralCard />}
            {showMm && <MarketMakingCard markets={perpMarkets} />}
          </>
        )}

        {/* 4 — Utilities (always visible) */}
        <div className="grid gap-4 lg:grid-cols-2">
          <RebalanceCard />
          <BotStrategyCard markets={perpMarkets} />
        </div>
      </div>
    </div>
  );
}
