'use client';

import { useMemo } from 'react';
import type { PerpDexId } from '@/domains/perp/types/perp.types';
import { useAgentWalletStore, selectIsAgentActive, selectMasterAddress } from '@/domains/perp/stores/useAgentWalletStore';
import { usePacificaAgentStore, selectPacificaMainAccount } from '@/domains/perp/stores/usePacificaAgentStore';
import { useLighterAgentStore } from '@/domains/perp/stores/useLighterAgentStore';
import { useAsterAgentStore, selectAsterL1Address } from '@/domains/perp/stores/useAsterAgentStore';
import { useAccountStore, selectActiveAddress } from '@/infra/auth/stores';

export interface StrategyExchangeAccounts {
  readonly walletAddress: string | null;
  readonly hyperliquid: string | null;
  readonly pacifica: string | null;
  readonly lighter: string | null;
  readonly aster: string | null;
  readonly byDex: Record<PerpDexId, string | null>;
}

export function useStrategyExchangeAccounts(): StrategyExchangeAccounts {
  const walletAddress = useAccountStore(selectActiveAddress);
  const isHlAgentActive = useAgentWalletStore(selectIsAgentActive);
  const hlMasterAddress = useAgentWalletStore(selectMasterAddress);
  const pacificaMainAccount = usePacificaAgentStore(selectPacificaMainAccount);
  const lighterPersisted = useLighterAgentStore((store) => store.persisted);
  const asterL1Address = useAsterAgentStore(selectAsterL1Address);

  return useMemo(() => {
    const normalizedWalletAddress = walletAddress ? walletAddress.toLowerCase() : null;
    const hyperliquid = isHlAgentActive && hlMasterAddress
      ? hlMasterAddress.toLowerCase()
      : normalizedWalletAddress;
    const lighter = lighterPersisted.type === 'registered'
      ? lighterPersisted.l1Address.toLowerCase()
      : normalizedWalletAddress;
    const aster = asterL1Address ? asterL1Address.toLowerCase() : normalizedWalletAddress;
    const byDex: Record<PerpDexId, string | null> = {
      hyperliquid,
      pacifica: pacificaMainAccount,
      lighter,
      aster,
    };

    return {
      walletAddress: normalizedWalletAddress,
      hyperliquid,
      pacifica: pacificaMainAccount,
      lighter,
      aster,
      byDex,
    };
  }, [
    walletAddress,
    isHlAgentActive,
    hlMasterAddress,
    pacificaMainAccount,
    lighterPersisted,
    asterL1Address,
  ]);
}
