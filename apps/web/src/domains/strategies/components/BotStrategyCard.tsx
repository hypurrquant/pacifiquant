'use client';

/**
 * BotStrategyCard — unified card for Grid / DCA / TWAP bot strategies
 *
 * Tab selector switches between strategy types. Each tab shows a config
 * form and a "Start" button that computes a preview of the order plan.
 * Actual execution is deferred to a future phase.
 */

import { useState, useMemo } from 'react';
import type { PerpMarket } from '@hq/core/defi/perp';
import {
  computeGridLevels,
  computeDcaSchedule,
  computeTwapSlices,
} from '@hq/core/defi/perp';
import type {
  StrategyType,
  GridConfig,
  DcaConfig,
  TwapConfig,
  GridLevel,
  DcaScheduleEntry,
  TwapSlice,
} from '@hq/core/defi/perp';
import { useMarkets } from '@/domains/perp/hooks/usePerpData';
import type { PerpDexId } from '@/domains/perp/types/perp.types';

// ─── Types ───

type PreviewData =
  | { type: 'grid'; levels: GridLevel[] }
  | { type: 'dca'; schedule: DcaScheduleEntry[] }
  | { type: 'twap'; slices: TwapSlice[] };

interface Props {
  markets: PerpMarket[];
}

// ─── Constants ───

const TABS: readonly { key: StrategyType; label: string }[] = [
  { key: 'grid', label: 'Grid' },
  { key: 'dca', label: 'DCA' },
  { key: 'twap', label: 'TWAP' },
];

const DEX_OPTIONS: readonly { id: PerpDexId; label: string; color: string }[] = [
  { id: 'hyperliquid', label: 'HL', color: '#5fd8ee' },
  { id: 'pacifica', label: 'PAC', color: '#AB9FF2' },
  { id: 'lighter', label: 'LT', color: '#4A9EF5' },
  { id: 'aster', label: 'AST', color: '#FFA94D' },
];

// ─── Component ───

