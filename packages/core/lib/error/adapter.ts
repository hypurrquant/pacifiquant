/**
 * AdapterError — 어댑터에서 필수 조건 미충족
 *
 * v1.30.2: No Raw Throw — 미지원 기능, 필수 파라미터 누락
 */

import { AppError } from './base';

export class AdapterError extends AppError {
  readonly code = 'ADAPTER_ERROR' as const;

  constructor(message: string, cause?: unknown) {
    super(message, cause != null ? { cause } : {});
  }
}
