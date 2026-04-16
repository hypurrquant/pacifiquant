"use client";

import React, { PropsWithChildren, useEffect } from "react";
import { setRpcProvider } from '@hq/core/lib/rpc/provider';
import { CHAIN_RPC_ENDPOINTS } from '@hq/core/config/constants';
import { PerChainRoundRobinProvider } from '@/infra/lib/rpc/round-robin-provider';

/**
 * RPC Provider Initializer
 * v1.10.0: per-chain round-robin public RPC rotation
 * v1.28.8: Providers.tsx에서 분리
 * v1.28.9: 하드코딩 URL → CHAIN_RPC_ENDPOINTS SSOT
 */
export function RpcProvider({ children }: PropsWithChildren) {
    useEffect(() => {
        setRpcProvider(
            new PerChainRoundRobinProvider({
                chains: CHAIN_RPC_ENDPOINTS,
            }),
        );
    }, []);
    return <>{children}</>;
}
