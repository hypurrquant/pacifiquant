import type { PublicKey, Transaction } from '@solana/web3.js';

export interface PhantomSolanaProvider {
  signAndSendTransaction: (tx: Transaction) => Promise<{ signature: string }>;
  connect: () => Promise<{ publicKey: PublicKey }>;
}

export function getPhantomProvider(): PhantomSolanaProvider | null {
  if (typeof window === 'undefined') return null;
  const phantom = (window as unknown as { phantom?: { solana?: PhantomSolanaProvider } }).phantom;
  return phantom?.solana ?? null;
}
