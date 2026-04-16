/**
 * ControlFlowError — 사용자 표시용이 아닌 내부 복구/재시도 제어용 예외.
 *
 * - `presentError()` / `ErrorRegistry` 대상이 아님
 * - recovery runner가 `instanceof`로 잡아 재시도/우회 로직을 수행
 */
export abstract class ControlFlowError extends Error {
  readonly cause: unknown | null;

  constructor(message: string, opts: ErrorOptions = {}) {
    super(message);
    this.cause = opts.cause ?? null;
    this.name = this.constructor.name;
  }
}
