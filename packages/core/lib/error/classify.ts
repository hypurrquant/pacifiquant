/**
 * Error Classification — SSOT
 *
 * 모든 에러 분류 함수를 한 곳에 집중.
 * 분류 전략: code 1차 → name 2차 → string 3차 fallback
 */

import { extractErrorInfo } from './base';

// --- EIP-1193 Wallet Error Codes ---

export const WALLET_ERROR_CODES = {
  USER_REJECTED_REQUEST: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED_METHOD: 4200,
  DISCONNECTED: 4900,
  CHAIN_DISCONNECTED: 4901,
} as const;

// --- Internal helpers ---

/** viem error에서 details 필드를 안전 추출 */
function getViemDetails(error: unknown): string {
  if (
    error instanceof Error &&
    'details' in error &&
    typeof (error as Record<string, unknown>).details === 'string' // @ci-exception(no-type-assertion)
  ) {
    return ((error as Record<string, unknown>).details as string).toLowerCase(); // @ci-exception(no-type-assertion)
  }
  return '';
}

function getSearchText(error: unknown): string {
  const info = extractErrorInfo(error);
  const details = getViemDetails(error);
  return `${info.messageLower} ${details}`;
}

// ---- Rate Limit (3곳 합집합) ----

export function isRateLimitError(error: unknown): boolean {
  // 1차: status 프로퍼티 (Response 또는 Response-like 객체)
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as Record<string, unknown>).status; // @ci-exception(no-type-assertion)
    if (status === 429) return true;
  }
  // 3차: code 필드
  const info = extractErrorInfo(error);
  if (info.code === 429) return true;
  // 3차: string matching (viem details 포함)
  const text = getSearchText(error);
  return text.includes('429') || text.includes('rate limit');
}

// ---- Timeout ----

export function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'TimeoutError') return true;
  const info = extractErrorInfo(error);
  return info.messageLower.includes('timeout') || info.messageLower.includes('timed out') || info.messageLower.includes('wait timeout');
}

// ---- Range Halvable ----

export function isRangeHalvableError(error: unknown): boolean {
  const text = getSearchText(error);
  return (
    text.includes('response size is too large') ||
    text.includes('query returned more than') ||
    text.includes('log response size exceeded') ||
    text.includes('response is too big') ||
    text.includes('exceeds max block range')
  );
}

// ---- Rotatable (RPC provider rotation 대상) ----

export function isRotatableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  if (isRateLimitError(error)) return true;

  const text = getSearchText(error);

  // 5xx server errors
  if (/\b5\d{2}\b/.test(text)) return true;

  // connection errors
  if (
    text.includes('econnrefused') ||
    text.includes('econnreset') ||
    text.includes('enotfound') ||
    text.includes('socket hang up') ||
    text.includes('fetch failed') ||
    text.includes('network error')
  ) {
    return true;
  }

  // timeout
  if (isTimeoutError(error)) return true;

  return false;
}

// ---- Retryable Network (HTTP client용) ----

export function isRetryableNetworkError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('Load failed') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('Failed to fetch')
  );
}

// ---- TX classification (web에서 사용) ----

export function isUserRejection(error: unknown): boolean {
  const { code, name, messageLower } = extractErrorInfo(error);
  return (
    code === WALLET_ERROR_CODES.USER_REJECTED_REQUEST ||
    name === 'UserRejectedRequestError' ||
    messageLower.includes('user rejected') ||
    messageLower.includes('user denied') ||
    messageLower.includes('rejected the request')
  );
}

export function isInsufficientFunds(error: unknown): boolean {
  const { messageLower } = extractErrorInfo(error);
  return (
    messageLower.includes('insufficient funds') ||
    messageLower.includes('insufficient balance') ||
    messageLower.includes('not enough balance')
  );
}

export function isGasEstimationFailed(error: unknown): boolean {
  const { messageLower } = extractErrorInfo(error);
  return (
    messageLower.includes('gas estimation') ||
    messageLower.includes('cannot estimate gas') ||
    messageLower.includes('execution reverted')
  );
}

export function isUserOpError(error: unknown): boolean {
  const { name, messageLower } = extractErrorInfo(error);
  return (
    name === 'UserOperationExecutionError' ||
    name === 'UserOperationReverted' ||
    messageLower.includes('useroperation') ||
    (messageLower.includes('aa') && messageLower.includes('revert'))
  );
}

export function isContractRevert(error: unknown): boolean {
  const { name, messageLower } = extractErrorInfo(error);
  return (
    name === 'ContractFunctionRevertedError' ||
    messageLower.includes('revert') ||
    messageLower.includes('reverted')
  );
}

export function isNetworkError(error: unknown): boolean {
  const { code, messageLower } = extractErrorInfo(error);
  return (
    code === WALLET_ERROR_CODES.DISCONNECTED ||
    code === WALLET_ERROR_CODES.CHAIN_DISCONNECTED ||
    code === 'NETWORK_ERROR' ||
    messageLower.includes('network') ||
    messageLower.includes('connection') ||
    messageLower.includes('timeout') ||
    messageLower.includes('fetch failed')
  );
}
