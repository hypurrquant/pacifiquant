/**
 * Agent Wallet Store — Hyperliquid agent wallet 상태 관리
 *
 * Flow 1: 메인 지갑 → generateAgentKey → approveAgent → setApproved
 * Flow 2: 기존 agent key import → importAgentKey
 *
 * Persistence: agent private key is stored in localStorage alongside the
 * public address. This matches the UX of the official HL frontend —
 * approveAgent once, trade across reloads without re-signing. XSS on
 * this origin can exfiltrate the agent key, but:
 *   - agent keys can only trade (no deposit/withdraw rights)
 *   - main wallet (MetaMask/Privy) is never exposed
 *   - user can `disconnect()` to wipe the stored key at any time
 */

'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { HyperliquidPerpAdapter } from '@hq/core/defi/perp';
import type { EIP712SignFn } from '@hq/core/defi/perp';

// ── Persisted State (localStorage) ──

type PersistedAgentState =
  | { type: 'disconnected' }
  | {
      type: 'generated';
      agentAddress: `0x${string}`;
      masterAddress: `0x${string}`;
      privateKey: `0x${string}`;
    }
  | {
      type: 'imported';
      agentAddress: `0x${string}`;
      masterAddress: `0x${string}` | null;
      privateKey: `0x${string}`;
    };

interface AgentWalletStore {
  persisted: PersistedAgentState;

  // Flow 1: 메인 지갑으로 agent 생성
  generateAgentKey(): { address: `0x${string}`; privateKey: `0x${string}` };
  setApproved(masterAddress: `0x${string}`, agentAddress: `0x${string}`, agentPrivateKey: `0x${string}`): void;

  // Flow 2: 기존 agent key 입력
  importAgentKey(privateKey: `0x${string}`, masterAddress: `0x${string}` | null): void;

  // 공통
  disconnect(): void;
}

// ── In-memory key storage (never persisted) ──

let cachedSignFn: EIP712SignFn | null = null;
let pendingKey: { address: `0x${string}`; privateKey: `0x${string}` } | null = null;

function setInMemoryKey(key: `0x${string}`): void {
  cachedSignFn = HyperliquidPerpAdapter.createAgentSignFn(key);
}

function clearInMemoryKey(): void {
  cachedSignFn = null;
  pendingKey = null;
}

export const useAgentWalletStore = create<AgentWalletStore>()(
  persist(
    (set) => ({
      persisted: { type: 'disconnected' } satisfies PersistedAgentState,

      generateAgentKey: () => {
        const privateKey = generatePrivateKey();
        const account = privateKeyToAccount(privateKey);
        pendingKey = { address: account.address, privateKey };
        return pendingKey;
      },

      setApproved: (masterAddress, agentAddress, agentPrivateKey) => {
        pendingKey = null;
        setInMemoryKey(agentPrivateKey);
        set({
          persisted: {
            type: 'generated',
            agentAddress,
            masterAddress,
            privateKey: agentPrivateKey,
          },
        });
      },

      importAgentKey: (privateKey, masterAddress) => {
        const account = privateKeyToAccount(privateKey);
        setInMemoryKey(privateKey);
        set({
          persisted: {
            type: 'imported',
            agentAddress: account.address,
            masterAddress,
            privateKey,
          },
        });
      },

      disconnect: () => {
        clearInMemoryKey();
        set({ persisted: { type: 'disconnected' } });
      },
    }),
    {
      name: 'hq-perp-agent-wallet',
      // `persisted` now carries `privateKey` on the active variants so the
      // in-memory signer (`cachedSignFn`) can be rebuilt after a reload.
      partialize: (s) => ({ persisted: s.persisted }),
      // After zustand reads from localStorage on app boot, re-hydrate the
      // memory-only signer from the persisted private key. If an active
      // variant lost its private key (legacy state from before the field
      // was persisted), reset to `disconnected` so the UI shows the
      // "Enable Trading" flow instead of a stuck "Key Required" state.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const p = state.persisted;
        if (p.type === 'generated' || p.type === 'imported') {
          if (p.privateKey) {
            setInMemoryKey(p.privateKey);
          } else {
            state.persisted = { type: 'disconnected' };
          }
        }
      },
    },
  ),
);

// ── Selectors ──

export function selectAgentSignFn(_state: AgentWalletStore): EIP712SignFn | null {
  return cachedSignFn;
}

/**
 * Returns the HL master address that this agent wallet was approved for.
 *
 * **Name history note**: 이 selector는 한때 `selectVaultAddress`로 불렸으나
 * HL API의 `vaultAddress` 필드(= 서브-볼트 위임 거래)와 의미가 달라 혼동을
 *일으켰다. 여기서 반환하는 값은 "agent가 대신 거래하는 메인 계정의 주소"로
 * /info 조회(positions, openOrders 등)의 `user` 필드로만 사용해야 한다.
 * 주문 API의 `vaultAddress` 자리에는 절대 넣지 말 것 — 넣으면 HL이
 * "Vault not registered"로 거절한다.
 */
export function selectMasterAddress(state: AgentWalletStore): `0x${string}` | null {
  if (state.persisted.type === 'disconnected') return null;
  return state.persisted.masterAddress;
}

export function selectAgentAddress(state: AgentWalletStore): `0x${string}` | null {
  if (state.persisted.type === 'disconnected') return null;
  return state.persisted.agentAddress;
}

export function selectIsAgentActive(state: AgentWalletStore): boolean {
  return state.persisted.type !== 'disconnected' && cachedSignFn !== null;
}