export function BotStrategyCard({ markets }: Props) {
  const { data: liveMarkets = markets } = useMarkets();
  const perpMarkets = useMemo(
    () => liveMarkets.filter(m => m.assetType === 'perp'),
    [liveMarkets],
  );

  const [activeTab, setActiveTab] = useState<StrategyType>('grid');
  const [selectedDex, setSelectedDex] = useState<PerpDexId>('hyperliquid');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Grid state
  const [gridSymbol, setGridSymbol] = useState('BTC');
  const [gridUpper, setGridUpper] = useState('');
  const [gridLower, setGridLower] = useState('');
  const [gridCount, setGridCount] = useState('10');
  const [gridSize, setGridSize] = useState('1000');
  const [gridSide, setGridSide] = useState<'long' | 'short' | 'neutral'>('neutral');

  // DCA state
  const [dcaSymbol, setDcaSymbol] = useState('BTC');
  const [dcaSide, setDcaSide] = useState<'long' | 'short'>('long');
  const [dcaOrderSize, setDcaOrderSize] = useState('100');
  const [dcaInterval, setDcaInterval] = useState('60');
  const [dcaTotalOrders, setDcaTotalOrders] = useState('10');
  const [dcaPriceLimit, setDcaPriceLimit] = useState('');

  // TWAP state
  const [twapSymbol, setTwapSymbol] = useState('BTC');
  const [twapSide, setTwapSide] = useState<'long' | 'short'>('long');
  const [twapTotalSize, setTwapTotalSize] = useState('1000');
  const [twapDuration, setTwapDuration] = useState('600');
  const [twapSlices, setTwapSlices] = useState('10');

  const clearPreview = () => {
    setPreview(null);
    setPreviewError(null);
  };

  const handleTabChange = (tab: StrategyType) => {
    setActiveTab(tab);
    clearPreview();
  };

  const handleStart = () => {
    clearPreview();

    try {
      if (activeTab === 'grid') {
        const config: GridConfig = {
          type: 'grid',
          symbol: gridSymbol,
          exchange: selectedDex,
          upperPrice: parseFloat(gridUpper),
          lowerPrice: parseFloat(gridLower),
          gridCount: parseInt(gridCount, 10),
          totalSize: parseFloat(gridSize),
          side: gridSide,
        };
        const levels = computeGridLevels(config);
        setPreview({ type: 'grid', levels });
      } else if (activeTab === 'dca') {
        const config: DcaConfig = {
          type: 'dca',
          symbol: dcaSymbol,
          exchange: selectedDex,
          side: dcaSide,
          orderSize: parseFloat(dcaOrderSize),
          intervalMs: parseFloat(dcaInterval) * 1000,
          totalOrders: parseInt(dcaTotalOrders, 10),
          priceLimit: dcaPriceLimit ? parseFloat(dcaPriceLimit) : null,
        };
        const schedule = computeDcaSchedule(config);
        setPreview({ type: 'dca', schedule });
      } else {
        const config: TwapConfig = {
          type: 'twap',
          symbol: twapSymbol,
          exchange: selectedDex,
          side: twapSide,
          totalSize: parseFloat(twapTotalSize),
          durationMs: parseFloat(twapDuration) * 1000,
          slices: parseInt(twapSlices, 10),
        };
        const slices = computeTwapSlices(config);
        setPreview({ type: 'twap', slices });
      }
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Invalid config');
    }
  };

  return (
    <div className="rounded-lg flex flex-col" style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}>
      {/* Header */}
      <div className="px-4 py-3" style={{ borderBottom: '1px solid #273035' }}>
        <div className="flex items-center gap-2">
          <span className="text-xs px-1.5 py-0.5 rounded text-[#5fd8ee] bg-[#5fd8ee]/10">BOT</span>
          <h2 className="text-sm font-semibold text-white">Bot Strategies</h2>
        </div>
        <p className="text-xs mt-1" style={{ color: '#949E9C' }}>
          Automated Grid, DCA, and TWAP execution plans
        </p>
      </div>

      {/* Tab selector */}
      <div className="flex px-4 pt-3 gap-1" style={{ borderBottom: '1px solid #273035' }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className="px-3 pb-2 text-xs font-medium transition-colors"
            style={{
              color: activeTab === tab.key ? '#5fd8ee' : '#949E9C',
              borderBottom: activeTab === tab.key ? '2px solid #5fd8ee' : '2px solid transparent',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* DEX picker */}
      <div className="flex items-center gap-1.5 px-4 py-2" style={{ borderBottom: '1px solid #273035' }}>
        <span className="text-[10px] mr-1" style={{ color: '#949E9C' }}>Exchange</span>
        {DEX_OPTIONS.map(opt => {
          const isActive = selectedDex === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => setSelectedDex(opt.id)}
              className="px-2.5 py-0.5 rounded text-[10px] font-semibold transition-colors"
              style={{
                backgroundColor: isActive ? `${opt.color}22` : 'transparent',
                color: isActive ? opt.color : '#5a6469',
                border: `1px solid ${isActive ? opt.color : '#273035'}`,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Config form */}
      <div className="p-4 flex flex-col gap-3">
        {activeTab === 'grid' && (
          <GridForm
            markets={perpMarkets}
            symbol={gridSymbol}
            onSymbol={setGridSymbol}
            upper={gridUpper}
            onUpper={setGridUpper}
            lower={gridLower}
            onLower={setGridLower}
            count={gridCount}
            onCount={setGridCount}
            size={gridSize}
            onSize={setGridSize}
            side={gridSide}
            onSide={setGridSide}
          />
        )}
        {activeTab === 'dca' && (
          <DcaForm
            markets={perpMarkets}
            symbol={dcaSymbol}
            onSymbol={setDcaSymbol}
            side={dcaSide}
            onSide={setDcaSide}
            orderSize={dcaOrderSize}
            onOrderSize={setDcaOrderSize}
            interval={dcaInterval}
            onInterval={setDcaInterval}
            totalOrders={dcaTotalOrders}
            onTotalOrders={setDcaTotalOrders}
            priceLimit={dcaPriceLimit}
            onPriceLimit={setDcaPriceLimit}
          />
        )}
        {activeTab === 'twap' && (
          <TwapForm
            markets={perpMarkets}
            symbol={twapSymbol}
            onSymbol={setTwapSymbol}
            side={twapSide}
            onSide={setTwapSide}
            totalSize={twapTotalSize}
            onTotalSize={setTwapTotalSize}
            duration={twapDuration}
            onDuration={setTwapDuration}
            slices={twapSlices}
            onSlices={setTwapSlices}
          />
        )}

        {/* Error */}
        {previewError && (
          <div className="rounded px-3 py-2 text-xs" style={{ backgroundColor: '#2A1111', border: '1px solid #5A2222', color: '#E84B4B' }}>
            {previewError}
          </div>
        )}

        {/* Start button */}
        <button
          onClick={handleStart}
          className="mt-1 w-full py-2 rounded-md text-xs font-semibold bg-[#5fd8ee] hover:bg-[#93E3F3] text-[#0F1A1E] transition-colors"
        >
          Preview Plan
        </button>
      </div>

      {/* Preview */}
      {preview && (
        <div className="px-4 pb-4">
          <PreviewPanel preview={preview} />
        </div>
      )}
    </div>
  );
}

// ─── Grid Form ───

function GridForm({
  markets,
  symbol,
  onSymbol,
  upper,
  onUpper,
  lower,
  onLower,
  count,
  onCount,
  size,
  onSize,
  side,
  onSide,
}: {
  markets: PerpMarket[];
  symbol: string;
  onSymbol: (v: string) => void;
  upper: string;
  onUpper: (v: string) => void;
  lower: string;
  onLower: (v: string) => void;
  count: string;
  onCount: (v: string) => void;
  size: string;
  onSize: (v: string) => void;
  side: 'long' | 'short' | 'neutral';
  onSide: (v: 'long' | 'short' | 'neutral') => void;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Market">
          <MarketSelect markets={markets} value={symbol} onChange={onSymbol} />
        </Field>
        <Field label="Side">
          <select
            value={side}
            onChange={(e) => onSide(e.target.value as 'long' | 'short' | 'neutral')}
            className="w-full bg-transparent text-xs text-white rounded px-2 py-1.5 focus:outline-none"
            style={{ border: '1px solid #273035', backgroundColor: '#1B2429' }}
          >
            <option value="neutral" style={{ backgroundColor: '#0F1A1F' }}>Neutral</option>
            <option value="long" style={{ backgroundColor: '#0F1A1F' }}>Long</option>
            <option value="short" style={{ backgroundColor: '#0F1A1F' }}>Short</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Upper Price">
          <NumberInput value={upper} onChange={onUpper} placeholder="e.g. 105000" />
        </Field>
        <Field label="Lower Price">
          <NumberInput value={lower} onChange={onLower} placeholder="e.g. 95000" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Grid Count">
          <NumberInput value={count} onChange={onCount} />
        </Field>
        <Field label="Total Size (USDC)">
          <NumberInput value={size} onChange={onSize} />
        </Field>
      </div>
    </>
  );
}

// ─── DCA Form ───

function DcaForm({
  markets,
  symbol,
  onSymbol,
  side,
  onSide,
  orderSize,
  onOrderSize,
  interval,
  onInterval,
  totalOrders,
  onTotalOrders,
  priceLimit,
  onPriceLimit,
}: {
  markets: PerpMarket[];
  symbol: string;
  onSymbol: (v: string) => void;
  side: 'long' | 'short';
  onSide: (v: 'long' | 'short') => void;
  orderSize: string;
  onOrderSize: (v: string) => void;
  interval: string;
  onInterval: (v: string) => void;
  totalOrders: string;
  onTotalOrders: (v: string) => void;
  priceLimit: string;
  onPriceLimit: (v: string) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Market">
          <MarketSelect markets={markets} value={symbol} onChange={onSymbol} />
        </Field>
        <Field label="Side">
          <SideSelect value={side} onChange={onSide} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Order Size (USDC)">
          <NumberInput value={orderSize} onChange={onOrderSize} />
        </Field>
        <Field label="Interval (sec)">
          <NumberInput value={interval} onChange={onInterval} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Total Orders">
          <NumberInput value={totalOrders} onChange={onTotalOrders} />
        </Field>
        <Field label="Price Limit (opt.)">
          <NumberInput value={priceLimit} onChange={onPriceLimit} placeholder="No limit" />
        </Field>
      </div>
      <SummaryRow label="Total Spend" value={`$${(parseFloat(orderSize || '0') * parseInt(totalOrders || '0', 10)).toLocaleString()}`} />
    </>
  );
}

// ─── TWAP Form ───

function TwapForm({
  markets,
  symbol,
  onSymbol,
  side,
  onSide,
  totalSize,
  onTotalSize,
  duration,
  onDuration,
  slices,
  onSlices,
}: {
  markets: PerpMarket[];
  symbol: string;
  onSymbol: (v: string) => void;
  side: 'long' | 'short';
  onSide: (v: 'long' | 'short') => void;
  totalSize: string;
  onTotalSize: (v: string) => void;
  duration: string;
  onDuration: (v: string) => void;
  slices: string;
  onSlices: (v: string) => void;
}) {
  const durationSec = parseFloat(duration || '0');
  const numSlices = parseInt(slices || '0', 10);
  const intervalDisplay = numSlices > 0 ? (durationSec / numSlices).toFixed(1) : '0';

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Market">
          <MarketSelect markets={markets} value={symbol} onChange={onSymbol} />
        </Field>
        <Field label="Side">
          <SideSelect value={side} onChange={onSide} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Total Size (USDC)">
          <NumberInput value={totalSize} onChange={onTotalSize} />
        </Field>
        <Field label="Duration (sec)">
          <NumberInput value={duration} onChange={onDuration} />
        </Field>
      </div>
      <Field label="Slices">
        <NumberInput value={slices} onChange={onSlices} />
      </Field>
      <SummaryRow label="Interval" value={`${intervalDisplay}s per slice`} />
    </>
  );
}

// ─── Preview Panel ───

function PreviewPanel({ preview }: { preview: PreviewData }) {
  return (
    <div className="rounded p-3" style={{ backgroundColor: '#1B2429', border: '1px solid #273035' }}>
      <div className="text-xs font-medium text-white mb-2">Order Plan Preview</div>
      <div className="max-h-48 overflow-y-auto">
        {preview.type === 'grid' && <GridPreview levels={preview.levels} />}
        {preview.type === 'dca' && <DcaPreview schedule={preview.schedule} />}
        {preview.type === 'twap' && <TwapPreview slices={preview.slices} />}
      </div>
    </div>
  );
}

function GridPreview({ levels }: { levels: GridLevel[] }) {
  return (
    <table className="w-full text-xs font-mono tabular-nums">
      <thead>
        <tr style={{ color: '#949E9C' }}>
          <th className="text-left py-1 font-normal">#</th>
          <th className="text-right py-1 font-normal">Price</th>
          <th className="text-right py-1 font-normal">Size</th>
          <th className="text-right py-1 font-normal">Side</th>
        </tr>
      </thead>
      <tbody>
        {levels.map((lvl, i) => (
          <tr key={i} style={{ color: lvl.side === 'long' ? '#5fd8ee' : '#E84B6A' }}>
            <td className="py-0.5">{i + 1}</td>
            <td className="text-right py-0.5">${lvl.price.toFixed(2)}</td>
            <td className="text-right py-0.5">${lvl.size.toFixed(2)}</td>
            <td className="text-right py-0.5">{lvl.side}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DcaPreview({ schedule }: { schedule: DcaScheduleEntry[] }) {
  return (
    <table className="w-full text-xs font-mono tabular-nums">
      <thead>
        <tr style={{ color: '#949E9C' }}>
          <th className="text-left py-1 font-normal">#</th>
          <th className="text-right py-1 font-normal">Delay</th>
          <th className="text-right py-1 font-normal">Size</th>
        </tr>
      </thead>
      <tbody>
        {schedule.map((entry, i) => (
          <tr key={i} className="text-white">
            <td className="py-0.5">{i + 1}</td>
            <td className="text-right py-0.5">{(entry.delayMs / 1000).toFixed(0)}s</td>
            <td className="text-right py-0.5">${entry.size.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TwapPreview({ slices }: { slices: TwapSlice[] }) {
  const totalSize = slices.reduce((s, e) => s + e.size, 0);

  return (
    <table className="w-full text-xs font-mono tabular-nums">
      <thead>
        <tr style={{ color: '#949E9C' }}>
          <th className="text-left py-1 font-normal">#</th>
          <th className="text-right py-1 font-normal">Delay</th>
          <th className="text-right py-1 font-normal">Size</th>
          <th className="text-right py-1 font-normal">Cum %</th>
        </tr>
      </thead>
      <tbody>
        {slices.reduce<{ rows: React.ReactNode[]; cumSize: number }>(
          (acc, slice, i) => {
            const cumSize = acc.cumSize + slice.size;
            const pct = totalSize > 0 ? ((cumSize / totalSize) * 100).toFixed(1) : '0.0';
            acc.rows.push(
              <tr key={i} className="text-white">
                <td className="py-0.5">{i + 1}</td>
                <td className="text-right py-0.5">{(slice.delayMs / 1000).toFixed(0)}s</td>
                <td className="text-right py-0.5">${slice.size.toFixed(2)}</td>
                <td className="text-right py-0.5">{pct}%</td>
              </tr>,
            );
            return { rows: acc.rows, cumSize };
          },
          { rows: [], cumSize: 0 },
        ).rows}
      </tbody>
    </table>
  );
}

// ─── Shared UI atoms ───

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs" style={{ color: '#949E9C' }}>{label}</span>
      {children}
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-transparent text-xs text-white font-mono tabular-nums rounded px-2 py-1.5 focus:outline-none placeholder:text-[#5a6469]"
      style={{ border: '1px solid #273035', backgroundColor: '#1B2429' }}
    />
  );
}

function MarketSelect({
  markets,
  value,
  onChange,
}: {
  markets: PerpMarket[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-transparent text-xs text-white rounded px-2 py-1.5 focus:outline-none"
      style={{ border: '1px solid #273035', backgroundColor: '#1B2429' }}
    >
      {markets.slice(0, 30).map(m => (
        <option key={m.symbol} value={m.symbol} style={{ backgroundColor: '#0F1A1F' }}>
          {m.baseAsset}-{m.quoteAsset}
        </option>
      ))}
    </select>
  );
}

function SideSelect({
  value,
  onChange,
}: {
  value: 'long' | 'short';
  onChange: (v: 'long' | 'short') => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as 'long' | 'short')}
      className="w-full bg-transparent text-xs text-white rounded px-2 py-1.5 focus:outline-none"
      style={{ border: '1px solid #273035', backgroundColor: '#1B2429' }}
    >
      <option value="long" style={{ backgroundColor: '#0F1A1F' }}>Long</option>
      <option value="short" style={{ backgroundColor: '#0F1A1F' }}>Short</option>
    </select>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center px-1">
      <span className="text-xs" style={{ color: '#949E9C' }}>{label}</span>
      <span className="text-xs font-mono tabular-nums text-white">{value}</span>
    </div>
  );
}
