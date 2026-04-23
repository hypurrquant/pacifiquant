'use client';

/**
 * BridgeCard — Uniswap-style 양방향 브릿지 UI (멀티토큰)
 * 모든 체인 ↔ Hyperliquid L1 (1337) 브릿지
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { ContextRequiredError } from '@hq/core/lib/error';
import { useBridgeQuote, useBridgeExecution, useBridgeTokensWithBalance } from '../hooks/useBridge';
import { useAccountStore, selectEOAAddress } from '@/infra/auth/stores';
import { PipelineRunView, PipelineDoneView } from './PipelineTab';
import { usePipelineState } from '../hooks/usePipelineState';
import { PERP_DEX_META, PERP_DEX_ORDER } from '@/shared/config/perp-dex-display';
import { DEPOSIT_TARGETS } from '../utils/depositTargets';
import type { PerpDexId } from '@/domains/perp/types/perp.types';
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
  /** DEX preselected on open — e.g. Deposit launched from the Pacifica
   *  account panel opens with Pacifica as the target, not HL. */
  defaultDex?: PerpDexId;
}

type SlippageMode = 'auto' | 'custom';

export function BridgeCard({ walletAddress, onClose, onComplete, onSendTransaction, defaultChainId, defaultDirection = 'deposit', defaultDex = 'hyperliquid' }: Props) {
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
  // Declared here (before use in sourceChainName/destChainName) because
  // hoisting const/let into the JSX scope isn't automatic — keep the state
  // declaration adjacent to the first read to satisfy TDZ rules.
  const [selectedDex, setSelectedDex] = useState<PerpDexId>(defaultDex);
  const [showDexSelect, setShowDexSelect] = useState(false);
  // Cross-DEX = current route needs the pipeline (withdraw→bridge→deposit).
  // For Deposit, the target DEX being non-HL flips that on; Withdraw still
  // handles its legacy external-chain flow via Relay on HL's side, so the
  // cross-DEX branch only kicks in when Deposit's target differs from HL.
  const isCrossDex = direction === 'deposit' && selectedDex !== 'hyperliquid';
  const selectedDexMeta = PERP_DEX_META[selectedDex];
  const selectedDexName = selectedDexMeta?.name ?? 'Hyperliquid';
  const selectedDexLogo = selectedDexMeta?.logo ?? '/chains/hyperliquid.png';
  const sourceChainName = direction === 'deposit' ? externalChain?.name ?? '' : selectedDexName;
  const destChainName = direction === 'deposit' ? selectedDexName : externalChain?.name ?? '';

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
  // Pipeline state shared with the inline step views below. The `start`
  // call is triggered from this card's action button when the selected
  // route is cross-DEX; the withdraw/bridge/deposit steps then render
  // under the From/To form rather than replacing it with a separate tab.
  const { state: pipelineState, start: startPipeline, advanceStep, failStep, reset: resetPipeline, retryFailed } = usePipelineState();
  // EOA currently being queried for balance — surface it so users can
  // verify they've connected the wallet that actually holds their funds,
  // rather than silently querying a different Privy/embedded account.
  const connectedEoa = useAccountStore(selectEOAAddress);

  return (
    <div className="bg-[#0F1A1F] border border-[#273035] rounded-lg p-3 mx-auto w-full relative">
      {/* Header: Tabs + Settings + Close */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex bg-[#1B2429] rounded p-0.5">
          <TabButton active={direction === 'deposit'} label="Deposit" onClick={() => { setDirection('deposit'); setAmount(''); }} />
          <TabButton active={direction === 'withdraw'} label="Withdraw" onClick={() => { setDirection('withdraw'); setAmount(''); }} />
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

      {<>
      {/* Connected EOA indicator — clarifies which wallet's balance is queried */}
      {connectedEoa && (
        <div className="mb-2 text-[10px] text-gray-500 flex items-center justify-between px-1">
          <span>Querying wallet</span>
          <span className="text-gray-300 tabular-nums">
            {connectedEoa.slice(0, 6)}…{connectedEoa.slice(-4)}
          </span>
        </div>
      )}
      {/* From Card */}
      <div className="bg-[#1B2429] rounded-lg p-2.5 mb-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-gray-500">From</span>
          <ChainBadge
            chainName={sourceChainName}
            logoUrl={direction === 'withdraw' ? selectedDexLogo : externalChain?.icon}
            onClick={direction === 'deposit' ? () => setShowChainSelect(true) : () => setShowDexSelect(true)}
            showChevron
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
            // Withdraw = From is a DEX, which only holds USDC — no token
            // switcher needed. Deposit From is the user's external wallet,
            // where they might pay with USDT/ETH/etc., so the picker stays.
            onClick={direction === 'withdraw' ? undefined : () => setTokenSelectTarget('source')}
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
            logoUrl={direction === 'deposit' ? selectedDexLogo : externalChain?.icon}
            onClick={direction === 'withdraw' ? () => setShowChainSelect(true) : () => setShowDexSelect(true)}
            showChevron
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className={`text-xl font-light min-w-0 truncate ${quote ? 'text-white' : 'text-gray-700'}`}>
            {quoteLoading ? '...' : quote ? quote.amountOutFormatted : '0'}
          </span>
          <TokenButton
            token={destToken}
            // Deposit = To is a DEX, USDC-only — disable the switcher.
            // Withdraw To is the user's external wallet; they can pick
            // whatever destination currency they want Relay to swap into.
            onClick={direction === 'deposit' ? undefined : () => setTokenSelectTarget('dest')}
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

      {/* Action Button — hidden while an active cross-DEX pipeline run is
          in flight; the inline step UI below handles its own per-leg CTAs. */}
      {!pipelineState && (
        isCrossDex ? (
          <button
            onClick={() => {
              if (!walletAddress || !amount || parseFloat(amount) <= 0) return;
              // Source DEX for the pipeline defaults to HL — the user is
              // moving funds from HL to the picked non-HL DEX. A future
              // iteration will expose a source DEX picker for DEX→DEX.
              startPipeline('hyperliquid', selectedDex, amount);
            }}
            disabled={!walletAddress || !amount || parseFloat(amount) <= 0}
            className="w-full py-2 rounded text-xs font-semibold tracking-wide bg-[#AB9FF2] hover:brightness-110 text-[#0B1018] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {!walletAddress ? 'Connect Wallet' : `Start pipeline → ${PERP_DEX_META[selectedDex].name}`}
          </button>
        ) : (
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
        )
      )}

      {/* Token Select Bottom Sheet — chain sidebar is wired only on the
          external-wallet side, since the DEX side is USDC-locked and has
          no chain choice. */}
      {tokenSelectTarget && (
        <TokenSelectSheet
          tokens={tokenSelectTarget === 'source' ? sourceTokens : destTokens}
          selected={tokenSelectTarget === 'source' ? sourceToken : destToken}
          currentChainId={
            (tokenSelectTarget === 'source' && direction === 'deposit') ||
            (tokenSelectTarget === 'dest' && direction === 'withdraw')
              ? externalChainId
              : undefined
          }
          onChainChange={
            (tokenSelectTarget === 'source' && direction === 'deposit') ||
            (tokenSelectTarget === 'dest' && direction === 'withdraw')
              ? setExternalChainId
              : undefined
          }
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

      {/* DEX Select Bottom Sheet — lets the user pick any of 4 venues for
          the DEX-side of the transfer. Non-HL selections need the cross-DEX
          pipeline (different deposit mechanics per DEX), so we flip there
          automatically; HL keeps the fast Relay→Bridge2 shortcut. */}
      {showDexSelect && (
        <DexSelectSheet
          selectedDex={selectedDex}
          onSelect={(dex) => {
            setShowDexSelect(false);
            const cfg = DEPOSIT_TARGETS[dex];
            if (cfg.kind === 'disabled') {
              setSelectedDex(dex);
              return; // UI will surface the disabledReason; no flow change.
            }
            setSelectedDex(dex);
            // No auto-start — user still needs to enter amount and click
            // Start pipeline so the wallet popup flow matches the intent.
          }}
          onClose={() => setShowDexSelect(false)}
        />
      )}
      {DEPOSIT_TARGETS[selectedDex].kind === 'disabled' && (
        <div className="mt-2 text-[10px] text-[#FFA94D]">
          {DEPOSIT_TARGETS[selectedDex].disabledReason}
        </div>
      )}

      {/* Inline pipeline progress — same card, no tab switch. When a
          cross-DEX route is active (either via explicit start or a
          resumed run), the step views take over the action area and the
          bridge button above is hidden behind the isCrossDex guard. */}
      {pipelineState && pipelineState.step !== 'done' && (
        <div className="mt-3 border-t border-[#273035] pt-3">
          <PipelineRunView
            state={pipelineState}
            onAdvance={advanceStep}
            onFail={failStep}
            onReset={resetPipeline}
            onRetry={retryFailed}
          />
        </div>
      )}
      {pipelineState && pipelineState.step === 'done' && (
        <div className="mt-3 border-t border-[#273035] pt-3">
          <PipelineDoneView
            state={pipelineState}
            onReset={resetPipeline}
            onClose={onClose}
          />
        </div>
      )}
      </>}
    </div>
  );
}

function DexSelectSheet({
  selectedDex,
  onSelect,
  onClose,
}: {
  selectedDex: PerpDexId;
  onSelect: (dex: PerpDexId) => void;
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

        <h3 className="text-base font-semibold text-white text-center mb-4">Select DEX</h3>

        <div className="grid grid-cols-2 gap-2 mb-4">
          {PERP_DEX_ORDER.map((dex) => {
            const cfg = DEPOSIT_TARGETS[dex];
            const meta = PERP_DEX_META[dex];
            const isDisabled = cfg.kind === 'disabled';
            const isSelected = dex === selectedDex;
            return (
              <button
                key={dex}
                onClick={() => onSelect(dex)}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-dark-600 hover:border-gray-600'
                }`}
              >
                <img src={meta.logo} alt={meta.name} className="w-10 h-10 rounded-full object-cover" />
                <span className="text-sm font-medium text-white">{meta.name}</span>
                {isDisabled ? (
                  <span className="text-[10px] text-[#FFA94D]">web-UI-only</span>
                ) : (
                  <span className="text-[10px] text-gray-500">min {cfg.minAmount} USDC</span>
                )}
              </button>
            );
          })}
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

// Well-known token logos that Relay sometimes ships without metadata. Using
// CoinGecko's CDN keeps us from hosting raw assets while still showing a
// recognizable icon for the common stables.
const TOKEN_LOGO_FALLBACK: Record<string, string> = {
  USDC: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  USDT: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
  ETH:  'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  WETH: 'https://assets.coingecko.com/coins/images/2518/small/weth.png',
};

function resolveTokenLogo(token: BridgeToken | null): string | null {
  if (!token) return null;
  if (token.logoURI) return token.logoURI;
  const symKey = (token.symbol ?? '').toUpperCase();
  return TOKEN_LOGO_FALLBACK[symKey] ?? null;
}

function TokenButton({ token, onClick }: { token: BridgeToken | null; onClick?: () => void }) {
  const locked = !onClick;
  const logo = resolveTokenLogo(token);
  return (
    <button
      onClick={onClick}
      disabled={locked}
      className={`flex items-center gap-1.5 bg-[#273035] rounded-full pl-1.5 pr-2 py-1 transition-colors shrink-0 ${
        locked ? 'cursor-default' : 'hover:bg-[#2F3A40]'
      }`}
    >
      {logo ? (
        <img src={logo} alt={token?.symbol ?? ''} className="w-5 h-5 rounded-full object-cover" />
      ) : (
        <div className="w-5 h-5 rounded-full bg-gray-600 flex items-center justify-center text-[9px] text-gray-300">
          {token?.symbol?.[0] ?? '?'}
        </div>
      )}
      <span className="text-white text-xs font-medium">{token?.symbol ?? 'Select'}</span>
      {!locked && (
        <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </button>
  );
}

function ChainBadge({
  chainName,
  logoUrl,
  onClick,
  showChevron,
}: {
  chainName: string;
  logoUrl?: string | null;
  onClick?: () => void;
  showChevron: boolean;
}) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      onClick={onClick}
      className={`text-xs text-gray-300 flex items-center gap-1.5 bg-[#273035] hover:bg-[#2F3A40] rounded-full pl-1 pr-2 py-0.5 transition-colors ${onClick ? 'cursor-pointer' : ''}`}
    >
      {logoUrl ? (
        <img src={logoUrl} alt={chainName} className="w-4 h-4 rounded-full object-cover" />
      ) : (
        <span className="w-4 h-4 rounded-full bg-gray-700 flex items-center justify-center text-[9px] text-gray-300">
          {chainName[0] ?? '?'}
        </span>
      )}
      <span className="text-white text-xs font-medium">{chainName}</span>
      {showChevron && (
        <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
  currentChainId,
  onChainChange,
  onSelect,
  onClose,
}: {
  tokens: TokenWithBalance[];
  selected: TokenWithBalance | null;
  /** When provided, renders a chain sidebar to the left of the token list
   *  (matches the Uniswap-style "Select Token" modal the user asked for).
   *  Omit both props to keep the old flat list behaviour. */
  currentChainId?: number;
  onChainChange?: (chainId: number) => void;
  onSelect: (t: TokenWithBalance) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [chainQuery, setChainQuery] = useState('');
  const q = query.trim().toLowerCase();
  const cq = chainQuery.trim().toLowerCase();
  const chainSidebarEnabled = currentChainId != null && !!onChainChange;
  const filteredChains = cq
    ? SUPPORTED_EXTERNAL_CHAINS.filter((c) => c.name.toLowerCase().includes(cq))
    : SUPPORTED_EXTERNAL_CHAINS;
  // Filter by symbol + name + address so users can paste any of the three.
  // Tokens already arrive balance-sorted from the hook, so no resort here.
  const filtered = q
    ? tokens.filter((t) => {
        const sym = (t.symbol ?? '').toLowerCase();
        const name = ('name' in t ? (t as { name?: string }).name ?? '' : '').toLowerCase();
        const addr = (t.address ?? '').toLowerCase();
        return sym.includes(q) || name.includes(q) || addr.includes(q);
      })
    : tokens;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl md:mx-4 bg-[#0F1A1F] border border-[#273035] rounded-t-2xl md:rounded-2xl animate-slide-up flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: '85vh' }}
      >
        {/* Handle bar (mobile) */}
        <div className="flex justify-center pt-3 md:hidden">
          <div className="w-10 h-1 rounded-full bg-gray-600" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h3 className="text-base font-semibold text-white">Select Token</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 min-h-0 border-t border-[#1B2429]">
          {/* Chain sidebar — only when caller wires onChainChange */}
          {chainSidebarEnabled && (
            <aside className="flex flex-col w-48 border-r border-[#1B2429] flex-shrink-0">
              <div className="px-3 pt-3 pb-2">
                <input
                  value={chainQuery}
                  onChange={(e) => setChainQuery(e.target.value)}
                  placeholder="Search chains"
                  className="w-full bg-[#1B2429] border border-[#273035] rounded-lg px-3 py-1.5 text-xs text-white outline-none placeholder:text-gray-600 focus:border-[#5fd8ee]"
                />
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-3">
                {filteredChains.map((c) => {
                  const isActive = c.chainId === currentChainId;
                  return (
                    <button
                      key={c.chainId}
                      onClick={() => onChainChange!(c.chainId)}
                      className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors ${
                        isActive ? 'bg-primary/10' : 'hover:bg-[#1B2429]'
                      }`}
                    >
                      <img src={c.icon} alt={c.name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                      <span className={`text-sm font-medium truncate ${isActive ? 'text-primary' : 'text-gray-300'}`}>
                        {c.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>
          )}

          {/* Token column */}
          <div className="flex flex-col flex-1 min-w-0">
            <div className="px-4 pt-3 pb-2">
              <div className="flex items-center gap-2 bg-[#1B2429] border border-[#5fd8ee] rounded-lg px-3 py-2">
                <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 1010.5 18a7.5 7.5 0 006.15-1.35z" />
                </svg>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search for a token or paste address"
                  className="bg-transparent text-sm text-white flex-1 outline-none placeholder:text-gray-600"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-3">
              {filtered.length === 0 ? (
                <div className="py-10 text-center text-xs text-gray-500">No tokens match “{query}”.</div>
              ) : (
                filtered.map((t) => {
                  const isSelected = selected?.address === t.address;
                  const name = ('name' in t ? (t as { name?: string }).name : undefined) ?? t.symbol;
                  return (
                    <button
                      key={t.address}
                      onClick={() => onSelect(t)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                        isSelected ? 'bg-primary/10' : 'hover:bg-[#1B2429]'
                      }`}
                    >
                      {(() => {
                        const logo = resolveTokenLogo(t);
                        return logo ? (
                          <img src={logo} alt={t.symbol} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs text-gray-300 font-medium flex-shrink-0">
                            {t.symbol?.[0] ?? '?'}
                          </div>
                        );
                      })()}
                      <div className="flex flex-col items-start min-w-0 flex-1">
                        <span className={`text-sm font-medium truncate ${isSelected ? 'text-primary' : 'text-white'}`}>{t.symbol}</span>
                        <span className="text-[10px] text-gray-500 truncate">{name}</span>
                      </div>
                      <div className="flex flex-col items-end flex-shrink-0">
                        <span className="text-sm text-white tabular-nums">
                          {t.balance !== null ? t.balance : '-'}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
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
        className="w-full max-w-md md:mx-4 bg-[#0F1A1F] border border-[#273035] rounded-t-2xl md:rounded-2xl animate-slide-up flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar (mobile) */}
        <div className="flex justify-center pt-3 md:hidden">
          <div className="w-10 h-1 rounded-full bg-gray-600" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h3 className="text-base font-semibold text-white">Select Chain</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 2-col grid of chain cards — matches DexSelectSheet visual density
            so both selectors feel like one UI kit rather than two styles. */}
        <div className="px-5 pb-5">
          <div className="grid grid-cols-2 gap-2">
            {SUPPORTED_EXTERNAL_CHAINS.map((c) => {
              const isSelected = c.chainId === selectedChainId;
              return (
                <button
                  key={c.chainId}
                  onClick={() => onSelect(c.chainId)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-[#273035] hover:border-gray-600'
                  }`}
                >
                  <img src={c.icon} alt={c.name} className="w-10 h-10 rounded-full object-cover" />
                  <span className="text-sm font-medium text-white">{c.name}</span>
                  <span className="text-[10px] text-gray-500">{c.nativeCurrency}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
