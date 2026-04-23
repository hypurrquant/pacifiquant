'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PerpDexId } from '@/domains/perp/types/perp.types';
import { completesOnBridge } from '../utils/depositTargets';

export type PipelineStep = 'withdraw' | 'bridge' | 'deposit' | 'done' | 'failed';

type PipelineLeg = 'withdraw' | 'bridge' | 'deposit';

// Single source of truth for step transitions. Both `advanceStep` (forward) and
// `retryFailed` (recovery) consult this so HL/Lighter can't desync into a
// phantom 'deposit' state that has no UI row after the restructure.
function nextStepAfter(leg: PipelineLeg, target: PerpDexId): PipelineStep {
  if (leg === 'withdraw') return 'bridge';
  if (leg === 'bridge') return completesOnBridge(target) ? 'done' : 'deposit';
  return 'done';
}

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

  const advanceStep = useCallback((leg: PipelineLeg, hash: string) => {
    setState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        step: nextStepAfter(leg, prev.target),
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
      // Recovery mirrors advanceStep via nextStepAfter — if the most recent
      // leg produced a hash, we resume at whatever comes after that leg.
      const lastCompleted: PipelineLeg | null = prev.txHashes.bridge
        ? 'bridge'
        : prev.txHashes.withdraw
          ? 'withdraw'
          : null;
      const recover: PipelineStep = lastCompleted
        ? nextStepAfter(lastCompleted, prev.target)
        : 'withdraw';
      return { ...prev, step: recover, error: null };
    });
  }, []);

  return { state, start, advanceStep, failStep, reset, retryFailed };
}
