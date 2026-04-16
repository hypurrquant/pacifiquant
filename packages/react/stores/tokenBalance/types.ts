/**
 * TokenBalanceStore DI Types — v1.41.5
 */

import type { PublicClient } from 'viem';

export interface TokenBalanceStoreDeps {
  getPublicClient: (chainId: number) => PublicClient;
}

export interface TokenBalanceState {
  cache: Record<string, Record<string, Record<string, bigint>>>;
  _refreshingKeys: Record<string, true>;
  _fetchErrorKeys: Record<string, true>;
}

export interface TokenBalanceActions {
  getBalance: (owner: `0x${string}`, chainId: number, token: `0x${string}`) => bigint;
  isRefreshingFor: (owner: `0x${string}`, chainId: number) => boolean;
  hasFetchError: (owner: `0x${string}`, chainId: number) => boolean;
  refresh: (owner: `0x${string}`, chainId: number, tokens: `0x${string}`[]) => Promise<void>;
  clear: () => void;
}
