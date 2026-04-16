/**
 * Config Types
 * 체인 설정 및 RPC 프로파일 관련 타입 정의
 */

import type { Chain } from 'viem';

/**
 * 체인 설정 타입
 */
export type ChainConfig = {
  key: string;
  chain: Chain;
  zeroDevProjectId: string;
  displayName: string;
}

/**
 * 지원 체인 키 — SUPPORTED_CHAINS 객체의 키에서 파생.
 * chains.ts에서 `keyof typeof SUPPORTED_CHAINS`로 재정의하여 사용.
 */
export type ChainKey = keyof typeof import('./chains').SUPPORTED_CHAINS;

export type RpcFeature = 'poolState' | 'tick' | 'emission' | 'volume' | 'portfolio';
