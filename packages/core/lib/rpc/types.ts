/**
 * IRpcProvider — RPC client 제공의 표준 계약
 *
 * v1.10.0: getPublicClient 하드코딩 제거, DI 기반 provider 추상화
 */

import { createPublicClient, http, type PublicClient } from 'viem'; // @ci-exception(public-client-singleton)
import { SUPPORTED_CHAINS } from '@hq/core/config/chains';
import type { RpcFeature } from '@hq/core/config/rpc-profiles';

export type { PublicClient } from 'viem';

// ── Observer Types (from provider.ts) ──

export type RpcRateLimitRetryEvent = {
  readonly kind: 'getLogs' | 'multicall';
  readonly chainId: number;
  readonly feature: RpcFeature | null;
  readonly attempt: number;
  readonly delayMs: number;
  readonly errorMessage: string;
}

export type RpcTransportFailureEvent = {
  readonly kind: 'getLogs' | 'multicall';
  readonly chainId: number;
  readonly feature: RpcFeature | null;
  readonly errorMessage: string;
}

export type IRpcObserver = {
  onRateLimitRetry: ((event: RpcRateLimitRetryEvent) => void) | null;
  onTransportFailure: ((event: RpcTransportFailureEvent) => void) | null;
}

export type IRpcProvider = {
  /** batch=true client (multicall용). feature로 키 풀 분기 가능. */
  getClient(chainId: number, feature?: import('@hq/core/config/rpc-profiles').RpcFeature): PublicClient; // @ci-exception(no-optional-without-default) — observer optional method param (implementor decides feature handling)
  /** batch=false client (getLogs용). feature로 키 풀 분기 가능. */
  getClientNoBatch(chainId: number, feature?: import('@hq/core/config/rpc-profiles').RpcFeature): PublicClient; // @ci-exception(no-optional-without-default) — observer optional method param
  /**
   * RPC 실패 보고 → provider가 rotation 판단.
   * 429(rate limit), 5xx, connection error, timeout 모두 대상.
   * provider가 error를 분석하여 rotation 여부를 결정.
   * feature가 주어지면 해당 feature 키 풀만 rotation.
   */
  reportFailure(chainId: number, error: Error, feature?: import('@hq/core/config/rpc-profiles').RpcFeature): void; // @ci-exception(no-optional-without-default) — observer optional method param
}

/**
 * RPC PublicClient 생성 유틸 — server/web 모두 viem을 직접 import하지 않아도 됨.
 * viemClient.ts의 _createClient와 동일 로직.
 */
export function createRpcClient(chainId: number, rpcUrl: string, batch: boolean): PublicClient {
  const chainConfig = Object.values(SUPPORTED_CHAINS).find(
    (c) => c.chain.id === chainId,
  );

  return createPublicClient({
    chain: chainConfig?.chain,
    // retryCount:0 — viem 자체 retry 비활성화, 우리 코드에서 retry
    transport: http(rpcUrl, { retryCount: 0, batch }),
  }) as PublicClient;
}
