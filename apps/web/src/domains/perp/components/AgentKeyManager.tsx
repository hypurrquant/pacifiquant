'use client';

/**
 * AgentKeyManager -- Unified panel showing all 3 exchange API key statuses.
 *
 * Displays Hyperliquid agent wallet, Pacifica Phantom connection,
 * and Lighter API key status in a single view with actions for each.
 *
 * Each DEX card surfaces a second-stage "Approve Builder Fee" button once
 * the agent is active. Builder fee approval is intentionally separate from
 * agent setup so the user can retry it independently and so both flows have
 * a clear single responsibility.
 */

import { useCallback, useEffect, useState } from 'react';
import { PacificaPerpAdapter, LighterPerpAdapter, HyperliquidPerpAdapter, AsterPerpAdapter } from '@hq/core/defi/perp';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createLogger } from '@hq/core/logging';
import { useAgentWalletStore, selectIsAgentActive, selectAgentAddress, selectMasterAddress } from '../stores/useAgentWalletStore';
import { usePacificaAgentStore, selectPacificaMainAccount } from '../stores/usePacificaAgentStore';
import { useLighterAgentStore } from '../stores/useLighterAgentStore';
import { useAsterAgentStore } from '../stores/useAsterAgentStore';
import { usePerpDeps } from '../providers/PerpDepsProvider';
import { useAccountStore, selectWalletProvider, selectActiveAddress } from '@/infra/auth/stores';

const logger = createLogger('AgentKeyManager');

// ── Status Badge ──

type KeyStatus = 'active' | 'not_setup';

function StatusBadge({ status }: { status: KeyStatus }) {
  const config: Record<KeyStatus, { label: string; color: string; bg: string }> = {
    active: { label: 'Active', color: '#5fd8ee', bg: 'rgba(80,210,193,0.12)' },
    not_setup: { label: 'Not Setup', color: '#949E9C', bg: 'rgba(148,158,156,0.12)' },
  };
  const c = config[status];
  return (
    <span
      className="px-2 py-0.5 rounded text-[10px] font-medium"
      style={{ color: c.color, backgroundColor: c.bg }}
    >
      {c.label}
    </span>
  );
}

// ── Address Truncation ──

function truncateAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ── Props ──

interface Props {
  /** Singleton Pacifica adapter to check hasSigner() */
  pacificaAdapter: PacificaPerpAdapter | null;
  /** Singleton Lighter adapter to check hasCredentials() */
  lighterAdapter: LighterPerpAdapter | null;
  /** Singleton Aster adapter to check hasCredentials() */
  asterAdapter: AsterPerpAdapter | null;
  /** Pacifica Phantom address if connected */
  pacificaAddress: string | null;
  /** Callback to open the HL agent setup flow */
  onSetupHyperliquid: () => void;
  /** Whether the panel is initially collapsed */
  defaultCollapsed: boolean;
  /**
   * Called after a successful registration (HL / Pacifica / Lighter / Aster) so the
   * parent modal can close itself. Optional because this component is also
   * used in an always-visible side panel context where there is nothing to
   * dismiss.
   */
  onRegistrationSuccess?: () => void;
}

