'use client';

/**
 * TradingChart — lightweight-charts 캔들스틱 + 볼륨 차트
 * Hyperliquid 스타일: 캔들 + 볼륨 히스토그램 + OHLC 오버레이
 */

import { useRef, useEffect, useState, useMemo } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type UTCTimestamp, CandlestickSeries, HistogramSeries, ColorType } from 'lightweight-charts';
import type { Candle, CandleInterval } from '../types/perp.types';
import { toUtcTimestamp } from '../lib/toUtcTimestamp';
import { usePerpStore } from '../stores/usePerpStore';
import { fmtPriceByTick } from '../utils/displayComputations';

const INTERVALS: { value: CandleInterval; label: string }[] = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1h', label: '1H' },
  { value: '4h', label: '4H' },
  { value: '1d', label: '1D' },
  { value: '1w', label: '1W' },
];

interface Props {
  candles: Candle[];
  symbol: string;
  /** Market tickSize — OHLC overlay pads to `-log10(tickSize)` decimals so
   *  price text doesn't jitter as digits change (e.g. 43.4455 → 43.4). */
  tickSize: number;
  isLoading: boolean;
  /** Fired when the user scrolls back near the oldest candle — parent
   *  should fetch the next older page and prepend it to `candles`. */
  onLoadMoreHistory?: () => void;
  isLoadingHistory?: boolean;
}

