/**
 * Per-DEX capability registry — SSOT for protocol-level behavior that the
 * UI layer needs to branch on.
 *
 * Previously scattered as `dexId === 'hyperliquid' ? false : 5_000`
 * ternaries across `usePerpData.ts` and `useRealtimeData.ts`. The ternaries
 * encoded one real fact: HL publishes user-data WS channels, others don't.
 * That fact belongs here, once, so a 5th DEX only needs to fill in one row.
 *
 * Consumer contract:
 *   `pollUserDataMs === null` → DEX pushes user data over WS; React Query
 *     should NOT refetch on an interval (`refetchInterval: false`).
 *   `pollUserDataMs === 5_000` → DEX has no user-data WS; poll REST every 5s.
 */

import type { PerpDexId } from '../types/perp.types';

export interface DexCapabilities {
  readonly id: PerpDexId;
  /** Does this DEX's WS publish user-data channels (accountState, openOrders,
   *  fills, funding, historicalOrders)? HL: yes; Pacifica/Lighter/Aster: no. */
  readonly hasUserDataWs: boolean;
  /** Does this DEX's WS publish market-data channels (orderbook, trades,
   *  candles)? HL: yes; Pacifica: yes (book/trades/candle); Lighter: partial
   *  (channels exist but candles don't stream reliably); Aster: no WS. */
  readonly hasMarketDataWs: boolean;
  /** React Query `refetchInterval` for FAST user-data queries — account state,
   *  positions, open orders. `null` = WS-driven, no polling. */
  readonly pollFastUserDataMs: number | null;
  /** React Query `refetchInterval` for SLOW user-data queries — fills,
   *  funding history, order history. */
  readonly pollSlowUserDataMs: number | null;
  /** React Query `refetchInterval` for market-data queries — orderbook,
   *  recent trades, candles. `null` = WS-driven. Non-HL venues that lack
   *  a reliable WS market feed need this to keep the chart/orderbook from
   *  freezing after the initial fetch. */
  readonly pollMarketDataMs: number | null;
}

const FAST_POLL_MS = 5_000;
const SLOW_POLL_MS = 15_000;
const MARKET_POLL_MS = 3_000;

export const DEX_CAPABILITIES: Readonly<Record<PerpDexId, DexCapabilities>> = {
  hyperliquid: { id: 'hyperliquid', hasUserDataWs: true,  hasMarketDataWs: true,  pollFastUserDataMs: null,         pollSlowUserDataMs: null,         pollMarketDataMs: null           },
  pacifica:    { id: 'pacifica',    hasUserDataWs: true,  hasMarketDataWs: true,  pollFastUserDataMs: null,         pollSlowUserDataMs: SLOW_POLL_MS, pollMarketDataMs: null           },
  // Lighter WS accepts orderbook/trades subscriptions but doesn't stream
  // candles — poll to keep the chart live.
  lighter:     { id: 'lighter',     hasUserDataWs: false, hasMarketDataWs: false, pollFastUserDataMs: FAST_POLL_MS, pollSlowUserDataMs: SLOW_POLL_MS, pollMarketDataMs: MARKET_POLL_MS },
  // Aster WS (fstream.asterdex.com) isn't wired — REST polling for all
  // market + user data.
  aster:       { id: 'aster',       hasUserDataWs: false, hasMarketDataWs: false, pollFastUserDataMs: FAST_POLL_MS, pollSlowUserDataMs: SLOW_POLL_MS, pollMarketDataMs: MARKET_POLL_MS },
};

/** React Query `refetchInterval` for fast-moving fields (account/positions/openOrders). */
export function userDataRefetchInterval(dexId: PerpDexId): number | false {
  return DEX_CAPABILITIES[dexId].pollFastUserDataMs ?? false;
}

/** React Query `refetchInterval` for slow-moving fields (fills/funding/orderHistory). */
export function slowUserDataRefetchInterval(dexId: PerpDexId): number | false {
  return DEX_CAPABILITIES[dexId].pollSlowUserDataMs ?? false;
}

/** React Query `refetchInterval` for market data (orderbook/trades/candles)
 *  when the adapter lacks a reliable WS feed for that channel. */
export function marketDataRefetchInterval(dexId: PerpDexId): number | false {
  return DEX_CAPABILITIES[dexId].pollMarketDataMs ?? false;
}
