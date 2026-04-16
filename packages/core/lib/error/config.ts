/**
 * ConfigError — 설정/설정값 조회 실패
 *
 * v1.30.2: No Raw Throw — 풀/DEX/RPC 설정 누락·불일치
 */

import { AppError } from './base';

export class ConfigError extends AppError {
  readonly code = 'CONFIG_ERROR' as const;

  constructor(message: string, cause?: unknown) {
    super(message, cause != null ? { cause } : {});
  }
}
