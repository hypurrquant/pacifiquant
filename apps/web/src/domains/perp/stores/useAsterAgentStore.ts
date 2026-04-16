/**
 * Aster Agent Store — Aster V3 agent-wallet 영속 저장소
 *
 * Aster V3는 HMAC-SHA256 API key 방식이 아닌 EIP-712 agent-wallet 방식을 사용한다.
 * 메인 지갑이 1회 agent 주소를 승인하면, 이후 모든 거래는 agent 개인키로 서명.
 *
 * 왜 agentPrivateKey를 localStorage에 저장하는가:
 *   HL / Pacifica / Lighter와 동일한 트레이드오프.
 *   - 이 origin의 XSS가 agent key를 탈취할 수 있음.
 *   - 탈취 시 해당 Aster 계정으로의 거래 권한에 한정됨.
 *   - disconnect()로 즉시 무효화 가능 (새 approve 없이 agent key만 교체 불가).
 *
 * persist name을 v2로 변경해 레거시 HMAC 기록(apiKey/apiSecret)을 자동 드랍.
 */

'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AsterPerpAdapter } from '@hq/core/defi/perp';
import { getAdapterByDex } from '../hooks/usePerpAdapter';

type PersistedAsterState =
  | { type: 'disconnected' }
  | {
      type: 'registered';
      /** 메인 EOA 주소 (approve 시 사용한 주소) */
      user: `0x${string}`;
      /** 생성된 agent EOA 주소 */
      agentAddress: `0x${string}`;
      /** agent 개인키 — 리로드 후 재승인 없이 서명 가능하도록 저장 */
      agentPrivateKey: `0x${string}`;
      /** approve 시 사용한 agent 이름 */
      agentName: string;
      /** approve 만료 시각 (ms epoch) */
      expiredMs: number;
      /** 등록 시각 (ms epoch) */
      registeredAt: number;
    };

interface AsterAgentStore {
  persisted: PersistedAsterState;

  /** approveAgent() 성공 후 호출 — agent 정보를 영속화하고 어댑터에 주입 */
  setAgent(params: {
    user: `0x${string}`;
    agentAddress: `0x${string}`;
    agentPrivateKey: `0x${string}`;
    agentName: string;
    expiredMs: number;
    registeredAt: number;
  }): void;

  disconnect(): void;
}

function syncAdapter(state: PersistedAsterState): void {
  const adapter = getAdapterByDex('aster') as AsterPerpAdapter;
  if (state.type === 'registered') {
    adapter.setAsterAgent(state.user, state.agentAddress, state.agentPrivateKey);
  } else {
    adapter.clearAsterAgent();
  }
}

export const useAsterAgentStore = create<AsterAgentStore>()(
  persist(
    (set) => ({
      persisted: { type: 'disconnected' },

      setAgent: ({ user, agentAddress, agentPrivateKey, agentName, expiredMs, registeredAt }) => {
        const next: PersistedAsterState = {
          type: 'registered',
          user,
          agentAddress,
          agentPrivateKey,
          agentName,
          expiredMs,
          registeredAt,
        };
        syncAdapter(next);
        set({ persisted: next });
      },

      disconnect: () => {
        const next: PersistedAsterState = { type: 'disconnected' };
        syncAdapter(next);
        set({ persisted: next });
      },
    }),
    {
      // v2: 레거시 HMAC 기록(apiKey/apiSecret)을 자동 드랍
      name: 'hq-perp-aster-agent-v2',
      partialize: (s) => ({ persisted: s.persisted }),
      onRehydrateStorage: () => (state) => {
        if (state) syncAdapter(state.persisted);
      },
    },
  ),
);

// ── Selectors ─────────────────────────────────────────────────────────

export function selectAsterAgentActive(state: AsterAgentStore): boolean {
  return state.persisted.type === 'registered';
}

/** 메인 EOA 주소 반환 — 계정 조회 API의 address 파라미터로 사용 */
export function selectAsterL1Address(state: AsterAgentStore): string | null {
  return state.persisted.type === 'registered' ? state.persisted.user : null;
}
