import { createJSONStorage } from 'zustand/middleware';
import { createAccountStore } from '@hq/react/auth';
import { createSyncRuntime } from '@hq/react/auth/apis/syncState';
import { getActiveWallet } from '@hq/react/auth/helpers/walletHelpers';
import { AATxExecutor, EOATxExecutor, type WalletAdapter } from '@hq/core/auth';
import { TxError, TX_ERROR_CODES } from '@hq/core/lib/error';
import { createAASlice, aaInitialState } from '@/infra/auth/stores/slices/aaSlice';
import { storeEvents } from '@/infra/lib/eventBus';
import { showToast } from '@/infra/lib/toastHandler';
import { ensureChainReady } from '@/infra/auth/utils/chainPreflight';
import { WEB_AUTH_SOURCE_PROVIDER_IDS } from '@/infra/auth/providerIds';
import { getWebWalletProvider, setWebWalletConnectedChainId } from '@/infra/auth/webWalletAdapter';

const webEffects = {
  invalidateChainData: () => {
    storeEvents.emit('invalidate:chain-data');
  },
  notify: ({ title, message, type }: { title: string; message: string | null; type: 'info' | 'warning' | 'error' }) => {
    showToast({
      title,
      message: message ?? undefined,
      type: type === 'error' ? 'warning' : type,
    });
  },
};

const webTimers = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>), // @ci-exception(type-assertion-count)
};

export const webAuthSyncRuntime = createSyncRuntime({
  effects: webEffects,
  timers: webTimers,
});

export const useWebAccountStore = createAccountStore({
  providers: {
    sourceProviderIds: WEB_AUTH_SOURCE_PROVIDER_IDS,
  },
  persist: {
    name: 'account-storage',
    version: 6,
    storage: createJSONStorage(() => localStorage)!, // @ci-exception(type-assertion-count)
  },
  effects: webEffects,
  timers: webTimers,
  txRuntime: {
    createExecutor: async (adapter: WalletAdapter, input) => {
      if (input.mode === 'aa') {
        return new AATxExecutor(input.kernelClient);
      }

      const provider = await getWebWalletProvider(adapter);
      if (!provider) {
        throw new TxError(TX_ERROR_CODES.UNKNOWN, 'EOA provider not available', null);
      }
      return new EOATxExecutor(provider, input.eoaAddress);
    },
    ensureChainReady: async ({ targetChainId }) => {
      const activeWallet = getActiveWallet(useWebAccountStore.getState());
      if (activeWallet.status !== 'connected') {
        throw new TxError(TX_ERROR_CODES.UNKNOWN, 'No wallet adapter available', null);
      }
      const provider = await getWebWalletProvider(activeWallet.adapter);
      if (!provider) {
        throw new TxError(TX_ERROR_CODES.UNKNOWN, 'EOA provider not available', null);
      }
      await ensureChainReady({ provider, targetChainId });
      setWebWalletConnectedChainId(activeWallet.adapter, targetChainId);
    },
  },
  aaInitialState,
  createAASlice,
}, webAuthSyncRuntime);
