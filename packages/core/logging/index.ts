/**
 * Logging Module — v1.30.5 통합
 *
 * ILogger DI + ConsoleLoggerFactory fallback.
 * 이전: types.ts + provider.ts + console.ts + index.ts (4파일)
 * 이후: index.ts (1파일)
 */

// ── Interfaces ──

/** 최소 로깅 인터페이스 — debug/info/warn/error */
export interface ILogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: unknown, meta?: Record<string, unknown>): void;
}

/** 이름 기반 로거 생성 팩토리 */
export interface ILoggerFactory {
  create(name: string): ILogger;
}

// ── Console Implementation (fallback) ──

class ConsoleLogger implements ILogger {
  constructor(private readonly name: string) {}

  debug(message: string, meta?: Record<string, unknown>): void {
    if (meta) console.debug(`[${this.name}]`, message, meta);
    else console.debug(`[${this.name}]`, message);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (meta) console.info(`[${this.name}]`, message, meta);
    else console.info(`[${this.name}]`, message);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (meta) console.warn(`[${this.name}]`, message, meta);
    else console.warn(`[${this.name}]`, message);
  }

  error(message: string, error?: unknown, meta?: Record<string, unknown>): void {
    if (error && meta) console.error(`[${this.name}]`, message, error, meta);
    else if (error) console.error(`[${this.name}]`, message, error);
    else console.error(`[${this.name}]`, message);
  }
}

class ConsoleLoggerFactory implements ILoggerFactory {
  create(name: string): ILogger {
    return new ConsoleLogger(name);
  }
}

// ── DI ──

let _factory: ILoggerFactory | null = null;

/** 로거 팩토리를 글로벌 DI로 등록 */
export function setLoggerFactory(factory: ILoggerFactory): void {
  _factory = factory;
}

/** 이름 기반 로거 생성 — DI 미설정 시 ConsoleLoggerFactory fallback */
export function createLogger(name: string): ILogger {
  if (!_factory) {
    _factory = new ConsoleLoggerFactory();
  }
  return _factory.create(name);
}
