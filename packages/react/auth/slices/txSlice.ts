import { AccountErrorCode } from '@hq/core/auth';
import type {
  WalletStatus,
  WalletNextAction,
  AAState,
  ExecutionMode,
  ExecutionRequest,
  TxResult,
  AuthSource,
  ActiveAccountSnapshot,
  ActiveAccountReadySnapshot,
} from '@hq/core/auth';
import { AUTH_SOURCES } from '@hq/core/auth';
import { createLogger } from '@hq/core/logging';
import { extractErrorInfo, parseTxError, TxError, TX_ERROR_CODES } from '@hq/core/lib/error';
import { WalletNotReadyError } from '@hq/core/auth';
import { getActiveWallet } from '../helpers/walletHelpers';
import type { TxSlice, SliceCreator, ExecuteTxOptions } from './types';
import type { AccountStoreDeps } from '../deps';

const logger = createLogger('txSlice');

function mapAAStateToErrorCode(
  aaState: AAState
): AccountErrorCode {
  switch (aaState.kind) {
    case 'disabled':
      return AccountErrorCode.FEATURE_DISABLED_AA;
    case 'not_initialized':
      return AccountErrorCode.AA_NOT_INITIALIZED;
    case 'checking_deployment':
    case 'not_deployed':
    case 'deploy_failed':
      return AccountErrorCode.AA_NOT_DEPLOYED;
    case 'deployed':
      return AccountErrorCode.AA_NOT_INITIALIZED;
  }
}

function deriveErrorCode(
  walletStatus: WalletStatus,
  walletNextAction: WalletNextAction,
  authSource: AuthSource | null,
  aaState: AAState,
  executionMode: ExecutionMode
): AccountErrorCode {
  if (walletStatus !== 'ready') {
    switch (walletNextAction.kind) {
      case 'login':
        return authSource === AUTH_SOURCES.PRIVY_TELEGRAM
          ? AccountErrorCode.PRIVY_NOT_AUTHENTICATED
          : AccountErrorCode.WALLET_NOT_CONNECTED;
      case 'none':
      default:
        return AccountErrorCode.WALLET_NOT_CONNECTED;
    }
  }

  if (executionMode === 'aa') {
    return mapAAStateToErrorCode(aaState);
  }

  return AccountErrorCode.WALLET_NOT_CONNECTED;
}

function ensureWalletReady(
  activeAccount: ActiveAccountSnapshot,
  message: string
): asserts activeAccount is ActiveAccountReadySnapshot {
  if (!activeAccount.ready) {
    const {
      walletStatus,
      walletNextAction,
      authSource,
      aaState,
      executionMode,
    } = activeAccount;

    const errorCode = deriveErrorCode(
      walletStatus,
      walletNextAction,
      authSource,
      aaState,
      executionMode
    );

    throw new WalletNotReadyError({
      code: errorCode,
      message: activeAccount.reason ?? message,
      walletStatus,
      walletNextAction,
      authSource,
      aaState,
      executionMode,
    });
  }
}

export function createTxSlice(deps: Pick<AccountStoreDeps, 'txRuntime'>): SliceCreator<TxSlice> {
  return (_set, get) => ({
    execute: async (request: ExecutionRequest, options: ExecuteTxOptions = {}): Promise<TxResult> => {
      const activeAccount = get().getActiveAccount();
      ensureWalletReady(activeAccount, 'Not ready for transaction');

      const wallet = getActiveWallet(get());
      if (wallet.status !== 'connected') {
        throw new TxError(TX_ERROR_CODES.UNKNOWN, 'No wallet adapter available', null);
      }

      if (activeAccount.executionMode === 'eoa') {
        await deps.txRuntime.ensureChainReady({ targetChainId: request.chainId });
      }

      const executor =
        activeAccount.executionMode === 'aa'
          ? await (() => {
              const kernelClient = get().kernelClient;
              if (!kernelClient) {
                throw new TxError(TX_ERROR_CODES.UNKNOWN, 'AA kernel client not available', null);
              }
              return deps.txRuntime.createExecutor(wallet.adapter, {
                mode: 'aa',
                kernelClient,
              });
            })()
          : await (() => {
              return deps.txRuntime.createExecutor(wallet.adapter, {
                mode: 'eoa',
                eoaAddress: wallet.eoaAddress,
              });
            })();

      try {
        logger.info(`execute (${executor.mode}): chainId=${request.chainId}, to=${request.call.to}`);
        const hash = await executor.execute(request, options.onProgress);
        return { hash, mode: executor.mode };
      } catch (error) {
        logger.error(`execute failed: ${extractErrorInfo(error).message}`);
        throw parseTxError(error);
      }
    },

    signMessage: async (message: string): Promise<`0x${string}`> => {
      const activeAccount = get().getActiveAccount();
      ensureWalletReady(activeAccount, 'Not ready for signing');

      const wallet = getActiveWallet(get());
      if (wallet.status !== 'connected') {
        throw new TxError(TX_ERROR_CODES.UNKNOWN, 'No signer available', null);
      }

      logger.info(`signMessage: ${message.substring(0, 50)}...`);
      try {
        const signature = await wallet.adapter.signMessage(message);
        return signature;
      } catch (e: any) {
        logger.error(`signMessage failed: ${e?.message}`);
        throw new TxError(TX_ERROR_CODES.UNKNOWN, e?.message ?? 'Signing failed', null, e);
      }
    },
  });
}
