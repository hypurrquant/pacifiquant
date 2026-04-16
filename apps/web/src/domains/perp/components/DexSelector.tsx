'use client';

import { useState, useRef, useEffect } from 'react';
import { usePerpStore } from '../stores/usePerpStore';
import { PERP_DEX_LIST } from '@/shared/config/perp-dex-display';

const DEXES = PERP_DEX_LIST.map(m => ({ ...m, active: true }));

export function DexSelector() {
  const selectedDex = usePerpStore(s => s.selectedDex);
  const setSelectedDex = usePerpStore(s => s.setSelectedDex);
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = DEXES.find(d => d.id === selectedDex) ?? DEXES[0];

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white rounded-md hover:bg-[#1a2830] transition-colors"
        style={{ border: '1px solid #273035' }}
      >
        <img src={current.logo} alt={current.name} className="w-4 h-4 rounded-full" />
        {current.name}
        <svg className={`w-2.5 h-2.5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-full mt-1 py-1 z-50 min-w-[180px] rounded-md shadow-xl"
          style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}
        >
          {DEXES.map(dex => (
            <button
              key={dex.id}
              disabled={!dex.active}
              onClick={() => {
                if (dex.active) {
                  setSelectedDex(dex.id);
                  setIsOpen(false);
                }
              }}
              className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                dex.active
                  ? dex.id === selectedDex
                    ? 'text-white bg-[#1a2830]'
                    : 'text-white hover:bg-[#1a2830]'
                  : 'text-gray-600 cursor-not-allowed'
              }`}
            >
              <span className="flex items-center gap-2">
                <img src={dex.logo} alt={dex.name} className="w-4 h-4 rounded-full" />
                {dex.name}
              </span>
              {!dex.active && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">Soon</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
