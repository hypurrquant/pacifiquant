// v3.3.5: Toast 상태 관리 Store
// v0.20.10: Toast 디바운싱 기능 추가 (authSlice에서 이관)
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export interface Toast {
    id: string;
    type: 'success' | 'error' | 'warning' | 'info';
    title: string;
    message: string | null;
    duration: number; // ms
}

/** addToast input — message/duration are optional with defaults */
interface AddToastInput {
    type: Toast['type'];
    title: string;
    message?: string | null;
    duration?: number;
}

/**
 * v0.20.10: showWithDebounce 파라미터
 */
interface ShowWithDebounceParams {
    title: string;
    message?: string;
    type?: Toast['type'];
    debounceMs?: number;
}

interface ToastState {
    toasts: Toast[];
    // v0.20.10: 디바운싱용 내부 상태 (authSlice에서 이관)
    lastToastAt: number | null;
    lastToastMessage: string | null;
    addToast: (toast: AddToastInput) => void;
    removeToast: (id: string) => void;
    clearAll: () => void;
    /**
     * v0.20.10: 디바운싱이 적용된 토스트 표시
     * - 동일 메시지는 debounceMs(기본 3초) 내에 중복 표시 안 함
     */
    showWithDebounce: (params: ShowWithDebounceParams) => void;
}

const MAX_TOASTS = 3;
const TOAST_DEBOUNCE_MS = 3000;

export const useToastStore = create<ToastState>()(
    devtools(
        (set, get) => ({
            toasts: [],
            // v0.20.10: 디바운싱용 내부 상태
            lastToastAt: null,
            lastToastMessage: null,

            addToast: (toast) => {
                const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                const newToast: Toast = {
                    id,
                    type: toast.type,
                    title: toast.title,
                    message: toast.message ?? null,
                    duration: toast.duration ?? 5000,
                };

                set(
                    (state) => ({
                        // FIFO: 최대 개수 초과 시 가장 오래된 것 제거
                        toasts: [...state.toasts, newToast].slice(-MAX_TOASTS),
                    }),
                    false,
                    'addToast'
                );

                // 자동 dismiss
                if (newToast.duration && newToast.duration > 0) {
                    setTimeout(() => {
                        set(
                            (state) => ({
                                toasts: state.toasts.filter((t) => t.id !== id),
                            }),
                            false,
                            'autoRemoveToast'
                        );
                    }, newToast.duration);
                }
            },

            removeToast: (id) =>
                set(
                    (state) => ({
                        toasts: state.toasts.filter((t) => t.id !== id),
                    }),
                    false,
                    'removeToast'
                ),

            clearAll: () => set({ toasts: [] }, false, 'clearAll'),

            /**
             * v0.20.10: 디바운싱이 적용된 토스트 표시
             * authSlice의 REQUEST_TOAST 디바운싱 로직을 이관
             */
            showWithDebounce: ({ title, message, type = 'info', debounceMs = TOAST_DEBOUNCE_MS }) => {
                const state = get();
                const now = Date.now();

                // 디바운싱 조건 체크:
                // 1. 처음인 경우 (!lastToastAt)
                // 2. debounceMs 이상 경과한 경우
                // 3. 메시지가 다른 경우
                const canShow =
                    !state.lastToastAt ||
                    now - state.lastToastAt > debounceMs ||
                    state.lastToastMessage !== title;

                if (!canShow) return;

                // 디바운스 상태 업데이트
                set({ lastToastAt: now, lastToastMessage: title }, false, 'toast/debounce');

                // 기존 addToast 재사용 (auto-dismiss 로직 포함)
                get().addToast({ type, title, message });
            },
        }),
        { name: 'ToastStore' }
    )
);





