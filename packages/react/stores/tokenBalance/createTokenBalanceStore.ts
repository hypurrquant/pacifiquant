/**
 * createTokenBalanceStore — v1.41.5
 *
 * Factory 패턴: RPC 접근 방식을 DI로 주입.
 * web: getPublicClient (viem direct), mobile: getRpcProvider().getClient
 */

import { create } from 'zustand';
import { ERC20_ABI } from '@hq/core/token/erc20';
import { NATIVE_SENTINEL } from '@hq/core/token/constants';
import { createLogger } from '@hq/core/logging';
import type { TokenBalanceStoreDeps, TokenBalanceState, TokenBalanceActions } from './types';

const logger = createLogger('store:tokenBalance');

function makeRefreshKey(owner: string, chainId: number): string {
  return `${owner.toLowerCase()}:${chainId}`;
}

/** cache[owner][chainId] slice 조회. 소비자 selector에서 사용. */
export function getBalanceSlice(
  cache: Record<string, Record<string, Record<string, bigint>>>,
  owner: `0x${string}` | null,
  chainId: number | null,
): Record<string, bigint> {
  if (!owner || chainId === null) return {};
  return cache[owner.toLowerCase()]?.[String(chainId)] ?? {};
}

const initialState: TokenBalanceState = {
  cache: {},
  _refreshingKeys: {},
  _fetchErrorKeys: {},
};

export function createTokenBalanceStore(deps: TokenBalanceStoreDeps) {
  return create<TokenBalanceState & TokenBalanceActions>()(
    (set, get) => ({
      ...initialState,

      getBalance: (owner, chainId, token) => {
        const slice = getBalanceSlice(get().cache, owner, chainId);
        return slice[token.toLowerCase()] ?? 0n;
      },

      isRefreshingFor: (owner, chainId) => {
        return !!get()._refreshingKeys[makeRefreshKey(owner, chainId)];
      },

      hasFetchError: (owner, chainId) => {
        return !!get()._fetchErrorKeys[`${owner.toLowerCase()}:${chainId}`];
      },

      refresh: async (owner, chainId, tokens) => {
        if (tokens.length === 0) return;

        const ownerKey = owner.toLowerCase();
        const chainKey = String(chainId);
        const refreshKey = makeRefreshKey(ownerKey, chainId);

        if (get()._refreshingKeys[refreshKey]) return;

        set((s) => ({
          _refreshingKeys: { ...s._refreshingKeys, [refreshKey]: true as const },
        }));

        const snapshotRefreshKey = refreshKey;

        try {
          const client = deps.getPublicClient(chainId);
          const results: Record<string, bigint> = {};

          const nativeTokens = tokens.filter(
            (t) => t.toLowerCase() === NATIVE_SENTINEL,
          );
          const erc20Tokens = tokens.filter(
            (t) => t.toLowerCase() !== NATIVE_SENTINEL,
          );

          if (nativeTokens.length > 0) {
            try {
              const balance = await client.getBalance({ address: owner });
              results[NATIVE_SENTINEL] = balance;
            } catch (err) { // @ci-exception(no-empty-catch)
              logger.warn('native balance fetch failed', { owner, chainId, err });
              results[NATIVE_SENTINEL] = 0n;
              set((s) => ({
                _fetchErrorKeys: { ...s._fetchErrorKeys, [snapshotRefreshKey]: true as const },
              }));
            }
          }

          if (erc20Tokens.length > 0) {
            const promises = erc20Tokens.map(async (token) => {
              try {
                const balance = await client.readContract({
                  address: token,
                  abi: ERC20_ABI,
                  functionName: 'balanceOf',
                  args: [owner],
                });
                const balanceBigint: bigint = typeof balance === 'bigint' ? balance : 0n;
                return { token: token.toLowerCase(), balance: balanceBigint };
              } catch (err) { // @ci-exception(no-empty-catch)
                logger.warn('ERC20 balance fetch failed', { token, owner, chainId, err });
                set((s) => ({
                  _fetchErrorKeys: { ...s._fetchErrorKeys, [snapshotRefreshKey]: true as const },
                }));
                return { token: token.toLowerCase(), balance: 0n };
              }
            });

            const settled = await Promise.all(promises);
            for (const { token, balance } of settled) {
              results[token] = balance;
            }
          }

          set((s) => {
            if (!s._refreshingKeys[snapshotRefreshKey]) return {};

            const prevOwnerCache = s.cache[ownerKey] ?? {};
            const prevChainCache = prevOwnerCache[chainKey] ?? {};
            const newChainCache = { ...prevChainCache, ...results };
            const newOwnerCache = { ...prevOwnerCache, [chainKey]: newChainCache };
            const newCache = { ...s.cache, [ownerKey]: newOwnerCache };

            const { [snapshotRefreshKey]: _, ...restKeys } = s._refreshingKeys;
            const { [snapshotRefreshKey]: __, ...restErrorKeys } = s._fetchErrorKeys;

            return {
              cache: newCache,
              _refreshingKeys: restKeys,
              _fetchErrorKeys: restErrorKeys,
            };
          });
        } catch (err) { // @ci-exception(no-empty-catch)
          logger.warn('token balance fetch failed', { owner, chainId, err });
          set((s) => {
            if (!s._refreshingKeys[snapshotRefreshKey]) return {};
            const { [snapshotRefreshKey]: _, ...restKeys } = s._refreshingKeys;
            return {
              _refreshingKeys: restKeys,
              _fetchErrorKeys: { ...s._fetchErrorKeys, [snapshotRefreshKey]: true as const },
            };
          });
        }
      },

      clear: () => {
        set(initialState);
      },
    }),
  );
}
