/**
 * AsterPerpAdapter — Aster DEX Pro API V3 어댑터 (agent-wallet EIP-712 플로우)
 *
 * Aster 아키텍처:
 * - 거래 API: https://fapi.asterdex.com  (Binance Futures API 호환)
 * - Agent 등록 API: https://www.asterdex.com  (V3 EIP-712 agent approve)
 *
 * 왜 두 개의 EIP-712 도메인이 필요한가:
 *   Domain A (chainId 56)  — 메인 지갑이 agent 주소를 1회 승인할 때 사용.
 *                            BNB Chain이 Aster의 기반 체인이므로 chainId=56.
 *   Domain B (chainId 1666) — agent가 매 API 요청에 서명할 때 사용.
 *                             Aster 내부 체인 ID(1666)와 일치해야 서버가 서명을 검증함.
 *   두 도메인은 검증 목적이 다르기 때문에 chainId를 달리 지정한다.
 *
 * 왜 Nonce는 microsecond이고 Expired는 millisecond인가:
 *   네트워크 캡처 실측 결과 nonce 값이 16자리(예: 1776182864705000).
 *   Date.now() × 1000 = microsecond(16자리).
 *   Expired는 Date.now() + TTL 형식의 일반 ms epoch(13자리).
 *   두 필드가 서로 다른 시간 단위를 사용하는 것은 Aster 서버 사양의 비대칭이다.
 *
 * 왜 signedRequest에서 urlencoded msg를 먼저 만드는가:
 *   Python SDK 예제(urllib.parse.urlencode)와 byte-for-byte 동일한 인코딩을
 *   유지해야 서버 서명 검증이 통과됨. URLSearchParams.toString()이 동일한
 *   percent-encoding을 생성하므로 qs를 빌드한 뒤 EIP-712 payload에 넣는다.
 *
 * 왜 두 개의 베이스 URL이 필요한가:
 *   `fapi.asterdex.com` — 모든 거래/마켓 데이터 엔드포인트
 *   `www.asterdex.com`  — agent 등록 전용 (V3 approve endpoint)
 *   두 도메인은 동일한 회사이지만 엔드포인트 역할이 분리되어 있음.
 */

import { PerpAdapterBase } from '../PerpAdapterBase';
import { ValidationError } from '@hq/core/lib/error';
import { privateKeyToAccount } from 'viem/accounts';
import type { ApproveAsterAgentParams, ApproveAsterBuilderParams } from '../types';
import type {
  PerpMarket,
  Orderbook,
  OrderbookLevel,
  Trade,
  Candle,
  CandleInterval,
  PerpAccountState,
  PerpPosition,
  PerpOrder,
  Fill,
  PlaceOrderParams,
  PlaceScaleOrderParams,
  PlaceTwapOrderParams,
  MarketFundingPoint,
  CancelOrderParams,
  ModifyOrderParams,
  UpdateLeverageParams,
  OrderResult,
  DepositParams,
  WithdrawParams,
  WsChannel,
  WsMessage,
  Unsubscribe,
  EIP712SignFn,
  UserFeeInfo,
  PerpDex,
  FundingHistoryEntry,
} from '../types';
import { createLogger } from '@hq/core/logging';

const logger = createLogger('AsterPerpAdapter');

// ── Aster API URL ──
// 단일 호스트. approveAgent + approveBuilder + 거래/계정 모두 fapi
// (/bapi 레거시 경로는 더 이상 사용하지 않음).
const ASTER_API_URL = 'https://fapi.asterdex.com';

// ── Candle interval mapping (Aster = Binance Futures = 동일 문자열) ──
const INTERVAL_MAP: Record<CandleInterval, string> = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '2h': '2h',
  '4h': '4h',
  '6h': '6h',
  '12h': '12h',
  '1d': '1d',
  '1w': '1w',
  '1M': '1M',
};

// ── Aster Raw API Types ──

interface AsterSymbolInfo {
  readonly symbol: string;
  readonly contractType: string;
  readonly status: string;
  readonly maxLeverage: unknown;
  readonly quantityPrecision: unknown;
  readonly pricePrecision: unknown;
  readonly filters: ReadonlyArray<Record<string, unknown>>;
}

interface AsterExchangeInfo {
  readonly symbols: readonly AsterSymbolInfo[];
}

interface AsterTicker {
  readonly symbol: string;
  readonly lastPrice: string;
  readonly quoteVolume: string;
  readonly volume: string;
  readonly priceChangePercent: string;
}

interface AsterPremiumIndex {
  readonly symbol: string;
  readonly markPrice: string;
  readonly indexPrice: string;
  readonly lastFundingRate: string;
}

interface AsterDepth {
  readonly bids: readonly [string, string][];
  readonly asks: readonly [string, string][];
}

interface AsterTrade {
  readonly id: number;
  readonly symbol: string;
  readonly price: string;
  readonly qty: string;
  readonly time: number;
  readonly isBuyerMaker: boolean;
}

interface AsterKline {
  0: number;   // open time
  1: string;   // open
  2: string;   // high
  3: string;   // low
  4: string;   // close
  5: string;   // volume
}

interface AsterAccountRaw {
  readonly totalWalletBalance: string;
  readonly totalUnrealizedProfit: string;
  readonly availableBalance: string;
  readonly totalInitialMargin: string;
  readonly totalMaintMargin: string;
  readonly totalCrossUnPnl: string;
}

interface AsterPositionRisk {
  readonly symbol: string;
  readonly positionAmt: string;
  readonly entryPrice: string;
  readonly markPrice: string;
  readonly liquidationPrice: string;
  readonly unRealizedProfit: string;
  readonly leverage: string;
  readonly marginType: string;
  readonly isolatedMargin: string;
}

interface AsterOpenOrder {
  readonly orderId: number;
  readonly symbol: string;
  readonly side: string;
  readonly type: string;
  readonly price: string;
  readonly origQty: string;
  readonly executedQty: string;
  readonly status: string;
  readonly timeInForce: string;
  readonly stopPrice: string;
  readonly time: number;
  readonly reduceOnly: boolean;
}

interface AsterUserTrade {
  readonly id: number;
  readonly orderId: number;
  readonly symbol: string;
  readonly side: string;
  readonly price: string;
  readonly qty: string;
  readonly commission: string;
  readonly commissionAsset: string;
  readonly time: number;
  readonly realizedPnl: string;
  readonly buyer: boolean;
}

interface AsterIncomeEntry {
  readonly symbol: string;
  readonly incomeType: string;
  readonly income: string;
  readonly asset: string;
  readonly time: number;
  readonly info: string;
}

interface AsterOrderResult {
  readonly orderId: number;
  readonly symbol: string;
  readonly status: string;
  readonly clientOrderId: string;
  readonly price: string;
  readonly executedQty: string;
}

