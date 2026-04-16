import { AUTH_SOURCES, type AuthSourceProviderMap } from '@hq/core/auth';

export const WEB_AUTH_PROVIDER_IDS = {
  PRIVY: 'privy',
  BROWSER: 'browser',
} as const;

export const WEB_AUTH_SOURCE_PROVIDER_IDS: AuthSourceProviderMap = {
  [AUTH_SOURCES.PRIVY_TELEGRAM]: WEB_AUTH_PROVIDER_IDS.PRIVY,
  [AUTH_SOURCES.DIRECT_EOA]: WEB_AUTH_PROVIDER_IDS.BROWSER,
};
