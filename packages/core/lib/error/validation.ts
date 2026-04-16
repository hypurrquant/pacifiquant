/**
 * ValidationError — 입력값/상태/데이터 검증 실패
 *
 * v1.30.2: No Raw Throw — 데이터 타입, 범위, 필수 조건 검증
 */

import { AppError } from './base';

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR' as const;

  constructor(message: string, cause?: unknown) {
    super(message, cause != null ? { cause } : {});
  }
}
