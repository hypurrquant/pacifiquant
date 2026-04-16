/**
 * AA Slice
 * v0.17.0: useAccountStore에서 분리
 *
 * 책임:
 * - AA 계정 상태 (kernelAccount, kernelClient, sessionKeyAddress)
 *   - aaAddress는 kernelAccount?.address에서 파생 (SSOT)
 * - 배포 상태 (aaDeploymentStatus, isDeploying, isRegistered, isRegistering, isLinking)
 * - AA Actions (createAAAccount, deployAAAccount, initializeAA 등)
 *
 * NOTE:
 * - kernelClient가 store에 직접 노출됨 (AA 구현체 의존 노출)
 * - 향후 AA 구현 교체 시 facade/adapter로 추상화 고려
 */

import { http, getAddress } from 'viem';
import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import { getPublicClient as getViemClient } from '@hq/core/lib/viemClient';
import { createKernelAccount, createKernelAccountClient } from '@zerodev/sdk';
import { getEntryPoint, KERNEL_V3_1 } from '@zerodev/sdk/constants';
import { storeEvents } from '@/infra/lib/eventBus';
import { FEATURES } from '@hq/core/config/features';
import { hyperliquidEvm } from '@hq/core/config/chains';
import { getZeroDevRpcUrl } from '../../utils/chain-utils';
import { createLogger } from '@hq/core/logging';
import { requestEIP1193 } from '../../utils/eip1193';
import { extractErrorInfo, ContextRequiredError, ConfigError, ChainSwitchError } from '@hq/core/lib/error';
import { getAaDepositOnEntryPoint } from '@/infra/auth/abi';
import { http as apiHttp } from '@/infra/lib/http';
import type { AASlice, SliceCreator, InitializeAAWithSignerOpts, InitializeAAOpts, KernelAccountType, KernelClientType, AccountStore } from '@hq/react/auth';
import { requireWebWalletProvider } from '@/infra/auth/webWalletAdapter';

// ============================================================================
// Singleton Instances (성능 최적화)
// ============================================================================

// v0.25.6: singleton PublicClient (core/lib/viemClient.ts)
export const publicClient = getViemClient(hyperliquidEvm.id);

export const entryPoint = getEntryPoint('0.7');

const logger = createLogger('aaSlice');

function getActiveWallet(state: Pick<AccountStore, 'providers' | 'authSelection' | 'providerSelection' | 'sourceProviderIds'>) {
  const source = state.authSelection.source;
  if (!source) return { status: 'disconnected' } as const;

  const providerId = state.providerSelection.activeProviderId ?? state.sourceProviderIds[source] ?? null;
  if (!providerId) return { status: 'disconnected' } as const;

  return state.providers[providerId]?.wallet ?? ({ status: 'disconnected' } as const);
}

// v0.22.0: ZeroDev SDK 경계 캐스트 헬퍼
// ZeroDev SDK 함수들은 복잡한 제네릭을 요구하지만, 실제로는 PublicClient만 필요.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asZeroDevParam = <T>(value: T): any => value;

// ============================================================================
// Initial State
// ============================================================================

