'use client';

/**
 * AgentStatusStrip — Inline per-DEX agent-wallet status row on the Strategies
 * page with a modal CTA to enable trading on any DEX without leaving the page.
 *
 * Previously users on Strategies saw "Enable Trading for HL in the Perp page"
 * warnings but had no way to act on them here. This component lifts the same
 * AgentKeyManager modal used by the Perp TradingLayout so the flow completes
 * in-place.
 */

import { useState } from 'react';
import {
  PacificaPerpAdapter,
  LighterPerpAdapter,
  AsterPerpAdapter,
} from '@hq/core/defi/perp';
import { getAdapterByDex } from '@/domains/perp/hooks/usePerpAdapter';
import { useAccountStore, selectActiveAddress } from '@/infra/auth/stores';
import { useAgentWalletStore, selectIsAgentActive as selectHlActive } from '@/domains/perp/stores/useAgentWalletStore';
import { usePacificaAgentStore, selectPacificaAgentActive } from '@/domains/perp/stores/usePacificaAgentStore';
import { useLighterAgentStore, selectLighterAgentActive } from '@/domains/perp/stores/useLighterAgentStore';
import { useAsterAgentStore, selectAsterAgentActive } from '@/domains/perp/stores/useAsterAgentStore';
import { AgentKeyManager } from '@/domains/perp/components/AgentKeyManager';
import { AgentWalletPanel } from '@/domains/perp/components/AgentWalletPanel';
import { PERP_DEX_META, PERP_DEX_ORDER } from '@/shared/config/perp-dex-display';
import type { PerpDexId } from '@/domains/perp/types/perp.types';

type Activity = Record<PerpDexId, boolean>;

export function AgentStatusStrip() {
  const hlActive    = useAgentWalletStore(selectHlActive);
  const pacActive   = usePacificaAgentStore(selectPacificaAgentActive);
  const lightActive = useLighterAgentStore(selectLighterAgentActive);
  const astActive   = useAsterAgentStore(selectAsterAgentActive);
  const walletAddress = useAccountStore(selectActiveAddress);

  const [showModal, setShowModal] = useState(false);
  const [hlSetupMode, setHlSetupMode] = useState(false);

  const active: Activity = {
    hyperliquid: hlActive,
    pacifica:    pacActive,
    lighter:     lightActive,
    aster:       astActive,
  };

  const readyCount = Object.values(active).filter(Boolean).length;

  const openEnableModal = (dex: PerpDexId) => {
    setHlSetupMode(dex === 'hyperliquid');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setHlSetupMode(false);
  };

  return (
    <>
      <div
        className="rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap"
        style={{ backgroundColor: '#111820', border: '1px solid #1F2A33' }}
      >
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs font-semibold text-white">Agent Wallets</span>
          <span className="text-[10px] tabular-nums" style={{ color: readyCount === 4 ? '#6EE7B7' : '#8F9BA4' }}>
            {readyCount}/4 enabled
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {PERP_DEX_ORDER.map((dex) => {
            const meta = PERP_DEX_META[dex];
            const isActive = active[dex];
            return (
              <div
                key={dex}
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
                style={{
                  border: `1px solid ${isActive ? 'rgba(110,231,183,0.25)' : '#1F2A33'}`,
                  backgroundColor: isActive ? 'rgba(110,231,183,0.06)' : '#0B141A',
                }}
              >
                <img src={meta.logo} alt={meta.name} className="w-3.5 h-3.5 rounded-full flex-shrink-0" />
                <span className="text-[11px] font-medium" style={{ color: meta.color }}>{meta.name}</span>
                {isActive ? (
                  <span
                    className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                    style={{ color: '#6EE7B7', backgroundColor: 'rgba(110,231,183,0.1)', border: '1px solid rgba(110,231,183,0.25)' }}
                  >
                    READY
                  </span>
                ) : (
                  <button
                    onClick={() => openEnableModal(dex)}
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors"
                    style={{ color: '#AB9FF2', border: '1px solid rgba(171,159,242,0.35)', backgroundColor: 'rgba(171,159,242,0.08)' }}
                  >
                    Enable
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal — mirrors TradingLayout's agent-setup modal so the two flows
          stay visually + functionally identical. HL opens its dedicated
          AgentWalletPanel; the other 3 live inside AgentKeyManager. */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-sm mx-4 rounded-xl overflow-hidden"
            style={{ backgroundColor: '#0F1A1F', border: '1px solid #273035' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #273035' }}>
              <div className="flex items-center gap-2">
                {hlSetupMode && (
                  <button onClick={() => setHlSetupMode(false)} className="text-gray-400 hover:text-white" aria-label="Back">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                <span className="text-sm font-semibold text-white">
                  {hlSetupMode ? 'Hyperliquid Agent Setup' : 'Agent Wallet Setup'}
                </span>
              </div>
              <button onClick={closeModal} className="text-gray-400 hover:text-white" aria-label="Close">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {hlSetupMode ? (
              <AgentWalletPanel
                walletAddress={walletAddress}
                onComplete={closeModal}
              />
            ) : (
              <AgentKeyManager
                pacificaAdapter={getAdapterByDex('pacifica') as PacificaPerpAdapter}
                lighterAdapter={getAdapterByDex('lighter') as LighterPerpAdapter}
                asterAdapter={getAdapterByDex('aster') as AsterPerpAdapter}
                pacificaAddress={null}
                onSetupHyperliquid={() => setHlSetupMode(true)}
                defaultCollapsed={false}
                onRegistrationSuccess={closeModal}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
