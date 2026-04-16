import { AppError } from './base';

export class ApprovalError extends AppError {
  readonly code = 'APPROVAL_ERROR' as const;

  constructor(message: string, cause?: unknown) {
    super(message, cause != null ? { cause } : {});
  }
}
