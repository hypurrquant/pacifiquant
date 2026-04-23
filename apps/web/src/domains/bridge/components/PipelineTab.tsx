'use client';

/**
 * PipelineTab — cross-DEX Withdraw → Bridge → Deposit wizard mounted inside
 * the existing Deposit modal. The user picks a source + target DEX + amount,
 * then steps through three legs. State persists to localStorage so a closed
 * tab or reload can resume at the stuck step.
 */

import { useMemo, useState } from 'react';
import { getAdapterByDex } from '@/domains/perp/hooks/usePerpAdapter';
import type { PerpDexId } from '@/domains/perp/types/perp.types';
import { PERP_DEX_META, PERP_DEX_ORDER } from '@/shared/config/perp-dex-display';
import { useStrategyExchangeAccounts } from '@/domains/strategies/hooks/useStrategyExchangeAccounts';
import { usePerpDeps } from '@/domains/perp/providers/PerpDepsProvider';
import { usePipelineState, type PipelineState } from '../hooks/usePipelineState';
import { findRoute, type PipelineRoute } from '../utils/pipelineRoutes';

const RELAY_API_URL = 'https://api.relay.link';
const USDC_ADDRESSES: Record<number, string> = {
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Arbitrum USDC
  56:    '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // BSC USDC (BEP20)
  // Relay maps Solana USDC by its canonical SPL mint address when the chain
  // is the Solana magic id (792703809).
  792703809: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

export function PipelineTab({ onClose }: { onClose: () => void }) {
  const { state, start, advanceStep, failStep, reset, retryFailed } = usePipelineState();

  if (state && state.step !== 'done') {
    return <PipelineRunView state={state} onAdvance={advanceStep} onFail={failStep} onReset={reset} onRetry={retryFailed} />;
  }
  if (state && state.step === 'done') {
    return <PipelineDoneView state={state} onReset={reset} onClose={onClose} />;
  }
  return <PipelinePicker onStart={start} />;
}

// ── Picker ─────────────────────────────────────────────────────────────

function PipelinePicker({ onStart }: { onStart: (source: PerpDexId, target: PerpDexId, amount: string) => void }) {
  const [source, setSource] = useState<PerpDexId>('hyperliquid');
  const [target, setTarget] = useState<PerpDexId>('pacifica');
  const [amount, setAmount] = useState<string>('');
  const route = useMemo(() => findRoute(source, target), [source, target]);

  const sameDex = source === target;
  const amountValid = parseFloat(amount) > 0;
  const canStart = !sameDex && amountValid && !!route;

  return (
    <div className="flex flex-col gap-3 p-4">
      <DexPicker label="Source" value={source} onChange={setSource} />
      <DexPicker label="Target" value={target} onChange={setTarget} />
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: '#949E9C' }}>Amount (USDC)</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="0.00"
          className="bg-[#0B141A] text-white text-sm px-3 py-2 rounded tabular-nums focus:outline-none"
          style={{ border: '1px solid #273035' }}
        />
      </label>
      {route && (
        <div className="text-[10px] rounded px-2 py-1.5" style={{ color: '#8F9BA4', backgroundColor: '#0B141A', border: '1px solid #1F2A33' }}>
          Route · {route.bridgeKind === 'evm-evm' ? 'EVM → EVM' : 'EVM ↔ Solana'} via Relay
        </div>
      )}
      {sameDex && (
        <div className="text-[10px]" style={{ color: '#FFA94D' }}>Source and target must differ.</div>
      )}
      <button
        onClick={() => canStart && onStart(source, target, amount)}
        disabled={!canStart}
        className="w-full py-2 rounded text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ backgroundColor: '#AB9FF2', color: '#0B1018' }}
      >
        Start pipeline
      </button>
    </div>
  );
}

function DexPicker({ label, value, onChange }: { label: string; value: PerpDexId; onChange: (v: PerpDexId) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider" style={{ color: '#949E9C' }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as PerpDexId)}
        className="bg-[#0B141A] text-white text-sm px-3 py-2 rounded focus:outline-none"
        style={{ border: '1px solid #273035' }}
      >
        {PERP_DEX_ORDER.map((d) => (
          <option key={d} value={d}>{PERP_DEX_META[d].name}</option>
        ))}
      </select>
    </label>
  );
}

// ── Run view ───────────────────────────────────────────────────────────

