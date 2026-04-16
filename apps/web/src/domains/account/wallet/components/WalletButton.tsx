'use client';

// components/WalletButton.tsx
// v1.51.0: RainbowKit ConnectButton.Custom — 기존 헤더 스타일 유지, 모달만 RainbowKit 사용

import React, { useState, useEffect } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { isTelegramMiniApp } from '@/shared/config/environment';

/**
 * WalletButton - Header용 지갑 연결 버튼
 *
 * v1.51.0: RainbowKit ConnectButton.Custom
 * - 연결 모달: RainbowKit 제공
 * - 버튼/드롭다운 UI: 기존 헤더 스타일 유지
 * - Telegram Mini App: 숨김 (TelegramAutoLogin이 자동 처리)
 */
export function WalletButton() {
  const [isTelegram, setIsTelegram] = useState(true);

  useEffect(() => {
    setIsTelegram(isTelegramMiniApp());
  }, []);

  // Telegram Mini App에서는 숨김
  if (isTelegram) return null;

  return (
    <ConnectButton.Custom>
      {({ account, chain, openConnectModal, openAccountModal, openChainModal, mounted }) => {
        const connected = mounted && account && chain;

        return (
          <div
            {...(!mounted && {
              'aria-hidden': true,
              style: { opacity: 0, pointerEvents: 'none', userSelect: 'none' },
            })}
          >
            {!connected ? (
              <button
                onClick={openConnectModal}
                className="px-3 py-1.5 sm:px-4 sm:py-2 bg-primary hover:bg-primary/80 text-black text-xs sm:text-sm font-semibold rounded-lg transition-colors flex items-center gap-1.5 sm:gap-2"
              >
                <WalletIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">Connect Wallet</span>
                <span className="sm:hidden">Connect</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                {chain.unsupported && (
                  <button
                    onClick={openChainModal}
                    className="px-3 py-1.5 bg-red-900/50 border border-red-700 text-red-400 text-xs rounded-lg"
                  >
                    Wrong Network
                  </button>
                )}
                <button
                  onClick={openAccountModal}
                  className="px-3 py-1.5 md:px-4 md:py-2 bg-dark-700 hover:bg-dark-600 text-white text-xs md:text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 md:gap-2 border border-gray-700"
                >
                  <div className="w-2 h-2 bg-brand-400 rounded-full" />
                  <span className="font-mono">{account.displayName}</span>
                  {account.displayBalance && (
                    <span className="text-gray-400 hidden sm:inline text-xs">
                      {account.displayBalance}
                    </span>
                  )}
                </button>
              </div>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

// Icons
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
