import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { ApprovalPayload } from '@hq/core/auth';

interface SessionKeyState {
  pendingApproval: ApprovalPayload | null;
  isApproving: boolean;
  approvalError: string | null;
  setPendingApproval: (payload: ApprovalPayload | null) => void;
  setIsApproving: (value: boolean) => void;
  setApprovalError: (error: string | null) => void;
  reset: () => void;
}

const initialState: Omit<SessionKeyState, 'setPendingApproval' | 'setIsApproving' | 'setApprovalError' | 'reset'> = {
  pendingApproval: null,
  isApproving: false,
  approvalError: null,
};

export const useSessionKeyStore = create<SessionKeyState>()(
  devtools(
    (set) => ({
      ...initialState,

      setPendingApproval: (payload) => set({ pendingApproval: payload }, false, 'setPendingApproval'),
      setIsApproving: (value) => set({ isApproving: value }, false, 'setIsApproving'),
      setApprovalError: (error) => set({ approvalError: error }, false, 'setApprovalError'),
      reset: () => set(initialState, false, 'reset'),
    }),
    { name: 'SessionKeyStore' }
  )
);
