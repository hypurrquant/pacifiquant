'use client';

/**
 * PortfolioOverview — Multi-exchange balance summary with SVG donut chart,
 * per-DEX equity sparklines, and positions heatmap.
 */

import { useEffect, useState, useRef } from 'react';
import { HyperliquidPerpAdapter } from '@hq/core/defi/perp';
import type { PerpAccountState, SpotBalance, PerpPosition, PerpMarket } from '@hq/core/defi/perp';
import { fmtSizeByLot, fmtPriceByTick } from '@/domains/perp/utils/displayComputations';
import type { PerpDexId } from '@/domains/perp/types/perp.types';
import { getAdapterByDex } from '@/domains/perp/hooks/usePerpAdapter';
import { PERP_DEX_LIST, PERP_DEX_ORDER } from '@/shared/config/perp-dex-display';
import { useStrategyExchangeAccounts } from '../hooks/useStrategyExchangeAccounts';
import { getHyperliquidUsdcSummary } from '../utils/hyperliquidUsdcSummary';

const EXCHANGES = PERP_DEX_LIST;

// Use the SHARED singletons from usePerpAdapter — the per-DEX agent stores
// (useAsterAgentStore, useLighterAgentStore, usePacificaAgentStore) install
// credentials onto those instances. Creating fresh `new AsterPerpAdapter()`
// here would bypass that installation and Aster's credentialed
// getAccountState would throw "agent not configured" on every render.
const adapters = {
  hyperliquid: getAdapterByDex('hyperliquid'),
  pacifica:    getAdapterByDex('pacifica'),
  lighter:     getAdapterByDex('lighter'),
  aster:       getAdapterByDex('aster'),
};

const DEX_IDS: readonly PerpDexId[] = PERP_DEX_ORDER;

const MAX_SPARKLINE_POINTS = 30;
const MIN_SPARKLINE_POINTS = 6;

interface DexPositions {
  readonly dex: PerpDexId;
  readonly positions: PerpPosition[];
  readonly markets: PerpMarket[];
}

interface ExchangeBalance {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly logo: string;
  readonly equity: number;
  readonly marginUsed: number;
  readonly available: number;
  readonly unrealizedPnl: number;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function DonutChart({ data, total }: { data: readonly ExchangeBalance[]; total: number }) {
  const r = 60;
  const cx = 80;
  const cy = 80;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <svg viewBox="0 0 160 160" className="w-36 h-36 flex-shrink-0">
      {/* Background ring */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#273035" strokeWidth={14} />
      {/* Segments */}
      {data.map((d) => {
        const pct = total > 0 ? d.equity / total : 0;
        const dash = pct * circumference;
        const seg = (
          <circle
            key={d.id}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={d.color}
            strokeWidth={14}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        );
        offset += dash;
        return seg;
      })}
      {/* Center text */}
      <text x={cx} y={cy - 6} textAnchor="middle" fill="white" fontSize="14" fontWeight="600">
        ${total >= 1000 ? `${(total / 1000).toFixed(1)}K` : fmt(total)}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="#949E9C" fontSize="9">
        Total Equity
      </text>
    </svg>
  );
}

/** Inline SVG sparkline for a single DEX equity history. */
function EquitySparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < MIN_SPARKLINE_POINTS) {
    return <span style={{ color: '#949E9C', fontSize: 10 }}>—</span>;
  }

  const W = 80;
  const H = 20;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1; // avoid divide-by-zero when all values equal

  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * W;
    // invert Y: higher equity → lower y in SVG coordinate space
    const y = H - ((v - min) / range) * H;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface HeatmapCell {
  dex: PerpDexId;
  symbol: string;
  side: 'long' | 'short' | 'none';
  notional: number;
}

interface HeatmapRow {
  symbol: string;
  totalNotional: number;
  cells: Record<PerpDexId, HeatmapCell>;
}

