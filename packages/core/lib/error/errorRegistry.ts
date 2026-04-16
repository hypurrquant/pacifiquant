/**
 * ErrorRegistry — AppError code → ErrorMeta 1:1 매핑
 * v1.31.5: 통합 에러 표시 아키텍처
 */

export type ErrorSeverity = 'critical' | 'error' | 'warning';

export type ErrorMeta = {
  severity: ErrorSeverity;
  /** fallback message — error.message가 우선. UNEXPECTED는 항상 이 값 사용 */
  message: string;
  retryable: boolean;
};

const ERROR_META: Record<string, ErrorMeta> = {
  // ── NEW (v1.31.5) ──
  RPC_ERROR:          { severity: 'warning',  message: 'Failed to load data',        retryable: true },
  CHAIN_SWITCH_ERROR: { severity: 'critical', message: 'Failed to switch chain',     retryable: false },
  AUTH_ERROR:         { severity: 'error',    message: 'Authentication failed',      retryable: false },
  APPROVAL_ERROR:     { severity: 'error',    message: 'Operation failed',           retryable: false },
  UNEXPECTED:         { severity: 'error',    message: 'Something went wrong',       retryable: false },

  // ── 기존 AppError codes ──
  API_ERROR:          { severity: 'error',    message: 'Request failed',             retryable: false },
  SDK_NETWORK:        { severity: 'warning',  message: 'Network error',              retryable: true },
  SDK_RATE_LIMIT:     { severity: 'warning',  message: 'Rate limited',              retryable: true },
  SDK_VALIDATION:     { severity: 'error',    message: 'Validation error',           retryable: false },
  SDK_CONFIG:         { severity: 'error',    message: 'Configuration error',        retryable: false },
  CONFIG_ERROR:       { severity: 'error',    message: 'Configuration error',        retryable: false },
  VALIDATION_ERROR:   { severity: 'error',    message: 'Invalid input',              retryable: false },
  ADAPTER_ERROR:      { severity: 'error',    message: 'Operation not supported',    retryable: false },
  CONTEXT_REQUIRED:   { severity: 'error',    message: 'Required context missing',   retryable: false },
  BUILD_ERROR:        { severity: 'error',    message: 'Transaction build failed',   retryable: false },
  TX_EXECUTION_ERROR: { severity: 'error',    message: 'Transaction failed',         retryable: false },
  EFFECT_EXECUTION_ERROR: { severity: 'error', message: 'Action failed',             retryable: false },
  PIPELINE_ERROR:     { severity: 'error',    message: 'Transaction failed',         retryable: false },

  // ── TX 에러 (v1.42.0: TxError → AppError 통합) ──
  TX_USER_REJECTED:         { severity: 'warning',  message: 'Transaction was rejected',    retryable: false },
  TX_INSUFFICIENT_FUNDS:    { severity: 'error',    message: 'Insufficient funds',          retryable: false },
  TX_GAS_ESTIMATION_FAILED: { severity: 'error',    message: 'Transaction may fail',        retryable: true },
  TX_USER_OP_FAILED:        { severity: 'error',    message: 'Transaction failed',          retryable: false },
  TX_NETWORK_ERROR:         { severity: 'warning',  message: 'Network error',               retryable: true },
  TX_CONTRACT_REVERT:       { severity: 'error',    message: 'Transaction reverted',        retryable: false },
  TX_CONFIRMATION_TIMEOUT:  { severity: 'warning',  message: 'Confirmation pending',        retryable: false },
  TX_UNSUPPORTED_CHAIN:     { severity: 'error',    message: 'Unsupported chain',           retryable: false },
  TX_UNKNOWN_ERROR:         { severity: 'error',    message: 'Transaction failed',          retryable: false },
};

const UNEXPECTED_META: ErrorMeta = ERROR_META['UNEXPECTED'];

export function getErrorMeta(code: string): ErrorMeta {
  return ERROR_META[code] ?? UNEXPECTED_META;
}
