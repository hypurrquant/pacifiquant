'use client';

/**
 * Cross-DEX Funding Rate Scanner — compare rates across Hyperliquid, Pacifica, Lighter.
 *
 * Fetches funding rates from all 3 DEX adapters in parallel using Promise.allSettled,
 * normalizes them to hourly rates, and highlights arbitrage opportunities.
 * Profitable rows (spread > 10% APR) show an "Arb" button to execute cross-DEX arb.
 */

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { FundingHistoryDrillDown } from './FundingHistoryDrillDown';
import {
  HyperliquidPerpAdapter,
  PacificaPerpAdapter,
  LighterPerpAdapter,
  AsterPerpAdapter,
  toHourlyRate,
  annualizeRate,
  computeSpread,
  executeFundingArb,
} from '@hq/core/defi/perp';
import type { PerpMarket, FundingExchange, FundingArbOpportunity } from '@hq/core/defi/perp';
import { createLogger } from '@hq/core/logging';
import { formatCurrency } from '@/shared/formatters/number.formatter';
import { usePerpDeps } from '@/domains/perp/providers/PerpDepsProvider';
import { getAdapterByDex } from '@/domains/perp/hooks/usePerpAdapter';
import { useAgentWalletStore, selectIsAgentActive } from '@/domains/perp/stores/useAgentWalletStore';
import { useStrategyExchangeAccounts } from '../hooks/useStrategyExchangeAccounts';

const log = createLogger('FundingArbScanner');

// ── Adapter singletons ──

const hlAdapter = new HyperliquidPerpAdapter();
const pacAdapter = new PacificaPerpAdapter();
const ltAdapter = new LighterPerpAdapter();
const asterAdapter = new AsterPerpAdapter();

// ── Types ──

interface ExchangeRate {
  readonly exchange: FundingExchange;
  readonly rate: number;        // raw rate from API
  readonly hourlyRate: number;  // normalized
  readonly annualized: number;  // percentage
}

interface SymbolRow {
  readonly symbol: string;
  readonly rates: Record<FundingExchange, ExchangeRate | null>;
  readonly opportunity: FundingArbOpportunity | null;
  readonly markPrice: number | null;
}

interface ArbModalState {
  readonly symbol: string;
  readonly longExchange: FundingExchange;
  readonly shortExchange: FundingExchange;
  readonly spreadHourly: number;
  readonly spreadAnnualized: number;
  readonly markPrice: number;
}

interface ArbBalanceLimit {
  readonly longAvailableUsd: number;
  readonly shortAvailableUsd: number;
  readonly maxSizeUsd: number;
  readonly limitingExchange: FundingExchange;
}

// ── Persistence tracking ──
// The user's ask: "순간적으로 벌어진 스프레드가 중요한게 아니라 그 스프레드가
// 얼마나 유지되었는지 확인하는게 중요한거야." A transient 30% APR spread that
// snaps back to 2% in 90s is dangerous — the arb round-trip plus slippage can
// wipe you. What we want is "how reliable has this spread been *recently*?".
//
// Approach: on every 30s refresh tick we capture the current annualized spread
// per symbol into a ring buffer (cap ~2h of samples = 240 points). At render
// we derive two numbers per symbol:
//   observedMin  — how long the scanner has been watching (caps at 120 min)
//   stablePct    — % of samples where spread ≥ PROFITABLE_THRESHOLD_APR
//
// Persisted to localStorage so a page reload doesn't wipe the history — the
// signal is "have we watched this spread for 2 hours straight?", not "since
// you opened this tab".
const STABLE_THRESHOLD_APR = 10;
const HISTORY_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
const HISTORY_MIN_SAMPLES = 5;
const HISTORY_LS_KEY = 'hq-strategies-funding-persistence-v1';

interface PersistenceSample {
  readonly ts: number;
  readonly spread: number;  // APR percentage
}

interface PersistenceStats {
  readonly observedMin: number;
  readonly stablePct: number;
  readonly medianSpread: number;
  /** Longest contiguous stretch (in minutes) where the spread stayed
   *  ≥ STABLE_THRESHOLD_APR. Headline metric for "would this arb have
   *  survived a hold long enough to be worth the round-trip cost?". */
  readonly maxSustainedMin: number;
  /** Min observed spread over the window — caller uses for the
   *  Leaderboard "downside" hint. */
  readonly minSpread: number;
  /** Max observed spread over the window. */
  readonly maxSpread: number;
}

