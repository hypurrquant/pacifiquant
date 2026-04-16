// v0.29.6: React Query localStorage persist
// SDK pool 데이터를 localStorage에 캐시하여 새로고침 시 즉시 표시
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

export const queryPersister = createSyncStoragePersister({
  storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  key: 'hq-rq-cache',
  throttleTime: 1000,
});
