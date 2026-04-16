'use client';

/**
 * Market Making — Dalen model quote preview + agent-wallet-gated auto-trade toggle
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PerpMarket } from '@hq/core/defi/perp';
import {
  computeDalenQuotes,
  GAMMA_DEFAULT,
  KAPPA_DEFAULT,
  SIGMA_B_DEFAULT,
} from '@hq/core/defi/perp';
import { usePerpDeps } from '@/domains/perp/providers/PerpDepsProvider';
import { getAdapterByDex } from '@/domains/perp/hooks/usePerpAdapter';
import { useAgentWalletStore, selectIsAgentActive } from '@/domains/perp/stores/useAgentWalletStore';
import { usePacificaAgentStore, selectPacificaAgentActive } from '@/domains/perp/stores/usePacificaAgentStore';
import { useLighterAgentStore, selectLighterAgentActive } from '@/domains/perp/stores/useLighterAgentStore';
import { useAsterAgentStore, selectAsterAgentActive } from '@/domains/perp/stores/useAsterAgentStore';
import { fmtPriceByTick } from '@/domains/perp/utils/displayComputations';
import type { PerpDexId } from '@/domains/perp/types/perp.types';

// ── Constants ────────────────────────────────────────────────────────────────

const DEX_OPTIONS: { id: PerpDexId; label: string }[] = [
  { id: 'hyperliquid', label: 'Hyperliquid' },
  { id: 'pacifica', label: 'Pacifica' },
  { id: 'lighter', label: 'Lighter' },
  { id: 'aster', label: 'Aster' },
];

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  markets: PerpMarket[];
}

export function MarketMakingCard({ markets }: Props) {
  const deps = usePerpDeps();

  // Per-DEX agent active flags (read directly to avoid mutating the global store)
  const hlActive = useAgentWalletStore(selectIsAgentActive);
  const pacActive = usePacificaAgentStore(selectPacificaAgentActive);
  const lightActive = useLighterAgentStore(selectLighterAgentActive);
  const astActive = useAsterAgentStore(selectAsterAgentActive);

  // ── Local form state ───────────────────────────────────────────────────────

  const [dex, setDex] = useState<PerpDexId>('hyperliquid');
  const [symbol, setSymbol] = useState('BTC');
  const [inventory, setInventory] = useState('0');
  const [gamma, setGamma] = useState(String(GAMMA_DEFAULT));
  const [kappa, setKappa] = useState(String(KAPPA_DEFAULT));
  const [sigmaB, setSigmaB] = useState(String(SIGMA_B_DEFAULT));
  const [autoTrade, setAutoTrade] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Agent active for the currently selected DEX
  const agentActiveForDex = useMemo<boolean>(() => {
    if (dex === 'hyperliquid') return hlActive;
    if (dex === 'pacifica') return pacActive;
    if (dex === 'lighter') return lightActive;
    return astActive;
  }, [dex, hlActive, pacActive, lightActive, astActive]);

  // ── Markets for the selected DEX ──────────────────────────────────────────

  const { data: dexMarkets = markets } = useQuery({
    queryKey: ['perp', dex, 'markets', 'mmCard'],
    queryFn: () => getAdapterByDex(dex).getMarkets(),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const selectedMarket = useMemo(
    () => dexMarkets.find(m => m.symbol === symbol) ?? dexMarkets[0] ?? null,
    [dexMarkets, symbol],
  );

  // Keep symbol in sync if it's not present in the new DEX's markets
  const effectiveSymbol = selectedMarket?.symbol ?? symbol;

  // ── Dalen quote preview ────────────────────────────────────────────────────

  const quotes = useMemo(() => {
    if (!selectedMarket || selectedMarket.markPrice <= 0) return null;
    const g = parseFloat(gamma);
    const k = parseFloat(kappa);
    const s = parseFloat(sigmaB);
    const inv = parseFloat(inventory);
    if (!isFinite(g) || g <= 0) return null;
    if (!isFinite(k) || k <= 0) return null;
    if (!isFinite(s) || s < 0) return null;
    if (!isFinite(inv)) return null;
    try {
      return computeDalenQuotes({
        mid: selectedMarket.markPrice,
        inventory: inv,
        gamma: g,
        kappa: k,
        sigmaB: s,
      });
    } catch {
      return null;
    }
  }, [selectedMarket, inventory, gamma, kappa, sigmaB]);

  const tickSize = selectedMarket?.tickSize ?? 0.01;

  // ── Start MM handler ───────────────────────────────────────────────────────

  const handleStartMM = async () => {
    if (!quotes || !selectedMarket) {
      deps.showToast({ title: 'No quotes available', type: 'warning' });
      return;
    }
    if (!agentActiveForDex) {
      deps.showToast({ title: `Enable agent trading for ${dex} first`, type: 'warning' });
      return;
    }

    setIsSubmitting(true);
    try {
      const adapter = getAdapterByDex(dex);
      const signFn = deps.getSignFn();
      const sym = effectiveSymbol;

      const [bidResult, askResult] = await Promise.all([
        adapter.placeOrder(
          { symbol: sym, side: 'long', type: 'limit', size: selectedMarket.minOrderSize, price: quotes.bid, leverage: 1, timeInForce: 'alo' },
          signFn,
        ),
        adapter.placeOrder(
          { symbol: sym, side: 'short', type: 'limit', size: selectedMarket.minOrderSize, price: quotes.ask, leverage: 1, timeInForce: 'alo' },
          signFn,
        ),
      ]);

      if (bidResult.success && askResult.success) {
        deps.showToast({
          title: 'MM orders placed',
          message: `bid@${fmtPriceByTick(quotes.bid, tickSize)} / ask@${fmtPriceByTick(quotes.ask, tickSize)}`,
          type: 'success',
        });
      } else {
        const errMsg = bidResult.error ?? askResult.error ?? 'Unknown error';
        deps.showToast({ title: 'Order failed', message: errMsg, type: 'warning' });
      }
    } catch (err) {
      deps.showToast({
        title: 'Order error',
        message: err instanceof Error ? err.message : 'Unexpected error',
        type: 'warning',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-lg flex flex-col" style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}>

      {/* Header */}
      <div className="px-4 py-3" style={{ borderBottom: '1px solid #273035' }}>
        <div className="flex items-center gap-2">
          <span className="text-xs px-1.5 py-0.5 rounded text-[#5fd8ee] bg-[#5fd8ee]/10">MM</span>
          <h2 className="text-sm font-semibold text-white">Market Making</h2>
        </div>
        <p className="text-xs mt-1" style={{ color: '#949E9C' }}>
          Dalen-model quotes — inventory-aware bid/ask around mid
        </p>
      </div>

      {/* Config Form */}
      <div className="p-4 flex flex-col gap-3">

        {/* Agent warning */}
        {!agentActiveForDex && (
          <div className="rounded px-3 py-2 text-xs" style={{ backgroundColor: '#2A2200', border: '1px solid #5A4500', color: '#E8B84B' }}>
            Agent wallet not active for {dex}. Enable trading in the Trade panel first.
          </div>
        )}

        {/* DEX picker */}
        <Field label="DEX">
          <select
            value={dex}
            onChange={(e) => setDex(e.target.value as PerpDexId)}
            className="w-full bg-transparent text-xs text-white rounded px-2 py-1.5 focus:outline-none"
            style={{ border: '1px solid #273035', backgroundColor: '#1B2429' }}
          >
            {DEX_OPTIONS.map(o => (
              <option key={o.id} value={o.id} style={{ backgroundColor: '#0F1A1F' }}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        {/* Symbol picker */}
        <Field label="Symbol">
          <select
            value={effectiveSymbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="w-full bg-transparent text-xs text-white rounded px-2 py-1.5 focus:outline-none"
            style={{ border: '1px solid #273035', backgroundColor: '#1B2429' }}
          >
            {dexMarkets.slice(0, 30).map(m => (
              <option key={m.symbol} value={m.symbol} style={{ backgroundColor: '#0F1A1F' }}>
                {m.baseAsset}-{m.quoteAsset}
              </option>
            ))}
          </select>
        </Field>

        {/* Inventory + Gamma row */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Inventory">
            <NumberInput value={inventory} onChange={setInventory} step="0.001" />
          </Field>
          <Field label="Gamma (γ)">
            <NumberInput value={gamma} onChange={setGamma} step="0.01" />
          </Field>
        </div>

        {/* Kappa + SigmaB row */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kappa (κ)">
            <NumberInput value={kappa} onChange={setKappa} step="0.1" />
          </Field>
          <Field label="Sigma B (σ)">
            <NumberInput value={sigmaB} onChange={setSigmaB} step="0.1" />
          </Field>
        </div>

        {/* Dalen Quote Preview */}
        <div className="rounded px-3 py-2.5 flex flex-col gap-1" style={{ backgroundColor: '#1B2429', border: '1px solid #273035' }}>
          <div className="text-xs font-medium mb-1" style={{ color: '#949E9C' }}>Quote Preview</div>
          {quotes && selectedMarket ? (
            <>
              <QuoteLine label="Bid" value={fmtPriceByTick(quotes.bid, tickSize)} color="#5fd8ee" />
              <QuoteLine label="Ask" value={fmtPriceByTick(quotes.ask, tickSize)} color="#ED7088" />
              <QuoteLine label="Reservation" value={fmtPriceByTick(quotes.reservationPrice, tickSize)} color="#949E9C" />
              <QuoteLine label="Half-Spread" value={fmtPriceByTick(quotes.halfSpread, tickSize)} color="#949E9C" />
            </>
          ) : (
            <div className="text-xs" style={{ color: '#5a6469' }}>
              {selectedMarket ? 'Invalid parameters' : 'Loading market...'}
            </div>
          )}
        </div>

        {/* Auto-trade toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <div className="relative">
            <input
              type="checkbox"
              className="sr-only"
              checked={autoTrade}
              disabled={!agentActiveForDex}
              title={!agentActiveForDex ? `Enable agent trading for ${dex} first` : undefined}
              onChange={(e) => setAutoTrade(e.target.checked)}
            />
            <div
              className="w-8 h-4 rounded-full transition-colors"
              style={{
                backgroundColor: autoTrade && agentActiveForDex ? '#5fd8ee' : '#273035',
                opacity: agentActiveForDex ? 1 : 0.4,
              }}
            />
            <div
              className="absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform"
              style={{ transform: autoTrade && agentActiveForDex ? 'translateX(16px)' : 'translateX(0)' }}
            />
          </div>
          <span
            className="text-xs"
            style={{ color: agentActiveForDex ? '#949E9C' : '#5a6469' }}
            title={!agentActiveForDex ? `Enable agent trading for ${dex} first` : undefined}
          >
            Auto-trade with agent wallet
          </span>
        </label>

        {/* Start MM button */}
        <button
          onClick={handleStartMM}
          disabled={isSubmitting || !autoTrade || !agentActiveForDex || !quotes || selectedMarket === null}
          title={
            !agentActiveForDex && autoTrade
              ? 'Agent required to auto-trade'
              : !autoTrade
              ? 'Enable auto-trade toggle to place orders'
              : undefined
          }
          className="mt-1 w-full py-2 rounded-md text-xs font-semibold bg-[#5fd8ee] hover:bg-[#93E3F3] text-[#0F1A1E] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Placing...' : 'Start MM'}
        </button>

        {/* Hint when toggle is on but agent is gone */}
        {autoTrade && !agentActiveForDex && (
          <div className="text-xs text-center" style={{ color: '#ED7088' }}>
            Agent required to auto-trade
          </div>
        )}
      </div>

      {/* Active Strategies footer */}
      <div className="px-4 py-3" style={{ borderTop: '1px solid #273035' }}>
        <div className="text-xs font-medium text-white mb-2">Active Strategies</div>
        <div className="text-xs text-center py-3" style={{ color: '#5a6469' }}>
          No active MM strategies
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs" style={{ color: '#949E9C' }}>{label}</span>
      {children}
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  step,
}: {
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-transparent text-xs text-white font-mono tabular-nums rounded px-2 py-1.5 focus:outline-none"
      style={{ border: '1px solid #273035', backgroundColor: '#1B2429' }}
    />
  );
}

function QuoteLine({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs" style={{ color: '#949E9C' }}>{label}:</span>
      <span className="text-xs font-mono tabular-nums" style={{ color }}>
        ${value}
      </span>
    </div>
  );
}
