import { AppError } from './base';

export class RpcError extends AppError {
  readonly code = 'RPC_ERROR' as const;

  constructor(message: string, cause?: unknown) {
    super(message, cause != null ? { cause } : {});
  }
}
