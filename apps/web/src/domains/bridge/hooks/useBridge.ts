'use client';

/**
 * useBridge — Relay Bridge Hook (양방향, 멀티토큰)
 *
 * Relay API (POST):
 * - POST /quote — 브릿지 견적
 * - GET /chains — 체인별 지원 토큰 목록
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { erc20Abi } from 'viem';
import { getPublicClient, getPublicClientNoBatch } from '@hq/core/lib/viemClient';
import { getRpcProvider } from '@hq/core/lib/rpc/provider';
import { ApiError } from '@hq/core/lib/error';
// Read the connected wallet from the app's own auth store, not wagmi —
// Privy-connected addresses (Telegram login, embedded wallets) reach the
// store via browserSync but may not surface through wagmi's useAccount(),
// which previously made balance queries return undefined.
//
// Use selectEOAAddress (the raw signer EOA) rather than selectActiveAddress
// (which can be the smart-account or HL agent wallet) — bridge balances
// live on the user's actual EOA, not on a derived execution address.
import { useAccountStore, selectEOAAddress } from '@/infra/auth/stores';
import type { BridgeDirection, BridgeQuote, BridgeStatus, BridgeToken } from '../types';
import { HL_CHAIN_ID } from '../types';

const RELAY_API_URL = 'https://api.relay.link';

// ─── Token List ─────────────────────────────────────────

interface RelayChainConfig {
  id: number;
  currency: { symbol: string; address: string; decimals: number; metadata?: { logoURI?: string } };
  featuredTokens: Array<{ symbol: string; address: string; decimals: number; supportsBridging?: boolean; metadata?: { logoURI?: string } }>;
  erc20Currencies: Array<{ symbol: string; address: string; decimals: number; supportsBridging?: boolean; metadata?: { logoURI?: string } }>;
}

function parseTokensFromChainConfig(chain: RelayChainConfig): BridgeToken[] {
  const seen = new Set<string>();
  const tokens: BridgeToken[] = [];

  const add = (t: { symbol: string; address: string; decimals: number; supportsBridging?: boolean; metadata?: { logoURI?: string } }) => {
    if (t.supportsBridging === false) return;
    const key = t.address.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tokens.push({
      symbol: t.symbol,
      address: t.address,
      decimals: t.decimals,
      logoURI: t.metadata?.logoURI ?? null,
    });
  };

  // native currency first
  add({ ...chain.currency, supportsBridging: true });
  for (const t of chain.featuredTokens ?? []) add(t);
  for (const t of chain.erc20Currencies ?? []) add(t);

  // Relay API 목록에 없지만 라우트가 동작하는 토큰 보충
  const EXTRA_TOKENS: Record<number, Array<{ symbol: string; address: string; decimals: number; logoURI: string }>> = {
    480: [
      { symbol: 'WLD', address: '0x2cFc85d8E48F8EAB294be644d9E25C3030863003', decimals: 18, logoURI: 'https://assets.coingecko.com/coins/images/31069/standard/worldcoin.jpeg' },
    ],
  };

  for (const t of EXTRA_TOKENS[chain.id] ?? []) {
    add({ ...t, supportsBridging: true, metadata: { logoURI: t.logoURI } });
  }

  return tokens;
}

export function useBridgeTokens(chainId: number) {
  return useQuery({
    queryKey: ['bridge', 'tokens', chainId],
    queryFn: async (): Promise<BridgeToken[]> => {
      const res = await fetch(`${RELAY_API_URL}/chains`); // @ci-exception(no-raw-fetch) — 외부 API, http() 래퍼 부적합 (ngrok 헤더 주입)
      if (!res.ok) throw new ApiError('Failed to fetch chain config', res.status, 'HTTP', null, 'Failed to fetch chain config', null);
      const data = await res.json();
      const chains: RelayChainConfig[] = Array.isArray(data) ? data : data.chains ?? [];
      const chain = chains.find(c => c.id === chainId);
      if (!chain) return [];

      return parseTokensFromChainConfig(chain);
    },
    staleTime: 5 * 60_000, // 5분 캐시
  });
}

// ─── Quote ───────────────────────────────────────────────

interface UseBridgeQuoteParams {
  direction: BridgeDirection;
  externalChainId: number;
  sourceToken: string;
  destToken: string;
  amount: string;           // human-readable (e.g. "10.5")
  sourceDecimals: number;
  walletAddress: string | null;
}

export function useBridgeQuote({
  direction,
  externalChainId,
  sourceToken,
  destToken,
  amount,
  sourceDecimals,
  walletAddress,
}: UseBridgeQuoteParams) {
  const amountRaw = amount && parseFloat(amount) > 0
    ? BigInt(Math.floor(parseFloat(amount) * 10 ** sourceDecimals)).toString()
    : '';

  const originChainId = direction === 'deposit' ? externalChainId : HL_CHAIN_ID;
  const destChainId = direction === 'deposit' ? HL_CHAIN_ID : externalChainId;
  const originCurrency = direction === 'deposit' ? sourceToken : sourceToken;
  const destinationCurrency = direction === 'deposit' ? destToken : destToken;

  // quote-only용 dummy address (지갑 미연결 시에도 견적 조회 가능)
  const QUOTE_DUMMY_ADDRESS = '0x0000000000000000000000000000000000000001';
  const userAddress = walletAddress ?? QUOTE_DUMMY_ADDRESS;

  return useQuery({
    queryKey: ['bridge', 'quote', direction, externalChainId, sourceToken, destToken, amountRaw],
    queryFn: async (): Promise<BridgeQuote> => {
      const res = await fetch(`${RELAY_API_URL}/quote`, { // @ci-exception(no-raw-fetch) — 외부 API, http() 래퍼 부적합 (ngrok 헤더 주입)
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: userAddress,
          originChainId,
          destinationChainId: destChainId,
          originCurrency,
          destinationCurrency,
          amount: amountRaw,
          recipient: userAddress,
          tradeType: 'EXACT_INPUT',
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new ApiError(`Relay quote error: ${text}`, res.status, 'HTTP', null, text, text);
      }
      const data = await res.json();
      const currencyOut = data.details?.currencyOut ?? {};
      const relayerFee = data.fees?.relayer ?? {};

      return {
        sourceChainId: originChainId,
        destChainId,
        sourceToken: originCurrency,
        destToken: destinationCurrency,
        amountIn: amountRaw,
        amountOut: currencyOut.amount ?? '0',
        amountOutFormatted: currencyOut.amountFormatted ?? '0',
        outSymbol: currencyOut.currency?.symbol ?? '?',
        fee: relayerFee.amount ?? '0',
        feeFormatted: relayerFee.amountFormatted ?? '0',
        estimatedTime: data.details?.timeEstimate ?? 120,
        // @ci-exception(type-assertion-count) — Relay API response is untyped, TODO: Zod schema
        steps: (data.steps ?? []).map((step: Record<string, unknown>) => ({
          type: step.id === 'approve' ? 'approve' as const : 'bridge' as const,
          chainId: Number(step.chainId ?? originChainId),
          description: (step.description as string) ?? '', // @ci-exception(type-assertion-count) — Relay API response
          txData: step.items
            ? (() => {
                const items = step.items as Array<Record<string, unknown>>; // @ci-exception(type-assertion-count) — Relay API response
                const item = items[0];
                if (!item?.data) return null;
                const txData = item.data as Record<string, string>; // @ci-exception(type-assertion-count) — Relay API response
                return { to: txData.to, data: txData.data, value: txData.value ?? '0' };
              })()
            : null,
        })),
      };
    },
    enabled: !!amountRaw && !!sourceToken && !!destToken,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

// ─── Execution ──────────────────────────────────────────

export function useBridgeExecution() {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const execute = useCallback(async (
    quote: BridgeQuote,
    sendTransaction: (tx: { to: string; data: string; value: string; chainId: number }) => Promise<string>,
  ) => {
    setIsExecuting(true);
    setStatus({
      txHash: '',
      status: 'pending',
      sourceChainId: quote.sourceChainId,
      destChainId: quote.destChainId,
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
    });

    try {
      for (const step of quote.steps) {
        if (!step.txData) continue;
        const txHash = await sendTransaction({
          to: step.txData.to,
          data: step.txData.data,
          value: step.txData.value,
          chainId: step.chainId,
        });
        setStatus(prev => prev ? { ...prev, txHash, status: 'confirming' } : null);
      }
      setStatus(prev => prev ? { ...prev, status: 'completed' } : null);
    } catch (err) {
      setStatus(prev => prev ? { ...prev, status: 'failed' } : null);
      throw err;
    } finally {
      setIsExecuting(false);
    }
  }, []);

  const reset = useCallback(() => {
    setStatus(null);
    setIsExecuting(false);
  }, []);

  return { status, isExecuting, execute, reset };
}

// ─── Token Balances ─────────────────────────────────────

export interface TokenWithBalance extends BridgeToken {
  balance: string | null;       // human-readable (e.g. "12.50")
  balanceRaw: bigint | null;
}

/**
 * 토큰 목록 + 잔고 조회 + 잔고 기반 정렬
 * 잔고 있는 토큰이 상단에 표시
 */
