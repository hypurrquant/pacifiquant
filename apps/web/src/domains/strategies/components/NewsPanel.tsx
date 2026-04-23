'use client';

import { useState } from 'react';
import { useCryptoNews, type NewsItem } from '../hooks/useMarketMacro';

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

interface NewsPanelProps {
  /** When true, strips the outer card container + source-tickers filter,
   *  so the panel can embed inside another card (e.g. alongside the Fear
   *  & Greed gauge) without doubling up borders. */
  readonly embedded?: boolean;
  readonly maxItems?: number;
}

export function NewsPanel({ embedded = false, maxItems = 20 }: NewsPanelProps = {}) {
  const { data: news = [], isLoading } = useCryptoNews(maxItems);
  const [filter, setFilter] = useState<string | null>(null);

  const allTickers = Array.from(new Set(news.flatMap((n) => n.currencies))).slice(0, 10);
  const filtered = filter ? news.filter((n) => n.currencies.includes(filter)) : news;

  if (embedded) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-1 pb-2">
          <h3 className="text-xs font-semibold text-white">Market News</h3>
          <span className="text-[9px]" style={{ color: '#6B7580' }}>via Cointelegraph · Decrypt</span>
        </div>
        {allTickers.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap pb-2">
            <button
              onClick={() => setFilter(null)}
              className={`text-[9px] px-1.5 py-0.5 rounded-full border transition-colors ${filter == null ? 'border-[#5fd8ee] text-[#5fd8ee]' : 'border-[#273035] text-gray-500 hover:text-gray-300'}`}
            >
              All
            </button>
            {allTickers.slice(0, 6).map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t === filter ? null : t)}
                className={`text-[9px] px-1.5 py-0.5 rounded-full border transition-colors ${t === filter ? 'border-[#5fd8ee] text-[#5fd8ee]' : 'border-[#273035] text-gray-500 hover:text-gray-300'}`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        {/* Scroll area height matches the Fear & Greed gauge+history card
            (gauge viewBox renders at ~170px in the md:260 width + header/
            filter strip ≈ 60px), so both columns bottom-align. */}
        <div
          className="overflow-y-auto rounded-md"
          style={{ backgroundColor: '#1B2429', border: '1px solid #273035', maxHeight: 190 }}
        >
          {isLoading && (
            <div className="px-3 py-4 text-center text-[11px]" style={{ color: '#6B7580' }}>Loading news...</div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="px-3 py-4 text-center text-[11px]" style={{ color: '#6B7580' }}>
              {filter ? `No news for ${filter}.` : 'No news available.'}
            </div>
          )}
          {filtered.slice(0, 10).map((item) => (
            <NewsRow key={item.id} item={item} compact />
          ))}
        </div>
      </div>
    );
  }

  return (
    <section
      className="rounded-lg"
      style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}
    >
      <header className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#273035' }}>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-white">Market News</h3>
          <span className="text-[10px]" style={{ color: '#6B7580' }}>
            via CryptoPanic · refreshes every 10min
          </span>
        </div>
        {allTickers.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap justify-end">
            <button
              onClick={() => setFilter(null)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${filter == null ? 'border-[#5fd8ee] text-[#5fd8ee]' : 'border-[#273035] text-gray-500 hover:text-gray-300'}`}
            >
              All
            </button>
            {allTickers.map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t === filter ? null : t)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${t === filter ? 'border-[#5fd8ee] text-[#5fd8ee]' : 'border-[#273035] text-gray-500 hover:text-gray-300'}`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="divide-y" style={{ borderColor: '#1B2429' }}>
        {isLoading && (
          <div className="px-4 py-6 text-center text-xs" style={{ color: '#6B7580' }}>
            Loading news...
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="px-4 py-6 text-center text-xs" style={{ color: '#6B7580' }}>
            {filter ? `No recent news for ${filter}.` : 'No news available.'}
          </div>
        )}
        {filtered.map((item) => (
          <NewsRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

function NewsRow({ item, compact = false }: { item: NewsItem; compact?: boolean }) {
  // Google's S2 favicon service — zero-auth thumbnails for publishers.
  // Falls back to a neutral square if the domain is unknown.
  const faviconUrl = item.sourceDomain
    ? `https://www.google.com/s2/favicons?domain=${item.sourceDomain}&sz=32`
    : null;
  const sentimentColor =
    item.sentiment === 'bullish' ? '#6EE7B7' : item.sentiment === 'bearish' ? '#ED7088' : '#8F9BA4';
  const sentimentLabel =
    item.sentiment === 'bullish' ? 'Bullish' : item.sentiment === 'bearish' ? 'Bearish' : 'Neutral';

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className={`flex items-start gap-2 hover:bg-[#242F34] transition-colors border-b last:border-b-0 ${compact ? 'px-2.5 py-2' : 'px-4 py-3'}`}
      style={{ borderColor: '#1B2429' }}
    >
      {faviconUrl ? (
        <img
          src={faviconUrl}
          alt={item.source}
          className={`${compact ? 'w-4 h-4' : 'w-6 h-6'} rounded flex-shrink-0 mt-0.5 bg-white/5`}
        />
      ) : (
        <div className={`${compact ? 'w-4 h-4 text-[8px]' : 'w-6 h-6 text-[10px]'} rounded flex-shrink-0 mt-0.5 bg-[#273035] flex items-center justify-center text-gray-500 font-semibold`}>
          {item.source[0]}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className={`flex items-center gap-1.5 mb-0.5 flex-wrap ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
          <span className="text-gray-400 font-medium truncate">{item.source}</span>
          <span style={{ color: '#6B7580' }}>· {timeAgo(item.publishedAt)}</span>
          <span
            className="font-semibold px-1.5 py-[1px] rounded-full"
            style={{ color: sentimentColor, backgroundColor: `${sentimentColor}1A`, border: `1px solid ${sentimentColor}33` }}
          >
            {sentimentLabel}
          </span>
          {item.important && (
            <span
              className="font-semibold px-1.5 py-[1px] rounded-full"
              style={{ color: '#FFA94D', backgroundColor: 'rgba(255,169,77,0.1)', border: '1px solid rgba(255,169,77,0.2)' }}
            >
              Important
            </span>
          )}
          {item.currencies.slice(0, compact ? 2 : 4).map((c) => (
            <span
              key={c}
              className="font-medium px-1 py-[1px] rounded"
              style={{ color: '#5fd8ee', backgroundColor: 'rgba(95,216,238,0.08)' }}
            >
              {c}
            </span>
          ))}
        </div>
        <div className={`text-white leading-snug line-clamp-2 ${compact ? 'text-[11px]' : 'text-xs'}`}>{item.title}</div>
      </div>
    </a>
  );
}
