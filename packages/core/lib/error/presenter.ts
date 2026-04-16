/**
 * ErrorPresenter — 에러 처리 DI
 *
 * catch 후 2개의 축:
 *   축 1: 에러를 전파하는가? (toast, state, throw)
 *   축 2: 실행을 계속하는가? (함수가 이어서 동작하는가)
 *
 *                 전파 O              전파 X
 *   계속 X   │ 목적 1: 사용자 알림  │ ❌ 금지 (logger only)
 *   계속 O   │ 목적 2: 상태 전파    │ 목적 3,4: degradation/recovery
 *
 * presentError()는 목적 1 용도. boundary에서 1회만 호출한다.
 * 플랫폼이 setErrorPresenter()로 "어떻게 처리할지"를 주입한다.
 *   - web: Toast UI (severity/retryable 활용)
 *   - mobile: Alert 등 (미구현)
 *   - server: 로깅/메트릭 등 (미구현)
 *
 * 상세: docs/guide/common/architecture/core/lib/error/README.md > "catch 후 2개의 축"
 */

import { AppError } from './base';
import { getErrorMeta, type ErrorMeta } from './errorRegistry';
import { UnexpectedError } from './unexpected';

export type { ErrorMeta };

export interface ErrorPresenter {
  present(error: AppError, meta: ErrorMeta, message: string): void;
}

let _presenter: ErrorPresenter | null = null;

export function setErrorPresenter(p: ErrorPresenter): void {
  _presenter = p;
}

/**
 * Message precedence:
 * - UNEXPECTED → 항상 meta.message (내부 문자열 노출 방지)
 * - 나머지 → error.message 우선, 없으면 meta.message fallback
 */
function resolveMessage(error: AppError, meta: ErrorMeta): string {
  if (error.code === 'UNEXPECTED') return meta.message;
  return error.message || meta.message;
}

/**
 * 에러를 사용자에게 표시. boundary에서 1회만 호출.
 */
export function presentError(error: AppError): void {
  const meta = getErrorMeta(error.code);
  const message = resolveMessage(error, meta);
  if (_presenter) _presenter.present(error, meta, message);
}

/**
 * unknown → AppError 변환. boundary catch에서 narrowing 중복 방지.
 * AppError이면 그대로, 아니면 UnexpectedError로 래핑.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new UnexpectedError(
    error instanceof Error ? error.message : String(error),
    error instanceof Error ? error : undefined,
  );
}

// resolveMessage를 테스트에서 사용할 수 있도록 export
export { resolveMessage };