// ── Agent Approve Response Type ──

interface AsterApproveAgentResponse {
  /** Binance-style 성공 코드: "000000" 또는 숫자 200 */
  readonly code: string | number;
  readonly msg?: string;
  readonly message?: string;
}

// ── OrderSide helper ──
function toAsterSide(side: 'long' | 'short'): string {
  return side === 'long' ? 'BUY' : 'SELL';
}

function fromAsterSide(side: string): 'long' | 'short' {
  return side.toUpperCase() === 'BUY' ? 'long' : 'short';
}

function fromAsterOrderType(type: string): import('../types').OrderType {
  const t = type.toUpperCase();
  if (t === 'MARKET') return 'market';
  if (t === 'LIMIT') return 'limit';
  if (t === 'STOP_MARKET') return 'stop_market';
  if (t === 'STOP') return 'stop_limit';
  if (t === 'TAKE_PROFIT_MARKET') return 'take_market';
  if (t === 'TAKE_PROFIT') return 'take_limit';
  return 'market';
}

function fromAsterStatus(status: string): import('../types').OrderStatus {
  const s = status.toUpperCase();
  if (s === 'FILLED') return 'filled';
  if (s === 'PARTIALLY_FILLED') return 'partially_filled';
  if (s === 'CANCELED') return 'cancelled';
  if (s === 'REJECTED' || s === 'EXPIRED') return 'rejected';
  return 'open';
}

function fromAsterTif(tif: string): import('../types').TimeInForce {
  const t = tif.toUpperCase();
  if (t === 'IOC') return 'ioc';
  if (t === 'ALO' || t === 'POSTONLY') return 'alo';
  return 'gtc';
}

// ============================================================
// Builder (Aster Code) constants
// ============================================================
//
// Aster Code = Aster의 builder 프로그램. main wallet이 `approveBuilder`로
// 1회 승인하면, 이후 모든 주문에 `builder` + `feeRate` 필드를 실어 수수료
// 일부를 이 주소로 귀속시킬 수 있다.
//
// BUILDER_ADDRESS는 HypurrQuant의 BNB Chain 수금 주소 — HL/Pacifica/
// Lighter builder와 동일한 지갑을 재사용. BUILDER_MAX_FEE_RATE는 decimal
// 문자열 ("0.001" = 0.1%) — Aster 서버가 per-order feeRate 검증 시 문자열
// 비교를 하므로 절대 number로 찍지 말 것.
const ASTER_BUILDER_ADDRESS = '0x362294a899b304c933135781bb1f976ed8062781' as const;
const ASTER_BUILDER_MAX_FEE_RATE = '0.001'; // 0.1% cap, 실제 per-order fee는 훨씬 낮게 설정

// ============================================================
// AsterPerpAdapter
// ============================================================

export class AsterPerpAdapter extends PerpAdapterBase {
  readonly protocolId = 'aster';
  readonly displayName = 'Aster';

  /** UI가 Enable Trading 모달에서 바로 참조할 수 있도록 static으로 노출. */
  static readonly BUILDER_ADDRESS: `0x${string}` = ASTER_BUILDER_ADDRESS;
  static readonly BUILDER_MAX_FEE_RATE: string = ASTER_BUILDER_MAX_FEE_RATE;

  private readonly apiUrl = ASTER_API_URL;

  // ── Agent 인증 상태 ──
  /** 메인 EOA 주소 — 계정 조회 및 approve body에 사용 */
  private agentUser: `0x${string}` | null = null;
  /** agent EOA 주소 — 요청마다 signer 파라미터로 첨부 */
  private agentAddress: `0x${string}` | null = null;
  /** agent 개인키 — Domain B EIP-712 서명에 사용 */
  private agentPrivateKey: `0x${string}` | null = null;

  // ── microsecond nonce 단조 증가 보장 ──
  private lastNonceMs = 0;
  private nonceCounter = 0;

  // ── 캐시 ──
  private marketsCache: PerpMarket[] | null = null;
  private marketsCacheTime = 0;
  private readonly MARKETS_CACHE_TTL = 30_000; // 30초

  // ── Agent Credential Management ──

  setAsterAgent(
    user: `0x${string}`,
    agentAddress: `0x${string}`,
    agentPrivateKey: `0x${string}`,
  ): void {
    this.agentUser = user;
    this.agentAddress = agentAddress;
    this.agentPrivateKey = agentPrivateKey;
    logger.info(`Aster agent set — user=${user.slice(0, 10)}... agent=${agentAddress.slice(0, 10)}...`);
  }

  clearAsterAgent(): void {
    this.agentUser = null;
    this.agentAddress = null;
    this.agentPrivateKey = null;
    logger.info('Aster agent cleared');
  }

  hasCredentials(): boolean {
    return this.agentUser !== null && this.agentAddress !== null && this.agentPrivateKey !== null;
  }

  /** 메인 EOA 주소 반환 (계정 조회 UI용) */
  getUser(): `0x${string}` | null {
    return this.agentUser;
  }

  /** agent EOA 주소 반환 */
  getAgentAddress(): `0x${string}` | null {
    return this.agentAddress;
  }

  // ── Agent Approve ──

