/**
 * RPC Profile — chain × feature 조합의 batch/delay/timeout 설정 SSOT
 * Transport Layer(rpc-transport.ts)가 유일한 소비자.
 */

import type { RpcFeature } from './types';
export type { RpcFeature } from './types';

type RpcProfile = {
  readonly chunkSize: number; // multicall: contracts per batch / getLogs: blocks per range
  readonly delayMs: number; // pause between batches (ms)
  readonly timeoutMs: number; // per-batch timeout (ms)
}

/**
 * 벤치마크 기반 프로파일 (2026-03-03)
 * docs/vfat/rpc-benchmark/ 참조
 *
 * chunkSize 산정: maxBatch의 ~40% (poolState/emission), ~30% (tick)
 * delayMs 산정: latency@maxBatch 기반 — 빠른 체인 0~100ms, 느린 체인 200~500ms
 * timeoutMs: latency * 3 safety margin, tick은 별도 30s
 */
const RPC_PROFILES: Record<number, Record<RpcFeature, RpcProfile>> = {
  // ── Tier 1: maxBatch 500, latency <600ms ─────────────────────────
  // Hyperliquid — rpc.hyperliquid.xyz, 500@297ms
  999: {
    poolState: { chunkSize: 200, delayMs: 0, timeoutMs: 10_000 },
    tick: { chunkSize: 200, delayMs: 0, timeoutMs: 30_000 },
    emission: { chunkSize: 200, delayMs: 0, timeoutMs: 10_000 },
    volume: { chunkSize: 500, delayMs: 1_000, timeoutMs: 10_000 },
    portfolio: { chunkSize: 100, delayMs: 0, timeoutMs: 10_000 },
  },
  // BSC — bsc-dataseed4.binance.org, 500@226ms
  56: {
    poolState: { chunkSize: 200, delayMs: 0, timeoutMs: 10_000 },
    tick: { chunkSize: 150, delayMs: 0, timeoutMs: 15_000 },
    emission: { chunkSize: 200, delayMs: 0, timeoutMs: 10_000 },
    volume: { chunkSize: 2_000, delayMs: 0, timeoutMs: 10_000 },
    portfolio: { chunkSize: 100, delayMs: 0, timeoutMs: 10_000 },
  },
  // Base — allthatnode.com, 응답 1MB 제한
  8453: {
    poolState: { chunkSize: 50, delayMs: 200, timeoutMs: 10_000 },
    tick: { chunkSize: 50, delayMs: 1_000, timeoutMs: 30_000 },
    emission: { chunkSize: 50, delayMs: 200, timeoutMs: 10_000 },
    volume: { chunkSize: 200, delayMs: 500, timeoutMs: 10_000 },
    portfolio: { chunkSize: 100, delayMs: 0, timeoutMs: 10_000 },
  },
  // Polygon — polygon.drpc.org, 500@581ms
  137: {
    poolState: { chunkSize: 200, delayMs: 100, timeoutMs: 10_000 },
    tick: { chunkSize: 150, delayMs: 100, timeoutMs: 30_000 },
    emission: { chunkSize: 200, delayMs: 100, timeoutMs: 10_000 },
    volume: { chunkSize: 2_000, delayMs: 100, timeoutMs: 10_000 },
    portfolio: { chunkSize: 100, delayMs: 0, timeoutMs: 10_000 },
  },

  // ── Tier 1b: maxBatch 500, latency 600~1100ms ───────────────────
  // Arbitrum — arb1.arbitrum.io, 500@849ms
  42161: {
    poolState: { chunkSize: 200, delayMs: 100, timeoutMs: 15_000 },
    tick: { chunkSize: 100, delayMs: 100, timeoutMs: 30_000 },
    emission: { chunkSize: 200, delayMs: 100, timeoutMs: 15_000 },
    volume: { chunkSize: 2_000, delayMs: 100, timeoutMs: 15_000 },
    portfolio: { chunkSize: 100, delayMs: 0, timeoutMs: 10_000 },
  },
  // Ethereum — ethereum-rpc.publicnode.com, 500@1053ms
  1: {
    poolState: { chunkSize: 100, delayMs: 200, timeoutMs: 15_000 },
    tick: { chunkSize: 100, delayMs: 200, timeoutMs: 30_000 },
    emission: { chunkSize: 100, delayMs: 200, timeoutMs: 15_000 },
    volume: { chunkSize: 1_000, delayMs: 200, timeoutMs: 15_000 },
    portfolio: { chunkSize: 100, delayMs: 0, timeoutMs: 10_000 },
  },
  // PulseChain — rpc.pulsechain.com, 500@1608ms
  369: {
    poolState: { chunkSize: 100, delayMs: 200, timeoutMs: 15_000 },
    tick: { chunkSize: 100, delayMs: 200, timeoutMs: 30_000 },
    emission: { chunkSize: 100, delayMs: 200, timeoutMs: 15_000 },
    volume: { chunkSize: 1_000, delayMs: 200, timeoutMs: 15_000 },
    portfolio: { chunkSize: 100, delayMs: 0, timeoutMs: 10_000 },
  },

  // ── Tier 2: maxBatch 200 ─────────────────────────────────────────
  // Avalanche — avalanche.drpc.org, 200@404ms
  43114: {
    poolState: { chunkSize: 100, delayMs: 100, timeoutMs: 10_000 },
    tick: { chunkSize: 50, delayMs: 100, timeoutMs: 30_000 },
    emission: { chunkSize: 100, delayMs: 100, timeoutMs: 10_000 },
    volume: { chunkSize: 1_000, delayMs: 100, timeoutMs: 10_000 },
    portfolio: { chunkSize: 100, delayMs: 0, timeoutMs: 10_000 },
  },
  // Optimism — optimism-rpc.publicnode.com, 200@540ms
  10: {
    poolState: { chunkSize: 100, delayMs: 100, timeoutMs: 10_000 },
    tick: { chunkSize: 50, delayMs: 100, timeoutMs: 30_000 },
    emission: { chunkSize: 100, delayMs: 100, timeoutMs: 10_000 },
    volume: { chunkSize: 1_000, delayMs: 100, timeoutMs: 10_000 },
    portfolio: { chunkSize: 100, delayMs: 0, timeoutMs: 10_000 },
  },
  // Sonic — sonic-rpc.publicnode.com, 200@896ms
  146: {
    poolState: { chunkSize: 50, delayMs: 200, timeoutMs: 15_000 },
    tick: { chunkSize: 50, delayMs: 200, timeoutMs: 30_000 },
    emission: { chunkSize: 50, delayMs: 200, timeoutMs: 15_000 },
    volume: { chunkSize: 1_000, delayMs: 200, timeoutMs: 15_000 },
    portfolio: { chunkSize: 100, delayMs: 0, timeoutMs: 10_000 },
  },

  // ── Tier 3: maxBatch 100 ─────────────────────────────────────────
  // Linea — rpc.linea.build, 100@274ms
  59144: {
    poolState: { chunkSize: 50, delayMs: 100, timeoutMs: 10_000 },
    tick: { chunkSize: 30, delayMs: 100, timeoutMs: 30_000 },
    emission: { chunkSize: 50, delayMs: 100, timeoutMs: 10_000 },
    volume: { chunkSize: 1_000, delayMs: 100, timeoutMs: 10_000 },
    portfolio: { chunkSize: 100, delayMs: 0, timeoutMs: 10_000 },
  },
  // Berachain — rpc.berachain.com, 100@562ms
  80094: {
    poolState: { chunkSize: 50, delayMs: 200, timeoutMs: 10_000 },
    tick: { chunkSize: 30, delayMs: 200, timeoutMs: 30_000 },
    emission: { chunkSize: 50, delayMs: 200, timeoutMs: 10_000 },
    volume: { chunkSize: 1_000, delayMs: 200, timeoutMs: 10_000 },
    portfolio: { chunkSize: 100, delayMs: 0, timeoutMs: 10_000 },
  },
  // Cronos — 1rpc.io, 100@155ms
  25: {
    poolState: { chunkSize: 50, delayMs: 100, timeoutMs: 10_000 },
    tick: { chunkSize: 30, delayMs: 100, timeoutMs: 30_000 },
    emission: { chunkSize: 50, delayMs: 100, timeoutMs: 10_000 },
    volume: { chunkSize: 1_000, delayMs: 100, timeoutMs: 10_000 },
    portfolio: { chunkSize: 100, delayMs: 0, timeoutMs: 10_000 },
  },

  // ── Tier 4: maxBatch 50 ──────────────────────────────────────────
  // Soneium — soneium.drpc.org, 50@335ms
  1868: {
    poolState: { chunkSize: 30, delayMs: 200, timeoutMs: 10_000 },
    tick: { chunkSize: 20, delayMs: 200, timeoutMs: 30_000 },
    emission: { chunkSize: 30, delayMs: 200, timeoutMs: 10_000 },
    volume: { chunkSize: 500, delayMs: 200, timeoutMs: 10_000 },
    portfolio: { chunkSize: 100, delayMs: 0, timeoutMs: 10_000 },
  },
  // Celo — rpc.ankr.com, 50@387ms
  42220: {
    poolState: { chunkSize: 30, delayMs: 200, timeoutMs: 10_000 },
    tick: { chunkSize: 20, delayMs: 200, timeoutMs: 30_000 },
    emission: { chunkSize: 30, delayMs: 200, timeoutMs: 10_000 },
    volume: { chunkSize: 500, delayMs: 200, timeoutMs: 10_000 },
    portfolio: { chunkSize: 100, delayMs: 0, timeoutMs: 10_000 },
  },

  // ── Tier 5: maxBatch 10 ──────────────────────────────────────────
  // Monad — rpc.monad.xyz, 10@113ms
  143: {
    poolState: { chunkSize: 10, delayMs: 200, timeoutMs: 10_000 },
    tick: { chunkSize: 10, delayMs: 200, timeoutMs: 30_000 },
    emission: { chunkSize: 10, delayMs: 200, timeoutMs: 10_000 },
    volume: { chunkSize: 500, delayMs: 200, timeoutMs: 10_000 },
    portfolio: { chunkSize: 100, delayMs: 0, timeoutMs: 10_000 },
  },
  // Unichain — unichain.drpc.org, 10@317ms
  130: {
    poolState: { chunkSize: 10, delayMs: 300, timeoutMs: 10_000 },
    tick: { chunkSize: 10, delayMs: 300, timeoutMs: 30_000 },
    emission: { chunkSize: 10, delayMs: 300, timeoutMs: 10_000 },
    volume: { chunkSize: 500, delayMs: 300, timeoutMs: 10_000 },
    portfolio: { chunkSize: 100, delayMs: 0, timeoutMs: 10_000 },
  },
  // HyperEVM — rpc.katana.network, 10@443ms
  747474: {
    poolState: { chunkSize: 10, delayMs: 300, timeoutMs: 15_000 },
    tick: { chunkSize: 10, delayMs: 300, timeoutMs: 30_000 },
    emission: { chunkSize: 10, delayMs: 300, timeoutMs: 15_000 },
    volume: { chunkSize: 500, delayMs: 300, timeoutMs: 15_000 },
    portfolio: { chunkSize: 100, delayMs: 0, timeoutMs: 10_000 },
  },
  // MegaETH — mainnet.megaeth.com, 10@61ms
  4326: {
    poolState: { chunkSize: 10, delayMs: 100, timeoutMs: 10_000 },
    tick: { chunkSize: 10, delayMs: 100, timeoutMs: 30_000 },
    emission: { chunkSize: 10, delayMs: 100, timeoutMs: 10_000 },
    volume: { chunkSize: 500, delayMs: 100, timeoutMs: 10_000 },
    portfolio: { chunkSize: 100, delayMs: 0, timeoutMs: 10_000 },
  },
};

