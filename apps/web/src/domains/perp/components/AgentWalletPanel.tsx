'use client';

/**
 * AgentWalletPanel — Agent Wallet 설정 UI
 *
 * Flow 1: Enable Trading — 메인 지갑으로 agent wallet 생성 + approveAgent
 * Flow 2: Import Agent Key — 기존 agent private key 직접 입력
 *
 * Builder fee approval은 별도 단계 — AgentKeyManager의 DEX별 카드에서 처리.
 */

import { useState, useCallback } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { isHex, isAddress } from 'viem';
import { getErrorMessage } from '@hq/core/lib/error';
import { useAgentWalletStore, selectIsAgentActive } from '../stores/useAgentWalletStore';
import { useHyperliquidAdapter } from '../hooks/useHyperliquid';
import { usePerpDeps } from '../providers/PerpDepsProvider';
import { HyperliquidPerpAdapter } from '@hq/core/defi/perp';

type Tab = 'enable' | 'import';

interface Props {
  walletAddress: `0x${string}` | null;
  onComplete?: () => void;
}

export function AgentWalletPanel({ walletAddress, onComplete }: Props) {
  const store = useAgentWalletStore();
  const isActive = useAgentWalletStore(selectIsAgentActive);
  const adapter = useHyperliquidAdapter();
  const deps = usePerpDeps();

  const { openConnectModal } = useConnectModal();

  const [tab, setTab] = useState<Tab>('enable');
  const [isApproving, setIsApproving] = useState(false);
  const [importKey, setImportKey] = useState('');
  const [importMaster, setImportMaster] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  // Flow 1: Enable Trading
  //
  // Builder fee + approveAgent — both signed by the MAIN wallet, back to
  // back. Order matters: if we ship approveAgent first, the user can
  // immediately submit an order and HL rejects it with
  // "Builder fee has not been approved" before the second popup lands.
  // Signing builder-fee first means orders work from the moment the
  // second signature clears. `maxBuilderFee` is idempotent on HL, so
  // re-signing on every Enable Trading (including after wallet-reapproval)
  // is safe and avoids a stale `maxBuilderFee < BUILDER_FEE` from an
  // earlier run.
  const handleEnableTrading = useCallback(async () => {
    if (!walletAddress || isApproving) return;

    setIsApproving(true);
    try {
      const mainSignFn = deps.getMainWalletSignFn();
      const signatureChainId = await deps.getMainWalletChainId();

      // 1) Builder fee approval (main wallet)
      await adapter.approveBuilderFee(
        {
          builderAddress: HyperliquidPerpAdapter.BUILDER_ADDRESS,
          maxFeeRate: HyperliquidPerpAdapter.BUILDER_MAX_FEE_RATE,
          signatureChainId,
        },
        mainSignFn,
      );

      // 2) Agent approval (main wallet). Key is generated after builder
      // fee so we never persist an agent for a flow the user aborted.
      const { address: agentAddress, privateKey: agentPrivateKey } = store.generateAgentKey();
      await adapter.approveAgent(
        { agentAddress, agentName: 'hypurrquant', signatureChainId },
        mainSignFn,
      );

      store.setApproved(walletAddress, agentAddress, agentPrivateKey);
      deps.showToast({ title: 'Hyperliquid trading enabled', type: 'success' });
      onComplete?.();
    } catch (err) {
      const msg = getErrorMessage(err);
      deps.showToast({
        title: 'Failed to enable trading',
        message: msg,
        type: 'warning',
      });
      store.disconnect();
    } finally {
      setIsApproving(false);
    }
  }, [walletAddress, isApproving, store, adapter, deps, onComplete]);

  // Flow 2: Import Agent Key
  const handleImport = useCallback(() => {
    if (!importKey || isImporting) return;

    setIsImporting(true);
    try {
      const trimmedKey = importKey.trim();
      if (!isHex(trimmedKey) || trimmedKey.length !== 66) {
        deps.showToast({ title: 'Invalid private key format', type: 'warning' });
        setIsImporting(false);
        return;
      }

      const masterAddr = importMaster.trim();
      const master = isAddress(masterAddr) ? masterAddr : null;

      store.importAgentKey(trimmedKey, master);
      setImportKey('');
      setImportMaster('');
      deps.showToast({ title: 'Agent wallet imported', type: 'success' });
      onComplete?.();
    } catch (err) {
      deps.showToast({
        title: 'Import failed',
        message: getErrorMessage(err),
        type: 'warning',
      });
    } finally {
      setIsImporting(false);
    }
  }, [importKey, importMaster, isImporting, store, deps]);

  const handleDisconnect = useCallback(() => {
    store.disconnect();
    deps.showToast({ title: 'Agent wallet disconnected', type: 'info' });
  }, [store, deps]);

  // ── Active State ──
  if (isActive) {
    const p = store.persisted;
    if (p.type === 'disconnected') return null;
    return (
      <div className="p-3" style={{ backgroundColor: '#0F1A1F' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[#5fd8ee]">Agent Wallet Active</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-[#5fd8ee]/10 text-[#5fd8ee]">
            {p.type === 'generated' ? 'Generated' : 'Imported'}
          </span>
        </div>

        <div className="space-y-1.5">
          <div>
            <span className="text-xs" style={{ color: '#949E9C' }}>Agent</span>
            <div className="text-xs text-white font-mono truncate">{p.agentAddress}</div>
          </div>
          {p.masterAddress && (
            <div>
              <span className="text-xs" style={{ color: '#949E9C' }}>Master</span>
              <div className="text-xs text-white font-mono truncate">{p.masterAddress}</div>
            </div>
          )}
        </div>

        <button
          onClick={handleDisconnect}
          className="w-full mt-3 py-1.5 text-xs font-medium rounded text-[#ED7088] hover:bg-[#ED7088]/10 transition-colors"
          style={{ border: '1px solid #ED7088' }}
        >
          Disconnect Agent
        </button>
      </div>
    );
  }

  // ── Setup State ──
  return (
    <div className="p-3" style={{ backgroundColor: '#0F1A1F' }}>
      <div className="text-xs font-medium text-white mb-2">Agent Wallet</div>

      {/* Tab Switcher */}
      <div className="flex mb-3 rounded overflow-hidden" style={{ border: '1px solid #273035' }}>
        <button
          onClick={() => setTab('enable')}
          className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
            tab === 'enable' ? 'text-white bg-[#1a2830]' : 'text-gray-500'
          }`}
        >
          Enable Trading
        </button>
        <button
          onClick={() => setTab('import')}
          className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
            tab === 'import' ? 'text-white bg-[#1a2830]' : 'text-gray-500'
          }`}
        >
          Import Key
        </button>
      </div>

      {tab === 'enable' && (
        <div>
          <p className="text-xs mb-2" style={{ color: '#949E9C' }}>
            {walletAddress
              ? 'Create an agent wallet to trade without signing each order.'
              : 'Connect your wallet first to enable perp trading.'}
          </p>
          <button
            onClick={walletAddress ? handleEnableTrading : openConnectModal}
            disabled={isApproving}
            className="w-full py-2 text-xs font-medium rounded transition-colors disabled:opacity-40"
            style={{ backgroundColor: '#5fd8ee', color: '#0F1A1E' }}
          >
            {isApproving ? 'Approving...' : !walletAddress ? 'Connect Wallet' : 'Enable Trading'}
          </button>
        </div>
      )}

      {tab === 'import' && (
        <div className="space-y-2">
          <p className="text-xs" style={{ color: '#949E9C' }}>
            Import an agent wallet that was already issued by another account on Hyperliquid.
            This lets you trade that account&apos;s positions from this browser without reconnecting its main wallet.
          </p>
          <div>
            <label className="text-xs block mb-1" style={{ color: '#949E9C' }}>Agent Private Key</label>
            <input
              type="password"
              value={importKey}
              onChange={(e) => setImportKey(e.target.value)}
              placeholder="0x..."
              className="w-full px-2 py-1.5 text-xs text-white rounded font-mono focus:outline-none"
              style={{ backgroundColor: '#1B2429', border: '1px solid #273035' }}
            />
          </div>
          <div>
            <label className="text-xs block mb-1" style={{ color: '#949E9C' }}>Master Address (optional)</label>
            <input
              type="text"
              value={importMaster}
              onChange={(e) => setImportMaster(e.target.value)}
              placeholder="0x..."
              className="w-full px-2 py-1.5 text-xs text-white rounded font-mono focus:outline-none"
              style={{ backgroundColor: '#1B2429', border: '1px solid #273035' }}
            />
          </div>
          <button
            onClick={handleImport}
            disabled={!importKey || isImporting}
            className="w-full py-2 text-xs font-medium rounded transition-colors disabled:opacity-40"
            style={{ backgroundColor: '#5fd8ee', color: '#0F1A1E' }}
          >
            {isImporting ? 'Importing...' : 'Import Agent Wallet'}
          </button>
        </div>
      )}
    </div>
  );
}
