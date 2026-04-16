import { ControlFlowError } from '../../lib/error';
import type {
  WalletStatus,
  WalletNextAction,
  AuthSource,
  AAState,
  ExecutionMode,
} from '../types';
import { AccountErrorCode } from '../types';

export class WalletNotReadyError extends ControlFlowError {
  readonly code: AccountErrorCode;
  readonly walletStatus: WalletStatus;
  readonly walletNextAction: WalletNextAction;
  readonly authSource: AuthSource | null;
  readonly aaState: AAState;
  readonly executionMode: ExecutionMode;

  constructor(params: {
    code: AccountErrorCode;
    message: string;
    walletStatus: WalletStatus;
    walletNextAction: WalletNextAction;
    authSource: AuthSource | null;
    aaState: AAState;
    executionMode: ExecutionMode;
  }) {
    super(params.message);
    this.code = params.code;
    this.walletStatus = params.walletStatus;
    this.walletNextAction = params.walletNextAction;
    this.authSource = params.authSource;
    this.aaState = params.aaState;
    this.executionMode = params.executionMode;
  }
}
