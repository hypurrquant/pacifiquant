/**
 * PerChainRoundRobinProvider — Web용 per-chain round-robin rotation
 *
 * v1.10.0: 체인별 public RPC URL 배열, 실패 시 해당 체인만 다음 URL로 rotation.
 * 클라이언트 번들에 API 키 노출 없음 — public RPC URL만 사용.
 */

import {
  type IRpcProvider,
  type PublicClient,
  createRpcClient,
} from '@hq/core/lib/rpc/types';
import { createLogger } from '@hq/core/logging';
import { ConfigError, isRotatableError } from '@hq/core/lib/error';

const logger = createLogger('rpc-round-robin');

interface RoundRobinConfig {
  /** chainId → public RPC URL 배열 (API 키 없음) */
  chains: Record<number, string[]>;
}

export class PerChainRoundRobinProvider implements IRpcProvider {
  private urlIndex = new Map<number, number>();
  private clientCache = new Map<string, PublicClient>();

  constructor(private readonly config: RoundRobinConfig) {}

  getClient(chainId: number, _feature: import('@hq/core/config/rpc-profiles').RpcFeature | null = null): PublicClient {
    return this.getOrCreateClient(chainId, true);
  }

  getClientNoBatch(chainId: number, _feature: import('@hq/core/config/rpc-profiles').RpcFeature | null = null): PublicClient {
    return this.getOrCreateClient(chainId, false);
  }

  reportFailure(chainId: number, error: Error, _feature: import('@hq/core/config/rpc-profiles').RpcFeature | null = null): void {
    if (!isRotatableError(error)) return;

    const urls = this.config.chains[chainId];
    // 단일 URL 또는 미등록 체인 → rotation 스킵
    if (!urls || urls.length <= 1) return;

    const current = this.urlIndex.get(chainId) ?? 0;
    this.urlIndex.set(chainId, (current + 1) % urls.length);

    // 해당 chainId client만 캐시에서 제거
    this.clientCache.delete(`${chainId}:true`);
    this.clientCache.delete(`${chainId}:false`);

    logger.warn(`RPC rotated for chain ${chainId} to index ${(current + 1) % urls.length}`);
  }

  private getOrCreateClient(chainId: number, batch: boolean): PublicClient {
    const cacheKey = `${chainId}:${batch}`;
    const cached = this.clientCache.get(cacheKey);
    if (cached) return cached;

    const rpcUrl = this.getCurrentUrl(chainId);
    const client = createRpcClient(chainId, rpcUrl, batch);
    this.clientCache.set(cacheKey, client);
    return client;
  }

  private getCurrentUrl(chainId: number): string {
    const urls = this.config.chains[chainId];
    if (!urls || urls.length === 0) {
      throw new ConfigError(`No RPC URLs configured for chainId ${chainId}`);
    }
    const index = this.urlIndex.get(chainId) ?? 0;
    return urls[index];
  }
}
