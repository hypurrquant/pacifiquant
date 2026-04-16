import type {
  AuthSource,
  WalletStatus,
  WalletNextAction,
  AAState,
  ActiveAccountSnapshot,
  ActiveAccountCapabilities,
} from '@hq/core/auth';
import { AUTH_SOURCES } from '@hq/core/auth';
import { FEATURES } from '@hq/core/config/features';
import type { AccountStore, PrivyStateL1 } from '../slices/types';
import {
  getActiveWallet,
  getProviderIdForAuthSource,
  getProviderRuntimeState,
} from '../helpers/walletHelpers';
import { resolveActiveAddress, resolveExecutionAddress } from '../helpers/addressHelpers';

function isPrivyReady(privy: PrivyStateL1): boolean {
  return privy.status === 'ready' || privy.status === 'authenticated';
}

function isPrivyAuthenticated(privy: PrivyStateL1): boolean {
  return privy.status === 'authenticated';
}

function computeWalletStatus(
  state: Pick<
    AccountStore,
    | 'authSelection'
    | 'privy'
    | 'executionSelection'
    | 'providerSelection'
    | 'providers'
    | 'sourceProviderIds'
  >,
  authSource: AuthSource | null,
): { walletStatus: WalletStatus; walletReason: string | undefined } {
  const { privy } = state;
  const activeWallet = getActiveWallet(state);

  if (!authSource) {
    return { walletStatus: 'idle', walletReason: undefined };
  }

  if (authSource === AUTH_SOURCES.PRIVY_TELEGRAM && !isPrivyAuthenticated(privy)) {
    return {
      walletStatus: isPrivyReady(privy) ? 'need_login' : 'idle',
      walletReason: 'Privy login required',
    };
  }

  if (authSource === AUTH_SOURCES.DIRECT_EOA && activeWallet.status !== 'connected') {
    return { walletStatus: 'need_login', walletReason: 'Browser wallet connection required' };
  }

  if (activeWallet.status === 'connected') {
    return { walletStatus: 'ready', walletReason: undefined };
  }

  if (authSource === AUTH_SOURCES.PRIVY_TELEGRAM && isPrivyAuthenticated(privy)) {
    return { walletStatus: 'idle', walletReason: 'Waiting for Privy wallet adapter' };
  }

  return { walletStatus: 'idle', walletReason: undefined };
}

function computeWalletNextAction(
  state: Pick<
    AccountStore,
    | 'authSelection'
    | 'privy'
    | 'providerSelection'
    | 'providers'
    | 'sourceProviderIds'
  >,
  authSource: AuthSource | null,
): WalletNextAction {
  const { privy } = state;
  const activeWallet = getActiveWallet(state);

  if (!authSource) {
    return { kind: 'none' };
  }

  if (authSource === AUTH_SOURCES.PRIVY_TELEGRAM && !isPrivyAuthenticated(privy) && isPrivyReady(privy)) {
    return { kind: 'login' };
  }

  if (authSource === AUTH_SOURCES.DIRECT_EOA && activeWallet.status !== 'connected') {
    return { kind: 'login' };
  }

  return { kind: 'none' };
}

function computeAAState(input: {
  kernelClient: AccountStore['kernelClient'];
  aaDeploymentStatus: AccountStore['aaDeploymentStatus'];
  isRegistered: AccountStore['isRegistered'];
}): AAState {
  if (!FEATURES.AA_ENABLED) {
    return { kind: 'disabled' };
  }

  if (!input.kernelClient) {
    return { kind: 'not_initialized' };
  }

  switch (input.aaDeploymentStatus) {
    case 'unknown':
    case 'checking':
      return { kind: 'checking_deployment' };
    case 'failed':
      return { kind: 'deploy_failed' };
    case 'not_deployed':
      return { kind: 'not_deployed' };
    case 'deployed':
      return { kind: 'deployed', registered: input.isRegistered };
  }
}

export function computeActiveAccount(state: AccountStore): ActiveAccountSnapshot {
  const {
    authSelection,
    executionSelection,
    privy,
    kernelAccount,
    kernelClient,
    aaDeploymentStatus: aaDeploymentStatusValue,
    error,
    isRegistered,
  } = state;
  const activeWallet = getActiveWallet(state);
  const eoaAddress = activeWallet.status === 'connected' ? activeWallet.eoaAddress : null;

  const authSource = authSelection.source;
  const executionMode = executionSelection.mode;
  const directEoaProviderId = getProviderIdForAuthSource(state, AUTH_SOURCES.DIRECT_EOA);
  const directEoaProvider = getProviderRuntimeState(state, directEoaProviderId);

  const aaAddress = kernelAccount?.address ?? null;
  const signerAddress = eoaAddress;
  const activeAddress = resolveActiveAddress({
    executionMode,
    signerAddress,
    aaAddress,
  });

  const { walletStatus, walletReason } = computeWalletStatus(state, authSource);
  const walletNextAction = computeWalletNextAction(state, authSource);
  const aaState = computeAAState({
    kernelClient,
    aaDeploymentStatus: aaDeploymentStatusValue,
    isRegistered,
  });
  const isAAEnabled = aaState.kind !== 'disabled';
  const isAAInitialized = aaState.kind !== 'disabled' && aaState.kind !== 'not_initialized';
  const isAADeployed = aaState.kind === 'deployed';

  const ready =
    walletStatus === 'ready' &&
    (executionMode === 'eoa' || (isAAEnabled && isAAInitialized && isAADeployed));

  const reason = walletReason ?? error ?? undefined;
  const canUseAAForDirectEOA = authSource === AUTH_SOURCES.DIRECT_EOA && activeWallet.status === 'connected';

  const capabilities: ActiveAccountCapabilities = {
    canUseAA: isAAEnabled && (isPrivyAuthenticated(privy) || canUseAAForDirectEOA),
    canSwitchToPrivy: isPrivyReady(privy),
    canSwitchToBrowser: directEoaProvider.availability === 'available',
    needsAADeploy: executionMode === 'aa' && isAAInitialized && !isAADeployed,
    needsChainSwitch: false,
    supportsBatch: executionMode === 'aa' && isAAInitialized && isAADeployed,
    canUseBridge: executionMode === 'eoa' && walletStatus === 'ready',
  };

  if (ready) {
    if (!authSource) {
      throw new Error('ActiveAccountSnapshot invariant violated: ready account requires authSource');
    }
    if (!signerAddress) {
      throw new Error('ActiveAccountSnapshot invariant violated: ready account requires signerAddress');
    }
    if (walletStatus !== 'ready') {
      throw new Error('ActiveAccountSnapshot invariant violated: ready account requires walletStatus=ready');
    }
    if (walletNextAction.kind !== 'none') {
      throw new Error('ActiveAccountSnapshot invariant violated: ready account requires walletNextAction=none');
    }

    const readyActiveAddress = resolveExecutionAddress({
      executionMode,
      signerAddress,
      aaAddress,
    });
    if (!readyActiveAddress) {
      throw new Error('ActiveAccountSnapshot invariant violated: ready account requires activeAddress');
    }

    return {
      ready: true,
      authSource,
      executionMode,
      activeAddress: readyActiveAddress,
      signerAddress,
      aaAddress,
      walletStatus: 'ready',
      walletNextAction,
      aaState,
      reason: undefined,
      capabilities,
    };
  }

  return {
    ready: false,
    authSource,
    executionMode,
    activeAddress,
    signerAddress,
    aaAddress,
    walletStatus,
    walletNextAction,
    aaState,
    reason,
    capabilities,
  };
}
