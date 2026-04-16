import { createLogger } from '@hq/core/logging';
import { AUTH_SOURCES } from '@hq/core/auth';
import type { AccountStore, ZustandSetFn } from '../slices/types';
import type { ReconcileAction, ReconcileContext, ReconcilePolicy } from './reconcilePolicy';
import type { AccountStoreDeps } from '../deps';

const logger = createLogger('policyRunner');

type Effects = AccountStoreDeps['effects'];

export function collectReconcileActions(
  state: AccountStore,
  context: ReconcileContext,
  policies: ReconcilePolicy[]
): ReconcileAction[] {
  const actions: ReconcileAction[] = [];

  for (const policy of policies) {
    if (policy.shouldApply(state, context)) {
      logger.info(`[reconcile] Policy ${policy.id} (${policy.name}) applied`);
      actions.push(...policy.getActions(state, context));

      if (policy.shortCircuit) {
        logger.info(`[reconcile] Short-circuit at policy ${policy.id}`);
        break;
      }
    }
  }

  return actions;
}

export function applyReconcileActions(
  get: () => AccountStore,
  set: ZustandSetFn,
  actions: ReconcileAction[],
  effects: Effects
): void {
  for (const action of actions) {
    switch (action.type) {
      case 'SET_EXECUTION_MODE': {
        const mode = action.payload;
        set({
          executionSelection: { mode, isUserSelected: false },
        }, false, 'reconcile:setExecutionMode');
        break;
      }

      case 'CLEAR_AA':
        set({
          kernelAccount: null,
          kernelClient: null,
        }, false, 'reconcile:clearAA');
        break;

      case 'REQUEST_TOAST':
        logger.info(`[TOAST] ${action.payload}`);
        effects.notify({ title: action.payload, message: null, type: 'info' });
        break;

      case 'LOG_ONLY':
        logger.info(`[reconcile] ${action.payload}`);
        break;

      case 'SET_AUTH_SOURCE': {
        const newAuthSource = action.payload;
        const currentState = get();
        let newMode = currentState.executionSelection.mode;
        if (!currentState.executionSelection.isUserSelected) {
          newMode = newAuthSource === AUTH_SOURCES.PRIVY_TELEGRAM ? 'aa' : 'eoa';
        }

        set({
          authSelection: { source: newAuthSource, isUserSelected: false },
          providerSelection: {
            activeProviderId: currentState.sourceProviderIds[newAuthSource] ?? null,
            isUserSelected: false,
          },
          executionSelection: { mode: newMode, isUserSelected: currentState.executionSelection.isUserSelected },
        }, false, 'policy/setAuthSource');
        break;
      }

      case 'SET_AUTO_FALLBACK_DONE':
        set({ autoFallbackDone: true }, false, 'policy/setAutoFallbackDone');
        break;
    }
  }
}

export function runReconcile(
  get: () => AccountStore,
  set: ZustandSetFn,
  context: ReconcileContext,
  policies: ReconcilePolicy[],
  effects: Effects
): void {
  const state = get();
  const actions = collectReconcileActions(state, context, policies);

  if (actions.length > 0) {
    applyReconcileActions(get, set, actions, effects);
  }
}
