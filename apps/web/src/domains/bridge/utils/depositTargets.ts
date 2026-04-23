import { getAddress, isAddress } from 'viem';
import type { PerpDexId } from '@/domains/perp/types/perp.types';

export type DepositTargetKind = 'bridge-contract' | 'intent-address' | 'solana-program' | 'disabled';

export interface ResolveRecipientCtx {
  readonly userEvmAddress: string;
  readonly pacificaAddress: string | null;
}

export interface DepositTarget {
  readonly kind: DepositTargetKind;
  readonly chainId: number;
  readonly minAmount: number;
  readonly resolveRecipient: (ctx: ResolveRecipientCtx) => Promise<string>;
  readonly disabledReason?: string;
}

const HL_BRIDGE_ARBITRUM = '0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7';
const LIGHTER_INTENT_ENDPOINT = 'https://mainnet.zklighter.elliot.ai/api/v1/createIntentAddress';
// Intent address is deterministic per (chain_id, from_addr). Session-level cache avoids
// re-hitting Lighter's API on every retry within the same pipeline run.
const intentCache = new Map<string, string>();

async function fetchLighterIntentAddress(fromAddress: string): Promise<string> {
  const cacheKey = fromAddress.toLowerCase();
  const cached = intentCache.get(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(LIGHTER_INTENT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        chain_id: '42161',
        from_addr: fromAddress,
        amount: '0',
        is_external_deposit: 'true',
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Lighter intent address API ${res.status}: ${text.slice(0, 120)}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    const raw = String(json.intent_address ?? json.address ?? '');
    // Validate the API response is a well-formed EVM address before trusting it
    // as a Relay bridge recipient — a compromised/spoofed Lighter response must
    // not redirect user funds to an attacker address.
    if (!raw || !isAddress(raw)) {
      throw new Error(`Lighter returned invalid intent address: ${raw.slice(0, 20)}`);
    }
    const intent = getAddress(raw);
    intentCache.set(cacheKey, intent);
    return intent;
  } finally {
    clearTimeout(timeoutId);
  }
}

export const DEPOSIT_TARGETS: Record<PerpDexId, DepositTarget> = {
  hyperliquid: {
    kind: 'bridge-contract',
    chainId: 42161,
    minAmount: 5,
    resolveRecipient: async () => HL_BRIDGE_ARBITRUM,
  },
  lighter: {
    kind: 'intent-address',
    chainId: 42161,
    minAmount: 5,
    resolveRecipient: async ({ userEvmAddress }) => {
      if (!userEvmAddress) throw new Error('Lighter intent address requires the source EVM wallet address.');
      return fetchLighterIntentAddress(userEvmAddress);
    },
  },
  pacifica: {
    kind: 'solana-program',
    chainId: 792703809,
    minAmount: 10,
    resolveRecipient: async ({ pacificaAddress }) => {
      if (!pacificaAddress) throw new Error('Pacifica target requires Phantom-connected Solana address.');
      return pacificaAddress;
    },
  },
  aster: {
    kind: 'disabled',
    chainId: 56,
    minAmount: 0,
    resolveRecipient: async () => {
      throw new Error('Aster deposits are web-UI-only — use aster.exchange');
    },
    disabledReason: 'Aster deposits are web-UI-only — use aster.exchange',
  },
};

export function completesOnBridge(target: PerpDexId): boolean {
  const kind = DEPOSIT_TARGETS[target].kind;
  return kind === 'bridge-contract' || kind === 'intent-address';
}
