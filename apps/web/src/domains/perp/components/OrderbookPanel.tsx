'use client';

/**
 * OrderbookPanel — HL 스타일 실시간 오더북
 *
 * - nSigFigs 기반 서버사이드 정밀도 제어 (틱 버튼 클릭 시 HL API에 nSigFigs 전달)
 * - 헤더에 단위 표시: Price / Size (BTC) / Total (USDC)
 * - Spread: 값 + 퍼센트
 * - 누적 depth bar
 * - 컨테이너 높이에 맞춰 동적 행 수
 */

import { useState, useMemo, useEffect } from 'react';
import { useOrderbook } from '../hooks/usePerpData';
import { fmtSizeByLot } from '../utils/displayComputations';
import type { Orderbook } from '../types/perp.types';

const ROW_HEIGHT = 23; // px per row — matches HL density
const ROWS_PER_SIDE = 11; // HL shows exactly 11 rows each side

interface Props {
  symbol: string;
  baseToken: string;
  /** Market lotSize — controls the size column's decimal padding (BTC 5dp,
   *  HYPE 2dp, PURR 0dp, etc.). Omit/undefined for a fallback of 4dp. */
  lotSize?: number;
  onPriceClick: (price: number) => void;
}

/**
 * 오더북 실제 호가 간격을 감지해서 가장 세밀한 tick을 반환.
 * HL은 토큰마다 tick이 다름 (BTC: $1, HYPE: $0.001, PEPE: 0.0000001 등)
 */
function detectTickFromOrderbook(orderbook: Orderbook): number {
  const levels = [...orderbook.asks, ...orderbook.bids].slice(0, 10);
  if (levels.length < 2) return 1;

  // 연속한 price 차이의 최솟값이 실제 tick
  const sorted = levels.map(l => l.price).sort((a, b) => a - b);
  let minDiff = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i] - sorted[i - 1];
    if (diff > 0 && diff < minDiff) minDiff = diff;
  }
  if (minDiff === Infinity || minDiff <= 0) return 1;

  // 표준 tick 중 가장 가까운 값으로 스냅
  const tickOptions = [0.00001, 0.0001, 0.001, 0.01, 0.1, 1, 10];
  for (const t of tickOptions) {
    if (minDiff <= t * 1.5) return t;
  }
  return 100;
}

/**
 * mid price + targetTick → HL nSigFigs 파라미터 계산
 * HL nSigFigs 범위: 2~5. natural precision이면 undefined 반환.
 */
function computeNSigFigs(price: number, targetTick: number): number | undefined {
  if (price <= 0 || targetTick <= 0) return undefined;
  const n = Math.ceil(Math.log10(price)) - Math.floor(Math.log10(targetTick));
  // natural precision (5+) → use default (undefined)
  if (n >= 5) return undefined;
  return Math.max(2, Math.min(5, n));
}

