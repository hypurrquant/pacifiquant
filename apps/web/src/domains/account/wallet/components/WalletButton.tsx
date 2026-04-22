'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { isTelegramMiniApp } from '@/shared/config/environment';
import { useAccountStore, selectActiveAddress } from '@/infra/auth/stores';

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WalletButton() {
  const [isTelegram, setIsTelegram] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const activeAddress = useAccountStore(selectActiveAddress);

  useEffect(() => {
    setIsTelegram(isTelegramMiniApp());
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  if (isTelegram) return null;

  if (!ready) {
    return (
      <div aria-hidden style={{ opacity: 0, pointerEvents: 'none', userSelect: 'none' }}>
        <button className="px-3 py-1.5 sm:px-4 sm:py-2 bg-primary text-black text-xs sm:text-sm font-semibold rounded-lg flex items-center gap-1.5 sm:gap-2">
          <WalletIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span>Connect Wallet</span>
        </button>
      </div>
    );
  }

  const connected = authenticated;
  const displayAddress = activeAddress ?? wallets[0]?.address ?? null;

  if (!connected) {
    return (
      <button
        onClick={() => login()}
        className="px-3 py-1.5 sm:px-4 sm:py-2 bg-primary hover:bg-primary/80 text-black text-xs sm:text-sm font-semibold rounded-lg transition-colors flex items-center gap-1.5 sm:gap-2"
      >
        <WalletIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        <span className="hidden sm:inline">Connect Wallet</span>
        <span className="sm:hidden">Connect</span>
      </button>
    );
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="px-3 py-1.5 md:px-4 md:py-2 bg-dark-700 hover:bg-dark-600 text-white text-xs md:text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 md:gap-2 border border-gray-700"
      >
        <div className="w-2 h-2 bg-brand-400 rounded-full" />
        <span className="font-mono">
          {displayAddress ? shortAddress(displayAddress) : 'Connected'}
        </span>
      </button>
      {menuOpen && (
        <div
          className="absolute right-0 mt-2 w-48 rounded-lg shadow-lg z-50 overflow-hidden"
          style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}
        >
          {displayAddress && (
            <div className="px-3 py-2 text-[11px] font-mono border-b border-gray-800" style={{ color: '#949E9C' }}>
              {displayAddress}
            </div>
          )}
          <button
            onClick={() => {
              setMenuOpen(false);
              void logout();
            }}
            className="w-full text-left px-3 py-2 text-xs text-white hover:bg-[#1a2830] transition-colors"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

interface IconProps {
  className?: string;
}

function WalletIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  );
}
