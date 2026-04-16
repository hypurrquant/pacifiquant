// v1.41.5: Factory re-export — 구현은 @hq/react, DI로 web RPC 주입
import { createTokenBalanceStore, getBalanceSlice } from '@hq/react';
import { getPublicClient } from '@hq/core/lib/viemClient';

export const useTokenBalanceStore = createTokenBalanceStore({
  getPublicClient,
});

export { getBalanceSlice };