export function TradingChart({ candles, symbol, tickSize, isLoading, onLoadMoreHistory, isLoadingHistory }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  // Track the current series identity (symbol + interval). When it
  // changes we force a fresh `fitContent` on the next non-empty update,
  // regardless of whether `candles` happened to transition through [].
  // This handles the same-symbol-different-DEX case where the user
  // switches HL → Lighter on BTC: `useInfiniteCandles` clears + refetches
  // but React may batch effects such that the "reset on empty" observer
  // never sees candles.length === 0. Tracking identity via a ref
  // sidesteps the effect-ordering race entirely.
  const seriesKeyRef = useRef<string>('');
  // Ref for onLoadMoreHistory so the chart's subscription can fire the
  // current callback without resubscribing on every parent re-render.
  const loadMoreRef = useRef<(() => void) | undefined>(undefined);
  loadMoreRef.current = onLoadMoreHistory;
  const loadingHistoryRef = useRef<boolean>(false);
  loadingHistoryRef.current = !!isLoadingHistory;
  const store = usePerpStore();
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);

  // 최신 캔들 (OHLC 표시용)
  const latestCandle = useMemo(() => {
    if (hoveredCandle) return hoveredCandle;
    return candles.length > 0 ? candles[candles.length - 1] : null;
  }, [hoveredCandle, candles]);

  // Chart 생성
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#0F1A1E' },
        textColor: '#949E9C',
        fontSize: 12,
      },
      grid: {
        vertLines: { color: '#1B2429' },
        horzLines: { color: '#1B2429' },
      },
      crosshair: {
        vertLine: { color: '#5fd8ee', width: 1, style: 2 },
        horzLine: { color: '#5fd8ee', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: '#273035',
      },
      timeScale: {
        borderColor: '#273035',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    // Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#5fd8ee',
      downColor: '#ED7088',
      borderUpColor: '#5fd8ee',
      borderDownColor: '#ED7088',
      wickUpColor: '#5fd8ee',
      wickDownColor: '#ED7088',
    });

    // Volume histogram series (bottom, semi-transparent)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    // Volume scale: 20% of chart height, no labels
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // Crosshair move → update OHLC overlay
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData) {
        setHoveredCandle(null);
        return;
      }
      const candleData = param.seriesData.get(candleSeries);
      if (candleData && 'open' in candleData) {
        const d = candleData as { open: number; high: number; low: number; close: number; time: UTCTimestamp }; // @ci-exception(type-assertion-count) — lightweight-charts seriesData.get() returns a wide union; 'open' in check narrows it but TS can't infer the exact shape
        setHoveredCandle({
          timestamp: (d.time as number) * 1000, // @ci-exception(type-assertion-count) — UTCTimestamp is a branded number, must widen to number for arithmetic
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          volume: 0,
        });
      }
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // Infinite-scroll: when the user drags the timeline to the left edge,
    // ask the parent to fetch + prepend the next older page of candles.
    // Threshold `from < 5` means ≤5 candles visible before the start of
    // our loaded data — gives the UI time to fetch before the user hits
    // an empty region. Throttled implicitly by `isLoadingHistory` guard.
    chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (!range) return;
      if (loadingHistoryRef.current) return;
      if (range.from < 5) {
        loadMoreRef.current?.();
      }
    });

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  // Data update + fit-on-series-change.
  // fitContent must fire once per series (symbol+interval), regardless
  // of the effect-ordering subtleties around `candles.length === 0`.
  // For subsequent prepends (infinite-scroll older pages) on the SAME
  // series, we must NOT call fitContent — the user's visible range
  // would snap and lose their scroll position.
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || candles.length === 0) return;

    const seriesKey = `${symbol}:${store.chartInterval}`;
    const isNewSeries = seriesKey !== seriesKeyRef.current;
    seriesKeyRef.current = seriesKey;

    const candleData = candles.map(c => ({
      time: toUtcTimestamp(Math.floor(c.timestamp / 1000)),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volumeData = candles.map(c => ({
      time: toUtcTimestamp(Math.floor(c.timestamp / 1000)),
      value: c.volume,
      color: c.close >= c.open ? 'rgba(80, 210, 193, 0.3)' : 'rgba(237, 112, 136, 0.3)',
    }));

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);

    if (isNewSeries) {
      chartRef.current?.timeScale().fitContent();
    }
  }, [candles, symbol, store.chartInterval]);

  // Volume SMA 계산
  const volumeSMA = useMemo(() => {
    if (candles.length === 0) return 0;
    const recent = candles.slice(-20);
    return recent.reduce((sum, c) => sum + c.volume, 0) / recent.length;
  }, [candles]);

  const priceChange = latestCandle ? latestCandle.close - latestCandle.open : 0;
  const priceChangePercent = latestCandle && latestCandle.open > 0
    ? ((priceChange / latestCandle.open) * 100)
    : 0;

  return (
    <div className="flex flex-col overflow-hidden h-full" style={{ backgroundColor: '#0F1A1F' }}>
      {/* Header: interval selector (symbol removed — already in MarketSelector) */}
      <div className="flex items-center px-3 py-2 border-b flex-shrink-0" style={{ borderColor: '#273035' }}>
        <div className="flex gap-0.5">
          {INTERVALS.map(iv => (
            <button
              key={iv.value}
              onClick={() => store.setChartInterval(iv.value)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                store.chartInterval === iv.value
                  ? 'text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
              style={store.chartInterval === iv.value ? { backgroundColor: '#273035' } : undefined}
            >
              {iv.label}
            </button>
          ))}
        </div>
      </div>

      {/* OHLC overlay */}
      {latestCandle && (
        <div className="flex items-center gap-3 px-3 py-1 text-xs flex-shrink-0 whitespace-nowrap overflow-x-auto scrollbar-hide" style={{ color: '#949E9C' }}>
          <span className="text-gray-500 flex-shrink-0">{symbol}/USD · {store.chartInterval}</span>
          <span>O <span className="text-white">{fmtPriceByTick(latestCandle.open, tickSize)}</span></span>
          <span>H <span className="text-white">{fmtPriceByTick(latestCandle.high, tickSize)}</span></span>
          <span>L <span className="text-white">{fmtPriceByTick(latestCandle.low, tickSize)}</span></span>
          <span>C <span className="text-white">{fmtPriceByTick(latestCandle.close, tickSize)}</span></span>
          <span className={priceChange >= 0 ? 'text-[#5fd8ee]' : 'text-[#ED7088]'}>
            {priceChange >= 0 ? '+' : ''}{fmtPriceByTick(priceChange, tickSize)} / {priceChangePercent >= 0 ? '+' : ''}{priceChangePercent.toFixed(2)}%
          </span>
          {volumeSMA > 0 && (
            <span className="ml-2">
              Volume SMA 5: <span className="text-[#5fd8ee]">{volumeSMA >= 1e6 ? `${(volumeSMA / 1e6).toFixed(2)}M` : volumeSMA >= 1e3 ? `${(volumeSMA / 1e3).toFixed(2)}k` : volumeSMA.toFixed(0)}</span>
            </span>
          )}
        </div>
      )}

      {/* Chart area */}
      <div className="relative flex-1">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-10" style={{ backgroundColor: '#0F1A1E' }}>
            <img src="/light-icon.png" alt="" className="w-10 h-10 opacity-30 animate-pulse" />
          </div>
        )}
        <div ref={chartContainerRef} className="absolute inset-0" />
      </div>
    </div>
  );
}
