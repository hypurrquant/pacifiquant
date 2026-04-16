/**
 * Unified active-account selector across 4 DEX agent models.
 *
 * Each DEX has a different "whose account is this" field:
 *   - Hyperliquid: EVM `masterAddress` (registered agent's approver)
 *   - Pacifica:    Solana `mainAccount` (Phantom public key)
 *   - Lighter:     EVM `l1Address`    (ChangePubKey signer)
 *   - Aster:       EVM `user`         (ApproveAgent signer)
 *
 * Before this hook, `TradingLayout.tsx` had a 4-way ternary computing these
 * four values separately then picking one by `dexId`. That scattered the DEX
 * switch across every caller. This hook concentrates the dispatch in one
 * place — React Query hooks just receive `address`.
 *
 * Return shape:
 *   - `address`: the canonical account identifier for the CURRENT DEX
 *     (perp / spot / position queries all key off this)
 *   - `hlOnlyAddress`: same as `address` but null when the DEX is not HL —
 *     forwarded to HL-exclusive WS/REST hooks that should be disabled on
 *     other DEXs (React Query respects `enabled: !!address`)
 */

'use client';

import { useDexId } from './usePerpAdapter';
import { useAgentWalletStore, selectIsAgentActive, selectMasterAddress } from '../stores/useAgentWalletStore';
import { usePacificaAgentStore } from '../stores/usePacificaAgentStore';
import { useLighterAgentStore } from '../stores/useLighterAgentStore';
import { useAsterAgentStore } from '../stores/useAsterAgentStore';

export interface ActiveAccount {
  /** Account identifier for the active DEX (lowercased for EVM/Lighter). */
  readonly address: string | null;
  /** HL master address (lowercased) when active DEX is Hyperliquid, else null.
   *  Gate for HL-exclusive hooks (spotBalances, activeAssetData, WS pushes). */
  readonly hlOnlyAddress: string | null;
  /** Pacifica Solana pubkey when active DEX is Pacifica, else null.
   *  Gate for Pacifica-exclusive WS user-data hooks. */
  readonly pacificaOnlyAddress: string | null;
  /** Convenience: is the HL agent currently active? Used by order-submit
   *  guards that need the agent, not just the address. */
  readonly isHlAgentActive: boolean;
  /** Raw HL master address even on non-HL DEXs — needed by
   *  agent-mismatch-disconnect effect that must run regardless of active DEX. */
  readonly hlMasterAddress: string | null;
}

export function useActiveAccount(walletAddress: string | null): ActiveAccount {
  const dexId = useDexId();
  const isHlAgentActive = useAgentWalletStore(selectIsAgentActive);
  const hlMasterAddress = useAgentWalletStore(selectMasterAddress);
  const pacificaPersisted = usePacificaAgentStore((s) => s.persisted);
  const lighterPersisted = useLighterAgentStore((s) => s.persisted);
  const asterPersisted = useAsterAgentStore((s) => s.persisted);

  // HL: prefer the approved master, fall back to the connected wallet.
  // (When the agent is active we always query for the master address so
  // the same account is shown across reloads without reconnecting.)
  const hlAccountAddress = ((isHlAgentActive && hlMasterAddress) ? hlMasterAddress : walletAddress)?.toLowerCase() ?? null;

  // Pacifica: Solana pubkey from Phantom, no wallet-address fallback (EVM
  // wallets can't identify a Solana account).
  const pacificaAccountAddress = pacificaPersisted.type === 'registered' ? pacificaPersisted.mainAccount : null;

  // Lighter/Aster: registered EVM address, else the connected wallet.
  const lighterAccountAddress = lighterPersisted.type === 'registered'
    ? lighterPersisted.l1Address.toLowerCase()
    : (walletAddress ? walletAddress.toLowerCase() : null);
  const asterAccountAddress = asterPersisted.type === 'registered'
    ? asterPersisted.user.toLowerCase()
    : (walletAddress ? walletAddress.toLowerCase() : null);

  const byDex: Record<typeof dexId, string | null> = {
    hyperliquid: hlAccountAddress,
    pacifica:    pacificaAccountAddress,
    lighter:     lighterAccountAddress,
    aster:       asterAccountAddress,
  };
  const address = byDex[dexId];
  const hlOnlyAddress = dexId === 'hyperliquid' ? hlAccountAddress : null;
  const pacificaOnlyAddress = dexId === 'pacifica' ? pacificaAccountAddress : null;

  return { address, hlOnlyAddress, pacificaOnlyAddress, isHlAgentActive, hlMasterAddress };
}
