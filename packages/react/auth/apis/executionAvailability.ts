import type { ActiveAccountSnapshot, ExecutionMode } from '@hq/core/auth';
import { SUPPORTED_CHAINS, type SupportedChainId } from '@hq/core/config/chains';

const HYPEREVM_CHAIN_ID = SUPPORTED_CHAINS.HYPERLIQUID.chain.id;

export type ModeRequirement = 'either' | 'aa_only' | 'eoa_only';

type ModeAvailabilityBlockedReasonCode =
  | 'login_required'
  | 'wallet_not_ready'
  | 'aa_deploy_required'
  | 'aa_unsupported_on_chain';

export type ModeAvailability =
  | {
      kind: 'ready';
      executionMode: ExecutionMode;
      ownerAddress: `0x${string}`;
      executionAddress: `0x${string}`;
      reason: null;
    }
  | {
      kind: 'blocked';
      executionMode: ExecutionMode;
      reasonCode: ModeAvailabilityBlockedReasonCode;
      reason: string;
      ownerAddress: `0x${string}` | null;
      executionAddress: `0x${string}` | null;
    };

export type ChainExecutionAvailability = {
  targetChainId: SupportedChainId;
  selectedMode: ExecutionMode;
  aa: ModeAvailability;
  eoa: ModeAvailability;
};

type ExecutionGateBlockedReasonCode =
  | 'login_required'
  | 'wallet_not_ready'
  | 'switch_to_aa'
  | 'switch_to_eoa'
  | 'aa_deploy_required'
  | 'unsupported_on_current_chain';

export type ExecutionGate =
  | {
      kind: 'ready';
      executionMode: ExecutionMode;
      ownerAddress: `0x${string}`;
      executionAddress: `0x${string}`;
      suggestedMode: null;
      reason: null;
    }
  | {
      kind: 'blocked';
      reasonCode: ExecutionGateBlockedReasonCode;
      reason: string;
      suggestedMode: ExecutionMode | null;
    };

export function resolveChainExecutionAvailability(
  snapshot: ActiveAccountSnapshot,
  targetChainId: SupportedChainId,
): ChainExecutionAvailability {
  return {
    targetChainId,
    selectedMode: snapshot.executionMode,
    aa: resolveAaAvailability(snapshot, targetChainId),
    eoa: resolveEoaAvailability(snapshot),
  };
}

export function resolveExecutionGate(
  availability: ChainExecutionAvailability,
  requirement: ModeRequirement,
): ExecutionGate {
  if (requirement === 'either') {
    return resolveEitherGate(availability);
  }

  const requiredMode = requirement === 'aa_only' ? 'aa' : 'eoa';
  return resolveSingleModeGate(availability, requiredMode);
}

function resolveEitherGate(availability: ChainExecutionAvailability): ExecutionGate {
  const selectedAvailability =
    availability.selectedMode === 'aa' ? availability.aa : availability.eoa;

  if (selectedAvailability.kind === 'ready') {
    return toReadyGate(selectedAvailability);
  }

  const alternateMode: ExecutionMode =
    availability.selectedMode === 'aa' ? 'eoa' : 'aa';
  const alternateAvailability =
    alternateMode === 'aa' ? availability.aa : availability.eoa;

  if (alternateAvailability.kind === 'ready') {
    return {
      kind: 'blocked',
      reasonCode: alternateMode === 'aa' ? 'switch_to_aa' : 'switch_to_eoa',
      reason:
        alternateMode === 'aa'
          ? 'Switch to AA to use this action.'
          : 'Switch to EOA to use this action on this chain.',
      suggestedMode: alternateMode,
    };
  }

  return toBlockedGate(selectedAvailability);
}

function resolveSingleModeGate(
  availability: ChainExecutionAvailability,
  requiredMode: ExecutionMode,
): ExecutionGate {
  const requiredAvailability =
    requiredMode === 'aa' ? availability.aa : availability.eoa;

  if (requiredAvailability.kind !== 'ready') {
    return toBlockedGate(requiredAvailability);
  }

  if (availability.selectedMode !== requiredMode) {
    return {
      kind: 'blocked',
      reasonCode: requiredMode === 'aa' ? 'switch_to_aa' : 'switch_to_eoa',
      reason:
        requiredMode === 'aa'
          ? 'Switch to AA to use this action.'
          : 'Switch to EOA to use this action on this chain.',
      suggestedMode: requiredMode,
    };
  }

  return toReadyGate(requiredAvailability);
}

