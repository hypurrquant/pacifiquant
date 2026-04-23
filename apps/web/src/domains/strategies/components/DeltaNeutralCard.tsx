'use client';

/**
 * Delta-Neutral — long spot on Hyperliquid, short perp on Pacifica.
 */

import { useEffect, useMemo, useState } from 'react';
import type { PerpDexId } from '@/domains/perp/types/perp.types';
import { HyperliquidPerpAdapter, type PerpMarket, annualizeRate, toHourlyRate } from '@hq/core/defi/perp';
import { usePerpDeps } from '@/domains/perp/providers/PerpDepsProvider';
import { getAdapterByDex } from '@/domains/perp/hooks/usePerpAdapter';
import { useAgentWalletStore, selectIsAgentActive as selectHlAgentActive } from '@/domains/perp/stores/useAgentWalletStore';
import { usePacificaAgentStore, selectPacificaAgentActive } from '@/domains/perp/stores/usePacificaAgentStore';
import { useStrategyExchangeAccounts } from '../hooks/useStrategyExchangeAccounts';
import { getHyperliquidUsdcSummary } from '../utils/hyperliquidUsdcSummary';

const SPOT_DEX: PerpDexId = 'hyperliquid';
const PERP_DEX: PerpDexId = 'pacifica';

const VENUE_BADGES: ReadonlyArray<{ id: PerpDexId; label: string; color: string }> = [
  { id: SPOT_DEX, label: 'Spot · Hyperliquid', color: '#5fd8ee' },
  { id: PERP_DEX, label: 'Perp · Pacifica', color: '#AB84FF' },
];

interface SharedAssetMarket {
  readonly baseAsset: string;
  readonly spot: PerpMarket;
  readonly perp: PerpMarket;
}

interface DeltaNeutralBalanceState {
  readonly hyperliquidSpotUsd: number;
  readonly hyperliquidUnifiedUsd: number;
  readonly pacificaPerpUsd: number;
  readonly maxExecutableUsd: number | null;
}

const EMPTY_BALANCE_STATE: DeltaNeutralBalanceState = {
  hyperliquidSpotUsd: 0,
  hyperliquidUnifiedUsd: 0,
  pacificaPerpUsd: 0,
  maxExecutableUsd: null,
};

function stepDecimals(step: number): number {
  if (!(step > 0)) return 0;
  const normalized = step.toString().toLowerCase();
  if (normalized.includes('e-')) {
    const [, exponent] = normalized.split('e-');
    return Number(exponent);
  }
  const dotIndex = normalized.indexOf('.');
  return dotIndex === -1 ? 0 : normalized.length - dotIndex - 1;
}

function floorToStep(value: number, step: number): number {
  if (!(step > 0)) return value;
  return Number((Math.floor(value / step) * step).toFixed(stepDecimals(step)));
}

function fmtUsd(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatUsdInput(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, '');
}

function clampUsdInput(rawValue: string, maxUsd: number | null): string {
  if (rawValue === '') return rawValue;
  const parsed = parseFloat(rawValue);
  if (!Number.isFinite(parsed)) return rawValue;
  if (maxUsd === null) return rawValue;
  const capped = Math.max(0, Math.min(parsed, maxUsd));
  return formatUsdInput(capped);
}

