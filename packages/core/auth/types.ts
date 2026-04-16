import type { TxProgressCallback } from './txProgress';
import type { ExecutionRequest } from '../lib/types';

export type { TxCall, ExecutionRequest } from '../lib/types';
export type { TxProgressCallback } from './txProgress';

// ============================================================================
// Connection & Auth Types
// ============================================================================

export type ExecutionMode = 'aa' | 'eoa';

export const AUTH_SOURCES = {
  PRIVY_TELEGRAM: 'privy-telegram',
  DIRECT_EOA: 'direct-eoa',
} as const;

export type AuthSource = (typeof AUTH_SOURCES)[keyof typeof AUTH_SOURCES];
export type WalletProviderId = string;
export type AuthSourceProviderMap = Partial<Record<AuthSource, WalletProviderId>>;

// ============================================================================
// Transaction Types
// ============================================================================

export interface TxExecutor {
  readonly mode: ExecutionMode;

  execute(request: ExecutionRequest, onProgress?: TxProgressCallback): Promise<`0x${string}`>;
}

// ============================================================================
// Provider Types
// ============================================================================

export interface EIP1193Provider {
  request: (args: { method: string; params: unknown[] | undefined }) => Promise<unknown>;
}

// ============================================================================
// Kernel Account Types (ZeroDev)
// ============================================================================

interface UserOperationParams {
  callData?: `0x${string}`;
  calls?: Array<{ to: `0x${string}`; value?: bigint; data?: `0x${string}` }>;
}

export interface KernelClient {
  account: {
    address: `0x${string}`;
    encodeCalls: (calls: Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }>) => Promise<`0x${string}`>;
  };
  sendUserOperation: (args: UserOperationParams) => Promise<`0x${string}`>;
  waitForUserOperationReceipt: (args: { hash: `0x${string}` }) => Promise<{
    success: boolean;
    receipt: { transactionHash: `0x${string}` };
  }>;
}

// ============================================================================
// Session Key & Approval Types
// ============================================================================

export interface ApprovalPayload {
  telegram_id?: string; // @ci-exception(no-optional-without-default) -- external wire format
  public_key?: `0x${string}`; // @ci-exception(no-optional-without-default) -- external wire format
  session_key_address: `0x${string}`;
  collection: string;
  document_id: string;
  policies: {
    call_permissions: Array<{
      target: string;
      value_limit: string;
      function_name: string;
    }>;
    valid_until: number;
  };
  valid_until: number;
}

export interface ApprovalStatus {
  collection: string;
  document_id: string;
  valid_until: number;
  is_valid: boolean;
  created_at: string;
}

export interface ApprovalsResponse {
  session_key_address: `0x${string}`;
  approvals: ApprovalStatus[];
}

// ============================================================================
// Wallet Adapter Types
// ============================================================================

export interface PrivyWalletLike {
  walletClientType: string;
  address?: string; // @ci-exception(no-optional-without-default) -- external SDK type stub
  getEthereumProvider: () => Promise<unknown>;
}

export interface WalletAdapter {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  getEOAAddress(): `0x${string}` | null;
  signMessage(message: string): Promise<`0x${string}`>;
}

// ============================================================================
// Wallet Status + AA Axes
// ============================================================================

export type WalletStatus =
  | 'idle'
  | 'need_login'
  | 'ready';

export type WalletNextAction =
  | { kind: 'none' }
  | { kind: 'login' };

export type AADeploymentStatus =
  | 'unknown'
  | 'checking'
  | 'failed'
  | 'not_deployed'
  | 'deployed';

export type AAState =
  | { kind: 'disabled' }
  | { kind: 'not_initialized' }
  | { kind: 'checking_deployment' }
  | { kind: 'not_deployed' }
  | { kind: 'deploy_failed' }
  | { kind: 'deployed'; registered: boolean };

// ============================================================================
// Error Codes
// ============================================================================

export enum AccountErrorCode {
  FEATURE_DISABLED_AA = 'FEATURE_DISABLED_AA',
  PRIVY_NOT_AUTHENTICATED = 'PRIVY_NOT_AUTHENTICATED',
  WALLET_NOT_CONNECTED = 'WALLET_NOT_CONNECTED',
  WRONG_CHAIN = 'WRONG_CHAIN',
  AA_NOT_INITIALIZED = 'AA_NOT_INITIALIZED',
  AA_NOT_DEPLOYED = 'AA_NOT_DEPLOYED',
  SIGN_FAILED = 'SIGN_FAILED',
}

// ============================================================================
// Active Account Snapshot
// ============================================================================

interface ActiveAccountSnapshotBase {
  executionMode: ExecutionMode;
  aaAddress: `0x${string}` | null;
  aaState: AAState;
  capabilities: ActiveAccountCapabilities;
}

export interface ActiveAccountReadySnapshot extends ActiveAccountSnapshotBase {
  ready: true;
  authSource: AuthSource;
  activeAddress: `0x${string}`;
  signerAddress: `0x${string}`;
  walletStatus: 'ready';
  walletNextAction: { kind: 'none' };
  reason: undefined;
}

export interface ActiveAccountNotReadySnapshot extends ActiveAccountSnapshotBase {
  ready: false;
  authSource: AuthSource | null;
  activeAddress: `0x${string}` | null;
  signerAddress: `0x${string}` | null;
  walletStatus: WalletStatus;
  walletNextAction: WalletNextAction;
  reason: string | undefined;
}

export type ActiveAccountSnapshot = ActiveAccountReadySnapshot | ActiveAccountNotReadySnapshot;

export interface ActiveAccountCapabilities {
  canUseAA: boolean;
  canSwitchToPrivy: boolean;
  canSwitchToBrowser: boolean;
  needsAADeploy: boolean;
  needsChainSwitch: false;
  supportsBatch: boolean;
  canUseBridge: boolean;
}

// ============================================================================
// TX Result
// ============================================================================

export interface TxResult {
  hash: `0x${string}`;
  mode: ExecutionMode;
}

// ============================================================================
// Sync State Types
// ============================================================================

export type SyncPrivyAction =
  | {
      kind: 'sdk_snapshot';
      ready: boolean;
      authenticated: false;
    }
  | {
      kind: 'sdk_snapshot';
      ready: true;
      authenticated: true;
      idToken: string | null;
      telegramId: string | null;
      privyUserId: string | null;
    }
  | { kind: 'init_timeout' }
  | { kind: 'embedded_address_changed'; embeddedAddress: `0x${string}` | null };
