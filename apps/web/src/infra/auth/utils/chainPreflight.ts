import type { EIP1193Provider } from '@/infra/auth/types';
import { isSupportedChainId } from '@hq/core/config/chains';
import {
  TX_ERROR_CODES,
  createTxError,
  extractErrorInfo,
  isTxError,
  isUserRejection,
} from '@hq/core/lib/error';
import { createLogger } from '@hq/core/logging';
import { requestEIP1193 } from './eip1193';

const logger = createLogger('chainPreflight');

const WALLET_CHAIN_NOT_ADDED_CODE = 4902;

function parseProviderChainId(chainIdHex: string): number {
  if (!/^0x[0-9a-f]+$/i.test(chainIdHex)) {
    throw createTxError(
      TX_ERROR_CODES.NETWORK_ERROR,
      `Invalid wallet chainId response: ${chainIdHex}`,
      null
    );
  }

  const chainId = Number.parseInt(chainIdHex, 16);
  if (!Number.isSafeInteger(chainId)) {
    throw createTxError(
      TX_ERROR_CODES.NETWORK_ERROR,
      `Wallet chainId is not a safe integer: ${chainIdHex}`,
      null
    );
  }

  return chainId;
}

async function readProviderChainId(provider: EIP1193Provider): Promise<number> {
  try {
    const chainIdHex = await requestEIP1193(provider, 'eth_chainId');
    return parseProviderChainId(chainIdHex);
  } catch (error) {
    if (isTxError(error)) throw error;
    throw createTxError(
      TX_ERROR_CODES.NETWORK_ERROR,
      'Failed to read wallet chain from provider',
      null,
      error
    );
  }
}

function toChainSwitchError(targetChainId: number, error: unknown) {
  const { code, message } = extractErrorInfo(error);

  if (code === WALLET_CHAIN_NOT_ADDED_CODE) {
    return createTxError(
      TX_ERROR_CODES.UNSUPPORTED_CHAIN,
      `Wallet does not support chain ${targetChainId}`,
      null,
      error
    );
  }

  if (isUserRejection(error)) {
    return createTxError(
      TX_ERROR_CODES.USER_REJECTED,
      'Chain switch was rejected by user',
      null,
      error
    );
  }

  return createTxError(
    TX_ERROR_CODES.NETWORK_ERROR,
    message || `Failed to switch wallet chain to ${targetChainId}`,
    null,
    error
  );
}

export async function ensureChainReady(input: {
  provider: EIP1193Provider;
  targetChainId: number;
}): Promise<void> {
  const { provider, targetChainId } = input;

  if (!isSupportedChainId(targetChainId)) {
    throw createTxError(
      TX_ERROR_CODES.UNSUPPORTED_CHAIN,
      `Unsupported chainId: ${targetChainId}`,
      null
    );
  }

  const currentChainId = await readProviderChainId(provider);
  if (currentChainId === targetChainId) return;

  logger.info(`ensureChainReady: switching ${currentChainId} → ${targetChainId}`);

  try {
    await requestEIP1193(provider, 'wallet_switchEthereumChain', [
      { chainId: `0x${targetChainId.toString(16)}` },
    ]);
  } catch (error) {
    throw toChainSwitchError(targetChainId, error);
  }

  const confirmedChainId = await readProviderChainId(provider);
  if (confirmedChainId !== targetChainId) {
    logger.error(
      `ensureChainReady: switch resolved but wallet chain stayed ${confirmedChainId} (target=${targetChainId})`
    );
    throw createTxError(
      TX_ERROR_CODES.NETWORK_ERROR,
      `Wallet chain switch not confirmed: expected ${targetChainId}, got ${confirmedChainId}`,
      null
    );
  }
}
