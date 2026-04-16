import { AUTH_SOURCES } from '@hq/core/auth';
import { createLogger } from '@hq/core/logging';
import { getProviderIdForAuthSource, getProviderRuntimeState } from '@hq/react/auth/helpers/walletHelpers';
import type { ZustandSetFn } from '@hq/react/auth/slices/types';
import { useAccountStore } from '@/infra/auth/stores';
import { webAuthSyncRuntime } from '@/infra/auth/createWebAccountStore';
import { getWebWalletConnectedChainId, setWebWalletConnectedChainId } from '@/infra/auth/webWalletAdapter';

const logger = createLogger('browserSync');

const getStore = () => useAccountStore.getState();
const setStore: ZustandSetFn = (partial, replace = false) => {
  useAccountStore.setState(partial, replace);
};

export const browserSync = {
  connected(address: `0x${string}`, chainId: number | null): void {
    const state = getStore();
    const browserProviderId = getProviderIdForAuthSource(state, AUTH_SOURCES.DIRECT_EOA);
    const bw = getProviderRuntimeState(state, browserProviderId).wallet;
    const prevAddress = bw.status === 'connected' ? bw.eoaAddress : null;
    const prevChainId = bw.status === 'connected' ? getWebWalletConnectedChainId(bw.adapter) : null;

    logger.info(`connected: address=${address}, chainId=${chainId}`);

    if (address !== prevAddress || chainId !== prevChainId) {
      if (browserProviderId && bw.status === 'connected') {
        setWebWalletConnectedChainId(bw.adapter, chainId ?? prevChainId);
        getStore().setEOAInfo(browserProviderId, {
          eoaAddress: address,
          adapter: bw.adapter,
        });
      } else {
        logger.error('[connected] address update skipped - provider wallet not connected');
      }
    }

    webAuthSyncRuntime.postSync(getStore, setStore, {
      trigger: 'browser_sync',
      prevAddress,
      newAddress: address,
      prevChainId,
      newChainId: chainId,
    });
  },

  accountChanged(address: `0x${string}`): void {
    const state = getStore();
    const browserProviderId = getProviderIdForAuthSource(state, AUTH_SOURCES.DIRECT_EOA);
    const bw = getProviderRuntimeState(state, browserProviderId).wallet;
    const prevAddress = bw.status === 'connected' ? bw.eoaAddress : null;
    const prevChainId = bw.status === 'connected' ? getWebWalletConnectedChainId(bw.adapter) : null;

    logger.info(`accountChanged: address=${address}`);

    if (address !== prevAddress) {
      if (browserProviderId && bw.status === 'connected') {
        setWebWalletConnectedChainId(bw.adapter, prevChainId);
        getStore().setEOAInfo(browserProviderId, {
          eoaAddress: address,
          adapter: bw.adapter,
        });
      } else {
        logger.error('[accountChanged] address update skipped - provider wallet not connected');
      }
    }

    webAuthSyncRuntime.postSync(getStore, setStore, {
      trigger: 'browser_sync',
      prevAddress,
      newAddress: address,
      prevChainId,
      newChainId: prevChainId,
    });
  },

  chainChanged(chainId: number | null): void {
    const state = getStore();
    const browserProviderId = getProviderIdForAuthSource(state, AUTH_SOURCES.DIRECT_EOA);
    const bw = getProviderRuntimeState(state, browserProviderId).wallet;
    const prevAddress = bw.status === 'connected' ? bw.eoaAddress : null;
    const prevChainId = bw.status === 'connected' ? getWebWalletConnectedChainId(bw.adapter) : null;

    logger.info(`chainChanged: chainId=${chainId}`);

    if (
      chainId !== prevChainId &&
      browserProviderId &&
      bw.status === 'connected'
    ) {
      setWebWalletConnectedChainId(bw.adapter, chainId);
      getStore().setEOAInfo(browserProviderId, {
        eoaAddress: bw.eoaAddress,
        adapter: bw.adapter,
      });
    }

    webAuthSyncRuntime.postSync(getStore, setStore, {
      trigger: 'browser_sync',
      prevAddress,
      newAddress: prevAddress,
      prevChainId,
      newChainId: chainId,
    });
  },
};
