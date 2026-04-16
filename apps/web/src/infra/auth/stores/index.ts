'use client';

export * from './useAccountStore';
export {
  selectWalletProvider,
  selectConnectedChainId,
} from './selectors';
export {
  selectIsConnected,
  selectIsReady,
  selectHasError,
  selectAuthSource,
  selectExecutionMode,
  selectIsAAMode,
  selectIsEOAMode,
  selectIsPrivyAuth,
  selectIsDirectEOA,
  selectPrivyFailed, // v0.20.14
  selectPrivyInitialized, // v1.42.2
  selectPrivyIdToken, // v0.20.15
  selectPrivyTelegramId, // v0.20.15
  selectIsTelegramUser, // v0.20.15
  selectAuthLifecycle, // v0.20.15
  selectAuthError, // v0.20.15
  selectPrivyUserId, // v0.20.19
  selectAAAddress, // v0.20.16
  selectActiveAddress,
  selectIsAADeploying, // v0.20.16
  selectIsAARegistering, // v0.20.16
  selectIsAARegistered, // v0.20.16
  selectSessionKeyAddress, // v0.20.16
  selectEOAAddress, // v0.20.17
  selectExecutionAddress,
  selectWalletAdapter, // v0.20.17
  selectWalletStatus,
  selectWalletNextAction,
  selectAAState,
  selectIsWalletReady,
  selectIsAAReady,
  selectCanSwitchToAA,
  selectHasAnyConnection, // v0.32.0
  selectActiveSourceConnected, // v0.32.0
} from '@hq/react/auth';
export { useSessionKeyStore } from '@hq/react/auth';
export { WalletNotReadyError } from '@hq/core/auth';
export type { AccountStore, ExecuteTxOptions } from '@hq/react/auth';
