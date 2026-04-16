import {
  connect,
  disconnect,
  getAccount,
  signMessage,
} from '@wagmi/core';
import type { Connector } from '@wagmi/core';
import { wagmiConfig } from '@/infra/lib/wagmi/config';
import type { EIP1193Provider } from '../types/auth.types';
import type { WebWalletAdapter } from '@/infra/auth/webWalletAdapter';
import { createLogger } from '@hq/core/logging';
import { ensureError } from '@hq/core/lib/error';

/** connector.getProvider() 결과가 EIP-1193 호환인지 런타임 검증 */
function isEIP1193Provider(value: unknown): value is EIP1193Provider {
  if (typeof value !== 'object' || value === null) return false;
  if (!('request' in value)) return false;
  // 'request' in value narrows to Record<'request', unknown>
  return typeof value.request === 'function';
}

const logger = createLogger('core/auth/adapters/WagmiAdapter');

/**
 * wagmi connector 기반 WalletAdapter 구현
 * - @wagmi/core imperative 함수 사용 (React hook 의존 없음)
 * - connector.getProvider()로 EIP-1193 호환 provider 제공
 * - EOAAdapter 대체 (one-way cut-over)
 */
export class WagmiAdapter implements WebWalletAdapter {
  readonly name: string;
  private connector: Connector;
  private provider: EIP1193Provider | null = null;
  private connectedChainId: number | null;

  constructor(connector: Connector, connectorName: string, chainId: number | null = null) {
    this.connector = connector;
    this.name = connectorName;
    this.connectedChainId = chainId;
  }

  async connect(): Promise<void> {
    await connect(wagmiConfig, { connector: this.connector });
  }

  disconnect(): void {
    // store를 즉시 disconnected로 초기화 (UI 즉시 반영) — useConnectionSync 레벨에서 처리
    // wagmi disconnect는 fire-and-forget (async → sync 시그니처)
    void disconnect(wagmiConfig);
  }

  isConnected(): boolean {
    return getAccount(wagmiConfig).isConnected;
  }

  getEOAAddress(): `0x${string}` | null {
    return getAccount(wagmiConfig).address ?? null;
  }

  async getProvider(): Promise<EIP1193Provider | null> {
    if (this.provider) return this.provider;
    // connector.getProvider()는 EIP-1193 호환 provider를 직접 반환
    // @ci-exception(core-auth-no-window) 실패 시 null 반환 + 에러 로깅 (window.ethereum fallback 없음 — EIP-6963 목표 보호)
    try {
      const provider = await this.connector.getProvider();
      if (!isEIP1193Provider(provider)) return null;
      this.provider = provider;
      return this.provider;
    } catch (e) { // @ci-exception(no-empty-catch) /* adapter boundary — provider 추출 실패 시 null */
      void logger.error('WagmiAdapter.getProvider() failed', ensureError(e), {
        funcName: 'getProvider',
      });
      return null;
    }
  }

  getCachedProvider(): EIP1193Provider | null {
    return this.provider;
  }

  getConnectedChainId(): number | null {
    return this.connectedChainId;
  }

  setConnectedChainId(chainId: number | null): void {
    this.connectedChainId = chainId;
  }

  async signMessage(message: string): Promise<`0x${string}`> {
    return signMessage(wagmiConfig, { message });
  }
}
