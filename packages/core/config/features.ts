// config/features.ts
// v0.10.5: Feature Flags for kill switch patterns
// v0.25.8: USE_SDK, SDK_DEBUG 제거 — SDK가 유일한 코드 경로

/**
 * Feature flags for enabling/disabling features globally.
 *
 * Usage:
 * - Set NEXT_PUBLIC_AA_ENABLED=false to disable AA features
 *
 * @example
 * // In component:
 * import { FEATURES } from '@/config/features';
 * if (!FEATURES.AA_ENABLED) return <AAFeatureDisabled />;
 */
export const FEATURES = {
  /**
   * Account Abstraction kill switch.
   * When false:
   * - ExecutionModeSelector hides AA option
   * - AAModeRequired shows "Feature Unavailable"
   * - useTxExecutor returns only EOATxExecutor
   * - AppHeader hides AA address info
   */
  AA_ENABLED: process.env.NEXT_PUBLIC_AA_ENABLED !== 'false', // @ci-exception(core-no-next-env) — web-only config, server 미사용. 향후 DI 전환 예정
} as const;