interface RunProps {
  readonly state: PipelineState;
  readonly onAdvance: (leg: 'withdraw' | 'bridge' | 'deposit', hash: string) => void;
  readonly onFail: (err: string) => void;
  readonly onReset: () => void;
  readonly onRetry: () => void;
}

function PipelineRunView({ state, onAdvance, onFail, onReset, onRetry }: RunProps) {
  const route = findRoute(state.source, state.target);
  if (!route) {
    return (
      <div className="p-4 text-xs" style={{ color: '#ED7088' }}>
        Unknown route. <button onClick={onReset} className="underline">Reset</button>
      </div>
    );
  }
  return (
    <div className="p-4 flex flex-col gap-3">
      <PipelineHeader state={state} route={route} onReset={onReset} />
      <StepRow
        label={`Withdraw from ${PERP_DEX_META[state.source].name}`}
        active={state.step === 'withdraw'}
        done={!!state.txHashes.withdraw}
      >
        {state.step === 'withdraw' && (
          <WithdrawStep state={state} onAdvance={onAdvance} onFail={onFail} />
        )}
        {state.txHashes.withdraw && (
          <TxLink hash={state.txHashes.withdraw} chainId={route.sourceChainId} />
        )}
      </StepRow>
      <StepRow
        label="Bridge via Relay"
        active={state.step === 'bridge'}
        done={!!state.txHashes.bridge}
      >
        {state.step === 'bridge' && (
          <BridgeStep state={state} route={route} onAdvance={onAdvance} onFail={onFail} />
        )}
        {state.txHashes.bridge && (
          <TxLink hash={state.txHashes.bridge} chainId={route.sourceChainId} />
        )}
      </StepRow>
      <StepRow
        label={`Deposit to ${PERP_DEX_META[state.target].name}`}
        active={state.step === 'deposit'}
        done={!!state.txHashes.deposit}
      >
        {state.step === 'deposit' && (
          <DepositStep state={state} onAdvance={onAdvance} onFail={onFail} />
        )}
        {state.txHashes.deposit && (
          <TxLink hash={state.txHashes.deposit} chainId={route.targetChainId} />
        )}
      </StepRow>
      {state.step === 'failed' && (
        <div className="rounded px-3 py-2 flex items-center justify-between" style={{ backgroundColor: 'rgba(237,112,136,0.08)', border: '1px solid rgba(237,112,136,0.25)' }}>
          <span className="text-[11px]" style={{ color: '#ED7088' }}>
            {state.error ?? 'Step failed.'}
          </span>
          <button onClick={onRetry} className="text-[10px] font-semibold px-2 py-1 rounded" style={{ color: '#AB9FF2', border: '1px solid rgba(171,159,242,0.35)' }}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

function PipelineHeader({ state, route, onReset }: { state: PipelineState; route: PipelineRoute; onReset: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-xs font-semibold text-white">
          {PERP_DEX_META[route.source].name} → {PERP_DEX_META[route.target].name}
        </div>
        <div className="text-[10px]" style={{ color: '#6B7580' }}>
          {state.amount} USDC · {route.bridgeKind}
        </div>
      </div>
      <button onClick={onReset} className="text-[10px] hover:text-white transition-colors" style={{ color: '#6B7580' }}>
        Reset pipeline
      </button>
    </div>
  );
}

function StepRow({ label, active, done, children }: { label: string; active: boolean; done: boolean; children?: React.ReactNode }) {
  return (
    <div className="rounded-md px-3 py-2.5 space-y-1.5" style={{ backgroundColor: '#0B141A', border: `1px solid ${active ? 'rgba(171,159,242,0.35)' : '#1F2A33'}` }}>
      <div className="flex items-center gap-2">
        <span className="w-4 h-4 flex items-center justify-center rounded-full text-[9px] font-bold" style={{ color: done ? '#6EE7B7' : active ? '#AB9FF2' : '#6B7580', border: `1px solid ${done ? '#6EE7B7' : active ? '#AB9FF2' : '#1F2A33'}` }}>
          {done ? '✓' : active ? '●' : '○'}
        </span>
        <span className="text-xs" style={{ color: done ? '#949E9C' : 'white' }}>{label}</span>
      </div>
      {children}
    </div>
  );
}

function TxLink({ hash, chainId }: { hash: string; chainId: number }) {
  const base = chainId === 42161
    ? 'https://arbiscan.io/tx/'
    : chainId === 56
      ? 'https://bscscan.com/tx/'
      : chainId === 792703809
        ? 'https://solscan.io/tx/'
        : null;
  if (!base) return <div className="text-[10px]" style={{ color: '#6B7580' }}>{hash}</div>;
  return (
    <a href={`${base}${hash}`} target="_blank" rel="noreferrer" className="text-[10px] underline" style={{ color: '#AB9FF2' }}>
      {hash.slice(0, 10)}…{hash.slice(-8)}
    </a>
  );
}

// ── Leg steps ──────────────────────────────────────────────────────────

function WithdrawStep({ state, onAdvance, onFail }: { state: PipelineState; onAdvance: RunProps['onAdvance']; onFail: RunProps['onFail'] }) {
  const deps = usePerpDeps();
  const accounts = useStrategyExchangeAccounts();
  const [submitting, setSubmitting] = useState(false);
  const destination = state.target;

  const handleWithdraw = async () => {
    setSubmitting(true);
    try {
      const adapter = getAdapterByDex(state.source);
      const signFn = deps.getSignFn();
      const fromAddr = accounts.byDex[state.source];
      if (!fromAddr) throw new Error(`No ${state.source} address configured`);
      const hash = await adapter.withdraw(
        {
          amount: parseFloat(state.amount),
          toAddress: fromAddr,
          signatureChainId: 0,
        },
        signFn,
      );
      deps.showToast({ title: `${state.source} withdraw submitted`, type: 'success' });
      onAdvance('withdraw', hash);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      onFail(`Withdraw failed: ${m}`);
      deps.showToast({ title: `${state.source} withdraw failed`, message: m, type: 'warning' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <button
      onClick={handleWithdraw}
      disabled={submitting}
      className="text-[10px] font-semibold px-2 py-1 rounded disabled:opacity-40"
      style={{ color: '#AB9FF2', border: '1px solid rgba(171,159,242,0.35)' }}
    >
      {submitting ? 'Submitting…' : `Withdraw ${state.amount} USDC to prepare for bridge to ${destination}`}
    </button>
  );
}

function BridgeStep({ state, route, onAdvance, onFail }: { state: PipelineState; route: PipelineRoute; onAdvance: RunProps['onAdvance']; onFail: RunProps['onFail'] }) {
  const deps = usePerpDeps();
  const accounts = useStrategyExchangeAccounts();
  const [submitting, setSubmitting] = useState(false);
  const needsPhantom = route.bridgeKind === 'evm-svm';
  const pacificaAddress = accounts.pacifica;

  const handleBridge = async () => {
    if (needsPhantom && !pacificaAddress) {
      onFail('Connect Phantom first — the Solana leg needs a destination pubkey.');
      return;
    }
    setSubmitting(true);
    try {
      const sourceUsdc = USDC_ADDRESSES[route.sourceChainId];
      const targetUsdc = USDC_ADDRESSES[route.targetChainId];
      if (!sourceUsdc || !targetUsdc) {
        throw new Error(`USDC address missing for chain ${route.sourceChainId} or ${route.targetChainId}`);
      }
      const sourceAddr = accounts.byDex[state.source] ?? '';
      const recipient = route.bridgeKind === 'evm-svm'
        ? pacificaAddress ?? ''
        : accounts.byDex[state.target] ?? sourceAddr;
      if (!sourceAddr || !recipient) {
        throw new Error('Missing source or recipient address.');
      }
      const amountRaw = BigInt(Math.floor(parseFloat(state.amount) * 1_000_000)).toString(); // USDC = 6 decimals
      const res = await fetch(`${RELAY_API_URL}/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: sourceAddr,
          originChainId: route.sourceChainId,
          destinationChainId: route.targetChainId,
          originCurrency: sourceUsdc,
          destinationCurrency: targetUsdc,
          amount: amountRaw,
          recipient,
          tradeType: 'EXACT_INPUT',
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Relay quote: ${res.status} ${text.slice(0, 120)}`);
      }
      const quote = await res.json();
      const steps: Array<Record<string, unknown>> = quote.steps ?? [];
      let lastHash = '';
      for (const step of steps) {
        const items = (step.items as Array<Record<string, unknown>> | undefined) ?? [];
        for (const item of items) {
          const data = item.data as Record<string, string> | undefined;
          if (!data?.to) continue;
          const hash = await deps.sendTransaction({
            to: data.to,
            data: data.data ?? '0x',
            value: data.value ?? '0',
            chainId: Number(step.chainId ?? route.sourceChainId),
          });
          lastHash = hash;
        }
      }
      if (!lastHash) throw new Error('Relay returned no executable steps.');
      deps.showToast({ title: 'Bridge submitted', type: 'success' });
      onAdvance('bridge', lastHash);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      onFail(`Bridge failed: ${m}`);
      deps.showToast({ title: 'Bridge failed', message: m, type: 'warning' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {needsPhantom && !pacificaAddress && (
        <div className="text-[10px]" style={{ color: '#FFA94D' }}>
          Phantom not connected — the Solana leg needs a destination wallet. Open the Strategies page and bind Phantom first.
        </div>
      )}
      <button
        onClick={handleBridge}
        disabled={submitting}
        className="text-[10px] font-semibold px-2 py-1 rounded disabled:opacity-40 self-start"
        style={{ color: '#AB9FF2', border: '1px solid rgba(171,159,242,0.35)' }}
      >
        {submitting ? 'Bridging…' : `Bridge via Relay (${route.sourceChainId} → ${route.targetChainId})`}
      </button>
    </div>
  );
}

function DepositStep({ state, onAdvance, onFail }: { state: PipelineState; onAdvance: RunProps['onAdvance']; onFail: RunProps['onFail'] }) {
  const deps = usePerpDeps();
  const accounts = useStrategyExchangeAccounts();
  const [submitting, setSubmitting] = useState(false);

  const handleDeposit = async () => {
    setSubmitting(true);
    try {
      const adapter = getAdapterByDex(state.target);
      const signFn = deps.getSignFn();
      const toAddr = accounts.byDex[state.target];
      if (!toAddr) throw new Error(`No ${state.target} address configured`);
      const hash = await adapter.deposit(
        {
          amount: parseFloat(state.amount),
          fromAddress: toAddr,
        },
        signFn,
      );
      deps.showToast({ title: `${state.target} deposit submitted`, type: 'success' });
      onAdvance('deposit', hash);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      onFail(`Deposit failed: ${m}`);
      deps.showToast({ title: `${state.target} deposit failed`, message: m, type: 'warning' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <button
      onClick={handleDeposit}
      disabled={submitting}
      className="text-[10px] font-semibold px-2 py-1 rounded disabled:opacity-40"
      style={{ color: '#AB9FF2', border: '1px solid rgba(171,159,242,0.35)' }}
    >
      {submitting ? 'Depositing…' : `Deposit to ${state.target}`}
    </button>
  );
}

// ── Done view ──────────────────────────────────────────────────────────

function PipelineDoneView({ state, onReset, onClose }: { state: PipelineState; onReset: () => void; onClose: () => void }) {
  const elapsed = Math.round((Date.now() - state.startedAt) / 1000);
  const route = findRoute(state.source, state.target);
  return (
    <div className="p-4 space-y-3">
      <div className="text-xs font-semibold text-white">
        Pipeline complete · {PERP_DEX_META[state.source].name} → {PERP_DEX_META[state.target].name}
      </div>
      <div className="text-[10px]" style={{ color: '#6B7580' }}>
        {state.amount} USDC · completed in {elapsed}s
      </div>
      <div className="rounded-md p-2.5 space-y-1" style={{ backgroundColor: '#0B141A', border: '1px solid #1F2A33' }}>
        {(['withdraw', 'bridge', 'deposit'] as const).map((leg) => {
          const h = state.txHashes[leg];
          if (!h) return null;
          const chain = leg === 'deposit' ? route?.targetChainId ?? 42161 : route?.sourceChainId ?? 42161;
          return (
            <div key={leg} className="flex items-center justify-between text-[10px]">
              <span style={{ color: '#949E9C' }} className="capitalize">{leg}</span>
              <TxLink hash={h} chainId={chain} />
            </div>
          );
        })}
      </div>
      <div className="flex gap-2">
        <button onClick={onReset} className="flex-1 py-1.5 text-[11px] rounded" style={{ backgroundColor: '#AB9FF2', color: '#0B1018' }}>
          Start another
        </button>
        <button onClick={onClose} className="flex-1 py-1.5 text-[11px] rounded" style={{ color: '#949E9C', border: '1px solid #273035' }}>
          Close
        </button>
      </div>
    </div>
  );
}
