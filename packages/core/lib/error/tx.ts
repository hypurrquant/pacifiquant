import { AppError } from './base';

export type TxErrorCodeSuffix =
  | 'USER_REJECTED'
  | 'INSUFFICIENT_FUNDS'
  | 'GAS_ESTIMATION_FAILED'
  | 'USER_OP_FAILED'
  | 'NETWORK_ERROR'
  | 'CONTRACT_REVERT'
  | 'CONFIRMATION_TIMEOUT'
  | 'UNSUPPORTED_CHAIN'
  | 'UNKNOWN_ERROR';

export type TxErrorCodeKey =
  | 'USER_REJECTED'
  | 'INSUFFICIENT_FUNDS'
  | 'GAS_ESTIMATION_FAILED'
  | 'USER_OP_FAILED'
  | 'NETWORK_ERROR'
  | 'CONTRACT_REVERT'
  | 'CONFIRMATION_TIMEOUT'
  | 'UNSUPPORTED_CHAIN'
  | 'UNKNOWN';

export type TxErrorCode = `TX_${TxErrorCodeSuffix}`;

export const TX_ERROR_CODES: Record<TxErrorCodeKey, TxErrorCode> = {
  USER_REJECTED: 'TX_USER_REJECTED',
  INSUFFICIENT_FUNDS: 'TX_INSUFFICIENT_FUNDS',
  GAS_ESTIMATION_FAILED: 'TX_GAS_ESTIMATION_FAILED',
  USER_OP_FAILED: 'TX_USER_OP_FAILED',
  NETWORK_ERROR: 'TX_NETWORK_ERROR',
  CONTRACT_REVERT: 'TX_CONTRACT_REVERT',
  CONFIRMATION_TIMEOUT: 'TX_CONFIRMATION_TIMEOUT',
  UNSUPPORTED_CHAIN: 'TX_UNSUPPORTED_CHAIN',
  UNKNOWN: 'TX_UNKNOWN_ERROR',
};

export class TxError extends AppError {
  readonly code: `TX_${TxErrorCodeSuffix}`;
  readonly hash: `0x${string}` | null;

  constructor(
    code: TxErrorCode,
    message: string,
    hash: `0x${string}` | null,
    cause: unknown = undefined,
  ) {
    super(message, cause != null ? { cause } : {});
    this.name = 'TxError';
    this.code = code;
    this.hash = hash;
  }
}

export function createTxError(
  code: TxErrorCode,
  message: string,
  hash: `0x${string}` | null,
  cause: unknown = undefined,
): TxError {
  return new TxError(code, message, hash, cause);
}

export function isTxError(error: unknown): error is TxError {
  return error instanceof TxError;
}