function buildHeatmapRows(dexPositions: readonly DexPositions[], topN = 8): HeatmapRow[] {
  // PacifiQuant: restrict heatmap to symbols tradable on Pacifica.
  const pacSymbols = new Set<string>(
    dexPositions.find((dp) => dp.dex === 'pacifica')?.markets.map((m) => m.symbol) ?? [],
  );

  // Aggregate notional per (symbol, dex)
  const bySymbol = new Map<string, HeatmapRow>();

  for (const dp of dexPositions) {
    const dex = dp.dex;
    for (const pos of dp.positions) {
      if (pacSymbols.size > 0 && !pacSymbols.has(pos.symbol)) continue;
      const existing = bySymbol.get(pos.symbol);
      const notional = Math.abs(pos.size * pos.entryPrice);

      if (!existing) {
        const cells: Record<PerpDexId, HeatmapCell> = {
          hyperliquid: { dex: 'hyperliquid', symbol: pos.symbol, side: 'none', notional: 0 },
          pacifica: { dex: 'pacifica', symbol: pos.symbol, side: 'none', notional: 0 },
          lighter: { dex: 'lighter', symbol: pos.symbol, side: 'none', notional: 0 },
          aster: { dex: 'aster', symbol: pos.symbol, side: 'none', notional: 0 },
        };
        cells[dex] = { dex, symbol: pos.symbol, side: pos.side, notional };
        bySymbol.set(pos.symbol, { symbol: pos.symbol, totalNotional: notional, cells });
      } else {
        existing.cells[dex] = { dex, symbol: pos.symbol, side: pos.side, notional };
        existing.totalNotional += notional;
      }
    }
  }

  return Array.from(bySymbol.values())
    .sort((a, b) => b.totalNotional - a.totalNotional)
    .slice(0, topN);
}

