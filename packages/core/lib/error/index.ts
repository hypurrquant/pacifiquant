// ---- Base ----
export { AppError, ensureError, extractErrorInfo, getErrorMessage } from './base';
export { ControlFlowError } from './controlFlow';

// ---- Error Classes ----
export { SdkError } from './sdk';
export { ApiError, getApiErrorTitle, resolveApiErrorMessage, isApiErrorBody } from './api';
export type { ApiErrorBody } from './api';
export { BuildError, TxExecutionError, PipelineError } from './pipeline';
export { TxError, TX_ERROR_CODES, createTxError, isTxError } from './tx';
export type { TxErrorCode, TxErrorCodeKey } from './tx';
export { parseTxError } from './txParser';
export { ConfigError } from './config';
export { ValidationError } from './validation';
export { AdapterError } from './adapter';
export { ContextRequiredError } from './context';

// ---- Error Classes (v1.31.5) ----
export { RpcError } from './rpc';
export { ChainSwitchError } from './chainSwitch';
export { AuthError } from './auth';
export { ApprovalError } from './approval';
export { UnexpectedError } from './unexpected';

// ---- Error Registry + Presenter (v1.31.5) ----
export { getErrorMeta } from './errorRegistry';
export type { ErrorSeverity, ErrorMeta } from './errorRegistry';
export { setErrorPresenter, presentError, toAppError, resolveMessage } from './presenter';
export type { ErrorPresenter } from './presenter';

// ---- Classification (SSOT) ----
export {
  WALLET_ERROR_CODES,
  isRateLimitError,
  isTimeoutError,
  isRangeHalvableError,
  isRotatableError,
  isRetryableNetworkError,
  isUserRejection,
  isInsufficientFunds,
  isGasEstimationFailed,
  isUserOpError,
  isContractRevert,
  isNetworkError,
} from './classify';
