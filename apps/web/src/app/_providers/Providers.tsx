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

import { QueryProvider } from "./QueryProvider";
import { RpcProvider } from "./RpcProvider";
import { ErrorHandlerInit } from "./ErrorHandlerInit";
import { QueryStoreSync } from "./QueryStoreSync";
import { AgentWalletAutoReset } from "./AgentWalletAutoReset";

initChainConfig({
  HYPERLIQUID: { zeroDevProjectId: process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID_HYPERLIQUID ?? process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID ?? '' },
  BASE: { zeroDevProjectId: process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID_BASE ?? '' },
});

export default function Providers({ children }: PropsWithChildren) {
    return (
        <QueryProvider>
            <WagmiProvider config={wagmiConfig}>
            <RpcProvider>
            <ErrorHandlerInit>
                <QueryStoreSync>
                    <PrivyClientProvider>
                        <AgentWalletAutoReset />
                        {children}
                    </PrivyClientProvider>
                </QueryStoreSync>
            </ErrorHandlerInit>
            </RpcProvider>
            </WagmiProvider>
        </QueryProvider>
    );
}
