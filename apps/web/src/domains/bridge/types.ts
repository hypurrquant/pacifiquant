/**
 * Bridge Domain Types — Relay Bridge 통합 (양방향, 멀티토큰)
 *
 * Destination: Hyperliquid L1 (chainId 1337)
 * - USDC (Perps): 0x00000000000000000000000000000000, decimals 8
 */

export type BridgeDirection = 'deposit' | 'withdraw';

export interface BridgeToken {
  readonly symbol: string;
  readonly address: string;
  readonly decimals: number;
  readonly logoURI: string | null;
}

export interface BridgeQuote {
  readonly sourceChainId: number;
  readonly destChainId: number;
  readonly sourceToken: string;
  readonly destToken: string;
  readonly amountIn: string;
  readonly amountOut: string;
  readonly amountOutFormatted: string;
  readonly outSymbol: string;
  readonly fee: string;
  readonly feeFormatted: string;
  readonly estimatedTime: number;
  readonly steps: BridgeStep[];
}

export interface BridgeStep {
  readonly type: 'approve' | 'bridge' | 'swap';
  readonly chainId: number;
  readonly description: string;
  readonly txData: {
    to: string;
    data: string;
    value: string;
  } | null;
}

export interface BridgeStatus {
  readonly txHash: string;
  readonly status: 'pending' | 'confirming' | 'completed' | 'failed';
  readonly sourceChainId: number;
  readonly destChainId: number;
  readonly amountIn: string;
  readonly amountOut: string;
}

export type SupportedChain = {
  readonly chainId: number;
  readonly name: string;
  readonly icon: string;
  readonly nativeCurrency: string;
};

// Hyperliquid L1
export const HL_CHAIN_ID = 1337;
export const HL_USDC_ADDRESS = '0x00000000000000000000000000000000';
export const HL_USDC_DECIMALS = 8;

export const SUPPORTED_EXTERNAL_CHAINS: SupportedChain[] = [
  { chainId: 42161, name: 'Arbitrum', icon: '/chains/arbitrum.png', nativeCurrency: 'ETH' },
  { chainId: 8453, name: 'Base', icon: '/chains/base.png', nativeCurrency: 'ETH' },
  { chainId: 1, name: 'Ethereum', icon: '/chains/ethereum.png', nativeCurrency: 'ETH' },
  { chainId: 10, name: 'Optimism', icon: '/chains/optimism.png', nativeCurrency: 'ETH' },
  // Dedicated World Chain asset is not kept in the trimmed repo, so reuse the
  // shared EVM fallback that still exists in `public/chains`.
  { chainId: 480, name: 'World Chain', icon: '/chains/ethereum.png', nativeCurrency: 'ETH' },
  { chainId: 137, name: 'Polygon', icon: '/chains/polygon.png', nativeCurrency: 'MATIC' },
  { chainId: 43114, name: 'Avalanche', icon: '/chains/avalanche.png', nativeCurrency: 'AVAX' },
];