export const aaInitialState = {
  kernelAccount: null,
  kernelClient: null,
  // v0.20.6: aaAddress 제거 - kernelAccount?.address에서 파생
  sessionKeyAddress: null,
  aaDeploymentStatus: 'unknown' as const,
  isDeploying: false,
  isRegistered: false,
  isRegistering: false,
  isLinking: false,
  aaDepositAmount: null,
  // v0.20.9: aaCheckError, aaCheckDone 제거 → aaDeploymentStatus로 통합
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createAASlice: SliceCreator<AASlice> = (set, get) => ({
  ...aaInitialState,

  // --------------------------------------------------------------------------
  // Basic Setters
  // --------------------------------------------------------------------------

  setKernelAccount: (account) => {
    // v0.20.6: aaAddress 설정 제거 - kernelAccount?.address에서 파생
    set({ kernelAccount: account }, false, 'aa/setKernelAccount');
  },

  setKernelClient: (client) => {
    set({ kernelClient: client }, false, 'aa/setKernelClient');
  },

  // --------------------------------------------------------------------------
  // L2 Intent APIs
  // --------------------------------------------------------------------------

  /**
   * v0.32.3: Registration 상태 갱신 (L2 intent)
   * - 외부에서는 이 API만 사용 (L1 setter 직접 호출 금지)
   */
  setRegistrationState: (input) => {
    switch (input.kind) {
      case 'registered':
        set({
          isRegistered: true,
          sessionKeyAddress: input.sessionKeyAddress,
        }, false, 'aa/setRegistrationState:registered');
        break;
      case 'not_registered':
        set({ isRegistered: false }, false, 'aa/setRegistrationState:not_registered');
        break;
      case 'registering':
        set({ isRegistering: input.value }, false, 'aa/setRegistrationState:registering');
        break;
    }
  },

  setSessionKeyAddress: (address) => {
    set({ sessionKeyAddress: address }, false, 'aa/setSessionKeyAddress');
  },

  setAADeploymentStatus: (status) => {
    set({ aaDeploymentStatus: status }, false, 'aa/setAADeploymentStatus');
  },

  setIsDeploying: (value) => {
    set({ isDeploying: value }, false, 'aa/setIsDeploying');
  },

  setIsRegistered: (value) => {
    set({ isRegistered: value }, false, 'aa/setIsRegistered');
  },

  setIsRegistering: (value) => {
    set({ isRegistering: value }, false, 'aa/setIsRegistering');
  },

  // v0.20.9: setAACheckDone 제거 → aaDeploymentStatus로 통합

  // --------------------------------------------------------------------------
  // Singleton Getters
  // --------------------------------------------------------------------------

  getPublicClient: () => publicClient,
  getEntryPoint: () => entryPoint,

  // --------------------------------------------------------------------------
  // AA Account Creation
  // --------------------------------------------------------------------------

  /**
   * AA 계정 생성 (SmartAccountProvider.connect() 대체)
   */
  createAAAccount: async ({ adapter }) => {
    const projectId = process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID;
    if (!projectId) throw new ConfigError('Missing NEXT_PUBLIC_ZERODEV_PROJECT_ID');
    const ethProvider = await requireWebWalletProvider(adapter);

    set({ error: null, lifecycle: 'connecting' }, false, 'aa/createAAAccount:start');
    logger.info('createAAAccount() started');

    try {
      // EOA 계정 요청
      const accounts = await requestEIP1193(ethProvider, 'eth_requestAccounts');
      if (!accounts?.length) throw new ContextRequiredError('No EOA account found');
      const eoaAddr = getAddress(accounts[0]);
      logger.info(`EOA address: ${eoaAddr}`);

      // Chain switching
      try {
        await ethProvider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${hyperliquidEvm.id.toString(16)}` }],
        });
      } catch (err) { throw new ChainSwitchError('Failed to switch chain', err); }

      // ECDSA Validator 생성
      logger.info('Creating ECDSA validator...');
      let ecdsaValidator;
      try {
        ecdsaValidator = await signerToEcdsaValidator(asZeroDevParam(publicClient), {
          signer: asZeroDevParam(ethProvider),
          entryPoint,
          kernelVersion: KERNEL_V3_1,
        });
        logger.info('ECDSA validator created');
      } catch (validatorError: unknown) {
        const msg = validatorError instanceof Error ? validatorError.message : String(validatorError);
        logger.error(`ECDSA validator creation failed: ${msg}`);
        const cause = validatorError instanceof Error && 'cause' in validatorError
          ? extractErrorInfo(validatorError.cause).message : '';
        if (msg.includes('Load failed') || cause.includes('Load failed')) {
          throw new ContextRequiredError('RPC connection failed: Please check your network.');
        }
        throw validatorError;
      }

      // Kernel Account 생성
      logger.info('Creating Kernel account...');
      let account;
      try {
        account = await createKernelAccount(asZeroDevParam(publicClient), {
          plugins: { sudo: ecdsaValidator },
          entryPoint,
          kernelVersion: KERNEL_V3_1,
        });
        logger.info(`Kernel account created: ${account.address}`);
      } catch (accountError: unknown) {
        const errorMsg = accountError instanceof Error ? accountError.message : String(accountError);
        logger.error(`Kernel account creation failed: ${errorMsg}`);
        const causeMsg = accountError instanceof Error && 'cause' in accountError
          ? extractErrorInfo(accountError.cause).message : '';
        if (errorMsg.includes('Load failed') || causeMsg.includes('Load failed') ||
            errorMsg.includes('fetch failed') || causeMsg.includes('fetch failed')) {
          throw new ContextRequiredError('RPC connection failed: Please check your network.');
        }
        throw accountError;
      }

      // Kernel Client 생성
      logger.info('Creating Kernel client...');
      const client = createKernelAccountClient({
        account,
        chain: hyperliquidEvm,
        bundlerTransport: http(getZeroDevRpcUrl('HYPERLIQUID', projectId)),
        client: publicClient,
      });
      logger.info('Kernel client created');

      // Store 업데이트
      // v0.18.0: connectionType 제거 - authSource로 대체
      // v0.20.6: aaAddress 설정 제거 - kernelAccount?.address에서 파생
      // v0.20.12: status → lifecycle
      set({
        kernelAccount: account as KernelAccountType, // v0.22.2: ZeroDev SDK generic // @ci-exception(type-assertion-count)
        kernelClient: client as KernelClientType, // v0.22.2: ZeroDev SDK generic // @ci-exception(type-assertion-count)
        lifecycle: 'connected',
      }, false, 'aa/createAAAccount:success');

      // 배포 상태 확인
      await get().checkAADeployed(account.address);

      return { account: account as KernelAccountType, client: client as KernelClientType }; // v0.22.2: ZeroDev SDK generic // @ci-exception(type-assertion-count)
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      logger.error(`createAAAccount() failed: ${errorMessage}`);
      // v0.20.12: status → lifecycle
      set({ error: errorMessage, lifecycle: 'error' }, false, 'aa/createAAAccount:error');
      throw e;
    }
  },

  // --------------------------------------------------------------------------
  // AA Deployment
  // --------------------------------------------------------------------------

  /**
   * AA 배포
   */
  deployAAAccount: async () => {
    const { kernelClient } = get();
    if (!kernelClient || !kernelClient.account) {
      throw new ContextRequiredError('Kernel client not ready');
    }

    // v0.20.6: aaAddress fallback 제거 - kernelClient.account.address 직접 사용
    const address = getAddress(kernelClient.account.address);

    // 이미 배포된 경우 스킵
    const alreadyDeployed = await get().checkAADeployed(address);
    if (alreadyDeployed) {
      logger.info('AA already deployed');
      return;
    }

    set({ isDeploying: true, error: null }, false, 'aa/deployAAAccount:start');

    try {
      // Gas deposit 검증
      const deposit = await getAaDepositOnEntryPoint({
        publicClient,
        entryPointAddress: entryPoint.address,
        userAaAddress: address,
      });
      if (deposit < 1_000_000_000_000_000n) { // 0.001 ETH
        logger.info(`AA deposit is low (${deposit}), requesting top-up`);
        await get().requestAAGasTopup(address);
      }
      set({ aaDepositAmount: deposit }, false, 'aa/deployAAAccount:depositChecked');

      // Dummy transaction으로 배포
      const callData = await kernelClient.account!.encodeCalls([
        { to: address, value: 0n, data: '0x' },
      ]);
      const gasEst = await kernelClient.estimateUserOperationGas({ callData });
      logger.info(`Deploying AA with gas estimate: ${JSON.stringify(gasEst)}`);

      const hash = await kernelClient.sendUserOperation({ callData });
      await kernelClient.waitForUserOperationReceipt({ hash });

      set({ aaDeploymentStatus: 'deployed' }, false, 'aa/deployAAAccount:success');
      logger.info('AA deployed successfully');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      let errorMessage: string;
      if (/paymaster|prefund|insufficient funds|gas/i.test(msg)) {
        errorMessage = 'AA deployment failed: Gas/Paymaster required. Please configure Paymaster and try again.';
      } else {
        errorMessage = `AA deployment failed: ${msg}`;
      }
      set({ error: errorMessage }, false, 'aa/deployAAAccount:error');
      logger.error(`AA deployment failed: ${msg}`);
      throw e;
    } finally {
      set({ isDeploying: false }, false, 'aa/deployAAAccount:finally');
    }
  },

  // --------------------------------------------------------------------------
  // AA Status Checks
  // --------------------------------------------------------------------------

  /**
   * AA 배포 상태 확인
   * v0.20.6: aaAddress fallback 제거 - kernelAccount?.address에서 파생
   */
  checkAADeployed: async (address: `0x${string}` | null = null): Promise<boolean> => {
    const target = address ?? get().kernelAccount?.address;
    if (!target) {
      set({ aaDeploymentStatus: 'unknown' }, false, 'aa/checkAADeployed:missingAddress');
      return false;
    }

    try {
      const code = await publicClient.getCode({ address: target });
      const deployed = !!(code && code !== '0x');
      set({ aaDeploymentStatus: deployed ? 'deployed' : 'not_deployed' }, false, 'aa/checkAADeployed');
      return deployed;
    } catch (e) {
      logger.error(`Check deployed failed: ${e}`);
      // v0.20.9: aaCheckError 제거 → aaDeploymentStatus: 'failed'로 충분
      set({ aaDeploymentStatus: 'failed' }, false, 'aa/checkAADeployed:error');
      return false;
    }
  },

  /**
   * Gas deposit 확인
   */
  checkAAGasDeposit: async (address: `0x${string}`): Promise<bigint> => {
    const deposit = await getAaDepositOnEntryPoint({
      publicClient,
      entryPointAddress: entryPoint.address,
      userAaAddress: address,
    });
    set({ aaDepositAmount: deposit }, false, 'aa/checkAAGasDeposit');
    return deposit;
  },

  /**
   * Gas top-up 요청
   */
  requestAAGasTopup: async (address: `0x${string}`): Promise<void> => {
    logger.info(`Requesting gas top-up for ${address}`);
    await apiHttp<unknown>('/api/public/account/aa/gas/request', {
      method: 'POST',
      body: JSON.stringify({ aa_address: address, chain: hyperliquidEvm.name.toUpperCase() }),
    });
    logger.info('Gas top-up requested');
  },

  // --------------------------------------------------------------------------
  // AA Initialization (v0.20.0: Trait 기반 분리)
  // --------------------------------------------------------------------------

  /**
   * v0.20.0: WalletAdapter 기반 AA 초기화
   *
   * @param signerSource - web local provider accessor를 구현한 WalletAdapter
   * @param opts - 옵션
   *               - idToken: Backend 등록용 explicit input
   *               - autoDeploy: 자동 배포 여부 (기본값: false)
   *
   * - Privy/EOA Adapter 모두 전달 가능
   * - idToken이 없으면 백엔드 등록 스킵
   */
  initializeAAWithSigner: async (signerSource, opts: InitializeAAWithSignerOpts = {}) => {
    const state = get();
    const { isLinking, kernelAccount } = state;

    // 1. 중복 실행 방지
    if (isLinking) {
      logger.info('initializeAAWithSigner() skipped - already in progress');
      return;
    }

    // 2. 이미 초기화됨
    // v0.20.6: aaAddress → kernelAccount 체크로 변경 (stale 주소 문제 해결)
    if (kernelAccount) {
      logger.info('initializeAAWithSigner() skipped - already initialized');
      return;
    }

    // 3. AA Kill Switch
    if (!FEATURES.AA_ENABLED) {
      logger.info('initializeAAWithSigner() skipped - AA disabled');
      return;
    }

    // 4. Provider 및 EOA 주소 검증
    const ethProvider = await requireWebWalletProvider(signerSource);
    const eoaAddress = signerSource.getEOAAddress();
    if (!eoaAddress) {
      logger.info('initializeAAWithSigner() skipped - missing provider or EOA address');
      return;
    }

    // 5. idToken 획득 (explicit input only)
    const idToken = opts?.idToken ?? null;
    const autoDeploy = opts?.autoDeploy ?? false;

    set({ isLinking: true, error: null }, false, 'aa/initializeAAWithSigner:start');
    logger.info(`initializeAAWithSigner() started (hasIdToken=${!!idToken})`);

    try {
      // AA 계정 생성
      logger.info('Calling createAAAccount()...');
      const { account } = await get().createAAAccount({ adapter: signerSource });
      if (!account) throw new ContextRequiredError('Kernel account not initialized');
      logger.info(`createAAAccount() completed, AA address: ${account.address}`);

      // 백엔드 등록 (idToken 있을 때만)
      if (idToken) {
        logger.info('Checking backend registration...');
        let meRes: any;
        try {
          meRes = await apiHttp<any>(
            `/api/public/account/aa/me?privy_id_token=${idToken}&chain=${hyperliquidEvm.name.toUpperCase()}`,
            { cache: 'no-store' }
          );
        } catch (err: any) {
          // 404 = not registered yet → proceed with registration
          if (err?.message?.includes('404')) {
            meRes = null;
          } else {
            throw err;
          }
        }

        if (!meRes) {
          logger.info('User not registered, starting registration flow...');
          set({ isRegistering: true }, false, 'aa/initializeAAWithSigner:registering');

          const challenge = await apiHttp<string>(
            `/api/public/account/aa/register/challenge?address=${account.address}`,
            { cache: 'no-store' }
          );
          logger.info('Challenge received, signing...');

          let sig: string;
          try {
            const accounts = await requestEIP1193(ethProvider, 'eth_accounts');
            const signer = accounts[0];
            sig = await requestEIP1193(ethProvider, 'personal_sign', [challenge, signer]);
          } catch (err) { // @ci-exception(no-empty-catch) /* recovery — personal_sign param 순서 polyfill */
            logger.warn('personal_sign param order fallback', { err });
            const accounts = await requestEIP1193(ethProvider, 'eth_accounts');
            const signer = accounts[0];
            sig = await requestEIP1193(ethProvider, 'personal_sign', [signer, challenge]);
          }
          logger.info('Signature obtained, registering...');

          await apiHttp<unknown>('/api/public/account/aa/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chain: hyperliquidEvm.name.toUpperCase(),
              aa_address: account.address,
              challenge,
              signature: sig,
              privy_id_token: idToken,
            }),
          });

          set({ isRegistered: true, isRegistering: false }, false, 'aa/initializeAAWithSigner:registered');
          logger.info('Registration completed');
        } else {
          set({ isRegistered: true }, false, 'aa/initializeAAWithSigner:alreadyRegistered');
          logger.info('User already registered');
        }
      } else {
        // idToken 없음 (Direct-EOA) - 백엔드 등록 스킵
        logger.info('No idToken available, skipping backend registration (Direct-EOA)');
      }

      // 자동 배포
      if (autoDeploy) {
        logger.info('Auto-deploying...');
        await get().deployAAAccount();
      } else {
        await get().checkAADeployed(account.address);
      }

      logger.info('initializeAAWithSigner() completed successfully');

      // Event emission for AA initialization
      storeEvents.emit('aa:initialized');
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error in initializeAAWithSigner';
      logger.error(`initializeAAWithSigner error: ${errorMessage}`);
      set({ error: errorMessage, isRegistering: false }, false, 'aa/initializeAAWithSigner:error');
    } finally {
      set({ isLinking: false }, false, 'aa/initializeAAWithSigner:finally');
    }
  },

  /**
   * @deprecated v0.20.0: initializeAAWithSigner 사용 권장
   * Privy 경로용 backward compat 유지
   */
  initializeAA: async (opts: InitializeAAOpts = {}) => {
    const state = get();
    // v0.32.0: getActiveWallet 경유
    const activeWallet = getActiveWallet(state);
    const { privy } = state;

    // v0.20.12: L1 구조에서 privy 상태 추출
    const privyReady = privy.status === 'ready' || privy.status === 'authenticated';
    const privyAuthenticated = privy.status === 'authenticated';
    const privyIdToken = privy.status === 'authenticated' ? privy.idToken : null;

    // Privy 인증 대기 (기존 로직 유지)
    if (!privyReady || !privyAuthenticated) {
      logger.info('initializeAA() skipped - Privy not ready/authenticated');
      return;
    }

    // idToken 확인
    const idToken = opts?.idToken ?? privyIdToken;
    let signerAdapter = opts?.adapter;
    if (!signerAdapter && activeWallet.status === 'connected') {
      signerAdapter = activeWallet.adapter;
    }

    if (!idToken || !signerAdapter) {
      logger.info('initializeAA() skipped - missing idToken or adapter');
      return;
    }

    // adapter가 있으면 새 함수로 위임
    if (signerAdapter) {
      await get().initializeAAWithSigner(signerAdapter, {
        idToken,
        autoDeploy: opts?.autoDeploy,
      });
      return;
    }

    // strict: fallback 제거
    logger.error('initializeAA() skipped - missing adapter (strict mode)');
    return;
  },
});