function resolveEoaAvailability(snapshot: ActiveAccountSnapshot): ModeAvailability {
  if (snapshot.signerAddress !== null && snapshot.walletStatus === 'ready') {
    return {
      kind: 'ready',
      executionMode: 'eoa',
      ownerAddress: snapshot.signerAddress,
      executionAddress: snapshot.signerAddress,
      reason: null,
    };
  }

  return {
    kind: 'blocked',
    executionMode: 'eoa',
    reasonCode: getWalletBlockedReasonCode(snapshot),
    reason: getWalletBlockedReason(snapshot),
    ownerAddress: snapshot.signerAddress,
    executionAddress: snapshot.signerAddress,
  };
}

function resolveAaAvailability(
  snapshot: ActiveAccountSnapshot,
  targetChainId: SupportedChainId,
): ModeAvailability {
  if (targetChainId !== HYPEREVM_CHAIN_ID) {
    return {
      kind: 'blocked',
      executionMode: 'aa',
      reasonCode: 'aa_unsupported_on_chain',
      reason: 'AA mode is not available on this chain.',
      ownerAddress: snapshot.aaAddress,
      executionAddress: snapshot.aaAddress,
    };
  }

  if (snapshot.aaState.kind === 'not_deployed' || snapshot.aaState.kind === 'deploy_failed') {
    return {
      kind: 'blocked',
      executionMode: 'aa',
      reasonCode: 'aa_deploy_required',
      reason: 'Finish AA setup before using this action.',
      ownerAddress: snapshot.aaAddress,
      executionAddress: snapshot.aaAddress,
    };
  }

  if (snapshot.aaAddress !== null && snapshot.walletStatus === 'ready' && snapshot.aaState.kind === 'deployed') {
    return {
      kind: 'ready',
      executionMode: 'aa',
      ownerAddress: snapshot.aaAddress,
      executionAddress: snapshot.aaAddress,
      reason: null,
    };
  }

  return {
    kind: 'blocked',
    executionMode: 'aa',
    reasonCode: getWalletBlockedReasonCode(snapshot),
    reason: getWalletBlockedReason(snapshot),
    ownerAddress: snapshot.aaAddress,
    executionAddress: snapshot.aaAddress,
  };
}

function getWalletBlockedReasonCode(
  snapshot: ActiveAccountSnapshot,
): Extract<ModeAvailabilityBlockedReasonCode, 'login_required' | 'wallet_not_ready'> {
  if (snapshot.walletNextAction.kind === 'login' || snapshot.signerAddress === null) {
    return 'login_required';
  }

  return 'wallet_not_ready';
}

function getWalletBlockedReason(snapshot: ActiveAccountSnapshot): string {
  if (snapshot.walletNextAction.kind === 'login' || snapshot.signerAddress === null) {
    return 'Connect your wallet to continue.';
  }

  return 'Wallet is not ready yet.';
}

function toReadyGate(
  availability: Extract<ModeAvailability, { kind: 'ready' }>,
): ExecutionGate {
  return {
    kind: 'ready',
    executionMode: availability.executionMode,
    ownerAddress: availability.ownerAddress,
    executionAddress: availability.executionAddress,
    suggestedMode: null,
    reason: null,
  };
}

function toBlockedGate(
  availability: Extract<ModeAvailability, { kind: 'blocked' }>,
): ExecutionGate {
  switch (availability.reasonCode) {
    case 'login_required':
      return {
        kind: 'blocked',
        reasonCode: 'login_required',
        reason: availability.reason,
        suggestedMode: null,
      };
    case 'wallet_not_ready':
      return {
        kind: 'blocked',
        reasonCode: 'wallet_not_ready',
        reason: availability.reason,
        suggestedMode: null,
      };
    case 'aa_deploy_required':
      return {
        kind: 'blocked',
        reasonCode: 'aa_deploy_required',
        reason: availability.reason,
        suggestedMode: null,
      };
    case 'aa_unsupported_on_chain':
      return {
        kind: 'blocked',
        reasonCode: 'unsupported_on_current_chain',
        reason: availability.reason,
        suggestedMode: null,
      };
  }
}
