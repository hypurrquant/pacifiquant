import { AppError } from './base';

export class ChainSwitchError extends AppError {
  readonly code = 'CHAIN_SWITCH_ERROR' as const;

  constructor(message: string, cause?: unknown) {
    super(message, cause != null ? { cause } : {});
  }
}
