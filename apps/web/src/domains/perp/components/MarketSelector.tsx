'use client';

/**
 * MarketSelector — HL 스타일 마켓 헤더 + 전체 화면 토큰 리스트
 *
 * Row 1: 티커 바 — BTC-USDC 가격, ETH-USDC 가격 ...
 * Row 2: 마켓 선택 + 핵심 지표 (Price, 24h Change, Volume, OI, Funding)
 * 드롭다운: 전체 화면 오버레이 테이블 (Symbol, Last Price, 24h Change, Funding, Volume, OI)
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { PerpMarket } from '../types/perp.types';
import { usePerpStore } from '../stores/usePerpStore';
import { useFavoritesStore } from '../stores/useFavoritesStore';
import { usePerpDexs, useMarkets } from '../hooks/usePerpData';
import { fmtPriceByTick } from '../utils/displayComputations';
import { toHourlyRate, annualizeRate } from '@hq/core/defi/perp';

interface Props {
  markets: PerpMarket[];
  selectedMarket: PerpMarket | null;
  /** 렌더링할 섹션: 'all' (기본), 'ticker' (가격 바만), 'stats' (지표+드롭다운만) */
  section?: 'all' | 'ticker' | 'stats';
}

type Category = 'all' | 'perps' | 'favorites' | 'crypto' | 'tradfi' | 'hip3' | 'spot' | 'trending';

type SortKey = 'symbol' | 'price' | 'change' | 'funding' | 'volume' | 'oi';
type SortDir = 'asc' | 'desc';
interface SortState {
  key: SortKey;
  dir: SortDir;
}
const DEFAULT_SORT: SortState = { key: 'volume', dir: 'desc' };

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'perps', label: 'Perps' },
  { key: 'spot', label: 'Spot' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'tradfi', label: 'Tradfi' },
  { key: 'hip3', label: 'HIP-3' },
  { key: 'trending', label: 'Trending' },
];

