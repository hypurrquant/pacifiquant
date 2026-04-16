/**
 * Chain Utility Functions — web infra 전용
 * v1.28.8: packages/core/config/chains.ts에서 이동
 *
 * ZeroDev RPC + EIP-3085 설정은 web 전용이므로 core에서 분리
 */

import type { ChainKey } from '@hq/core/config/chains';
import { SUPPORTED_CHAINS, DEFAULT_CHAIN } from '@hq/core/config/chains';

/**
 * ZeroDev RPC URL 생성
 * v3.3.2: 체인별 동적 URL 생성
 */
export const getZeroDevRpcUrl = (chainKey: ChainKey = DEFAULT_CHAIN, projectId: string | null = null) => {
  const config = SUPPORTED_CHAINS[chainKey];
  const pid = projectId ?? config.zeroDevProjectId;
  return `https://rpc.zerodev.app/api/v3/${pid}/chain/${config.chain.id}?provider=ULTRA_RELAY`;
};

