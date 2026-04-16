import { AppError } from './base';

export class UnexpectedError extends AppError {
  readonly code = 'UNEXPECTED' as const;

  constructor(message: string, cause?: unknown) {
    super(message, cause != null ? { cause } : {});
  }
}
