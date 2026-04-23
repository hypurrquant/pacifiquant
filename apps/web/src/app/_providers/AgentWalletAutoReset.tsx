'use client';

import { useEffect, useRef } from 'react';
import { useAccountStore, selectEOAAddress } from '@/infra/auth/stores';
import { useAgentWalletStore } from '@/domains/perp/stores/useAgentWalletStore';
import { usePacificaAgentStore } from '@/domains/perp/stores/usePacificaAgentStore';
import { useLighterAgentStore } from '@/domains/perp/stores/useLighterAgentStore';
import { useAsterAgentStore } from '@/domains/perp/stores/useAsterAgentStore';

// Per-DEX agent wallets are bound to a specific master EOA. When the user
// switches wallets (MetaMask accountChanged, Privy relogin, or disconnect),
// the old agent keys would silently sign for the new account — wiping them
// on EOA identity change forces a fresh approval under the new master.
//
// We watch selectEOAAddress, not selectActiveAddress: the latter can flip
// between EOA and smart-account without the user actually changing wallets
// (e.g., toggling execution mode), which would incorrectly disconnect.
export function AgentWalletAutoReset() {
  const address = useAccountStore(selectEOAAddress);
  const previousAddressRef = useRef<string | null>(address ?? null);

  useEffect(() => {
    const prev = previousAddressRef.current;
    const curr = address ? address.toLowerCase() : null;
    const normalizedPrev = prev ? prev.toLowerCase() : null;
    if (normalizedPrev === curr) return;
    previousAddressRef.current = curr;
    // Fire on: (a) connected → different address, (b) connected → disconnected.
    // Skip the initial null → first address transition so a fresh load
    // doesn't spuriously wipe previously-approved agent keys.
    const wasConnected = normalizedPrev !== null;
    if (wasConnected) {
      useAgentWalletStore.getState().disconnect();
      usePacificaAgentStore.getState().disconnect();
      useLighterAgentStore.getState().disconnect();
      useAsterAgentStore.getState().disconnect();
    }
  }, [address]);

  return null;
}
