import type { PerpAccountState, SpotBalance } from '@hq/core/defi/perp';

export interface HyperliquidUsdcSummary {
  readonly totalEquityUsd: number;
  readonly availableUsd: number;
  readonly spotUsdcTotal: number;
  readonly spotUsdcAvailable: number;
  readonly nonUsdcSpotBalances: readonly SpotBalance[];
}

export function getHyperliquidUsdcSummary(
  accountState: PerpAccountState,
  spotBalances: readonly SpotBalance[],
): HyperliquidUsdcSummary {
  const spotUsdc = spotBalances.find((balance) => balance.coin === 'USDC') ?? null;
  const spotUsdcTotal = spotUsdc ? parseFloat(spotUsdc.total) : 0;
  const spotUsdcHold = spotUsdc ? parseFloat(spotUsdc.hold) : 0;
  const spotUsdcAvailable = Math.max(0, spotUsdcTotal - spotUsdcHold);
  const nonUsdcSpotBalances = spotBalances.filter(
    (balance) => balance.coin !== 'USDC' && parseFloat(balance.total) > 0,
  );

  return {
    totalEquityUsd: accountState.totalEquity + spotUsdcTotal,
    availableUsd: accountState.availableBalance + spotUsdcAvailable,
    spotUsdcTotal,
    spotUsdcAvailable,
    nonUsdcSpotBalances,
  };
}
