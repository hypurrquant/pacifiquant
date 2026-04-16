import type { SupportedChainId } from '@hq/core/config/chains';

export interface TxCall {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint | null;
}

export interface ExecutionRequest {
  chainId: SupportedChainId;
  call: TxCall;
}
