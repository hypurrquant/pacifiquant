// core/auth/providers/PrivyClientProvider.tsx
// v1.4.0: core 레이어로 이동, useBackendRegistration → 이벤트 패턴

'use client';

// eslint-disable-next-line @typescript-eslint/no-empty-function
const _log: typeof console.log = () => {}; // auth debug: console.log로 교체하면 활성화

import { PropsWithChildren, useEffect, useRef } from 'react';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { useConnectionSync } from '../hooks';
import { useAccountStore, selectEOAAddress, selectWalletAdapter, selectAAAddress } from '@/infra/auth/stores';
import { storeEvents } from '@/infra/lib/eventBus';
import { createLogger } from '@hq/core/logging';
import { FEATURES } from '@hq/core/config/features';
// v0.12.6: Privy 초기화 타임아웃 (ms)
const PRIVY_INIT_TIMEOUT = 5000;

const logger = createLogger('PrivyClientProvider');

// Telegram WebApp 타입 선언

interface TelegramUserAttributes {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
}

interface TelegramWebAppAttributes {
    initData?: string;
    initDataUnsafe?: {
        user?: TelegramUserAttributes;
    };
    ready: () => void;
    close: () => void;
}

interface TelegramAttributes {
    WebApp?: TelegramWebAppAttributes;
}

declare global {
    interface Window {
        Telegram?: TelegramAttributes; // @ci-exception(no-optional-without-default) — external browser API (may not exist)
    }
}

/**
 * Privy 백그라운드 초기화
 * - children을 즉시 렌더링, Privy는 백그라운드에서 초기화
 * - v0.12.6: 타임아웃 후 init_timeout 발행 (Direct EOA fallback)
 */
function PrivyBackgroundInit({ children }: PropsWithChildren) {
    const { ready } = usePrivy();
    const privy = useAccountStore((s) => s.privy);
    const privyFailed = privy.status === 'failed';
    const syncPrivyState = useAccountStore((s) => s.syncPrivyState);

    // 타임아웃 처리 — ready가 안 되면 init_timeout 발행
    useEffect(() => {
        if (ready) return;

        const timer = setTimeout(() => {
            logger.warn(`Privy initialization timed out after ${PRIVY_INIT_TIMEOUT}ms`);
            syncPrivyState({ kind: 'init_timeout' });
        }, PRIVY_INIT_TIMEOUT);

        return () => clearTimeout(timer);
    }, [ready, syncPrivyState]);

    // Privy가 timeout 후 늦게 ready되면 상태 리셋
    useEffect(() => {
        if (ready && privyFailed) {
            syncPrivyState({ kind: 'sdk_snapshot', ready: true, authenticated: false });
        }
    }, [ready, privyFailed, syncPrivyState]);

    return <>{children}</>;
}

/**
 * Telegram Mini App 자동 로그인 컴포넌트
 * - Telegram Mini App 환경에서 자동으로 Privy Telegram 로그인 트리거
 */
function TelegramAutoLogin({ children }: PropsWithChildren) {
    const { ready, authenticated, login } = usePrivy();
    const hasCheckedRef = useRef(false);
    const hasLoggedMountRef = useRef(false);
    const hasLoggedWaitingRef = useRef(false);

    _log('[TelegramAutoLogin] Render:', { ready, authenticated });

    useEffect(() => {
        // 마운트 로그 (1회만)
        if (!hasLoggedMountRef.current) {
            hasLoggedMountRef.current = true;
            _log('[TelegramAutoLogin] 🚀 Mounted - ready:', ready, ', authenticated:', authenticated);
            logger.info(`[TelegramAutoLogin] Mounted - ready: ${ready}, authenticated: ${authenticated}`);
        }

        // 이미 체크했으면 스킵
        if (hasCheckedRef.current) return;

        // Privy 준비 안됨 (로그도 1회만)
        if (!ready) {
            if (!hasLoggedWaitingRef.current) {
                hasLoggedWaitingRef.current = true;
                logger.info('[TelegramAutoLogin] Waiting for Privy...');
            }
            return;
        }

        // 1회 체크 완료 표시
        hasCheckedRef.current = true;

        // 이미 로그인됨
        if (authenticated) {
            logger.info('[TelegramAutoLogin] Already authenticated');
            return;
        }

        // Telegram 환경 체크
        const hasTelegram = typeof window !== 'undefined' && !!window.Telegram;
        const hasWebApp = hasTelegram && !!window.Telegram?.WebApp;
        const hasInitData = hasWebApp && !!window.Telegram?.WebApp?.initData;

        logger.info(`[TelegramAutoLogin] Check - Telegram: ${hasTelegram}, WebApp: ${hasWebApp}, initData: ${hasInitData}`);

        if (!hasInitData) {
            logger.info('[TelegramAutoLogin] Not Telegram Mini App');
            return;
        }

        // Telegram Mini App 자동 로그인
        logger.info('[TelegramAutoLogin] Auto-login starting...');
        window.Telegram?.WebApp?.ready();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window.Telegram?.WebApp as any)?.setHeaderColor?.('#070c0f'); // @ci-exception(no-type-assertion)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window.Telegram?.WebApp as any)?.setBackgroundColor?.('#0b1114'); // @ci-exception(no-type-assertion)

        try {
            login({ loginMethods: ['telegram'] });
            logger.info('[TelegramAutoLogin] login() called');
        } catch (err: any) { // @ci-exception(no-empty-catch) /* auto-login 실패 — 수동 로그인 가능 */
            logger.error(`[TelegramAutoLogin] Error: ${err?.message || err}`);
        }
    }, [ready, authenticated, login]);

    return <>{children}</>;
}

