import { ContextRequiredError } from '@hq/core/lib/error';
import type { EIP1193Provider, WalletAdapter } from '@/infra/auth/types';

export interface WebWalletAdapter extends WalletAdapter {
  getProvider(): Promise<EIP1193Provider | null>;
  getCachedProvider(): EIP1193Provider | null;
  getConnectedChainId(): number | null;
  setConnectedChainId(chainId: number | null): void;
}

function isWebWalletAdapter(adapter: WalletAdapter): adapter is WebWalletAdapter {
  const candidate = adapter as Partial<WebWalletAdapter>; // @ci-exception(type-assertion-count) — type guard implementation, widening to check optional members
  return (
    typeof candidate.getProvider === 'function' &&
    typeof candidate.getCachedProvider === 'function' &&
    typeof candidate.getConnectedChainId === 'function' &&
    typeof candidate.setConnectedChainId === 'function'
  );
}

export async function getWebWalletProvider(adapter: WalletAdapter): Promise<EIP1193Provider | null> {
  if (!isWebWalletAdapter(adapter)) return null;
  return adapter.getProvider();
}

export async function requireWebWalletProvider(
  adapter: WalletAdapter,
  message = 'Provider not available',
): Promise<EIP1193Provider> {
  const provider = await getWebWalletProvider(adapter);
  if (!provider) {
    throw new ContextRequiredError(message);
  }
  return provider;
}

export function getCachedWebWalletProvider(adapter: WalletAdapter): EIP1193Provider | null {
  if (!isWebWalletAdapter(adapter)) return null;
  return adapter.getCachedProvider();
}

export function getWebWalletConnectedChainId(adapter: WalletAdapter): number | null {
  if (!isWebWalletAdapter(adapter)) return null;
  return adapter.getConnectedChainId();
}

export function setWebWalletConnectedChainId(adapter: WalletAdapter, chainId: number | null): void {
  if (!isWebWalletAdapter(adapter)) return;
  adapter.setConnectedChainId(chainId);
}
