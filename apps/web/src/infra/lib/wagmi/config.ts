import { createConfig, http } from 'wagmi';
import { injected, walletConnect, coinbaseWallet } from '@wagmi/connectors';
import { SUPPORTED_CHAINS } from '@hq/core/config/chains';
import { CHAIN_RPC_URLS } from '@hq/core/config/constants';

const chains = Object.values(SUPPORTED_CHAINS).map((c) => c.chain);

const [firstChain, ...restChains] = chains;

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? null;

const transports: Record<number, ReturnType<typeof http>> = {};
for (const chain of chains) {
  transports[chain.id] = http(CHAIN_RPC_URLS[chain.id]);
}

const connectors = [
  injected({ target: 'metaMask' }),
  injected({ target: 'rabby' }),
  injected(),
  coinbaseWallet({ appName: 'PacifiQuant' }),
  ...(projectId ? [walletConnect({ projectId, showQrModal: false })] : []),
];

export const wagmiConfig = createConfig({
  chains: [firstChain, ...restChains],
  connectors,
  transports,
  ssr: true,
});
