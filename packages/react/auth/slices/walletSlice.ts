import type { WalletSlice, SliceCreator, WalletStateL1, ProviderRuntimeState } from './types';
import type { WalletProviderId } from '@hq/core/auth';
import { createLogger } from '@hq/core/logging';

const logger = createLogger('walletSlice');

function createDefaultProviderState(): ProviderRuntimeState {
  return {
    availability: 'unknown',
    wallet: { status: 'disconnected' } satisfies WalletStateL1,
  };
}

export const walletInitialState = {
  providers: {} as Record<WalletProviderId, ProviderRuntimeState>,
};

export const createWalletSlice: SliceCreator<WalletSlice> = (set, get) => ({
  ...walletInitialState,

  setProviderAvailability: (providerId, available) => {
    const prev = get().providers[providerId] ?? createDefaultProviderState();
    const nextAvailability = available ? 'available' : 'unavailable';
    if (prev.availability === nextAvailability) return;

    set({
      providers: {
        ...get().providers,
        [providerId]: {
          ...prev,
          availability: nextAvailability,
        },
      },
    }, false, `wallet/setProviderAvailability(${providerId})`);
  },

  setEOAInfo: (providerId, info) => {
    const isAllNull = !info.eoaAddress && !info.adapter;
    const isAllValid = info.eoaAddress && info.adapter;

    if (!isAllNull && !isAllValid) {
      logger.error('Invalid state: incomplete wallet info', undefined, {
        providerId,
        eoaAddress: !!info.eoaAddress,
        adapter: !!info.adapter,
      });
      return;
    }

    const wallet: WalletStateL1 = isAllNull
      ? { status: 'disconnected' }
      : {
          status: 'connected',
          eoaAddress: info.eoaAddress!,
          adapter: info.adapter!,
        };

    const prev = get().providers[providerId] ?? createDefaultProviderState();
    set({
      providers: {
        ...get().providers,
        [providerId]: {
          ...prev,
          wallet,
        },
      },
    }, false, `wallet/setEOAInfo(${providerId})`);
  },

  getProviderState: (providerId) => {
    if (!providerId) return createDefaultProviderState();
    return get().providers[providerId] ?? createDefaultProviderState();
  },
});
