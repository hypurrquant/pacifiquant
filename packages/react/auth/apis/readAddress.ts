import type { ActiveAccountSnapshot } from '@hq/core/auth';
import { SUPPORTED_CHAINS, type SupportedChainId } from '@hq/core/config/chains';
import { resolveChainExecutionAvailability } from './executionAvailability';

const HYPEREVM_CHAIN_ID = SUPPORTED_CHAINS.HYPERLIQUID.chain.id;

export function resolveReadAddress(
  snapshot: ActiveAccountSnapshot,
  targetChainId: SupportedChainId,
): `0x${string}` | null {
  const availability = resolveChainExecutionAvailability(snapshot, targetChainId);

  if (targetChainId === HYPEREVM_CHAIN_ID) {
    if (snapshot.executionMode === 'aa') {
      return availability.aa.kind === 'ready' ? availability.aa.ownerAddress : null;
    }
    return availability.eoa.kind === 'ready' ? availability.eoa.ownerAddress : null;
  }

  return availability.eoa.kind === 'ready' ? availability.eoa.ownerAddress : null;
}
