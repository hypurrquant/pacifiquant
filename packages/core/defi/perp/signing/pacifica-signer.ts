/**
 * Pacifica Ed25519 Order Signing
 *
 * Pacifica uses Ed25519 (Solana keypair) signing for all write operations.
 * Flow:
 *   1. Create header: { type, timestamp, expiry_window }
 *   2. Merge header + { data: payload }, recursively sort all keys, compact JSON
 *   3. UTF-8 encode → Ed25519 sign → Base58 encode signature
 *   4. Build request body: { account, signature, timestamp, expiry_window, ...payload }
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';

// ============================================================
// Operation Type Mapping
// ============================================================

/**
 * Pacifica operation types — each maps to a specific REST endpoint.
 * Used as the `type` field in the signing header.
 */
export type PacificaOperationType =
  | 'create_market_order'
  | 'create_order'
  | 'cancel_order'
  | 'create_stop_order'
  | 'update_leverage'
  | 'update_margin_mode'
  | 'withdraw'
  | 'bind_agent_wallet'
  | 'approve_builder_code';

// ============================================================
// Core Signing Functions
// ============================================================

/** Recursively sort all object keys alphabetically (deep). */
function sortJsonKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(sortJsonKeys);
  if (typeof obj !== 'object') return obj;

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  for (const key of keys) {
    sorted[key] = sortJsonKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

/** Create signing header for a Pacifica operation. */
function createHeader(
  operationType: PacificaOperationType,
  expiryWindow: number = 5000,
): { type: PacificaOperationType; timestamp: number; expiry_window: number } {
  return {
    type: operationType,
    timestamp: Date.now(),
    expiry_window: expiryWindow,
  };
}

/**
 * Prepare the message to sign: merge header with { data: payload },
 * recursively sort all keys, produce compact JSON string.
 */
function prepareMessage(
  header: { type: PacificaOperationType; timestamp: number; expiry_window: number },
  payload: Record<string, unknown>,
): string {
  const message = {
    ...header,
    data: payload,
  };
  const sorted = sortJsonKeys(message);
  return JSON.stringify(sorted);
}

/** Ed25519 sign function type — takes raw bytes, returns signature bytes. */
export type Ed25519SignFn = (message: Uint8Array) => Promise<Uint8Array>;

/**
 * Sign a Pacifica request using Ed25519 (tweetnacl).
 *
 * @param secretKey - 64-byte Ed25519 secret key (Solana keypair format)
 * @param message - raw bytes to sign
 * @returns 64-byte detached signature
 */
export function ed25519Sign(secretKey: Uint8Array, message: Uint8Array): Uint8Array {
  return nacl.sign.detached(message, secretKey);
}

/**
 * Full Pacifica signing flow.
 *
 * @returns Request body ready to POST: { account, signature, timestamp, expiry_window, ...payload }
 */
export async function signPacificaRequest(
  operationType: PacificaOperationType,
  payload: Record<string, unknown>,
  account: string,
  signFn: Ed25519SignFn,
  expiryWindow: number = 5000,
): Promise<Record<string, unknown>> {
  const header = createHeader(operationType, expiryWindow);
  const messageStr = prepareMessage(header, payload);
  const messageBytes = new TextEncoder().encode(messageStr);
  const signatureBytes = await signFn(messageBytes);
  const signature = bs58.encode(signatureBytes);

  return {
    account,
    signature,
    timestamp: header.timestamp,
    expiry_window: header.expiry_window,
    ...payload,
  };
}

// ============================================================
// Exports for testing
// ============================================================

export { sortJsonKeys, createHeader, prepareMessage };
