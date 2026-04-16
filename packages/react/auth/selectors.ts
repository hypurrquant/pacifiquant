import type { AccountStore } from './slices/types';
import { computeActiveAccount } from './apis/activeAccount';
import {
  getActiveWallet,
  getProviderIdForAuthSource,
  getProviderRuntimeState,
  resolveActiveProviderId,
} from './helpers/walletHelpers';
import { resolveExecutionAddress } from './helpers/addressHelpers';
import { AUTH_SOURCES, type WalletAdapter } from '@hq/core/auth';

export const selectIsConnected = (state: AccountStore) =>
  state.lifecycle !== 'idle' && state.lifecycle !== 'error';

export const selectIsReady = (state: AccountStore) =>
  state.lifecycle === 'ready';

export const selectHasError = (state: AccountStore) =>
  state.lifecycle === 'error';

export const selectAuthSource = (state: AccountStore) =>
  state.authSelection.source;

export const selectActiveProviderId = (state: AccountStore) =>
  resolveActiveProviderId(state);

export const selectExecutionMode = (state: AccountStore) =>
  state.executionSelection.mode;

export const selectIsAAMode = (state: AccountStore) =>
  state.executionSelection.mode === 'aa';

export const selectIsEOAMode = (state: AccountStore) =>
  state.executionSelection.mode === 'eoa';

export const selectIsPrivyAuth = (state: AccountStore) =>
  state.authSelection.source === AUTH_SOURCES.PRIVY_TELEGRAM;

export const selectIsDirectEOA = (state: AccountStore) =>
  state.authSelection.source === AUTH_SOURCES.DIRECT_EOA;

export const selectPrivyFailed = (state: AccountStore) =>
  state.privy.status === 'failed';

export const selectPrivyInitialized = (state: AccountStore) =>
  state.privy.status !== 'idle';

export const selectPrivyIdToken = (state: AccountStore) =>
  state.privy.status === 'authenticated' ? state.privy.idToken : null;

export const selectPrivyTelegramId = (state: AccountStore) =>
  state.privy.status === 'authenticated' ? state.privy.telegramId : null;

export const selectIsTelegramUser = (state: AccountStore) =>
  state.privy.status === 'authenticated' && state.privy.telegramId !== null;

export const selectAuthLifecycle = (state: AccountStore) => state.lifecycle;

export const selectPrivyUserId = (state: AccountStore) =>
  state.privy.status === 'authenticated' ? state.privy.privyUserId : null;

export const selectAuthError = (state: AccountStore) => state.error;

export const selectWalletStatus = (state: AccountStore) =>
  computeActiveAccount(state).walletStatus;

export const selectWalletNextAction = (state: AccountStore) =>
  computeActiveAccount(state).walletNextAction;

export const selectAAState = (state: AccountStore) =>
  computeActiveAccount(state).aaState;

export const selectIsWalletReady = (state: AccountStore) =>
  computeActiveAccount(state).walletStatus === 'ready';

export const selectIsAAReady = (state: AccountStore) =>
  computeActiveAccount(state).aaState.kind === 'deployed';

export const selectCanSwitchToAA = (state: AccountStore) =>
  selectIsAAReady(state);

export const selectAAAddress = (state: AccountStore): `0x${string}` | null =>
  state.kernelAccount?.address ?? null;

export const selectIsAADeploying = (state: AccountStore): boolean =>
  state.isDeploying;

export const selectIsAARegistering = (state: AccountStore): boolean =>
  state.isRegistering;

export const selectIsAARegistered = (state: AccountStore): boolean =>
  state.isRegistered;

export const selectSessionKeyAddress = (state: AccountStore): `0x${string}` | null =>
  state.sessionKeyAddress;

export const selectEOAAddress = (state: AccountStore): `0x${string}` | null => {
  const w = getActiveWallet(state);
  return w.status === 'connected' ? w.eoaAddress : null;
};

export const selectActiveAddress = (state: AccountStore): `0x${string}` | null =>
  computeActiveAccount(state).activeAddress;

export const selectExecutionAddress = (state: AccountStore): `0x${string}` | null =>
  resolveExecutionAddress({
    executionMode: state.executionSelection.mode,
    signerAddress: selectEOAAddress(state),
    aaAddress: selectAAAddress(state),
  });

export const selectWalletAdapter = (state: AccountStore): WalletAdapter | null => {
  const w = getActiveWallet(state);
  return w.status === 'connected' ? w.adapter : null;
};

export const selectHasAnyConnection = (state: AccountStore): boolean =>
  Object.values(state.providers).some((provider) => provider.wallet.status === 'connected');

export const selectActiveSourceConnected = (state: AccountStore): boolean =>
  getActiveWallet(state).status === 'connected';

export const selectDirectEOAProviderAvailable = (state: AccountStore): boolean =>
  getProviderRuntimeState(
    state,
    getProviderIdForAuthSource(state, AUTH_SOURCES.DIRECT_EOA)
  ).availability === 'available';
