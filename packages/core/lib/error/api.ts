import { AppError } from './base';

type ApiErrorKind = 'HTTP' | 'BACKEND';

/**
 * ApiError — BE API 에러 표현.
 *
 * BE wire format: { code: number, error_message?: string, message?: string | null, data?: {} }
 * 메시지 소스 SSOT: resolveApiErrorMessage(beCode, { error_message, detail }, fallback)
 * 우선순위: BE_ERROR_MESSAGES[code] > wire.error_message > wire.detail > fallback
 * NOTE: wire.message는 무시 (BE 확인 결과 항상 null)
 */
export class ApiError extends AppError {
  readonly code = 'API_ERROR' as const;

  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly kind: ApiErrorKind,
    public readonly beCode: number | null,
    public readonly beMessage: string,
    public readonly data: unknown | null = null,
    opts: ErrorOptions = {},
  ) {
    super(message, { cause: opts.cause });
  }
}

// ---- BE Error Code Registry ----

const BE_ERROR_MESSAGES: Record<number, string> = {
  // 3xxx: Account
  3001: 'Maximum account limit reached (10). Please contact support.',
  3002: 'This nickname is already taken.',
  3010: 'Account not found. Please register first.',
  3015: 'This wallet is already registered.',
};

export function getApiErrorTitle(beCode: number | null): string {
  if (beCode === null) return 'Request Failed';
  if (beCode >= 3000 && beCode < 4000) return 'Request Failed';
  if (beCode >= 8000 && beCode < 9000) return 'DEX Error';
  if (beCode >= 9000 && beCode < 10000) return 'Data Error';
  return 'Error';
}

/**
 * BE 에러 코드에 대한 사용자 메시지 결정.
 *
 * 우선순위:
 * 1. BE_ERROR_MESSAGES[beCode] — 수동 매핑 (가장 높은 우선순위)
 * 2. wireFields.error_message — BE가 보낸 커스텀 메시지
 * 3. wireFields.detail — 일부 BE가 detail 사용
 * 4. fallback — 최종 fallback
 *
 * wire.message는 무시 (BE 확인 결과 항상 null)
 * beCode가 null이면 wireFields/fallback으로 직접 진행
 */
export function resolveApiErrorMessage(
  beCode: number | null,
  wireFields: Pick<ApiErrorBody, 'error_message' | 'detail'>,
  fallback: string,
): string {
  if (beCode !== null) {
    const mapped = BE_ERROR_MESSAGES[beCode];
    if (mapped) return mapped;
  }
  return (
    wireFields.error_message ??
    wireFields.detail ??
    fallback
  );
}

// ---- BE 응답 body 파싱 ----

import type { ApiErrorBody } from './types';
export type { ApiErrorBody } from './types';

export function isApiErrorBody(data: unknown): data is ApiErrorBody {
  return (
    typeof data === 'object' &&
    data !== null &&
    'code' in data &&
    typeof (data as Record<string, unknown>).code === 'number' // @ci-exception(no-type-assertion)
  );
}
