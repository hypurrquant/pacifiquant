import type { PerpDexId } from '@/domains/perp/types/perp.types';

export type BridgeKind = 'evm-evm' | 'evm-svm';

export interface PipelineRoute {
  readonly id: string;
  readonly source: PerpDexId;
  readonly target: PerpDexId;
  readonly sourceChainId: number;
  readonly targetChainId: number;
  readonly bridgeKind: BridgeKind;
}

const DEX_CHAIN_ID: Record<PerpDexId, number> = {
  hyperliquid: 42161,
  lighter: 42161,
  aster: 56,
  pacifica: 792703809, // Solana magic id per Relay's /chains API
};

const IS_EVM: Record<PerpDexId, boolean> = {
  hyperliquid: true,
  lighter: true,
  aster: true,
  pacifica: false,
};

function bridgeKindFor(a: PerpDexId, b: PerpDexId): BridgeKind {
  return IS_EVM[a] && IS_EVM[b] ? 'evm-evm' : 'evm-svm';
}

const DEXES: readonly PerpDexId[] = ['hyperliquid', 'pacifica', 'lighter', 'aster'];

export const PIPELINE_ROUTES: readonly PipelineRoute[] = (() => {
  const routes: PipelineRoute[] = [];
  for (const source of DEXES) {
    for (const target of DEXES) {
      if (source === target) continue;
      routes.push({
        id: `${source}->${target}`,
        source,
        target,
        sourceChainId: DEX_CHAIN_ID[source],
        targetChainId: DEX_CHAIN_ID[target],
        bridgeKind: bridgeKindFor(source, target),
      });
    }
  }
  return routes;
})();

export function findRoute(source: PerpDexId, target: PerpDexId): PipelineRoute | null {
  return PIPELINE_ROUTES.find((r) => r.source === source && r.target === target) ?? null;
}
