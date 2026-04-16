import type { PersistStorage } from 'zustand/middleware';
import type { AuthSourceProviderMap, TxExecutor, WalletAdapter } from '@hq/core/auth';
import type { SupportedChainId } from '@hq/core/config/chains';
import type { AASlice, AASliceState, SliceCreator } from './slices/types';

export type TxRuntimeCreateExecutorInput =
  | {
      mode: 'aa';
      kernelClient: NonNullable<AASliceState['kernelClient']>;
    }
  | {
      mode: 'eoa';
      eoaAddress: `0x${string}`;
    };

export interface AccountStoreDeps {
  providers: {
    sourceProviderIds: AuthSourceProviderMap;
  };
  persist: {
    name: string;
    version: number;
    storage: PersistStorage<unknown>;
  };
  effects: {
    invalidateChainData(): void;
    notify(input: { title: string; message: string | null; type: 'info' | 'warning' | 'error' }): void;
  };
  timers: {
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  txRuntime: {
    createExecutor(adapter: WalletAdapter, input: TxRuntimeCreateExecutorInput): Promise<TxExecutor> | TxExecutor;
    ensureChainReady(input: { targetChainId: SupportedChainId }): Promise<void>;
  };
  aaInitialState: AASliceState;
  createAASlice: SliceCreator<AASlice>;
}
