/**
 * Unified "is the agent ready to sign?" selector across all 4 DEX stores.
 *
 * Each DEX tracks agent readiness under its own selector:
 *   - HL:       `selectIsAgentActive`       (has approved agent + not expired)
 *   - Pacifica: `selectPacificaAgentActive` (has Ed25519 agent secret)
 *   - Lighter:  `selectLighterAgentActive`  (has WASM-signed API key)
 *   - Aster:    `selectAsterAgentActive`    (has EIP-712 agent + not expired)
 *
 * `OrderForm.tsx` previously ran a 4-way ternary to pick the right one. This
 * hook centralizes the dispatch so the order-submit guard stays readable
 * and a 5th DEX only touches one file.
 */

'use client';

import { useDexId } from './usePerpAdapter';
import { useAgentWalletStore, selectIsAgentActive as selectHlAgentActive } from '../stores/useAgentWalletStore';
import { usePacificaAgentStore, selectPacificaAgentActive } from '../stores/usePacificaAgentStore';
import { useLighterAgentStore, selectLighterAgentActive } from '../stores/useLighterAgentStore';
import { useAsterAgentStore, selectAsterAgentActive } from '../stores/useAsterAgentStore';

export function useAgentActive(): boolean {
  const dexId = useDexId();
  const hl = useAgentWalletStore(selectHlAgentActive);
  const pacifica = usePacificaAgentStore(selectPacificaAgentActive);
  const lighter = useLighterAgentStore(selectLighterAgentActive);
  const aster = useAsterAgentStore(selectAsterAgentActive);

  const byDex: Record<typeof dexId, boolean> = {
    hyperliquid: hl,
    pacifica,
    lighter,
    aster,
  };
  return byDex[dexId];
}
