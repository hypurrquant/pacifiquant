'use client';

/**
 * RebalanceCard — Cross-DEX balance equalization dashboard
 *
 * Fetches balance snapshots from all 3 DEX adapters,
 * computes a rebalance plan, and displays recommended moves.
 * Auto-refreshes every 60s.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ExchangeBalanceSnapshot, RebalancePlan } from '@hq/core/defi/perp';
import { HyperliquidPerpAdapter, computeRebalancePlan } from '@hq/core/defi/perp';
import { getAdapterByDex } from '@/domains/perp/hooks/usePerpAdapter';
import type { PerpDexId } from '@/domains/perp/types/perp.types';
import { useStrategyExchangeAccounts } from '../hooks/useStrategyExchangeAccounts';
import { getHyperliquidUsdcSummary } from '../utils/hyperliquidUsdcSummary';

const DEX_IDS: readonly PerpDexId[] = ['hyperliquid', 'pacifica', 'lighter', 'aster'] as const;
const DEX_LABELS: Record<PerpDexId, string> = {
  hyperliquid: 'Hyperliquid',
  pacifica: 'Pacifica',
  lighter: 'Lighter',
  aster: 'Aster',
};
const REFRESH_INTERVAL_MS = 60_000;

export function RebalanceCard() {
  const accounts = useStrategyExchangeAccounts();
  const [plan, setPlan] = useState<RebalancePlan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAndCompute = useCallback(async () => {
    const hasAnyAccount =
      accounts.hyperliquid !== null ||
      accounts.pacifica !== null ||
      accounts.lighter !== null ||
      accounts.aster !== null;
    if (!hasAnyAccount) {
      setPlan(null);
      setError('No exchange data available. Connect wallets to view balances.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const results = await Promise.allSettled(
        DEX_IDS.map(async (dexId): Promise<ExchangeBalanceSnapshot> => {
          const queryAddr = accounts.byDex[dexId];
          if (!queryAddr) {
            throw new Error(`No account address for ${dexId}`);
          }

          const adapter = getAdapterByDex(dexId);
          const state = await adapter.getAccountState(queryAddr);

          if (dexId === 'hyperliquid') {
            const spotBalances = await (adapter as HyperliquidPerpAdapter).getSpotBalances(queryAddr);
            const summary = getHyperliquidUsdcSummary(state, spotBalances);
            return {
              exchange: dexId,
              equity: summary.totalEquityUsd,
              available: summary.availableUsd,
              marginUsed: state.totalMarginUsed,
            };
          }

          return {
            exchange: dexId,
            equity: state.totalEquity,
            available: state.availableBalance,
            marginUsed: state.totalMarginUsed,
          };
        }),
      );

      const snapshots: ExchangeBalanceSnapshot[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled') {
          snapshots.push(r.value);
        }
      }

      if (snapshots.length === 0) {
        setError('No exchange data available. Connect wallets to view balances.');
        setPlan(null);
      } else {
        setPlan(computeRebalancePlan(snapshots));
        setLastRefresh(new Date());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch balances');
      setPlan(null);
    } finally {
      setIsLoading(false);
    }
  }, [accounts]);

  // Auto-refresh
  useEffect(() => {
    fetchAndCompute();
    intervalRef.current = setInterval(fetchAndCompute, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchAndCompute]);

  return (
    <div className="rounded-lg flex flex-col" style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}>
      {/* Header */}
      <div className="px-4 py-3" style={{ borderBottom: '1px solid #273035' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs px-1.5 py-0.5 rounded text-[#5fd8ee] bg-[#5fd8ee]/10">RB</span>
            <h2 className="text-sm font-semibold text-white">Cross-DEX Rebalance</h2>
          </div>
          <button
            onClick={fetchAndCompute}
            disabled={isLoading}
            className="text-xs text-gray-500 hover:text-white transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <p className="text-xs mt-1" style={{ color: '#949E9C' }}>
          Equalize USDC across exchanges for optimal capital efficiency
        </p>
      </div>

      <div className="p-4 flex flex-col gap-3">
        {/* Error */}
        {error && (
          <div className="rounded-md px-3 py-2.5 text-xs" style={{ backgroundColor: '#ED708814', border: '1px solid #ED708840', color: '#ED7088' }}>
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading && !plan && (
          <div className="space-y-2">
            {DEX_IDS.map((id) => (
              <div key={id} className="h-10 rounded-md animate-pulse" style={{ backgroundColor: '#1B2429' }} />
            ))}
          </div>
        )}

        {/* Exchange Balances */}
        {plan && (
          <>
            <div className="rounded-md p-3 space-y-2" style={{ backgroundColor: '#1B2429', border: '1px solid #273035' }}>
              <div className="flex justify-between text-[11px] text-gray-500 mb-1">
                <span>Exchange</span>
                <div className="flex gap-6">
                  <span className="w-16 text-right">Equity</span>
                  <span className="w-16 text-right">Available</span>
                  <span className="w-16 text-right">Delta</span>
                </div>
              </div>
              {plan.snapshots.map((snap) => {
                const delta = snap.available - plan.targetPerExchange;
                const deltaColor = delta > 0 ? 'text-[#5fd8ee]' : delta < -10 ? 'text-[#ED7088]' : 'text-gray-400';
                return (
                  <div key={snap.exchange} className="flex justify-between items-center">
                    <span className="text-xs text-white">{DEX_LABELS[snap.exchange as PerpDexId] ?? snap.exchange}</span>
                    <div className="flex gap-6">
                      <span className="w-16 text-right text-xs text-gray-300 font-mono tabular-nums">
                        ${snap.equity.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                      <span className="w-16 text-right text-xs text-gray-300 font-mono tabular-nums">
                        ${snap.available.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                      <span className={`w-16 text-right text-xs font-mono tabular-nums ${deltaColor}`}>
                        {delta >= 0 ? '+' : ''}{delta.toFixed(0)}
                      </span>
                    </div>
                  </div>
                );
              })}
              <div className="border-t pt-2 mt-1" style={{ borderColor: '#273035' }}>
                <div className="flex justify-between">
                  <span className="text-xs text-gray-500">Target per exchange</span>
                  <span className="text-xs text-white font-mono tabular-nums">
                    ${plan.targetPerExchange.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-gray-500">Total Equity</span>
                  <span className="text-xs text-white font-mono tabular-nums">
                    ${plan.totalEquity.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </span>
                </div>
              </div>
            </div>

            {/* Recommended Moves */}
            <div className="text-xs font-medium text-white">Recommended Moves</div>
            {plan.moves.length === 0 ? (
              <div className="text-xs text-center py-3" style={{ color: '#5a6469' }}>
                Balanced — no moves needed
              </div>
            ) : (
              <div className="space-y-2">
                {plan.moves.map((move, i) => (
                  <div
                    key={`${move.from}-${move.to}-${i}`}
                    className="rounded-md p-3 flex items-center justify-between"
                    style={{ backgroundColor: '#1B2429', border: '1px solid #273035' }}
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="text-xs text-white">
                        <span className="font-mono tabular-nums text-[#5fd8ee]">${move.amount.toLocaleString()}</span>
                        {' '}
                        <span className="text-gray-500">
                          {DEX_LABELS[move.from as PerpDexId] ?? move.from}
                          {' → '}
                          {DEX_LABELS[move.to as PerpDexId] ?? move.to}
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-600">{move.reason}</span>
                    </div>
                    <button
                      disabled
                      className="text-xs px-2.5 py-1 rounded border border-[#273035] text-gray-500 cursor-not-allowed"
                      title="Bridge execution coming soon"
                    >
                      Bridge
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {lastRefresh && (
        <div className="px-4 py-2" style={{ borderTop: '1px solid #273035' }}>
          <span className="text-[10px] text-gray-600">
            Last updated: {lastRefresh.toLocaleTimeString()} — auto-refreshes every 60s
          </span>
        </div>
      )}
    </div>
  );
}
