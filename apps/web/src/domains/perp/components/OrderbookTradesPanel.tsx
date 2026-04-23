'use client';

/**
 * OrderbookTradesPanel — Order Book / Trades 탭 패널 (HL 스타일)
 */

import { useState } from 'react';
import { OrderbookPanel } from './OrderbookPanel';
import { RecentTrades } from './RecentTrades';
import type { Trade } from '../types/perp.types';

type Tab = 'orderbook' | 'trades';

interface Props {
  trades: Trade[];
  symbol: string; // e.g. "BTC-PERP"
  /** Market tickSize — threaded through to OrderbookPanel + RecentTrades so
   *  the price column stays aligned with the TradingChart OHLC header for
   *  every asset on every DEX. */
  tickSize?: number;
  /** Market lotSize — threaded through to OrderbookPanel + RecentTrades
   *  so the size column uses per-asset decimal granularity instead of a
   *  hardcoded .toFixed(4). */
  lotSize?: number;
  onPriceClick: (price: number) => void;
}

export function OrderbookTradesPanel({ trades, symbol, tickSize, lotSize, onPriceClick }: Props) {
  const [tab, setTab] = useState<Tab>('orderbook');

  // "BTC-PERP" → "BTC"
  const baseToken = symbol.split('-')[0] || symbol;

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: '#0F1A1F' }}>
      {/* Tab header */}
      <div className="flex items-center flex-shrink-0" style={{ borderBottom: '1px solid #273035' }}>
        <button
          onClick={() => setTab('orderbook')}
          className={`px-4 py-2 text-xs font-medium transition-colors ${
            tab === 'orderbook' ? 'text-white' : 'text-gray-500 hover:text-gray-300'
          }`}
          style={tab === 'orderbook' ? { borderBottom: '2px solid #5fd8ee' } : undefined}
        >
          Order Book
        </button>
        <button
          onClick={() => setTab('trades')}
          className={`px-4 py-2 text-xs font-medium transition-colors ${
            tab === 'trades' ? 'text-white' : 'text-gray-500 hover:text-gray-300'
          }`}
          style={tab === 'trades' ? { borderBottom: '2px solid #5fd8ee' } : undefined}
        >
          Trades
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'orderbook' && (
          <OrderbookPanel symbol={symbol} baseToken={baseToken} tickSize={tickSize} lotSize={lotSize} onPriceClick={onPriceClick} />
        )}
        {tab === 'trades' && (
          <div className="h-full overflow-y-auto">
            <RecentTrades trades={trades} baseToken={baseToken} tickSize={tickSize} lotSize={lotSize} />
          </div>
        )}
      </div>
    </div>
  );
}
