'use client';

/**
 * AccountInfoPanel — 계정 잔고, 마진, PnL 요약 + 입출금 버튼
 */

import { useState } from 'react';
import type { PerpAccountState, PerpPosition, PerpMarket, SpotBalance } from '../types/perp.types';
import { BridgeCard } from '@/domains/bridge';
import type { BridgeDirection } from '@/domains/bridge';
import { useAgentWalletStore, selectIsAgentActive as selectHlAgentActive } from '../stores/useAgentWalletStore';
import { usePacificaAgentStore, selectPacificaAgentActive } from '../stores/usePacificaAgentStore';
import { useLighterAgentStore, selectLighterAgentActive } from '../stores/useLighterAgentStore';
import { useAsterAgentStore, selectAsterAgentActive } from '../stores/useAsterAgentStore';
import { usePerpStore } from '../stores/usePerpStore';

interface Props {
  accountState: PerpAccountState | null;
  positions: PerpPosition[];
  spotBalances: SpotBalance[];
  markets: PerpMarket[];
  walletAddress: string | null;
  onSendTransaction?: (tx: { to: string; data: string; value: string; chainId: number }) => Promise<string>;
  onOpenAgentSetup: () => void;
}

export function AccountInfoPanel({ accountState, positions, spotBalances, markets, walletAddress, onSendTransaction, onOpenAgentSetup }: Props) {
  // null = modal closed, otherwise BridgeCard is open on the given tab.
  // Withdraw and Deposit both route through BridgeCard (Relay/CCTP), so they
  // share one modal container with different initial direction.
  const [bridgeDirection, setBridgeDirection] = useState<BridgeDirection | null>(null);

  // Per-DEX agent state. The trading layout scopes orders to `selectedDex`,
  // so the account panel mirrors it — previously this was HL-only and would
  // render "Not Set" even after a Pacifica/Lighter/Aster agent was approved.
  const selectedDex = usePerpStore((s) => s.selectedDex);
  const hlAgentStore = useAgentWalletStore();
  const hlActive = useAgentWalletStore(selectHlAgentActive);
  const pacStore = usePacificaAgentStore();
  const pacActive = usePacificaAgentStore(selectPacificaAgentActive);
  const lighterStore = useLighterAgentStore();
  const lighterActive = useLighterAgentStore(selectLighterAgentActive);
  const asterStore = useAsterAgentStore();
  const asterActive = useAsterAgentStore(selectAsterAgentActive);

  const agentView = (() => {
    switch (selectedDex) {
      case 'pacifica': {
        const p = pacStore.persisted;
        return {
          active: pacActive,
          agentAddress: p.type === 'registered' ? p.agentPublicKey : null,
          masterAddress: p.type === 'registered' ? p.mainAccount : null,
          disconnect: () => pacStore.disconnect(),
        };
      }
      case 'lighter': {
        const p = lighterStore.persisted;
        return {
          active: lighterActive,
          agentAddress: p.type === 'registered' ? `#${p.apiKeyIndex} @ acct ${p.accountIndex}` : null,
          masterAddress: p.type === 'registered' ? p.l1Address : null,
          disconnect: () => lighterStore.disconnect(),
        };
      }
      case 'aster': {
        const p = asterStore.persisted;
        return {
          active: asterActive,
          agentAddress: p.type === 'registered' ? p.agentAddress : null,
          masterAddress: p.type === 'registered' ? p.user : null,
          disconnect: () => asterStore.disconnect(),
        };
      }
      default: {
        // hyperliquid (default) — preserves prior behavior
        const p = hlAgentStore.persisted;
        return {
          active: hlActive,
          agentAddress: p.type !== 'disconnected' ? p.agentAddress : null,
          masterAddress: p.type !== 'disconnected' ? p.masterAddress : null,
          disconnect: () => hlAgentStore.disconnect(),
        };
      }
    }
  })();

  const isAgentActive = agentView.active;

  const totalUnrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);

  return (
    <>
      <div className="bg-surface border border-dark-600 rounded-lg p-4 flex flex-col gap-3">
        {/* ───────── Top: Deposit / Perps⇄Spot / Withdraw (HL-style) ───────── */}
        <button
          onClick={() => setBridgeDirection('deposit')}
          className="w-full py-2 text-xs font-medium rounded-md bg-[#5fd8ee] text-[#0F1A1E] hover:bg-[#93E3F3] transition-colors"
        >
          Deposit
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            disabled
            title="Spot ⇄ Perps transfer coming soon"
            className="py-2 text-xs font-medium rounded-md border border-primary/30 text-primary/50 cursor-not-allowed"
          >
            Perps ⇄ Spot
          </button>
          <button
            onClick={() => setBridgeDirection('withdraw')}
            disabled={!walletAddress}
            className="py-2 text-xs font-medium rounded-md border border-primary text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
          >
            Withdraw
          </button>
        </div>

        {/* ───────── Middle: Unified Account Summary (HL-style) ───────── */}
        <h3 className="text-xs font-medium text-white pt-2" style={{ borderTop: '1px solid #273035' }}>Unified Account Summary</h3>

        {!walletAddress ? (
          <div className="text-center py-6 text-gray-500 text-xs">
            Connect wallet to view account
          </div>
        ) : !accountState ? (
          <div className="text-center py-6 text-gray-500 text-xs">
            Loading account...
          </div>
        ) : (() => {
          // HL "Unified Account Summary" formulas — source of truth is HL's docs:
          //   https://hyperliquid.gitbook.io/hyperliquid-docs/trading/account-abstraction-modes#unified-account-ratio
          //
          //   Portfolio Value          = marginSummary.accountValue (perp) + Σ spot USD value
          //   Unrealized PNL           = Σ position.unrealizedPnl
          //   Perps Maintenance Margin = crossMaintenanceMarginUsed
          //
          // For ratio + leverage, HL uses a per-collateral-token formula:
          //   available_i   = spotTotal_i − Σ (isolated margin in token i)
          //   ratio         = max_i (crossMaintenanceMarginUsed_i / available_i)
          //   leverage      = totalNtlPos / available (not in docs — empirically
          //                                            matches HL UI for USDC-only accounts)
          //
          // Today our perp UI only trades against USDC, so single-token reduction
          // is safe: available = USDC spotTotal − Σ isolated marginUsed.
          const priceMap = new Map<string, number>();
          for (const m of markets) priceMap.set(m.baseAsset, m.markPrice);
          // HL spot USDC has a `hold` field representing the portion currently
          // pledged as perp margin — it is ALREADY counted inside
          // accountState.totalEquity. Subtract it for USDC only so we don't
          // double-count. For non-USDC tokens, `hold` means "locked in spot
          // orders" so we still count the full total.
          const spotUsd = spotBalances.reduce((sum, b) => {
            const total = parseFloat(b.total);
            const hold = parseFloat(b.hold);
            const countable = b.coin === 'USDC'
              ? Math.max(0, total - hold)
              : total;
            if (!(countable > 0)) return sum;
            const price = b.coin === 'USDC' ? 1 : (priceMap.get(b.coin) ?? 0);
            return sum + countable * price;
          }, 0);
          const portfolioValue = accountState.totalEquity + spotUsd;
          const maintMargin = accountState.maintenanceMargin;
          const usdcBalance = spotBalances.find(b => b.coin === 'USDC');
          const usdcSpotTotal = usdcBalance ? parseFloat(usdcBalance.total) : 0;
          const isolatedMarginSum = positions
            .filter(p => p.leverageType === 'isolated')
            .reduce((s, p) => s + p.marginUsed, 0);
          const available = usdcSpotTotal - isolatedMarginSum;
          const unifiedRatio = available > 0 ? (maintMargin / available) * 100 : 0;
          const unifiedLeverage = available > 0 ? accountState.totalNotional / available : 0;
          const ratioColor = unifiedRatio >= 80 ? 'text-[#ED7088]' : unifiedRatio >= 50 ? 'text-yellow-400' : 'text-[#5fd8ee]';
          const pnlColor = totalUnrealizedPnl >= 0 ? 'text-[#5fd8ee]' : 'text-[#ED7088]';
          return (
            <>
              <InfoRow
                label="Unified Account Ratio"
                value={`${unifiedRatio.toFixed(2)}%`}
                valueClass={ratioColor}
              />
              <InfoRow
                label="Portfolio Value"
                value={`$${portfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              />
              <InfoRow
                label="Unrealized PNL"
                value={`${totalUnrealizedPnl >= 0 ? '' : '-'}$${Math.abs(totalUnrealizedPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                valueClass={pnlColor}
              />
              <InfoRow
                label="Perps Maintenance Margin"
                value={`$${maintMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              />
              <InfoRow
                label="Unified Account Leverage"
                value={`${unifiedLeverage.toFixed(2)}x`}
              />
            </>
          );
        })()}

        {/* ───────── Bottom: Agent Wallet Status ───────── */}
        <div className="border-t border-dark-600 pt-2 mt-1">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-xs text-gray-500">Agent Wallet</span>
            {isAgentActive ? (
              <span className="text-xs px-1.5 py-0.5 rounded bg-[#5fd8ee]/10 text-[#5fd8ee]">Active</span>
            ) : (
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">Not Set</span>
            )}
          </div>
          {isAgentActive && (agentView.agentAddress || agentView.masterAddress) && (
            <div className="space-y-1 mb-1.5">
              {agentView.agentAddress && (
                <div className="flex justify-between">
                  <span className="text-xs text-gray-600">Agent</span>
                  <span className="text-xs text-gray-400 font-mono">{shortAddr(agentView.agentAddress)}</span>
                </div>
              )}
              {agentView.masterAddress && (
                <div className="flex justify-between">
                  <span className="text-xs text-gray-600">Master</span>
                  <span className="text-xs text-gray-400 font-mono">{shortAddr(agentView.masterAddress)}</span>
                </div>
              )}
            </div>
          )}
          <button
            onClick={isAgentActive ? agentView.disconnect : onOpenAgentSetup}
            className={`w-full py-1.5 text-xs font-medium rounded transition-colors ${
              isAgentActive
                ? 'text-[#ED7088] border border-[#ED7088]/30 hover:bg-[#ED7088]/10'
                : 'text-primary border border-primary/30 hover:bg-primary/10'
            }`}
          >
            {isAgentActive ? 'Disconnect Agent' : 'Setup Agent Wallet'}
          </button>
        </div>
      </div>

      {/* Bridge Modal — shared container for both Deposit and Withdraw */}
      {bridgeDirection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm mx-4">
            <BridgeCard
              walletAddress={walletAddress}
              defaultDirection={bridgeDirection}
              defaultDex={selectedDex}
              onClose={() => setBridgeDirection(null)}
              onComplete={() => setBridgeDirection(null)}
              onSendTransaction={onSendTransaction}
            />
          </div>
        </div>
      )}
    </>
  );
}

function shortAddr(v: string): string {
  return v.length > 14 ? `${v.slice(0, 8)}…${v.slice(-4)}` : v;
}

function InfoRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-xs tabular-nums ${valueClass ?? 'text-gray-300'}`}>{value}</span>
    </div>
  );
}
