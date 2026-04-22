'use client';

import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/shared/utils';
import { Toast as ToastType, useToastStore } from '@/shared/stores/useToastStore';

// Pacifica brand accent: #AB9FF2. Toasts use a shared dark surface +
// Pacifica-tinted border, with a status-colored accent bar on the left and
// matching icon badge so error/success/warning/info stay recognizable.
type Variant = ToastType['type'];

interface VariantStyle {
    accent: string;       // left bar + icon bg
    iconColor: string;    // icon stroke color
    Icon: (props: { className?: string }) => JSX.Element;
}

const CheckIcon = ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
);
const XIcon = ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
);
const WarnIcon = ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
);
const InfoIcon = ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const variantStyles: Record<Variant, VariantStyle> = {
    error:   { accent: '#ED7088',      iconColor: '#ED7088',      Icon: XIcon },
    success: { accent: '#AB9FF2',      iconColor: '#AB9FF2',      Icon: CheckIcon },
    warning: { accent: '#F9C27B',      iconColor: '#F9C27B',      Icon: WarnIcon },
    info:    { accent: '#AB9FF2',      iconColor: '#AB9FF2',      Icon: InfoIcon },
};

interface ToastProps {
    toast: ToastType;
}

export const Toast = forwardRef<HTMLDivElement, ToastProps>(function Toast({ toast }, ref) {
    const removeToast = useToastStore((state) => state.removeToast);
    const style = variantStyles[toast.type];
    const { Icon } = style;
    const hasMessage = Boolean(toast.message);

    return (
        <motion.div
            ref={ref}
            layout
            initial={{ opacity: 0, x: 100, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className={cn(
                'relative overflow-hidden rounded-lg shadow-lg backdrop-blur-md',
                'min-w-[320px] max-w-[420px]',
            )}
            style={{
                backgroundColor: 'rgba(15, 26, 31, 0.95)',
                border: '1px solid #273035',
            }}
        >
            {/* Left status accent bar */}
            <div
                className="absolute top-0 bottom-0 left-0 w-[3px]"
                style={{ backgroundColor: style.accent }}
                aria-hidden
            />

            <div
                className={cn(
                    'flex gap-3 pl-4 pr-3 py-3',
                    hasMessage ? 'items-start' : 'items-center',
                )}
            >
                {/* Icon badge — matches status accent */}
                <div
                    className="flex-shrink-0 flex items-center justify-center rounded-full w-7 h-7"
                    style={{
                        backgroundColor: `${style.accent}1F`,
                        color: style.iconColor,
                    }}
                    aria-hidden
                >
                    <Icon className="w-4 h-4" />
                </div>

                {/* Content */}
                <div className={cn('flex-1 min-w-0', hasMessage ? 'pt-0.5' : '')}>
                    <h4 className="text-sm font-semibold text-white leading-tight">
                        {toast.title}
                    </h4>
                    {hasMessage && (
                        <p className="mt-1 text-xs leading-relaxed break-words" style={{ color: '#949E9C' }}>
                            {toast.message}
                        </p>
                    )}
                </div>

                {/* Close button — vertically aligned with title row */}
                <button
                    onClick={() => removeToast(toast.id)}
                    className={cn(
                        'flex-shrink-0 flex items-center justify-center rounded w-6 h-6 transition-colors',
                        hasMessage ? '-mr-1' : '',
                    )}
                    style={{ color: '#5a6469' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#ffffff'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#5a6469'; }}
                    aria-label="Dismiss"
                >
                    <XIcon className="w-3.5 h-3.5" />
                </button>
            </div>
        </motion.div>
    );
});
