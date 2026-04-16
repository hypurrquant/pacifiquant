/**
 * Chain-aware PublicClient 팩토리
 *
 * v2.0.0: IRpcProvider DI로 위임. 기존 시그니처 유지.
 */

import { getRpcProvider } from './rpc/provider';
import type { RpcFeature } from '@hq/core/config/rpc-profiles';

export function getPublicClient(chainId: number, feature: RpcFeature | null = null) {
  return getRpcProvider().getClient(chainId, feature ?? undefined);
}

/**
 * batch=false 클라이언트 — getLogs 전용.
 * viem batch transport가 일부 RPC(Hyperliquid 등)의 비표준 에러 응답을 파싱하지 못해 크래시하므로,
 * getLogs 호출은 단일 요청으로 보낸다.
 */
export function getPublicClientNoBatch(chainId: number, feature: RpcFeature | null = null) {
  return getRpcProvider().getClientNoBatch(chainId, feature ?? undefined);
}
