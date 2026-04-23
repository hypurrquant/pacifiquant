'use client';

import { useMemo, useState } from 'react';
import { parseUnits } from 'viem';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { getAdapterByDex } from '@/domains/perp/hooks/usePerpAdapter';
import type { PerpDexId } from '@/domains/perp/types/perp.types';
import { PERP_DEX_META, PERP_DEX_ORDER } from '@/shared/config/perp-dex-display';
import { useStrategyExchangeAccounts } from '@/domains/strategies/hooks/useStrategyExchangeAccounts';
import { usePerpDeps } from '@/domains/perp/providers/PerpDepsProvider';
import { usePipelineState, type PipelineState } from '../hooks/usePipelineState';
import { findRoute, type PipelineRoute } from '../utils/pipelineRoutes';
import { DEPOSIT_TARGETS, completesOnBridge } from '../utils/depositTargets';
import { buildDepositInstruction, getNetworkConfig } from '../utils/pacifica-deposit';
import { getPhantomProvider } from '../utils/phantom';

const RELAY_API_URL = 'https://api.relay.link';
const USDC_ADDRESSES: Record<number, string> = {
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  56: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  // Solana USDC SPL mint — Relay keys Solana by its magic chain id (792703809).
  792703809: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

interface PipelineTabProps {
  readonly onClose: () => void;
  /** When the parent (BridgeCard) already knows the source/target/amount,
   *  skip the built-in picker and pre-fill those values so the pipeline
   *  opens at the same choices as the surrounding form. */
  readonly initialSource?: PerpDexId;
  readonly initialTarget?: PerpDexId;
  readonly initialAmount?: string;
}

export function PipelineTab({ onClose, initialSource, initialTarget, initialAmount }: PipelineTabProps) {
  const { state, start, advanceStep, failStep, reset, retryFailed } = usePipelineState();

  if (state && state.step !== 'done') {
    return <PipelineRunView state={state} onAdvance={advanceStep} onFail={failStep} onReset={reset} onRetry={retryFailed} />;
  }
  if (state && state.step === 'done') {
    return <PipelineDoneView state={state} onReset={reset} onClose={onClose} />;
  }
  return (
    <PipelinePicker
      onStart={start}
      initialSource={initialSource}
      initialTarget={initialTarget}
      initialAmount={initialAmount}
    />
  );
}

function PipelinePicker({
  onStart,
  initialSource,
  initialTarget,
  initialAmount,
}: {
  onStart: (source: PerpDexId, target: PerpDexId, amount: string) => void;
  initialSource?: PerpDexId;
  initialTarget?: PerpDexId;
  initialAmount?: string;
}) {
  const [source, setSource] = useState<PerpDexId>(initialSource ?? 'hyperliquid');
  const [target, setTarget] = useState<PerpDexId>(initialTarget ?? 'pacifica');
  const [amount, setAmount] = useState<string>(initialAmount ?? '');
  const route = useMemo(() => findRoute(source, target), [source, target]);

  const targetCfg = DEPOSIT_TARGETS[target];
  const sameDex = source === target;
  const targetDisabled = targetCfg.kind === 'disabled';
  const amountNum = parseFloat(amount);
  const amountValid = amountNum > 0;
  const belowMin = amountValid && amountNum < targetCfg.minAmount;
  const canStart = !sameDex && !targetDisabled && amountValid && !belowMin && !!route;

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
      {route && !targetDisabled && (
        <div className="text-[10px] rounded px-2 py-1.5" style={{ color: '#8F9BA4', backgroundColor: '#0B141A', border: '1px solid #1F2A33' }}>
          Route · {route.bridgeKind === 'evm-evm' ? 'EVM → EVM' : 'EVM ↔ Solana'} via Relay · min {targetCfg.minAmount} USDC
        </div>
      )}
      {sameDex && (
        <div className="text-[10px]" style={{ color: '#FFA94D' }}>Source and target must differ.</div>
      )}
      {targetDisabled && (
        <div className="text-[10px]" style={{ color: '#FFA94D' }}>{targetCfg.disabledReason}</div>
      )}
      {belowMin && !targetDisabled && (
        <div className="text-[10px]" style={{ color: '#FFA94D' }}>Minimum {targetCfg.minAmount} USDC for {PERP_DEX_META[target].name}.</div>
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

interface RunProps {
  readonly state: PipelineState;
  readonly onAdvance: (leg: 'withdraw' | 'bridge' | 'deposit', hash: string) => void;
  readonly onFail: (err: string) => void;
  readonly onReset: () => void;
  readonly onRetry: () => void;
}

export function PipelineRunView({ state, onAdvance, onFail, onReset, onRetry }: RunProps) {
  const route = findRoute(state.source, state.target);
  if (!route) {
    return (
      <div className="p-4 text-xs" style={{ color: '#ED7088' }}>
        Unknown route. <button onClick={onReset} className="underline">Reset</button>
      </div>
    );
  }
  const showDepositStep = !completesOnBridge(state.target);
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
      {showDepositStep && (
        <StepRow
          label={`Deposit to ${PERP_DEX_META[state.target].name}`}
          active={state.step === 'deposit'}
          done={!!state.txHashes.deposit}
        >
          {state.step === 'deposit' && (
            <PacificaDepositStep state={state} onAdvance={onAdvance} onFail={onFail} />
          )}
          {state.txHashes.deposit && (
            <TxLink hash={state.txHashes.deposit} chainId={route.targetChainId} />
          )}
        </StepRow>
      )}
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
  const targetCfg = DEPOSIT_TARGETS[state.target];

  const handleBridge = async () => {
    if (needsPhantom && !pacificaAddress) {
      onFail('Connect Phantom first — the Solana leg needs a destination pubkey.');
      return;
    }
    setSubmitting(true);
    try {
      const sourceUsdc = USDC_ADDRESSES[route.sourceChainId];
      const targetUsdc = USDC_ADDRESSES[targetCfg.chainId];
      if (!sourceUsdc || !targetUsdc) {
        throw new Error(`USDC address missing for chain ${route.sourceChainId} or ${targetCfg.chainId}`);
      }
      const sourceAddr = accounts.byDex[state.source] ?? '';
      if (!sourceAddr) throw new Error('Missing source wallet address.');
      const recipient = await targetCfg.resolveRecipient({ userEvmAddress: sourceAddr, pacificaAddress });
      if (!recipient) throw new Error('Failed to resolve target recipient.');
      // parseUnits avoids float multiplication — USDC input comes in as a string,
      // so we never materialize the lamport count through a lossy Number path.
      const amountRaw = parseUnits(state.amount, 6).toString();
      const res = await fetch(`${RELAY_API_URL}/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: sourceAddr,
          originChainId: route.sourceChainId,
          destinationChainId: targetCfg.chainId,
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
        {submitting ? 'Bridging…' : `Bridge via Relay (${route.sourceChainId} → ${targetCfg.chainId})`}
      </button>
    </div>
  );
}

function PacificaDepositStep({ state, onAdvance, onFail }: { state: PipelineState; onAdvance: RunProps['onAdvance']; onFail: RunProps['onFail'] }) {
  const deps = usePerpDeps();
  const accounts = useStrategyExchangeAccounts();
  const [submitting, setSubmitting] = useState(false);
  const pacificaAddress = accounts.pacifica;

  const handleDeposit = async () => {
    if (!pacificaAddress) {
      onFail('Phantom disconnected — reconnect Solana wallet to complete the deposit.');
      return;
    }
    const provider = getPhantomProvider();
    if (!provider) {
      onFail('Phantom provider not found. Install or unlock Phantom and try again.');
      return;
    }
    setSubmitting(true);
    try {
      const userPubkey = new PublicKey(pacificaAddress);
      const amountLamports = parseUnits(state.amount, 6);
      const ix = await buildDepositInstruction(userPubkey, amountLamports, 'mainnet');
      const config = getNetworkConfig('mainnet');
      const connection = new Connection(config.rpcUrl, 'confirmed');
      const tx = new Transaction().add(ix);
      tx.feePayer = userPubkey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const { signature } = await provider.signAndSendTransaction(tx);
      await connection.confirmTransaction(signature, 'confirmed');
      deps.showToast({ title: 'Pacifica deposit submitted', type: 'success' });
      onAdvance('deposit', signature);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      onFail(`Deposit failed: ${m}`);
      deps.showToast({ title: 'Pacifica deposit failed', message: m, type: 'warning' });
    } finally {
      setSubmitting(false);
    }
  };

  if (!pacificaAddress) {
    return (
      <div className="text-[10px]" style={{ color: '#FFA94D' }}>
        Phantom disconnected — reconnect Solana wallet to finish the deposit.
      </div>
    );
  }

  return (
    <button
      onClick={handleDeposit}
      disabled={submitting}
      className="text-[10px] font-semibold px-2 py-1 rounded disabled:opacity-40"
      style={{ color: '#AB9FF2', border: '1px solid rgba(171,159,242,0.35)' }}
    >
      {submitting ? 'Depositing…' : `Deposit ${state.amount} USDC to Pacifica`}
    </button>
  );
}

export function PipelineDoneView({ state, onReset, onClose }: { state: PipelineState; onReset: () => void; onClose: () => void }) {
  const elapsed = Math.round((Date.now() - state.startedAt) / 1000);
  const route = findRoute(state.source, state.target);
  const bridgeTerminal = completesOnBridge(state.target);
  return (
    <div className="p-4 space-y-3">
      <div className="text-xs font-semibold text-white">
        Pipeline complete · {PERP_DEX_META[state.source].name} → {PERP_DEX_META[state.target].name}
      </div>
      <div className="text-[10px]" style={{ color: '#6B7580' }}>
        {state.amount} USDC · completed in {elapsed}s
      </div>
      {bridgeTerminal && (
        <div className="text-[10px]" style={{ color: '#6B7580' }}>
          Credit usually arrives in 1–3 minutes on {PERP_DEX_META[state.target].name}.
        </div>
      )}
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
