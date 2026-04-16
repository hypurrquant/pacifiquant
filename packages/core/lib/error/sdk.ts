import { AppError } from './base';

type SdkErrorCode = 'NETWORK' | 'VALIDATION' | 'CONFIG' | 'RATE_LIMIT';

export class SdkError extends AppError {
  readonly code: `SDK_${SdkErrorCode}`;

  constructor(
    message: string,
    sdkCode: SdkErrorCode,
    opts: ErrorOptions = {},
  ) {
    super(message, { cause: opts.cause });
    this.code = `SDK_${sdkCode}`;
  }
}
