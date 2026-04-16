'use client';

/**
 * VaultPicker — hero row of 3 strategy "vaults" (Stable Yield / Delta-Neutral
 * / Market Making).
 *
 * The idea: users shouldn't have to understand funding-rate arb, delta-neutral
 * construction, or Avellaneda-Stoikov to use this page. They should pick a
 * risk tier, see an APY estimate, and click once to go to the deploy surface.
 *
 * APY estimates are live, computed from the same `useCrossDexIntel` feed the
 * existing cards already consume — no extra network calls.
 *
 * Clicking "Configure & Deploy" scrolls the user to the matching existing
 * card (FundingArbScanner / DeltaNeutralCard / MarketMakingCard) which is
 * where the actual execution form lives.
 */

import { useMemo } from 'react';
import type { PerpMarket } from '@hq/core/defi/perp';
import { toHourlyRate, annualizeRate } from '@hq/core/defi/perp';
import type { FundingExchange } from '@hq/core/defi/perp';
import type { PerpDexId } from '@/domains/perp/types/perp.types';
import { useAgentWalletStore, selectIsAgentActive as selectHlAgentActive } from '@/domains/perp/stores/useAgentWalletStore';
import { usePacificaAgentStore, selectPacificaAgentActive } from '@/domains/perp/stores/usePacificaAgentStore';
import { useLighterAgentStore, selectLighterAgentActive } from '@/domains/perp/stores/useLighterAgentStore';
import { useAsterAgentStore, selectAsterAgentActive } from '@/domains/perp/stores/useAsterAgentStore';
import { VaultCard } from './VaultCard';

const FE_TO_FUNDING: Record<PerpDexId, FundingExchange> = {
  hyperliquid: 'hyperliquid',
  pacifica: 'pacifica',
  lighter: 'lighter',
  aster: 'aster',
};

export type StrategyVaultId = 'stable' | 'dn' | 'mm';

interface Props {
  readonly markets: ReadonlyArray<{ readonly dex: PerpDexId; readonly market: PerpMarket }>;
  /** Called when a vault's "Configure & Deploy" button is clicked. Dashboard
   *  uses this to lift into focus mode (hide the other vaults + their
   *  detail sections) so the chosen strategy is the sole surface. */
  readonly onSelect: (vault: StrategyVaultId) => void;
}