export function OrderbookPanel({ symbol, baseToken, lotSize, onPriceClick }: Props) {
  const [nSigFigs, setNSigFigs] = useState<number | undefined>(undefined);
  const [naturalTick, setNaturalTick] = useState<number>(1);

  const { data: orderbook } = useOrderbook(symbol, nSigFigs);

  // Reset nSigFigs when symbol changes
  useEffect(() => {
    setNSigFigs(undefined);
  }, [symbol]);

  // Update naturalTick from default orderbook (when not using nSigFigs)
  useEffect(() => {
    if (nSigFigs === undefined && orderbook) {
      setNaturalTick(detectTickFromOrderbook(orderbook));
    }
  }, [orderbook, nSigFigs]);

  // HL shows fixed 11 rows per side — no dynamic sizing needed

  // Tick button targets: naturalTick, *10, *100, *1000
  const tickTargets = useMemo(() => [
    naturalTick,
    naturalTick * 10,
    naturalTick * 100,
    naturalTick * 1000,
  ], [naturalTick]);

  // Current tick for priceDecimals: detect from current orderbook response
  const currentTick = useMemo(() => {
    if (!orderbook) return naturalTick;
    return detectTickFromOrderbook(orderbook);
  }, [orderbook, naturalTick]);

  const priceDecimals = currentTick >= 1
    ? 0
    : Math.max(0, Math.min(8, Math.ceil(-Math.log10(currentTick))));

  const { asks, bids, maxCumSize } = useMemo(() => {
    if (!orderbook) return { asks: [], bids: [], maxCumSize: 1 };

    // Server returns levels at the desired precision — use directly
    const rawAsks = [...orderbook.asks].slice(0, ROWS_PER_SIDE).reverse();
    const rawBids = [...orderbook.bids].slice(0, ROWS_PER_SIDE);

    let askCum = 0;
    let askCumTotal = 0;
    const asksWithCum = [...rawAsks].reverse().map(l => {
      askCum += l.size;
      askCumTotal += l.price * l.size;
      return { ...l, cumSize: askCum, cumTotal: askCumTotal };
    }).reverse();

    let bidCum = 0;
    let bidCumTotal = 0;
    const bidsWithCum = rawBids.map(l => {
      bidCum += l.size;
      bidCumTotal += l.price * l.size;
      return { ...l, cumSize: bidCum, cumTotal: bidCumTotal };
    });

    const maxCum = Math.max(
      asksWithCum[0]?.cumSize ?? 0,
      bidsWithCum[bidsWithCum.length - 1]?.cumSize ?? 0,
      1,
    );

    return { asks: asksWithCum, bids: bidsWithCum, maxCumSize: maxCum };
  }, [orderbook]);

  if (!orderbook) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-gray-500 text-sm">Loading orderbook...</span>
      </div>
    );
  }

  const spread = orderbook.asks[0] && orderbook.bids[0]
    ? orderbook.asks[0].price - orderbook.bids[0].price
    : null;
  const spreadPct = spread && orderbook.asks[0]
    ? (spread / orderbook.asks[0].price) * 100
    : null;

  const midPrice = orderbook.asks[0]?.price && orderbook.bids[0]?.price
    ? (orderbook.asks[0].price + orderbook.bids[0].price) / 2
    : 1;

  const handleTickClick = (targetTick: number) => {
    const computed = computeNSigFigs(midPrice, targetTick);
    setNSigFigs(computed);
  };

  const formatTick = (t: number): string => {
    if (t >= 1) return t.toString();
    // Show up to 8 significant decimal digits, strip trailing zeros
    return t.toPrecision(1).replace(/\.?0+$/, '') || t.toString();
  };

  // Determine active button: match current nSigFigs to each tick target
  const isActiveButton = (targetTick: number): boolean => {
    const computed = computeNSigFigs(midPrice, targetTick);
    return computed === nSigFigs;
  };

  return (
    <div className="flex flex-col overflow-hidden h-full">
      {/* Tick Size Selector */}
      <div className="flex items-center justify-between px-3 py-1.5 flex-shrink-0" style={{ borderBottom: '1px solid #273035' }}>
        <div className="flex items-center gap-1">
          {tickTargets.map((t) => (
            <button
              key={t}
              onClick={() => handleTickClick(t)}
              className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
                isActiveButton(t)
                  ? 'bg-primary/20 text-primary'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {formatTick(t)}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-500">USDC</span>
      </div>

      {/* Column Header */}
      <div className="grid grid-cols-3 px-3 py-1 text-xs flex-shrink-0" style={{ color: '#949E9C', borderBottom: '1px solid #273035' }}>
        <span>Price</span>
        <span className="text-right">Size ({baseToken})</span>
        <span className="text-right">Total (USDC)</span>
      </div>

      {/* Asks (sells) — bottom-aligned */}
      <div className="overflow-hidden flex flex-col justify-end min-h-0" style={{ flex: '1 1 0%' }}>
        {asks.map((level, i) => (
          <OrderbookRow
            key={`a-${level.price}-${i}`}
            price={level.price}
            size={level.size}
            cumSize={level.cumSize}
            cumTotal={level.cumTotal}
            side="ask"
            maxCumSize={maxCumSize}
            priceDecimals={priceDecimals}
            lotSize={lotSize}
            onClick={() => onPriceClick(level.price)}
          />
        ))}
      </div>

      {/* Spread Row — HL 스타일 (last price 없음, spread만 표시) */}
      <div className="px-3 py-1 grid grid-cols-3 items-center flex-shrink-0" style={{ borderTop: '1px solid #273035', borderBottom: '1px solid #273035' }}>
        <span className="text-xs" style={{ color: '#949E9C' }}>Spread</span>
        {spread !== null && spreadPct !== null ? (
          <>
            <span className="text-xs text-right tabular-nums text-gray-300">
              {spread.toFixed(currentTick < 0.01 ? 5 : currentTick < 1 ? 3 : 2)}
            </span>
            <span className="text-xs text-right tabular-nums text-gray-300">
              {spreadPct.toFixed(3)}%
            </span>
          </>
        ) : (
          <>
            <span />
            <span />
          </>
        )}
      </div>

      {/* Bids (buys) — top-aligned */}
      <div className="overflow-hidden min-h-0" style={{ flex: '1 1 0%' }}>
        {bids.map((level, i) => (
          <OrderbookRow
            key={`b-${level.price}-${i}`}
            price={level.price}
            size={level.size}
            cumSize={level.cumSize}
            cumTotal={level.cumTotal}
            side="bid"
            maxCumSize={maxCumSize}
            priceDecimals={priceDecimals}
            lotSize={lotSize}
            onClick={() => onPriceClick(level.price)}
          />
        ))}
      </div>
    </div>
  );
}

function formatCumTotal(val: number): string {
  if (val >= 1_000_000) return `${(val / 1e6).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1e3).toFixed(2)}K`;
  return val.toFixed(2);
}

function OrderbookRow({
  price,
  size,
  cumSize,
  cumTotal,
  side,
  maxCumSize,
  priceDecimals,
  lotSize,
  onClick,
}: {
  price: number;
  size: number;
  cumSize: number;
  cumTotal: number;
  side: 'bid' | 'ask';
  maxCumSize: number;
  priceDecimals: number;
  lotSize: number | undefined;
  onClick: () => void;
}) {
  const depthPct = (cumSize / maxCumSize) * 100;
  const bgColor = side === 'bid' ? 'rgba(80,210,193,0.08)' : 'rgba(237,112,136,0.08)';
  const textColor = side === 'bid' ? 'text-[#5fd8ee]' : 'text-[#ED7088]';

  return (
    <button
      onClick={onClick}
      className="relative w-full grid grid-cols-3 px-3 text-xs hover:bg-[#1a2830] transition-colors cursor-pointer"
      style={{ height: `${ROW_HEIGHT}px`, lineHeight: `${ROW_HEIGHT}px` }}
    >
      <div
        className="absolute inset-y-0 right-0"
        style={{ width: `${depthPct}%`, backgroundColor: bgColor }}
      />
      <span className={`relative z-10 ${textColor} tabular-nums`}>
        {price.toLocaleString(undefined, { minimumFractionDigits: priceDecimals, maximumFractionDigits: priceDecimals })}
      </span>
      <span className="relative z-10 text-right text-gray-300 tabular-nums">
        {lotSize ? fmtSizeByLot(size, lotSize) : size.toFixed(4)}
      </span>
      <span className="relative z-10 text-right text-gray-500 tabular-nums">
        {formatCumTotal(cumTotal)}
      </span>
    </button>
  );
}
