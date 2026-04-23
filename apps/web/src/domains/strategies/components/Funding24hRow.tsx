'use client';

/**
 * Funding24hRow — net funding PnL over the last 24h, aggregated across the
 * four perp DEXs. A single line under Portfolio Overview that answers "is my
 * current position actually making money?" without forcing the user to open
 * per-DEX funding-history tabs.
 */

import { useEffect, useState } from 'react';
import type { FundingHistoryEntry } from '@hq/core/defi/perp';
import { getAdapterByDex } from '@/domains/perp/hooks/usePerpAdapter';
import { PERP_DEX_ORDER } from '@/shared/config/perp-dex-display';
import type { PerpDexId } from '@/domains/perp/types/perp.types';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const REFRESH_MS = 60_000;

interface Props {
  readonly accounts: Record<PerpDexId, string | null>;
}

interface DexNet {
  readonly dex: PerpDexId;
  readonly net: number;
}

async function fetchDex(dex: PerpDexId, addr: string): Promise<number> {
  try {
    const since = Date.now() - WINDOW_MS;
    const rows: FundingHistoryEntry[] = await getAdapterByDex(dex).getFundingHistory(addr, since);
    return rows.reduce((s, r) => s + r.payment, 0);
  } catch {
    return 0;
  }
}

export function Funding24hRow({ accounts }: Props) {
  const [perDex, setPerDex] = useState<DexNet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const results = await Promise.all(PERP_DEX_ORDER.map(async (dex) => {
        const addr = accounts[dex];
        if (!addr) return { dex, net: 0 };
        return { dex, net: await fetchDex(dex, addr) };
      }));
      if (cancelled) return;
      setPerDex(results);
      setLoading(false);
    };
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [accounts]);

  const total = perDex.reduce((s, r) => s + r.net, 0);
  const totalColor = total === 0 ? '#949E9C' : total > 0 ? '#6EE7B7' : '#ED7088';
  const sign = total > 0 ? '+' : total < 0 ? '-' : '';

  return (
    <div
      className="flex items-center justify-between px-3 py-2 rounded-md"
      style={{ backgroundColor: '#0B141A', border: '1px solid #1B2429' }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: '#949E9C' }}>
          Last 24h funding
        </span>
        {loading && <span className="text-[10px]" style={{ color: '#5a6469' }}>loading…</span>}
      </div>
      <div className="flex items-center gap-3">
        {perDex.filter((r) => r.net !== 0).map((r) => (
          <span key={r.dex} className="text-[10px] tabular-nums" style={{ color: r.net >= 0 ? '#6EE7B7' : '#ED7088' }}>
            {r.dex.slice(0, 3).toUpperCase()} {r.net >= 0 ? '+' : ''}${r.net.toFixed(2)}
          </span>
        ))}
        <span className="text-sm font-semibold tabular-nums" style={{ color: totalColor }}>
          {sign}${Math.abs(total).toFixed(2)}
        </span>
      </div>
    </div>
  );
}
