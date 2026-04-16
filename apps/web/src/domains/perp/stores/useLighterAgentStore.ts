/**
 * Lighter Agent (API Key) Store — persist ChangePubKey credentials
 *
 * Lighter's "API key" is a ZK-compatible private key stored at a
 * specific slot on the user's account, minted via `ChangePubKey`. Once
 * registered, the key can sign orders/cancels indefinitely (until a
 * fresh ChangePubKey at the same slot replaces it).
 *
 * Persistence trade-off (same as HL/Pacifica agent keys):
 *   - The key can ONLY trade on the corresponding Lighter account; the
 *     user's main EVM wallet is never exposed.
 *   - XSS on this origin can exfiltrate the API key, bounded to the
 *     trading surface of the registered account.
 *   - User can `disconnect()` to wipe the stored key; they must re-run
 *     `registerApiKey` (or import) to trade again.
 */

'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LighterPerpAdapter } from '@hq/core/defi/perp';
import { getAdapterByDex } from '../hooks/usePerpAdapter';

type PersistedLighterState =
  | { type: 'disconnected' }
  | {
      type: 'registered';
      /** 40-byte API private key as hex (with `0x` prefix). */
      apiKey: string;
      /** Lighter account_index (numeric — the L2 account identifier). */
      accountIndex: number;
      /** Slot index the key occupies (4-254). */
      apiKeyIndex: number;
      /** Base58/hex l1 address that owns this account. */
      l1Address: string;
      /** When the key was registered (ms epoch). */
      registeredAt: number;
    };

interface LighterAgentStore {
  persisted: PersistedLighterState;

  /** Called after a successful `registerApiKey()` run. */
  setCredentials(params: {
    apiKey: string;
    accountIndex: number;
    apiKeyIndex: number;
    l1Address: string;
  }): void;

  disconnect(): void;
}

function syncAdapter(state: PersistedLighterState): void {
  const adapter = getAdapterByDex('lighter') as LighterPerpAdapter;
  if (state.type === 'registered') {
    adapter.setLighterCredentials(state.apiKey, state.accountIndex, state.apiKeyIndex);
  } else {
    adapter.clearLighterCredentials();
  }
}

export const useLighterAgentStore = create<LighterAgentStore>()(
  persist(
    (set) => ({
      persisted: { type: 'disconnected' },

      setCredentials: ({ apiKey, accountIndex, apiKeyIndex, l1Address }) => {
        const next: PersistedLighterState = {
          type: 'registered',
          apiKey,
          accountIndex,
          apiKeyIndex,
          l1Address,
          registeredAt: Date.now(),
        };
        syncAdapter(next);
        set({ persisted: next });
      },

      disconnect: () => {
        const next: PersistedLighterState = { type: 'disconnected' };
        syncAdapter(next);
        set({ persisted: next });
      },
    }),
    {
      name: 'hq-perp-lighter-agent',
      partialize: (s) => ({ persisted: s.persisted }),
      onRehydrateStorage: () => (state) => {
        if (state) syncAdapter(state.persisted);
      },
    },
  ),
);

// ── Selectors ─────────────────────────────────────────────────────────

export function selectLighterAgentActive(state: LighterAgentStore): boolean {
  return state.persisted.type === 'registered';
}

export function selectLighterAccountIndex(state: LighterAgentStore): number | null {
  return state.persisted.type === 'registered' ? state.persisted.accountIndex : null;
}

export function selectLighterApiKeyIndex(state: LighterAgentStore): number | null {
  return state.persisted.type === 'registered' ? state.persisted.apiKeyIndex : null;
}
