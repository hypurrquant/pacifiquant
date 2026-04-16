'use client';

/**
 * /perp — Perpetual Trading Page
 *
 * Uses the EOA address (not `selectActiveAddress`) because all three EVM
 * perp venues (Hyperliquid, Aster, Lighter) key positions and accept
 * EIP-712 signatures by the signer's EOA. `selectActiveAddress` resolves
 * to the AA address when `executionSelection.mode === 'aa'` (our default),
 * which would point every query/WS subscription at the smart-wallet
 * address. That address has no HL/Aster/Lighter account unless the user
 * explicitly deposited via AA, so panels stay empty even when the EOA
 * holds balances.
 */

import { useAccountStore, selectEOAAddress } from '@/infra/auth/stores';
import { PerpDepsProvider } from '@/domains/perp/providers/PerpDepsProvider';
import { TradingLayout } from '@/domains/perp/components/TradingLayout';
import { createWebPerpDeps } from '@/domains/perp/adapters/perpWebDeps';

const deps = createWebPerpDeps();

export default function PerpPage() {
  const walletAddress = useAccountStore(selectEOAAddress);

  return (
    <PerpDepsProvider deps={deps}>
      <TradingLayout walletAddress={walletAddress} />
    </PerpDepsProvider>
  );
}
