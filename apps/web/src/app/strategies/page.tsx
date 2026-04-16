'use client';

/**
 * /strategies — Automated Trading Strategies
 *
 * MM (Market Making), Delta-Neutral, Funding Rate Arbitrage
 * Inspired by perp-cli (github.com/hypurrquant/perp-cli)
 */

import { PerpDepsProvider } from '@/domains/perp/providers/PerpDepsProvider';
import { createWebPerpDeps } from '@/domains/perp/adapters/perpWebDeps';
import { StrategiesDashboard } from '@/domains/strategies/components/StrategiesDashboard';

const deps = createWebPerpDeps();

export default function StrategiesPage() {
  return (
    <PerpDepsProvider deps={deps}>
      <StrategiesDashboard />
    </PerpDepsProvider>
  );
}
