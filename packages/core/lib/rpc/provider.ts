/**
 * RPC Provider — DI + StaticRpcProvider + Observer + Semaphore
 *
 * v1.10.0: 기존 setErrorHandler DI 패턴과 동일
 * v1.18.1: Semaphore 추가 — chain별 RPC concurrency 제한용
 */

import type { IRpcProvider, IRpcObserver, PublicClient } from './types';
export type { RpcRateLimitRetryEvent, RpcTransportFailureEvent, IRpcObserver } from './types';
import { CHAIN_RPC_URLS } from '@hq/core/config/constants';
import { createRpcClient } from './types';
import { ConfigError } from '@hq/core/lib/error';

// ── Semaphore ──

/**
 * Minimal counting semaphore — chain별 RPC concurrency 제한용.
 * 외부 의존 없음. FIFO 순서 보장.
 *
 * @since v1.18.1
 */
export class Semaphore {
  private permits: number;
  private readonly queue: Array<() => void> = [];

  constructor(maxConcurrency: number) {
    this.permits = maxConcurrency;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// ── Observer ──

const NOOP_OBSERVER: IRpcObserver = { onRateLimitRetry: null, onTransportFailure: null };

let rpcObserver: IRpcObserver = NOOP_OBSERVER;

export function setRpcObserver(observer: IRpcObserver | null): void {
  rpcObserver = observer ?? NOOP_OBSERVER;
}

export function getRpcObserver(): IRpcObserver {
  return rpcObserver;
}

// ── StaticRpcProvider ──

/**
 * StaticRpcProvider — 현행 getPublicClient 동작 보존
 *
 * v1.10.0: DI 미설정 시 fallback. 단일 URL, rotation 없음.
 */
export class StaticRpcProvider implements IRpcProvider {
  private cache = new Map<number, PublicClient>();
  private noBatchCache = new Map<number, PublicClient>();

  getClient(chainId: number, _feature: import('@hq/core/config/rpc-profiles').RpcFeature | null = null): PublicClient {
    const cached = this.cache.get(chainId);
    if (cached) return cached;

    const rpcUrl = CHAIN_RPC_URLS[chainId];
    if (!rpcUrl) throw new ConfigError(`No RPC URL for chainId ${chainId}`);

    const client = createRpcClient(chainId, rpcUrl, true);
    this.cache.set(chainId, client);
    return client;
  }

  getClientNoBatch(chainId: number, _feature: import('@hq/core/config/rpc-profiles').RpcFeature | null = null): PublicClient {
    const cached = this.noBatchCache.get(chainId);
    if (cached) return cached;

    const rpcUrl = CHAIN_RPC_URLS[chainId];
    if (!rpcUrl) throw new ConfigError(`No RPC URL for chainId ${chainId}`);

    const client = createRpcClient(chainId, rpcUrl, false);
    this.noBatchCache.set(chainId, client);
    return client;
  }

  // rotation 없음 — 정적 provider이므로 reportFailure는 no-op
  reportFailure(_chainId: number, _error: Error, _feature: import('@hq/core/config/rpc-profiles').RpcFeature | null = null): void {
    // no-op
  }
}

// ── Global DI ──

let _provider: IRpcProvider | null = null;

/**
 * RPC provider를 글로벌 DI로 등록.
 * 각 앱(server/web)이 startup 시 자기 환경에 맞는 provider를 등록한다.
 */
export function setRpcProvider(provider: IRpcProvider): void {
  _provider = provider;
}

/**
 * 등록된 RPC provider 반환.
 * DI 미설정 시 StaticRpcProvider(현행 동작 보존)로 fallback.
 */
export function getRpcProvider(): IRpcProvider {
  if (!_provider) {
    _provider = new StaticRpcProvider();
  }
  return _provider;
}