  async approveAgent(params: ApproveAsterAgentParams, mainSignFn: EIP712SignFn): Promise<void> {
    logger.info(`Aster approve agent start — user=${params.user.slice(0, 10)}... agent=${params.agentAddress.slice(0, 10)}...`);

    // /fapi/v3/approveAgent — 공식 Aster GitHub demo (01_approveAgent.js + utils.js) 기준:
    //   Domain: name='AsterSignTransaction', version='1', chainId=56, verifyingContract=0x0..0
    //   primaryType='ApproveAgent'
    //   Types: signEIP712Main의 타입 추론 규칙 — boolean→bool, 정수→uint256, 그 외→string
    //   Field order: params 객체 삽입 순서와 동일 (capitalizeKeys 후 iteration order)
    //   인증에는 agentName, agentAddress, ipWhitelist(있을 때), expired, canSpotTrade,
    //   canPerpTrade, canWithdraw, asterChain, user, nonce 포함
    //   HTTP: POST /fapi/v3/approveAgent, 파라미터는 query string, body 비움
    const canSpotTrade  = false;
    const canPerpTrade  = true;
    const canWithdraw   = false;

    // ipWhitelist가 빈 문자열이면 서명에 포함 (demo에서 undefined는 제외, '' 는 포함)
    const ipWhitelistIncluded = params.ipWhitelist !== undefined && params.ipWhitelist !== null;
    // Optional combined builder approval (official /fapi/v3/approveAgent spec)
    const builderIncluded = params.builder !== undefined && params.builder !== null;

    // Types must match field insertion order — mirrors Python infer_eip712_type + JS capitalizeKeys.
    // Official demo order (01_approveAgent.js):
    //   agentName, agentAddress, [ipWhitelist,] expired, canSpotTrade, canPerpTrade, canWithdraw,
    //   [builder, maxFeeRate, builderName,] asterChain, user, nonce
    // Builder fields come AFTER canWithdraw, BEFORE asterChain.
    const agentTypes: { name: string; type: string }[] = [
      { name: 'AgentName',    type: 'string'  },
      { name: 'AgentAddress', type: 'string'  },
    ];
    if (ipWhitelistIncluded) {
      agentTypes.push({ name: 'IpWhitelist', type: 'string' });
    }
    agentTypes.push(
      { name: 'Expired',      type: 'uint256' },
      { name: 'CanSpotTrade', type: 'bool'    },
      { name: 'CanPerpTrade', type: 'bool'    },
      { name: 'CanWithdraw',  type: 'bool'    },
    );
    // Builder fields follow CanWithdraw and precede AsterChain, per official demo field order
    if (builderIncluded) {
      agentTypes.push({ name: 'Builder',     type: 'string' });
      agentTypes.push({ name: 'MaxFeeRate',  type: 'string' });
      if (params.builderName !== undefined) {
        agentTypes.push({ name: 'BuilderName', type: 'string' });
      }
    }
    agentTypes.push(
      { name: 'AsterChain',   type: 'string'  },
      { name: 'User',         type: 'string'  },
      { name: 'Nonce',        type: 'uint256' },
    );

    const agentMessage: Record<string, unknown> = {
      AgentName:    params.agentName,
      AgentAddress: params.agentAddress,
    };
    if (ipWhitelistIncluded) {
      agentMessage['IpWhitelist'] = params.ipWhitelist;
    }
    // EIP-712 uint256 fields go over the wire as a JSON string (via
    // window.ethereum.request → eth_signTypedData_v4 → JSON.stringify).
    // Native BigInt throws "Do not know how to serialize a BigInt" inside
    // the provider's JSON.stringify — pass decimal strings instead.
    agentMessage['Expired']      = String(params.expiredMs);
    agentMessage['CanSpotTrade'] = canSpotTrade;
    agentMessage['CanPerpTrade'] = canPerpTrade;
    agentMessage['CanWithdraw']  = canWithdraw;
    // Builder fields after CanWithdraw, before AsterChain
    if (builderIncluded) {
      agentMessage['Builder']    = params.builder;
      agentMessage['MaxFeeRate'] = params.maxFeeRate;
      if (params.builderName !== undefined) {
        agentMessage['BuilderName'] = params.builderName;
      }
    }
    agentMessage['AsterChain']   = 'Mainnet';
    agentMessage['User']         = params.user;
    agentMessage['Nonce']        = String(params.nonceMicros);

    const signature = await mainSignFn({
      domain: { name: 'AsterSignTransaction', version: '1', chainId: 56, verifyingContract: '0x0000000000000000000000000000000000000000' },
      types: { ApproveAgent: agentTypes },
      primaryType: 'ApproveAgent',
      message: agentMessage,
    });

    // Query string param order mirrors the demo's params object construction order:
    //   agentName, agentAddress, [ipWhitelist,] expired, canSpotTrade, canPerpTrade, canWithdraw,
    //   [builder, maxFeeRate, builderName,] asterChain, user, nonce, signature, signatureChainId
    const qsEntries: [string, string][] = [
      ['agentName',    params.agentName],
      ['agentAddress', params.agentAddress],
    ];
    if (ipWhitelistIncluded) {
      qsEntries.push(['ipWhitelist', params.ipWhitelist]);
    }
    qsEntries.push(
      ['expired',      String(params.expiredMs)],
      ['canSpotTrade', String(canSpotTrade)],
      ['canPerpTrade', String(canPerpTrade)],
      ['canWithdraw',  String(canWithdraw)],
    );
    if (builderIncluded) {
      qsEntries.push(['builder',    params.builder as string]);
      qsEntries.push(['maxFeeRate', params.maxFeeRate as string]);
      if (params.builderName !== undefined) {
        qsEntries.push(['builderName', params.builderName]);
      }
    }
    qsEntries.push(
      ['asterChain',       'Mainnet'],
      ['user',             params.user],
      ['nonce',            String(params.nonceMicros)],
      ['signature',        signature],
      ['signatureChainId', '56'],
    );
    const qsParams = Object.fromEntries(qsEntries);
    const qs = new URLSearchParams(qsParams);
    const approveAgentUrl = `${this.apiUrl}/fapi/v3/approveAgent?${qs.toString()}`;

    logger.info('Aster agent approval POST sent');

    const agentRes = await fetch(approveAgentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
    });

    if (!agentRes.ok) {
      const errorText = await agentRes.text().catch(() => '');
      throw new Error(
        `Aster approveAgent failed (${agentRes.status}): ${errorText.slice(0, 200)}`,
      );
    }

    // 성공 판정: HTTP 200 && (code === "000000" || code === 200)
    const resp = await agentRes.json() as AsterApproveAgentResponse;
    const isSuccess = resp.code === '000000' || resp.code === 200;
    if (!isSuccess) {
      const errMsg = resp.msg ?? resp.message ?? String(resp.code);
      throw new Error(`Aster approveAgent failed: ${errMsg}`);
    }

