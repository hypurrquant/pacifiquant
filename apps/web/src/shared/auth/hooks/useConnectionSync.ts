// core/auth/hooks/useConnectionSync.ts
// v0.10.2: Unified Connection Sync (Privy + Direct EOA)
// v1.15.0: wagmi connector 기반 EOA 연결 (EOAAdapter → WagmiAdapter)

'use client';

// eslint-disable-next-line @typescript-eslint/no-empty-function
const _log: typeof console.log = () => {}; // auth debug: console.log로 교체하면 활성화

import { createLogger } from '@hq/core/logging';
import { useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { getAddress } from 'viem';
import { usePrivy, useWallets, useIdentityToken } from '@privy-io/react-auth';
import { useAccount, useConnect } from 'wagmi';
import {
  connect as coreConnect,
  disconnect as coreDisconnect,
  getAccount,
  switchChain as coreSwitchChain,
} from '@wagmi/core';
import type { Connector } from '@wagmi/core';
import { AUTH_SOURCES } from '@hq/core/auth';
import { useAccountStore, selectConnectedChainId, selectEOAAddress } from '@/infra/auth/stores';
import { PrivyAdapter, WagmiAdapter } from '@/infra/auth/adapters';
import { browserSync } from '@/infra/auth/sync/browserSync';
import { setWebWalletConnectedChainId } from '@/infra/auth/webWalletAdapter';
import { WEB_AUTH_PROVIDER_IDS } from '@/infra/auth/providerIds';
import { wagmiConfig } from '@/infra/lib/wagmi/config';
import {
  SUPPORTED_CHAINS,
  type ChainKey,
} from '@hq/core/config/chains';
import { extractErrorInfo, WALLET_ERROR_CODES, ContextRequiredError } from '@hq/core/lib/error';

const HYPERLIQUID_EVM_CHAIN_ID = 999;

/**
 * Unified Connection Sync Hook (v1.15.0)
 * - Privy (Telegram) 상태 동기화 (변경 없음)
 * - wagmi connector 기반 EOA 연결 (MetaMask, Rabby, WalletConnect, Coinbase)
 * - wagmi useAccount() → store 자동 동기화 (account/chain/disconnect)
 * - Chain switching via @wagmi/core switchChain
 */
const logger = createLogger('useConnectionSync');

export function useConnectionSync() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { identityToken } = useIdentityToken();

  // wagmi hooks
  const {
    address: wagmiAddress,
    chainId: wagmiChainId,
    isConnected: wagmiIsConnected,
    connector: activeConnector,
  } = useAccount();
  const { connectors } = useConnect();

  _log('[useConnectionSync] Hook called:', {
    ready,
    authenticated,
    walletsCount: wallets.length,
    hasIdentityToken: !!identityToken,
    wagmiAddress,
    wagmiChainId,
    wagmiIsConnected,
    connectorsCount: connectors.length,
  });

  // v1.46.4: auth global expectedChain 제거 — 현재 연결 chain은 wallet runtime에서만 읽는다
  const connectedChainId = useAccountStore(selectConnectedChainId);

  // isSwitching은 UI 상태
  const [isSwitching, setIsSwitching] = useState(false);

  // v1.15.0: wagmi switchChain (window.ethereum 직접 접근 제거)
  const switchChain = useCallback(async (targetChainKey: ChainKey) => {
    const targetChainId = SUPPORTED_CHAINS[targetChainKey]?.chain.id;
    _log('[useConnectionSync] 🔄 switchChain called, target:', targetChainId);
    if (!targetChainId) {
      logger.error(`Unknown chain: ${targetChainKey}`);
      return;
    }
    const currentChainId = getAccount(wagmiConfig).chainId ?? null;
    if (currentChainId === targetChainId) {
      return;
    }
    setIsSwitching(true);
    try {
      await coreSwitchChain(wagmiConfig, { chainId: targetChainId });
      _log('[useConnectionSync] ✅ Chain switched successfully');
    } catch (error: unknown) {
      const { code: walletErrorCode } = extractErrorInfo(error);
      if (walletErrorCode === WALLET_ERROR_CODES.USER_REJECTED_REQUEST) {
        _log('[useConnectionSync] User rejected chain switch');
      } else {
        throw error;
      }
    } finally {
      setIsSwitching(false);
    }
  }, []);

  // Stores (v0.10.1: Extended AccountStore)
  const authSource = useAccountStore((s) => s.authSelection.source);
  const eoaAddress = useAccountStore(selectEOAAddress);
  const syncPrivyState = useAccountStore((s) => s.syncPrivyState);
  const setEOAInfo = useAccountStore((s) => s.setEOAInfo);
  const setLifecycle = useAccountStore((s) => s.setLifecycle);
  const chooseAuthSource = useAccountStore((s) => s.chooseAuthSource);
  const reset = useAccountStore((s) => s.reset);
  const setProviderAvailability = useAccountStore((s) => s.setProviderAvailability);

  // v1.15.0: connectingRef — connectBrowserWallet 진행 중 sync effect 방지
  const connectingRef = useRef(false);
  // v1.15.0: disconnectingRef — disconnect 진행 중 sync effect가 재연결하지 않도록 방지
  const disconnectingRef = useRef(false);

  // v1.15.0: wagmi connectors 기반 EOA 가용성 (window.ethereum 체크 제거)
  const isDirectEOAAvailable = connectors.length > 0;

  useEffect(() => {
    setProviderAvailability(WEB_AUTH_PROVIDER_IDS.BROWSER, isDirectEOAAvailable);
  }, [isDirectEOAAvailable, setProviderAvailability]);

  // Privy Adapter 인스턴스
  const privyAdapter = useMemo(() => {
    if (!ready) return null;
    return new PrivyAdapter({
      privy: { ready, authenticated, login, logout },
      wallets,
    });
  }, [ready, authenticated, login, logout, wallets]);

  // Telegram ID 추출
  const telegramId = useMemo(() => {
    if (!user?.telegram?.telegramUserId) return null;
    return user.telegram.telegramUserId;
  }, [user]);

  // v0.20.19: Privy user.id 추출
  const privyUserId = useMemo(() => {
    return user?.id ?? null;
  }, [user]);

  // Privy 상태 동기화 (변경 없음)
  useEffect(() => {
    _log('[useConnectionSync] 🔄 Privy state sync effect:', {
      ready,
      authenticated,
      hasIdentityToken: !!identityToken,
      telegramId,
      privyUserId,
    });
    if (ready && authenticated) {
      syncPrivyState({
        kind: 'sdk_snapshot',
        ready: true,
        authenticated: true,
        idToken: identityToken ?? null,
        telegramId,
        privyUserId,
      });
      return;
    }

    syncPrivyState({
      kind: 'sdk_snapshot',
      ready,
      authenticated: false,
    });
  }, [ready, authenticated, identityToken, telegramId, privyUserId, syncPrivyState]);

  // Privy (Telegram) 연결 상태 동기화 (변경 없음)
  useEffect(() => {
    _log('[useConnectionSync] 🔗 Privy connection sync effect:', {
      ready,
      authenticated,
      authSource,
      walletsCount: wallets.length,
    });

    if (!ready) {
      _log('[useConnectionSync] ⏳ Skipping: Privy not ready');
      return;
    }
    if (authSource === AUTH_SOURCES.DIRECT_EOA) {
      _log('[useConnectionSync] ⏭️ Skipping: Direct EOA connected');
      return;
    }

    if (authenticated) {
      _log('[useConnectionSync] ✅ Privy authenticated, setting up connection');
      chooseAuthSource(AUTH_SOURCES.PRIVY_TELEGRAM);
      setLifecycle('connecting');

      const externalWallet = wallets.find((w) => w.walletClientType !== 'privy');
      const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy');
      const primaryWallet = externalWallet || embeddedWallet;

      _log('[useConnectionSync] 👛 Wallet selection:', {
        externalWallet: externalWallet?.address,
        embeddedWallet: embeddedWallet?.address,
        primaryWallet: primaryWallet?.address,
      });

      if (primaryWallet && privyAdapter) {
        _log('[useConnectionSync] 📡 Getting Ethereum provider from primaryWallet...');
        privyAdapter.getProvider().then((provider) => {
          if (!provider) {
            logger.warn('Failed to get Privy provider', {
              reason: 'Privy provider not available',
            });
            return;
          }
          setWebWalletConnectedChainId(privyAdapter, HYPERLIQUID_EVM_CHAIN_ID);
          _log('[useConnectionSync] ✅ Provider obtained, setting EOA info:', {
            eoaAddress: primaryWallet.address,
            connectedChainId: HYPERLIQUID_EVM_CHAIN_ID,
          });
          setEOAInfo(WEB_AUTH_PROVIDER_IDS.PRIVY, {
            eoaAddress: getAddress(primaryWallet.address),
            adapter: privyAdapter,
          });
          setLifecycle('connected');
        }).catch((err) => {
          logger.warn('Failed to get Privy provider', err);
        });
      } else {
        _log('[useConnectionSync] ⚠️ No wallet found despite being authenticated');
      }

      if (privyAdapter) {
        privyAdapter.updateWallets(wallets);
      }
    } else if (!authSource && !wagmiIsConnected) {
      // v1.15.0: walletDetected 제거 → wagmi reconnect에 의존
      // wagmi도 미연결이고 Privy도 미인증이면 reset
      _log('[useConnectionSync] 🔓 Not authenticated and no wagmi connection, resetting');
      reset();
    }
  }, [ready, authenticated, wallets, privyAdapter, authSource, setEOAInfo, setLifecycle, chooseAuthSource, reset, wagmiIsConnected]);

  // v1.15.0: wagmi connector 기반 브라우저 지갑 연결
  const connectBrowserWallet = useCallback(async (connector: Connector) => {
    _log('[useConnectionSync] 🔌 connectBrowserWallet called:', connector.name);
    connectingRef.current = true;

    try {
      // 1. wagmi connect
      await coreConnect(wagmiConfig, { connector });

      // 2. WagmiAdapter 생성
      const adapter = new WagmiAdapter(connector, connector.name);

      // 3. provider 추출 — null이면 연결 실패
      const provider = await adapter.getProvider();
      if (!provider) {
        void coreDisconnect(wagmiConfig);
        setEOAInfo(WEB_AUTH_PROVIDER_IDS.BROWSER, {
          eoaAddress: null, adapter: null,
        });
        throw new ContextRequiredError('Failed to get wallet provider. Please try again.');
      }

      // 4. 주소/체인 추출
      const address = adapter.getEOAAddress();
      const account = getAccount(wagmiConfig);
      const chainId = account.chainId ?? null;

      _log('[useConnectionSync] 📋 Browser wallet connection result:', {
        address,
        chainId,
        connectorName: connector.name,
      });

      if (address) {
        chooseAuthSource(AUTH_SOURCES.DIRECT_EOA);
        setWebWalletConnectedChainId(adapter, chainId);
        setEOAInfo(WEB_AUTH_PROVIDER_IDS.BROWSER, {
          eoaAddress: address,
          adapter,
        });
        setLifecycle('connected');
        browserSync.connected(address, chainId);
      }
    } finally {
      connectingRef.current = false;
    }
  }, [chooseAuthSource, setEOAInfo, setLifecycle]);

  // v1.15.0: wagmi → store 자동 동기화 (reconnect, account switch, chain switch, disconnect)
  // window.ethereum event listener 대체
  useEffect(() => {
    // connectBrowserWallet 진행 중에는 skip (중복 방지)
    if (connectingRef.current) return;
    // disconnect 진행 중에는 skip (재연결 방지)
    if (disconnectingRef.current) return;
    // Privy가 활성 소스일 때는 wagmi 동기화 skip
    if (authSource === AUTH_SOURCES.PRIVY_TELEGRAM) return;

    if (wagmiIsConnected && wagmiAddress && activeConnector) {
      // wagmi 연결됨 — store와 동기화
      if (eoaAddress !== wagmiAddress) {
        if (!eoaAddress) {
          // 새 연결 또는 reconnect — 전체 설정
          _log('[useConnectionSync] 🔄 wagmi reconnect/new connection detected:', wagmiAddress);
          const adapter = new WagmiAdapter(activeConnector, activeConnector.name, wagmiChainId ?? null);
          adapter.getProvider().then((provider) => {
            if (!provider) return;
            chooseAuthSource(AUTH_SOURCES.DIRECT_EOA);
            setWebWalletConnectedChainId(adapter, wagmiChainId ?? null);
            setEOAInfo(WEB_AUTH_PROVIDER_IDS.BROWSER, {
              eoaAddress: wagmiAddress,
              adapter,
            });
            setLifecycle('connected');
            browserSync.connected(wagmiAddress, wagmiChainId ?? null);
          }).catch((err) => {
            logger.warn('Wagmi reconnect provider failed', err);
          });
        } else {
          // 계정 변경 (MetaMask 계정 전환)
          _log('[useConnectionSync] 👛 Account changed:', eoaAddress, '→', wagmiAddress);
          browserSync.accountChanged(wagmiAddress);
        }
      }
      // 체인 변경
      if (wagmiChainId && connectedChainId !== wagmiChainId) {
        _log('[useConnectionSync] 🔗 Chain changed:', connectedChainId, '→', wagmiChainId);
        browserSync.chainChanged(wagmiChainId);
      }
    } else if (!wagmiIsConnected && eoaAddress && authSource === AUTH_SOURCES.DIRECT_EOA) {
      // wagmi 연결 해제됨 — store 정리
      _log('[useConnectionSync] 🔌 wagmi disconnected, clearing store');
      const state = useAccountStore.getState();
      if (state.getProviderState(WEB_AUTH_PROVIDER_IDS.BROWSER).wallet.status !== 'connected') return; // 이미 정리됨
      setEOAInfo(WEB_AUTH_PROVIDER_IDS.BROWSER, {
        eoaAddress: null, adapter: null,
      });
      if (state.getProviderState(WEB_AUTH_PROVIDER_IDS.PRIVY).wallet.status === 'connected') {
        chooseAuthSource(AUTH_SOURCES.PRIVY_TELEGRAM);
      } else {
        reset();
      }
    }
  }, [wagmiIsConnected, wagmiAddress, wagmiChainId, activeConnector, authSource, eoaAddress, connectedChainId, chooseAuthSource, setEOAInfo, setLifecycle, reset]);

  // v0.31.0: Auth Source 전환 함수
  const switchToPrivy = useCallback(async () => {
    if (!ready) return;
    if (authenticated) {
      chooseAuthSource(AUTH_SOURCES.PRIVY_TELEGRAM);
    } else {
      try {
        await login({ loginMethods: ['telegram'] });
        chooseAuthSource(AUTH_SOURCES.PRIVY_TELEGRAM);
      } catch (err) { // @ci-exception(no-empty-catch) /* 사용자 취소 또는 실패 — 수동 재시도 가능 */
        logger.error('privy login cancelled or failed', err);
        // 취소 or 실패 → no-op
      }
    }
  }, [ready, authenticated, chooseAuthSource, login]);

  // v1.15.0: switchToBrowser — wagmi 연결이 이미 있으면 authSource만 전환
  const switchToBrowser = useCallback(() => {
    if (!wagmiIsConnected) return;
    chooseAuthSource(AUTH_SOURCES.DIRECT_EOA);
    // wagmi → store 동기화는 위의 useEffect에서 자동 처리
  }, [wagmiIsConnected, chooseAuthSource]);

  // v1.15.0: disconnectDirectEOA — store 즉시 초기화 + wagmi fire-and-forget
  const disconnectDirectEOA = useCallback(() => {
    _log('[useConnectionSync] 🔌 disconnectDirectEOA called');
    // disconnectingRef로 sync effect 재연결 방지
    disconnectingRef.current = true;
    // 1. store 즉시 disconnected (UI 즉시 반영)
    setEOAInfo(WEB_AUTH_PROVIDER_IDS.BROWSER, {
      eoaAddress: null,
      adapter: null,
    });
    // 2. wagmi disconnect fire-and-forget
    void coreDisconnect(wagmiConfig).finally(() => {
      // wagmi 상태 정리 완료 후 flag 해제
      disconnectingRef.current = false;
    });
    // 3. 다른 소스 전환 또는 reset
    const state = useAccountStore.getState();
    if (state.getProviderState(WEB_AUTH_PROVIDER_IDS.PRIVY).wallet.status === 'connected') {
      chooseAuthSource(AUTH_SOURCES.PRIVY_TELEGRAM);
    } else {
      reset();
    }
  }, [setEOAInfo, chooseAuthSource, reset]);

  // v0.32.0: Privy disconnect (변경 없음)
  const disconnectPrivy = useCallback(async () => {
    setEOAInfo(WEB_AUTH_PROVIDER_IDS.PRIVY, {
      eoaAddress: null,
      adapter: null,
    });
    await logout();
    const state = useAccountStore.getState();
    if (state.getProviderState(WEB_AUTH_PROVIDER_IDS.BROWSER).wallet.status === 'connected') {
      chooseAuthSource(AUTH_SOURCES.DIRECT_EOA);
    } else {
      reset();
    }
  }, [setEOAInfo, logout, chooseAuthSource, reset]);

  return {
    // Privy 관련
    ready,
    authenticated,
    identityToken,
    telegramId,
    privyAdapter,
    login,
    logout,

    // 연결 상태
    authSource,
    isDirectEOAAvailable,

    // v1.15.0: wagmi connector 기반 연결
    connectBrowserWallet,
    connectors, // wagmi connectors 목록 (Step 04 UI용)
    disconnectDirectEOA,

    // 하위호환: connectDirectEOA는 제거됨, connectBrowserWallet 사용
    // v0.32.0: Privy disconnect
    disconnectPrivy,

    // v0.31.0: Auth Source 전환
    switchToPrivy,
    switchToBrowser,

    // Chain switching
    isSwitching,
    switchChain,
  };
}