function loadHistoryFromStorage(): Map<string, PersistenceSample[]> {
  if (typeof window === 'undefined') return new Map();
  try {
    const raw = window.localStorage.getItem(HISTORY_LS_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, PersistenceSample[]>;
    const now = Date.now();
    const map = new Map<string, PersistenceSample[]>();
    for (const [sym, samples] of Object.entries(parsed)) {
      const fresh = samples.filter(s => now - s.ts < HISTORY_WINDOW_MS);
      if (fresh.length > 0) map.set(sym, fresh);
    }
    return map;
  } catch {
    return new Map();
  }
}

function saveHistoryToStorage(map: Map<string, PersistenceSample[]>): void {
  if (typeof window === 'undefined') return;
  try {
    const obj: Record<string, PersistenceSample[]> = {};
    for (const [sym, samples] of map) obj[sym] = samples;
    window.localStorage.setItem(HISTORY_LS_KEY, JSON.stringify(obj));
  } catch { /* quota exceeded — drop silently */ }
}

function computePersistence(samples: readonly PersistenceSample[]): PersistenceStats | null {
  if (samples.length < HISTORY_MIN_SAMPLES) return null;
  const now = Date.now();
  const oldest = samples[0].ts;
  const observedMin = Math.min(HISTORY_WINDOW_MS, now - oldest) / 60_000;
  const stable = samples.filter(s => s.spread >= STABLE_THRESHOLD_APR).length;
  const stablePct = (stable / samples.length) * 100;
  const sortedSpreads = [...samples].map(s => s.spread).sort((a, b) => a - b);
  const medianSpread = sortedSpreads[Math.floor(sortedSpreads.length / 2)];
  const minSpread = sortedSpreads[0];
  const maxSpread = sortedSpreads[sortedSpreads.length - 1];

  // Longest contiguous run above the threshold, measured in minutes
  // between the run's first and last sample timestamps. We're explicitly
  // NOT counting samples (which would be cadence-dependent) — wall-clock
  // duration is what tells the user "would I have caught this with a
  // 20-minute hold?".
  let maxSustainedMin = 0;
  let runStart: number | null = null;
  for (let i = 0; i < samples.length; i++) {
    const above = samples[i].spread >= STABLE_THRESHOLD_APR;
    if (above) {
      if (runStart === null) runStart = samples[i].ts;
      const runDur = (samples[i].ts - runStart) / 60_000;
      if (runDur > maxSustainedMin) maxSustainedMin = runDur;
    } else {
      runStart = null;
    }
  }

  return { observedMin, stablePct, medianSpread, maxSustainedMin, minSpread, maxSpread };
}

// ── Helpers ──

function buildRateEntry(exchange: FundingExchange, market: PerpMarket): ExchangeRate {
  const hourly = toHourlyRate(market.fundingRate, exchange);
  return {
    exchange,
    rate: market.fundingRate,
    hourlyRate: hourly,
    annualized: annualizeRate(hourly),
  };
}

/** Find markPrice for a symbol across all market arrays */
function findMarkPrice(symbol: string, hlMarkets: PerpMarket[], pacMarkets: PerpMarket[], ltMarkets: PerpMarket[], asterMarkets: PerpMarket[]): number | null {
  const found = hlMarkets.find(m => m.baseAsset === symbol)
    ?? pacMarkets.find(m => m.baseAsset === symbol)
    ?? ltMarkets.find(m => m.baseAsset === symbol)
    ?? asterMarkets.find(m => m.baseAsset === symbol);
  return found ? found.markPrice : null;
}

function buildRows(
  hlMarkets: PerpMarket[],
  pacMarkets: PerpMarket[],
  ltMarkets: PerpMarket[],
  asterMarkets: PerpMarket[],
): SymbolRow[] {
  // Group by normalized symbol (baseAsset)
  const symbolMap = new Map<string, Record<FundingExchange, ExchangeRate | null>>();

  const processMarkets = (markets: PerpMarket[], exchange: FundingExchange) => {
    for (const m of markets) {
      if (m.assetType !== 'perp') continue;
      if (m.volume24h < 100_000) continue;
      const key = m.baseAsset;
      if (!symbolMap.has(key)) {
        symbolMap.set(key, { hyperliquid: null, pacifica: null, lighter: null, aster: null });
      }
      const entry = symbolMap.get(key)!;
      entry[exchange] = buildRateEntry(exchange, m);
    }
  };

  processMarkets(pacMarkets, 'pacifica');
  processMarkets(hlMarkets, 'hyperliquid');
  processMarkets(ltMarkets, 'lighter');
  processMarkets(asterMarkets, 'aster');

  const rows: SymbolRow[] = [];

  for (const [symbol, rates] of symbolMap) {
    // PacifiQuant: Pacifica-first — hide any asset that doesn't trade on Pacifica.
    if (rates.pacifica === null) continue;

    // Find opportunity: need at least 2 exchanges with rates
    const available = (Object.entries(rates) as Array<[FundingExchange, ExchangeRate | null]>)
      .filter((entry): entry is [FundingExchange, ExchangeRate] => entry[1] !== null);

    let opportunity: FundingArbOpportunity | null = null;

    if (available.length >= 2) {
      available.sort((a, b) => a[1].hourlyRate - b[1].hourlyRate);
      const lowest = available[0];
      const highest = available[available.length - 1];

      if (lowest[0] !== highest[0]) {
        const spreadHourly = computeSpread(lowest[1].hourlyRate, highest[1].hourlyRate);
        const spreadAnnualized = annualizeRate(spreadHourly);

        opportunity = {
          symbol,
          longExchange: lowest[0],
          shortExchange: highest[0],
          longRate: lowest[1].hourlyRate,
          shortRate: highest[1].hourlyRate,
          spreadHourly,
          spreadAnnualized,
        };
      }
    }

    const markPrice = findMarkPrice(symbol, hlMarkets, pacMarkets, ltMarkets, asterMarkets);
    rows.push({ symbol, rates, opportunity, markPrice });
  }

  // Sort by spread descending (opportunities first)
  rows.sort((a, b) => {
    const aSpread = a.opportunity?.spreadAnnualized ?? 0;
    const bSpread = b.opportunity?.spreadAnnualized ?? 0;
    return bSpread - aSpread;
  });

  return rows;
}

const EXCHANGE_LABELS: Record<FundingExchange, string> = {
  hyperliquid: 'HL',
  pacifica: 'Pacifica',
  lighter: 'Lighter',
  aster: 'Aster',
};

const DEX_ID_MAP: Record<FundingExchange, 'hyperliquid' | 'pacifica' | 'lighter' | 'aster'> = {
  hyperliquid: 'hyperliquid',
  pacifica: 'pacifica',
  lighter: 'lighter',
  aster: 'aster',
};

function formatUsdInput(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, '');
}

