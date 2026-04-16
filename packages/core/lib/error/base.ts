/**
 * AppError — 모든 어플리케이션 에러의 base class.
 *
 * code: stable machine identifier — 에러 종류 식별 문자열 (type guard용)
 * cause: 원인 에러 (Error.cause 표준)
 */
export abstract class AppError extends Error {
  abstract readonly code: string;

  readonly cause: unknown | null;

  constructor(message: string, opts: ErrorOptions = {}) {
    super(message);
    this.cause = opts.cause ?? null;
    this.name = this.constructor.name;
  }
}

// --- ensureError ---

export function ensureError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

// --- extractErrorInfo ---

type ErrorInfo = {
  message: string;
  messageLower: string;
  code: number | string | undefined;
  name: string | undefined;
}

/**
 * unknown 타입 에러에서 message, code, name을 안전하게 추출.
 * EIP-1193 wallet 에러, viem 에러 등 다양한 에러 형태에 대응.
 */
export function extractErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof Error) {
    const rec = error as unknown as Record<string, unknown>; // @ci-exception(no-type-assertion)
    return {
      message: error.message,
      messageLower: error.message.toLowerCase(),
      code: rec['code'] as number | string | undefined,
      name: error.name,
    };
  }
  if (typeof error === 'object' && error !== null) {
    const rec = error as Record<string, unknown>;
    const msg = typeof rec['message'] === 'string' ? rec['message'] : String(error);
    return {
      message: msg,
      messageLower: msg.toLowerCase(),
      code: rec['code'] as number | string | undefined,
      name: typeof rec['name'] === 'string' ? rec['name'] : undefined,
    };
  }
  const msg = String(error);
  return { message: msg, messageLower: msg.toLowerCase(), code: undefined, name: undefined };
}

/**
 * unknown 타입 에러에서 message를 안전하게 추출하는 편의 함수.
 * TODO: 향후 Zod 기반 typed error boundary 도입 시 이 함수의 사용처를 typed catch로 대체
 */
export function getErrorMessage(error: unknown): string {
  return extractErrorInfo(error).message;
}
