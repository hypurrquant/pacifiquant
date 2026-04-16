import type { AccountStore } from '../slices/types';
import { AUTH_SOURCES, type AuthSource, type ExecutionMode } from '@hq/core/auth';
import { FEATURES } from '@hq/core/config/features';
import { getProviderIdForAuthSource, getProviderRuntimeState } from '../helpers/walletHelpers';

export type ReconcileAction =
  | { type: 'SET_EXECUTION_MODE'; payload: ExecutionMode }
  | { type: 'CLEAR_AA' }
  | { type: 'REQUEST_TOAST'; payload: string }
  | { type: 'LOG_ONLY'; payload: string }
  | { type: 'SET_AUTH_SOURCE'; payload: AuthSource }
  | { type: 'SET_AUTO_FALLBACK_DONE' };

export type ReconcileContext =
  | {
      trigger: 'browser_sync';
      prevAddress: `0x${string}` | null;
      newAddress: `0x${string}` | null;
      prevChainId: number | null;
      newChainId: number | null;
    }
  | { trigger: 'privy_sync' }
  | { trigger: 'mode_change' };

export interface ReconcilePolicy {
  id: string;
  name: string;
  priority: number;
  shortCircuit: boolean;
  shouldApply: (state: AccountStore, context: ReconcileContext) => boolean;
  getActions: (state: AccountStore, context: ReconcileContext) => ReconcileAction[];
}

export const aaKillSwitchPolicy: ReconcilePolicy = {
  id: '4.1',
  name: 'AA Kill Switch',
  priority: 1,
  shortCircuit: true,
  shouldApply: (state) => state.executionSelection.mode === 'aa' && !FEATURES.AA_ENABLED,
  getActions: () => [
    { type: 'SET_EXECUTION_MODE', payload: 'eoa' },
    { type: 'REQUEST_TOAST', payload: 'AA feature is disabled. Switched to EOA mode.' },
  ],
};

const connectionAutoFallbackPolicy: ReconcilePolicy = {
  id: '4.8',
  name: 'Connection Auto-Fallback',
  priority: 1.5,
  shortCircuit: true,
  shouldApply: (state) => {
    if (state.authSelection.isUserSelected) return false;
    if (state.autoFallbackDone) return false;

    const privyFailed = state.privy.status === 'failed';
    const privyReady = state.privy.status === 'ready' || state.privy.status === 'authenticated';
    const privyAuthenticated = state.privy.status === 'authenticated';
    const privyUnavailable = privyFailed || (privyReady && !privyAuthenticated);
    const directEoaProvider = getProviderRuntimeState(
      state,
      getProviderIdForAuthSource(state, AUTH_SOURCES.DIRECT_EOA)
    );
    const browserAvailable = directEoaProvider.availability === 'available';

    if (state.authSelection.source === AUTH_SOURCES.PRIVY_TELEGRAM && privyUnavailable && browserAvailable) {
      return true;
    }

    const browserUnavailable = directEoaProvider.availability === 'unavailable';
    const privyAvailable = privyReady && privyAuthenticated;

    if (state.authSelection.source === AUTH_SOURCES.DIRECT_EOA && browserUnavailable && privyAvailable) {
      return true;
    }

    return false;
  },
  getActions: (state) => {
    if (state.authSelection.source === AUTH_SOURCES.PRIVY_TELEGRAM) {
      return [
        { type: 'SET_AUTH_SOURCE', payload: AUTH_SOURCES.DIRECT_EOA },
        { type: 'REQUEST_TOAST', payload: 'Privy unavailable, switched to MetaMask' },
        { type: 'SET_AUTO_FALLBACK_DONE' },
      ];
    }

    if (state.authSelection.source === AUTH_SOURCES.DIRECT_EOA) {
      return [
        { type: 'SET_AUTH_SOURCE', payload: AUTH_SOURCES.PRIVY_TELEGRAM },
        { type: 'REQUEST_TOAST', payload: 'MetaMask unavailable, switched to Privy' },
        { type: 'SET_AUTO_FALLBACK_DONE' },
      ];
    }

    return [];
  },
};

export const browserAccountChangePolicy: ReconcilePolicy = {
  id: '4.7',
  name: 'Browser Account Change',
  priority: 2,
  shortCircuit: true,
  shouldApply: (state, context) => {
    if (context.trigger !== 'browser_sync') return false;
    return (
      !!context.prevAddress &&
      !!context.newAddress &&
      context.prevAddress !== context.newAddress &&
      state.executionSelection.mode === 'aa' &&
      state.authSelection.source === AUTH_SOURCES.DIRECT_EOA
    );
  },
  getActions: () => [
    { type: 'SET_EXECUTION_MODE', payload: 'eoa' },
    { type: 'CLEAR_AA' },
    { type: 'REQUEST_TOAST', payload: 'Wallet account changed. AA mode disabled, switched to EOA.' },
  ],
};

export const aaUninitializedPolicy: ReconcilePolicy = {
  id: '4.2',
  name: 'AA Uninitialized',
  priority: 4,
  shortCircuit: false,
  shouldApply: (state) =>
    state.executionSelection.mode === 'aa' &&
    FEATURES.AA_ENABLED &&
    !state.kernelClient,
  getActions: () => [
    { type: 'LOG_ONLY', payload: 'AA mode but not initialized - will show needs_aa_init status' },
  ],
};

export const allPolicies: ReconcilePolicy[] = [
  aaKillSwitchPolicy,
  connectionAutoFallbackPolicy,
  browserAccountChangePolicy,
  aaUninitializedPolicy,
].sort((a, b) => a.priority - b.priority);