function clampUsdSize(rawValue: string, maxSizeUsd: number | null): string {
  if (rawValue === '') return rawValue;
  const parsed = parseFloat(rawValue);
  if (!isFinite(parsed)) return rawValue;
  if (maxSizeUsd === null) return rawValue;
  const capped = Math.max(0, Math.min(parsed, maxSizeUsd));
  return formatUsdInput(capped);
}

async function getFundingVenueCapacityUsd(params: {
  exchange: FundingExchange;
  address: string;
  symbol: string;
  side: 'long' | 'short';
}): Promise<number> {
  if (params.exchange === 'hyperliquid') {
    const activeAssetData = await hlAdapter.getActiveAssetData(params.address, params.symbol);
    const sideIdx = params.side === 'long' ? 0 : 1;
    return Math.max(0, activeAssetData.availableToTrade[sideIdx] ?? 0);
  }

  const state = await getAdapterByDex(DEX_ID_MAP[params.exchange]).getAccountState(params.address);
  return Math.max(0, state.availableBalance);
}

// ── Component ──

export function FundingArbScanner() {
  const deps = usePerpDeps();
  const isAgentActive = useAgentWalletStore(selectIsAgentActive);

  const [rows, setRows] = useState<SymbolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [arbModal, setArbModal] = useState<ArbModalState | null>(null);
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);

  // Rolling spread history per symbol, survives reload via localStorage. Kept
  // in a ref + a sibling state counter so appending doesn't trigger the
  // fetchAllRates callback to re-memoize.
  const historyRef = useRef<Map<string, PersistenceSample[]>>(new Map());
  const [, setHistoryTick] = useState(0);
  useEffect(() => {
    historyRef.current = loadHistoryFromStorage();
    setHistoryTick(t => t + 1);
  }, []);

  // Countdown to next funding — client-only to avoid SSR hydration mismatch
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now()); // hydrate on client mount
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const fetchAllRates = useCallback(async () => {
    const [hlResult, pacResult, ltResult, asterResult] = await Promise.allSettled([
      hlAdapter.getMarkets(),
      pacAdapter.getMarkets(),
      ltAdapter.getMarkets(),
      asterAdapter.getMarkets(),
    ]);

    const hlMarkets = hlResult.status === 'fulfilled' ? hlResult.value : [];
    const pacMarkets = pacResult.status === 'fulfilled' ? pacResult.value : [];
    const ltMarkets = ltResult.status === 'fulfilled' ? ltResult.value : [];
    const asterMarkets = asterResult.status === 'fulfilled' ? asterResult.value : [];

    if (hlResult.status === 'rejected') log.warn('Hyperliquid fetch failed', { error: String(hlResult.reason) });
    if (pacResult.status === 'rejected') log.warn('Pacifica fetch failed', { error: String(pacResult.reason) });
    if (ltResult.status === 'rejected') log.warn('Lighter fetch failed', { error: String(ltResult.reason) });
    if (asterResult.status === 'rejected') log.warn('Aster fetch failed', { error: String(asterResult.reason) });

    const built = buildRows(hlMarkets, pacMarkets, ltMarkets, asterMarkets);
    setRows(built);
    setLoading(false);
    setLastUpdate(Date.now());

    // Append a persistence sample per symbol with an opportunity. Prune
    // anything outside the 2h window so memory + localStorage stay bounded
    // regardless of how long the page is open.
    const now = Date.now();
    const map = historyRef.current;
    for (const row of built) {
      if (!row.opportunity) continue;
      const existing = map.get(row.symbol) ?? [];
      const fresh = existing.filter(s => now - s.ts < HISTORY_WINDOW_MS);
      fresh.push({ ts: now, spread: row.opportunity.spreadAnnualized });
      map.set(row.symbol, fresh);
    }
    // GC symbols that didn't show up this tick and whose newest sample is
    // already outside the window.
    for (const [sym, samples] of map) {
      if (samples.length === 0 || now - samples[samples.length - 1].ts > HISTORY_WINDOW_MS) {
        map.delete(sym);
      }
    }
    saveHistoryToStorage(map);
    setHistoryTick(t => t + 1);
  }, []);

  useEffect(() => {
    fetchAllRates();
    const interval = setInterval(fetchAllRates, 30_000); // refresh every 30s
    return () => clearInterval(interval);
  }, [fetchAllRates]);

  // Next funding (next top-of-hour UTC)
  const nextFundingMs = useMemo(() => {
    const d = new Date(now);
    d.setUTCMinutes(0, 0, 0);
    d.setUTCHours(d.getUTCHours() + 1);
    return d.getTime() - now;
  }, [now]);
  const h = Math.floor(nextFundingMs / 1000 / 3600);
  const m = Math.floor((nextFundingMs / 1000 / 60) % 60);
  const s = Math.floor((nextFundingMs / 1000) % 60);
  const countdown = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  const profitableCount = rows.filter(r => r.opportunity && r.opportunity.spreadAnnualized > 10).length;

  const handleArbClick = (row: SymbolRow) => {
    if (!row.opportunity || !row.markPrice) return;
    if (!isAgentActive) {
      deps.showToast({ title: 'Enable Trading in Perp Page first', type: 'warning' });
      return;
    }
    setArbModal({
      symbol: row.opportunity.symbol,
      longExchange: row.opportunity.longExchange,
      shortExchange: row.opportunity.shortExchange,
      spreadHourly: row.opportunity.spreadHourly,
      spreadAnnualized: row.opportunity.spreadAnnualized,
      markPrice: row.markPrice,
    });
  };

  return (
    <div className="flex flex-col">
      {/* Compact status bar — the wrapping CollapsibleSection already shows
          the "ARB · Cross-DEX Funding Scanner" title, so the internal header
          stays minimal (opportunity count + next-funding countdown) to avoid
          the duplicate title the old version produced. */}
      <div
        className="px-4 py-2 flex items-center justify-between gap-4 text-xs"
        style={{ borderBottom: '1px solid #273035', color: '#949E9C' }}
      >
        <span>
          {profitableCount > 0 ? (
            <span className="text-[#5fd8ee]">{profitableCount} opportunities ≥10% APR</span>
          ) : (
            'Scanning…'
          )}
        </span>
        <div className="flex items-center gap-3">
          {lastUpdate && (
            <span className="text-[10px]" style={{ color: '#5a6469' }}>
              updated {Math.round((now - lastUpdate) / 1000)}s ago
            </span>
          )}
          <span>
            Next funding{' '}
            <span className="font-mono tabular-nums text-white">{countdown}</span>
          </span>
        </div>
      </div>

      {/* Top Stable Spreads — promotes the persistence signal from a tiny
          row indicator to the headline of the scanner. Ranks by sustained-
          run length (a 4 h spread that held for 3 h is way more actionable
          than a 30 % spike that decayed in 90 s). */}
      <StableArbLeaderboard
        rows={rows}
        historyMap={historyRef.current}
        onArb={handleArbClick}
      />

      {/* Table header */}
      <div
        className="grid px-4 py-1.5 text-xs"
        style={{ color: '#949E9C', borderBottom: '1px solid #273035', gridTemplateColumns: '1fr 0.7fr 0.7fr 0.7fr 0.7fr 0.8fr 0.9fr 0.5fr' }}
      >
        <span>Symbol</span>
        <span className="text-right">Pacifica</span>
        <span className="text-right">HL Rate</span>
        <span className="text-right">Lighter</span>
        <span className="text-right">Aster</span>
        <span className="text-right">Spread (APR)</span>
        <span className="text-right">Direction</span>
        <span className="text-right" />
      </div>

      {/* Rows */}
      <div className="overflow-y-auto" style={{ maxHeight: 400 }}>
        {loading ? (
          <div className="text-xs text-center py-6" style={{ color: '#5a6469' }}>
            Loading rates from all exchanges...
          </div>
        ) : rows.length === 0 ? (
          <div className="text-xs text-center py-6" style={{ color: '#5a6469' }}>
            No markets found
          </div>
        ) : (
          rows.slice(0, 20).map((row) => {
            const isProfitable = row.opportunity !== null && row.opportunity.spreadAnnualized > 10;
            const isExpanded = expandedSymbol === row.symbol;
            return (
              <div key={row.symbol}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExpandedSymbol(isExpanded ? null : row.symbol)}
                onKeyDown={(e) => { if (e.key === 'Enter') setExpandedSymbol(isExpanded ? null : row.symbol); }}
                className={`grid px-4 py-1 text-xs hover:bg-[#1a2830] transition-colors items-center cursor-pointer ${isProfitable ? 'bg-[#5fd8ee]/5' : ''} ${isExpanded ? 'bg-[#1a2830]' : ''}`}
                style={{ gridTemplateColumns: '1fr 0.7fr 0.7fr 0.7fr 0.7fr 0.8fr 0.9fr 0.5fr' }}
              >
                {/* Symbol */}
                <span className="text-white truncate font-medium flex items-center gap-1">
                  <span aria-hidden className="text-[9px]" style={{ color: '#5a6469' }}>
                    {isExpanded ? '▾' : '▸'}
                  </span>
                  {row.symbol}-PERP
                </span>

                {/* Pacifica Rate (primary) */}
                <RateCell entry={row.rates.pacifica} />

                {/* HL Rate */}
                <RateCell entry={row.rates.hyperliquid} />

                {/* Lighter Rate */}
                <RateCell entry={row.rates.lighter} />

                {/* Aster Rate */}
                <RateCell entry={row.rates.aster} />

                {/* Spread + persistence indicator (sparkline of session history
                    + "Xm · Y% stable" label). The sparkline directly answers
                    the user's question: "has this spread actually held, or
                    was it a spike?". No indicator until HISTORY_MIN_SAMPLES. */}
                <span className={`text-right font-mono tabular-nums flex flex-col items-end ${isProfitable ? 'text-[#5fd8ee] font-medium' : 'text-white/50'}`}>
                  <span>
                    {row.opportunity ? `${row.opportunity.spreadAnnualized >= 0 ? '+' : ''}${row.opportunity.spreadAnnualized.toFixed(1)}%` : '-'}
                  </span>
                  {(() => {
                    const samples = historyRef.current.get(row.symbol) ?? [];
                    const stats = computePersistence(samples);
                    if (!stats) return null;
                    const stableColor = stats.stablePct >= 75
                      ? '#5fd8ee'
                      : stats.stablePct >= 50
                        ? '#FFA94D'
                        : '#5a6469';
                    const minLabel = stats.observedMin >= 60
                      ? `${(stats.observedMin / 60).toFixed(1)}h`
                      : `${Math.round(stats.observedMin)}m`;
                    return (
                      <span
                        title={`Observed ${minLabel} · median ${stats.medianSpread.toFixed(1)}% · ${stats.stablePct.toFixed(0)}% of samples ≥${STABLE_THRESHOLD_APR}% APR`}
                        className="flex items-center gap-1 mt-0.5"
                      >
                        <SpreadSparkline samples={samples} color={stableColor} threshold={STABLE_THRESHOLD_APR} />
                        <span className="text-[10px] font-normal tabular-nums" style={{ color: stableColor }}>
                          {minLabel}·{stats.stablePct.toFixed(0)}%
                        </span>
                      </span>
                    );
                  })()}
                </span>

                {/* Direction */}
                {row.opportunity && row.opportunity.spreadAnnualized > 1 ? (
                  <span className="text-right text-[10px] truncate" style={{ color: '#949E9C' }}>
                    <span className="text-[#5fd8ee]">L</span>{' '}
                    {EXCHANGE_LABELS[row.opportunity.longExchange]}
                    {' '}
                    <span className="text-[#ED7088]">S</span>{' '}
                    {EXCHANGE_LABELS[row.opportunity.shortExchange]}
                  </span>
                ) : (
                  <span className="text-right" style={{ color: '#5a6469' }}>-</span>
                )}

                {/* Execute */}
                {isProfitable ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleArbClick(row); }}
                    className="ml-auto px-2 py-0.5 rounded text-[10px] font-semibold transition-colors bg-[#5fd8ee]/15 text-[#5fd8ee] hover:bg-[#5fd8ee]/25"
                  >
                    Arb
                  </button>
                ) : (
                  <span />
                )}
              </div>
              {isExpanded && (
                <FundingHistoryDrillDown
                  symbol={row.symbol}
                  onClose={() => setExpandedSymbol(null)}
                />
              )}
              </div>
            );
          })
        )}
      </div>

      {/* Execution Modal */}
      {arbModal && (
        <ArbExecutionModal
          state={arbModal}
          deps={deps}
          onClose={() => setArbModal(null)}
        />
      )}
    </div>
  );
}

