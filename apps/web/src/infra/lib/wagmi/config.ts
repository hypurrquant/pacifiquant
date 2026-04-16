import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import {
  metaMaskWallet,
  walletConnectWallet,
  coinbaseWallet,
  rabbyWallet,
  injectedWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { SUPPORTED_CHAINS } from '@hq/core/config/chains';
import { CHAIN_RPC_URLS } from '@hq/core/config/constants';

// @hq/core SUPPORTED_CHAINS에서 chain 객체 추출 (SSOT)
const chains = Object.values(SUPPORTED_CHAINS).map((c) => c.chain);

// wagmi는 chains 배열의 첫 번째를 기본 체인으로 사용
const [firstChain, ...restChains] = chains;

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? null;

// v1.28.9: 하드코딩 URL → CHAIN_RPC_URLS SSOT
const transports: Record<number, ReturnType<typeof http>> = {};
for (const chain of chains) {
  transports[chain.id] = http(CHAIN_RPC_URLS[chain.id]);
}

// v1.51.0: WalletConnect projectId가 없으면 injected connector만 노출
const connectors = projectId
  ? connectorsForWallets(
      [
        {
          groupName: 'Popular',
          wallets: [
            metaMaskWallet,
            rabbyWallet,
            coinbaseWallet,
            walletConnectWallet,
          ],
        },
        {
          groupName: 'Other',
          wallets: [injectedWallet],
        },
      ],
      { appName: 'PacifiQuant', projectId },
    )
  : [
      injected({ target: 'metaMask' }),
      injected({ target: 'rabby' }),
      injected({ target: 'coinbaseWallet' }),
      injected(),
    ];

export const wagmiConfig = createConfig({
  chains: [firstChain, ...restChains],
  connectors,
  transports,
  ssr: true,
});
