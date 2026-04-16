import { FEATURES } from '@hq/core/config/features';
import { createLogger } from '@hq/core/logging';
import type { AuthSlice, AuthSliceState, SliceCreator } from './types';
import { AUTH_SOURCES, type AuthSource, type AuthSourceProviderMap, type ExecutionMode } from '@hq/core/auth';

const logger = createLogger('authSlice');

export function createAuthInitialState(sourceProviderIds: AuthSourceProviderMap): AuthSliceState {
  return {
    privy: { status: 'idle' },
    authSelection: { source: null, isUserSelected: false },
    providerSelection: { activeProviderId: null, isUserSelected: false },
    sourceProviderIds,
    executionSelection: {
      mode: FEATURES.AA_ENABLED ? 'aa' : 'eoa',
      isUserSelected: false,
    },
    lifecycle: 'idle',
    autoFallbackDone: false,
    error: null,
  };
}

export function createAuthSlice(sourceProviderIds: AuthSourceProviderMap): SliceCreator<AuthSlice> {
  return (set, get) => ({
    ...createAuthInitialState(sourceProviderIds),

    chooseAuthSource: (source: AuthSource) => {
      const state = get();
      const updates: Partial<AuthSlice> = {
        authSelection: { source, isUserSelected: true },
        providerSelection: {
          activeProviderId: state.sourceProviderIds[source] ?? null,
          isUserSelected: true,
        },
      };

      if (!state.executionSelection.isUserSelected) {
        const defaultMode = source === AUTH_SOURCES.PRIVY_TELEGRAM ? 'aa' : 'eoa';
        if (FEATURES.AA_ENABLED || defaultMode === 'eoa') {
          updates.executionSelection = {
            mode: defaultMode,
            isUserSelected: false,
          };
        }
      }

      set(updates, false, 'auth/chooseAuthSource');
    },

    chooseExecutionMode: (mode: ExecutionMode) => {
      if (!FEATURES.AA_ENABLED && mode === 'aa') {
        logger.warn('chooseExecutionMode: AA mode blocked (AA_ENABLED=false)');
        return;
      }

      set(
        {
          executionSelection: { mode, isUserSelected: true },
        },
        false,
        'auth/chooseExecutionMode'
      );
    },

    setLifecycle: (lifecycle) => {
      set({ lifecycle }, false, 'auth/setLifecycle');
    },

    setAutoFallbackDone: (done) => {
      set({ autoFallbackDone: done }, false, 'auth/setAutoFallbackDone');
    },

    setError: (error) => {
      set({ error }, false, 'auth/setError');
    },
  });
}
