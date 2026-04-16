'use client';

/**
 * MarketIntelCard — real-time cross-DEX market intelligence.
 *
 * Inspired by https://github.com/pacifica-fi/global-intel — a "situational
 * awareness" surface that pulls signal from data we already fetch (markets,
 * positions, funding rates across all 4 DEXs) and highlights the 3 most
 * actionable items right now:
 *
 *   1. Funding-rate spread alerts — the biggest cross-DEX funding arb
 *      opportunity visible across HL / Pacifica / Lighter / Aster right now.
 *   2. 24h movers — tokens with the largest absolute 24h % move, so the
 *      user can react to breaking volatility before they open the scanner.
 *   3. Liquidation warnings — any of the user's OWN open positions within
 *      15% of their liquidation price. Most time-critical line.
 *
 * All inputs come from the adapters the Strategies page already hits — no
 * new external API calls, no paid intel feeds.
 */

import { useMemo } from 'react';
import type { PerpMarket, PerpPosition } from '@hq/core/defi/perp';
import type { PerpDexId } from '@/domains/perp/types/perp.types';
import { useTrendingCoins, useFearGreedIndex, useGlobalMarketStats, useCryptoNews } from '../hooks/useGlobalIntel';

interface DexPositionsSlice {
  readonly dex: PerpDexId;
  readonly positions: readonly PerpPosition[];
  readonly markets: readonly PerpMarket[];
}

interface Props {
  /** Flat list of markets across all 4 DEXs, each tagged with its dex id. */
  readonly markets: ReadonlyArray<{ readonly dex: PerpDexId; readonly market: PerpMarket }>;
  /** User's open positions per DEX (for liquidation proximity). */
  readonly dexPositions: readonly DexPositionsSlice[];
}

const DEX_LABEL: Record<PerpDexId, string> = {
  hyperliquid: 'HL',
  pacifica: 'PAC',
  lighter: 'LT',
  aster: 'AST',
};

const LIQ_PROXIMITY_WARN_PCT = 15; // within 15% of liq → warn

type FundingSpread = {
  symbol: string;
  longDex: PerpDexId;   // pays less funding → go long here
  shortDex: PerpDexId;  // pays more funding → go short here
  spreadPct: number;    // |short − long| × 100
};

type Mover = {
  symbol: string;
  dex: PerpDexId;
  changePct: number;
  markPrice: number;
};

type LiqWarn = {
  dex: PerpDexId;
  symbol: string;
  side: PerpPosition['side'];
  distancePct: number;
  liqPrice: number;
  markPrice: number;
};

