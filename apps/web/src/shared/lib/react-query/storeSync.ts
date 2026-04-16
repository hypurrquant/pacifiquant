// lib/react-query/storeSync.ts
// Store-Query Synchronization (v0.9.1: Phase 2.6)
// v1.3.2: import 경로 수정 - 순환 의존성 제거
// Invalidates React Query cache when chain changes

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { storeEvents } from '@/infra/lib/eventBus';

/**
 * Hook to synchronize Zustand store events with React Query cache
 * - Listens to 'invalidate:chain-data' event from useAccountStore (v0.12.9)
 * - Invalidates all chain-dependent queries
 */
export function useStoreQuerySync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleInvalidate = () => {
      // Invalidate all chain-specific queries
      queryClient.invalidateQueries({ queryKey: ['lp-vaults'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['position'] }); // positionDetail
      queryClient.invalidateQueries({ queryKey: ['pool-data'] });
      queryClient.invalidateQueries({ queryKey: ['ticks-data'] });
    };

    storeEvents.on('invalidate:chain-data', handleInvalidate);

    return () => {
      storeEvents.off('invalidate:chain-data', handleInvalidate);
    };
  }, [queryClient]);
}
