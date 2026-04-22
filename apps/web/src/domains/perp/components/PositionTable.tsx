'use client';

/**
 * PositionTable — HL 스타일 하단 탭 패널
 * Balances, Positions, Open Orders, Trade History, Funding History, Order History
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import type { PerpPosition, PerpOrder, Fill, PerpAccountState, SpotBalance, PerpMarket } from '../types/perp.types';
import type { FundingHistoryEntry, OrderStatus } from '@hq/core/defi/perp';
import { usePerpStore } from '../stores/usePerpStore';
import { usePerpDeps } from '../providers/PerpDepsProvider';
import { usePerpAdapter, useDexId } from '../hooks/usePerpAdapter';
import { useAgentActive } from '../hooks/useAgentActive';
import { fmtSizeByLot } from '../utils/displayComputations';

/** Format size with per-market decimals (BTC: 5dp, ETH: 4dp, etc.). Falls
 *  back to 4dp when the market (or its lotSize) is unknown. */
function fmtSizeBySymbol(size: number, market: PerpMarket | undefined): string {
  return market ? fmtSizeByLot(size, market.lotSize) : size.toFixed(4);
}

type PositionFilter = 'all' | 'current' | 'with_pnl';

const FILTER_LABELS: Record<PositionFilter, string> = {
  all: 'All',
  current: 'Current Market',
  with_pnl: 'With PnL',
};

interface Props {
  accountState: PerpAccountState | null;
  spotBalances: SpotBalance[];
  positions: PerpPosition[];
  openOrders: PerpOrder[];
  fills: Fill[];
  orderHistory: PerpOrder[];
  fundingHistory: FundingHistoryEntry[];
  markets: PerpMarket[];
  onClosePosition: (symbol: string) => void;
  onCancelOrder: (orderId: string, symbol: string) => void;
}

type Tab = 'balances' | 'positions' | 'orders' | 'fills' | 'funding' | 'orderHistory';

const TABS: { key: Tab; label: string }[] = [
  { key: 'balances', label: 'Balances' },
  { key: 'positions', label: 'Positions' },
  { key: 'orders', label: 'Open Orders' },
  { key: 'fills', label: 'Trade History' },
  { key: 'funding', label: 'Funding History' },
  { key: 'orderHistory', label: 'Order History' },
];

