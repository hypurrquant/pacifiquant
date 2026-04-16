import { extractErrorInfo } from './base';
import {
  isUserRejection,
  isInsufficientFunds,
  isGasEstimationFailed,
  isUserOpError,
  isContractRevert,
  isNetworkError,
} from './classify';
import { TX_ERROR_CODES, createTxError, isTxError, type TxError } from './tx';

/**
 * unknown → TxError 정규화.
 *
 * 우선순위:
 * 1. 기존 TxError passthrough
 * 2. user rejection
 * 3. insufficient funds
 * 4. gas estimation failed
 * 5. user operation failed
 * 6. contract revert
 * 7. network error
 * 8. fallback unknown
 */
export function parseTxError(error: unknown): TxError {
  if (isTxError(error)) {
    return error;
  }

  if (isUserRejection(error)) {
    return createTxError(
      TX_ERROR_CODES.USER_REJECTED,
      'Transaction was rejected by user',
      null,
      error
    );
  }

  if (isInsufficientFunds(error)) {
    return createTxError(
      TX_ERROR_CODES.INSUFFICIENT_FUNDS,
      'Insufficient funds for transaction',
      null,
      error
    );
  }

  if (isGasEstimationFailed(error)) {
    return createTxError(
      TX_ERROR_CODES.GAS_ESTIMATION_FAILED,
      'Failed to estimate gas. The transaction may fail.',
      null,
      error
    );
  }

  if (isUserOpError(error)) {
    return createTxError(
      TX_ERROR_CODES.USER_OP_FAILED,
      extractUserOpErrorMessage(error),
      null,
      error
    );
  }

  if (isContractRevert(error)) {
    return createTxError(
      TX_ERROR_CODES.CONTRACT_REVERT,
      extractRevertReason(error),
      null,
      error
    );
  }

  if (isNetworkError(error)) {
    return createTxError(
      TX_ERROR_CODES.NETWORK_ERROR,
      'Network connection failed. Please try again.',
      null,
      error
    );
  }

  return createTxError(
    TX_ERROR_CODES.UNKNOWN,
    error instanceof Error ? error.message : 'An unknown error occurred',
    null,
    error
  );
}

function extractUserOpErrorMessage(error: unknown): string {
  const { message } = extractErrorInfo(error);
  if (message) {
    const match = message.match(/reason:\s*(.+?)(?:\n|$)/i);
    if (match) return match[1].trim();

    const shortMatch = message.match(/^(.{0,100})/);
    if (shortMatch) return shortMatch[1].trim();
  }
  return 'UserOperation execution failed';
}

function extractRevertReason(error: unknown): string {
  const { message } = extractErrorInfo(error);
  if (message) {
    const match = message.match(/reason:\s*["']?(.+?)["']?(?:\n|$)/i);
    if (match) return `Contract reverted: ${match[1].trim()}`;

    const errorMatch = message.match(/error:\s*(.+?)(?:\n|$)/i);
    if (errorMatch) return `Contract error: ${errorMatch[1].trim()}`;
  }
  return 'Contract execution reverted';
}
