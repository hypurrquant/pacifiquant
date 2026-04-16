/**
 * Error Types
 * API 에러 관련 타입 정의
 */

export type ApiErrorBody = {
  code: number;
  error_message?: string; // @ci-exception(no-optional-without-default) — external wire format
  detail?: string;        // @ci-exception(no-optional-without-default) — external wire format
  data?: unknown;         // @ci-exception(no-optional-without-default) — external wire format
}