function PositionsHeatmap({ dexPositions }: { dexPositions: readonly DexPositions[] }) {
  const rows = buildHeatmapRows(dexPositions);
  if (rows.length === 0) return null;

  // Compute max notional for opacity scaling
  let maxNotional = 0;
  for (const row of rows) {
    for (const dexId of DEX_IDS) {
      const n = row.cells[dexId].notional;
      if (n > maxNotional) maxNotional = n;
    }
  }

  const cellSize = 24;

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-px flex-1" style={{ backgroundColor: '#273035' }} />
        <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: '#949E9C' }}>Positions Heatmap</span>
        <div className="h-px flex-1" style={{ backgroundColor: '#273035' }} />
      </div>

      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              {/* Symbol label column header */}
              <th className="text-left text-[10px] font-medium pr-2" style={{ color: '#949E9C', width: 60 }}></th>
              {EXCHANGES.map((ex) => (
                <th key={ex.id} className="text-center text-[10px] font-medium" style={{ color: ex.color, width: cellSize }}>
                  {ex.name.slice(0, 2)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.symbol}>
                <td className="text-[10px] pr-2 text-right" style={{ color: '#949E9C' }}>{row.symbol}</td>
                {EXCHANGES.map((ex) => {
                  const cell = row.cells[ex.id as PerpDexId];
                  const hasPos = cell.side !== 'none';
                  const baseColor = cell.side === 'long' ? '#5fd8ee' : cell.side === 'short' ? '#ED7088' : '#273035';
                  const opacity = hasPos && maxNotional > 0
                    ? 0.3 + (cell.notional / maxNotional) * 0.7
                    : 1;
                  const titleText = hasPos
                    ? `${ex.name} ${row.symbol} ${cell.side} $${fmt(cell.notional)}`
                    : `${ex.name} ${row.symbol} no position`;

                  return (
                    <td key={ex.id} style={{ padding: 0 }}>
                      <div
                        title={titleText}
                        style={{
                          width: cellSize,
                          height: cellSize,
                          backgroundColor: baseColor,
                          opacity,
                          borderRadius: 3,
                          cursor: hasPos ? 'default' : 'default',
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {/* Legend row */}
        <div className="flex items-center gap-4 mt-2">
          {EXCHANGES.map((ex) => (
            <div key={ex.id} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: ex.color }} />
              <span className="text-[10px]" style={{ color: '#949E9C' }}>{ex.name}</span>
            </div>
          ))}
          <div className="flex items-center gap-1 ml-2">
            <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: '#5fd8ee' }} />
            <span className="text-[10px]" style={{ color: '#949E9C' }}>Long</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: '#ED7088' }} />
            <span className="text-[10px]" style={{ color: '#949E9C' }}>Short</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Try to get Phantom Solana address (auto-connect if previously approved) */
async function getSolanaAddress(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const phantom = (window as unknown as Record<string, unknown>).phantom as { solana?: { isPhantom: boolean; connect(): Promise<{ publicKey: { toString(): string } }> } } | undefined;
  if (!phantom?.solana?.isPhantom) return null;
  try {
    const resp = await phantom.solana.connect();
    return resp.publicKey.toString();
  } catch {
    return null;
  }
}

export function PortfolioOverview({ walletAddress }: { walletAddress: string | null }) {
  const accounts = useStrategyExchangeAccounts();
  const [balances, setBalances] = useState<readonly ExchangeBalance[]>(
    EXCHANGES.map(e => ({ ...e, equity: 0, marginUsed: 0, available: 0, unrealizedPnl: 0 })),
  );
  const [loading, setLoading] = useState(false);
  const [dexPositions, setDexPositions] = useState<readonly DexPositions[]>([]);
  // HL non-USDC spot tokens — surfaced inside the HL cell of the Open Positions grid
  // so a user running a delta-neutral (perp short + spot long, etc.) can see both legs
  // without leaving the page. Other perp DEXs in our registry don't expose spot.
  const [hlSpotNonUsdc, setHlSpotNonUsdc] = useState<readonly SpotBalance[]>([]);

  // Equity sparkline history: last MAX_SPARKLINE_POINTS per DEX, accumulated across fetches
  const equityHistory = useRef<Record<PerpDexId, number[]>>({
    hyperliquid: [],
    pacifica: [],
    lighter: [],
    aster: [],
  });
  // Mirror of history for rendering (updated via setState to trigger re-render)
  const [sparklineData, setSparklineData] = useState<Record<PerpDexId, number[]>>({
    hyperliquid: [],
    pacifica: [],
    lighter: [],
    aster: [],
  });

  useEffect(() => {
    if (!walletAddress) return;
    setLoading(true);

    // Poll every REFRESH_MS so balances / positions / HL spot reflect changes
    // without a full page reload. None of the non-HL adapters expose user-data
    // WS, so REST polling is the common denominator across all 4 DEXs. This
    // intentionally skips the HL-specific WS path — keeping a single cadence
    // avoids split-brain UI where HL updates mid-tick while Pacifica/Lighter/
    // Aster lag.
    const REFRESH_MS = 10_000;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const runFetch = () => {
      if (cancelled) return;
      // Resolve Solana address for Pacifica (auto-reconnects if approved)
      getSolanaAddress().then((solanaAddr) => {
        if (cancelled) return;
        const pacificaAddr = accounts.pacifica ?? solanaAddr ?? '';

        // Parallel fetch: account states + positions + markets for all DEXs
        Promise.allSettled(
          EXCHANGES.map(async (ex) => {
            const adapter = adapters[ex.id as keyof typeof adapters];

            const queryAddr = ex.id === 'pacifica' ? pacificaAddr : accounts.byDex[ex.id as PerpDexId];
            if (!queryAddr) return { entry: { ...ex, equity: 0, marginUsed: 0, available: 0, unrealizedPnl: 0 }, hlSpotHeld: [] as SpotBalance[] };

            const state: PerpAccountState = await adapter.getAccountState(queryAddr);
            let equity = state.totalEquity;
            let available = state.availableBalance;

            // HL: also fetch spot balances (USDC, HYPE, etc.). Non-USDC tokens are
            // surfaced below in the Open Positions grid for delta-neutral verification.
            let hlSpotHeld: SpotBalance[] = [];
            if (ex.id === 'hyperliquid') {
              try {
                const hlAdapter = adapter as HyperliquidPerpAdapter;
                const spotBalances: SpotBalance[] = await hlAdapter.getSpotBalances(queryAddr);
                const hlSummary = getHyperliquidUsdcSummary(state, spotBalances);
                equity = hlSummary.totalEquityUsd;
                available = hlSummary.availableUsd;
                hlSpotHeld = [...hlSummary.nonUsdcSpotBalances];
              } catch { /* spot fetch optional */ }
            }

            // Append equity snapshot to history
            const dexId = ex.id as PerpDexId;
            const arr = equityHistory.current[dexId];
            arr.push(equity);
            if (arr.length > MAX_SPARKLINE_POINTS) arr.splice(0, arr.length - MAX_SPARKLINE_POINTS);

            return { entry: { ...ex, equity, marginUsed: state.totalMarginUsed, available, unrealizedPnl: state.unrealizedPnl }, hlSpotHeld };
          }),
        ).then((results) => {
          if (cancelled) return;
          setBalances(results.map((r, i) =>
            r.status === 'fulfilled' ? r.value.entry : { ...EXCHANGES[i], equity: 0, marginUsed: 0, available: 0, unrealizedPnl: 0 },
          ));
          // Pick HL spot non-USDC balances from the HL result
          const hlIdx = EXCHANGES.findIndex(e => e.id === 'hyperliquid');
          const hlResult = hlIdx >= 0 ? results[hlIdx] : undefined;
          if (hlResult && hlResult.status === 'fulfilled') {
            setHlSpotNonUsdc(hlResult.value.hlSpotHeld);
          } else {
            setHlSpotNonUsdc([]);
          }
          // Snapshot history for render
          setSparklineData({
            hyperliquid: [...equityHistory.current.hyperliquid],
            pacifica: [...equityHistory.current.pacifica],
            lighter: [...equityHistory.current.lighter],
            aster: [...equityHistory.current.aster],
          });
          setLoading(false);
        });

        // Parallel fetch: positions + markets per DEX (graceful — one DEX error doesn't block others)
        Promise.allSettled(
          DEX_IDS.map(async (dexId): Promise<DexPositions> => {
            const adapter = adapters[dexId];
            const queryAddr = dexId === 'pacifica' ? pacificaAddr : accounts.byDex[dexId];
            if (!queryAddr) return { dex: dexId, positions: [], markets: [] };
            const [positions, markets] = await Promise.all([
              adapter.getPositions(queryAddr),
              adapter.getMarkets(),
            ]);
            return { dex: dexId, positions, markets };
          }),
        ).then((results) => {
          if (cancelled) return;
          // PacifiQuant: keep every DEX slice (even when positions are empty)
          // so we can derive the Pacifica symbol universe from its `markets`
          // field and filter positions/heatmap accordingly.
          setDexPositions(
            results
              .map((r, i): DexPositions =>
                r.status === 'fulfilled' ? r.value : { dex: DEX_IDS[i], positions: [], markets: [] },
              )
              .filter((dp) => dp.positions.length > 0 || dp.dex === 'pacifica'),
          );
        });
      }); // close getSolanaAddress().then()
    };

    runFetch();
    intervalId = setInterval(runFetch, REFRESH_MS);

    return () => {
      cancelled = true;
      if (intervalId !== null) clearInterval(intervalId);
    };
  }, [walletAddress, accounts]);

  const total = balances.reduce((s, b) => s + b.equity, 0);
  const totalMargin = balances.reduce((s, b) => s + b.marginUsed, 0);
  const totalAvail = balances.reduce((s, b) => s + b.available, 0);
  const totalPnl = balances.reduce((s, b) => s + b.unrealizedPnl, 0);

  return (
    <div className="rounded-lg p-4" style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}>
      <h2 className="text-sm font-semibold text-white mb-3">Portfolio Overview</h2>

      {!walletAddress ? (
        <p className="text-xs text-center py-6" style={{ color: '#949E9C' }}>Connect wallet to view portfolio</p>
      ) : (
        <div className="flex flex-col md:flex-row gap-4">
          {/* Donut + Stats */}
          <div className="flex items-center gap-4">
            <DonutChart data={balances} total={total} />
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              <div>
                <span className="text-[10px] block" style={{ color: '#949E9C' }}>Total Equity</span>
                <span className="text-sm font-semibold text-white">${fmt(total)}</span>
              </div>
              <div>
                <span className="text-[10px] block" style={{ color: '#949E9C' }}>Margin Used</span>
                <span className="text-sm font-semibold text-white">${fmt(totalMargin)}</span>
              </div>
              <div>
                <span className="text-[10px] block" style={{ color: '#949E9C' }}>Available</span>
                <span className="text-sm font-semibold text-white">${fmt(totalAvail)}</span>
              </div>
              <div>
                <span className="text-[10px] block" style={{ color: '#949E9C' }}>Unrealized PnL</span>
                <span className={`text-sm font-semibold ${totalPnl >= 0 ? 'text-[#5fd8ee]' : 'text-[#ED7088]'}`}>
                  {totalPnl >= 0 ? '+' : ''}${fmt(totalPnl)}
                </span>
              </div>
            </div>
          </div>

          {/* Exchange bars + sparklines */}
          <div className="flex-1 space-y-2">
            {balances.map((b) => {
              const pct = total > 0 ? (b.equity / total) * 100 : 0;
              const dexId = b.id as PerpDexId;
              return (
                <div key={b.id} className="flex items-center gap-2">
                  <img src={b.logo} alt={b.name} className="w-4 h-4 rounded-full flex-shrink-0" />
                  <span className="text-[10px] text-gray-400 w-16 flex-shrink-0">{b.name}</span>
                  <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ backgroundColor: '#1B2429' }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: b.color }}
                    />
                  </div>
                  <span className="text-[10px] text-white tabular-nums w-20 text-right">${fmt(b.equity)}</span>
                  <span className="text-[10px] tabular-nums w-10 text-right" style={{ color: '#949E9C' }}>{pct.toFixed(0)}%</span>
                  {/* Equity sparkline */}
                  <div className="flex-shrink-0" style={{ width: 80 }}>
                    <EquitySparkline points={sparklineData[dexId]} color={b.color} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loading && <div className="text-center text-[10px] mt-2" style={{ color: '#949E9C' }}>Loading balances...</div>}

      {/* Open Positions — 2x2 grid, one cell per DEX, with HL non-USDC spot
          balances inline so delta-neutral (spot long + perp short) is visible
          at a glance. Section is hidden only when every cell would be empty. */}
      {(dexPositions.length > 0 || hlSpotNonUsdc.length > 0) && (
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-px flex-1" style={{ backgroundColor: '#273035' }} />
            <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: '#949E9C' }}>Open Positions &amp; Spot</span>
            <div className="h-px flex-1" style={{ backgroundColor: '#273035' }} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(() => {
              // PacifiQuant: symbols listed on Pacifica define the visible universe.
              const pacSlice = dexPositions.find(d => d.dex === 'pacifica');
              const pacSymbols = new Set<string>(pacSlice?.markets.map(m => m.symbol) ?? []);
              return EXCHANGES.map((ex) => {
              const dp = dexPositions.find(d => d.dex === ex.id);
              const rawPositions = dp?.positions ?? [];
              const positions = pacSymbols.size > 0
                ? rawPositions.filter(p => pacSymbols.has(p.symbol))
                : rawPositions;
              const markets = dp?.markets ?? [];
              const spot = ex.id === 'hyperliquid' ? hlSpotNonUsdc : [];
              const isEmpty = positions.length === 0 && spot.length === 0;
              return (
                <div
                  key={ex.id}
                  className="rounded p-3"
                  style={{ backgroundColor: '#0B141A', border: '1px solid #1B2429' }}
                >
                  {/* DEX header */}
                  <div className="flex items-center gap-1.5 mb-2">
                    <img src={ex.logo} alt={ex.name} className="w-3.5 h-3.5 rounded-full flex-shrink-0" />
                    <span className="text-[11px] font-semibold" style={{ color: ex.color }}>
                      {ex.name}
                    </span>
                    <span className="ml-auto text-[9px] tabular-nums" style={{ color: '#5a6469' }}>
                      {positions.length > 0 && `${positions.length} position${positions.length === 1 ? '' : 's'}`}
                      {positions.length > 0 && spot.length > 0 && ' · '}
                      {spot.length > 0 && `${spot.length} spot`}
                    </span>
                  </div>

                  {isEmpty ? (
                    <p className="text-[10px] py-3 text-center" style={{ color: '#5a6469' }}>
                      No exposure
                    </p>
                  ) : (
                    <>
                      {positions.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[10px]">
                            <thead>
                              <tr style={{ borderBottom: '1px solid #273035' }}>
                                <th className="text-left py-1 pr-2 font-medium" style={{ color: '#949E9C' }}>Perp</th>
                                <th className="text-left py-1 pr-2 font-medium" style={{ color: '#949E9C' }}>Side</th>
                                <th className="text-right py-1 pr-2 font-medium" style={{ color: '#949E9C' }}>Size</th>
                                <th className="text-right py-1 pr-2 font-medium" style={{ color: '#949E9C' }}>Entry</th>
                                <th className="text-right py-1 pr-2 font-medium" style={{ color: '#949E9C' }}>Mark</th>
                                <th className="text-right py-1 font-medium" style={{ color: '#949E9C' }}>PnL</th>
                              </tr>
                            </thead>
                            <tbody>
                              {positions.map((pos) => {
                                const market = markets.find(m => m.symbol === pos.symbol);
                                const sizeStr = market
                                  ? fmtSizeByLot(pos.size, market.lotSize)
                                  : pos.size.toString();
                                const entryStr = market
                                  ? fmtPriceByTick(pos.entryPrice, market.tickSize)
                                  : pos.entryPrice.toString();
                                const markStr = market
                                  ? fmtPriceByTick(pos.markPrice, market.tickSize)
                                  : pos.markPrice.toString();
                                const pnl = pos.unrealizedPnl;
                                const pnlColor = pnl >= 0 ? '#5fd8ee' : '#ED7088';
                                const pnlStr = `${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                                return (
                                  <tr key={pos.symbol} style={{ borderBottom: '1px solid #1B2429' }}>
                                    <td className="py-1 pr-2 text-white tabular-nums">{pos.symbol}</td>
                                    <td className="py-1 pr-2 font-semibold tabular-nums" style={{ color: pos.side === 'long' ? '#5fd8ee' : '#ED7088' }}>
                                      {pos.side === 'long' ? 'Long' : 'Short'}
                                    </td>
                                    <td className="py-1 pr-2 text-right text-white tabular-nums">{sizeStr}</td>
                                    <td className="py-1 pr-2 text-right tabular-nums" style={{ color: '#949E9C' }}>{entryStr}</td>
                                    <td className="py-1 pr-2 text-right tabular-nums" style={{ color: '#949E9C' }}>{markStr}</td>
                                    <td className="py-1 text-right font-semibold tabular-nums" style={{ color: pnlColor }}>{pnlStr}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {spot.length > 0 && (
                        <div className={positions.length > 0 ? 'mt-2 pt-2' : ''} style={positions.length > 0 ? { borderTop: '1px dashed #1B2429' } : undefined}>
                          <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: '#5a6469' }}>
                            Spot (non-USDC)
                          </div>
                          <table className="w-full text-[10px]">
                            <thead>
                              <tr style={{ borderBottom: '1px solid #273035' }}>
                                <th className="text-left py-1 pr-2 font-medium" style={{ color: '#949E9C' }}>Token</th>
                                <th className="text-right py-1 pr-2 font-medium" style={{ color: '#949E9C' }}>Balance</th>
                                <th className="text-right py-1 font-medium" style={{ color: '#949E9C' }}>Entry Notional</th>
                              </tr>
                            </thead>
                            <tbody>
                              {spot.map((b) => (
                                <tr key={b.coin} style={{ borderBottom: '1px solid #1B2429' }}>
                                  <td className="py-1 pr-2 text-white">{b.coin}</td>
                                  <td className="py-1 pr-2 text-right text-white tabular-nums">
                                    {parseFloat(b.total).toLocaleString('en-US', { maximumFractionDigits: 6 })}
                                  </td>
                                  <td className="py-1 text-right tabular-nums" style={{ color: '#949E9C' }}>
                                    ${parseFloat(b.entryNtl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            });
            })()}
          </div>

          {/* Positions heatmap — below grid */}
          {dexPositions.length > 0 && <PositionsHeatmap dexPositions={dexPositions} />}
        </div>
      )}
    </div>
  );
}
