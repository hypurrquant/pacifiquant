import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import {
  createAuthSlice,
  createWalletSlice,
  createTxSlice,
  createAuthInitialState,
  walletInitialState,
  type AccountStore,
} from './slices';
import { computeActiveAccount } from './apis/activeAccount';
import { createSyncRuntime, type SyncRuntime } from './apis/syncState';
import type { AccountStoreDeps } from './deps';

export function createAccountStore(
  deps: AccountStoreDeps,
  syncRuntime: SyncRuntime = createSyncRuntime(deps)
) {

  const initialState = {
    ...createAuthInitialState(deps.providers.sourceProviderIds),
    ...walletInitialState,
    ...deps.aaInitialState,
  };

  return create<AccountStore>()(
    devtools(
      persist(
        (set, get, api) => {
          const authSlice = createAuthSlice(deps.providers.sourceProviderIds)(set, get, api);
          const walletSlice = createWalletSlice(set, get, api);
          const aaSlice = deps.createAASlice(set, get, api);
          const txSlice = createTxSlice(deps)(set, get, api);

          return {
            ...authSlice,
            ...walletSlice,
            ...aaSlice,
            ...txSlice,

            getActiveAccount: () => computeActiveAccount(get()),

            syncPrivyState: (action) =>
              syncRuntime.syncPrivyState(get, set, action),

            reset: () => {
              const { privy } = get();
              set({ ...initialState, privy }, false, 'reset');
            },
          };
        },
        {
          name: deps.persist.name,
          version: deps.persist.version,
          storage: deps.persist.storage,
          partialize: (state) => ({
            executionSelection: state.executionSelection,
            authSelection: state.authSelection,
          }),
          merge: (persisted, current) => ({
            ...current,
            ...(persisted as Partial<AccountStore>), // @ci-exception(type-assertion-count)
          }),
          migrate: (persistedState: any, version: number) => { // @ci-exception(no-explicit-any)
            if (version < 6) {
              if (persistedState && typeof persistedState === 'object') {
                delete persistedState.currentChain;
                delete persistedState.expectedChain;
                delete persistedState.chainId;
              }
              return {
                authSelection: persistedState?.authSelection ?? { source: null, isUserSelected: false },
                executionSelection: persistedState?.executionSelection ?? { mode: 'eoa', isUserSelected: false },
              };
            }
            return persistedState;
          },
        }
      ),
      { name: 'AccountStore' }
    )
  );
}