export function DeltaNeutralCard() {
  const deps = usePerpDeps();
  const accounts = useStrategyExchangeAccounts();
  const hlActive = useAgentWalletStore(selectHlAgentActive);
  const pacActive = usePacificaAgentStore(selectPacificaAgentActive);
  const [sharedMarkets, setSharedMarkets] = useState<readonly SharedAssetMarket[]>([]);
  const [isLoadingMarkets, setIsLoadingMarkets] = useState(true);
  const [asset, setAsset] = useState('BTC');
  const [notional, setNotional] = useState('1000');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [balanceState, setBalanceState] = useState<DeltaNeutralBalanceState>(EMPTY_BALANCE_STATE);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);

  const spotAdapter = getAdapterByDex(SPOT_DEX) as HyperliquidPerpAdapter;
  const perpAdapter = getAdapterByDex(PERP_DEX);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingMarkets(true);

    Promise.all([
      spotAdapter.getMarkets(),
      perpAdapter.getMarkets(),
    ])
      .then(([spotMarkets, perpMarkets]) => {
        if (cancelled) return;

        const spotByBase = new Map<string, PerpMarket>();
        for (const market of spotMarkets) {
          if (market.assetType !== 'spot') continue;
          if (market.quoteAsset !== 'USDC') continue;
          if (market.volume24h < 100_000) continue;
          spotByBase.set(market.baseAsset, market);
        }

        const joined: SharedAssetMarket[] = [];
        for (const market of perpMarkets) {
          if (market.assetType !== 'perp') continue;
          if (market.volume24h < 100_000) continue;
          const spot = spotByBase.get(market.baseAsset);
          if (!spot) continue;
          joined.push({
            baseAsset: market.baseAsset,
            spot,
            perp: market,
          });
        }

        joined.sort((left, right) => right.perp.volume24h - left.perp.volume24h);
        setSharedMarkets(joined);
        setAsset((current) => {
          if (joined.some((entry) => entry.baseAsset === current)) return current;
          return joined[0]?.baseAsset ?? '';
        });
      })
      .catch(() => {
        if (cancelled) return;
        setSharedMarkets([]);
        setAsset('');
      })
      .finally(() => {
        if (!cancelled) setIsLoadingMarkets(false);
      });

    return () => {
      cancelled = true;
    };
  }, [spotAdapter, perpAdapter]);

  useEffect(() => {
    let cancelled = false;

    if (!hlActive || !pacActive || accounts.hyperliquid === null || accounts.pacifica === null) {
      setBalanceState(EMPTY_BALANCE_STATE);
      setIsLoadingBalances(false);
      return;
    }

    setIsLoadingBalances(true);

    Promise.all([
      Promise.all([
        spotAdapter.getAccountState(accounts.hyperliquid),
        spotAdapter.getSpotBalances(accounts.hyperliquid),
      ]),
      perpAdapter.getAccountState(accounts.pacifica),
    ])
      .then(([[hyperliquidAccountState, hyperliquidSpotBalances], pacificaAccountState]) => {
        if (cancelled) return;
        const hyperliquidUsdc = getHyperliquidUsdcSummary(hyperliquidAccountState, hyperliquidSpotBalances);
        const pacificaPerpUsd = Math.max(0, pacificaAccountState.availableBalance);
        const hyperliquidSpotUsd = Math.max(0, hyperliquidUsdc.spotUsdcAvailable);
        setBalanceState({
          hyperliquidSpotUsd,
          hyperliquidUnifiedUsd: Math.max(0, hyperliquidUsdc.availableUsd),
          pacificaPerpUsd,
          maxExecutableUsd: Math.min(hyperliquidSpotUsd, pacificaPerpUsd),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setBalanceState(EMPTY_BALANCE_STATE);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBalances(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accounts.hyperliquid, accounts.pacifica, balanceRefreshKey, hlActive, pacActive, perpAdapter, spotAdapter]);

  useEffect(() => {
    if (balanceState.maxExecutableUsd === null) return;
    setNotional((current) => clampUsdInput(current, balanceState.maxExecutableUsd));
  }, [balanceState.maxExecutableUsd]);

  const selected = useMemo(
    () => sharedMarkets.find((entry) => entry.baseAsset === asset) ?? null,
    [sharedMarkets, asset],
  );
  const notionalNum = parseFloat(notional) || 0;
  const spotMarket = selected?.spot ?? null;
  const perpMarket = selected?.perp ?? null;

  const pacificaDailyFundingRatePct = useMemo(() => {
    if (!perpMarket) return 0;
    return toHourlyRate(perpMarket.fundingRate, 'pacifica') * 24 * 100;
  }, [perpMarket]);

  const pacificaAnnualFundingRatePct = useMemo(() => {
    if (!perpMarket) return 0;
    return annualizeRate(toHourlyRate(perpMarket.fundingRate, 'pacifica'));
  }, [perpMarket]);

  const expectedDailyFunding = useMemo(() => {
    if (!perpMarket || !(notionalNum > 0)) return 0;
    return toHourlyRate(perpMarket.fundingRate, 'pacifica') * 24 * notionalNum;
  }, [perpMarket, notionalNum]);

  const expectedMonthlyFunding = expectedDailyFunding * 30;

  // Round-trip cost: HL spot taker (~0.035%) + Pacifica perp taker + builder
  // (~0.06%), entry + exit on both legs. Users comparing gross APR to this
  // card used to miss that the first month's funding barely breaks even on
  // fees for mid-notional positions.
  const roundTripFeePct = 2 * (0.035 + 0.06) / 100; // = 0.0019 (0.19%)
  const roundTripFeeUsd = notionalNum > 0 ? notionalNum * roundTripFeePct : 0;
  const breakevenDays = (() => {
    if (!(notionalNum > 0) || expectedDailyFunding <= 0) return null;
    return roundTripFeeUsd / expectedDailyFunding;
  })();
  const needsBothAgents = !hlActive || !pacActive;
  const maxExecutableUsd = balanceState.maxExecutableUsd;

  const handleOpen = async () => {
    if (needsBothAgents) {
      deps.showToast({
        title: 'Enable Hyperliquid and Pacifica first',
        message: 'This strategy opens spot on Hyperliquid and the hedge on Pacifica.',
        type: 'warning',
      });
      return;
    }
    if (!(notionalNum > 0)) {
      deps.showToast({ title: 'Notional must be greater than 0', type: 'warning' });
      return;
    }
    if (maxExecutableUsd !== null && !(maxExecutableUsd > 0)) {
      deps.showToast({
        title: 'Insufficient balance',
        message: 'Add spot USDC on Hyperliquid and available margin on Pacifica first.',
        type: 'warning',
      });
      return;
    }
    if (maxExecutableUsd !== null && notionalNum > maxExecutableUsd) {
      deps.showToast({
        title: 'Notional exceeds executable size',
        message: `Current balance cap is ${fmtUsd(maxExecutableUsd)} across Hyperliquid spot and Pacifica perp.`,
        type: 'warning',
      });
      return;
    }
    if (!spotMarket || !perpMarket) {
      deps.showToast({ title: 'Market data unavailable', type: 'warning' });
      return;
    }

    const spotSize = floorToStep(notionalNum / spotMarket.markPrice, spotMarket.lotSize);
    const perpSize = floorToStep(notionalNum / perpMarket.markPrice, perpMarket.lotSize);

    if (!(spotSize > 0) || !(perpSize > 0)) {
      deps.showToast({
        title: 'Size too small',
        message: 'Increase notional to clear both venue lot sizes.',
        type: 'warning',
      });
      return;
    }
    if (spotSize < spotMarket.minOrderSize || perpSize < perpMarket.minOrderSize) {
      deps.showToast({
        title: 'Below venue minimum',
        message: 'Increase notional so both spot and perp legs clear the venue minimum.',
        type: 'warning',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const signFn = deps.getSignFn();
      const hlVaultAddress = deps.getVaultAddress() ?? undefined;

      const spotResult = await spotAdapter.placeOrder(
        {
          symbol: spotMarket.symbol,
          side: 'long',
          type: 'market',
          size: spotSize,
          leverage: 1,
          price: spotMarket.markPrice,
          slippageBps: 50,
          vaultAddress: hlVaultAddress,
        },
        signFn,
      );

      if (!spotResult.success) {
        deps.showToast({
          title: 'Spot leg failed',
          message: spotResult.error ?? 'Unknown error',
          type: 'warning',
        });
        return;
      }

      const perpResult = await perpAdapter.placeOrder(
        {
          symbol: perpMarket.symbol,
          side: 'short',
          type: 'market',
          size: perpSize,
          leverage: 1,
          price: perpMarket.markPrice,
          slippageBps: 50,
        },
        signFn,
      );

      if (!perpResult.success) {
        deps.showToast({
          title: 'Perp leg failed',
          message: perpResult.error ?? 'Unknown error',
          type: 'warning',
        });
        return;
      }

      deps.showToast({
        title: `Delta-neutral opened: ${asset}`,
        message: `Long spot on Hyperliquid, short perp on Pacifica for ${fmtUsd(notionalNum)} notional.`,
        type: 'success',
      });
      setBalanceRefreshKey((current) => current + 1);
    } catch (error) {
      deps.showToast({
        title: 'Order error',
        message: error instanceof Error ? error.message : 'Unexpected error',
        type: 'warning',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg flex flex-col" style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}>
      <div className="px-4 py-3" style={{ borderBottom: '1px solid #273035' }}>
        <div className="flex items-center gap-2">
          <span className="text-xs px-1.5 py-0.5 rounded text-[#FFA94D] bg-[#FFA94D]/10">DN</span>
          <h2 className="text-sm font-semibold text-white">Delta Neutral</h2>
        </div>
        <p className="text-xs mt-1" style={{ color: '#949E9C' }}>
          Long spot on Hyperliquid, short perp on Pacifica to collect Pacifica funding.
        </p>
      </div>

      {needsBothAgents && (
        <div className="mx-4 mt-3 px-3 py-2.5 rounded-md text-xs" style={{ backgroundColor: '#FFA94D14', border: '1px solid #FFA94D40', color: '#FFA94D' }}>
          Agent Wallet Required — Enable Trading for Hyperliquid and Pacifica in the Perp page
        </div>
      )}

      <div className="p-4 flex flex-col gap-3">
        <Field label="Venue Split">
          <div className="grid gap-2 sm:grid-cols-2">
            {VENUE_BADGES.map((venue) => (
              <div
                key={venue.id}
                className="rounded-md px-3 py-2 text-[11px] font-medium"
                style={{ border: `1px solid ${venue.color}40`, backgroundColor: `${venue.color}14`, color: venue.color }}
              >
                {venue.label}
              </div>
            ))}
          </div>
        </Field>

        <Field label="Asset">
          {isLoadingMarkets ? (
            <div className="rounded px-2 py-1.5 text-xs" style={{ border: '1px solid #273035', backgroundColor: '#1B2429', color: '#949E9C' }}>
              Loading shared spot/perp markets...
            </div>
          ) : (
            <select
              value={asset}
              onChange={(event) => setAsset(event.target.value)}
              className="w-full bg-transparent text-xs text-white rounded px-2 py-1.5 focus:outline-none"
              style={{ border: '1px solid #273035', backgroundColor: '#1B2429' }}
            >
              {sharedMarkets.map((entry) => (
                <option key={entry.baseAsset} value={entry.baseAsset} style={{ backgroundColor: '#0F1A1F' }}>
                  {entry.baseAsset}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label="Notional (USDC)">
          <div className="flex flex-col gap-2">
            <input
              type="number"
              value={notional}
              onChange={(event) => setNotional(clampUsdInput(event.target.value, maxExecutableUsd))}
              className="w-full bg-transparent text-xs text-white font-mono tabular-nums rounded px-2 py-1.5 focus:outline-none"
              style={{ border: '1px solid #273035', backgroundColor: '#1B2429' }}
              min={0}
              step={0.01}
            />
            <div className="rounded-md px-2.5 py-2 text-[10px]" style={{ border: '1px solid #273035', backgroundColor: '#1B2429', color: '#949E9C' }}>
              {isLoadingBalances ? (
                <span>Loading venue balances...</span>
              ) : (
                <div className="flex flex-col gap-1">
                  <span>
                    Max executable now{' '}
                    <span className="font-mono text-white">{maxExecutableUsd !== null ? fmtUsd(maxExecutableUsd) : '—'}</span>
                  </span>
                  <span>
                    HL spot cash <span className="font-mono text-white">{fmtUsd(balanceState.hyperliquidSpotUsd)}</span>
                    {' · '}
                    HL unified <span className="font-mono text-white">{fmtUsd(balanceState.hyperliquidUnifiedUsd)}</span>
                    {' · '}
                    Pacifica perp <span className="font-mono text-white">{fmtUsd(balanceState.pacificaPerpUsd)}</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        </Field>

        <div className="rounded-md p-3 space-y-1.5" style={{ backgroundColor: '#1B2429', border: '1px solid #273035' }}>
          <Row label="Spot Leg" value={spotMarket ? `${spotMarket.baseAsset}/USDC · ${fmtUsd(spotMarket.markPrice)}` : '—'} />
          <Row label="Perp Leg" value={perpMarket ? `${perpMarket.symbol}-PERP · ${fmtUsd(perpMarket.markPrice)}` : '—'} />
          <Row label="Pacifica Funding (daily)" value={perpMarket ? `${pacificaDailyFundingRatePct.toFixed(4)}%` : '—'} />
          <Row label="Pacifica Funding (APR)" value={perpMarket ? `${pacificaAnnualFundingRatePct.toFixed(2)}%` : '—'} />
          <div className="border-t pt-1.5" style={{ borderColor: '#273035' }}>
            <Row
              label="Expected Funding / day"
              value={`${expectedDailyFunding >= 0 ? '+' : ''}${fmtUsd(expectedDailyFunding)}`}
              highlight={expectedDailyFunding >= 0 ? 'pos' : 'neg'}
            />
            <Row
              label="Expected Funding / 30d"
              value={`${expectedMonthlyFunding >= 0 ? '+' : ''}${fmtUsd(expectedMonthlyFunding)}`}
              highlight={expectedMonthlyFunding >= 0 ? 'pos' : 'neg'}
            />
            <Row
              label="Round-trip fee (entry+exit)"
              value={roundTripFeeUsd > 0 ? `-${fmtUsd(roundTripFeeUsd)}` : '—'}
              highlight={roundTripFeeUsd > 0 ? 'neg' : undefined}
            />
            <Row
              label="Breakeven vs funding"
              value={breakevenDays !== null
                ? `${breakevenDays < 365 ? breakevenDays.toFixed(0) : '>365'} days`
                : (expectedDailyFunding <= 0 ? 'funding unfavorable' : '—')}
            />
          </div>
        </div>

        <button
          onClick={handleOpen}
          disabled={isSubmitting || isLoadingMarkets || !selected || isLoadingBalances}
          className="w-full py-2 rounded-md text-xs font-semibold bg-[#5fd8ee] hover:bg-[#93E3F3] text-[#0F1A1E] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Opening...' : 'Open Delta-Neutral'}
        </button>
      </div>

      <div className="px-4 py-3" style={{ borderTop: '1px solid #273035' }}>
        <div className="text-xs font-medium text-white mb-2">Structure</div>
        <div className="text-xs" style={{ color: '#949E9C' }}>
          Buy the spot asset on Hyperliquid, then hedge the same asset with a Pacifica short perp.
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs" style={{ color: '#949E9C' }}>{label}</span>
      {children}
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: 'pos' | 'neg' }) {
  const color = highlight === 'pos' ? 'text-[#5fd8ee]' : highlight === 'neg' ? 'text-[#ED7088]' : 'text-white';
  return (
    <div className="flex justify-between gap-3">
      <span className="text-xs" style={{ color: '#949E9C' }}>{label}</span>
      <span className={`text-xs font-mono tabular-nums text-right ${color}`}>{value}</span>
    </div>
  );
}