export function MarketIntelCard({ markets, dexPositions }: Props) {
  const { data: trending = [] } = useTrendingCoins();
  const { data: fearGreed } = useFearGreedIndex();
  const { data: globalStats } = useGlobalMarketStats();
  const { data: news = [] } = useCryptoNews();

  // Build a set of symbols we CAN trade (across any of the 4 DEXs) so
  // trending coins can be tagged with which venues list them.
  const tradableByDex = useMemo(() => {
    const map = new Map<string, PerpDexId[]>();
    for (const { dex, market } of markets) {
      const sym = market.baseAsset.toUpperCase();
      const list = map.get(sym) ?? [];
      if (!list.includes(dex)) list.push(dex);
      map.set(sym, list);
    }
    return map;
  }, [markets]);
  // ── Funding-rate spreads ──────────────────────────────────────────────
  const fundingSpreads: readonly FundingSpread[] = useMemo(() => {
    // Bucket markets by baseAsset so we can compare the same symbol across venues.
    const bySymbol = new Map<string, Array<{ dex: PerpDexId; rate: number }>>();
    for (const { dex, market } of markets) {
      if (!isFinite(market.fundingRate)) continue;
      const key = market.baseAsset;
      const row = bySymbol.get(key) ?? [];
      row.push({ dex, rate: market.fundingRate });
      bySymbol.set(key, row);
    }
    const spreads: FundingSpread[] = [];
    for (const [symbol, rows] of bySymbol) {
      if (rows.length < 2) continue;
      const sorted = [...rows].sort((a, b) => a.rate - b.rate);
      const lo = sorted[0];
      const hi = sorted[sorted.length - 1];
      spreads.push({
        symbol,
        longDex: lo.dex,
        shortDex: hi.dex,
        spreadPct: (hi.rate - lo.rate) * 100,
      });
    }
    return spreads.sort((a, b) => b.spreadPct - a.spreadPct).slice(0, 3);
  }, [markets]);

  // ── 24h movers ────────────────────────────────────────────────────────
  const movers: readonly Mover[] = useMemo(() => {
    const rows: Mover[] = [];
    for (const { dex, market } of markets) {
      if (!(market.prevDayPx > 0) || !(market.markPrice > 0)) continue;
      const changePct = ((market.markPrice - market.prevDayPx) / market.prevDayPx) * 100;
      if (!isFinite(changePct)) continue;
      rows.push({ symbol: market.baseAsset, dex, changePct, markPrice: market.markPrice });
    }
    return rows.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 3);
  }, [markets]);

  // ── Liquidation proximity ──────────────────────────────────────────────
  const liqWarnings: readonly LiqWarn[] = useMemo(() => {
    const warnings: LiqWarn[] = [];
    for (const { dex, positions } of dexPositions) {
      for (const p of positions) {
        if (p.liquidationPrice === null || !(p.markPrice > 0)) continue;
        const distancePct = Math.abs((p.markPrice - p.liquidationPrice) / p.markPrice) * 100;
        if (distancePct > LIQ_PROXIMITY_WARN_PCT) continue;
        warnings.push({
          dex,
          symbol: p.symbol,
          side: p.side,
          distancePct,
          liqPrice: p.liquidationPrice,
          markPrice: p.markPrice,
        });
      }
    }
    return warnings.sort((a, b) => a.distancePct - b.distancePct).slice(0, 3);
  }, [dexPositions]);

  const hasAnySignal = fundingSpreads.length > 0 || movers.length > 0 || liqWarnings.length > 0 || trending.length > 0 || news.length > 0;

  return (
    <div className="rounded-lg flex flex-col" style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}>
      <div className="px-4 py-3" style={{ borderBottom: '1px solid #273035' }}>
        <div className="flex items-center gap-2">
          <span className="text-xs px-1.5 py-0.5 rounded text-[#7DB4FF] bg-[#7DB4FF]/10">INTEL</span>
          <h2 className="text-sm font-semibold text-white">Market Intel</h2>
        </div>
        <p className="text-xs mt-1" style={{ color: '#949E9C' }}>
          Cross-DEX situational awareness: funding spreads, 24h movers, liquidation risk
        </p>
      </div>

      <div className="p-4 flex flex-col gap-4">
        {/* Macro banner — Fear & Greed + Global market cap.
            Daily macro context: when BTC dominance climbs + F&G = Extreme Fear,
            altcoin MM inventory skew should shrink. */}
        {(fearGreed || globalStats) && (
          <div className="grid grid-cols-2 gap-2">
            {fearGreed && (
              <MacroTile
                label="Fear & Greed"
                value={`${fearGreed.score}`}
                sub={fearGreed.label}
                color={fearGreedColor(fearGreed.score)}
              />
            )}
            {globalStats && (
              <MacroTile
                label="BTC Dominance"
                value={`${globalStats.btcDominancePct.toFixed(1)}%`}
                sub={`24h cap ${globalStats.marketCapChangePct24h >= 0 ? '+' : ''}${globalStats.marketCapChangePct24h.toFixed(2)}%`}
                color={globalStats.marketCapChangePct24h >= 0 ? '#5fd8ee' : '#ED7088'}
              />
            )}
          </div>
        )}

        {/* Liquidation warnings take the top slot because they're the most time-critical */}
        {liqWarnings.length > 0 && (
          <Section title="Liquidation Warnings" accent="#ED7088">
            {liqWarnings.map(w => (
              <Row
                key={`${w.dex}:${w.symbol}:${w.side}`}
                left={`${DEX_LABEL[w.dex]} · ${w.symbol} ${w.side === 'long' ? 'LONG' : 'SHORT'}`}
                right={`${w.distancePct.toFixed(1)}% to liq @ $${w.liqPrice.toFixed(2)}`}
                highlight="neg"
              />
            ))}
          </Section>
        )}

        {fundingSpreads.length > 0 && (
          <Section title="Funding Rate Spreads" accent="#5fd8ee">
            {fundingSpreads.map(s => (
              <Row
                key={s.symbol}
                left={`${s.symbol} · long ${DEX_LABEL[s.longDex]} / short ${DEX_LABEL[s.shortDex]}`}
                right={`${s.spreadPct >= 0 ? '+' : ''}${s.spreadPct.toFixed(4)}%/8h`}
                highlight={s.spreadPct > 0.01 ? 'pos' : 'neutral'}
              />
            ))}
          </Section>
        )}

        {movers.length > 0 && (
          <Section title="24h Movers" accent="#FFA94D">
            {movers.map(m => (
              <Row
                key={`${m.dex}:${m.symbol}`}
                left={`${DEX_LABEL[m.dex]} · ${m.symbol}`}
                right={`${m.changePct >= 0 ? '+' : ''}${m.changePct.toFixed(2)}% · $${m.markPrice.toFixed(2)}`}
                highlight={m.changePct >= 0 ? 'pos' : 'neg'}
              />
            ))}
          </Section>
        )}

        {trending.length > 0 && (
          <Section title="Trending Globally (CoinGecko)" accent="#AB84FF">
            {trending.slice(0, 5).map(c => {
              const venues = tradableByDex.get(c.symbol) ?? [];
              const tradable = venues.length > 0;
              return (
                <Row
                  key={c.symbol}
                  left={`#${c.rank} · ${c.symbol} · ${c.name}`}
                  right={tradable ? `Trade on ${venues.map(v => DEX_LABEL[v]).join(' / ')}` : 'Not listed on our 4 DEXs'}
                  highlight={tradable ? 'pos' : 'neutral'}
                />
              );
            })}
          </Section>
        )}

        {news.length > 0 && (
          <Section title="Latest News (CryptoCompare)" accent="#7DB4FF">
            {news.slice(0, 5).map(n => (
              <a
                key={n.id}
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex justify-between items-center rounded px-2 py-1.5 hover:bg-[#1f2a30] transition-colors"
                style={{ backgroundColor: '#1B2429', border: '1px solid #273035' }}
              >
                <span className="text-xs text-white truncate pr-2">{n.title}</span>
                <span className="text-[10px] flex-shrink-0" style={{ color: '#949E9C' }}>
                  {n.source} · {fmtRelativeTime(n.publishedAt)}
                </span>
              </a>
            ))}
          </Section>
        )}

        {!hasAnySignal && (
          <div className="text-xs text-center py-6" style={{ color: '#5a6469' }}>
            No signals right now
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="h-1 w-1 rounded-full" style={{ backgroundColor: accent }} />
        <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: '#949E9C' }}>
          {title}
        </span>
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function Row({ left, right, highlight }: { left: string; right: string; highlight?: 'pos' | 'neg' | 'neutral' }) {
  const color = highlight === 'pos' ? '#5fd8ee' : highlight === 'neg' ? '#ED7088' : '#FFFFFF';
  return (
    <div className="flex justify-between items-center rounded px-2 py-1.5" style={{ backgroundColor: '#1B2429', border: '1px solid #273035' }}>
      <span className="text-xs text-white truncate">{left}</span>
      <span className="text-xs font-mono tabular-nums flex-shrink-0 ml-2" style={{ color }}>
        {right}
      </span>
    </div>
  );
}

function MacroTile({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-md px-3 py-2" style={{ backgroundColor: '#1B2429', border: '1px solid #273035' }}>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: '#949E9C' }}>{label}</div>
      <div className="flex items-baseline gap-2 mt-0.5">
        <span className="text-lg font-semibold font-mono tabular-nums" style={{ color }}>{value}</span>
        <span className="text-[10px]" style={{ color: '#5a6469' }}>{sub}</span>
      </div>
    </div>
  );
}

// Fear & Greed colour ramp — red (extreme fear) → orange → yellow → green (extreme greed).
function fearGreedColor(score: number): string {
  if (score <= 24) return '#ED7088'; // Extreme Fear
  if (score <= 49) return '#FFA94D'; // Fear
  if (score <= 74) return '#5fd8ee'; // Greed
  return '#AB84FF';                  // Extreme Greed
}

// "5m ago", "2h ago", "3d ago" — no external date lib.
function fmtRelativeTime(publishedAtSec: number): string {
  const deltaSec = Math.max(0, Date.now() / 1000 - publishedAtSec);
  if (deltaSec < 60) return 'just now';
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86_400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return `${Math.floor(deltaSec / 86_400)}d ago`;
}
