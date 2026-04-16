import {
  createWalletClient,
  custom,
  type PublicClient,
} from 'viem';
import { SUPPORTED_CHAINS } from '../../config/chains';
import { getPublicClient } from '../../lib/viemClient';
import type { TxExecutor, ExecutionRequest, ExecutionMode, EIP1193Provider, TxProgressCallback } from '../types';
import { TX_ERROR_CODES, createTxError, isTxError, isTimeoutError, parseTxError } from '../../lib/error';

const RECEIPT_TIMEOUT_MS = 60_000;

function getChainById(chainId: number) {
  const config = Object.values(SUPPORTED_CHAINS).find((c) => c.chain.id === chainId);
  if (!config) throw createTxError(TX_ERROR_CODES.UNSUPPORTED_CHAIN, `Unsupported chainId: ${chainId}`, null);
  return config.chain;
}

export class EOATxExecutor implements TxExecutor {
  readonly mode: ExecutionMode = 'eoa';
  private provider: EIP1193Provider;
  private address: `0x${string}`;

  constructor(provider: EIP1193Provider, address: `0x${string}`) {
    this.provider = provider;
    this.address = address;
  }

  async execute(
    request: ExecutionRequest,
    onProgress?: TxProgressCallback,
  ): Promise<`0x${string}`> {
    const chain = getChainById(request.chainId);
    const walletClient = createWalletClient({
      chain,
      transport: custom(this.provider),
    });
    const publicClient = getPublicClient(request.chainId) as PublicClient; // @ci-exception(type-assertion-count)
    return this.sendSingle(walletClient, publicClient, chain, request.call, onProgress);
  }

  private async sendSingle(
    walletClient: ReturnType<typeof createWalletClient>,
    publicClient: PublicClient,
    chain: ReturnType<typeof getChainById>,
    call: ExecutionRequest['call'],
    onProgress?: TxProgressCallback,
  ): Promise<`0x${string}`> {
    let hash: `0x${string}` | undefined;

    try {
      onProgress?.({ phase: 'signing' });

      hash = await walletClient.sendTransaction({
        account: this.address,
        to: call.to,
        data: call.data,
        value: call.value ?? 0n,
        chain,
      });

      onProgress?.({ phase: 'confirming', hash });

      try {
        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          timeout: RECEIPT_TIMEOUT_MS,
        });

        if (receipt.status === 'reverted') {
          throw createTxError(TX_ERROR_CODES.CONTRACT_REVERT, 'Transaction reverted', hash);
        }
      } catch (waitError) {
        if (isTxError(waitError)) throw waitError;
        if (isTimeoutError(waitError)) {
          throw createTxError(TX_ERROR_CODES.CONFIRMATION_TIMEOUT, 'Confirmation is taking longer than expected', hash, waitError);
        }
        throw waitError;
      }

      onProgress?.({ phase: 'done', hash });
      return hash;
    } catch (error) {
      onProgress?.({ phase: 'error', hash });
      if (isTxError(error)) throw error;
      throw parseTxError(error);
    }
  }
}
