import { AATxExecutor } from './AATxExecutor';
import { EOATxExecutor } from './EOATxExecutor';
import type { TxExecutor, KernelClient, EIP1193Provider } from '../types';

export type ExecutorContext =
  | {
      executionMode: 'aa';
      kernelClient: KernelClient;
    }
  | {
      executionMode: 'eoa';
      provider: EIP1193Provider;
      eoaAddress: `0x${string}`;
    };

export function createTxExecutor(ctx: ExecutorContext): TxExecutor {
  if (ctx.executionMode === 'aa') {
    return new AATxExecutor(ctx.kernelClient);
  }

  return new EOATxExecutor(ctx.provider, ctx.eoaAddress);
}
