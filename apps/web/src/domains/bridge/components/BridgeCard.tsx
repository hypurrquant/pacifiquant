'use client';

/**
 * BridgeCard — Uniswap-style 양방향 브릿지 UI (멀티토큰)
 * 모든 체인 ↔ Hyperliquid L1 (1337) 브릿지
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { ContextRequiredError } from '@hq/core/lib/error';
import { useBridgeQuote, useBridgeExecution, useBridgeTokensWithBalance } from '../hooks/useBridge';
import { PipelineTab } from './PipelineTab';
import type { TokenWithBalance } from '../hooks/useBridge';
import { SUPPORTED_EXTERNAL_CHAINS, HL_CHAIN_ID, HL_USDC_ADDRESS } from '../types';
import type { BridgeDirection, BridgeToken } from '../types';

interface Props {
  walletAddress: string | null;
  onClose: () => void;
  onComplete?: () => void;
  onSendTransaction?: (tx: { to: string; data: string; value: string; chainId: number }) => Promise<string>;
  defaultChainId?: number; // 미니앱별 기본 체인 (World: 480, Base: 8453)
  /** Initial tab — deposit or withdraw. Default 'deposit'. */
  defaultDirection?: BridgeDirection;
}

type SlippageMode = 'auto' | 'custom';

