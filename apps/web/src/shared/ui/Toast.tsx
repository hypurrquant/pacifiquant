// v3.3.5: Toast 컴포넌트
'use client';

import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/shared/utils';
import { Toast as ToastType, useToastStore } from '@/shared/stores/useToastStore';

const variantStyles: Record<ToastType['type'], { bg: string; icon: string }> = {
    error: {
        bg: 'bg-red-900/90 border-red-500/50',
        icon: '✕',
    },
    success: {
        bg: 'bg-green-900/90 border-green-500/50',
        icon: '✓',
    },
    warning: {
        bg: 'bg-yellow-900/90 border-yellow-500/50',
        icon: '⚠',
    },
    info: {
        bg: 'bg-blue-900/90 border-blue-500/50',
        icon: 'ℹ',
    },
};

const iconColors: Record<ToastType['type'], string> = {
    error: 'text-red-400',
    success: 'text-green-400',
    warning: 'text-yellow-400',
    info: 'text-blue-400',
};

interface ToastProps {
    toast: ToastType;
}

export const Toast = forwardRef<HTMLDivElement, ToastProps>(function Toast({ toast }, ref) {
    const removeToast = useToastStore((state) => state.removeToast);
    const style = variantStyles[toast.type];

    return (
        <motion.div
            ref={ref}
            layout
            initial={{ opacity: 0, x: 100, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className={cn(
                'relative flex items-start gap-3 rounded-lg border p-4 shadow-lg backdrop-blur-sm',
                'min-w-[300px] max-w-[400px]',
                style.bg
            )}
        >
            {/* Icon */}
            <span className={cn('text-base md:text-lg font-bold', iconColors[toast.type])}>
                {style.icon}
            </span>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-white">
                    {toast.title}
                </h4>
                {toast.message && (
                    <p className="mt-1 text-xs text-gray-300 break-words">
                        {toast.message}
                    </p>
                )}
            </div>

            {/* Close button */}
            <button
                onClick={() => removeToast(toast.id)}
                className="text-gray-400 hover:text-lime transition-colors"
                aria-label="Dismiss"
            >
                <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                    />
                </svg>
            </button>
        </motion.div>
    );
});
