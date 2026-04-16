// lib/environment.ts
// 환경 감지 유틸리티

/**
 * Telegram Mini App 환경인지 확인
 * - window.Telegram.WebApp.initData가 있으면 Telegram Mini App
 */
export function isTelegramMiniApp(): boolean {
  if (typeof window === 'undefined') return false;

  const hasTelegram = !!window.Telegram;
  const hasWebApp = hasTelegram && !!window.Telegram?.WebApp;
  const hasInitData = hasWebApp && !!window.Telegram?.WebApp?.initData;

  return hasInitData;
}

