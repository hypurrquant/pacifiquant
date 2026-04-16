'use client';

import { useEffect, useCallback } from 'react';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
  allowSkip: boolean;
  skipChecked: boolean;
  onSkipToggle: (skip: boolean) => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  allowSkip,
  skipChecked,
  onSkipToggle,
}: Props) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Enter') onConfirm();
    if (e.key === 'Escape') onCancel();
  }, [open, onConfirm, onCancel]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm mx-4 rounded-xl overflow-hidden"
        style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid #273035' }}
        >
          <span className="text-sm font-semibold text-white">{title}</span>
          <button onClick={onCancel} className="text-gray-400 hover:text-white" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Message body */}
        <div className="px-4 py-4">
          <p className="text-sm text-gray-300">{message}</p>
        </div>

        {/* Footer */}
        <div
          className="px-4 py-3 flex items-center justify-between gap-3"
          style={{ borderTop: '1px solid #273035' }}
        >
          {allowSkip ? (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={skipChecked}
                onChange={(e) => onSkipToggle(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-[#5fd8ee] cursor-pointer"
              />
              <span className="text-xs text-gray-400">Don&apos;t ask again for this session</span>
            </label>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-sm text-gray-400 hover:text-white rounded transition-colors"
              style={{ border: '1px solid #273035' }}
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              className="px-3 py-1.5 text-sm font-medium rounded transition-colors"
              style={{ backgroundColor: '#5fd8ee', color: '#0F1A1E' }}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
