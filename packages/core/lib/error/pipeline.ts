import { AppError } from './base';

// PipelineError: executeOperation 에러를 pipeline 컨텍스트로 래핑
export class PipelineError extends AppError {
  readonly code = 'PIPELINE_ERROR' as const;
  readonly stageId: string;
  readonly stepId: string;
  readonly originalError: BuildError | TxExecutionError | EffectExecutionError;

  constructor(opts: {
    stageId: string;
    stepId: string;
    originalError: BuildError | TxExecutionError | EffectExecutionError;
  }) {
    super(opts.originalError.message, { cause: opts.originalError });
    this.stageId = opts.stageId;
    this.stepId = opts.stepId;
    this.originalError = opts.originalError;
  }
}

/** buildRequest 단계 실패 — 무조건 즉시 중단 */
export class BuildError extends AppError {
  readonly code = 'BUILD_ERROR' as const;
  readonly stepId: string;

  constructor(stepId: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Build failed';
    super(message, { cause });
    this.stepId = stepId;
  }
}

/** TX 실행 단계 실패 */
export class TxExecutionError extends AppError {
  readonly code = 'TX_EXECUTION_ERROR' as const;
  readonly stepId: string;

  constructor(stepId: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Transaction failed';
    super(message, { cause });
    this.stepId = stepId;
  }
}

/** non-tx stage 실행 단계 실패 */
export class EffectExecutionError extends AppError {
  readonly code = 'EFFECT_EXECUTION_ERROR' as const;
  readonly stepId: string;

  constructor(stepId: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Effect stage failed';
    super(message, { cause });
    this.stepId = stepId;
  }
}
