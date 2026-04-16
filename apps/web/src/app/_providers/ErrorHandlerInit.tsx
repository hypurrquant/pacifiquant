"use client";

import React, { PropsWithChildren, useEffect } from "react";
import { setToastHandler } from '@/infra/lib/toastHandler';
import { setErrorPresenter } from '@hq/core/lib/error';
import { webErrorPresenter } from '@/infra/lib/webErrorPresenter';
import { useToastStore } from "@/shared/stores/useToastStore";

/**
 * ErrorPresenter + ToastHandler Initializer
 * core → shared 간접 연결 (DI 패턴)
 * v1.28.8: Providers.tsx에서 분리
 * v1.39.0: setErrorHandler 제거 — 에러 toast는 presentError 경로만
 */
export function ErrorHandlerInit({ children }: PropsWithChildren) {
    useEffect(() => {
        setErrorPresenter(webErrorPresenter);
        setToastHandler((params) => {
            useToastStore.getState().showWithDebounce(params);
        });
    }, []);
    return <>{children}</>;
}