export function VaultPicker({ markets, onSelect }: Props) {
  // Aggregate agent readiness across the 4 DEX stores. A user is "ready to
  // deploy" on a given vault if they have an agent wallet on at least one
  // supporting DEX — the individual cards still enforce per-DEX gating.
  const hlActive = useAgentWalletStore(selectHlAgentActive);
  const pacActive = usePacificaAgentStore(selectPacificaAgentActive);
  const lightActive = useLighterAgentStore(selectLighterAgentActive);
  const astActive = useAsterAgentStore(selectAsterAgentActive);
  const anyAgentReady = hlActive || pacActive || lightActive || astActive;

  // ── APY estimates ────────────────────────────────────────────────────
  //
  // Stable Yield = top cross-DEX funding spread (annualized). This is the
  // same number FundingArbScanner surfaces but picked as the max across all
  // symbols with 2+ listings. We use `toHourlyRate` to normalize before
  // comparing because HL/Pacifica/Lighter/Aster quote on different intervals.
  //
  // Delta-Neutral = median absolute funding rate (annualized) across liquid
  // perps. A DN pair captures funding in one direction; median gives a
  // realistic "typical" expectation rather than cherry-picked extremes.
  //
  // Market Making = Variable. Real MM PnL depends on inventory risk + fill
  // rate + spread capture; there's no honest single number. We show the
  // median resting spread as a hint instead.
  const { stableApy, dnApy, topSymbolSpread } = useMemo(() => {
    if (markets.length === 0) {
      return { stableApy: 0, dnApy: 0, topSymbolSpread: null as null | { symbol: string; apy: number } };
    }

    // Stable — cross-DEX funding spread
    const bySymbol = new Map<string, Array<{ dex: PerpDexId; rate: number }>>();
    for (const { dex, market } of markets) {
      if (market.assetType !== 'perp') continue;
      if (!Number.isFinite(market.fundingRate)) continue;
      const key = market.baseAsset;
      const arr = bySymbol.get(key) ?? [];
      arr.push({ dex, rate: market.fundingRate });
      bySymbol.set(key, arr);
    }
    let bestSpread = 0;
    let bestSymbol: string | null = null;
    for (const [symbol, rows] of bySymbol) {
      if (rows.length < 2) continue;
      const hourly = rows.map(r => toHourlyRate(r.rate, FE_TO_FUNDING[r.dex]));
      hourly.sort((a, b) => a - b);
      const spreadHourly = hourly[hourly.length - 1] - hourly[0];
      const apr = annualizeRate(spreadHourly);
      if (apr > bestSpread) {
        bestSpread = apr;
        bestSymbol = symbol;
      }
    }

    // Delta-neutral — median |funding| across liquid perps, annualized
    const liquidFundings: number[] = [];
    for (const { dex, market } of markets) {
      if (market.assetType !== 'perp') continue;
      if (market.volume24h < 500_000) continue;
      const hourly = Math.abs(toHourlyRate(market.fundingRate, FE_TO_FUNDING[dex]));
      if (Number.isFinite(hourly)) liquidFundings.push(hourly);
    }
    liquidFundings.sort((a, b) => a - b);
    const medianHourly = liquidFundings.length > 0
      ? liquidFundings[Math.floor(liquidFundings.length / 2)]
      : 0;
    const dnApr = annualizeRate(medianHourly);

    return {
      stableApy: bestSpread,
      dnApy: dnApr,
      topSymbolSpread: bestSymbol ? { symbol: bestSymbol, apy: bestSpread } : null,
    };
  }, [markets]);

  // Count liquid perps for the DN "Universe" stat.
  const liquidPerpCount = useMemo(() => {
    let n = 0;
    for (const { market } of markets) {
      if (market.assetType === 'perp' && market.volume24h >= 500_000) n++;
    }
    return n;
  }, [markets]);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <VaultCard
        title="Stable Yield"
        description="Earn funding-rate spreads between DEXs"
        risk="low"
        accent="#5fd8ee"
        icon="◈"
        apyLabel={stableApy > 0 ? `${stableApy.toFixed(1)}%` : '—'}
        apySubtitle={topSymbolSpread
          ? `Top spread: ${topSymbolSpread.symbol} across 2+ DEXs`
          : 'Top cross-DEX funding spread'}
        stats={[
          { label: 'Top symbol', value: topSymbolSpread?.symbol ?? '—' },
          { label: 'DEXs', value: '4' },
          { label: 'Direction', value: 'Neutral' },
        ]}
        agentReady={anyAgentReady}
        onConfigure={() => onSelect('stable')}
      />
      <VaultCard
        title="Delta-Neutral"
        description="Long + short pair to collect funding"
        risk="med"
        accent="#FFA94D"
        icon="⇄"
        apyLabel={dnApy > 0 ? `${dnApy.toFixed(1)}%` : '—'}
        apySubtitle="Median |funding| across liquid perps (APR)"
        stats={[
          { label: 'Universe', value: `${liquidPerpCount} perps` },
          { label: 'Leverage', value: '1×' },
          { label: 'Exposure', value: 'Neutral' },
        ]}
        agentReady={anyAgentReady}
        onConfigure={() => onSelect('dn')}
      />
      <VaultCard
        title="Market Making"
        description="Avellaneda-Stoikov quotes on both sides"
        risk="high"
        accent="#ED7088"
        icon="◇"
        apyLabel="Variable"
        apySubtitle="Earn spread; inventory risk depends on flow"
        stats={[
          { label: 'Model', value: 'Dalen' },
          { label: 'Inventory', value: 'γ, κ, σ' },
          { label: 'Mode', value: 'Auto' },
        ]}
        agentReady={anyAgentReady}
        onConfigure={() => onSelect('mm')}
      />
    </div>
  );
}
