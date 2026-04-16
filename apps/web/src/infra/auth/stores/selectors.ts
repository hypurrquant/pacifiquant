import type { AccountStore } from '@hq/react/auth';
import { getActiveWallet } from '@hq/react/auth/helpers/walletHelpers';
import type { EIP1193Provider } from '@/infra/auth/types';
import { getCachedWebWalletProvider, getWebWalletConnectedChainId } from '@/infra/auth/webWalletAdapter';

export const selectWalletProvider = (state: AccountStore): EIP1193Provider | null => {
  const wallet = getActiveWallet(state);
  return wallet.status === 'connected' ? getCachedWebWalletProvider(wallet.adapter) : null;
};

export const selectConnectedChainId = (state: AccountStore): number | null => {
  const wallet = getActiveWallet(state);
  return wallet.status === 'connected' ? getWebWalletConnectedChainId(wallet.adapter) : null;
};
