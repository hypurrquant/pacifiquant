// v3.3.5: Toast 렌더링 컨테이너
'use client';

import { AnimatePresence } from 'framer-motion';
import { useToastStore } from '@/shared/stores/useToastStore';
import { Toast } from './Toast';

export function ToastContainer() {
    const toasts = useToastStore((state) => state.toasts);

    return (
        <div
            className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
            aria-live="polite"
            aria-label="Notifications"
        >
            <AnimatePresence mode="popLayout">
                {toasts.map((toast) => (
                    <Toast key={toast.id} toast={toast} />
                ))}
            </AnimatePresence>
        </div>
    );
}