// 미등록 체인 기본값: Tier 5 수준 (보수적)
const DEFAULT_PROFILE: Record<RpcFeature, RpcProfile> = {
  poolState: { chunkSize: 10, delayMs: 300, timeoutMs: 15_000 },
  tick: { chunkSize: 10, delayMs: 300, timeoutMs: 30_000 },
  emission: { chunkSize: 10, delayMs: 300, timeoutMs: 15_000 },
  volume: { chunkSize: 500, delayMs: 300, timeoutMs: 15_000 },
    portfolio: { chunkSize: 100, delayMs: 0, timeoutMs: 10_000 },
};

export function getRpcProfile(
  chainId: number,
  feature: RpcFeature,
): RpcProfile {
  return RPC_PROFILES[chainId]?.[feature] ?? DEFAULT_PROFILE[feature];
}

// ── Chain-level Concurrency ──
// RPC endpoint가 chain별로 공유되므로 feature-level이 아닌 chain-level로 제한.
const CHAIN_CONCURRENCY: Record<number, number> = {
  999: 2, // Hyperliquid — concurrent 4에서 3.5% 실패, 2로 안전 마진
  8453: 3, // Base — 1MB response limit
};

// Default 6: ATN-backed 체인(ETH, BSC, Polygon 등)은 현재 100% coverage로
// 동시 요청에 문제 없음. 6은 DEX 수(~9) 미만이므로 약간의 직렬화 효과를
// 주면서도 처리 시간에 유의미한 영향 없음. 무제한(Infinity)을 피하는 이유:
// 향후 신규 체인 추가 시 기본 안전망 역할.
const DEFAULT_CONCURRENCY = 6;

export function getChainConcurrency(chainId: number): number {
  return CHAIN_CONCURRENCY[chainId] ?? DEFAULT_CONCURRENCY;
}
