'use client';

/**
 * PerpDepsProvider — Perp 플랫폼 DI Context
 */

import { createContext, useContext } from 'react';
import { ContextRequiredError } from '@hq/core/lib/error';
import type { PerpPlatformDeps } from '../adapters/perpWebDeps';

const PerpDepsContext = createContext<PerpPlatformDeps | null>(null);

export function PerpDepsProvider({
  deps,
  children,
}: {
  deps: PerpPlatformDeps;
  children: React.ReactNode;
}) {
  return (
    <PerpDepsContext.Provider value={deps}>
      {children}
    </PerpDepsContext.Provider>
  );
}

export function usePerpDeps(): PerpPlatformDeps {
  const deps = useContext(PerpDepsContext);
  if (!deps) {
    throw new ContextRequiredError('usePerpDeps must be used within PerpDepsProvider');
  }
  return deps;
}