export function PositionTable({ accountState, spotBalances, positions, openOrders, fills, orderHistory, fundingHistory, markets, onClosePosition, onCancelOrder }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('balances');
  const [positionFilter, setPositionFilter] = useState<PositionFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [tpslTarget, setTpslTarget] = useState<PerpPosition | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const selectedSymbol = usePerpStore(s => s.selectedSymbol);
  const dexId = useDexId();
  // Lighter's Open Orders / Fills / Order History require an authenticated
  // endpoint (`/accountActiveOrders` + similar) which we have not wired
  // yet, so the adapter returns []. Surface a banner to prevent users
  // from seeing "No open orders" and concluding their order wasn't placed
  // (→ double-submit risk).
  const lighterStubbedTabs = dexId === 'lighter'
    && (activeTab === 'orders' || activeTab === 'fills' || activeTab === 'orderHistory');

  // Close dropdown on outside click
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [filterOpen]);

  const filteredPositions = useMemo(() => {
    if (positionFilter === 'current') {
      return positions.filter(p => p.symbol === selectedSymbol);
    }
    if (positionFilter === 'with_pnl') {
      return positions.filter(p => p.unrealizedPnl !== 0);
    }
    return positions;
  }, [positions, positionFilter, selectedSymbol]);

  const spotCount = spotBalances.filter(b => parseFloat(b.total) > 0).length;
  const getCount = (tab: Tab): number => {
    switch (tab) {
      case 'balances': return spotCount;
      case 'positions': return positions.length;
      case 'orders': return openOrders.length;
      default: return 0;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: '#0F1A1F' }}>
      {/* Tabs */}
      <div className="flex items-center overflow-x-auto scrollbar-hide flex-shrink-0" style={{ borderBottom: '1px solid #273035' }}>
        {TABS.map(tab => {
          const count = getCount(tab.key);
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.key
                  ? 'text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
              style={activeTab === tab.key ? { borderBottom: '2px solid #5fd8ee' } : undefined}
            >
              {tab.label}
              {count > 0 && (
                <span className="ml-1 text-xs text-gray-500">({count})</span>
              )}
            </button>
          );
        })}

        {/* Filter dropdown — only visible on positions tab */}
        {activeTab === 'positions' && (
          <div className="ml-auto pr-3 relative flex-shrink-0" ref={filterRef}>
            <button
              onClick={() => setFilterOpen(prev => !prev)}
              className="flex items-center gap-1 px-2 py-1 text-xs hover:bg-[#1a2830] transition-colors"
              style={{ border: '1px solid #273035', borderRadius: 2 }}
            >
              <span style={{ color: '#949E9C' }}>Filter:</span>
              <span className="text-white">{FILTER_LABELS[positionFilter]}</span>
              <svg
                className="w-3 h-3 ml-0.5"
                style={{ color: '#949E9C', transform: filterOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}
                viewBox="0 0 12 12"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {filterOpen && (
              <div
                className="absolute right-3 top-full mt-0.5 z-40 py-1"
                style={{ backgroundColor: '#1a2830', border: '1px solid #273035', borderRadius: 2, minWidth: 140 }}
              >
                {(Object.keys(FILTER_LABELS) as PositionFilter[]).map(key => (
                  <button
                    key={key}
                    onClick={() => { setPositionFilter(key); setFilterOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#243540] transition-colors ${
                      positionFilter === key ? 'text-white' : 'text-gray-400'
                    }`}
                  >
                    {FILTER_LABELS[key]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lighter: open-orders / fills / history tabs use an auth endpoint
          we haven't wired — warn so users don't mistake [] for "no orders" */}
      {lighterStubbedTabs && (
        <div
          className="flex-shrink-0 px-3 py-2 text-[11px]"
          style={{ borderBottom: '1px solid #273035', backgroundColor: 'rgba(237,112,136,0.08)', color: '#ED7088' }}
        >
          Lighter Open Orders / Fills / Order History are not yet wired in this client. Your
          orders ARE being placed — view them on{' '}
          <a href="https://app.lighter.xyz" target="_blank" rel="noreferrer" className="underline">
            app.lighter.xyz
          </a>{' '}
          until we finish the authenticated endpoint integration.
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto scrollbar-hide">
        {activeTab === 'balances' && <BalancesContent accountState={accountState} spotBalances={spotBalances} markets={markets} />}
        {activeTab === 'positions' && <PositionsContent positions={filteredPositions} markets={markets} onClose={onClosePosition} onTpSl={(pos) => setTpslTarget(pos)} onSelectSymbol={(sym) => usePerpStore.getState().setSelectedSymbol(sym)} />}
        {activeTab === 'orders' && <OrdersContent orders={openOrders} markets={markets} onCancel={onCancelOrder} />}
        {activeTab === 'fills' && <FillsContent fills={fills} markets={markets} />}
        {activeTab === 'funding' && <FundingHistoryContent entries={fundingHistory} markets={markets} />}
        {activeTab === 'orderHistory' && <OrderHistoryContent orderHistory={orderHistory} markets={markets} />}
      </div>
      {tpslTarget && (
        <TpSlModal
          position={tpslTarget}
          onClose={() => setTpslTarget(null)}
        />
      )}
    </div>
  );
}

// Grid templates per tab. The general rule is:
//  - "Coin" column gets a small fixed extra width so its content doesn't
//    visually butt up against the next column.
//  - Numeric data columns share the same `minmax(min, 1fr)` so they end
//    up the same width — no column stretches disproportionately.
//  - Action button cells (Close, TP/SL, Cancel, Send, Transfer, …) stay
//    on tight fixed widths so buttons don't grow oddly.
//  - Where action buttons take noticeably less space than data cols a
//    trailing `minmax(0, 1fr)` absorbs the remainder so the grid still
//    spans the full container width without inflating numeric cells.
//
// Balances: Coin gets a wider fixed slot for breathing room, while the
// 4 balance/value columns are kept tight and even so the numbers cluster
// next to each other instead of floating across hundreds of pixels.
const BALANCES_GRID =
  '100px minmax(150px, 1fr) minmax(150px, 1fr) minmax(100px, 1fr) minmax(130px, 1fr) 60px minmax(140px, 1fr) minmax(80px, 1fr)';

function BalancesContent({ accountState, spotBalances, markets }: { accountState: PerpAccountState | null; spotBalances: SpotBalance[]; markets: PerpMarket[] }) {
  const store = usePerpStore();
  const { showToast } = usePerpDeps();

  // 마켓 가격 맵: coin → markPrice (USDC 가치 계산용)
  const priceMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of markets) {
      map.set(m.baseAsset, m.markPrice);
    }
    return map;
  }, [markets]);

  // Per-asset lot size map: coin → lotSize (for display decimals).
  // Prefer spot markets when both spot + perp exist (spot has finer
  // granularity for tokens like HYPE). Fallback = any market's lotSize.
  const lotSizeMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of markets) {
      const existing = map.get(m.baseAsset);
      if (existing === undefined || m.assetType === 'spot') {
        map.set(m.baseAsset, m.lotSize);
      }
    }
    return map;
  }, [markets]);

  if (!accountState) {
    return <EmptyState message="Connect wallet to view balances" />;
  }

  // HL split account: USDC lives in TWO places — spot (`spotClearinghouseState
  // .balances[USDC]`) and perp (`marginSummary.accountValue`). Show their SUM
  // as the user's total USDC wallet balance. Pacifica/Lighter/Aster have a
  // single USDC pool so their spotBalances are empty and the total collapses
  // to just `accountState.totalEquity`.
  //
  // Hold (= amount locked by open spot orders) only applies to spot USDC;
  // perp margin lockup is already reflected in `availableBalance` (HL
  // `withdrawable`).
  type BalanceRow = {
    coin: string;
    totalNum: number;
    available: number;
    entryNtl: number;
    usdcValue: number;
    pnl: number;
    pnlPct: number;
    isUsdc: boolean;
  };

  const nonUsdcSpot: BalanceRow[] = spotBalances
    .filter(b => b.coin !== 'USDC')
    .filter(b => parseFloat(b.total) > 0)
    .map(b => {
      const total = parseFloat(b.total);
      const hold = parseFloat(b.hold);
      const entryNtl = parseFloat(b.entryNtl);
      const usdcValue = (priceMap.get(b.coin) ?? 0) * total;
      const pnl = entryNtl > 0 ? usdcValue - entryNtl : 0;
      const pnlPct = entryNtl > 0 ? (pnl / entryNtl) * 100 : 0;
      return {
        coin: b.coin,
        totalNum: total,
        available: total - hold,
        entryNtl,
        usdcValue,
        pnl,
        pnlPct,
        isUsdc: false,
      };
    });

  const spotUsdc = spotBalances.find(b => b.coin === 'USDC');
  const spotUsdcTotal = spotUsdc ? parseFloat(spotUsdc.total) : 0;
  const spotUsdcHold = spotUsdc ? parseFloat(spotUsdc.hold) : 0;
  const spotUsdcAvailable = spotUsdcTotal - spotUsdcHold;

  const usdcTotal = accountState.totalEquity + spotUsdcTotal;
  const usdcAvailable = accountState.availableBalance + spotUsdcAvailable;
  const usdcRow: BalanceRow = {
    coin: 'USDC',
    totalNum: usdcTotal,
    available: usdcAvailable,
    entryNtl: 0,
    usdcValue: usdcTotal,
    pnl: 0,
    pnlPct: 0,
    isUsdc: true,
  };
  const spotRows: BalanceRow[] = usdcTotal > 0
    ? [usdcRow, ...nonUsdcSpot]
    : nonUsdcSpot;

  return (
    <>
      {/* Column header */}
      <div className="grid text-xs px-3 py-1.5" style={{ color: '#949E9C', gridTemplateColumns: BALANCES_GRID }}>
        <span>Coin</span>
        <span>Total Balance</span>
        <span>Available Balance</span>
        <span className="text-right flex items-center justify-end gap-0.5">
          USDC Value
          <svg className="inline w-2.5 h-2.5 ml-0.5" viewBox="0 0 10 10" fill="currentColor">
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </span>
        <span className="text-right underline decoration-dotted cursor-default">PNL (ROE %)</span>
        <span className="text-right">Send</span>
        <span className="text-right">Transfer</span>
        <span className="text-right">Contract</span>
      </div>
      {spotRows.map(row => (
        <div
          key={row.coin}
          onClick={() => !row.isUsdc && store.setSelectedSymbol(row.coin)}
          className={`grid items-center px-3 py-1.5 text-xs hover:bg-[#1a2830] ${row.isUsdc ? 'cursor-default' : 'cursor-pointer'}`}
          style={{ gridTemplateColumns: BALANCES_GRID }}
        >
          <span className={`font-medium ${row.isUsdc ? 'text-white' : 'text-[#5fd8ee]'}`}>{row.coin}</span>
          {(() => {
            // USDC always renders at 8dp (cent-smaller increments are common
            // with funding/PnL accrual). Non-USDC follows the market's
            // lotSize so HYPE (2dp) ≠ PURR (0dp) ≠ BTC (5dp).
            const coinLotSize = lotSizeMap.get(row.coin);
            const renderSize = (n: number) =>
              row.isUsdc ? n.toFixed(8) : (coinLotSize ? fmtSizeByLot(n, coinLotSize) : n.toFixed(5));
            return (
              <>
                <span className="text-white tabular-nums">{renderSize(row.totalNum)} {row.coin}</span>
                <span className="text-white tabular-nums">{renderSize(row.available)} {row.coin}</span>
              </>
            );
          })()}
          <span className="text-right text-white tabular-nums">
            {row.usdcValue > 0 ? `$${row.usdcValue.toFixed(2)}` : '—'}
          </span>
          <span className={`text-right tabular-nums ${row.pnl >= 0 ? 'text-[#5fd8ee]' : 'text-[#ED7088]'}`}>
            {row.entryNtl > 0 && !row.isUsdc
              ? `${row.pnl >= 0 ? '+' : ''}$${row.pnl.toFixed(2)} (${row.pnlPct >= 0 ? '+' : ''}${row.pnlPct.toFixed(1)}%)`
              : '—'
            }
          </span>
          {/* Send */}
          <span className="text-right">
            <button
              className="text-[#5fd8ee] hover:text-[#93E3F3] transition-colors"
              onClick={e => { e.stopPropagation(); showToast({ title: `Send ${row.coin}`, type: 'info' }); }}
            >
              Send
            </button>
          </span>
          {/* Transfer */}
          <span className="text-right">
            <button
              className="text-[#5fd8ee] hover:text-[#93E3F3] transition-colors"
              onClick={e => { e.stopPropagation(); showToast({ title: `Transfer ${row.coin}`, type: 'info' }); }}
            >
              {row.isUsdc ? 'Transfer to Perps' : 'Transfer to/from EVM'}
            </button>
          </span>
          {/* Contract — TODO: use tokenId from SpotBalance once available */}
          <span className="text-right text-gray-400 tabular-nums">
            {/* TODO: replace with real contract address from b.tokenId when SpotBalance exposes it */}
            —
          </span>
        </div>
      ))}
      {spotRows.length === 0 && (
        <div className="text-center py-4 text-gray-500 text-xs">No balances yet</div>
      )}
    </>
  );
}

// Positions: fixed Coin width + uniform `minmax(110, 1fr)` for the 8
// numeric columns (Size … Funding) so they all end up the same width
// no matter the viewport. Close / TP/SL stay fixed at 80px each.
const POSITIONS_GRID =
  '110px minmax(110px, 1fr) minmax(110px, 1fr) minmax(110px, 1fr) minmax(110px, 1fr) minmax(110px, 1fr) minmax(110px, 1fr) minmax(110px, 1fr) minmax(110px, 1fr) 80px 80px';

/** Compute the price decimal count from a market's tickSize. A tickSize
 *  of 0.0001 → 4 decimals, 0.01 → 2 decimals, etc. Small-value tokens
 *  like PURR ($0.0784) need 4 decimals; majors like BTC ($72k) need 1.
 *  Falls back to 2 if tickSize is missing or non-positive. */
function priceDecimals(tickSize: number | undefined): number {
  if (!tickSize || !(tickSize > 0)) return 2;
  const d = Math.round(-Math.log10(tickSize));
  return Math.max(0, Math.min(8, d));
}

function fmtPriceBySymbol(price: number, market: PerpMarket | undefined): string {
  const d = priceDecimals(market?.tickSize);
  return price.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function PositionsContent({ positions, markets, onClose, onTpSl, onSelectSymbol }: { positions: PerpPosition[]; markets: PerpMarket[]; onClose: (symbol: string) => void; onTpSl: (pos: PerpPosition) => void; onSelectSymbol: (symbol: string) => void }) {

  if (positions.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-xs text-gray-500">
        No open positions yet
      </div>
    );
  }

  const marketBySymbol = new Map(markets.map(m => [m.symbol, m]));

  return (
    <>
      {/* Header */}
      <div
        className="grid text-xs px-3 py-1.5"
        style={{ color: '#949E9C', gridTemplateColumns: POSITIONS_GRID, borderBottom: '1px solid #273035' }}
      >
        <span>Coin</span>
        <span>Size</span>
        <span className="text-right">Position Value</span>
        <span className="text-right">Entry Price</span>
        <span className="text-right">Mark Price</span>
        <span className="text-right">PnL (ROE)</span>
        <span className="text-right">Liq. Price</span>
        <span className="text-right">Margin</span>
        <span className="text-right">Funding</span>
        <span className="text-right">Close All</span>
        <span className="text-right">TP/SL</span>
      </div>

      {/* Rows */}
      {positions.map(pos => {
        const market = marketBySymbol.get(pos.symbol);
        const positionValue = Math.abs(pos.size) * pos.markPrice;
        const pnlPositive = pos.unrealizedPnl >= 0;
        const pnlColor = pnlPositive ? '#5fd8ee' : '#ED7088';
        const pnlSign = pnlPositive ? '+' : '';
        const roeSign = pos.returnOnEquity >= 0 ? '+' : '';
        // fundingPayment sign already follows "positive = user gain"
        // (flipped in HyperliquidPerpAdapter.parsePositions). Green when
        // the user received funding, red when they paid.
        const fundingPositive = pos.fundingPayment >= 0;
        const fundingColor = fundingPositive ? '#5fd8ee' : '#ED7088';
        const fundingSign = fundingPositive ? '+' : '';

        return (
          <div
            key={`${pos.symbol}:${pos.side}`}
            onClick={() => onSelectSymbol(pos.symbol)}
            className="grid items-center px-3 py-1.5 text-xs cursor-pointer hover:bg-[#1a2830]"
            style={{ gridTemplateColumns: POSITIONS_GRID, borderBottom: '1px solid #273035' }}
          >
            {/* Coin + leverage badge (HL-style: "BTC 10x Cross" under the name) */}
            <span className="flex flex-col gap-0.5">
              <span className="font-medium" style={{ color: pos.side === 'long' ? '#5fd8ee' : '#ED7088' }}>
                {marketBySymbol.get(pos.symbol)?.name ?? pos.symbol}
              </span>
              {pos.leverage > 0 && (
                <span className="text-[10px] text-gray-500 tabular-nums">
                  {pos.leverage}x {pos.leverageType === 'isolated' ? 'Iso' : 'Cross'}
                </span>
              )}
            </span>

            {/* Size — decimal count follows the market's lotSize */}
            <span className="text-white tabular-nums">
              {pos.side === 'short' ? '-' : ''}{fmtSizeBySymbol(pos.size, market)}
            </span>

            {/* Position Value */}
            <span className="text-right text-white tabular-nums">
              ${positionValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>

            {/* Entry Price — decimal count follows the market's tickSize */}
            <span className="text-right text-gray-300 tabular-nums">
              {fmtPriceBySymbol(pos.entryPrice, market)}
            </span>

            {/* Mark Price — decimal count follows the market's tickSize */}
            <span className="text-right text-gray-300 tabular-nums">
              {fmtPriceBySymbol(pos.markPrice, market)}
            </span>

            {/* PnL (ROE) */}
            <span className="text-right tabular-nums font-medium" style={{ color: pnlColor }}>
              {pnlSign}${pos.unrealizedPnl.toFixed(2)} ({roeSign}{pos.returnOnEquity.toFixed(2)}%)
            </span>

            {/* Liq. Price — decimal count follows the market's tickSize */}
            <span className="text-right text-gray-300 tabular-nums">
              {pos.liquidationPrice !== null
                ? fmtPriceBySymbol(pos.liquidationPrice, market)
                : '—'}
            </span>

            {/* Margin */}
            <span className="text-right text-gray-300 tabular-nums">
              ${pos.marginUsed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>

            {/* Funding — own color based on received/paid, independent of PnL */}
            <span className="text-right tabular-nums" style={{ color: fundingColor }}>
              {fundingSign}${Math.abs(pos.fundingPayment).toFixed(4)}
            </span>

            {/* Close button */}
            <span className="text-right">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(pos.symbol);
                }}
                className="text-[#ED7088] hover:bg-[#ED7088]/10 border border-[#ED7088]/30 rounded px-2 py-0.5 text-xs"
              >
                Close
              </button>
            </span>

            {/* TP/SL button */}
            <span className="text-right">
              <button
                onClick={(e) => { e.stopPropagation(); onTpSl(pos); }}
                className="text-[#5fd8ee] hover:bg-[#5fd8ee]/10 border border-[#5fd8ee]/30 rounded px-2 py-0.5 text-xs"
              >
                TP/SL
              </button>
            </span>
          </div>
        );
      })}
    </>
  );
}

// Open Orders: 11 data cols all share `minmax(100, 1fr)` so they stay
// uniform; Cancel button stays fixed.
const ORDERS_GRID =
  'minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) 80px';

function OrdersContent({ orders, markets, onCancel }: { orders: PerpOrder[]; markets: PerpMarket[]; onCancel: (orderId: string, symbol: string) => void }) {
  if (orders.length === 0) {
    return <EmptyState message="No open orders" />;
  }
  const marketBySymbol = new Map(markets.map(m => [m.symbol, m]));

  return (
    <>
      {/* Header */}
      <div
        className="grid text-xs px-3 py-1.5"
        style={{ color: '#949E9C', gridTemplateColumns: ORDERS_GRID, borderBottom: '1px solid #273035' }}
      >
        <span>Time</span>
        <span>Type</span>
        <span>Coin</span>
        <span>Direction</span>
        <span className="text-right">Size</span>
        <span className="text-right">Original Size</span>
        <span className="text-right">Order Value</span>
        <span className="text-right">Price</span>
        <span className="text-right">Reduce Only</span>
        <span className="text-right">Trigger Conditions</span>
        <span className="text-right">TP/SL</span>
        <span className="text-right">Cancel</span>
      </div>

      {/* Rows */}
      {orders.map(order => {
        const time = new Date(order.timestamp).toLocaleString([], {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        const typeLabel = order.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const orderMarket = marketBySymbol.get(order.symbol);
        const originalSize = fmtSizeBySymbol(order.size + order.filledSize, orderMarket);
        const orderValue = `$${(order.size * (order.price ?? 0)).toFixed(2)}`;
        const priceLabel = order.price !== null ? `$${order.price.toLocaleString()}` : 'Market';
        const triggerLabel = order.triggerPrice !== null ? `Mark ≥ ${order.triggerPrice}` : '—';
        const tpsl =
          order.tpPrice !== null || order.slPrice !== null
            ? `TP ${order.tpPrice ?? '—'} / SL ${order.slPrice ?? '—'}`
            : '—';

        return (
          <div
            key={order.orderId}
            className="grid items-center px-3 py-1.5 text-xs hover:bg-[#1a2830]"
            style={{ gridTemplateColumns: ORDERS_GRID, borderBottom: '1px solid #273035' }}
          >
            <span className="text-gray-400 tabular-nums">{time}</span>
            <span className="text-gray-300">{typeLabel}</span>
            <span className="text-white font-medium">{order.symbol}</span>
            <span className={order.side === 'long' ? 'text-[#5fd8ee]' : 'text-[#ED7088]'}>
              {order.side === 'long' ? 'Long' : 'Short'}
            </span>
            <span className="text-right text-white tabular-nums">{fmtSizeBySymbol(order.size, orderMarket)}</span>
            <span className="text-right text-gray-300 tabular-nums">{originalSize}</span>
            <span className="text-right text-gray-300 tabular-nums">{orderValue}</span>
            <span className="text-right text-gray-300 tabular-nums">{priceLabel}</span>
            <span className="text-right text-gray-400">{order.reduceOnly ? 'Yes' : 'No'}</span>
            <span className="text-right text-gray-400 tabular-nums">{triggerLabel}</span>
            <span className="text-right text-gray-400 tabular-nums">{tpsl}</span>
            <span className="text-right">
              <button
                onClick={(e) => { e.stopPropagation(); onCancel(order.orderId, order.symbol); }}
                className="px-2 py-1 text-xs text-gray-300 hover:text-white transition-colors"
                style={{ border: '1px solid #273035', borderRadius: 2 }}
              >
                Cancel
              </button>
            </span>
          </div>
        );
      })}
    </>
  );
}

// Trade History: 8 cols, no actions — uniform `minmax(120, 1fr)`.
const FILLS_GRID =
  'minmax(120px, 1fr) minmax(120px, 1fr) minmax(120px, 1fr) minmax(120px, 1fr) minmax(120px, 1fr) minmax(120px, 1fr) minmax(120px, 1fr) minmax(120px, 1fr)';

function FillsContent({ fills, markets }: { fills: Fill[]; markets: PerpMarket[] }) {
  if (fills.length === 0) {
    return <EmptyState message="No trade history" />;
  }
  const marketBySymbol = new Map(markets.map(m => [m.symbol, m]));

  return (
    <>
      {/* Header */}
      <div
        className="grid text-xs px-3 py-1.5"
        style={{ color: '#949E9C', gridTemplateColumns: FILLS_GRID, borderBottom: '1px solid #273035' }}
      >
        <span>Time</span>
        <span>Coin</span>
        <span>Direction</span>
        <span className="text-right">Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Trade Value</span>
        <span className="text-right">Fee</span>
        <span className="text-right">Closed PNL</span>
      </div>

      {/* Rows */}
      {fills.map(fill => {
        const time = new Date(fill.timestamp).toLocaleString([], {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        const tradeValue = fill.price * fill.size;
        const closedPnlPositive = fill.closedPnl >= 0;
        const closedPnlColor = fill.closedPnl === 0
          ? 'text-gray-500'
          : closedPnlPositive ? 'text-[#5fd8ee]' : 'text-[#ED7088]';

        return (
          <div
            key={fill.id}
            className="grid items-center px-3 py-1.5 text-xs hover:bg-[#1a2830]"
            style={{ gridTemplateColumns: FILLS_GRID, borderBottom: '1px solid #273035' }}
          >
            <span className="text-gray-400 tabular-nums">{time}</span>
            <span className="text-white font-medium">
              {fill.symbol}
              {fill.liquidation && <span className="ml-1 text-[#ED7088]">(Liq)</span>}
            </span>
            <span className={fill.side === 'long' ? 'text-[#5fd8ee]' : 'text-[#ED7088]'}>
              {fill.side === 'long' ? 'Long' : 'Short'}
            </span>
            <span className="text-right text-gray-300 tabular-nums">${fill.price.toLocaleString()}</span>
            <span className="text-right text-white tabular-nums">{fmtSizeBySymbol(fill.size, marketBySymbol.get(fill.symbol))}</span>
            <span className="text-right text-white tabular-nums">${tradeValue.toFixed(2)}</span>
            <span className="text-right text-gray-400 tabular-nums">${fill.fee.toFixed(4)}</span>
            <span className={`text-right tabular-nums ${closedPnlColor}`}>
              {fill.closedPnl === 0
                ? '—'
                : `${closedPnlPositive ? '+' : ''}$${fill.closedPnl.toFixed(2)}`}
            </span>
          </div>
        );
      })}
    </>
  );
}

// Funding History: 6 cols, no actions — uniform `minmax(160, 1fr)`.
const FUNDING_GRID =
  'minmax(160px, 1fr) minmax(160px, 1fr) minmax(160px, 1fr) minmax(160px, 1fr) minmax(160px, 1fr) minmax(160px, 1fr)';

function FundingHistoryContent({ entries, markets }: { entries: FundingHistoryEntry[]; markets: PerpMarket[] }) {
  if (entries.length === 0) return <EmptyState message="No funding history" />;
  const marketBySymbol = new Map(markets.map(m => [m.symbol, m]));

  return (
    <>
      <div
        className="grid text-xs px-3 py-1.5"
        style={{ color: '#949E9C', gridTemplateColumns: FUNDING_GRID, borderBottom: '1px solid #273035' }}
      >
        <span>Time</span>
        <span>Coin</span>
        <span className="text-right">Size</span>
        <span className="text-right">Side</span>
        <span className="text-right">Payment</span>
        <span className="text-right">Rate</span>
      </div>
      {entries.map((e, i) => {
        const isLong = e.size > 0;
        const paymentPositive = e.payment >= 0;
        const paymentColor = paymentPositive ? '#5fd8ee' : '#ED7088';
        return (
          <div
            key={`${e.timestamp}-${i}`}
            className="grid items-center px-3 py-1.5 text-xs hover:bg-[#1a2830]"
            style={{ gridTemplateColumns: FUNDING_GRID, borderBottom: '1px solid #273035' }}
          >
            <span className="text-gray-300 tabular-nums">
              {new Date(e.timestamp).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span className="text-white">{e.symbol}</span>
            <span className="text-right text-white tabular-nums">
              {fmtSizeBySymbol(Math.abs(e.size), marketBySymbol.get(e.symbol))}
            </span>
            <span className={`text-right ${isLong ? 'text-[#5fd8ee]' : 'text-[#ED7088]'}`}>
              {isLong ? 'Long' : 'Short'}
            </span>
            <span className="text-right tabular-nums" style={{ color: paymentColor }}>
              {paymentPositive ? '+' : ''}${e.payment.toFixed(4)}
            </span>
            <span className={`text-right tabular-nums ${e.rate >= 0 ? 'text-[#5fd8ee]' : 'text-[#ED7088]'}`}>
              {(e.rate * 100).toFixed(4)}%
            </span>
          </div>
        );
      })}
    </>
  );
}

// Order History: 13 cols, no actions — uniform `minmax(100, 1fr)`.
const ORDER_HISTORY_GRID =
  'minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr)';

const STATUS_LABEL: Record<OrderStatus, string> = {
  open: 'Open',
  filled: 'Filled',
  partially_filled: 'Partially Filled',
  cancelled: 'Canceled',
  rejected: 'Rejected',
  triggered: 'Triggered',
};

const STATUS_COLOR: Record<OrderStatus, string> = {
  open: '#FFA94D',
  filled: '#5fd8ee',
  partially_filled: '#FFA94D',
  cancelled: '#949E9C',
  rejected: '#ED7088',
  triggered: '#5fd8ee',
};

/**
 * Order History — backed by HL's `historicalOrders` info endpoint. Each row
 * represents a terminal-state order (filled / canceled / triggered / rejected)
 * or an order still `open`. Sorted by the statusTimestamp the adapter put on
 * `timestamp` during parsing, most recent first.
 */
function OrderHistoryContent({ orderHistory, markets }: { orderHistory: PerpOrder[]; markets: PerpMarket[] }) {
  const rows = useMemo(
    () => [...orderHistory].sort((a, b) => b.timestamp - a.timestamp),
    [orderHistory],
  );

  if (rows.length === 0) return <EmptyState message="No order history" />;
  const marketBySymbol = new Map(markets.map(m => [m.symbol, m]));

  return (
    <>
      <div
        className="grid text-xs px-3 py-1.5"
        style={{ color: '#949E9C', gridTemplateColumns: ORDER_HISTORY_GRID, borderBottom: '1px solid #273035' }}
      >
        <span>Time</span>
        <span>Type</span>
        <span>Coin</span>
        <span>Direction</span>
        <span className="text-right">Size</span>
        <span className="text-right">Filled</span>
        <span className="text-right">Order Value</span>
        <span className="text-right">Price</span>
        <span className="text-right">Reduce</span>
        <span>Trigger</span>
        <span>TP/SL</span>
        <span>Status</span>
        <span>Order ID</span>
      </div>
      {rows.map((order, idx) => {
        const isLong = order.side === 'long';
        const originalSize = order.size + order.filledSize;
        const typeLabel = order.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const priceLabel = order.price !== null && order.price > 0 ? `$${order.price.toLocaleString()}` : 'Market';
        const orderValue = (order.price ?? 0) * originalSize;
        const triggerLabel = order.triggerPrice !== null ? `Mark ≥ ${order.triggerPrice}` : '—';
        const tpslLabel =
          order.tpPrice !== null || order.slPrice !== null
            ? `TP ${order.tpPrice ?? '—'} / SL ${order.slPrice ?? '—'}`
            : '—';
        return (
          <div
            key={`${order.orderId}-${idx}`}
            className="grid items-center px-3 py-1.5 text-xs hover:bg-[#1a2830]"
            style={{ gridTemplateColumns: ORDER_HISTORY_GRID, borderBottom: '1px solid #273035' }}
          >
            <span className="text-gray-300 tabular-nums">
              {new Date(order.timestamp).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span className="text-gray-300">{typeLabel}</span>
            <span className="text-white">{order.symbol}</span>
            <span className={isLong ? 'text-[#5fd8ee]' : 'text-[#ED7088]'}>
              {isLong ? 'Long' : 'Short'}
            </span>
            <span className="text-right text-white tabular-nums">{fmtSizeBySymbol(originalSize, marketBySymbol.get(order.symbol))}</span>
            <span className="text-right text-gray-300 tabular-nums">{fmtSizeBySymbol(order.filledSize, marketBySymbol.get(order.symbol))}</span>
            <span className="text-right text-gray-300 tabular-nums">${orderValue.toFixed(2)}</span>
            <span className="text-right text-gray-300 tabular-nums">{priceLabel}</span>
            <span className="text-right text-gray-300">{order.reduceOnly ? 'Yes' : 'No'}</span>
            <span className="text-gray-300 truncate">{triggerLabel}</span>
            <span className="text-gray-300 truncate">{tpslLabel}</span>
            <span style={{ color: STATUS_COLOR[order.status] }}>{STATUS_LABEL[order.status]}</span>
            <span className="text-gray-500 font-mono truncate">{order.orderId.slice(0, 8)}</span>
          </div>
        );
      })}
    </>
  );
}

// ============================================================
// TpSlModal
// ============================================================

function TpSlModal({ position, onClose }: { position: PerpPosition; onClose: () => void }) {
  const adapter = usePerpAdapter();
  const deps = usePerpDeps();
  const isAgentActive = useAgentActive();

  const [tpPrice, setTpPrice] = useState('');
  const [slPrice, setSlPrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isLong = position.side === 'long';

  function validate(): string | null {
    const tp = tpPrice ? parseFloat(tpPrice) : null;
    const sl = slPrice ? parseFloat(slPrice) : null;
    if (tp !== null && isNaN(tp)) return 'Invalid TP price';
    if (sl !== null && isNaN(sl)) return 'Invalid SL price';
    if (tp !== null) {
      if (isLong && tp <= position.entryPrice) return 'TP must be above entry price for long';
      if (!isLong && tp >= position.entryPrice) return 'TP must be below entry price for short';
    }
    if (sl !== null) {
      if (isLong && sl >= position.entryPrice) return 'SL must be below entry price for long';
      if (!isLong && sl <= position.entryPrice) return 'SL must be above entry price for short';
    }
    if (tp === null && sl === null) return 'Enter at least one of TP or SL';
    return null;
  }

  async function handleConfirm() {
    if (!isAgentActive) {
      deps.showToast({ title: 'Enable Trading first', type: 'warning' });
      return;
    }
    const err = validate();
    if (err) {
      deps.showToast({ title: err, type: 'warning' });
      return;
    }
    const tp = tpPrice ? parseFloat(tpPrice) : null;
    const sl = slPrice ? parseFloat(slPrice) : null;
    const signFn = deps.getSignFn();
    const vaultAddress = deps.getVaultAddress() ?? undefined;
    const closeSide = isLong ? ('short' as const) : ('long' as const);
    // Separate trigger orders per leg — only HL's adapter reads the old
    // `tpsl` attachment, so a single limit+tpsl closed at mark on the
    // other three venues instead of waiting for the trigger.
    const legs: Array<{ label: 'TP' | 'SL'; type: 'take_market' | 'stop_market'; price: number }> = [];
    if (tp !== null) legs.push({ label: 'TP', type: 'take_market', price: tp });
    if (sl !== null) legs.push({ label: 'SL', type: 'stop_market', price: sl });

    setIsSubmitting(true);
    const results = await Promise.allSettled(
      legs.map((leg) =>
        adapter.placeOrder({
          symbol: position.symbol,
          side: closeSide,
          type: leg.type,
          size: position.size,
          triggerPrice: leg.price,
          leverage: position.leverage,
          reduceOnly: true,
          timeInForce: 'gtc',
          vaultAddress,
        }, signFn).then((res) => ({ leg, res })),
      ),
    );
    setIsSubmitting(false);

    const failures: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const leg = legs[i];
      if (r.status === 'rejected') {
        const m = r.reason instanceof Error ? r.reason.message : String(r.reason);
        failures.push(`${leg.label}: ${m}`);
      } else if (!r.value.res.success) {
        failures.push(`${leg.label}: ${r.value.res.error ?? 'unknown error'}`);
      }
    }
    if (failures.length === 0) {
      const placed = legs.map((l) => l.label).join(' + ');
      deps.showToast({ title: `${placed} set successfully`, type: 'success' });
      onClose();
      return;
    }
    deps.showToast({
      title: failures.length === legs.length ? 'Failed to set TP/SL' : 'Partial TP/SL failure',
      message: failures.join(' · '),
      type: 'warning',
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm mx-4 p-5 flex flex-col gap-4"
        style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035', borderRadius: 4 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-white text-sm font-medium">TP/SL — {position.symbol}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-lg leading-none">&times;</button>
        </div>

        {/* Position info */}
        <div className="flex gap-4 text-xs" style={{ color: '#949E9C' }}>
          <span>
            Side: <span style={{ color: isLong ? '#5fd8ee' : '#ED7088' }}>{isLong ? 'Long' : 'Short'}</span>
          </span>
          <span>
            Entry: <span className="text-white tabular-nums">{position.entryPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </span>
          <span>
            Mark: <span className="text-white tabular-nums">{position.markPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </span>
        </div>

        {/* TP input */}
        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: '#949E9C' }}>
            Take Profit Price <span className="text-gray-600">({isLong ? 'above' : 'below'} entry)</span>
          </label>
          <input
            type="number"
            value={tpPrice}
            onChange={(e) => setTpPrice(e.target.value)}
            placeholder={isLong
              ? `> ${position.entryPrice.toFixed(2)}`
              : `< ${position.entryPrice.toFixed(2)}`}
            className="w-full px-3 py-2 text-sm text-white tabular-nums bg-transparent outline-none"
            style={{ border: '1px solid #273035', borderRadius: 2 }}
          />
        </div>

        {/* SL input */}
        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: '#949E9C' }}>
            Stop Loss Price <span className="text-gray-600">({isLong ? 'below' : 'above'} entry)</span>
          </label>
          <input
            type="number"
            value={slPrice}
            onChange={(e) => setSlPrice(e.target.value)}
            placeholder={isLong
              ? `< ${position.entryPrice.toFixed(2)}`
              : `> ${position.entryPrice.toFixed(2)}`}
            className="w-full px-3 py-2 text-sm text-white tabular-nums bg-transparent outline-none"
            style={{ border: '1px solid #273035', borderRadius: 2 }}
          />
        </div>

        {/* Agent warning */}
        {!isAgentActive && (
          <div className="text-xs px-3 py-2" style={{ backgroundColor: '#1a2830', border: '1px solid #273035', borderRadius: 2, color: '#FFA94D' }}>
            Enable Trading (agent wallet) to set TP/SL
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2 text-xs text-gray-300 hover:text-white transition-colors"
            style={{ border: '1px solid #273035', borderRadius: 2 }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isSubmitting || !isAgentActive}
            className="flex-1 py-2 text-xs font-medium transition-colors disabled:opacity-40"
            style={{ backgroundColor: '#5fd8ee', color: '#0F1A1F', borderRadius: 2 }}
          >
            {isSubmitting ? 'Submitting...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8 text-gray-500 text-xs">
      {message}
    </div>
  );
}