    logger.info(`Aster agent approved — agent=${params.agentAddress.slice(0, 10)}...`);
  }

  // ── Builder Approve ──

  /**
   * Aster V3 builder 승인 — 메인 지갑으로 EIP-712 서명하여 builder에
   * per-order fee 귀속 권한을 부여한다. agent 승인과 동일한 Domain A
   * (chainId=56) 위에서 primaryType만 'ApproveBuilder'로 바꾼다.
   *
   * 왜 agent 승인 **이전**에 호출해야 하는가:
   *   - agent가 등록되면 사용자는 즉시 주문 가능
   *   - builder 승인이 없으면 첫 주문에서 Aster가 "Unauthorized builder"로
   *     거절하거나 fee가 귀속되지 않음
   *   - 따라서 Enable Trading 단일 플로우 안에서 `approveBuilder` →
   *     `approveAgent` 순서로 묶어 호출한다 (HL/Pacifica와 동일 UX).
   */
  async approveBuilder(params: ApproveAsterBuilderParams, mainSignFn: EIP712SignFn): Promise<void> {
    logger.info(`Aster approve builder start — user=${params.user.slice(0, 10)}... builder=${params.builder.slice(0, 10)}... maxFeeRate=${params.maxFeeRate}`);

    // 스키마는 `asterdex/API-demo/aster-code-demo/05_approveBuilder.js` +
    // `utils.js`의 signEIP712Main 구현과 일치시켰다. 핵심:
    //   Domain: name='AsterSignTransaction', chainId=56 (main=true 경로),
    //           verifyingContract=0x0..0, version='1'.
    //   primaryType='ApproveBuilder'.
    //   Types 는 insertion order 로 자동 구성 — 문자열/주소는 모두 'string',
    //   정수는 'uint256', boolean 은 'bool'. 주소 필드도 string 타입 (viem
    //   address 타입과 다름). 필드 이름은 첫 글자만 대문자화.
    //   HTTP 는 POST 지만 모든 파라미터를 query string 으로 보내고 body 는 비운다.
    // Live probe 로 서버가 이 스키마에서 서명을 통과시키는 것을 확인했다
    // (approveBuilder schema probe, F2/F4/F6).
    const signature = await mainSignFn({
      domain: { name: 'AsterSignTransaction', version: '1', chainId: 56, verifyingContract: '0x0000000000000000000000000000000000000000' },
      types: {
        ApproveBuilder: [
          { name: 'Builder',    type: 'string'  },
          { name: 'MaxFeeRate', type: 'string'  },
          { name: 'AsterChain', type: 'string'  },
          { name: 'User',       type: 'string'  },
          { name: 'Nonce',      type: 'uint256' },
        ],
      },
      primaryType: 'ApproveBuilder',
      message: {
        Builder:    params.builder,
        MaxFeeRate: params.maxFeeRate,
        AsterChain: 'Mainnet',
        User:       params.user,
        // Pass decimal string, not BigInt — injected providers JSON.stringify
        // the typed-data payload and fail on native BigInt. uint256 accepts
        // string representation on the wire.
        Nonce:      String(params.nonceMicros),
      },
    });

    // 쿼리스트링 파라미터 순서는 서명 시 insertion order 와 일치시킨다.
    // 서버는 body 대신 query string 에서 파라미터를 읽는다 — 공식 demo
    // (05_approveBuilder.js) 와 동일한 형태. body 는 비우고 Content-Type
    // 은 그대로 둔다.
    const qs = new URLSearchParams({
      builder:          params.builder,
      maxFeeRate:       params.maxFeeRate,
      asterChain:       'Mainnet',
      user:             params.user,
      nonce:            String(params.nonceMicros),
      signature,
      signatureChainId: '56',
    });
    const approveBuilderUrl = `${this.apiUrl}/fapi/v3/approveBuilder?${qs.toString()}`;

    const builderRes = await fetch(approveBuilderUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
    });

    if (!builderRes.ok) {
      const errorText = await builderRes.text().catch(() => '');
      throw new Error(
        `Aster approveBuilder failed (${builderRes.status}): ${errorText.slice(0, 200)}`,
      );
    }

    const resp = await builderRes.json() as AsterApproveAgentResponse;
    const isSuccess = resp.code === '000000' || resp.code === 200;
    if (!isSuccess) {
      const errMsg = resp.msg ?? resp.message ?? String(resp.code);
      throw new Error(`Aster approveBuilder failed: ${errMsg}`);
    }

    logger.info(`Aster builder approved — builder=${params.builder.slice(0, 10)}...`);
  }

  /**
   * Agent private key → EIP712SignFn 생성 (HL createAgentSignFn과 동일 패턴).
   * viem signTypedData로 서명하므로 브라우저/Node 모두 동작.
   */
  static createAgentSignFn(agentPrivateKey: `0x${string}`): EIP712SignFn {
    const account = privateKeyToAccount(agentPrivateKey);
    return async (payload) => {
      return account.signTypedData({
        domain: payload.domain as Parameters<typeof account.signTypedData>[0]['domain'],
        types: payload.types as Parameters<typeof account.signTypedData>[0]['types'],
        primaryType: payload.primaryType,
        message: payload.message as Parameters<typeof account.signTypedData>[0]['message'],
      });
    };
  }

  // ── Microsecond Nonce ──

  /**
   * 단조 증가하는 microsecond nonce.
   * 같은 ms 내에서 중복 방지를 위해 counter를 증가시킨다.
   * 실측 캡처값: 1776182864705000 (16자리) = Date.now() × 1000.
   */
  private microsecNonce(): number {
    const ms = Date.now();
    if (ms === this.lastNonceMs) {
      this.nonceCounter++;
    } else {
      this.lastNonceMs = ms;
      this.nonceCounter = 0;
    }
    return ms * 1_000 + this.nonceCounter;
  }

  // ── HTTP Helpers ──

  private async publicGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const qs = new URLSearchParams(params).toString();
    const url = `${this.apiUrl}${path}${qs ? `?${qs}` : ''}`;
    logger.debug(`GET ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Aster GET ${path} failed (${res.status}): ${text.slice(0, 120)}`);
    }
    return res.json() as Promise<T>;
  }

  /**
   * V3 agent-wallet 서명 요청.
   *
   * 흐름:
   *  1. params에 nonce(microsec), user(메인 EOA), signer(agent EOA) 주입
   *  2. URLSearchParams.toString()으로 urlencoded qs 생성
   *     → Python urllib.parse.urlencode와 byte-for-byte 동일 인코딩 보장
   *  3. Domain B EIP-712 payload: { msg: qs }를 agent key로 서명
   *  4. GET/DELETE: URL에 qs + signature를 query string으로 붙여 요청
   *     POST/PUT: qs + signature를 body로 urlencoded 전송
   */
  private async signedRequest<T>(
    method: 'GET' | 'DELETE' | 'POST' | 'PUT',
    path: string,
    params: Record<string, string> = {},
  ): Promise<T> {
    if (!this.agentUser || !this.agentAddress || !this.agentPrivateKey) {
      throw new Error('Aster: agent not configured — call approveAgent() and setAsterAgent() first');
    }

    const merged: Record<string, string> = {
      ...params,
      nonce:  String(this.microsecNonce()),
      user:   this.agentUser,
      signer: this.agentAddress,
    };

    const qs = new URLSearchParams(merged).toString();

    // Domain B — chainId=1666은 Domain A의 56과 다른 Aster-specific 값
    const signFn = AsterPerpAdapter.createAgentSignFn(this.agentPrivateKey);
    const signature = await signFn({
      domain: {
        name: 'AsterSignTransaction',
        version: '1',
        chainId: 1666,
        verifyingContract: '0x0000000000000000000000000000000000000000',
      },
      types: {
        Message: [{ name: 'msg', type: 'string' }],
      },
      primaryType: 'Message',
      message: { msg: qs },
    });

    let url: string;
    let fetchInit: RequestInit;

    if (method === 'GET' || method === 'DELETE') {
      url = `${this.apiUrl}${path}?${qs}&signature=${signature}`;
      fetchInit = { method };
    } else {
      // POST / PUT: urlencoded body
      url = `${this.apiUrl}${path}`;
      fetchInit = {
        method,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `${qs}&signature=${signature}`,
      };
    }

    logger.debug(`${method} ${url}`);
    const res = await fetch(url, fetchInit);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Aster ${method} ${path} failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const json = await res.json() as Record<string, unknown>;
    // Binance-style 에러: code가 음수이거나 msg/message가 에러를 나타내면 throw
    if (typeof json['code'] === 'number' && json['code'] < 0) {
      throw new Error(`Aster API error ${json['code']}: ${json['msg'] ?? json['message'] ?? ''}`);
    }
    return json as T;
  }

  // ── Symbol Mapping ──

  /** HypurrQuant canonical symbol → Aster API symbol (ETH → ETHUSDT) */
  private toApi(sym: string): string {
    const s = sym.toUpperCase().replace(/-PERP$/, '');
    if (s.endsWith('USDT') || s.endsWith('BUSD')) return s;
    return `${s}USDT`;
  }

  /** Aster API symbol → canonical symbol (ETHUSDT → ETH) */
  private fromApi(sym: string): string {
    return sym.replace(/USDT$/, '').replace(/BUSD$/, '');
  }

  // ── Market Data ──

  async getMarkets(): Promise<PerpMarket[]> {
    // 캐시 유효 시 즉시 반환
    if (this.marketsCache !== null && Date.now() - this.marketsCacheTime < this.MARKETS_CACHE_TTL) {
      return this.marketsCache;
    }

    // exchangeInfo + 24h ticker + premiumIndex 동시 조회
    const [info, tickers, premiums] = await Promise.all([
      this.publicGet<AsterExchangeInfo>('/fapi/v1/exchangeInfo'),
      this.publicGet<readonly AsterTicker[]>('/fapi/v1/ticker/24hr'),
      this.publicGet<readonly AsterPremiumIndex[]>('/fapi/v1/premiumIndex').catch(() => [] as AsterPremiumIndex[]),
    ]);

    const tickerMap = new Map<string, AsterTicker>();
    for (const t of tickers) tickerMap.set(t.symbol, t);

    const premiumMap = new Map<string, AsterPremiumIndex>();
    for (const p of premiums) premiumMap.set(p.symbol, p);

    // PERPETUAL + TRADING 상태인 심볼만 포함
    const tradingSymbols = (info.symbols ?? []).filter(
      (s) => s.contractType === 'PERPETUAL' && s.status === 'TRADING',
    );

    const markets: PerpMarket[] = tradingSymbols.map((s): PerpMarket => {
      const ticker = tickerMap.get(s.symbol);
      const premium = premiumMap.get(s.symbol);
      const maxLeverage = Number(s.maxLeverage ?? 20);

      const lotFilter = s.filters.find((f) => f['filterType'] === 'LOT_SIZE');
      const priceFilter = s.filters.find((f) => f['filterType'] === 'PRICE_FILTER');

      const lotSize = lotFilter?.['stepSize'] != null ? parseFloat(String(lotFilter['stepSize'])) : 0.001;
      const tickSize = priceFilter?.['tickSize'] != null ? parseFloat(String(priceFilter['tickSize'])) : 0.01;
      const minOrderSize = lotFilter?.['minQty'] != null ? parseFloat(String(lotFilter['minQty'])) : lotSize;

      const markPrice = premium?.markPrice != null ? parseFloat(premium.markPrice) : parseFloat(ticker?.lastPrice ?? '0');
      const indexPrice = premium?.indexPrice != null ? parseFloat(premium.indexPrice) : markPrice;
      const fundingRate = premium?.lastFundingRate != null ? parseFloat(premium.lastFundingRate) : 0;
      const volume24h = ticker?.quoteVolume != null ? parseFloat(ticker.quoteVolume) : 0;
      const prevDayPx = ticker?.lastPrice != null ? parseFloat(ticker.lastPrice) : 0;

      const canonical = this.fromApi(s.symbol);
      return {
        symbol: canonical,
        name: `${canonical}-PERP`,
        prevDayPx,
        baseAsset: canonical,
        quoteAsset: 'USDT',
        maxLeverage,
        tickSize,
        lotSize,
        minOrderSize,
        // Aster는 수수료 정보를 exchangeInfo에서 노출하지 않음 — 기본값 0
        // 실제 수수료는 getUserFees()를 통해 별도 조회 필요
        makerFee: 0,
        takerFee: 0,
        fundingRate,
        openInterest: 0,
        volume24h,
        markPrice,
        indexPrice,
        category: 'crypto',
        assetType: 'perp',
        dex: null,
        marketCap: null,
        contractAddress: null,
      };
    });

    this.marketsCache = markets;
    this.marketsCacheTime = Date.now();
    return markets;
  }

  async getOrderbook(symbol: string, _nSigFigs?: number): Promise<Orderbook> {
    const depth = await this.publicGet<AsterDepth>('/fapi/v1/depth', {
      symbol: this.toApi(symbol),
      limit: '20',
    });

    const mapLevels = (raw: readonly [string, string][]): OrderbookLevel[] =>
      (raw ?? []).map(([price, size]) => ({
        price: parseFloat(price),
        size: parseFloat(size),
      }));

    return {
      symbol,
      bids: mapLevels(depth.bids ?? []),
      asks: mapLevels(depth.asks ?? []),
      timestamp: Date.now(),
    };
  }

  async getTrades(symbol: string, limit = 20): Promise<Trade[]> {
    const trades = await this.publicGet<readonly AsterTrade[]>('/fapi/v1/trades', {
      symbol: this.toApi(symbol),
      limit: String(limit),
    });

    return (trades ?? []).map((t): Trade => ({
      id: String(t.id),
      symbol,
      price: parseFloat(t.price),
      size: parseFloat(t.qty),
      // isBuyerMaker=true → 매수자가 maker → 체결은 매도 aggressive
      side: t.isBuyerMaker ? 'short' : 'long',
      timestamp: t.time,
    }));
  }

  async getCandles(
    symbol: string,
    interval: CandleInterval,
    limit = 200,
    endTime?: number,
  ): Promise<Candle[]> {
    const params: Record<string, string> = {
      symbol: this.toApi(symbol),
      interval: INTERVAL_MAP[interval],
      limit: String(limit),
    };
    if (endTime !== undefined) params['endTime'] = String(endTime);

    // Aster klines response: array of arrays
    const raw = await this.publicGet<readonly AsterKline[]>('/fapi/v1/klines', params);

    return (raw ?? []).map((k): Candle => ({
      timestamp: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  }

  // ── Fees ──

  async getUserFees(_address: string): Promise<UserFeeInfo> {
    // Aster는 getUserFees 전용 엔드포인트를 공개 문서에서 제공하지 않음.
    // 표준 taker/maker 요율을 기본값으로 반환.
    return {
      perpTaker: 0.0005,
      perpMaker: 0.0002,
      spotTaker: 0,
      spotMaker: 0,
      referralDiscount: 0,
      stakingDiscount: 0,
    };
  }

  // ── HIP-3 ──

  async getPerpDexs(): Promise<PerpDex[]> {
    // Aster는 HIP-3 프로토콜이 없음
    return [];
  }

  // ── Account ──

  async getAccountState(_address: string): Promise<PerpAccountState> {
    // address 파라미터 무시: agent user 주소가 이미 계정을 특정함
    if (!this.hasCredentials()) {
      throw new Error('Aster: agent not configured — call approveAgent() and setAsterAgent() first');
    }

    // /fapi/v3/account — totalWalletBalance, availableBalance 등 포함
    // 주의: totalWalletBalance는 unrealized PnL을 포함하지 않음.
    // equity = totalWalletBalance + totalUnrealizedProfit
    const account = await this.signedRequest<AsterAccountRaw>('GET', '/fapi/v3/account');

    const totalWallet = parseFloat(account.totalWalletBalance ?? '0');
    const unrealizedPnl = parseFloat(account.totalUnrealizedProfit ?? '0');
    const availableBalance = parseFloat(account.availableBalance ?? '0');
    const totalMarginUsed = parseFloat(account.totalInitialMargin ?? '0');
    const maintenanceMargin = parseFloat(account.totalMaintMargin ?? '0');
    const totalEquity = totalWallet + unrealizedPnl;

    // totalNtlPos 근사: HL 스타일 — Aster는 직접 제공하지 않으므로 0
    return {
      address: this.agentUser ?? '',
      totalEquity,
      totalMarginUsed,
      totalNotional: 0,
      availableBalance,
      unrealizedPnl,
      maintenanceMargin,
      crossMarginSummary: {
        accountValue: totalEquity,
        totalNtlPos: 0,
        totalRawUsd: 0,
      },
    };
  }

  async getPositions(_address: string): Promise<PerpPosition[]> {
    if (!this.hasCredentials()) {
      throw new Error('Aster: credentials required');
    }

    const positions = await this.signedRequest<readonly AsterPositionRisk[]>('GET', '/fapi/v3/positionRisk');

    return (positions ?? [])
      .filter((p) => parseFloat(p.positionAmt ?? '0') !== 0)
      .map((p): PerpPosition => {
        const amt = parseFloat(p.positionAmt);
        const size = Math.abs(amt);
        const side: 'long' | 'short' = amt > 0 ? 'long' : 'short';
        const entryPrice = parseFloat(p.entryPrice ?? '0');
        const markPrice = parseFloat(p.markPrice ?? '0');
        const leverage = parseFloat(p.leverage ?? '1');
        const unrealizedPnl = parseFloat(p.unRealizedProfit ?? '0');
        const leverageType: 'cross' | 'isolated' = p.marginType === 'isolated' ? 'isolated' : 'cross';
        const marginUsed = leverageType === 'isolated'
          ? parseFloat(p.isolatedMargin ?? '0')
          : (size * entryPrice) / leverage;
        const roe = marginUsed > 0 ? (unrealizedPnl / marginUsed) * 100 : 0;
        const liqPrice = parseFloat(p.liquidationPrice ?? '0');

        return {
          symbol: this.fromApi(p.symbol),
          side,
          size,
          entryPrice,
          markPrice,
          liquidationPrice: liqPrice > 0 ? liqPrice : null,
          unrealizedPnl,
          realizedPnl: 0,
          leverage,
          leverageType,
          marginUsed,
          returnOnEquity: roe,
          fundingPayment: 0,
        };
      });
  }

  async getOpenOrders(_address: string): Promise<PerpOrder[]> {
    if (!this.hasCredentials()) {
      throw new Error('Aster: credentials required');
    }

    const orders = await this.signedRequest<readonly AsterOpenOrder[]>('GET', '/fapi/v3/openOrders');

    return (orders ?? []).map((o): PerpOrder => ({
      orderId: String(o.orderId),
      symbol: this.fromApi(o.symbol),
      side: fromAsterSide(o.side),
      type: fromAsterOrderType(o.type),
      price: parseFloat(o.price) > 0 ? parseFloat(o.price) : null,
      size: parseFloat(o.origQty),
      filledSize: parseFloat(o.executedQty),
      status: fromAsterStatus(o.status),
      leverage: 1,
      reduceOnly: o.reduceOnly,
      timeInForce: fromAsterTif(o.timeInForce),
      triggerPrice: parseFloat(o.stopPrice ?? '0') > 0 ? parseFloat(o.stopPrice) : null,
      tpPrice: null,
      slPrice: null,
      timestamp: o.time,
    }));
  }

  async getOrderHistory(_address: string, limit = 50): Promise<PerpOrder[]> {
    if (!this.hasCredentials()) {
      throw new Error('Aster: credentials required');
    }

    // Aster의 allOrders는 symbol 필수 → 포지션 보유 심볼 + fallback 공통 심볼에서 수집
    const positions = await this.signedRequest<readonly AsterPositionRisk[]>('GET', '/fapi/v3/positionRisk');
    const activeSymbols = new Set(
      (positions ?? [])
        .filter((p) => parseFloat(p.positionAmt ?? '0') !== 0)
        .map((p) => p.symbol),
    );
    // 포지션이 없으면 주요 심볼로 fallback
    if (activeSymbols.size === 0) {
      for (const s of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']) activeSymbols.add(s);
    }

    const allOrders: PerpOrder[] = [];
    for (const sym of activeSymbols) {
      try {
        const orders = await this.signedRequest<readonly AsterOpenOrder[]>('GET', '/fapi/v3/allOrders', {
          symbol: sym,
          limit: String(limit),
        });
        for (const o of orders ?? []) {
          allOrders.push({
            orderId: String(o.orderId),
            symbol: this.fromApi(o.symbol),
            side: fromAsterSide(o.side),
            type: fromAsterOrderType(o.type),
            price: parseFloat(o.price) > 0 ? parseFloat(o.price) : null,
            size: parseFloat(o.origQty),
            filledSize: parseFloat(o.executedQty),
            status: fromAsterStatus(o.status),
            leverage: 1,
            reduceOnly: o.reduceOnly,
            timeInForce: fromAsterTif(o.timeInForce),
            triggerPrice: parseFloat(o.stopPrice ?? '0') > 0 ? parseFloat(o.stopPrice) : null,
            tpPrice: null,
            slPrice: null,
            timestamp: o.time,
          });
        }
      } catch {
        // 심볼별 조회 실패는 skip — 전체 실패를 막기 위해
        logger.warn(`getOrderHistory: failed for symbol ${sym}`);
      }
    }

    return allOrders.slice(0, limit);
  }

  async getFills(_address: string, limit = 50): Promise<Fill[]> {
    if (!this.hasCredentials()) {
      throw new Error('Aster: credentials required');
    }

    // userTrades는 symbol 필수 → 포지션 심볼 + fallback
    const positions = await this.signedRequest<readonly AsterPositionRisk[]>('GET', '/fapi/v3/positionRisk');
    const activeSymbols = new Set(
      (positions ?? [])
        .filter((p) => parseFloat(p.positionAmt ?? '0') !== 0)
        .map((p) => p.symbol),
    );
    if (activeSymbols.size === 0) activeSymbols.add('BTCUSDT');

    const allFills: Fill[] = [];
    for (const sym of activeSymbols) {
      try {
        const trades = await this.signedRequest<readonly AsterUserTrade[]>('GET', '/fapi/v3/userTrades', {
          symbol: sym,
          limit: String(limit),
        });
        for (const t of trades ?? []) {
          allFills.push({
            id: String(t.id),
            orderId: String(t.orderId),
            symbol: this.fromApi(t.symbol),
            side: t.buyer ? 'long' : 'short',
            price: parseFloat(t.price),
            size: parseFloat(t.qty),
            fee: parseFloat(t.commission),
            feeToken: t.commissionAsset ?? 'USDT',
            timestamp: t.time,
            liquidation: false,
            closedPnl: parseFloat(t.realizedPnl ?? '0'),
          });
        }
      } catch {
        logger.warn(`getFills: failed for symbol ${sym}`);
      }
    }

    return allFills.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  async getFundingHistory(_address: string, startTime?: number): Promise<FundingHistoryEntry[]> {
    if (!this.hasCredentials()) {
      throw new Error('Aster: credentials required');
    }

    const params: Record<string, string> = {
      incomeType: 'FUNDING_FEE',
      limit: '200',
    };
    if (startTime !== undefined) params['startTime'] = String(startTime);

    const entries = await this.signedRequest<readonly AsterIncomeEntry[]>('GET', '/fapi/v3/income', params);

    return (entries ?? []).map((e): FundingHistoryEntry => ({
      timestamp: e.time,
      symbol: this.fromApi(e.symbol),
      size: 0,    // Aster income API는 포지션 사이즈를 반환하지 않음
      payment: parseFloat(e.income),
      rate: 0,    // funding rate를 income API에서 별도로 제공하지 않음
    }));
  }

  /** Aster's `/fapi/v1/fundingRate` specifically lacks CORS headers — every
   *  other public Aster endpoint works from the browser, only this one is
   *  closed — and the app is shipped under `output: 'export'` so there's no
   *  server-side proxy we can hop through. We throw a labeled error so the
   *  drill-down can surface the reason instead of silently showing zero
   *  points. Server contexts still hit upstream directly. */
  async getMarketFundingHistory(symbol: string, startTime?: number): Promise<MarketFundingPoint[]> {
    const apiSymbol = this.toApi(symbol);
    const params = new URLSearchParams({
      symbol: apiSymbol,
      limit: '200',
    });
    if (startTime !== undefined) params.set('startTime', String(startTime));
    else params.set('startTime', String(Date.now() - 24 * 60 * 60 * 1000));
    try {
      const res = await fetch(`${this.apiUrl}/fapi/v1/fundingRate?${params.toString()}`);
      if (!res.ok) return [];
      const raw = (await res.json()) as ReadonlyArray<{ fundingTime: number; fundingRate: string }>;
      return raw
        .map(r => ({ ts: r.fundingTime, fundingRate: parseFloat(r.fundingRate) }))
        .filter(p => Number.isFinite(p.fundingRate))
        .sort((a, b) => a.ts - b.ts);
    } catch (err) {
      if (typeof window !== 'undefined') {
        throw new Error('CORS blocked — Aster does not expose /fapi/v1/fundingRate to browsers');
      }
      throw err;
    }
  }

  // ── Trading ──

  /**
   * signFn 파라미터 무시 — Aster는 HMAC-SHA256으로 자체 서명.
   * 인터페이스 호환성을 위해 받되 사용하지 않음.
   */
  async placeOrder(params: PlaceOrderParams, _signFn: EIP712SignFn): Promise<OrderResult> {
    if (!this.hasCredentials()) {
      throw new Error('Aster: credentials required');
    }

    // ── Precision rounding ──────────────────────────────────────────────────
    // Aster (Binance Futures compatible) enforces per-symbol PRICE_FILTER
    // (tickSize) and LOT_SIZE (stepSize). Sending more decimal places than
    // allowed returns {code:-1111, msg:"Precision is over the maximum defined
    // for this asset."}. We round both price and size to the exact tick/step
    // before building the order params.
    //
    // If the symbol isn't in the markets cache (toApi/fromApi mismatch, new
    // listing, or a stale cache race), we REFUSE to post an order — rather
    // than fall back to hardcoded 0.1/0.001 which ship wrong-precision
    // numbers to the venue and guarantee a -1111 reject anyway.
    const markets = await this.getMarkets();
    const canonical = this.fromApi(this.toApi(params.symbol));
    const market = markets.find(m => m.symbol === canonical);
    if (!market) {
      return { success: false, orderId: null, error: `Unknown symbol: ${params.symbol}` };
    }
    const tickSize = market.tickSize;
    const stepSize = market.lotSize;

    const roundToStep = (value: number, step: number): number => {
      if (step <= 0) return value;
      const decimals = Math.max(0, Math.round(-Math.log10(step)));
      return Math.round(Math.round(value / step) * step * Math.pow(10, decimals)) / Math.pow(10, decimals);
    };

    const roundedSize = roundToStep(params.size, stepSize);
    const roundedPrice = params.price != null ? roundToStep(params.price, tickSize) : null;

    const orderParams: Record<string, string> = {
      symbol: this.toApi(params.symbol),
      side: toAsterSide(params.side),
      type: params.type === 'market' ? 'MARKET' : 'LIMIT',
      quantity: String(roundedSize),
    };

    if (params.type !== 'market' && roundedPrice != null) {
      orderParams['price'] = String(roundedPrice);
      const tif = params.timeInForce ?? 'gtc';
      orderParams['timeInForce'] = tif === 'ioc' ? 'IOC' : tif === 'alo' ? 'GTX' : 'GTC';
    }

    if (params.reduceOnly) orderParams['reduceOnly'] = 'true';

    if (params.type === 'stop_market' || params.type === 'stop_limit') {
      orderParams['type'] = params.type === 'stop_limit' ? 'STOP' : 'STOP_MARKET';
      if (params.triggerPrice != null) orderParams['stopPrice'] = String(params.triggerPrice);
    }

    if (params.type === 'take_market') {
      orderParams['type'] = 'TAKE_PROFIT_MARKET';
      if (params.triggerPrice != null) orderParams['stopPrice'] = String(params.triggerPrice);
    }

    if (params.type === 'take_limit') {
      orderParams['type'] = 'TAKE_PROFIT';
      if (params.triggerPrice != null) orderParams['stopPrice'] = String(params.triggerPrice);
    }

    const result = await this.signedRequest<AsterOrderResult>('POST', '/fapi/v3/order', orderParams);

    return {
      success: true,
      orderId: String(result.orderId),
      status: fromAsterStatus(result.status),
    };
  }

  /** Aster V3 inherits Binance Futures' algo API path
   *  (`/fapi/v3/algo/futures/newOrderTwap`). If Aster renames the action in
   *  a future revision the error surfaces directly rather than silently
   *  falling back. */
  async placeTwapOrder(params: PlaceTwapOrderParams, _signFn: EIP712SignFn): Promise<OrderResult> {
    if (!this.hasCredentials()) {
      return { success: false, orderId: null, error: 'Aster: credentials required' };
    }
    if (!(params.totalSize > 0)) {
      return { success: false, orderId: null, error: 'totalSize must be > 0' };
    }
    if (!(params.durationMinutes > 0)) {
      return { success: false, orderId: null, error: 'durationMinutes must be > 0' };
    }

    const markets = await this.getMarkets();
    const canonical = this.fromApi(this.toApi(params.symbol));
    const market = markets.find((m) => m.symbol === canonical);
    if (!market) {
      return { success: false, orderId: null, error: `Unknown symbol: ${params.symbol}` };
    }
    const roundToStep = (value: number, step: number): number => {
      if (step <= 0) return value;
      const decimals = Math.max(0, Math.round(-Math.log10(step)));
      return Math.round(Math.round(value / step) * step * Math.pow(10, decimals)) / Math.pow(10, decimals);
    };
    const roundedSize = roundToStep(params.totalSize, market.lotSize);

    const body: Record<string, string> = {
      symbol: this.toApi(params.symbol),
      side: toAsterSide(params.side),
      quantity: String(roundedSize),
      duration: String(Math.round(params.durationMinutes * 60)),
    };
    if (params.reduceOnly) body['reduceOnly'] = 'true';

    try {
      const result = await this.signedRequest<{ clientAlgoId?: string; algoId?: string | number }>(
        'POST',
        '/fapi/v3/algo/futures/newOrderTwap',
        body,
      );
      return {
        success: true,
        orderId: result.algoId != null ? String(result.algoId) : result.clientAlgoId ?? null,
      };
    } catch (err) {
      return { success: false, orderId: null, error: err instanceof Error ? err.message : 'TWAP order failed' };
    }
  }

  async placeScaleOrder(params: PlaceScaleOrderParams, signFn: EIP712SignFn): Promise<OrderResult> {
    // 스케일 주문: 균등 분할 limit 주문 순차 제출
    const { startPrice, endPrice, totalSize, totalOrders } = params;
    const step = (endPrice - startPrice) / (totalOrders - 1);
    const sizePerOrder = totalSize / totalOrders;

    let lastResult: OrderResult = { success: false, orderId: null, error: 'no orders placed' };
    for (let i = 0; i < totalOrders; i++) {
      const price = startPrice + step * i;
      lastResult = await this.placeOrder(
        {
          symbol: params.symbol,
          side: params.side,
          type: 'limit',
          size: sizePerOrder,
          price,
          leverage: 1,
          reduceOnly: params.reduceOnly ?? false,
          timeInForce: params.timeInForce ?? 'gtc',
        },
        signFn,
      );
    }
    return lastResult;
  }

  async cancelOrder(params: CancelOrderParams, _signFn: EIP712SignFn): Promise<OrderResult> {
    if (!this.hasCredentials()) {
      throw new Error('Aster: credentials required');
    }

    const result = await this.signedRequest<AsterOrderResult>('DELETE', '/fapi/v3/order', {
      symbol: this.toApi(params.symbol),
      orderId: params.orderId,
    });

    return {
      success: true,
      orderId: String(result.orderId),
      status: fromAsterStatus(result.status),
    };
  }

  async modifyOrder(_params: ModifyOrderParams, _signFn: EIP712SignFn): Promise<OrderResult> {
    // Aster V3 doesn't expose an atomic order-modify endpoint (no PUT /fapi/v3/order
    // in the official spec). Binance Futures의 modify 엔드포인트와 달리 Aster에는
    // 해당 경로가 아예 없어서 400/404로 떨어진다. cancel+replace 패턴은 체결 갭
    // 구간에서 원본 주문이 부분 체결되면 신규 주문과 합쳐져 의도치 않은 포지션이
    // 생길 수 있으므로 UI 레벨에서 사용자가 명시적으로 cancel → place 하도록
    // 강제한다.
    throw new ValidationError('Aster does not support atomic order modification. Cancel the order and place a new one.');
  }

  async updateLeverage(params: UpdateLeverageParams, _signFn: EIP712SignFn): Promise<void> {
    if (!this.hasCredentials()) {
      throw new Error('Aster: credentials required');
    }

    await this.signedRequest('POST', '/fapi/v3/leverage', {
      symbol: this.toApi(params.symbol),
      leverage: String(params.leverage),
    });
  }

  // ── Transfers (MVP: 지원 안 함) ──

  async deposit(_params: DepositParams, _signFn: EIP712SignFn): Promise<string> {
    throw new ValidationError('Deposit/withdraw via Aster dashboard only');
  }

  async withdraw(_params: WithdrawParams, _signFn: EIP712SignFn): Promise<string> {
    throw new ValidationError('Deposit/withdraw via Aster dashboard only');
  }

  // ── WebSocket (MVP: 미구현) ──
  //
  // Aster WebSocket(wss://fstream.asterdex.com) 통합은 아직 미구현. React
  // 쪽 realtime 훅은 DEX 선택과 무관하게 mount 시 subscribe를 호출하므로
  // throw하면 전체 화면이 에러 바운더리에 잡힌다. Pacifica와 동일하게
  // no-op unsubscribe를 돌려주고 REST 폴링에 의존한다.

  subscribe(_channel: WsChannel, _callback: (msg: WsMessage) => void): Unsubscribe {
    return () => { /* no-op */ };
  }

  disconnect(): void {
    // 연결 없음 — noop
  }
}
