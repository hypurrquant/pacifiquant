import type { SyncPrivyAction } from '@hq/core/auth';
import { AUTH_SOURCES } from '@hq/core/auth';
import { createLogger } from '@hq/core/logging';
import { FEATURES } from '@hq/core/config/features';
import type { AccountStore, PrivyStateL1, ZustandSetFn } from '../slices/types';
import {
  getActiveWallet,
  getProviderIdForAuthSource,
  getProviderRuntimeState,
} from '../helpers/walletHelpers';
import { runReconcile } from '../policies/policyRunner';
import { allPolicies, type ReconcileContext } from '../policies/reconcilePolicy';
import { computeActiveAccount } from './activeAccount';
import type { AccountStoreDeps } from '../deps';

const logger = createLogger('syncState');
const AA_CHECK_DEBOUNCE_MS = 300;

function reducePrivyAction(action: SyncPrivyAction, current: PrivyStateL1): PrivyStateL1 {
  switch (action.kind) {
    case 'sdk_snapshot': {
      if (action.authenticated) {
        return {
          status: 'authenticated',
          idToken: action.idToken,
          telegramId: action.telegramId,
          privyUserId: action.privyUserId,
        };
      }

      if (action.ready) {
        return { status: 'ready' };
      }

      return { status: 'idle' };
    }

    case 'init_timeout':
      return { status: 'failed' };

    case 'embedded_address_changed':
      return current;
  }
}

export interface SyncRuntime {
  postSync(
    get: () => AccountStore,
    set: ZustandSetFn,
    context: ReconcileContext
  ): void;
  syncPrivyState(
    get: () => AccountStore,
    set: ZustandSetFn,
    action: SyncPrivyAction
  ): void;
}

export function createSyncRuntime(deps: Pick<AccountStoreDeps, 'timers' | 'effects'>): SyncRuntime {
  let aaCheckDebounceTimer: unknown = null;

  async function triggerAACheck(
    get: () => AccountStore,
    set: ZustandSetFn
  ): Promise<void> {
    const state = get();

    if (!FEATURES.AA_ENABLED) {
      logger.info('triggerAACheck skipped - AA feature disabled');
      return;
    }

    if (state.aaDeploymentStatus !== 'unknown') {
      logger.info(`triggerAACheck skipped - deployment status already determined (${state.aaDeploymentStatus})`);
      return;
    }

    const snapshot = computeActiveAccount(state);
    if (snapshot.walletStatus !== 'ready') {
      logger.info(`triggerAACheck skipped - walletStatus=${snapshot.walletStatus}`);
      return;
    }

    if (state.kernelClient) {
      logger.info('triggerAACheck skipped - kernelClient already exists');
      return;
    }

    const activeWallet = getActiveWallet(state);
    if (activeWallet.status !== 'connected') {
      logger.info('triggerAACheck skipped - no adapter');
      return;
    }

    const authSource = state.authSelection.source;
    const privy = state.privy;

    logger.info(`triggerAACheck starting... (authSource=${authSource})`);
    set({ aaDeploymentStatus: 'checking' }, false, 'syncState/triggerAACheck:start');

    try {
      const existingAAAddress = state.kernelAccount?.address;
      if (existingAAAddress) {
        logger.info('triggerAACheck: checking existing AA address deployment status');
        const isDeployed = await get().checkAADeployed(existingAAAddress);
        logger.info(`triggerAACheck: existing AA deployed=${isDeployed}`);
        return;
      }

      const privyIdToken = privy.status === 'authenticated' ? privy.idToken : null;
      if (authSource === AUTH_SOURCES.PRIVY_TELEGRAM && privy.status === 'authenticated' && privyIdToken) {
        logger.info('triggerAACheck: Privy authenticated, calling initializeAAWithSigner(adapter)');
        await get().initializeAAWithSigner(activeWallet.adapter, { idToken: privyIdToken });
        const currentStatus = get().aaDeploymentStatus;
        if (currentStatus === 'checking') {
          set({ aaDeploymentStatus: 'unknown' }, false, 'syncState/triggerAACheck:initSuccess');
        }
        logger.info('triggerAACheck completed with full initialization');
      } else if (authSource === AUTH_SOURCES.DIRECT_EOA) {
        logger.info('triggerAACheck: Direct-EOA - skipping auto AA init (requires user action)');
      } else {
        logger.info('triggerAACheck: Insufficient auth info for AA init');
      }
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logger.error(`triggerAACheck failed: ${errorMsg}`);
      set({ aaDeploymentStatus: 'failed' }, false, 'syncState/triggerAACheck:failed');
    }
  }

  function debouncedAACheck(
    get: () => AccountStore,
    set: ZustandSetFn
  ): void {
    if (aaCheckDebounceTimer) {
      deps.timers.clearTimeout(aaCheckDebounceTimer);
    }
    aaCheckDebounceTimer = deps.timers.setTimeout(() => {
      void triggerAACheck(get, set).catch((e) => {
        logger.warn(`debouncedAACheck error: ${e}`);
      });
    }, AA_CHECK_DEBOUNCE_MS);
  }

  function postSync(
    get: () => AccountStore,
    set: ZustandSetFn,
    context: ReconcileContext
  ): void {
    runReconcile(get, set, context, allPolicies, deps.effects);
    debouncedAACheck(get, set);
  }

  return {
    postSync,

    syncPrivyState(
      get: () => AccountStore,
      set: ZustandSetFn,
      action: SyncPrivyAction
    ): void {
      const state = get();

      logger.info(`syncPrivyState: kind=${action.kind}`);

      const newPrivy = reducePrivyAction(action, state.privy);
      const updates: Partial<AccountStore> = {};

      if (
        newPrivy.status !== state.privy.status ||
        (newPrivy.status === 'authenticated' && state.privy.status === 'authenticated' &&
          (newPrivy.idToken !== state.privy.idToken ||
           newPrivy.telegramId !== state.privy.telegramId ||
           newPrivy.privyUserId !== state.privy.privyUserId))
      ) {
        updates.privy = newPrivy;
      }

      if (action.kind === 'embedded_address_changed') {
        const embeddedAddress = action.embeddedAddress;
        const privyProviderId = getProviderIdForAuthSource(state, AUTH_SOURCES.PRIVY_TELEGRAM);
        const pw = getProviderRuntimeState(state, privyProviderId).wallet;
        const currentAddress = pw.status === 'connected' ? pw.eoaAddress : null;
        if (embeddedAddress !== currentAddress) {
          if (embeddedAddress && privyProviderId && pw.status === 'connected') {
            get().setEOAInfo(privyProviderId, {
              eoaAddress: embeddedAddress,
              adapter: pw.adapter,
            });
          } else {
            logger.info('[syncPrivyState] embeddedAddress update skipped (provider wallet not connected or null)');
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        set(updates, false, 'syncPrivyState:update');
      }

      const context: ReconcileContext = {
        trigger: 'privy_sync',
      };
      postSync(get, set, context);
    },
  };
}
