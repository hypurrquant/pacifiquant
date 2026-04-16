/**
 * PrivyAdapter
 * v1.3.0: Moved to @/domains/account/adapters
 * v1.4.0: Moved to @/infra/auth/adapters
 * v0.20.4: type 필드 제거 (AuthSource가 SSOT)
 * Privy (Telegram) 로그인 어댑터
 */

import type { EIP1193Provider, PrivyWalletLike } from '@/infra/auth/types';
import type { WebWalletAdapter } from '@/infra/auth/webWalletAdapter';
import { getAddress, isHex } from 'viem';
import { requestEIP1193 } from '../utils/eip1193';
import { ContextRequiredError, ValidationError } from '@hq/core/lib/error';

// Privy 인터페이스 (usePrivy 반환 타입 기반)
interface PrivyInterface {
  ready: boolean;
  authenticated: boolean;
  login: () => void;
  logout: () => void | Promise<void>;
}

interface PrivyAdapterConfig {
  privy: PrivyInterface;
  wallets: PrivyWalletLike[];
}

export class PrivyAdapter implements WebWalletAdapter {
  readonly name = 'Telegram';

  private privy: PrivyInterface;
  private wallets: PrivyWalletLike[];
  private provider: EIP1193Provider | null = null;
  private connectedChainId: number | null = null;

  constructor(config: PrivyAdapterConfig) {
    this.privy = config.privy;
    this.wallets = config.wallets;
  }

  // 지갑 목록 업데이트 (외부에서 wallets 변경 시 호출)
  updateWallets(wallets: PrivyWalletLike[]): void {
    this.wallets = wallets;
    this.provider = null;
  }

  async connect(): Promise<void> {
    this.privy.login();
    // embedded wallet 생성 대기는 useConnectionSync에서 처리
    // Privy login()은 모달을 열고 반환하므로 실제 로그인 완료는 비동기로 처리됨
  }

  disconnect(): void {
    this.privy.logout();
  }

  isConnected(): boolean {
    return this.privy.authenticated;
  }

  getEOAAddress(): `0x${string}` | null {
    const embedded = this.wallets.find((w) => w.walletClientType === 'privy');
    return embedded?.address ? getAddress(embedded.address) : null;
  }

  async getProvider(): Promise<EIP1193Provider | null> {
    if (this.provider) return this.provider;
    const embedded = this.wallets.find((w) => w.walletClientType === 'privy');
    if (!embedded) return null;
    this.provider = (await embedded.getEthereumProvider()) as EIP1193Provider; // @ci-exception(type-assertion-count)
    return this.provider;
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
    const embedded = this.wallets.find((w) => w.walletClientType === 'privy');
    if (!embedded) throw new ContextRequiredError('Embedded wallet not found');

    const provider = (await embedded.getEthereumProvider()) as EIP1193Provider; // @ci-exception(type-assertion-count)
    const signer = embedded.address;

    const sig = await requestEIP1193(provider, 'personal_sign', [message, signer]);
    if (!isHex(sig)) throw new ValidationError('Invalid signature: not a hex string');
    return sig;
  }

  // Privy embedded wallet 찾기 헬퍼
  getEmbeddedWallet(): PrivyWalletLike | undefined {
    return this.wallets.find((w) => w.walletClientType === 'privy');
  }
}
