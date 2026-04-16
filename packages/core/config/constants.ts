/**
 * Core SDK 상수 정의
 * pool/constants.ts에서 config/로 이동 (순환 의존성 해소)
 */

// 재시도 & 타임아웃
export const SDK_DEFAULTS = {
  RETRY_COUNT: 3,
  RETRY_DELAY_MS: 1000,
  TIMEOUT_MS: 10000,
  RATE_LIMIT_BACKOFF_MS: 5000,
} as const;

// Chain RPC Endpoints — SSOT (public endpoints — API 키 절대 포함 금지)
// v1.28.9: 전체 10체인. 첫 번째 URL = primary (StaticRpcProvider 호환)
export const CHAIN_RPC_ENDPOINTS: Record<number, string[]> = {
  999: ['https://rpc.hyperliquid.xyz/evm'],
  8453: ['https://base.drpc.org', 'https://base-rpc.publicnode.com'],
  1: ['https://eth.drpc.org', 'https://ethereum-rpc.publicnode.com'],
  56: ['https://bsc.drpc.org', 'https://bsc-rpc.publicnode.com'],
  42161: ['https://arbitrum.drpc.org', 'https://arbitrum-one-rpc.publicnode.com'],
  43114: ['https://avalanche.drpc.org', 'https://avalanche-c-chain-rpc.publicnode.com'],
  10: ['https://optimism.drpc.org', 'https://optimism-rpc.publicnode.com'],
  137: ['https://polygon.drpc.org', 'https://polygon-bor-rpc.publicnode.com'],
  80094: ['https://berachain.drpc.org', 'https://rpc.berachain.com'],
  130: ['https://unichain.drpc.org', 'https://mainnet.unichain.org'],
};

// Legacy projection — StaticRpcProvider 등 단일 URL 소비자용
export const CHAIN_RPC_URLS: Record<number, string> = Object.fromEntries(
  Object.entries(CHAIN_RPC_ENDPOINTS).map(([k, v]) => [k, v[0]]),
);