// ── Sub-components ──

/**
 * Inline SVG sparkline of spread history over the observation window.
 * A horizontal reference line marks the profitability threshold — bars
 * above it are green, below are grey. Answers the "has it held?" question
 * at a glance without a tooltip.
 */
function SpreadSparkline({
  samples,
  color,
  threshold,
}: {
  samples: readonly PersistenceSample[];
  color: string;
  threshold: number;
}) {
  if (samples.length < 2) return null;
  const W = 48;
  const H = 14;
  const spreads = samples.map(s => s.spread);
  const max = Math.max(threshold * 1.2, ...spreads);
  const min = Math.min(0, ...spreads);
  const range = max - min || 1;
  const scaleY = (v: number) => H - ((v - min) / range) * H;
  const coords = samples.map((s, i) => {
    const x = (i / (samples.length - 1)) * W;
    return `${x.toFixed(2)},${scaleY(s.spread).toFixed(2)}`;
  });
  const thresholdY = scaleY(threshold);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <line x1={0} x2={W} y1={thresholdY} y2={thresholdY} stroke="#273035" strokeDasharray="2 2" strokeWidth={0.5} />
      <polyline points={coords.join(' ')} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Larger version of SpreadSparkline for the leaderboard cards. Adds a
 * dashed threshold line, an area fill, and a filled dot on the most-
 * recent sample so the eye snaps to "where is it right now".
 */
function LargeSpreadSparkline({
  samples,
  color,
  threshold,
}: {
  samples: readonly PersistenceSample[];
  color: string;
  threshold: number;
}) {
  if (samples.length < 2) return null;
  const W = 200;
  const H = 60;
  const spreads = samples.map(s => s.spread);
  const max = Math.max(threshold * 1.2, ...spreads);
  const min = Math.min(0, ...spreads);
  const range = max - min || 1;
  const scaleY = (v: number) => H - ((v - min) / range) * H;
  const coords = samples.map((s, i) => {
    const x = (i / (samples.length - 1)) * W;
    return `${x.toFixed(2)},${scaleY(s.spread).toFixed(2)}`;
  });
  const thresholdY = scaleY(threshold);
  const lastX = W;
  const lastY = scaleY(spreads[spreads.length - 1]);
  const fillId = `sparkGrad-${color.replace('#', '')}`;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="flex-shrink-0">
      <defs>
        <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={0} x2={W} y1={thresholdY} y2={thresholdY} stroke="#273035" strokeDasharray="3 3" strokeWidth={0.75} />
      <polygon
        points={`0,${H} ${coords.join(' ')} ${W},${H}`}
        fill={`url(#${fillId})`}
      />
      <polyline points={coords.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </svg>
  );
}

interface LeaderboardEntry {
  readonly row: SymbolRow;
  readonly stats: PersistenceStats;
  readonly samples: readonly PersistenceSample[];
}

/**
 * Top Stable Spreads — ranks the scanner's current opportunities by
 * `maxSustainedMin` (longest contiguous run above the profitability
 * threshold) rather than the raw spread. A 30 % APR spread that snapped
 * back after 2 min is worse than a 12 % spread that held for 40 min, and
 * this panel puts the "has it held" question front and center.
 *
 * Requires ≥ HISTORY_MIN_SAMPLES observations before a symbol can appear —
 * a fresh page-load shows an onboarding hint instead of ranking symbols
 * with 1 data point each.
 */
function StableArbLeaderboard({
  rows,
  historyMap,
  onArb,
}: {
  rows: readonly SymbolRow[];
  historyMap: ReadonlyMap<string, readonly PersistenceSample[]>;
  onArb: (row: SymbolRow) => void;
}) {
  const entries = useMemo<LeaderboardEntry[]>(() => {
    const out: LeaderboardEntry[] = [];
    for (const row of rows) {
      if (!row.opportunity) continue;
      const samples = historyMap.get(row.symbol) ?? [];
      const stats = computePersistence(samples);
      if (!stats) continue;
      if (stats.stablePct < 50) continue; // filter out spreads that have already decayed
      out.push({ row, stats, samples });
    }
    // Rank: longest sustained run first, tiebreak by median spread
    out.sort((a, b) => {
      if (b.stats.maxSustainedMin !== a.stats.maxSustainedMin) {
        return b.stats.maxSustainedMin - a.stats.maxSustainedMin;
      }
      return b.stats.medianSpread - a.stats.medianSpread;
    });
    return out.slice(0, 3);
  }, [rows, historyMap]);

  const fmtMin = (m: number) => (m >= 60 ? `${(m / 60).toFixed(1)}h` : `${Math.round(m)}m`);

  // Est. daily yield @ $1k notional given the current spread.
  // spread (annualized %) / 365 = daily %; × $1000 = $/day.
  const fmtDailyAtThousand = (currentApr: number) => {
    const daily = (currentApr / 100 / 365) * 1000;
    return `$${daily.toFixed(2)}/day`;
  };

  return (
    <div
      className="px-4 py-3"
      style={{ borderBottom: '1px solid #273035', backgroundColor: '#0B141A' }}
    >
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: '#5fd8ee' }}>
            Top Stable Spreads
          </span>
          <span className="text-[10px]" style={{ color: '#5a6469' }}>
            ranked by longest sustained ≥{STABLE_THRESHOLD_APR}% APR run
          </span>
        </div>
        <span className="text-[10px]" style={{ color: '#5a6469' }}>
          window up to {HISTORY_WINDOW_MS / 60_000 / 60}h · persisted
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="text-[11px] py-4 text-center" style={{ color: '#5a6469' }}>
          Gathering samples… keep this page open for a few minutes and stable spreads will appear here.
        </p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {entries.map(({ row, stats, samples }) => {
            const opp = row.opportunity!;
            const currentApr = opp.spreadAnnualized;
            const stableColor = stats.stablePct >= 75 ? '#5fd8ee' : '#FFA94D';
            return (
              <div
                key={row.symbol}
                className="rounded-md p-3 flex flex-col gap-2"
                style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}
              >
                {/* Symbol + direction */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">{row.symbol}-PERP</span>
                  <span className="text-[10px]" style={{ color: '#949E9C' }}>
                    <span className="text-[#5fd8ee]">L</span> {EXCHANGE_LABELS[opp.longExchange]}
                    {' · '}
                    <span className="text-[#ED7088]">S</span> {EXCHANGE_LABELS[opp.shortExchange]}
                  </span>
                </div>

                {/* Headline: current spread + est daily */}
                <div className="flex items-end justify-between">
                  <span className="text-lg font-semibold font-mono tabular-nums" style={{ color: stableColor }}>
                    {currentApr >= 0 ? '+' : ''}{currentApr.toFixed(1)}%
                  </span>
                  <span className="text-[10px] tabular-nums" style={{ color: '#949E9C' }}>
                    {fmtDailyAtThousand(currentApr)} @ $1k
                  </span>
                </div>

                <LargeSpreadSparkline samples={samples} color={stableColor} threshold={STABLE_THRESHOLD_APR} />

                {/* Metric grid */}
                <div className="grid grid-cols-4 gap-1.5 text-[9px] tabular-nums">
                  <div className="flex flex-col">
                    <span style={{ color: '#5a6469' }}>MEDIAN</span>
                    <span className="text-white font-mono">{stats.medianSpread.toFixed(1)}%</span>
                  </div>
                  <div className="flex flex-col">
                    <span style={{ color: '#5a6469' }}>MAX RUN</span>
                    <span className="text-white font-mono">{fmtMin(stats.maxSustainedMin)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span style={{ color: '#5a6469' }}>STABLE%</span>
                    <span className="font-mono" style={{ color: stableColor }}>{stats.stablePct.toFixed(0)}%</span>
                  </div>
                  <div className="flex flex-col">
                    <span style={{ color: '#5a6469' }}>OBSERVED</span>
                    <span className="text-white font-mono">{fmtMin(stats.observedMin)}</span>
                  </div>
                </div>

                {/* Min / Max context strip */}
                <div className="text-[9px] flex items-center justify-between" style={{ color: '#5a6469' }}>
                  <span>min {stats.minSpread.toFixed(1)}%</span>
                  <span>max {stats.maxSpread.toFixed(1)}%</span>
                </div>

                {/* Action */}
                <button
                  onClick={() => onArb(row)}
                  disabled={!row.markPrice}
                  className="w-full py-1.5 rounded text-[11px] font-semibold transition-colors bg-[#5fd8ee]/15 text-[#5fd8ee] hover:bg-[#5fd8ee]/25 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Arb {row.symbol}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RateCell({ entry }: { entry: ExchangeRate | null }) {
  if (!entry) {
    return <span className="text-right font-mono tabular-nums" style={{ color: '#5a6469' }}>-</span>;
  }
  const color = entry.annualized >= 0 ? 'text-[#5fd8ee]' : 'text-[#ED7088]';
  return (
    <span className={`text-right font-mono tabular-nums ${color}`}>
      {(entry.rate * 100).toFixed(4)}%
    </span>
  );
}

// ── Arb Execution Modal ──

interface ArbExecutionModalProps {
  state: ArbModalState;
  deps: ReturnType<typeof usePerpDeps>;
  onClose: () => void;
}

function ArbExecutionModal({ state, deps, onClose }: ArbExecutionModalProps) {
  const accounts = useStrategyExchangeAccounts();
  const [sizeUsd, setSizeUsd] = useState('1000');
  const [isExecuting, setIsExecuting] = useState(false);
  const [balanceLimit, setBalanceLimit] = useState<ArbBalanceLimit | null>(null);
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);

  const sizeNum = parseFloat(sizeUsd) || 0;
  const estimatedDailyIncome = sizeNum * state.spreadHourly * 24;

  useEffect(() => {
    const longAddress = accounts.byDex[state.longExchange];
    const shortAddress = accounts.byDex[state.shortExchange];

    if (!longAddress || !shortAddress) {
      setBalanceLimit(null);
      setIsBalanceLoading(false);
      return;
    }

    let cancelled = false;
    setIsBalanceLoading(true);

    Promise.all([
      getFundingVenueCapacityUsd({
        exchange: state.longExchange,
        address: longAddress,
        symbol: state.symbol,
        side: 'long',
      }),
      getFundingVenueCapacityUsd({
        exchange: state.shortExchange,
        address: shortAddress,
        symbol: state.symbol,
        side: 'short',
      }),
    ])
      .then(([longAvailableUsd, shortAvailableUsd]) => {
        if (cancelled) return;
        const maxSizeUsd = Number(Math.min(longAvailableUsd, shortAvailableUsd).toFixed(2));
        const limitingExchange = longAvailableUsd <= shortAvailableUsd ? state.longExchange : state.shortExchange;

        setBalanceLimit({
          longAvailableUsd,
          shortAvailableUsd,
          maxSizeUsd,
          limitingExchange,
        });
        setSizeUsd((current) => clampUsdSize(current, maxSizeUsd));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        log.warn('Funding arb balance precheck failed', {
          error: error instanceof Error ? error.message : String(error),
          longExchange: state.longExchange,
          shortExchange: state.shortExchange,
        });
        setBalanceLimit(null);
      })
      .finally(() => {
        if (!cancelled) {
          setIsBalanceLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    accounts,
    state.longExchange,
    state.shortExchange,
    state.symbol,
  ]);

  const handleExecute = async () => {
    if (sizeNum <= 0) {
      deps.showToast({ title: 'Size must be greater than 0', type: 'warning' });
      return;
    }
    if (balanceLimit && sizeNum > balanceLimit.maxSizeUsd) {
      const capped = formatUsdInput(balanceLimit.maxSizeUsd);
      setSizeUsd(capped);
      deps.showToast({
        title: 'Size exceeds available balance',
        message: `Max executable size is ${formatCurrency(balanceLimit.maxSizeUsd, { compact: false, decimals: 2 })} on ${EXCHANGE_LABELS[balanceLimit.limitingExchange]}.`,
        type: 'warning',
      });
      return;
    }
    if (balanceLimit && !(balanceLimit.maxSizeUsd > 0)) {
      deps.showToast({
        title: 'No available balance',
        message: `${EXCHANGE_LABELS[balanceLimit.limitingExchange]} has no free balance for this arb.`,
        type: 'warning',
      });
      return;
    }

    setIsExecuting(true);
    try {
      const signFn = deps.getSignFn();
      const longAdapter = getAdapterByDex(DEX_ID_MAP[state.longExchange]);
      const shortAdapter = getAdapterByDex(DEX_ID_MAP[state.shortExchange]);

      const result = await executeFundingArb(
        {
          symbol: state.symbol,
          sizeUsd: sizeNum,
          markPrice: state.markPrice,
          longAdapter,
          shortAdapter,
        },
        signFn,
      );

      if (result.longResult.success && result.shortResult.success) {
        deps.showToast({
          title: `Arb opened: LONG ${EXCHANGE_LABELS[state.longExchange]} / SHORT ${EXCHANGE_LABELS[state.shortExchange]} ${state.symbol}`,
          message: `$${sizeNum.toFixed(0)} notional, est. $${estimatedDailyIncome.toFixed(4)}/day`,
          type: 'success',
        });
        onClose();
      } else {
        const longErr = result.longResult.success ? null : result.longResult.error;
        const shortErr = result.shortResult.success ? null : result.shortResult.error;
        const errMsg = [longErr ? `Long: ${longErr}` : null, shortErr ? `Short: ${shortErr}` : null]
          .filter(Boolean)
          .join('; ');
        deps.showToast({
          title: 'Arb execution partially failed',
          message: errMsg || 'Unknown error',
          type: 'warning',
        });
      }
    } catch (err) {
      log.warn('Funding arb execution error', { error: err instanceof Error ? err.message : String(err) });
      deps.showToast({
        title: 'Arb execution failed',
        message: err instanceof Error ? err.message : 'Unexpected error',
        type: 'warning',
      });
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div
        className="rounded-lg w-[380px] max-w-[90vw] flex flex-col"
        style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}
      >
        {/* Modal Header */}
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #273035' }}>
          <div className="flex items-center gap-2">
            <span className="text-xs px-1.5 py-0.5 rounded text-[#ED7088] bg-[#ED7088]/10">ARB</span>
            <h3 className="text-sm font-semibold text-white">Execute Funding Arb</h3>
          </div>
          <button onClick={onClose} className="text-xs px-1.5 py-0.5 rounded hover:bg-[#273035] transition-colors" style={{ color: '#949E9C' }}>
            Close
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 flex flex-col gap-3">
          {/* Summary */}
          <div className="rounded-md p-3 space-y-1.5" style={{ backgroundColor: '#1B2429', border: '1px solid #273035' }}>
            <ModalRow label="Symbol" value={`${state.symbol}-PERP`} />
            <ModalRow label="Long Exchange" value={EXCHANGE_LABELS[state.longExchange]} highlight="pos" />
            <ModalRow label="Short Exchange" value={EXCHANGE_LABELS[state.shortExchange]} highlight="neg" />
            <div className="border-t pt-1.5" style={{ borderColor: '#273035' }}>
              <ModalRow label="Spread (hourly)" value={`${(state.spreadHourly * 100).toFixed(4)}%`} />
              <ModalRow label="Spread (APR)" value={`${state.spreadAnnualized >= 0 ? '+' : ''}${state.spreadAnnualized.toFixed(1)}%`} highlight="pos" />
            </div>
          </div>

          {/* Size Input */}
          <div className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: '#949E9C' }}>Size (USDC notional)</span>
            <input
              type="number"
              value={sizeUsd}
              onChange={(e) => setSizeUsd(clampUsdSize(e.target.value, balanceLimit ? balanceLimit.maxSizeUsd : null))}
              className="w-full bg-transparent text-xs text-white font-mono tabular-nums rounded px-2 py-1.5 focus:outline-none"
              style={{ border: '1px solid #273035', backgroundColor: '#1B2429' }}
              min={0}
              max={balanceLimit ? balanceLimit.maxSizeUsd : undefined}
              step={0.01}
            />
            <span className="text-[11px]" style={{ color: '#949E9C' }}>
              {isBalanceLoading
                ? 'Checking venue balances...'
                : balanceLimit
                  ? `Max now ${formatCurrency(balanceLimit.maxSizeUsd, { compact: false, decimals: 2 })} · ${EXCHANGE_LABELS[state.longExchange]} ${formatCurrency(balanceLimit.longAvailableUsd, { compact: false, decimals: 2 })} / ${EXCHANGE_LABELS[state.shortExchange]} ${formatCurrency(balanceLimit.shortAvailableUsd, { compact: false, decimals: 2 })}`
                  : 'Balance cap unavailable — size is manual.'}
            </span>
          </div>

          {/* Estimated Income */}
          <div className="rounded-md p-3 space-y-1.5" style={{ backgroundColor: '#1B2429', border: '1px solid #273035' }}>
            <ModalRow
              label="Est. Funding Income / day"
              value={`${estimatedDailyIncome >= 0 ? '+' : ''}$${estimatedDailyIncome.toFixed(4)}`}
              highlight={estimatedDailyIncome >= 0 ? 'pos' : 'neg'}
            />
            <ModalRow
              label="Mark Price"
              value={`$${state.markPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
            />
            <ModalRow
              label="Position Size"
              value={sizeNum > 0 && state.markPrice > 0 ? `${(sizeNum / state.markPrice).toFixed(6)} ${state.symbol}` : '-'}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 mt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2 rounded-md text-xs font-semibold transition-colors hover:bg-[#273035]"
              style={{ border: '1px solid #273035', color: '#949E9C' }}
            >
              Cancel
            </button>
            <button
              onClick={handleExecute}
              disabled={isExecuting || sizeNum <= 0}
              className="flex-1 py-2 rounded-md text-xs font-semibold bg-[#5fd8ee] hover:bg-[#93E3F3] text-[#0F1A1E] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExecuting ? 'Executing...' : 'Confirm Arb'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModalRow({ label, value, highlight }: { label: string; value: string; highlight?: 'pos' | 'neg' }) {
  const color = highlight === 'pos' ? 'text-[#5fd8ee]' : highlight === 'neg' ? 'text-[#ED7088]' : 'text-white';
  return (
    <div className="flex justify-between">
      <span className="text-xs" style={{ color: '#949E9C' }}>{label}</span>
      <span className={`text-xs font-mono tabular-nums ${color}`}>{value}</span>
    </div>
  );
}
