/**
 * Perp UI Store — session-only flags (no persist middleware).
 * Resets on page reload by design.
 */

import { create } from 'zustand';

interface PerpUiState {
  skipClosePositionConfirm: boolean;
  skipCancelOrderConfirm: boolean;
  setSkipClosePositionConfirm: (skip: boolean) => void;
  setSkipCancelOrderConfirm: (skip: boolean) => void;
}

export const usePerpUiStore = create<PerpUiState>()((set) => ({
  skipClosePositionConfirm: false,
  skipCancelOrderConfirm: false,
  setSkipClosePositionConfirm: (skip) => set({ skipClosePositionConfirm: skip }),
  setSkipCancelOrderConfirm: (skip) => set({ skipCancelOrderConfirm: skip }),
}));
