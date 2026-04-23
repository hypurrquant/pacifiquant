'use client';

/**
 * usePipelineState — minimal cross-DEX pipeline state machine persisted to
 * localStorage. A page reload mid-flow restores the step view so the user
 * can resume instead of having to re-enter source/target/amount.
 */

import { useCallback, useEffect, useState } from 'react';
import type { PerpDexId } from '@/domains/perp/types/perp.types';

export type PipelineStep = 'withdraw' | 'bridge' | 'deposit' | 'done' | 'failed';

export interface PipelineState {
  readonly id: string;
  readonly source: PerpDexId;
  readonly target: PerpDexId;
  readonly amount: string;
  readonly step: PipelineStep;
  readonly txHashes: Partial<Record<'withdraw' | 'bridge' | 'deposit', string>>;
  readonly error: string | null;
  readonly startedAt: number;
}

const LS_KEY = 'hq-pipeline-v1';

function load(): PipelineState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PipelineState;
  } catch {
    return null;
  }
}

function save(state: PipelineState | null): void {
  if (typeof window === 'undefined') return;
  if (state === null) {
    window.localStorage.removeItem(LS_KEY);
    return;
  }
  window.localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function usePipelineState() {
  const [state, setState] = useState<PipelineState | null>(() => load());

  useEffect(() => {
    save(state);
  }, [state]);

  const start = useCallback((source: PerpDexId, target: PerpDexId, amount: string) => {
    const next: PipelineState = {
      id: genId(),
      source,
      target,
      amount,
      step: 'withdraw',
      txHashes: {},
      error: null,
      startedAt: Date.now(),
    };
    setState(next);
    return next;
  }, []);

  const advanceStep = useCallback((leg: 'withdraw' | 'bridge' | 'deposit', hash: string) => {
    setState((prev) => {
      if (!prev) return prev;
      const nextStep: PipelineStep = leg === 'withdraw' ? 'bridge' : leg === 'bridge' ? 'deposit' : 'done';
      return {
        ...prev,
        step: nextStep,
        txHashes: { ...prev.txHashes, [leg]: hash },
        error: null,
      };
    });
  }, []);

  const failStep = useCallback((err: string) => {
    setState((prev) => (prev ? { ...prev, step: 'failed', error: err } : prev));
  }, []);

  const reset = useCallback(() => {
    setState(null);
  }, []);

  const retryFailed = useCallback(() => {
    setState((prev) => {
      if (!prev || prev.step !== 'failed') return prev;
      const recover: PipelineStep = prev.txHashes.withdraw
        ? prev.txHashes.bridge
          ? 'deposit'
          : 'bridge'
        : 'withdraw';
      return { ...prev, step: recover, error: null };
    });
  }, []);

  return { state, start, advanceStep, failStep, reset, retryFailed };
}
