'use client';

/**
 * RecentTrades — HL 스타일 최근 체결 내역
 *
 * HL 특징:
 * - 헤더에 단위 표시: Price / Size (BTC) / Time
 * - 시간 포맷: HH:MM:SS
 * - 사이즈 컬러: buy=green, sell=red (HL은 가격만 컬러)
 */

import { fmtSizeByLot, fmtPriceByTick } from '../utils/displayComputations';
import type { Trade } from '../types/perp.types';

interface Props {
  trades: Trade[];
  baseToken: string;
  /** Market tickSize — price column matches the chart / orderbook. Without
   *  this the price falls back to 2dp which is wrong for low-priced assets
   *  (PEPE, BONK) or coarse-ticked majors (BTC @ $1 tick). */
  tickSize?: number;
  /** Market lotSize — size column uses `-log10(lotSize)` decimals instead
   *  of a hardcoded 4dp (wrong for HYPE 2dp, PURR 0dp, BTC 5dp, etc.). */
  lotSize?: number;
}

export function RecentTrades({ trades, baseToken, tickSize, lotSize }: Props) {
  return (
    <div className="flex flex-col overflow-hidden h-full">
      {/* Header */}
      <div className="grid grid-cols-3 px-3 py-1 text-xs flex-shrink-0" style={{ color: '#949E9C', borderBottom: '1px solid #273035' }}>
        <span>Price</span>
        <span className="text-right">Size ({baseToken})</span>
        <span className="text-right">Time</span>
      </div>

      {/* Trades list */}
      <div className="overflow-y-auto flex-1">
        {trades.map((trade, i) => (
          <div
            key={`${trade.id}-${i}`}
            className="grid grid-cols-3 px-3 py-[1px] text-xs hover:bg-[#1a2830] transition-colors"
          >
            <span className={`tabular-nums ${trade.side === 'long' ? 'text-[#5fd8ee]' : 'text-[#ED7088]'}`}>
              {tickSize ? fmtPriceByTick(trade.price, tickSize) : trade.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
            <span className="text-right text-gray-300 tabular-nums">
              {lotSize ? fmtSizeByLot(trade.size, lotSize) : trade.size.toFixed(4)}
            </span>
            <span className="text-right tabular-nums" style={{ color: '#949E9C' }}>
              {new Date(trade.timestamp).toLocaleTimeString('en-US', { hour12: false })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
