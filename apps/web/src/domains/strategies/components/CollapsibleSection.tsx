'use client';

/**
 * CollapsibleSection — generic accordion wrapper.
 *
 * Used on the Strategies page to hide low-attention surfaces (Market Intel,
 * funding charts, scanner tables) behind a single click so the primary
 * Vault Picker stays the visual hero.
 */

import { useState, type ReactNode } from 'react';

interface Props {
  readonly title: string;
  readonly subtitle?: string;
  readonly badge?: string;
  readonly accent?: string;
  /** If true, starts expanded on mount. Defaults to false. */
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
}

export function CollapsibleSection({
  title,
  subtitle,
  badge,
  accent = '#949E9C',
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#162027] transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {badge && (
            <span
              className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
              style={{ color: accent, backgroundColor: `${accent}1A` }}
            >
              {badge}
            </span>
          )}
          <div className="min-w-0 text-left">
            <h2 className="text-sm font-semibold text-white truncate">{title}</h2>
            {subtitle && (
              <p className="text-xs mt-0.5 truncate" style={{ color: '#949E9C' }}>{subtitle}</p>
            )}
          </div>
        </div>
        <svg
          className="flex-shrink-0 transition-transform"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)', color: '#949E9C' }}
        >
          <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid #273035' }}>
          {children}
        </div>
      )}
    </div>
  );
}
