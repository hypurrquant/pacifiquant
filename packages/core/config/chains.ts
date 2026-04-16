// config/chains.ts
// 체인 설정 SSOT (Single Source of Truth)
// v3.3.2: Multichain UI Support

import { defineChain } from 'viem';
import {
  base,
  mainnet as viemMainnet,
  bsc as viemBsc,
  arbitrum as viemArbitrum,
  avalanche as viemAvalanche,
  optimism as viemOptimism,
  polygon as viemPolygon,
  berachain as viemBerachain,
  unichain as viemUnichain,
} from 'viem/chains';

/**
 * Hyperliquid EVM 체인 정의
 */
export const hyperliquidEvm = defineChain({
  id: 999,
  name: 'Hyperliquid',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.hyperliquid.xyz/evm'] } },
  blockExplorers: { default: { name: 'HyperEVM Scan', url: 'https://hyperevmscan.io' } },
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
  testnet: true,
});

// ── 체인 re-export (viem 기본 public RPC 사용) ────────────────────────────
// v1.10.0: ATN RPC 오버라이드 제거 — provider 추상화로 RPC URL은 DI에서 주입
const ethereum = viemMainnet;
const bsc = viemBsc;
const arbitrum = viemArbitrum;
const avalanche = viemAvalanche;
const optimism = viemOptimism;
const polygon = viemPolygon;
const berachain = viemBerachain;
const unichain = viemUnichain;

// ── Types (from types.ts) ──
import type { ChainConfig, ChainKey } from './types';
export type { ChainConfig, ChainKey } from './types';

/**
 * 지원 체인 목록
 * v3.3.2: Hyperliquid + Base
 */
// v1.28.7: env 참조 제거 — 앱 부트스트랩에서 initChainConfig() 호출
const _chainOverrides: Record<string, Partial<ChainConfig>> = {};

export function initChainConfig(overrides: Record<string, { zeroDevProjectId: string }>): void {
  for (const [key, val] of Object.entries(overrides)) {
    _chainOverrides[key] = val;
  }
  // mutable object 업데이트
  for (const [key, chain] of Object.entries(SUPPORTED_CHAINS)) {
    const override = _chainOverrides[key];
    if (override && 'zeroDevProjectId' in override) {
      (chain as any).zeroDevProjectId = override.zeroDevProjectId; // @ci-exception(no-type-assertion)
    }
  }
}

export const SUPPORTED_CHAINS = {
  HYPERLIQUID: {
    key: 'HYPERLIQUID',
    chain: hyperliquidEvm,
    zeroDevProjectId: '',
    displayName: 'Hyperliquid',
  },
  BASE: {
    key: 'BASE',
    chain: base,
    zeroDevProjectId: '',
    displayName: 'Base',
  },
  BSC: {
    key: 'BSC',
    chain: bsc,
    zeroDevProjectId: '',
    displayName: 'BSC',
  },
  ETHEREUM: {
    key: 'ETHEREUM',
    chain: ethereum,
    zeroDevProjectId: '',
    displayName: 'Ethereum',
  },
  ARBITRUM: {
    key: 'ARBITRUM',
    chain: arbitrum,
    zeroDevProjectId: '',
    displayName: 'Arbitrum',
  },
  AVALANCHE: {
    key: 'AVALANCHE',
    chain: avalanche,
    zeroDevProjectId: '',
    displayName: 'Avalanche',
  },
  OPTIMISM: {
    key: 'OPTIMISM',
    chain: optimism,
    zeroDevProjectId: '',
    displayName: 'Optimism',
  },
  POLYGON: {
    key: 'POLYGON',
    chain: polygon,
    zeroDevProjectId: '',
    displayName: 'Polygon',
  },
  BERACHAIN: {
    key: 'BERACHAIN',
    chain: berachain,
    zeroDevProjectId: '',
    displayName: 'Berachain',
  },
  UNICHAIN: {
    key: 'UNICHAIN',
    chain: unichain,
    zeroDevProjectId: '',
    displayName: 'Unichain',
  },
} satisfies Record<string, ChainConfig>;

export type SupportedChainId =
  typeof SUPPORTED_CHAINS[keyof typeof SUPPORTED_CHAINS]['chain']['id'];

/** 지원 체인 ID 목록 (SUPPORTED_CHAINS에서 파생) */
export const SUPPORTED_CHAIN_IDS: readonly number[] = Object.values(SUPPORTED_CHAINS).map(c => c.chain.id);

export function isSupportedChainId(chainId: number): chainId is SupportedChainId {
  return SUPPORTED_CHAIN_IDS.includes(chainId);
}

export function assertSupportedChainId(chainId: number): SupportedChainId {
  if (!isSupportedChainId(chainId)) {
    throw new RangeError(`Unsupported chainId: ${chainId}`); // @ci-exception(no-raw-throw) — L0 config는 lib/error import 불가 (DAG)
  }
  return chainId;
}

/**
 * 기본 체인 (하위 호환성)
 */
export const DEFAULT_CHAIN: ChainKey = 'HYPERLIQUID';


// v0.12.9: Chain ID <-> ChainKey 매핑 유틸리티

/**
 * Chain ID로 ChainKey 조회
 * @returns ChainKey or null (미지원 체인)
 */
export function getChainKeyByChainId(chainId: number): ChainKey | null {
  for (const [key, config] of Object.entries(SUPPORTED_CHAINS)) {
    if (config.chain.id === chainId) return key as ChainKey;
  }
  return null;
}

/**
 * 체인별 평균 블록 타임 (초)
 * - volume windowBlocks 계산, timestamp fallback 등에서 SSOT로 사용
 */
export const BLOCK_TIME_SECONDS: Record<number, number> = {
  [hyperliquidEvm.id]: 1, // 999 — ~1s
  [base.id]: 2, // 8453 — ~2s
  [ethereum.id]: 12, // 1 — ~12s
  [bsc.id]: 0.5, // 56 — ~0.5s (2 blocks/s)
  [arbitrum.id]: 0.25, // 42161 — ~250ms (4 blocks/s)
  [avalanche.id]: 2, // 43114 — ~2s
  [optimism.id]: 2, // 10 — ~2s
  [polygon.id]: 2, // 137 — ~2s
  [berachain.id]: 2, // 80094 — ~2s
  [unichain.id]: 1, // 130 — ~1s
};

/** 1시간당 블록 수 (근사값). 미등록 체인은 null */
function blocksPerHour(chainId: number): number | null {
  const blockTime = BLOCK_TIME_SECONDS[chainId];
  if (blockTime == null) return null;
  return Math.round(3600 / blockTime);
}

/** 24시간 블록 수 — volume sliding window 기본값. 미등록 체인은 0 */
export function blocksPerDay(chainId: number): number {
  const perHour = blocksPerHour(chainId);
  return perHour != null ? perHour * 24 : 0;
}

// v1.28.8: getZeroDevRpcUrl, getChainEIP3085Config → apps/web/src/infra/config/chain-utils.ts로 이동

// v0.41.0: Explorer URL SSOT — 하드코딩 제거

/**
 * 체인별 Explorer URL 생성
 * @param chainKey - ChainKey (기본: DEFAULT_CHAIN)
 * @param path - tx/{hash} 또는 address/{addr}
 */
export function getExplorerUrl(chainKey: ChainKey = DEFAULT_CHAIN, path: string): string {
  const { chain } = SUPPORTED_CHAINS[chainKey];
  const baseUrl = chain.blockExplorers?.default?.url ?? '';
  return `${baseUrl}/${path}`;
}
