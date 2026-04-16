/**
 * Pacifica Agent Wallet Store — Solana Ed25519 agent key persistence
 *
 * Matches the `useAgentWalletStore` pattern used for HL. Stores the
 * registered agent's Base58 64-byte secret key in localStorage so the
 * Pacifica adapter can re-sign orders after a reload without requiring
 * the user to reconnect Phantom and re-run `bind_agent_wallet`.
 *
 * Persistence security trade-off (same reasoning as HL — see header
 * comment of useAgentWalletStore.ts):
 *   - Agent keys can only trade; main Phantom wallet is never exposed.
 *   - XSS on this origin can exfiltrate the agent key, bounded to the
 *     fund surface of the bound Pacifica account.
 *   - User can `disconnect()` to wipe the stored key at any time.
 */

'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PacificaPerpAdapter } from '@hq/core/defi/perp';
import { getAdapterByDex } from '../hooks/usePerpAdapter';

type PersistedPacificaState =
  | { type: 'disconnected' }
  | {
      type: 'registered';
      /** Base58 64-byte secret key (seed + public key concatenated). */
      agentSecretKeyB58: string;
      /** Base58 public key of the agent (included in `agent_wallet` header). */
      agentPublicKey: string;
      /** Base58 public key of the main wallet that bound this agent. */
      mainAccount: string;
      /** When the agent was bound (ms epoch). */
      boundAt: number;
    };

interface PacificaAgentStore {
  persisted: PersistedPacificaState;

  /** Called after a successful `registerAgentKey()` run. */
  setAgent(params: {
    agentSecretKeyB58: string;
    agentPublicKey: string;
    mainAccount: string;
  }): void;

  /** Remove agent key from storage + memory. */
  disconnect(): void;
}

/**
 * Push the persisted agent key back into the Pacifica adapter singleton.
 * Called on zustand rehydrate and after every explicit `setAgent`.
 */
function syncAdapter(state: PersistedPacificaState): void {
  const adapter = getAdapterByDex('pacifica') as PacificaPerpAdapter;
  if (state.type === 'registered') {
    // setAgentKey preserves mainAccount on `solanaAccount` — signing uses the
    // agent secret but the payload's `account` field remains the main wallet.
    adapter.setAgentKey(state.agentSecretKeyB58, state.agentPublicKey, state.mainAccount);
  } else {
    adapter.clearSolanaSigner();
  }
}

export const usePacificaAgentStore = create<PacificaAgentStore>()(
  persist(
    (set) => ({
      persisted: { type: 'disconnected' },

      setAgent: ({ agentSecretKeyB58, agentPublicKey, mainAccount }) => {
        const next: PersistedPacificaState = {
          type: 'registered',
          agentSecretKeyB58,
          agentPublicKey,
          mainAccount,
          boundAt: Date.now(),
        };
        syncAdapter(next);
        set({ persisted: next });
      },

      disconnect: () => {
        const next: PersistedPacificaState = { type: 'disconnected' };
        syncAdapter(next);
        set({ persisted: next });
      },
    }),
    {
      name: 'hq-perp-pacifica-agent',
      partialize: (s) => ({ persisted: s.persisted }),
      onRehydrateStorage: () => (state) => {
        if (state) syncAdapter(state.persisted);
      },
    },
  ),
);

// ── Selectors ─────────────────────────────────────────────────────────

export function selectPacificaAgentActive(state: PacificaAgentStore): boolean {
  return state.persisted.type === 'registered';
}

export function selectPacificaAgentPublicKey(state: PacificaAgentStore): string | null {
  return state.persisted.type === 'registered' ? state.persisted.agentPublicKey : null;
}

export function selectPacificaMainAccount(state: PacificaAgentStore): string | null {
  return state.persisted.type === 'registered' ? state.persisted.mainAccount : null;
}