export function AgentKeyManager({
  pacificaAdapter,
  lighterAdapter,
  asterAdapter,
  pacificaAddress,
  onSetupHyperliquid,
  defaultCollapsed,
  onRegistrationSuccess,
}: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [isRegisteringPacifica, setIsRegisteringPacifica] = useState(false);
  const [pacificaAgentKey, setPacificaAgentKey] = useState<string | null>(null);
  const [isRegisteringLighter, setIsRegisteringLighter] = useState(false);
  const [isRegisteringAster, setIsRegisteringAster] = useState(false);

  // ── Builder fee approval state (per DEX) ──
  // 'idle' = not yet approved in this session; 'approved' = success this session.
  // Persistence across reloads is nice-to-have but not required — the protocol
  // enforces approval server-side so a missed reload simply shows the button again.
  const [hlBuilderStatus, setHlBuilderStatus] = useState<'idle' | 'approved'>('idle');
  const [isApprovingHlBuilder, setIsApprovingHlBuilder] = useState(false);
  // Derive the initial Pacifica builder status from the persisted agent state:
  // `handlePacificaRegister` calls `approveBuilderCode` BEFORE `registerAgentKey`,
  // so if the store says `type === 'registered'` we know builder approval
  // already went through. Without this, re-opening the modal re-shows the
  // "Approve Builder Fee" button and lets the user double-approve.
  const pacificaInitialType = usePacificaAgentStore.getState().persisted.type;
  const [pacificaBuilderStatus, setPacificaBuilderStatus] = useState<'idle' | 'approved'>(
    pacificaInitialType === 'registered' ? 'approved' : 'idle',
  );
  const [isApprovingPacificaBuilder, setIsApprovingPacificaBuilder] = useState(false);
  const [lighterIntegratorStatus, setLighterIntegratorStatus] = useState<'idle' | 'approved'>('idle');
  const [isApprovingLighterIntegrator, setIsApprovingLighterIntegrator] = useState(false);

  const deps = usePerpDeps();
  const isHlActive = useAgentWalletStore(selectIsAgentActive);
  const hlAgentAddress = useAgentWalletStore(selectAgentAddress);
  const hlMasterAddress = useAgentWalletStore(selectMasterAddress);
  const hlStore = useAgentWalletStore();
  // Subscribe to Pacifica + Lighter + Aster stores so zustand's persist middleware
  // rehydrates from localStorage on first mount, feeding the adapter
  // singletons back their previously-registered keys. The return values
  // are intentionally unused — the subscribe itself triggers hydration.
  // `persisted.type === 'registered'` is the authoritative source of
  // "Pacifica agent is bound to this account". hasSigner() on the adapter
  // can also be true when only a main-wallet signer was imported
  // without registering an agent key yet — using that for
  // gating hides the Enable Trading button and strands the user with
  // only the Approve Builder Fee path.
  const pacificaPersistedType = usePacificaAgentStore((s) => s.persisted.type);
  useLighterAgentStore((s) => s.persisted.type);
  useAsterAgentStore((s) => s.persisted.type);
  const pacificaMainAccount = usePacificaAgentStore(selectPacificaMainAccount);

  // ── Hyperliquid status ──
  // With the localStorage persistence added in the agent-wallet stores,
  // a reload restores cachedSignFn from the stored private key — there
  // is no longer a user-visible "key lost" state. Collapse the legacy
  // `needs_reimport` branch into plain `not_setup` so the UI stays
  // positive ("Enable Trading") rather than alarming ("Key Lost").
  const hlStatus: KeyStatus = isHlActive ? 'active' : 'not_setup';

  // Hydrate hlBuilderStatus from HL's server-side record on mount + whenever
  // the master address changes. Without this, the local useState always
  // starts at 'idle' after a reload, so a user who already approved the
  // builder fee sees the button again and — if they skip it, thinking
  // they already approved — gets "Builder fee has not been approved" on
  // their next order. HL's `/info` type=maxBuilderFee returns the
  // approved rate (tenths of a basis point); anything >= BUILDER_FEE (1)
  // means our per-order cap is covered.
  useEffect(() => {
    if (!isHlActive || !hlMasterAddress) return;
    let cancelled = false;
    const adapter = new HyperliquidPerpAdapter();
    adapter
      .getMaxBuilderFee(hlMasterAddress, HyperliquidPerpAdapter.BUILDER_ADDRESS)
      .then((fee) => {
        if (cancelled) return;
        if (fee >= HyperliquidPerpAdapter.BUILDER_FEE) {
          setHlBuilderStatus('approved');
        }
      })
      .catch((err) => {
        logger.warn(`maxBuilderFee check failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [isHlActive, hlMasterAddress]);

  // ── Pacifica status ──
  // "connected" here means "agent key is bound + persisted" — i.e. the full
  // Enable Trading flow completed. NOT just "main-wallet signer is installed on
  // the adapter" (that can be a signer-only import,
  // which leaves the user without an agent).
  const pacificaConnected = pacificaPersistedType === 'registered';
  const pacificaStatus: KeyStatus = pacificaConnected ? 'active' : 'not_setup';

  // Keep Pacifica builder status in sync with the persisted agent state —
  // covers the case where the store rehydrates AFTER initial mount (zustand
  // `onRehydrateStorage` fires after the first render).
  useEffect(() => {
    if (pacificaPersistedType === 'registered') setPacificaBuilderStatus('approved');
  }, [pacificaPersistedType]);

  // ── Lighter status ──
  const lighterReady = lighterAdapter !== null && lighterAdapter.hasCredentials();
  const lighterApiKeyIndex = lighterAdapter?.getApiKeyIndex() ?? null;
  const lighterStatus: KeyStatus = lighterReady ? 'active' : 'not_setup';

  // ── Aster status ──
  const asterReady = asterAdapter !== null && asterAdapter.hasCredentials();
  const asterStatus: KeyStatus = asterReady ? 'active' : 'not_setup';

  // ── HL Revoke ──
  const handleHlRevoke = useCallback(() => {
    hlStore.disconnect();
    deps.showToast({ title: 'Agent wallet disconnected', type: 'info' });
  }, [hlStore, deps]);

  // ── Pacifica Agent Key Registration ──
  const handlePacificaRegister = useCallback(async () => {
    if (isRegisteringPacifica || !pacificaAdapter) return;

    // Phantom wallet provides Ed25519 signMessage on Solana
    const phantom = (window as unknown as Record<string, unknown>).phantom as
      | { solana?: { isPhantom?: boolean; connect(): Promise<{ publicKey: { toBase58(): string } }>; signMessage(msg: Uint8Array, display: string): Promise<{ signature: Uint8Array }> } }
      | undefined;
    const solana = phantom?.solana;
    if (!solana?.isPhantom) {
      deps.showToast({ title: 'Phantom not installed', message: 'Install Phantom wallet for Pacifica', type: 'warning' });
      return;
    }

    setIsRegisteringPacifica(true);
    try {
      // Connect Phantom first (auto-approves if previously connected)
      const { publicKey } = await solana.connect();
      const mainAccount = publicKey.toBase58();
      const signMessage = async (msg: Uint8Array): Promise<Uint8Array> => {
        const result = await solana.signMessage(msg, 'utf8');
        return new Uint8Array(result.signature);
      };

      // 1) Builder code approval — main wallet signs. Must happen BEFORE
      // bind_agent_wallet: once the agent is bound, subsequent orders
      // embed the builder code, and Pacifica rejects any order whose
      // builder code isn't on the approved list ("Unauthorized builder").
      // Two Phantom popups per enable flow (builder then bind) — same
      // UX as HL's two EIP-712 signatures.
      await pacificaAdapter.approveBuilderCode(mainAccount, signMessage);
      setPacificaBuilderStatus('approved');

      // 2) Agent bind
      const { agentPublicKey, agentPrivateKeyBase58 } = await pacificaAdapter.registerAgentKey(mainAccount, signMessage);
      // Persist so the next reload can re-sign without another Phantom prompt.
      usePacificaAgentStore.getState().setAgent({
        agentSecretKeyB58: agentPrivateKeyBase58,
        agentPublicKey,
        mainAccount,
      });
      setPacificaAgentKey(agentPublicKey);
      deps.showToast({ title: 'Pacifica trading enabled', type: 'success' });
      onRegistrationSuccess?.();
    } catch (err) {
      // Surface the underlying error text so the devtools console doesn't
      // collapse it into an opaque `Object`. Pacifica's /agent/bind returns
      // "Invalid signature" when the signed payload / header ordering drifts
      // from what the server expects — keep the raw message visible.
      const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
      logger.error(`Pacifica agent registration failed: ${msg}`);
      deps.showToast({
        title: 'Agent registration failed',
        message: msg || 'Unknown error',
        type: 'warning',
      });
    } finally {
      setIsRegisteringPacifica(false);
    }
  }, [isRegisteringPacifica, pacificaAdapter, deps, onRegistrationSuccess]);

  // ── Lighter API Key Registration ──
  const handleLighterRegister = useCallback(async () => {
    if (isRegisteringLighter || !lighterAdapter) return;

    const state = useAccountStore.getState();
    const address = selectActiveAddress(state);
    const provider = selectWalletProvider(state);

    if (!address || !provider) {
      deps.showToast({ title: 'Wallet not connected', message: 'Connect EVM wallet for Lighter key registration', type: 'warning' });
      return;
    }

    setIsRegisteringLighter(true);
    try {
      const evmSignMessage = async (message: string): Promise<string> => {
        return provider.request({
          method: 'personal_sign',
          params: [message, address],
        }) as Promise<string>;
      };

      // 1) Register API key (L1 signature → ChangePubKey).
      //
      // Lighter inverts the HL/Pacifica sequence: `approveIntegrator` must
      // be signed by the API key itself (WASM signer), which does not
      // exist until ChangePubKey completes. So the order is reversed —
      // API key first, integrator approval second — but both still sit
      // inside a single Enable Trading click so the user doesn't hit
      // "Integrator not approved" on their first order the way they
      // would with a separate button.
      const { apiKey, accountIndex, apiKeyIndex } = await lighterAdapter.registerApiKey(evmSignMessage, address);
      useLighterAgentStore.getState().setCredentials({
        apiKey,
        accountIndex,
        apiKeyIndex,
        l1Address: address,
      });

      // 2) Approve our integrator (builder) so per-order fees route to us.
      // No user signature needed — WASM signs with the API key we just
      // generated. Non-fatal: if this fails (e.g. integrator already
      // approved from a previous session), keep the key registered and
      // surface the error — orders may still succeed if a prior approval
      // is live server-side.
      try {
        await lighterAdapter.approveIntegrator();
        setLighterIntegratorStatus('approved');
      } catch (approveErr) {
        const aMsg = approveErr instanceof Error ? approveErr.message : String(approveErr);
        logger.warn(`Lighter approveIntegrator after registerApiKey failed: ${aMsg}`);
      }

      deps.showToast({ title: 'Lighter trading enabled', message: `Key: ${apiKey.slice(0, 8)}...`, type: 'success' });
      onRegistrationSuccess?.();
    } catch (err) {
      // Keep the underlying cause visible in devtools — the default
      // `{ err }` wrap renders as an opaque `Object` when collapsed.
      const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
      logger.error(`Lighter API key registration failed: ${msg}`);
      // The most common cause on a clean wallet is "account not found on
      // Lighter" — give the user the actionable next step (deposit to
      // create an account) rather than the raw API URL.
      const friendly = /account not found/i.test(msg)
        ? 'No Lighter account yet for this wallet. Deposit USDC to Lighter first.'
        : msg || 'Unknown error';
      deps.showToast({
        title: 'Key registration failed',
        message: friendly,
        type: 'warning',
      });
    } finally {
      setIsRegisteringLighter(false);
    }
  }, [isRegisteringLighter, lighterAdapter, deps, onRegistrationSuccess]);

  // ── HL Builder Fee Approval ──
  const handleHlApproveBuilderFee = useCallback(async () => {
    if (isApprovingHlBuilder) return;
    setIsApprovingHlBuilder(true);
    try {
      const signatureChainId = await deps.getMainWalletChainId();
      const mainSignFn = deps.getMainWalletSignFn();
      // HyperliquidPerpAdapter is stateless for builder fee approval — the
      // constructor needs no arguments, all constants are static.
      const hlAdapter = new HyperliquidPerpAdapter();
      await hlAdapter.approveBuilderFee(
        {
          builderAddress: HyperliquidPerpAdapter.BUILDER_ADDRESS,
          maxFeeRate: HyperliquidPerpAdapter.BUILDER_MAX_FEE_RATE,
          signatureChainId,
        },
        mainSignFn,
      );
      setHlBuilderStatus('approved');
      deps.showToast({ title: 'HL builder fee approved', type: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
      logger.error(`HL builder fee approval failed: ${msg}`);
      deps.showToast({ title: 'Builder fee approval failed', message: msg || 'Unknown error', type: 'warning' });
    } finally {
      setIsApprovingHlBuilder(false);
    }
  }, [isApprovingHlBuilder, deps]);

  // ── Pacifica Builder Code Approval ──
  const handlePacificaApproveBuilderCode = useCallback(async () => {
    if (isApprovingPacificaBuilder || !pacificaAdapter) return;

    // Builder code approval requires the main Phantom wallet (not the agent key).
    const phantom = (window as unknown as Record<string, unknown>).phantom as
      | { solana?: { isPhantom?: boolean; connect(): Promise<{ publicKey: { toBase58(): string } }>; signMessage(msg: Uint8Array, display: string): Promise<{ signature: Uint8Array }> } }
      | undefined;
    const solana = phantom?.solana;
    if (!solana?.isPhantom) {
      deps.showToast({ title: 'Phantom not installed', message: 'Install Phantom wallet for Pacifica', type: 'warning' });
      return;
    }

    // Resolve main account — prefer the persisted mainAccount so we don't prompt
    // an unnecessary Phantom connect if the user already registered the agent key.
    let mainAccount = pacificaMainAccount;
    if (!mainAccount) {
      const { publicKey } = await solana.connect();
      mainAccount = publicKey.toBase58();
    }

    setIsApprovingPacificaBuilder(true);
    try {
      const signMessage = async (msg: Uint8Array): Promise<Uint8Array> => {
        const result = await solana.signMessage(msg, 'utf8');
        return new Uint8Array(result.signature);
      };
      await pacificaAdapter.approveBuilderCode(mainAccount, signMessage);
      setPacificaBuilderStatus('approved');
      deps.showToast({ title: 'Pacifica builder code approved', type: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
      logger.error(`Pacifica builder code approval failed: ${msg}`);
      deps.showToast({ title: 'Builder code approval failed', message: msg || 'Unknown error', type: 'warning' });
    } finally {
      setIsApprovingPacificaBuilder(false);
    }
  }, [isApprovingPacificaBuilder, pacificaAdapter, pacificaMainAccount, deps]);

  // ── Aster Agent Approve (V3 EIP-712 flow) ──
  const handleAsterRegister = useCallback(async () => {
    if (isRegisteringAster || !asterAdapter) return;

    const state = useAccountStore.getState();
    const address = selectActiveAddress(state) as `0x${string}` | null;
    const provider = selectWalletProvider(state);

    if (!address || !provider) {
      deps.showToast({ title: 'Wallet not connected', message: 'Connect EVM wallet for Aster agent setup', type: 'warning' });
      return;
    }

    // agent keypair 생성 — approve 전에 미리 준비
    const pk = generatePrivateKey();
    const agentAddress = privateKeyToAccount(pk).address as `0x${string}`;

    setIsRegisteringAster(true);
    try {
      // provider warm-up: eth_chainId는 MetaMask에서 즉답하는 cheap call.
      // 콜드 스타트 케이스(슬립 후 깨어남)를 제거해 nonce window 낭비를 줄임.
      try {
        await provider.request({ method: 'eth_chainId', params: [] });
      } catch {
        // warm-up 실패는 fatal 아님 — EIP-712 서명 요청에서 어차피 프롬프트
      }

      // Aster approve는 BNB Chain(chainId=56)에서 서명해야 서버가 signer를
      // 올바르게 복구함. 다른 체인이면 Domain A의 chainId와 불일치 → 서명
      // 검증 실패 + MetaMask 최근 버전이 domain.chainId !== wallet.chainId
      // 자체를 거절. 유저에게 수동 스위치를 요구하는 대신 자동으로 전환을
      // 시도한다 — EIP-3326 `wallet_switchEthereumChain` 팝업이 한 번 더
      // 뜨지만 approve 팝업 직전에 묶여 있어 UX가 깔끔함.
      let signatureChainId = await deps.getMainWalletChainId();
      if (signatureChainId !== 56) {
        try {
          await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x38' }],
          });
          signatureChainId = await deps.getMainWalletChainId();
        } catch (switchErr) {
          // 4902 = chain not added. Add it then switch.
          const code = (switchErr as { code?: number } | null)?.code;
          if (code === 4902) {
            await provider.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: '0x38',
                chainName: 'BNB Smart Chain',
                nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                rpcUrls: ['https://bsc-dataseed.binance.org/'],
                blockExplorerUrls: ['https://bscscan.com'],
              }],
            });
            signatureChainId = await deps.getMainWalletChainId();
          } else {
            deps.showToast({
              title: 'Switch to BNB Chain',
              message: 'Please switch your wallet to BNB Chain (chainId 56) and retry',
              type: 'warning',
            });
            return;
          }
        }
        if (signatureChainId !== 56) {
          deps.showToast({
            title: 'Still on wrong network',
            message: 'Wallet is not on BNB Chain after switch — retry Enable Trading',
            type: 'warning',
          });
          return;
        }
      }

      deps.showToast({ title: 'Sign the Aster approval', message: 'One signature: combined agent + builder', type: 'info' });

      const mainSignFn = deps.getMainWalletSignFn();
      const expiredMs = Date.now() + 365 * 24 * 3600 * 1000;

      const nonceMicros = Date.now() * 1000;
      // Fixed brand name. Aster only allows one agent per (user, name) pair —
      // retrying after revoking the previous one on https://www.asterdex.com
      // is the canonical flow for rotating the key.
      const agentName = 'hypurrquant';
      await asterAdapter.approveAgent(
        {
          user: address,
          agentAddress,
          agentName,
          expiredMs,
          nonceMicros,
          ipWhitelist: '',
          signatureChainId,
        },
        mainSignFn,
      );

      // approve 성공 후 영속화 — 리로드 시 재승인 없이 agent key로 서명 가능
      useAsterAgentStore.getState().setAgent({
        user: address,
        agentAddress,
        agentPrivateKey: pk,
        agentName,
        expiredMs,
        registeredAt: Date.now(),
      });

      deps.showToast({ title: 'Aster trading enabled', message: `Agent: ${agentAddress.slice(0, 10)}...`, type: 'success' });
      onRegistrationSuccess?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
      logger.error(`Aster agent registration failed: ${msg}`);
      // Aster name collision ("Illegal agentName") happens when a previous
      // agent using `hypurrquant` already exists. Aster agent quota cap
      // ("Agent quantity over limit") happens when the master wallet has
      // hit its per-account agent limit. Both are resolved by revoking the
      // old agent on Aster's own UI (https://www.asterdex.com → profile →
      // API Wallet section) before retrying.
      let friendly = msg || 'Unknown error';
      if (/Illegal agentName/i.test(msg)) {
        friendly = 'Agent name "hypurrquant" is already in use. Revoke the existing PacifiQuant agent on asterdex.com, then retry.';
      } else if (/Agent quantity over limit|over limit/i.test(msg)) {
        friendly = 'Aster agent quota reached. Revoke unused agents on asterdex.com, then retry.';
      }
      deps.showToast({
        title: 'Agent registration failed',
        message: friendly,
        type: 'warning',
      });
    } finally {
      setIsRegisteringAster(false);
    }
  }, [isRegisteringAster, asterAdapter, deps, onRegistrationSuccess]);

  // ── Lighter Integrator Approval ──
  const handleLighterApproveIntegrator = useCallback(async () => {
    if (isApprovingLighterIntegrator || !lighterAdapter) return;
    setIsApprovingLighterIntegrator(true);
    try {
      await lighterAdapter.approveIntegrator();
      setLighterIntegratorStatus('approved');
      deps.showToast({ title: 'Lighter integrator approved', type: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
      logger.error(`Lighter integrator approval failed: ${msg}`);
      deps.showToast({ title: 'Integrator approval failed', message: msg || 'Unknown error', type: 'warning' });
    } finally {
      setIsApprovingLighterIntegrator(false);
    }
  }, [isApprovingLighterIntegrator, lighterAdapter, deps]);

  return (
    <div className="bg-surface border border-dark-600 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-white hover:bg-[#1a2830] transition-colors"
      >
        <span>Agent Keys</span>
        <svg
          className={`w-3 h-3 text-gray-400 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-3">
          {/* ── Hyperliquid ── */}
          <div className="border border-dark-600 rounded-md p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <img src="/chains/hyperliquid.png" alt="HL" className="w-4 h-4 rounded-full" />
                <span className="text-xs font-medium text-white">Hyperliquid</span>
              </div>
              <StatusBadge status={hlStatus} />
            </div>

            {isHlActive && hlAgentAddress && (
              <div className="space-y-1 mb-2">
                <div className="text-[10px] text-gray-400">
                  Agent: <span className="text-white font-mono">{truncateAddress(hlAgentAddress)}</span>
                </div>
                {hlMasterAddress && (
                  <div className="text-[10px] text-gray-400">
                    Master: <span className="text-white font-mono">{truncateAddress(hlMasterAddress)}</span>
                  </div>
                )}
              </div>
            )}

            {!isHlActive && (
              <p className="text-[10px] text-gray-400 mb-2">
                Create a trading key to start trading on Hyperliquid.
              </p>
            )}

            {isHlActive ? (
              <div className="space-y-1.5">
                {hlBuilderStatus === 'idle' ? (
                  <button
                    onClick={handleHlApproveBuilderFee}
                    disabled={isApprovingHlBuilder}
                    className="w-full py-1.5 text-[10px] font-medium rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                  >
                    {isApprovingHlBuilder ? 'Approving...' : 'Approve Builder Fee'}
                  </button>
                ) : (
                  <div className="text-[10px] text-[#5fd8ee]">Builder Fee Approved</div>
                )}
                <button
                  onClick={handleHlRevoke}
                  className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Revoke
                </button>
              </div>
            ) : (
              <button
                onClick={onSetupHyperliquid}
                className="w-full py-1.5 text-[10px] font-medium rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors"
              >
                Enable Trading
              </button>
            )}
          </div>

          {/* ── Pacifica ── */}
          <div className="border border-dark-600 rounded-md p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <img src="/chains/pacifica.svg" alt="Pacifica" className="w-4 h-4 rounded-full" />
                <span className="text-xs font-medium text-white">Pacifica</span>
              </div>
              <StatusBadge status={pacificaStatus} />
            </div>

            {pacificaConnected && pacificaAddress && (
              <div className="text-[10px] text-gray-400 mb-2">
                Address: <span className="text-white font-mono">{truncateAddress(pacificaAddress)}</span>
              </div>
            )}

            {pacificaConnected && pacificaAgentKey && (
              <div className="text-[10px] text-gray-400 mb-2">
                Agent: <span className="text-white font-mono">{truncateAddress(pacificaAgentKey)}</span>
              </div>
            )}

            {pacificaConnected && (
              <div className="space-y-1.5 mt-1">
                {pacificaBuilderStatus === 'idle' ? (
                  <button
                    onClick={handlePacificaApproveBuilderCode}
                    disabled={isApprovingPacificaBuilder}
                    className="w-full py-1.5 text-[10px] font-medium rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                  >
                    {isApprovingPacificaBuilder ? 'Approving...' : 'Approve Builder Fee'}
                  </button>
                ) : (
                  <div className="text-[10px] text-[#5fd8ee]">Builder Fee Approved</div>
                )}
              </div>
            )}

            {!pacificaConnected && (
              <>
                <p className="text-[10px] text-gray-500 mb-2">
                  Create a trading key to start trading on Pacifica.
                </p>
                <button
                  onClick={handlePacificaRegister}
                  disabled={isRegisteringPacifica}
                  className="w-full py-1.5 text-[10px] font-medium rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                >
                  {isRegisteringPacifica ? 'Enabling...' : 'Enable Trading'}
                </button>
              </>
            )}
          </div>

          {/* ── Lighter ── */}
          <div className="border border-dark-600 rounded-md p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <img src="/chains/lighter.png" alt="Lighter" className="w-4 h-4 rounded-full" />
                <span className="text-xs font-medium text-white">Lighter</span>
              </div>
              <StatusBadge status={lighterStatus} />
            </div>

            {lighterReady && lighterApiKeyIndex !== null && (
              <div className="text-[10px] text-gray-400 mb-2">
                API Key Index: <span className="text-white font-mono">{lighterApiKeyIndex}</span>
              </div>
            )}

            {lighterReady && (
              <div className="space-y-1.5 mt-1">
                {lighterIntegratorStatus === 'idle' ? (
                  <button
                    onClick={handleLighterApproveIntegrator}
                    disabled={isApprovingLighterIntegrator}
                    className="w-full py-1.5 text-[10px] font-medium rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                  >
                    {isApprovingLighterIntegrator ? 'Approving...' : 'Approve Builder Fee'}
                  </button>
                ) : (
                  <div className="text-[10px] text-[#5fd8ee]">Builder Fee Approved</div>
                )}
              </div>
            )}

            {!lighterReady && (
              <>
                <p className="text-[10px] text-gray-400 mb-2">
                  Create a trading key with your connected EVM wallet (API key slot 4).
                </p>
                <button
                  onClick={handleLighterRegister}
                  disabled={isRegisteringLighter}
                  className="w-full py-1.5 text-[10px] font-medium rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                >
                  {isRegisteringLighter ? 'Enabling...' : 'Enable Trading'}
                </button>
              </>
            )}
          </div>

          {/* ── Aster ── */}
          <div className="border border-dark-600 rounded-md p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <img src="/chains/aster.svg" alt="Aster" className="w-4 h-4 rounded-full" />
                <span className="text-xs font-medium text-white">Aster</span>
              </div>
              <StatusBadge status={asterStatus} />
            </div>

            {asterReady && asterAdapter?.getUser() && (
              <div className="text-[10px] text-gray-400 mb-2">
                Address: <span className="text-white font-mono">{truncateAddress(asterAdapter.getUser()!)}</span>
              </div>
            )}
            {asterReady && asterAdapter?.getAgentAddress() && (
              <div className="text-[10px] text-gray-400 mb-2">
                Agent: <span className="text-white font-mono">{truncateAddress(asterAdapter.getAgentAddress()!)}</span>
              </div>
            )}



            {!asterReady && (
              <>
                <p className="text-[10px] text-gray-400 mb-2">
                  Create a trading key with your connected EVM wallet (BNB Chain).
                </p>
                <button
                  onClick={handleAsterRegister}
                  disabled={isRegisteringAster}
                  className="w-full py-1.5 text-[10px] font-medium rounded border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                >
                  {isRegisteringAster ? 'Enabling...' : 'Enable Trading'}
                </button>
              </>
            )}
          </div>

          {/* ── Builder Fee Info ── */}
          <div className="text-center text-[10px] text-gray-500 pt-1 border-t border-dark-600">
            Builder Fees: 0.01% per trade (all exchanges)
          </div>
        </div>
      )}
    </div>
  );
}
