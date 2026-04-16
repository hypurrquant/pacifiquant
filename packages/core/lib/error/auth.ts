import { AppError } from './base';

export class AuthError extends AppError {
  readonly code = 'AUTH_ERROR' as const;

  constructor(message: string, cause?: unknown) {
    super(message, cause != null ? { cause } : {});
  }
}
