/**
 * ContextRequiredError — 필수 컨텍스트/상태 미제공
 *
 * v1.30.2: No Raw Throw — React Context 미제공, 런타임 상태 미충족 (wallet, AA mode 등)
 */

import { AppError } from './base';

export class ContextRequiredError extends AppError {
  readonly code = 'CONTEXT_REQUIRED' as const;

  constructor(message: string, cause?: unknown) {
    super(message, cause != null ? { cause } : {});
  }
}