/**
 * Privy 상태 동기화 및 AA 초기화 컴포넌트
 * - useConnectionSync로 Privy 상태를 Zustand Store에 동기화
 * - 로그인 완료 시 Store의 initializeAA 직접 호출 (v0.12.7: SSOT)
 * - v1.4.0: useBackendRegistration 대신 이벤트 발행
 */
function PrivySyncBridge({ children }: PropsWithChildren) {
    const { ready, authenticated, identityToken } = useConnectionSync();

    // Account Store (v0.12.7: SSOT - useKernelAccount 제거)
    // v0.20.6: aaAddress는 kernelAccount에서 파생 (SSOT)
    const eoaAddress = useAccountStore(selectEOAAddress);
    const aaAddress = useAccountStore(selectAAAddress);
    // v0.20.14: initializeAA → initializeAAWithSigner 마이그레이션
    const adapter = useAccountStore(selectWalletAdapter);
    const initializeAAWithSigner = useAccountStore((s) => s.initializeAAWithSigner);

    _log('[PrivySyncBridge] Render:', {
        ready,
        authenticated,
        hasIdentityToken: !!identityToken,
        hasAdapter: !!adapter,
        aaAddress,
        AA_ENABLED: FEATURES.AA_ENABLED,
    });

    // v0.12.7: Window event listener (FN-4 fix - SmartAccountProvider에서 이동)
    // v0.20.14: initializeAA → initializeAAWithSigner 마이그레이션
    useEffect(() => {
        if (!FEATURES.AA_ENABLED) return;

        const handler = (e: Event) => {
            if (!(e instanceof CustomEvent)) return;
            const { idToken, autoDeploy } = e.detail;
            _log('[PrivySyncBridge] 📡 Received aa:link-or-fetch event');
            if (!adapter) {
                logger.error('[PrivySyncBridge] Missing adapter for aa:link-or-fetch');
                return;
            }
            void initializeAAWithSigner(adapter, { idToken, autoDeploy });
        };

        window.addEventListener('aa:link-or-fetch', handler);
        return () => window.removeEventListener('aa:link-or-fetch', handler);
    }, [adapter, initializeAAWithSigner]);

    // v0.13.0 (P0-3): AA 초기화 - 조건 판단은 initializeAAWithSigner 내부로 이동
    // v0.20.14: initializeAA → initializeAAWithSigner 마이그레이션
    useEffect(() => {
        _log('[PrivySyncBridge] AA init effect triggered:', {
            ready,
            authenticated,
            hasIdentityToken: !!identityToken,
            hasAdapter: !!adapter,
            hasEoaAddress: !!eoaAddress,
            aaAddress,
            AA_ENABLED: FEATURES.AA_ENABLED,
        });

        // strict: adapter 없으면 초기화 스킵 (에러 로그)
        if (!adapter) {
            logger.error('[PrivySyncBridge] Missing adapter for AA init (strict mode)');
            return;
        }
        initializeAAWithSigner(adapter, { idToken: identityToken ?? undefined });
    }, [ready, authenticated, identityToken, adapter, eoaAddress, aaAddress, initializeAAWithSigner]); // FN-3: 의존성 유지

    // v0.13.0 (P0-3 FN-2): auth:authenticated 이벤트 분리 (AA 초기화와 무관하게 발행)
    useEffect(() => {
        if (ready && authenticated) {
            _log('[PrivySyncBridge] 📡 Emitting auth:authenticated event');
            storeEvents.emit('auth:authenticated');
        }
    }, [ready, authenticated]);

    return <>{children}</>;
}

/**
 * Privy Provider Wrapper
 * - Privy 인증 설정 (Telegram + WalletConnect 로그인, embedded wallet)
 * - TelegramAutoLogin으로 Mini App 자동 로그인
 * - PrivySyncBridge로 상태 동기화
 */
export default function PrivyClientProvider({ children }: PropsWithChildren) {
    const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? 'cmm8vjkbf017v0cjojumw07wk';

    if (!appId) {
        return <>{children}</>;
    }

    // v0.12.6: Debug logging
    _log('[PrivyClientProvider] 🚀 Component rendering, appId:', appId.slice(0, 10) + '...');

    return (
        <PrivyProvider
            appId={appId}
            config={{
                embeddedWallets: { ethereum: { createOnLogin: 'all-users' } },
                // v0.6.4: Telegram + WalletConnect 둘 다 지원
                // Telegram Mini App에서는 TelegramAutoLogin이 telegram만 사용
                // Web에서는 WalletButton이 wallet 옵션 제공
                loginMethods: ['telegram', 'wallet'],
                appearance: {
                    walletList: [
                        'detected_ethereum_wallets',
                        'metamask',
                        'coinbase_wallet',
                        'rainbow',
                        'wallet_connect',
                    ],
                },
            }}
        >
            <PrivyBackgroundInit>
                <TelegramAutoLogin>
                    <PrivySyncBridge>{children}</PrivySyncBridge>
                </TelegramAutoLogin>
            </PrivyBackgroundInit>
        </PrivyProvider>
    );
}
