import type { StateCreator } from 'zustand';
import type {
  WalletAdapter,
  AuthSource,
  AuthSourceProviderMap,
  ExecutionMode,
  ActiveAccountSnapshot,
  SyncPrivyAction,
  ExecutionRequest,
  TxResult,
  AADeploymentStatus,
  TxProgressCallback,
  WalletProviderId,
} from '@hq/core/auth';

export interface ExecuteTxOptions {
  onProgress?: TxProgressCallback;
}

export type PrivyStateL1 =
  | { status: 'idle' }
  | { status: 'ready' }
  | { status: 'authenticated'; idToken: string | null; telegramId: string | null; privyUserId: string | null }
  | { status: 'failed' };

type AuthSelectionL1 =
  | { source: null; isUserSelected: false }
  | { source: AuthSource; isUserSelected: boolean };

type ExecutionSelectionL1 = {
  mode: ExecutionMode;
  isUserSelected: boolean;
};

export type WalletConnectionState =
  | { status: 'disconnected' }
  | {
      status: 'connected';
      eoaAddress: `0x${string}`;
      adapter: WalletAdapter;
    };

export type WalletStateL1 = WalletConnectionState;

export interface ProviderRuntimeState {
  availability: 'unknown' | 'available' | 'unavailable';
  wallet: WalletConnectionState;
}

export interface ProviderSelectionL1 {
  activeProviderId: WalletProviderId | null;
  isUserSelected: boolean;
}

export type KernelAccountType = {
  address: `0x${string}`;
  encodeCalls: (calls: Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }>) => Promise<`0x${string}`>;
};

interface UserOperationInputParams {
  callData?: `0x${string}`;
  calls?: Array<{ to: `0x${string}`; value?: bigint; data?: `0x${string}` }>;
}

export interface KernelClientType {
  account: KernelAccountType;
  sendUserOperation: (args: UserOperationInputParams) => Promise<`0x${string}`>;
  waitForUserOperationReceipt: (args: { hash: `0x${string}` }) => Promise<{
    success: boolean;
    receipt: { transactionHash: `0x${string}` };
  }>;
  estimateUserOperationGas: (args: { callData: `0x${string}` }) => Promise<unknown>;
}

export interface AuthSliceState {
  privy: PrivyStateL1;
  authSelection: AuthSelectionL1;
  providerSelection: ProviderSelectionL1;
  sourceProviderIds: AuthSourceProviderMap;
  executionSelection: ExecutionSelectionL1;
  lifecycle: 'idle' | 'connecting' | 'connected' | 'deploying' | 'registering' | 'ready' | 'error';
  autoFallbackDone: boolean;
  error: string | null;
}

interface AuthSliceActions {
  chooseAuthSource: (source: AuthSource) => void;
  chooseExecutionMode: (mode: ExecutionMode) => void;
  setLifecycle: (lifecycle: AuthSliceState['lifecycle']) => void;
  setAutoFallbackDone: (done: boolean) => void;
  setError: (error: string | null) => void;
}

export type AuthSlice = AuthSliceState & AuthSliceActions;

interface WalletSliceState {
  providers: Record<WalletProviderId, ProviderRuntimeState>;
}

interface WalletSliceActions {
  setProviderAvailability: (providerId: WalletProviderId, available: boolean) => void;
  setEOAInfo: (
    providerId: WalletProviderId,
    info: {
      eoaAddress: `0x${string}` | null;
      adapter: WalletAdapter | null;
    }
  ) => void;
  getProviderState: (providerId: WalletProviderId | null) => ProviderRuntimeState;
}

export type WalletSlice = WalletSliceState & WalletSliceActions;

export type RegistrationStateUpdate =
  | { kind: 'registered'; sessionKeyAddress: `0x${string}` }
  | { kind: 'not_registered' }
  | { kind: 'registering'; value: boolean };

export interface AASliceState {
  kernelAccount: KernelAccountType | null;
  kernelClient: KernelClientType | null;
  sessionKeyAddress: `0x${string}` | null;
  aaDeploymentStatus: AADeploymentStatus;
  isDeploying: boolean;
  isRegistered: boolean;
  isRegistering: boolean;
  isLinking: boolean;
  aaDepositAmount: bigint | null;
}

export interface InitializeAAWithSignerOpts {
  idToken?: string;
  autoDeploy?: boolean;
}

export interface InitializeAAOpts {
  idToken?: string;
  adapter?: WalletAdapter;
  autoDeploy?: boolean;
}

interface AASliceActions {
  setKernelAccount: (account: KernelAccountType | null) => void;
  setKernelClient: (client: KernelClientType | null) => void;
  setRegistrationState: (input: RegistrationStateUpdate) => void;
  setSessionKeyAddress: (address: `0x${string}` | null) => void;
  setAADeploymentStatus: (status: AADeploymentStatus) => void;
  setIsDeploying: (value: boolean) => void;
  setIsRegistered: (value: boolean) => void;
  setIsRegistering: (value: boolean) => void;
  createAAAccount: (opts: { adapter: WalletAdapter }) => Promise<{ account: KernelAccountType; client: KernelClientType }>;
  deployAAAccount: () => Promise<void>;
  checkAADeployed: (address: `0x${string}` | null) => Promise<boolean>;
  checkAAGasDeposit: (address: `0x${string}`) => Promise<bigint>;
  requestAAGasTopup: (address: `0x${string}`) => Promise<void>;
  initializeAAWithSigner: (signerSource: WalletAdapter, opts: InitializeAAWithSignerOpts) => Promise<void>;
  initializeAA: (opts: InitializeAAOpts) => Promise<void>;
  getPublicClient: () => any; // @ci-exception(no-explicit-any)
  getEntryPoint: () => any; // @ci-exception(no-explicit-any)
}

export type AASlice = AASliceState & AASliceActions;

interface TxSliceActions {
  execute: (request: ExecutionRequest, options: ExecuteTxOptions) => Promise<TxResult>;
  signMessage: (message: string) => Promise<`0x${string}`>;
}

export type TxSlice = TxSliceActions;

interface RootAPIs {
  getActiveAccount: () => ActiveAccountSnapshot;
  syncPrivyState: (action: SyncPrivyAction) => void;
  reset: () => void;
}

export type AccountStore = AuthSlice & WalletSlice & AASlice & TxSlice & RootAPIs;

export type ZustandSetFn = (partial: Partial<AccountStore>, replace?: boolean, action?: string) => void;

export type SliceCreator<T> = StateCreator<
  AccountStore,
  [['zustand/devtools', never], ['zustand/persist', unknown]],
  [],
  T
>;
