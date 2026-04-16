// v0.22.0: EIP-1193 window.ethereum 타입 정의
// v0.25.3: types/window.d.ts → shared/types/window.d.ts (레이어 정리)

interface EthereumEventMap {
  accountsChanged: (accounts: string[]) => void;
  chainChanged: (chainId: string) => void;
  disconnect: () => void;
  connect: (info: { chainId: string }) => void;
  message: (message: { type: string; data: unknown }) => void;
}

interface WindowEthereumProvider {
  request: (args: { method: string; params: unknown[] | undefined }) => Promise<unknown>;
  on<K extends keyof EthereumEventMap>(event: K, handler: EthereumEventMap[K]): void;
  removeListener<K extends keyof EthereumEventMap>(event: K, handler: EthereumEventMap[K]): void;
  isMetaMask?: boolean; // @ci-exception(no-optional-without-default) — external browser API (MetaMask injection)
}

interface Window {
  ethereum?: WindowEthereumProvider; // @ci-exception(no-optional-without-default) — external browser API (may not exist)
}
