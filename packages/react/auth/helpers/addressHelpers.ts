import type { ExecutionMode } from '@hq/core/auth';

interface AddressResolutionInput {
  executionMode: ExecutionMode;
  signerAddress: `0x${string}` | null;
  aaAddress: `0x${string}` | null;
}

export function resolveExecutionAddress({
  executionMode,
  signerAddress,
  aaAddress,
}: AddressResolutionInput): `0x${string}` | null {
  return executionMode === 'aa' ? aaAddress : signerAddress;
}

export function resolveActiveAddress(input: AddressResolutionInput): `0x${string}` | null {
  return resolveExecutionAddress(input) ?? input.signerAddress;
}
