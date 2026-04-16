/**
 * WASM Crypto 클라이언트 — v1.46.16 (stateless)
 * WASM 모듈 로드 + 응답 복호화만. 세션/서명 제거.
 */

import { createLogger } from '@hq/core/logging';

const logger = createLogger('WASMCrypto');

let wasmModule: typeof import('@hq/wasm-crypto') | null = null;

/** WASM 모듈 로드 (lazy) */
async function getWasm(): Promise<typeof import('@hq/wasm-crypto')> {
  if (wasmModule) return wasmModule;

  const mod = await import('@hq/wasm-crypto'); // @ci-exception(no-runtime-dynamic-import) — WASM init must remain lazy.
  if (typeof mod.default === 'function') {
    await mod.default();
  }
  mod.init();
  wasmModule = mod;
  logger.info('WASM crypto module loaded');
  return mod;
}

/** 응답 복호화 */
export async function decryptResponse(ct: string, iv: string, aad: string): Promise<string> {
  const mod = await getWasm();
  return mod.decryptResponse(ct, iv, aad);
}

/** 앱 초기화 시 WASM 모듈 사전 로드 (네트워크 불필요) */
export async function loadWasm(): Promise<void> {
  await getWasm();
}
