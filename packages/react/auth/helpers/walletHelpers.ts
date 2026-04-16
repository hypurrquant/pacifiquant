import type { AuthSource, WalletProviderId } from '@hq/core/auth';
import type {
  WalletConnectionState,
  ProviderRuntimeState,
} from '../slices/types';

interface WalletHelperState {
  providers: Record<WalletProviderId, ProviderRuntimeState>;
  authSelection: { source: AuthSource | null };
  providerSelection: { activeProviderId: WalletProviderId | null };
  sourceProviderIds: Partial<Record<AuthSource, WalletProviderId>>;
}

const DISCONNECTED_WALLET: WalletConnectionState = { status: 'disconnected' };

function createDefaultProviderRuntimeState(): ProviderRuntimeState {
  return {
    availability: 'unknown',
    wallet: DISCONNECTED_WALLET,
  };
}

export function getProviderIdForAuthSource(
  state: Pick<WalletHelperState, 'sourceProviderIds'>,
  authSource: AuthSource | null,
): WalletProviderId | null {
  if (!authSource) return null;
  return state.sourceProviderIds[authSource] ?? null;
}

export function resolveActiveProviderId(state: WalletHelperState): WalletProviderId | null {
  return state.providerSelection.activeProviderId ?? getProviderIdForAuthSource(state, state.authSelection.source);
}

export function getProviderRuntimeState(
  state: Pick<WalletHelperState, 'providers'>,
  providerId: WalletProviderId | null,
): ProviderRuntimeState {
  if (!providerId) return createDefaultProviderRuntimeState();
  return state.providers[providerId] ?? createDefaultProviderRuntimeState();
}

export function getWalletByProviderId(
  state: Pick<WalletHelperState, 'providers'>,
  providerId: WalletProviderId | null,
): WalletConnectionState {
  return getProviderRuntimeState(state, providerId).wallet;
}

export function getActiveWallet(state: WalletHelperState): WalletConnectionState {
  return getWalletByProviderId(state, resolveActiveProviderId(state));
}