export function useBridgeTokensWithBalance(chainId: number): {
  tokens: TokenWithBalance[];
  isLoading: boolean;
} {
  const { data: rawTokens, isLoading: tokensLoading } = useBridgeTokens(chainId);
  const address = useAccountStore(selectEOAAddress);

  // Native balance — fetched directly through the core public client so it
  // works for any address the auth store exposes (Privy embedded / social
  // logins included), rather than wagmi which only sees its own connectors.
  const { data: nativeBalance } = useQuery({
    queryKey: ['bridge', 'native-balance', chainId, address],
    queryFn: async () => {
      if (!address) return null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const client = getPublicClient(chainId);
          const value = await client.getBalance({ address });
          return { value, decimals: 18 };
        } catch (err) {
          try { getRpcProvider().reportFailure(chainId, err as Error); } catch { /* non-rotatable */ }
        }
      }
      return null;
    },
    enabled: !!address,
    staleTime: 30_000,
  });

  // ERC-20 잔고들 — 각 토큰별 개별 조회
  const erc20Tokens = useMemo(() =>
    (rawTokens ?? []).filter(t => t.address !== '0x0000000000000000000000000000000000000000'),
  [rawTokens]);

  // wagmi useBalance는 단일 호출이므로 토큰별로 호출할 수 없음
  // 대신 multicall 또는 개별 useBalance로 처리
  // 여기서는 최대 10개 토큰에 대해 React Query로 병렬 조회
  const { data: erc20Balances } = useQuery({
    queryKey: ['bridge', 'balances', chainId, address, erc20Tokens.map(t => t.address).join(',')],
    queryFn: async () => {
      if (!address || erc20Tokens.length === 0) return {};
      const balances: Record<string, { raw: string; formatted: string; decimals: number }> = {};

      // One `balanceOf` read with single-RPC-rotation fallback. drpc.org has
      // returned 500s intermittently on Arbitrum; reportFailure() rotates
      // the round-robin provider to the backup publicnode endpoint so the
      // balance isn't silently zero on the first bad RPC attempt.
      async function readBalanceWithRotation(tokenAddress: `0x${string}`) {
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const client = getPublicClientNoBatch(chainId);
            return await client.readContract({
              address: tokenAddress,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [address!],
            });
          } catch (err) {
            lastErr = err;
            try { getRpcProvider().reportFailure(chainId, err as Error); } catch { /* non-rotatable */ }
          }
        }
        throw lastErr instanceof Error ? lastErr : new Error('balanceOf failed');
      }

      await Promise.all(erc20Tokens.slice(0, 10).map(async (token) => {
        try {
          const raw = await readBalanceWithRotation(token.address as `0x${string}`);
          const formatted = (Number(raw) / 10 ** token.decimals).toFixed(
            token.decimals > 6 ? 4 : 2,
          );
          balances[token.address.toLowerCase()] = { raw: raw.toString(), formatted, decimals: token.decimals };
        } catch { /* skip failed balance after rotation */ }
      }));
      return balances;
    },
    enabled: !!address && erc20Tokens.length > 0,
    staleTime: 30_000,
  });

  const tokens: TokenWithBalance[] = useMemo(() => {
    if (!rawTokens) return [];

    const withBalance = rawTokens.map((t): TokenWithBalance => {
      const isNative = t.address === '0x0000000000000000000000000000000000000000';
      if (isNative && nativeBalance) {
        const formatted = (Number(nativeBalance.value) / 10 ** nativeBalance.decimals).toFixed(4);
        return { ...t, balance: formatted, balanceRaw: nativeBalance.value };
      }
      const erc20 = erc20Balances?.[t.address.toLowerCase()];
      if (erc20) {
        return { ...t, balance: erc20.formatted, balanceRaw: BigInt(erc20.raw) };
      }
      return { ...t, balance: address ? '0' : null, balanceRaw: null };
    });

    // 잔고 있는 토큰이 상단에, 없는 토큰이 하단에
    return withBalance.sort((a, b) => {
      const aVal = a.balanceRaw ?? 0n;
      const bVal = b.balanceRaw ?? 0n;
      if (aVal > 0n && bVal === 0n) return -1;
      if (aVal === 0n && bVal > 0n) return 1;
      return 0;
    });
  }, [rawTokens, nativeBalance, erc20Balances, address]);

  return { tokens, isLoading: tokensLoading };
}
