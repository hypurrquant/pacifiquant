"use client";

/**
 * Global Provider Wrapper
 * v1.28.8: 역할별 sub-provider로 분리, 조합만 수행
 */

import React, { PropsWithChildren } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/infra/lib/wagmi/config";
import { PrivyClientProvider } from "@/shared/auth/providers";
import { initChainConfig } from '@hq/core/config/chains';
import { loadWasm } from '@/infra/lib/wasm-crypto';

import { QueryProvider } from "./QueryProvider";
import { RpcProvider } from "./RpcProvider";
import { ErrorHandlerInit } from "./ErrorHandlerInit";
import { QueryStoreSync } from "./QueryStoreSync";

// v1.28.7: core env DI — 앱 부트스트랩
initChainConfig({
  HYPERLIQUID: { zeroDevProjectId: process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID_HYPERLIQUID ?? process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID ?? '' },
  BASE: { zeroDevProjectId: process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID_BASE ?? '' },
});

// v1.46.16: WASM crypto 사전 로드 (비차단, 네트워크 불필요)
void loadWasm().catch((e) => {
    console.error('[Providers] WASM crypto load failed:', e);
});

export default function Providers({ children }: PropsWithChildren) {
    return (
        <QueryProvider>
            <WagmiProvider config={wagmiConfig}>
            <RpcProvider>
            <ErrorHandlerInit>
                <QueryStoreSync>
                    <PrivyClientProvider>
                        {children}
                    </PrivyClientProvider>
                </QueryStoreSync>
            </ErrorHandlerInit>
            </RpcProvider>
            </WagmiProvider>
        </QueryProvider>
    );
}
