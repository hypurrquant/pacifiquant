import type { TxExecutor, ExecutionRequest, ExecutionMode, KernelClient, TxProgressCallback } from '../types';
import { TX_ERROR_CODES, createTxError, isTxError, parseTxError } from '../../lib/error';

const HYPEREVM_CHAIN_ID = 999;

export class AATxExecutor implements TxExecutor {
  readonly mode: ExecutionMode = 'aa';
  private kernelClient: KernelClient;

  constructor(kernelClient: KernelClient) {
    this.kernelClient = kernelClient;
  }

  async execute(
    request: ExecutionRequest,
    onProgress?: TxProgressCallback,
  ): Promise<`0x${string}`> {
    if (request.chainId !== HYPEREVM_CHAIN_ID) {
      throw createTxError(
        TX_ERROR_CODES.UNSUPPORTED_CHAIN,
        `AA mode only supports HyperEVM (chainId=999), got ${request.chainId}`,
        null,
      );
    }

    let userOpHash: `0x${string}` | undefined;

    try {
      onProgress?.({ phase: 'signing' });

      const calls = [{
        to: request.call.to,
        data: request.call.data ?? '0x',
        value: request.call.value ?? 0n,
      }];

      const callData = await this.kernelClient.account.encodeCalls(calls);
      userOpHash = await this.kernelClient.sendUserOperation({ callData });

      onProgress?.({ phase: 'confirming', hash: userOpHash });

      const receipt = await this.kernelClient.waitForUserOperationReceipt({
        hash: userOpHash,
      });

      const txHash = receipt.receipt.transactionHash;

      if (!receipt.success) {
        throw createTxError(
          TX_ERROR_CODES.CONTRACT_REVERT,
          'Transaction reverted',
          txHash,
        );
      }

      onProgress?.({ phase: 'done', hash: txHash });
      return txHash;
    } catch (error) {
      onProgress?.({ phase: 'error', hash: userOpHash });
      if (isTxError(error)) throw error;
      throw parseTxError(error);
    }
  }
}
