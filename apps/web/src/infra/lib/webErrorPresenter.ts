/**
 * WebErrorPresenter — 웹 플랫폼 에러 표시 어댑터
 * v1.31.5: presentError() → toast 표시
 * v1.37.0: severity/retryable 활용 + buildErrorReport 준비
 */

import type { ErrorPresenter, ErrorMeta } from '@hq/core/lib/error';
import type { AppError } from '@hq/core/lib/error';
import { useToastStore } from '@/shared/stores/useToastStore';

/**
 * 에러 정보를 구조화된 리포트 객체로 변환.
 * 전송 인프라 확보 후 활성화 예정 (현재 비활성).
 */
export function buildErrorReport(error: AppError): {
  code: string;
  message: string;
  cause: string | null;
  timestamp: string;
  userAgent: string;
} {
  return {
    code: error.code,
    message: error.message,
    cause: error.cause instanceof Error ? error.cause.message : error.cause ? String(error.cause) : null,
    timestamp: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
  };
}

export const webErrorPresenter: ErrorPresenter = {
  present(_error: AppError, meta: ErrorMeta, message: string): void {
    const toastType = meta.severity === 'warning' ? 'warning' : 'error';
    const duration = meta.severity === 'critical' ? 10_000 : 5_000;
    const detail = meta.retryable ? 'You can retry this action.' : null;

    useToastStore.getState().addToast({
      type: toastType,
      title: message,
      message: detail,
      duration,
    });

    // TODO: unknown error report UI (전송 인프라 확보 후 활성화)
    // if (_error.code === 'UNEXPECTED') {
    //   const report = buildErrorReport(_error);
    //   // Report 버튼 toast 또는 자동 전송
    // }
  },
};
