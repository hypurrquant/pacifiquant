/**
 * Perp DEX display SSOT — name, logo path, brand color per DEX.
 *
 * Perp-only registry for the remaining PacifiQuant surfaces.
 * Logo assets live under `apps/web/public/chains/`.
 */

import type { PerpDexId } from '@/domains/perp/types/perp.types';

export interface PerpDexMeta {
  readonly id: PerpDexId;
  readonly name: string;
  readonly logo: string;
  readonly color: string;
}

export const PERP_DEX_META: Record<PerpDexId, PerpDexMeta> = {
  hyperliquid: { id: 'hyperliquid', name: 'Hyperliquid', logo: '/chains/hyperliquid.png', color: '#5fd8ee' },
  pacifica:    { id: 'pacifica',    name: 'Pacifica',    logo: '/chains/pacifica.svg',    color: '#AB9FF2' },
  lighter:     { id: 'lighter',     name: 'Lighter',     logo: '/chains/lighter.png',     color: '#4A9EF5' },
  aster:       { id: 'aster',       name: 'Aster',       logo: '/chains/aster.svg',       color: '#F5A623' },
};

// PacifiQuant: Pacifica-first ordering across all perp-surfaced UIs.
export const PERP_DEX_ORDER: readonly PerpDexId[] = ['pacifica', 'hyperliquid', 'lighter', 'aster'];

export const PERP_DEX_LIST: readonly PerpDexMeta[] = PERP_DEX_ORDER.map(id => PERP_DEX_META[id]);
