// v0.37.1: Account Context Reset Registry
// 계정 컨텍스트 변경(주소/모드) 시 각 도메인이 등록한 핸들러를 동기 실행

import { createLogger } from '@hq/core/logging';

const logger = createLogger('accountContextResetRegistry');

type AccountContextChangeReason = 'address_changed' | 'mode_changed';

type ResetHandler = (reason: AccountContextChangeReason) => void;

const handlers = new Set<ResetHandler>();

/**
 * 계정 컨텍스트 변경 시 실행할 핸들러를 등록합니다.
 * @returns cleanup 함수 (useEffect return에서 호출)
 */
export function registerAccountContextReset(handler: ResetHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

/**
 * 등록된 모든 핸들러를 동기 실행합니다.
 * async 핸들러 미지원 — 핸들러는 반드시 동기여야 합니다.
 * 핸들러 예외는 격리되어 나머지 핸들러 실행에 영향을 주지 않습니다.
 */
export function runAccountContextResets(reason: AccountContextChangeReason): void {
  handlers.forEach((handler) => {
    try {
      handler(reason);
    } catch (err) { // @ci-exception(no-empty-catch) /* event dispatcher handler 격리 */
      logger.error('handler threw', err);
    }
  });
}