export function BridgeCard({ walletAddress, onClose, onComplete, onSendTransaction, defaultChainId, defaultDirection = 'deposit' }: Props) {
  const [direction, setDirection] = useState<BridgeDirection>(defaultDirection);
  const [externalChainId, setExternalChainId] = useState(defaultChainId ?? 42161);
  const [amount, setAmount] = useState('');
  const [slippageMode, setSlippageMode] = useState<SlippageMode>('auto');
  const [customSlippage, setCustomSlippage] = useState('0.5');
  const [showSettings, setShowSettings] = useState(false);
  const [tokenSelectTarget, setTokenSelectTarget] = useState<'source' | 'dest' | null>(null);
  const [showChainSelect, setShowChainSelect] = useState(false);

  const sourceChainId = direction === 'deposit' ? externalChainId : HL_CHAIN_ID;
  const destChainId = direction === 'deposit' ? HL_CHAIN_ID : externalChainId;

  const { tokens: sourceTokens } = useBridgeTokensWithBalance(sourceChainId);
  const { tokens: destTokens } = useBridgeTokensWithBalance(destChainId);

  const defaultSourceToken = useMemo(() => {
    if (!sourceTokens.length) return null;
    return sourceTokens.find(t => t.symbol === 'USDC') ?? sourceTokens[0];
  }, [sourceTokens]);

  const defaultDestToken = useMemo(() => {
    if (!destTokens.length) return null;
    return destTokens.find(t => t.address.toLowerCase() === HL_USDC_ADDRESS.toLowerCase())
      ?? destTokens.find(t => t.symbol === 'USDC')
      ?? destTokens[0];
  }, [destTokens]);

  const [selectedSourceToken, setSelectedSourceToken] = useState<TokenWithBalance | null>(null);
  const [selectedDestToken, setSelectedDestToken] = useState<TokenWithBalance | null>(null);

  const sourceToken = selectedSourceToken ?? defaultSourceToken;
  const destToken = selectedDestToken ?? defaultDestToken;

  // MAX 버튼용 잔고
  const sourceBalance = sourceToken?.balance ?? null;

  useEffect(() => {
    setSelectedSourceToken(null);
    setSelectedDestToken(null);
  }, [externalChainId, direction]);

  const externalChain = SUPPORTED_EXTERNAL_CHAINS.find(c => c.chainId === externalChainId);
  const sourceChainName = direction === 'deposit' ? externalChain?.name ?? '' : 'Hyperliquid';
  const destChainName = direction === 'deposit' ? 'Hyperliquid' : externalChain?.name ?? '';

  const { data: quote, isLoading: quoteLoading } = useBridgeQuote({
    direction,
    externalChainId,
    sourceToken: sourceToken?.address ?? '',
    destToken: destToken?.address ?? '',
    amount,
    sourceDecimals: sourceToken?.decimals ?? 6,
    walletAddress,
  });

  const { status, isExecuting, execute, reset } = useBridgeExecution();

  const handleBridge = useCallback(async () => {
    if (!quote || !walletAddress) return;
    await execute(quote, async (tx) => {
      if (!onSendTransaction) throw new ContextRequiredError('Wallet not connected');
      return onSendTransaction(tx);
    });
    onComplete?.();
  }, [quote, walletAddress, execute, onComplete, onSendTransaction]);

  const handleSwapDirection = useCallback(() => {
    setDirection(prev => prev === 'deposit' ? 'withdraw' : 'deposit');
    setAmount('');
  }, []);

  const directionLabel = direction === 'deposit' ? 'Deposit' : 'Withdraw';
  const [showPipeline, setShowPipeline] = useState(false);

  return (
    <div className="bg-[#0F1A1F] border border-[#273035] rounded-lg p-3 mx-auto w-full relative">
      {/* Header: Tabs + Settings + Close */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex bg-[#1B2429] rounded p-0.5">
          <TabButton active={!showPipeline && direction === 'deposit'} label="Deposit" onClick={() => { setShowPipeline(false); setDirection('deposit'); setAmount(''); }} />
          <TabButton active={!showPipeline && direction === 'withdraw'} label="Withdraw" onClick={() => { setShowPipeline(false); setDirection('withdraw'); setAmount(''); }} />
          <TabButton active={showPipeline} label="Pipeline" onClick={() => setShowPipeline(true)} />
        </div>
        <div className="flex items-center gap-1">
          <SettingsButton
            show={showSettings}
            onToggle={() => setShowSettings(p => !p)}
            slippageMode={slippageMode}
            customSlippage={customSlippage}
            onSlippageModeChange={setSlippageMode}
            onCustomSlippageChange={setCustomSlippage}
          />
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {showPipeline ? (
        <PipelineTab onClose={onClose} />
      ) : (<>
      {/* From Card */}
      <div className="bg-[#1B2429] rounded-lg p-2.5 mb-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-gray-500">From</span>
          <ChainBadge
            chainName={sourceChainName}
            onClick={direction === 'deposit' ? () => setShowChainSelect(true) : undefined}
            showChevron={direction === 'deposit'}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="bg-transparent text-xl font-light text-white w-full outline-none placeholder:text-gray-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none min-w-0"
          />
          <TokenButton
            token={sourceToken}
            onClick={() => setTokenSelectTarget('source')}
          />
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-[10px] text-gray-600">$0.00</span>
          <button
            onClick={() => sourceBalance && setAmount(sourceBalance)}
            className="text-[#5fd8ee] text-[10px] font-medium hover:text-[#93E3F3] transition-colors"
          >
            MAX: {sourceBalance ?? '-'}
          </button>
        </div>
      </div>

      {/* Swap Direction Arrow */}
      <div className="flex justify-center -my-2 relative z-10">
        <button
          onClick={handleSwapDirection}
          className="w-7 h-7 rounded bg-[#0F1A1F] border-4 border-[#0F1A1F] flex items-center justify-center hover:bg-[#273035] transition-colors"
        >
          <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      </div>

      {/* To Card */}
      <div className="bg-[#1B2429] rounded-lg p-2.5 mt-1 mb-2.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-gray-500">To</span>
          <ChainBadge
            chainName={destChainName}
            onClick={direction === 'withdraw' ? () => setShowChainSelect(true) : undefined}
            showChevron={direction === 'withdraw'}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className={`text-xl font-light min-w-0 truncate ${quote ? 'text-white' : 'text-gray-700'}`}>
            {quoteLoading ? '...' : quote ? quote.amountOutFormatted : '0'}
          </span>
          <TokenButton
            token={destToken}
            onClick={() => setTokenSelectTarget('dest')}
          />
        </div>
        <div className="text-[10px] text-gray-600 mt-0.5">
          {quote ? `$${parseFloat(quote.amountOutFormatted).toFixed(2)}` : '$0.00'}
        </div>
      </div>

      {/* Quote Info */}
      {quote && !quoteLoading && (
        <div className="mb-2.5 px-1 space-y-0.5 text-[10px]">
          <div className="flex justify-between text-gray-500">
            <span>Fee</span>
            <span className="text-gray-400">{quote.feeFormatted} {sourceToken?.symbol}</span>
          </div>
          <div className="flex justify-between text-gray-500">
            <span>Est. time</span>
            <span className="text-gray-400">~{Math.max(1, Math.ceil(quote.estimatedTime / 60))} min</span>
          </div>
        </div>
      )}

      {/* Status */}
      {status && (
        <div className={`mb-3 rounded-lg px-3 py-2 text-[11px] ${
          status.status === 'completed' ? 'bg-emerald-900/20 border border-emerald-800' :
          status.status === 'failed' ? 'bg-red-900/20 border border-red-800' :
          'bg-gray-900/40 border border-dark-600'
        }`}>
          <div className="flex items-center gap-2">
            {status.status === 'pending' && <span className="animate-spin text-gray-400">...</span>}
            {status.status === 'confirming' && <span className="animate-pulse text-yellow-400">Confirming...</span>}
            {status.status === 'completed' && <span className="text-primary">Completed</span>}
            {status.status === 'failed' && <span className="text-red-400">Failed</span>}
          </div>
          {status.txHash && <span className="text-gray-600 mt-1 block truncate">TX: {status.txHash}</span>}
        </div>
      )}

      {/* Action Button */}
      <button
        onClick={status ? reset : handleBridge}
        disabled={(!quote && !status) || isExecuting || !walletAddress}
        className="w-full py-2 rounded text-xs font-semibold tracking-wide bg-[#5fd8ee] hover:bg-[#93E3F3] text-[#0F1A1E] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {!walletAddress
          ? 'Connect Wallet'
          : isExecuting
            ? 'Bridging...'
            : status?.status === 'completed'
              ? 'Done'
              : status?.status === 'failed'
                ? 'Try Again'
                : directionLabel
        }
      </button>

      {/* Token Select Bottom Sheet */}
      {tokenSelectTarget && (
        <TokenSelectSheet
          tokens={tokenSelectTarget === 'source' ? sourceTokens : destTokens}
          selected={tokenSelectTarget === 'source' ? sourceToken : destToken}
          onSelect={(t) => {
            if (tokenSelectTarget === 'source') setSelectedSourceToken(t);
            else setSelectedDestToken(t);
            setTokenSelectTarget(null);
          }}
          onClose={() => setTokenSelectTarget(null)}
        />
      )}

      {/* Chain Select Bottom Sheet */}
      {showChainSelect && (
        <ChainSelectSheet
          selectedChainId={externalChainId}
          onSelect={(id) => { setExternalChainId(id); setShowChainSelect(false); }}
          onClose={() => setShowChainSelect(false)}
        />
      )}
      </>)}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
        active ? 'bg-[#5fd8ee]/15 text-[#5fd8ee]' : 'text-gray-500 hover:text-gray-400'
      }`}
    >
      {label}
    </button>
  );
}

function TokenButton({ token, onClick }: { token: BridgeToken | null; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 bg-[#273035] hover:bg-[#2F3A40] rounded-full pl-1.5 pr-2 py-1 transition-colors shrink-0"
    >
      {token?.logoURI ? (
        <img src={token.logoURI} alt={token.symbol} className="w-5 h-5 rounded-full" />
      ) : (
        <div className="w-5 h-5 rounded-full bg-gray-600 flex items-center justify-center text-[9px] text-gray-300">
          {token?.symbol?.[0] ?? '?'}
        </div>
      )}
      <span className="text-white text-xs font-medium">{token?.symbol ?? 'Select'}</span>
      <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

function ChainBadge({
  chainName,
  onClick,
  showChevron,
}: {
  chainName: string;
  onClick?: () => void;
  showChevron: boolean;
}) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      onClick={onClick}
      className={`text-xs text-gray-400 flex items-center gap-1 ${onClick ? 'hover:text-gray-300 cursor-pointer' : ''}`}
    >
      {chainName}
      {showChevron && (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      )}
    </Tag>
  );
}

function SettingsButton({
  show,
  onToggle,
  slippageMode,
  customSlippage,
  onSlippageModeChange,
  onCustomSlippageChange,
}: {
  show: boolean;
  onToggle: () => void;
  slippageMode: SlippageMode;
  customSlippage: string;
  onSlippageModeChange: (m: SlippageMode) => void;
  onCustomSlippageChange: (v: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onToggle();
    }
    if (show) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [show, onToggle]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={onToggle} className="text-gray-500 hover:text-white transition-colors p-1">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93s.844.083 1.168-.195l.665-.555c.427-.357 1.04-.337 1.446.05l.773.773c.387.406.407 1.02.05 1.446l-.555.665c-.278.324-.362.773-.195 1.168s.506.71.93.78l.894.149c.542.09.94.56.94 1.11v1.093c0 .55-.398 1.02-.94 1.11l-.894.149c-.424.07-.764.384-.93.78s-.083.844.195 1.168l.555.665c.357.427.337 1.04-.05 1.446l-.773.773c-.406.387-1.02.407-1.446.05l-.665-.555c-.324-.278-.773-.362-1.168-.195s-.71.506-.78.93l-.149.894c-.09.542-.56.94-1.11.94h-1.093c-.55 0-1.02-.398-1.11-.94l-.149-.894c-.07-.424-.384-.764-.78-.93s-.844-.083-1.168.195l-.665.555c-.427.357-1.04.337-1.446-.05l-.773-.773c-.387-.406-.407-1.02-.05-1.446l.555-.665c.278-.324.362-.773.195-1.168s-.506-.71-.93-.78l-.894-.149c-.542-.09-.94-.56-.94-1.11v-1.093c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.764-.384.93-.78s.083-.844-.195-1.168l-.555-.665c-.357-.427-.337-1.04.05-1.446l.773-.773c.406-.387 1.02-.407 1.446-.05l.665.555c.324.278.773.362 1.168.195s.71-.506.78-.93l.149-.894z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {show && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-[#1e2336] border border-dark-600 rounded-xl p-4 z-30 shadow-xl">
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-sm font-medium text-white">Max Slippage</span>
            <div className="group relative">
              <svg className="w-3.5 h-3.5 text-gray-500 cursor-help" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
          </div>
          <div className="flex bg-gray-900/60 rounded-lg p-0.5 mb-3">
            <button
              onClick={() => onSlippageModeChange('auto')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                slippageMode === 'auto' ? 'bg-primary/15 text-primary' : 'text-gray-500'
              }`}
            >
              Auto
            </button>
            <button
              onClick={() => onSlippageModeChange('custom')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                slippageMode === 'custom' ? 'bg-primary/15 text-primary' : 'text-gray-500'
              }`}
            >
              Custom
            </button>
          </div>
          {slippageMode === 'auto' ? (
            <p className="text-xs text-gray-500">
              We&apos;ll set the slippage automatically to minimize the failure rate.
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={customSlippage}
                onChange={(e) => onCustomSlippageChange(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-sm text-gray-400">%</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Bottom Sheets ───────────────────────────────────────

function TokenSelectSheet({
  tokens,
  selected,
  onSelect,
  onClose,
}: {
  tokens: TokenWithBalance[];
  selected: TokenWithBalance | null;
  onSelect: (t: TokenWithBalance) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md md:mx-4 bg-[#1a1f2e] border border-dark-600 rounded-t-2xl md:rounded-2xl p-5 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar (mobile) */}
        <div className="flex justify-center mb-3 md:hidden">
          <div className="w-10 h-1 rounded-full bg-gray-600" />
        </div>

        <h3 className="text-base font-semibold text-white text-center mb-4">Select Token</h3>

        <div className="grid grid-cols-2 gap-2 mb-4 max-h-60 overflow-y-auto">
          {tokens.map(t => (
            <button
              key={t.address}
              onClick={() => onSelect(t)}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${
                selected?.address === t.address
                  ? 'border-primary bg-primary/5'
                  : 'border-dark-600 hover:border-gray-600'
              }`}
            >
              {t.logoURI ? (
                <img src={t.logoURI} alt={t.symbol} className="w-10 h-10 rounded-full" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-sm text-gray-300 font-medium">
                  {t.symbol[0]}
                </div>
              )}
              <span className="text-sm font-medium text-white">{t.symbol}</span>
              <span className="text-xs text-gray-500">
                {t.balance !== null ? t.balance : '-'}
              </span>
            </button>
          ))}
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl text-sm font-medium border border-dark-600 text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ChainSelectSheet({
  selectedChainId,
  onSelect,
  onClose,
}: {
  selectedChainId: number;
  onSelect: (chainId: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md md:mx-4 bg-[#1a1f2e] border border-dark-600 rounded-t-2xl md:rounded-2xl p-5 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center mb-3 md:hidden">
          <div className="w-10 h-1 rounded-full bg-gray-600" />
        </div>

        <h3 className="text-base font-semibold text-white text-center mb-4">Select Chain</h3>

        <div className="space-y-1 max-h-60 overflow-y-auto mb-4">
          {SUPPORTED_EXTERNAL_CHAINS.map(c => (
            <button
              key={c.chainId}
              onClick={() => onSelect(c.chainId)}
              className={`w-full px-4 py-3 rounded-xl text-left text-sm flex items-center justify-between transition-colors ${
                c.chainId === selectedChainId
                  ? 'bg-primary/10 text-primary border border-primary/30'
                  : 'text-gray-300 hover:bg-gray-800/50 border border-transparent'
              }`}
            >
              <span>{c.name}</span>
              {c.chainId === selectedChainId && (
                <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl text-sm font-medium border border-dark-600 text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
