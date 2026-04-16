/**
 * PerpWebDeps — Perp 도메인 플랫폼 DI
 *
 * EIP-1193 provider 기반 웹 지갑 서명 사용 (MetaMask, WalletConnect 등)
 */

import { useAccountStore, selectActiveAddress, selectExecutionAddress, selectWalletProvider } from '@/infra/auth/stores';
import { useToastStore } from '@/shared/stores/useToastStore';
import { useAgentWalletStore, selectAgentSignFn } from '../stores/useAgentWalletStore';
import { ContextRequiredError } from '@hq/core/lib/error';
import type { EIP712SignFn } from '@hq/core/defi/perp';

export interface PerpPlatformDeps {
  getAccount(): {
    activeAddress: `0x${string}` | null;
    executionAddress: `0x${string}` | null;
  };

  getSignFn(): EIP712SignFn;

  /** 메인 지갑으로 서명 (approveAgent 용 — agent wallet 무시) */
  getMainWalletSignFn(): EIP712SignFn;

  /** 메인 지갑의 현재 연결된 chainId (eth_chainId live query).
   *  HL user-signed actions (approveAgent, withdraw3) must use this for both
   *  action.signatureChainId and EIP-712 domain.chainId. */
  getMainWalletChainId(): Promise<number>;

  /**
   * HL `vaultAddress` field for order-placement actions.
   *
   * HL의 `vaultAddress`는 "서브-볼트(vault) 계약" 위임 거래 전용 필드다.
   * 일반 사용자 계정이나 agent wallet 흐름에서는 이 값을 절대 채우면 안
   * 된다 — 유저의 EOA를 여기로 넘기면 HL이 "Vault not registered"로 거절
   * 한다 (그 EOA는 실제 HL 볼트가 아니기 때문).
   *
   * 현재는 HL vault 기능을 노출하지 않으므로 항상 `null`. 향후 vault
   * 제품을 추가할 때만 여기서 실제 vault 주소를 반환하면 된다.
   */
  getVaultAddress(): `0x${string}` | null;

  sendTransaction(tx: { to: string; data: string; value: string; chainId: number }): Promise<string>;

  showToast(toast: {
    title: string;
    message?: string;
    type: 'success' | 'warning' | 'info';
  }): void;

  hooks: {
    useActiveAddress(): `0x${string}` | null;
    useExecutionAddress(): `0x${string}` | null;
  };
}

/** 메인 지갑(EIP-1193 provider)으로 서명하는 함수 생성 */
function createMainWalletSignFn(): EIP712SignFn {
  return async (payload) => {
    const state = useAccountStore.getState();
    const address = selectActiveAddress(state);
    const provider = selectWalletProvider(state);

    if (!address) {
      throw new ContextRequiredError('No active wallet address — please connect a wallet first');
    }
    if (!provider) {
      throw new ContextRequiredError('EIP-1193 provider unavailable — perp trading requires an external wallet (MetaMask / WalletConnect / Coinbase Wallet)');
    }

    // eth_signTypedData_v4 requires EIP712Domain type definition in types
    const typesWithDomain = {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      ...payload.types,
    };

    const signature = await provider.request({
      method: 'eth_signTypedData_v4',
      params: [address, JSON.stringify({
        types: typesWithDomain,
        domain: payload.domain,
        primaryType: payload.primaryType,
        message: payload.message,
      })],
    });
    if (typeof signature !== 'string' || !signature.startsWith('0x')) {
      throw new ContextRequiredError('eth_signTypedData_v4 returned non-hex result');
    }

    return signature as `0x${string}`; // @ci-exception(type-assertion-count) — startsWith('0x') verified but TS cannot narrow template literal
  };
}

export function createWebPerpDeps(): PerpPlatformDeps {
  return {
    getAccount: () => ({
      activeAddress: selectActiveAddress(useAccountStore.getState()),
      executionAddress: selectExecutionAddress(useAccountStore.getState()),
    }),

    getSignFn: (): EIP712SignFn => {
      // Agent wallet 활성화 시 agent key로 서명
      const agentSignFn = selectAgentSignFn(useAgentWalletStore.getState());
      if (agentSignFn) return agentSignFn;

      // 기본: 메인 지갑으로 서명
      return createMainWalletSignFn();
    },

    getMainWalletSignFn: (): EIP712SignFn => {
      return createMainWalletSignFn();
    },

    getMainWalletChainId: async (): Promise<number> => {
      const state = useAccountStore.getState();
      const provider = selectWalletProvider(state);
      if (!provider) {
        throw new ContextRequiredError('EIP-1193 provider unavailable — perp trading requires an external wallet (MetaMask / WalletConnect / Coinbase Wallet)');
      }
      const chainHex = await provider.request({ method: 'eth_chainId', params: [] });
      if (typeof chainHex !== 'string') {
        throw new ContextRequiredError('eth_chainId returned non-string result');
      }
      return parseInt(chainHex, 16);
    },

    getVaultAddress: (): `0x${string}` | null => {
      // HL vault 위임은 지원하지 않음 — 항상 null. 자세한 이유는 인터페이스
      // 주석 참조. master address가 필요한 정보 조회(/info)는 별도 selector
      // (`selectMasterAddress`)를 통해 직접 읽는다.
      return null;
    },

    sendTransaction: async (tx) => {
      const state = useAccountStore.getState();
      const address = selectActiveAddress(state);
      const provider = selectWalletProvider(state);

      if (!address || !provider) {
        throw new ContextRequiredError('Wallet not connected');
      }

      const txHash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{
          from: address,
          to: tx.to,
          data: tx.data,
          value: tx.value === '0' ? undefined : `0x${BigInt(tx.value).toString(16)}`,
        }],
      });
      if (typeof txHash !== 'string') {
        throw new ContextRequiredError('eth_sendTransaction returned non-string result');
      }

      return txHash;
    },

    showToast: (toast) => {
      useToastStore.getState().addToast({
        type: toast.type,
        title: toast.title,
        message: toast.message ?? null,
      });
    },

    hooks: {
      useActiveAddress: () => useAccountStore(selectActiveAddress),
      useExecutionAddress: () => useAccountStore(selectExecutionAddress),
    },
  };
}
