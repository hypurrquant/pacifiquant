"use client";

import React, { PropsWithChildren, useEffect, useRef } from "react";
import { useStoreQuerySync } from "@/shared/lib/react-query/storeSync";
import { useAccountStore, selectActiveAddress } from "@/infra/auth/stores";
import type { ExecutionMode } from "@hq/core/auth";
import { runAccountContextResets } from "@/shared/lib/accountContextResetRegistry";
import { useTokenBalanceStore } from "@/shared/stores/useTokenBalanceStore";
import { storeEvents } from "@/infra/lib/eventBus";

/**
 * Store-Query Sync Wrapper
 * v1.28.8: Providers.tsx에서 분리
 */
export function QueryStoreSync({ children }: PropsWithChildren) {
    useStoreQuerySync();

    // v0.38.2: 계정 컨텍스트 변경 감지
    const activeAddress = useAccountStore(selectActiveAddress);
    const executionMode = useAccountStore((s) => s.getActiveAccount().executionMode);
    const prevRef = useRef<{ activeAddress: string | null; executionMode: ExecutionMode } | undefined>(undefined);
    useEffect(() => {
        const prev = prevRef.current;
        prevRef.current = { activeAddress, executionMode };
        if (prev === undefined) return;
        if (prev.activeAddress !== activeAddress) {
            runAccountContextResets('address_changed');
        }
        if (prev.executionMode !== executionMode) {
            runAccountContextResets('mode_changed');
        }
    }, [activeAddress, executionMode]);

    // v0.43.2: balance store clear on disconnect
    useEffect(() => {
        const unsub = storeEvents.on('wallet:disconnected', () => {
            useTokenBalanceStore.getState().clear();
        });
        return () => { unsub(); };
    }, []);

    return <>{children}</>;
}