export function MarketSelector({ markets, selectedMarket, section = 'all' }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<Category>('all');
  const [hip3Dex, setHip3Dex] = useState<string>('all');
  const [spotQuote, setSpotQuote] = useState<string>('all');
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const store = usePerpStore();

  // Click behavior: same column toggles asc ↔ desc, different column starts at desc
  const handleSortClick = (key: SortKey) => {
    setSort((prev) => (prev.key === key
      ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
      : { key, dir: 'desc' }));
  };
  const favorites = useFavoritesStore(s => s.favorites);
  const toggleFavorite = useFavoritesStore(s => s.toggleFavorite);
  const { data: perpDexs = [] } = usePerpDexs();
  // 티커바는 useMarkets()를 직접 구독 — WS setQueryData 패치가 오면
  // 이 컴포넌트가 직접 re-render되어 실시간 가격이 즉시 반영된다.
  // (props로 전달받은 markets는 드롭다운 테이블에만 사용)
  const { data: liveMarkets = markets } = useMarkets();

  // 즐겨찾기 마켓 (티커바용) — liveMarkets를 사용해 WS 가격 업데이트 반영
  const favoriteMarkets = useMemo(() => {
    return favorites
      .map(symbol => liveMarkets.find(m => m.symbol === symbol))
      .filter((m): m is PerpMarket => m !== undefined);
  }, [favorites, liveMarkets]);

  const filtered = useMemo(() => {
    // 1) 카테고리 필터
    let list = [...markets];

    if (activeCategory === 'all') {
      // All: show everything (perp + spot)
    } else if (activeCategory === 'perps') {
      list = list.filter(m => m.assetType === 'perp');
    } else if (activeCategory === 'favorites') {
      list = list.filter(m => favorites.includes(m.symbol));
    } else if (activeCategory === 'crypto') {
      list = list.filter(m => m.category === 'crypto' && m.assetType === 'perp');
    } else if (activeCategory === 'tradfi') {
      list = list.filter(m => m.category === 'tradfi' && m.assetType === 'perp');
    } else if (activeCategory === 'hip3') {
      list = list.filter(m => m.category === 'hip3' && m.assetType === 'perp');
      if (hip3Dex !== 'all') {
        list = list.filter(m => m.dex === hip3Dex);
      }
    } else if (activeCategory === 'spot') {
      list = list.filter(m => m.assetType === 'spot');
      if (spotQuote !== 'all') {
        list = list.filter(m => m.quoteAsset === spotQuote);
      }
    } else if (activeCategory === 'trending') {
      // Trending: top 20 by volume across ALL markets (perp + spot)
      list = [...list].sort((a, b) => b.volume24h - a.volume24h).slice(0, 20);
    }

    // 2) 검색 필터
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(m =>
        m.symbol.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.baseAsset.toLowerCase().includes(q),
      );
    }

    // 3) 정렬 — favorites는 항상 상단에 pinned, 그 다음 사용자가 선택한
    //    컬럼으로 2차 정렬. HL 프론트와 동일한 패턴.
    if (activeCategory !== 'trending') {
      const favSet = new Set(favorites);
      const dirMul = sort.dir === 'desc' ? -1 : 1;
      const getSortValue = (m: PerpMarket): number | string => {
        switch (sort.key) {
          case 'symbol': return m.symbol;
          case 'price': return m.markPrice;
          case 'change': return m.prevDayPx > 0 ? (m.markPrice - m.prevDayPx) / m.prevDayPx : 0;
          case 'funding': return m.fundingRate;
          case 'volume': return m.volume24h;
          case 'oi': return m.assetType === 'spot' ? (m.marketCap ?? 0) : m.openInterest * m.markPrice;
        }
      };
      list = [...list].sort((a, b) => {
        const aFav = favSet.has(a.symbol) ? 0 : 1;
        const bFav = favSet.has(b.symbol) ? 0 : 1;
        if (aFav !== bFav) return aFav - bFav;
        const av = getSortValue(a);
        const bv = getSortValue(b);
        if (typeof av === 'string' && typeof bv === 'string') {
          return av.localeCompare(bv) * dirMul;
        }
        return ((av as number) - (bv as number)) * dirMul;
      });
    }

    return list;
  }, [markets, search, activeCategory, favorites, hip3Dex, spotQuote, sort]);

  const priceChange = selectedMarket && selectedMarket.prevDayPx > 0
    ? selectedMarket.markPrice - selectedMarket.prevDayPx
    : 0;
  const priceChangePct = selectedMarket && selectedMarket.prevDayPx > 0
    ? (priceChange / selectedMarket.prevDayPx) * 100
    : 0;

  return (
    <div className="relative" style={{ backgroundColor: '#0F1A1F' }}>
      {/* Row 1: Favorites Ticker Bar */}
      {(section === 'all' || section === 'ticker') && <div data-testid="favorites-ticker-bar" className="flex items-center gap-5 px-4 py-2.5 overflow-x-auto scrollbar-hide" style={{ borderBottom: '1px solid #273035' }}>
        <span className="text-xs flex-shrink-0" style={{ color: '#949E9C' }}>★</span>
        {favoriteMarkets.length === 0 ? (
          <span className="text-xs" style={{ color: '#5a6469' }}>No favorites — click ★ in market list</span>
        ) : (
          favoriteMarkets.map(m => {
            const change = m.prevDayPx > 0 ? ((m.markPrice - m.prevDayPx) / m.prevDayPx) * 100 : 0;
            const isActive = m.symbol === store.selectedSymbol;
            return (
              <button
                key={m.symbol}
                onClick={() => store.setSelectedSymbol(m.symbol)}
                className={`text-xs whitespace-nowrap transition-colors flex items-center gap-2 ${
                  isActive ? 'text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <span className="font-medium">{m.baseAsset}-{m.quoteAsset}</span>
                <span className={`tabular-nums ${change >= 0 ? 'text-[#5fd8ee]' : 'text-[#ED7088]'}`}>
                  {fmtPriceByTick(m.markPrice, m.tickSize)}
                </span>
                <span className={`tabular-nums text-xs ${change >= 0 ? 'text-[#5fd8ee]' : 'text-[#ED7088]'}`}>
                  {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                </span>
              </button>
            );
          })
        )}
      </div>}

      {/* Row 2: Market Selector + Stats */}
      {(section === 'all' || section === 'stats') && <div className="flex items-center gap-5 px-4 py-1.5 overflow-x-auto scrollbar-hide" style={{ borderBottom: '1px solid #273035' }}>
        {/* Market picker trigger */}
        <button
          onClick={() => { setIsOpen(true); setSearch(''); }}
          className="flex items-center gap-1.5 hover:bg-[#1a2830] rounded-md px-2 py-1 transition-colors flex-shrink-0"
        >
          <span className="text-base font-semibold text-white whitespace-nowrap">
            {selectedMarket ? `${selectedMarket.baseAsset}/${selectedMarket.quoteAsset}` : 'Select Market'}
          </span>
          <svg className={`w-2.5 h-2.5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Stats — spot shows Price/Volume/MarketCap/Contract; perps show Mark/Oracle/Funding/OI */}
        {selectedMarket && selectedMarket.assetType === 'spot' ? (
          <>
            <Stat label="Price" value={selectedMarket.markPrice.toLocaleString('en-US', { maximumFractionDigits: 8 })} valueClass="text-white" />
            <Stat
              label="24h Change"
              value={`${priceChange >= 0 ? '+' : ''}${priceChange.toLocaleString('en-US', { maximumFractionDigits: 3 })} / ${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(2)}%`}
              valueClass={priceChange >= 0 ? 'text-[#5fd8ee]' : 'text-[#ED7088]'}
            />
            <Stat label="24h Volume" value={`${selectedMarket.volume24h.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${selectedMarket.quoteAsset}`} valueClass="text-white" />
            <Stat label="Market Cap" value={selectedMarket.marketCap ? `${Math.round(selectedMarket.marketCap).toLocaleString('en-US')} ${selectedMarket.quoteAsset}` : '—'} valueClass="text-white" />
            <Stat label="Contract" value={selectedMarket.contractAddress ? `${selectedMarket.contractAddress.slice(0, 6)}...${selectedMarket.contractAddress.slice(-4)}` : '—'} valueClass="text-gray-400" />
          </>
        ) : selectedMarket ? (
          <>
            <StatPair label="Mark" sublabel="Oracle" value={fmtPriceByTick(selectedMarket.markPrice, selectedMarket.tickSize)} subvalue={fmtPriceByTick(selectedMarket.indexPrice, selectedMarket.tickSize)} />
            <Stat
              label="24h Change"
              value={`${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)} / ${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(2)}%`}
              valueClass={priceChange >= 0 ? 'text-[#5fd8ee]' : 'text-[#ED7088]'}
            />
            <Stat label="24h Volume" value={`$${selectedMarket.volume24h.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} valueClass="text-white" />
            <Stat label="Open Interest" value={`$${(selectedMarket.openInterest * selectedMarket.markPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} valueClass="text-white" />
            <div className="flex gap-4">
              <FundingRatePopover
                rate={selectedMarket.fundingRate}
                dexId={store.selectedDex}
              />
              <div className="flex flex-col items-start whitespace-nowrap">
                <span className="text-xs leading-none" style={{ color: '#949E9C' }}>Countdown</span>
                <span className="text-xs font-medium text-white tabular-nums">
                  <FundingCountdown />
                </span>
              </div>
            </div>
          </>
        ) : null}
      </div>}

      {/* Market List Dropdown Panel (HL style — chart-column width, ~800px, height fits chart area) */}
      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 top-full shadow-2xl w-[800px] max-w-[calc(100vw-32px)] flex flex-col" style={{ backgroundColor: '#0F1A1F', zIndex: 41, height: '52vh', border: '1px solid #273035' }}>
            {/* Search */}
            <div className="px-4 py-2" style={{ borderBottom: '1px solid #273035' }}>
              <div className="flex items-center gap-2 bg-gray-900 rounded-md px-3 py-2">
                <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search"
                  className="w-full bg-transparent text-xs text-white placeholder-gray-500 focus:outline-none"
                  autoFocus
                />
              </div>
            </div>

            {/* Category Tabs */}
            <div className="flex items-center gap-1 px-4 py-3 overflow-x-auto scrollbar-hide" style={{ borderBottom: '1px solid #273035' }}>
              {CATEGORIES.map(cat => (
                <button
                  key={cat.key}
                  onClick={() => setActiveCategory(cat.key)}
                  className={`px-3.5 py-2.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                    activeCategory === cat.key
                      ? 'bg-[#1a2830] text-white'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* HIP-3 Sub-tabs (deployers) — only visible on HIP-3 category */}
            {activeCategory === 'hip3' && perpDexs.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-2.5 overflow-x-auto scrollbar-hide" style={{ borderBottom: '1px solid #273035' }}>
                <button
                  onClick={() => setHip3Dex('all')}
                  className={`text-xs font-medium transition-colors whitespace-nowrap ${
                    hip3Dex === 'all' ? 'text-white' : 'text-gray-500 hover:text-gray-300'
                  }`}
                  style={hip3Dex === 'all' ? { borderBottom: '1px solid #5fd8ee', paddingBottom: '2px' } : undefined}
                >
                  All
                </button>
                {perpDexs.map(d => (
                  <button
                    key={d.name}
                    onClick={() => setHip3Dex(d.name)}
                    className={`text-xs font-medium transition-colors whitespace-nowrap ${
                      hip3Dex === d.name ? 'text-white' : 'text-gray-500 hover:text-gray-300'
                    }`}
                    style={hip3Dex === d.name ? { borderBottom: '1px solid #5fd8ee', paddingBottom: '2px' } : undefined}
                    title={d.fullName}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            )}

            {/* Spot quote sub-tabs — only visible on Spot category */}
            {activeCategory === 'spot' && (
              <div className="flex items-center gap-3 px-4 py-2.5 overflow-x-auto scrollbar-hide" style={{ borderBottom: '1px solid #273035' }}>
                {['all', 'USDC', 'USDH', 'USDT'].map(q => (
                  <button
                    key={q}
                    onClick={() => setSpotQuote(q)}
                    className={`text-xs font-medium transition-colors whitespace-nowrap ${
                      spotQuote === q ? 'text-white' : 'text-gray-500 hover:text-gray-300'
                    }`}
                    style={spotQuote === q ? { borderBottom: '1px solid #5fd8ee', paddingBottom: '2px' } : undefined}
                  >
                    {q === 'all' ? 'All' : q}
                  </button>
                ))}
              </div>
            )}

            {/* Table Header — clickable to sort. Spot shows Market Cap instead of Funding/OI. */}
            {activeCategory === 'spot' ? (
              <div className="grid px-4 py-1.5 text-xs font-medium select-none" style={{ color: '#949E9C', borderBottom: '1px solid #273035', gridTemplateColumns: '24px 1.7fr 0.9fr 1.5fr 1.3fr 1.5fr' }}>
                <span></span>
                <SortHeader align="left" label="Symbol" sortKey="symbol" current={sort} onClick={handleSortClick} />
                <SortHeader align="right" label="Last Price" sortKey="price" current={sort} onClick={handleSortClick} />
                <SortHeader align="right" label="24h Change" sortKey="change" current={sort} onClick={handleSortClick} />
                <SortHeader align="right" label="Volume" sortKey="volume" current={sort} onClick={handleSortClick} />
                <SortHeader align="right" label="Market Cap" sortKey="oi" current={sort} onClick={handleSortClick} />
              </div>
            ) : (
              <div className="grid px-4 py-1.5 text-xs font-medium select-none" style={{ color: '#949E9C', borderBottom: '1px solid #273035', gridTemplateColumns: '24px 1.7fr 0.9fr 1.5fr 0.9fr 1.3fr 1.3fr' }}>
                <span></span>
                <SortHeader align="left" label="Symbol" sortKey="symbol" current={sort} onClick={handleSortClick} />
                <SortHeader align="right" label="Last Price" sortKey="price" current={sort} onClick={handleSortClick} />
                <SortHeader align="right" label="24h Change" sortKey="change" current={sort} onClick={handleSortClick} />
                <SortHeader align="right" label="8h Funding" sortKey="funding" current={sort} onClick={handleSortClick} />
                <SortHeader align="right" label="Volume" sortKey="volume" current={sort} onClick={handleSortClick} />
                <SortHeader align="right" label="Open Interest" sortKey="oi" current={sort} onClick={handleSortClick} />
              </div>
            )}

            {/* Table Rows — flex-1 fills remaining space, scrolls when overflow */}
            <div className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
              {filtered.map(m => {
                const change = m.prevDayPx > 0 ? m.markPrice - m.prevDayPx : 0;
                const changePct = m.prevDayPx > 0 ? (change / m.prevDayPx) * 100 : 0;
                const isSelected = m.symbol === store.selectedSymbol;
                const isFav = favorites.includes(m.symbol);
                const isHip3 = m.category === 'hip3' || m.category === 'tradfi';
                const isSpot = m.assetType === 'spot';
                const isPositive = changePct >= 0;
                const changeColor = isPositive ? 'text-[#5fd8ee]' : 'text-[#ED7088]';
                // Spot-only tab uses a different grid (no Funding/OI, has Market Cap).
                // Mixed tabs (All, Favorites, Trending) use the perp grid — spot
                // rows show "—" for Funding/OI columns.
                const spotOnlyTab = activeCategory === 'spot';
                const gridCols = spotOnlyTab
                  ? '24px 1.7fr 0.9fr 1.5fr 1.3fr 1.5fr'
                  : '24px 1.7fr 0.9fr 1.5fr 0.9fr 1.3fr 1.3fr';

                return (
                  <div
                    key={m.symbol}
                    className={`grid px-4 py-1 text-xs hover:bg-[#1a2830] transition-colors items-center ${
                      isSelected ? 'bg-[#1a2830]' : ''
                    }`}
                    style={{ gridTemplateColumns: gridCols }}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(m.symbol); }}
                      className={`text-sm leading-none transition-colors ${
                        isFav ? 'text-[#FFD15A]' : 'text-gray-700 hover:text-gray-500'
                      }`}
                      title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      ★
                    </button>
                    <button
                      onClick={() => {
                        store.setSelectedSymbol(m.symbol);
                        setIsOpen(false);
                        setSearch('');
                      }}
                      className="text-left flex items-center gap-1.5 min-w-0"
                    >
                      <span className="text-white whitespace-nowrap">{isSpot ? m.name : `${m.baseAsset}-${m.quoteAsset}`}</span>
                      {!isSpot && (
                        <span className="text-xs px-1 rounded text-[#FFA94D] bg-[#FFA94D]/10 flex-shrink-0">{m.maxLeverage}x</span>
                      )}
                      {isSpot && (
                        <span className="text-xs px-1 rounded text-gray-500 bg-gray-800/60 flex-shrink-0">SPOT</span>
                      )}
                      {isHip3 && m.dex && (
                        <span className="text-xs px-1 rounded text-gray-500 bg-gray-800 flex-shrink-0">{m.dex}</span>
                      )}
                    </button>
                    <span className="text-right text-white tabular-nums">
                      {fmtPriceByTick(m.markPrice, m.tickSize)}
                    </span>
                    <span className={`text-right tabular-nums ${changeColor}`}>
                      {isPositive ? '+' : ''}{changePct.toFixed(2)}%
                    </span>
                    {spotOnlyTab ? (
                      <>
                        <span className="text-right text-gray-300 tabular-nums">
                          ${fmtLarge(m.volume24h)}
                        </span>
                        <span className="text-right text-gray-300 tabular-nums">
                          {m.marketCap ? `$${fmtLarge(m.marketCap)}` : '—'}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className={`text-right tabular-nums ${isSpot ? 'text-gray-600' : m.fundingRate >= 0 ? 'text-[#5fd8ee]' : 'text-[#ED7088]'}`}>
                          {isSpot ? '—' : `${(m.fundingRate * 100).toFixed(4)}%`}
                        </span>
                        <span className="text-right text-gray-300 tabular-nums">
                          ${fmtLarge(m.volume24h)}
                        </span>
                        <span className="text-right text-gray-300 tabular-nums">
                          {isSpot ? '—' : `$${fmtLarge(m.openInterest * m.markPrice)}`}
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  current,
  onClick,
  align,
}: {
  label: string;
  sortKey: SortKey;
  current: SortState;
  onClick: (key: SortKey) => void;
  align: 'left' | 'right';
}) {
  const isActive = current.key === sortKey;
  const arrow = isActive ? (current.dir === 'desc' ? '▼' : '▲') : '';
  return (
    <button
      type="button"
      onClick={() => onClick(sortKey)}
      className={`flex items-center gap-1 transition-colors hover:text-white ${
        isActive ? 'text-white' : ''
      } ${align === 'right' ? 'justify-end' : 'justify-start'}`}
    >
      <span>{label}</span>
      <span className={`text-[9px] leading-none ${isActive ? 'text-[#5fd8ee]' : 'text-gray-700'}`}>
        {arrow || '↕'}
      </span>
    </button>
  );
}

function Stat({ label, value, valueClass }: { label: string; value: string; valueClass: string }) {
  return (
    <div className="flex flex-col items-start whitespace-nowrap">
      <span className="text-xs leading-none" style={{ color: '#949E9C' }}>{label}</span>
      <span className={`text-xs font-medium ${valueClass}`}>{value}</span>
    </div>
  );
}

function StatPair({ label, sublabel, value, subvalue }: { label: string; sublabel: string; value: string; subvalue: string }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-start whitespace-nowrap">
        <span className="text-xs leading-none underline decoration-dotted" style={{ color: '#949E9C' }}>{label}</span>
        <span className="text-xs font-medium text-white">{value}</span>
      </div>
      <div className="flex flex-col items-start whitespace-nowrap">
        <span className="text-xs leading-none underline decoration-dotted" style={{ color: '#949E9C' }}>{sublabel}</span>
        <span className="text-xs font-medium text-white">{subvalue}</span>
      </div>
    </div>
  );
}

function fmtLarge(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  return n.toFixed(2);
}

/** Countdown to next hourly funding (top of hour UTC) */
function FundingCountdown() {
  const [remaining, setRemaining] = useState(getRemainingMs());
  useEffect(() => {
    const t = setInterval(() => setRemaining(getRemainingMs()), 1000);
    return () => clearInterval(t);
  }, []);
  const totalSec = Math.max(0, Math.floor(remaining / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return <>{String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}</>;
}

function getRemainingMs(): number {
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setUTCMinutes(0, 0, 0);
  nextHour.setUTCHours(now.getUTCHours() + 1);
  return nextHour.getTime() - now.getTime();
}

// ── Funding Rate Popover ──────────────────────────────────────────────────
//
// Hover/focus tooltip that surfaces the annualized rate alongside the raw
// per-interval rate shown in the ticker. Positioned *above* the trigger so it
// doesn't collide with the chart rendered directly below the ticker row.

type DexIdLike = 'hyperliquid' | 'pacifica' | 'lighter' | 'aster';

const FUNDING_CADENCE: Record<DexIdLike, { hours: number; label: string }> = {
  hyperliquid: { hours: 1, label: '1h' },
  pacifica:    { hours: 1, label: '1h' },
  lighter:     { hours: 8, label: '8h' },
  aster:       { hours: 8, label: '8h' },
};

function FundingRatePopover({ rate, dexId }: { rate: number; dexId: DexIdLike }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const cadence = FUNDING_CADENCE[dexId];
  const hourly = toHourlyRate(rate, dexId);
  const apr = annualizeRate(hourly);
  const rateColor = rate >= 0 ? '#5fd8ee' : '#ED7088';
  const aprSign = apr >= 0 ? '+' : '';

  // Popover is portaled to <body> so ancestor overflow:auto (stat row)
  // doesn't clip it. Position is measured from the trigger's viewport rect
  // on open so the arrow lines up with the trigger's horizontal center.
  const showPopover = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.top, left: r.left + r.width / 2 });
    setOpen(true);
  };
  const hidePopover = () => setOpen(false);

  return (
    <>
      <div
        ref={triggerRef}
        className="flex flex-col items-start whitespace-nowrap cursor-help"
        onMouseEnter={showPopover}
        onMouseLeave={hidePopover}
        onFocus={showPopover}
        onBlur={hidePopover}
        tabIndex={0}
      >
        <span className="text-xs leading-none" style={{ color: '#949E9C' }}>Funding</span>
        <span className="text-xs font-medium" style={{ color: rateColor }}>
          {(rate * 100).toFixed(4)}%
        </span>
      </div>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          role="tooltip"
          className="fixed min-w-[200px] rounded-md shadow-xl pointer-events-none"
          style={{
            top: pos.top - 8,
            left: pos.left,
            transform: 'translate(-50%, -100%)',
            backgroundColor: '#0F1A1F',
            border: '1px solid #273035',
            borderLeft: '2px solid #AB9FF2',
            zIndex: 9999,
          }}
        >
          <div className="px-3 py-2 space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: '#949E9C' }}>
                Annualized
              </span>
              <span className="text-xs font-semibold tabular-nums" style={{ color: rateColor }}>
                {aprSign}{apr.toFixed(2)}%
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: '#949E9C' }}>
                Rate / {cadence.label}
              </span>
              <span className="text-[11px] tabular-nums text-white">
                {(rate * 100).toFixed(4)}%
              </span>
            </div>
            <div className="pt-1 text-[10px] leading-snug" style={{ color: '#5a6469', borderTop: '1px dashed #273035' }}>
              <span className="block pt-1">
                Settles every {cadence.label} on {dexId[0].toUpperCase() + dexId.slice(1)}. APR = rate × {8760 / cadence.hours} periods/yr.
              </span>
            </div>
          </div>

          {/* Pointer arrow (down) */}
          <div
            className="absolute left-1/2 top-full -translate-x-1/2 w-0 h-0"
            aria-hidden
            style={{
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '5px solid #273035',
            }}
          />
          <div
            className="absolute left-1/2 top-full -translate-x-1/2 w-0 h-0"
            aria-hidden
            style={{
              marginTop: -1,
              borderLeft: '4px solid transparent',
              borderRight: '4px solid transparent',
              borderTop: '4px solid #0F1A1F',
            }}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
