/**
 * PacificaPerpAdapter — Pacifica perp 거래 어댑터
 *
 * Pacifica REST API (https://api.pacifica.fi/api/v1):
 * - GET /info          — 마켓 스펙 (symbol, max_leverage, tick_size, lot_size 등)
 * - GET /info/prices   — mark/mid/oracle price, funding rate, 24h volume, OI
 * - GET /book          — bids/asks orderbook
 * - GET /trades        — 최근 거래 내역
 * - GET /account       — 계정 잔고/마진 (Solana address)
 * - GET /positions     — 오픈 포지션 (Solana address)
 * - GET /orders        — 주문 조회 (open/history)
 * - GET /trades/account — 유저 체결 내역
 *
 * WebSocket (wss://ws.pacifica.fi/ws):
 * - prices, book, trades (public)
 * - account_positions, account_order_updates, account_info (private)
 *
 * 쓰기 작업(주문, 취소 등)은 Ed25519 서명 기반 (signing/pacifica-signer.ts).
 * Candles 엔드포인트는 Pacifica REST API에 존재하지 않음.
 */

import { PerpAdapterBase } from '../PerpAdapterBase';
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
  OrderSide,
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
  TimeInForce,
} from '../types';
import { createLogger } from '@hq/core/logging';
import {
  signPacificaRequest,
  ed25519Sign,
} from '../signing/pacifica-signer';
import type { PacificaOperationType } from '../signing/pacifica-signer';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const logger = createLogger('perp:pacifica');

// ============================================================
// Pacifica API Constants
// ============================================================

const PACIFICA_API_URL = 'https://api.pacifica.fi/api/v1';
const PACIFICA_WS_URL = 'wss://ws.pacifica.fi/ws';

/** Ping interval to keep WS alive (server closes after 60s without ping) */
const WS_PING_INTERVAL_MS = 30_000;

/** CandleInterval → Pacifica /kline interval param */
const PACIFICA_INTERVAL_MAP: Record<CandleInterval, string> = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '12h': '12h',
  '1d': '1d', '1w': '1d', '1M': '1d',
};

/** Interval → milliseconds (for calculating start_time from limit) */
const INTERVAL_MS: Record<CandleInterval, number> = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '6h': 21_600_000, '12h': 43_200_000,
  '1d': 86_400_000, '1w': 604_800_000, '1M': 2_592_000_000,
};
const WS_RECONNECT_DELAY_MS = 3_000;

// ============================================================
// Pacifica Raw API Types (internal)
// ============================================================

/** All Pacifica REST responses are wrapped in this envelope */
interface PacificaEnvelope<T> {
  readonly success: boolean;
  readonly data: T;
  readonly error: string | null;
  readonly code: number | null;
}

interface PacificaMarketInfo {
  readonly symbol: string;
  readonly tick_size: string;
  readonly lot_size: string;
  readonly max_leverage: number;
  readonly min_order_size: string;
  readonly max_order_size: string;
  readonly funding_rate: string;
  readonly next_funding_rate: string;
  readonly created_at: number;
  readonly instrument_type: string;
  readonly base_asset: string;
  readonly isolated_only: boolean;
}

interface PacificaPrice {
  readonly symbol: string;
  readonly mark: string;
  readonly mid: string;
  readonly oracle: string;
  readonly funding: string;
  readonly open_interest: string;
  readonly volume_24h: string;
  readonly yesterday_price: string;
  readonly timestamp: number;
}

interface PacificaBookLevel {
  readonly p: string;
  readonly a: string;
  readonly n: number;
}

interface PacificaBookResponse {
  readonly s: string;
  readonly l: readonly [readonly PacificaBookLevel[], readonly PacificaBookLevel[]];
  readonly t: number;
}

interface PacificaTradeRaw {
  readonly event_type: string;
  readonly price: string;
  readonly amount: string;
  readonly side: string;
  readonly cause: string;
  readonly created_at: number;
}

/** Actual Pacifica /account API response shape */
interface PacificaAccountRaw {
  readonly balance: string;
  readonly account_equity: string;
  readonly available_to_spend: string;
  readonly available_to_withdraw: string;
  readonly total_margin_used: string;
  readonly cross_mmr: string;
  readonly positions_count: number;
  readonly orders_count: number;
  readonly fee_level: number;
  readonly maker_fee: string;
  readonly taker_fee: string;
}

/** Actual Pacifica /positions API response shape */
interface PacificaPositionRaw {
  readonly symbol: string;
  readonly side: string;        // "ask" = short, "bid" = long
  readonly amount: string;      // position size
  readonly entry_price: string;
  readonly margin: string;      // "0" for cross
  readonly funding: string;     // accumulated funding
  readonly isolated: boolean;
  readonly liquidation_price: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

// Shape observed from live `/orders` REST. Fields we used to assume
// (`size`, `filled_size`, `type`, `status`, `leverage`, `time_in_force`,
// `trigger_price`, `tp_price`, `sl_price`) aren't actually returned — the
// API uses `initial_amount` / `filled_amount` / `order_type` / etc., with
// no explicit status field. Status is derived from the amount fields.
interface PacificaOrderRaw {
  readonly order_id: number;
  readonly client_order_id: string | null;
  readonly symbol: string;
  readonly side: string;                      // "bid" | "ask"
  readonly order_type: string;                // "limit" | "market" | ...
  readonly price: string | null;
  readonly initial_amount: string;
  readonly filled_amount: string;
  readonly cancelled_amount: string;
  readonly stop_price: string | null;
  readonly stop_parent_order_id: string | null;
  readonly trigger_price_type: string | null;
  readonly reduce_only: boolean;
  readonly instrument_type: string;
  readonly created_at: number;
  readonly updated_at: number;
}

interface PacificaFillRaw {
  readonly id: string;
  readonly order_id: string;
  readonly symbol: string;
  readonly side: string;
  readonly price: string;
  readonly size: string;
  readonly fee: string;
  readonly fee_token: string;
  readonly created_at: number;
  readonly liquidation: boolean;
  readonly closed_pnl: string;
}

// ============================================================
// Pacifica WebSocket User-Data Raw Types (internal)
// Single-letter keys are Pacifica's compact wire format.
// ============================================================

/** account_info WS frame data — raw compact keys */
interface PacificaWsAccountInfo {
  readonly ae: string;   // accountEquity
  readonly as: string;   // availableToSpend
  readonly aw: string;   // availableToWithdraw
  readonly b: string;    // balance
  readonly mu: string;   // totalMarginUsed
}

/** account_positions WS frame data element — raw compact keys */
interface PacificaWsPosition {
  readonly s: string;    // symbol
  readonly d: string;    // side: "bid"=long, "ask"=short
  readonly a: string;    // size (absolute, decimal string)
  readonly p: string;    // entryPrice
  readonly m: string;    // margin
  readonly f: string;    // fundingFee accumulated
  readonly i: boolean;   // isolated
  readonly l: string | null;  // liquidationPrice
}

/** account_order_updates WS frame data element — raw compact keys */
interface PacificaWsOrder {
  readonly i: number;    // orderId (int)
  readonly s: string;    // symbol
  readonly d: string;    // side: "bid"/"ask"
  readonly p: string;    // avgFilledPrice
  readonly ip: string;   // initialPrice
  readonly lp: string | null; // limitPrice
  readonly a: string;    // originalAmount
  readonly f: string;    // filledAmount
  readonly oe: string;   // orderEvent
  readonly os: string;   // orderStatus: open|partially_filled|filled|cancelled|rejected
  readonly ot: string;   // orderType: limit|market
  readonly sp: string | null; // stopPrice
  readonly r: boolean;   // reduceOnly
  readonly ct: number;   // createdAt
  readonly ut: number;   // updatedAt
}

/** account_trades WS frame data element — raw compact keys */
interface PacificaWsFill {
  readonly h: string;    // historyId (unique fill id)
  readonly i: number;    // orderId
  readonly s: string;    // symbol
  readonly p: string;    // currentPrice (fill price)
  readonly o: string;    // entryPrice
  readonly a: string;    // amount
  readonly te: string;   // role: fulfill_maker|fulfill_taker
  readonly ts: string;   // side
  readonly f: string;    // fee
  readonly n: string;    // pnl
  readonly t: number;    // timestamp
}

// ============================================================
// Pacifica POST Response Types (internal)
// ============================================================

interface PacificaOrderResponse {
  readonly order_id: string | null;
  readonly status: string;
}

// ============================================================
// Helpers
// ============================================================

/** OrderSide → Pacifica API side string.
 *  Pacifica uses orderbook terminology: bid = long, ask = short.
 *  Sending "buy"/"sell" triggers: `Invalid side. Expected 'bid' or 'ask'`. */
function orderSideToApi(side: OrderSide): 'bid' | 'ask' {
  return side === 'long' ? 'bid' : 'ask';
}

/** TimeInForce → Pacifica API TIF string */
function tifToApi(tif: TimeInForce): 'GTC' | 'IOC' | 'ALO' {
  if (tif === 'ioc') return 'IOC';
  if (tif === 'alo') return 'ALO';
  return 'GTC';
}

/** Pacifica trade side → OrderSide */
function toOrderSide(side: string): OrderSide {
  // side values: "open_long", "close_long", "open_short", "close_short"
  return side.includes('long') ? 'long' : 'short';
}

/** Parse Pacifica order side ("long"/"short"/"buy"/"sell") → OrderSide */
function parseOrderSide(side: string): OrderSide {
  const s = side.toLowerCase();
  // Pacifica REST + WS use "bid" / "ask"; keep the "long"/"buy" aliases
  // for any internal callers that haven't been migrated.
  return s === 'long' || s === 'buy' || s === 'bid' ? 'long' : 'short';
}

/** Parse Pacifica order type to our OrderType */
function parseOrderType(type: string): 'market' | 'limit' | 'stop_market' | 'stop_limit' | 'take_market' | 'take_limit' {
  const t = type.toLowerCase();
  if (t === 'market') return 'market';
  if (t === 'stop_market') return 'stop_market';
  if (t === 'stop_limit') return 'stop_limit';
  if (t === 'take_market') return 'take_market';
  if (t === 'take_limit') return 'take_limit';
  return 'limit';
}

/** Parse Pacifica order status to our OrderStatus */
function parseOrderStatus(status: string): 'open' | 'filled' | 'partially_filled' | 'cancelled' | 'rejected' | 'triggered' {
  const s = status.toLowerCase();
  if (s === 'open') return 'open';
  if (s === 'filled') return 'filled';
  if (s === 'partially_filled') return 'partially_filled';
  if (s === 'triggered') return 'triggered';
  if (s.includes('reject')) return 'rejected';
  return 'cancelled';
}

function stepDecimals(step: number): number {
  if (!(step > 0)) return 0;
  const normalized = step.toString().toLowerCase();
  if (normalized.includes('e-')) {
    const [, exponent] = normalized.split('e-');
    return Number(exponent);
  }
  const dotIndex = normalized.indexOf('.');
  return dotIndex === -1 ? 0 : normalized.length - dotIndex - 1;
}

function snapToStep(value: number, step: number, mode: 'floor' | 'nearest'): number {
  if (!(step > 0)) return value;
  const decimals = stepDecimals(step);
  const units = mode === 'floor' ? Math.floor(value / step) : Math.round(value / step);
  return Number((units * step).toFixed(decimals));
}

function formatSteppedValue(value: number, step: number): string {
  const decimals = stepDecimals(step);
  const fixed = value.toFixed(decimals);
  return decimals === 0 ? fixed : fixed.replace(/\.?0+$/, '');
}

/** Parse Pacifica TIF to our TimeInForce */
async function fetchPacifica<T>(path: string): Promise<T> {
  const url = `${PACIFICA_API_URL}${path}`;
  logger.debug(`GET ${url}`);
  const res = await fetch(url);

  // 404 for account endpoints → return null-like signal via throw
  if (res.status === 404) {
    throw new PacificaNotFoundError(url);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pacifica API error ${res.status}: ${text} — ${url}`);
  }

  const envelope = (await res.json()) as PacificaEnvelope<T>;
  if (!envelope.success) {
    throw new Error(`Pacifica API failure: ${envelope.error ?? 'unknown'} (code ${envelope.code})`);
  }
  return envelope.data;
}

class PacificaNotFoundError extends Error {
  constructor(url: string) {
    super(`Pacifica 404: ${url}`);
    this.name = 'PacificaNotFoundError';
  }
}

/** Safe fetch that returns null on 404 (account not found) */
async function fetchPacificaOrNull<T>(path: string): Promise<T | null> {
  try {
    return await fetchPacifica<T>(path);
  } catch (err) {
    if (err instanceof PacificaNotFoundError) return null;
    throw err;
  }
}

// ============================================================
// Adapter Implementation
// ============================================================

export class PacificaPerpAdapter extends PerpAdapterBase {
  readonly protocolId = 'pacifica';
  readonly displayName = 'Pacifica';

  /**
   * Builder code registered with Pacifica.
   * Embedded in the `data` object of every signed order payload so Pacifica
   * attributes the trade volume to us and collects the per-order fee.
   *
   * Builder code 승인은 agent key 설정과 별도 단계다 — agent가 없어도
   * main wallet 서명만으로 사전 승인할 수 있고, 반대로 agent만 등록하고
   * builder code 미승인 상태로도 주문은 나가지만 수수료 귀속이 안 된다.
   */
  static readonly BUILDER_CODE = 'PERPCLI';

  /**
   * Max fee rate sent to Pacifica's approve endpoint.
   * Pacifica expects a decimal fraction string (not percent): '0.001' = 0.1%.
   * 이 값은 per-order 실제 과금액의 상한선이며, 실제 과금은 서버 설정에 따라 더 낮을 수 있다.
   */
  static readonly BUILDER_MAX_FEE_RATE = '0.001';

  private ws: WebSocket | null = null;
  private wsSubscriptions = new Map<string, Set<(msg: WsMessage) => void>>();
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsPingTimer: ReturnType<typeof setInterval> | null = null;
  /** Stores the WsChannel for each key so we can resubscribe on reconnect */
  private wsChannelByKey = new Map<string, WsChannel>();

  /** Solana Ed25519 secret key (64 bytes) — set via setSolanaKey() */
  private solanaSecretKey: Uint8Array | null = null;
  /** Solana public key (Base58 account address) — derived from secretKey */
  private solanaAccount: string | null = null;
  /** External Ed25519 signer — set via setSolanaSigner() (e.g., from Phantom wallet) */
  private externalSignFn: ((message: Uint8Array) => Promise<Uint8Array>) | null = null;
  /** Agent wallet public key (Base58) — set after registerAgentKey(), included in order requests */
  private agentPublicKey: string | null = null;

  constructor(
    private readonly apiUrl: string = PACIFICA_API_URL,
    private readonly wsUrl: string = PACIFICA_WS_URL,
  ) {
    super();
  }

  // ── Solana Key Management ──

  /**
   * Import a Solana keypair for Ed25519 signing.
   * @param secretKeyBase58 — Base58-encoded 64-byte secret key (Solana CLI format)
   */
  setSolanaKey(secretKeyBase58: string): void {
    const decoded = bs58.decode(secretKeyBase58);
    if (decoded.length !== 64) {
      throw new Error(`Invalid Solana secret key length: expected 64 bytes, got ${decoded.length}`);
    }
    this.solanaSecretKey = decoded;
    // Public key is the last 32 bytes of the 64-byte secret key
    const publicKey = decoded.slice(32);
    this.solanaAccount = bs58.encode(publicKey);
    logger.info('Solana keypair imported', { account: this.solanaAccount });
  }

  /**
   * Set an external Solana signer (e.g., Phantom wallet's signMessage).
   * When set, this is used instead of the stored secret key.
   */
  setSolanaSigner(publicKeyBase58: string, signMessage: (message: Uint8Array) => Promise<Uint8Array>): void {
    this.solanaAccount = publicKeyBase58;
    this.externalSignFn = signMessage;
    this.solanaSecretKey = null; // clear stored key when external signer is used
    logger.info('External Solana signer set', { account: publicKeyBase58 });
  }

  /**
   * Install a registered agent key.
   *
   * Critically distinct from `setSolanaKey`: the agent secret is used ONLY for
   * signing — `solanaAccount` stays pointed at the MAIN wallet pubkey so the
   * `account` field of every signed payload identifies the main account, and
   * the separate `agent_wallet` field identifies the agent. If both ended up
   * equal (as happened when we naively reused `setSolanaKey` after
   * registration), Pacifica rejects with `"X is unauthorized to sign on
   * behalf of X"`.
   *
   * Also clears any previously-installed Phantom signer so `signEd25519`
   * falls through to the stored agent key rather than re-prompting the user.
   */
  setAgentKey(agentSecretKeyB58: string, agentPublicKey: string, mainAccount: string): void {
    const decoded = bs58.decode(agentSecretKeyB58);
    if (decoded.length !== 64) {
      throw new Error(`Invalid agent secret key length: expected 64 bytes, got ${decoded.length}`);
    }
    this.solanaSecretKey = decoded;    // agent secret: used to sign every request
    this.solanaAccount = mainAccount;  // payload `account` field — MUST be main
    this.agentPublicKey = agentPublicKey; // payload `agent_wallet` field
    this.externalSignFn = null;        // agent key supersedes Phantom as signer
    logger.info('Pacifica agent key installed', { mainAccount, agent: agentPublicKey });
  }

  /** Clear the Solana signer (on disconnect) */
  clearSolanaSigner(): void {
    this.solanaAccount = null;
    this.externalSignFn = null;
    this.solanaSecretKey = null;
    this.agentPublicKey = null;
  }

  /** Whether a Solana signer is configured (via Phantom or imported key) */
  hasSigner(): boolean {
    return this.solanaAccount !== null;
  }

  /** Get the current Solana account address, or throw if not set. */
  private requireSolanaAccount(): string {
    if (!this.solanaAccount) {
      throw new Error('Solana wallet not connected — connect Phantom or call setSolanaKey()');
    }
    return this.solanaAccount;
  }

  private async getMarketBySymbol(symbol: string): Promise<PerpMarket | null> {
    const markets = await this.getMarkets();
    return markets.find(market => market.symbol === symbol) ?? null;
  }

  /** Ed25519 sign using external signer (Phantom) or stored secret key. */
  private async signEd25519(message: Uint8Array): Promise<Uint8Array> {
    if (this.externalSignFn) {
      return this.externalSignFn(message);
    }
    if (!this.solanaSecretKey) {
      throw new Error('Solana signer not set — connect Phantom or call setSolanaKey()');
    }
    return ed25519Sign(this.solanaSecretKey, message);
  }

  // ── Signed POST Helper ──

  /**
   * Sign a payload and POST to a Pacifica REST endpoint.
   * Includes `builder_code: BUILDER_CODE` in all signed payloads when includeBuilderCode is true.
   */
  private async postSigned<T>(
    path: string,
    operationType: PacificaOperationType,
    payload: Record<string, unknown>,
    includeBuilderCode: boolean = true,
  ): Promise<T> {
    const account = this.requireSolanaAccount();
    const signedPayload: Record<string, unknown> = includeBuilderCode
      ? { ...payload, builder_code: 'PERPCLI' }
      : { ...payload };

    const body = await signPacificaRequest(
      operationType,
      signedPayload,
      account,
      (msg) => this.signEd25519(msg),
    );

    // `agent_wallet` is a session-level routing field (like `account`), NOT
    // part of the signed canonical data. Including it inside the signed
    // payload makes Pacifica's server-side signature reconstruction mismatch
    // and reject with `"Verification failed"`. Inject it on the outbound
    // request body after signing so the server can still route to the
    // registered agent while the signature still matches the original
    // order-instruction canonical message.
    if (this.agentPublicKey) {
      body.agent_wallet = this.agentPublicKey;
    }

    const url = `${this.apiUrl}${path}`;
    logger.debug(`POST ${url}`, { operationType });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Pacifica API error ${res.status}: ${text} — POST ${url}`);
    }

    const envelope = (await res.json()) as PacificaEnvelope<T>;
    if (!envelope.success) {
      throw new Error(`Pacifica API failure: ${envelope.error ?? 'unknown'} (code ${envelope.code})`);
    }
    return envelope.data;
  }

  // ── Market Data ──

  async getMarkets(): Promise<PerpMarket[]> {
    const [markets, prices] = await Promise.all([
      fetchPacifica<PacificaMarketInfo[]>('/info'),
      fetchPacifica<PacificaPrice[]>('/info/prices'),
    ]);

    const priceMap = new Map<string, PacificaPrice>(
      prices.map(p => [p.symbol, p]),
    );

    return markets.map((m): PerpMarket => {
      const price = priceMap.get(m.symbol);
      const markPrice = price ? parseFloat(price.mark) : 0;
      // Pacifica's `/info.min_order_size` is a USD-notional minimum
      // (e.g. "10" means $10 — NOT 10 BTC). HL/Lighter/Aster all report
      // minOrderSize in base-asset units, and `TradingLayout`'s order
      // guard compares the user's base-unit size to it. Convert here so
      // every DEX speaks the same base-unit contract.
      const minNotional = parseFloat(m.min_order_size);
      const minOrderSize = markPrice > 0 ? minNotional / markPrice : minNotional;
      return {
        symbol:          m.symbol,
        name:            `${m.base_asset}-USDC`,
        prevDayPx:       price ? parseFloat(price.yesterday_price) : 0,
        baseAsset:       m.base_asset,
        quoteAsset:      'USDC',
        maxLeverage:     m.max_leverage,
        tickSize:        parseFloat(m.tick_size),
        lotSize:         parseFloat(m.lot_size),
        minOrderSize,
        makerFee:        0,  // not exposed in /info — use getUserFees()
        takerFee:        0,
        fundingRate:     price ? parseFloat(price.funding) : 0,
        openInterest:    price ? parseFloat(price.open_interest) : 0,
        volume24h:       price ? parseFloat(price.volume_24h) : 0,
        markPrice:       price ? parseFloat(price.mark) : 0,
        indexPrice:      price ? parseFloat(price.oracle) : 0,
        category:        'crypto',
        assetType:       'perp',
        dex:             null,
        marketCap:       null,
        contractAddress: null,
      };
    });
  }

  async getOrderbook(symbol: string, _nSigFigs?: number): Promise<Orderbook> {
    const raw = await fetchPacifica<PacificaBookResponse>(
      `/book?symbol=${encodeURIComponent(symbol)}&agg_level=1`,
    );

    const mapLevel = (l: PacificaBookLevel): OrderbookLevel => ({
      price:     parseFloat(l.p),
      size:      parseFloat(l.a),
      numOrders: l.n,
    });

    return {
      symbol:    raw.s,
      bids:      raw.l[0].map(mapLevel),
      asks:      raw.l[1].map(mapLevel),
      timestamp: raw.t,
    };
  }

  async getTrades(symbol: string, _limit?: number): Promise<Trade[]> {
    const raw = await fetchPacifica<PacificaTradeRaw[]>(
      `/trades?symbol=${encodeURIComponent(symbol)}`,
    );

    return raw.map((t, idx) => ({
      id:        `${t.created_at}-${idx}`,
      symbol,
      price:     parseFloat(t.price),
      size:      parseFloat(t.amount),
      side:      toOrderSide(t.side),
      timestamp: t.created_at,
    }));
  }

  async getCandles(
    symbol: string,
    interval: CandleInterval,
    limit = 300,
    endTime: number = Date.now(),
  ): Promise<Candle[]> {
    // Pacifica candle endpoint: /kline (not /candles)
    const pacificaInterval = PACIFICA_INTERVAL_MAP[interval];
    const intervalMs = INTERVAL_MS[interval];
    const startTime = endTime - intervalMs * limit;
    const resp = await fetchPacifica<ReadonlyArray<{
      readonly t: number; readonly T: number; readonly s: string; readonly i: string;
      readonly o: string; readonly c: string; readonly h: string; readonly l: string;
      readonly v: string; readonly n: number;
    }>>(`/kline?symbol=${encodeURIComponent(symbol)}&interval=${pacificaInterval}&start_time=${startTime}&end_time=${endTime}`);
    return resp.map((c): Candle => ({
      timestamp: c.t,
      open: parseFloat(c.o),
      high: parseFloat(c.h),
      low: parseFloat(c.l),
      close: parseFloat(c.c),
      volume: parseFloat(c.v),
    }));
  }

  // ── Fees ──

  async getUserFees(address: string): Promise<UserFeeInfo> {
    const raw = await fetchPacificaOrNull<PacificaAccountRaw>(
      `/account?account=${encodeURIComponent(address)}`,
    );
    const taker = raw ? parseFloat(raw.taker_fee) : 0.0004;
    const maker = raw ? parseFloat(raw.maker_fee) : 0.00015;
    return {
      perpTaker:        taker,
      perpMaker:        maker,
      spotTaker:        taker,
      spotMaker:        maker,
      referralDiscount: 0,
      stakingDiscount:  0,
    };
  }

  // ── HIP-3 ──

  async getPerpDexs(): Promise<PerpDex[]> {
    // Pacifica has no HIP-3 equivalent
    return [];
  }

  // ── Account ──

  async getAccountState(address: string): Promise<PerpAccountState> {
    const raw = await fetchPacificaOrNull<PacificaAccountRaw>(
      `/account?account=${encodeURIComponent(address)}`,
    );

    // 404 or not found → return empty account state
    if (!raw) {
      return {
        address,
        totalEquity: 0,
        totalMarginUsed: 0,
        totalNotional: 0,
        availableBalance: 0,
        unrealizedPnl: 0,
        maintenanceMargin: 0,
        crossMarginSummary: {
          accountValue: 0,
          totalNtlPos: 0,
          totalRawUsd: 0,
        },
      };
    }

    const equity = parseFloat(raw.account_equity);
    const balance = parseFloat(raw.balance);
    const marginUsed = parseFloat(raw.total_margin_used);
    // Pacifica's `available_to_spend` can go negative when positions are
    // underwater (margin_used > equity). Negative values don't make sense
    // for a "funds available to open new orders" UX — clamp to 0. The
    // UI surfaces liquidation risk separately via crossMmr / health.
    const available = Math.max(0, parseFloat(raw.available_to_spend));
    const mmr = parseFloat(raw.cross_mmr);

    return {
      address,
      totalEquity: equity,
      totalMarginUsed: marginUsed,
      totalNotional: marginUsed, // Pacifica doesn't return notional separately
      availableBalance: available,
      unrealizedPnl: equity - balance, // equity - balance = unrealized PnL
      maintenanceMargin: mmr,
      crossMarginSummary: {
        accountValue: equity,
        totalNtlPos: marginUsed,
        totalRawUsd: balance,
      },
    };
  }

  async getPositions(address: string): Promise<PerpPosition[]> {
    const raw = await fetchPacificaOrNull<PacificaPositionRaw[]>(
      `/positions?account=${encodeURIComponent(address)}`,
    );

    if (!raw) return [];

    // Fetch markets to get markPrice for PnL calculation
    let markPriceMap = new Map<string, number>();
    try {
      const markets = await this.getMarkets();
      markPriceMap = new Map(markets.map(m => [m.symbol, m.markPrice]));
    } catch { /* best effort */ }

    return raw.map((p): PerpPosition => {
      const side: OrderSide = p.side === 'bid' ? 'long' : 'short';
      const size = Math.abs(parseFloat(p.amount));
      const entryPrice = parseFloat(p.entry_price);
      const markPrice = markPriceMap.get(p.symbol) ?? entryPrice;
      const margin = parseFloat(p.margin);
      const funding = parseFloat(p.funding);

      // Calculate PnL
      const priceDiff = side === 'long' ? markPrice - entryPrice : entryPrice - markPrice;
      const unrealizedPnl = priceDiff * size;

      // Calculate leverage from notional / margin (or estimate from account)
      const notional = size * markPrice;
      const marginUsed = margin > 0 ? margin : notional * 0.1; // cross margin: estimate 10x
      const leverage = marginUsed > 0 ? Math.round(notional / marginUsed) : 10;
      const roe = marginUsed > 0 ? (unrealizedPnl / marginUsed) * 100 : 0;

      return {
        symbol:           p.symbol,
        side,
        size,
        entryPrice,
        markPrice,
        liquidationPrice: p.liquidation_price ? parseFloat(p.liquidation_price) : null,
        unrealizedPnl,
        realizedPnl:      0, // Pacifica doesn't return realized PnL per position
        leverage,
        leverageType:     p.isolated ? 'isolated' as const : 'cross' as const,
        marginUsed,
        returnOnEquity:   roe,
        fundingPayment:   funding,
      };
    });
  }

  async getOpenOrders(address: string): Promise<PerpOrder[]> {
    const raw = await fetchPacificaOrNull<PacificaOrderRaw[]>(
      `/orders?account=${encodeURIComponent(address)}&status=open`,
    );

    if (!raw) return [];
    return raw.map(mapPacificaOrder);
  }

  async getOrderHistory(address: string, _limit?: number): Promise<PerpOrder[]> {
    const raw = await fetchPacificaOrNull<PacificaOrderRaw[]>(
      `/orders?account=${encodeURIComponent(address)}`,
    );

    if (!raw) return [];
    return raw.map(mapPacificaOrder);
  }

  async getFills(address: string, _limit?: number): Promise<Fill[]> {
    const raw = await fetchPacificaOrNull<PacificaFillRaw[]>(
      `/trades?account=${encodeURIComponent(address)}`,
    );

    if (!raw) return [];

    return raw.map(f => ({
      id:          f.id,
      orderId:     f.order_id,
      symbol:      f.symbol,
      side:        parseOrderSide(f.side),
      price:       parseFloat(f.price),
      size:        parseFloat(f.size),
      fee:         parseFloat(f.fee),
      feeToken:    f.fee_token,
      timestamp:   f.created_at,
      liquidation: f.liquidation,
      closedPnl:   parseFloat(f.closed_pnl),
    }));
  }

  async getFundingHistory(address: string, _startTime?: number): Promise<FundingHistoryEntry[]> {
    // Pacifica: GET /funding/history?account=<addr>&symbol=<sym>
    try {
      const raw = await fetchPacificaOrNull<ReadonlyArray<{
        readonly timestamp: number;
        readonly symbol: string;
        readonly size: string;
        readonly payment: string;
        readonly rate: string;
      }>>(`/funding/history?account=${encodeURIComponent(address)}`);
      if (!raw) return [];
      return raw.map((f): FundingHistoryEntry => ({
        timestamp: f.timestamp,
        symbol: f.symbol,
        size: parseFloat(f.size),
        payment: parseFloat(f.payment),
        rate: parseFloat(f.rate),
      }));
    } catch {
      return [];
    }
  }

  /** Pacifica's shared `fetchPacifica` helper unwraps `{success, data, …}`
   *  for us, so `rows` is already the entries array. Each row uses
   *  `created_at` (ms) and a string `funding_rate`. */
  async getMarketFundingHistory(symbol: string, startTime?: number): Promise<MarketFundingPoint[]> {
    const base = symbol.includes('-') ? symbol.split('-')[0] : symbol;
    try {
      const rows = await fetchPacificaOrNull<ReadonlyArray<{
        readonly created_at: number;
        readonly funding_rate: string;
      }>>(`/funding_rate/history?symbol=${encodeURIComponent(base)}&limit=1000`);
      if (!rows || rows.length === 0) return [];
      const cutoff = startTime ?? Date.now() - 24 * 60 * 60 * 1000;
      return rows
        .map((r) => ({ ts: r.created_at, fundingRate: parseFloat(r.funding_rate) }))
        .filter((p) => p.ts >= cutoff && Number.isFinite(p.fundingRate))
        .sort((a, b) => a.ts - b.ts);
    } catch {
      return [];
    }
  }

  // ============================================================
  // Trading (Ed25519 signed)
  // ============================================================

  async placeOrder(params: PlaceOrderParams, _signFn: EIP712SignFn): Promise<OrderResult> {
    const side = orderSideToApi(params.side);
    const isMarket = params.type === 'market';
    // Pacifica's stop-order endpoint covers both stop and take triggers —
    // direction is inferred from (side, trigger_price). Previously take_*
    // fell through to the plain limit endpoint and executed at mark.
    const isStop = params.type === 'stop_market'
      || params.type === 'stop_limit'
      || params.type === 'take_market'
      || params.type === 'take_limit';
    const isLimitTrigger = params.type === 'stop_limit' || params.type === 'take_limit';

    try {
      const market = await this.getMarketBySymbol(params.symbol);
      if (!market) {
        return { success: false, orderId: null, error: `Unknown symbol: ${params.symbol}` };
      }

      // Size always snaps DOWN to the venue lot size so we never overshoot
      // the user's requested base amount.
      const roundedSize = snapToStep(params.size, market.lotSize, 'floor');
      if (!(roundedSize > 0)) {
        return {
          success: false,
          orderId: null,
          error: `Order size ${params.size} is below Pacifica lot size ${market.lotSize}`,
        };
      }
      const roundedPrice = params.price != null ? snapToStep(params.price, market.tickSize, 'nearest') : null;
      const roundedTriggerPrice = params.triggerPrice != null
        ? snapToStep(params.triggerPrice, market.tickSize, 'nearest')
        : null;

      // Pacifica requires reduce_only on ALL order payloads (non-optional field).
      // Omitting it yields: `Json deserialize error: missing field 'reduce_only'`.
      const reduceOnly = params.reduceOnly ?? false;

      if (isStop) {
        // Stop orders use a dedicated endpoint
        const stopPayload: Record<string, unknown> = {
          symbol: params.symbol,
          side,
          amount: formatSteppedValue(roundedSize, market.lotSize),
          trigger_price: roundedTriggerPrice != null ? formatSteppedValue(roundedTriggerPrice, market.tickSize) : '0',
          reduce_only: reduceOnly,
        };
        if (isLimitTrigger && roundedPrice != null) {
          stopPayload.price = formatSteppedValue(roundedPrice, market.tickSize);
        }

        const result = await this.postSigned<PacificaOrderResponse>(
          '/orders/stop/create',
          'create_stop_order',
          stopPayload,
        );
        return { success: true, orderId: result.order_id ?? null };
      }

      if (isMarket) {
        const marketPayload: Record<string, unknown> = {
          symbol: params.symbol,
          side,
          amount: formatSteppedValue(roundedSize, market.lotSize),
          slippage_percent: String((params.slippageBps ?? 50) / 100),
          reduce_only: reduceOnly,
        };

        const result = await this.postSigned<PacificaOrderResponse>(
          '/orders/create_market',
          'create_market_order',
          marketPayload,
        );
        return { success: true, orderId: result.order_id ?? null };
      }

      // Limit order (including take_market/take_limit which map to limit on Pacifica)
      const limitPayload: Record<string, unknown> = {
        symbol: params.symbol,
        side,
        amount: formatSteppedValue(roundedSize, market.lotSize),
        price: roundedPrice != null ? formatSteppedValue(roundedPrice, market.tickSize) : '0',
        tif: tifToApi(params.timeInForce ?? 'gtc'),
        reduce_only: reduceOnly,
      };

      const result = await this.postSigned<PacificaOrderResponse>(
        '/orders/create',
        'create_order',
        limitPayload,
      );
      return { success: true, orderId: result.order_id ?? null };
    } catch (err) {
      logger.error('placeOrder failed', { err });
      return { success: false, orderId: null, error: err instanceof Error ? err.message : 'Order failed' };
    }
  }

  /**
   * Scale order: split into N limit orders between startPrice and endPrice.
   * Pacifica has no native bulk order API — we submit individual limit orders.
   */
  /** Pacifica has no native TWAP endpoint. UI gates this, but we also fail
   *  loudly here to avoid a silent client-side slicing fallback that would
   *  stop the moment the tab closed. */
  async placeTwapOrder(_params: PlaceTwapOrderParams, _signFn: EIP712SignFn): Promise<OrderResult> {
    return {
      success: false,
      orderId: null,
      error: 'TWAP is not supported on Pacifica (no native endpoint). Use Hyperliquid, Lighter, or Aster for TWAP execution.',
    };
  }

  async placeScaleOrder(params: PlaceScaleOrderParams, _signFn: EIP712SignFn): Promise<OrderResult> {
    const n = Math.max(2, Math.min(20, Math.floor(params.totalOrders)));
    const { startPrice, endPrice, totalSize, sizeSkew } = params;

    if (!(totalSize > 0)) throw new Error('totalSize must be > 0');
    if (!(startPrice > 0) || !(endPrice > 0)) throw new Error('prices must be > 0');
    if (sizeSkew <= 0) throw new Error('sizeSkew must be > 0');

    const market = await this.getMarketBySymbol(params.symbol);
    if (!market) {
      return { success: false, orderId: null, error: `Unknown symbol: ${params.symbol}` };
    }

    // Compute weights and normalize
    const weights: number[] = [];
    let weightSum = 0;
    for (let i = 0; i < n; i++) {
      const ratio = i / (n - 1);
      const w = 1 + (sizeSkew - 1) * ratio;
      weights.push(w);
      weightSum += w;
    }

    const side = orderSideToApi(params.side);
    const tif = tifToApi(params.timeInForce ?? 'gtc');
    let firstOrderId: string | null = null;

    try {
      for (let i = 0; i < n; i++) {
        const priceRatio = i / (n - 1);
        const rawPrice = startPrice + (endPrice - startPrice) * priceRatio;
        const rawSize = (totalSize * weights[i]) / weightSum;
        const price = snapToStep(rawPrice, market.tickSize, 'nearest');
        const size = snapToStep(rawSize, market.lotSize, 'floor');
        if (!(size > 0)) {
          throw new Error(`Scale slice ${i + 1} is below Pacifica lot size ${market.lotSize}`);
        }

        // Pacifica requires `reduce_only` on every order payload (not optional).
        // Omitting when false yields `Json deserialize error: missing field 'reduce_only'`.
        const payload: Record<string, unknown> = {
          symbol: params.symbol,
          side,
          amount: formatSteppedValue(size, market.lotSize),
          price: formatSteppedValue(price, market.tickSize),
          tif,
          reduce_only: params.reduceOnly ?? false,
        };

        const result = await this.postSigned<PacificaOrderResponse>(
          '/orders/create',
          'create_order',
          payload,
        );

        if (i === 0) {
          firstOrderId = result.order_id ?? null;
        }
      }

      return { success: true, orderId: firstOrderId };
    } catch (err) {
      logger.error('placeScaleOrder failed', { err });
      return {
        success: false,
        orderId: firstOrderId,
        error: err instanceof Error ? err.message : 'Scale order failed',
      };
    }
  }

  async cancelOrder(params: CancelOrderParams, _signFn: EIP712SignFn): Promise<OrderResult> {
    try {
      // Pacifica's cancel endpoint deserializes `order_id` via an untagged enum
      // (OrderLocator) that expects a numeric value, not a string. Our orderId
      // is stored as a string (matching the shared CancelOrderParams type), so
      // we coerce to number here before sending.
      const numericOrderId = Number(params.orderId);
      // Cancel does not accept builder_code — exclude it from the signed payload.
      await this.postSigned<Record<string, unknown>>(
        '/orders/cancel',
        'cancel_order',
        {
          symbol: params.symbol,
          order_id: numericOrderId,
        },
        false, // includeBuilderCode
      );
      return { success: true, orderId: params.orderId };
    } catch (err) {
      return {
        success: false,
        orderId: params.orderId,
        error: err instanceof Error ? err.message : 'Cancel failed',
      };
    }
  }

  /**
   * Modify order — Pacifica has no native modify endpoint.
   * Cancel the existing order and re-place with updated params.
   */
  async modifyOrder(params: ModifyOrderParams, signFn: EIP712SignFn): Promise<OrderResult> {
    // Cancel existing order
    const cancelResult = await this.cancelOrder(
      { symbol: params.symbol, orderId: params.orderId },
      signFn,
    );
    if (!cancelResult.success) {
      return { success: false, orderId: params.orderId, error: `Cancel failed: ${cancelResult.error}` };
    }

    // Re-place with updated price/size
    if (params.price === undefined && params.size === undefined) {
      return { success: false, orderId: params.orderId, error: 'Modify requires at least price or size' };
    }

    const placeResult = await this.placeOrder(
      {
        symbol: params.symbol,
        side: params.side,
        type: params.triggerPrice !== undefined ? 'stop_limit' : 'limit',
        size: params.size ?? 0,
        price: params.price,
        leverage: 1,  // leverage is managed separately on Pacifica
        triggerPrice: params.triggerPrice,
      },
      signFn,
    );

    return placeResult;
  }

  async updateLeverage(params: UpdateLeverageParams, _signFn: EIP712SignFn): Promise<void> {
    // Pacifica splits leverage value and margin mode into two separate endpoints:
    // POST /account/leverage — sets the leverage multiplier
    // POST /account/margin  — switches isolated vs cross margin mode
    await this.postSigned<Record<string, unknown>>(
      '/account/leverage',
      'update_leverage',
      {
        symbol: params.symbol,
        leverage: Math.round(params.leverage),
      },
      false,
    );
    await this.postSigned<Record<string, unknown>>(
      '/account/margin',
      'update_margin_mode',
      {
        symbol: params.symbol,
        is_isolated: params.marginMode === 'isolated',
      },
      false,
    );
  }

  // ============================================================
  // WebSocket
  // ============================================================

  subscribe(channel: WsChannel, callback: (msg: WsMessage) => void): Unsubscribe {
    // HL-specific channels that have no Pacifica equivalent → no-op
    if (!this.isSupportedChannel(channel)) {
      logger.debug(`subscribe: channel type '${channel.type}' not supported on Pacifica`);
      return () => { /* no-op */ };
    }

    this.ensureWsConnection();
    const key = this.channelKey(channel);

    if (!this.wsSubscriptions.has(key)) {
      this.wsSubscriptions.set(key, new Set());
      this.wsChannelByKey.set(key, channel);
      this.wsSendSubscribe(channel);
    }

    this.wsSubscriptions.get(key)!.add(callback);

    return () => {
      const subs = this.wsSubscriptions.get(key);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.wsSubscriptions.delete(key);
          this.wsChannelByKey.delete(key);
          this.wsSendUnsubscribe(channel);
        }
      }
    };
  }

  disconnect(): void {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.wsPingTimer) {
      clearInterval(this.wsPingTimer);
      this.wsPingTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.wsSubscriptions.clear();
    this.wsChannelByKey.clear();
  }

  private isSupportedChannel(channel: WsChannel): boolean {
    switch (channel.type) {
      case 'orderbook':
      case 'trades':
      case 'candles':
      case 'allMids':
      case 'pacificaAccountInfo':
      case 'pacificaAccountPositions':
      case 'pacificaAccountOrders':
      case 'pacificaAccountFills':
        return true;
      default:
        // HL-specific channels: ticker, webData3, activeAssetCtx,
        // activeAssetData, allDexsAssetCtxs, spotAssetCtxs, allDexsClearinghouseState,
        // openOrdersLive, userFillsLive, spotState, userHistoricalOrdersLive,
        // userFundingsLive — not available on Pacifica
        return false;
    }
  }

  private ensureWsConnection(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;

    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      logger.info('Pacifica WebSocket connected');

      // Start ping timer to keep connection alive
      this.startPingTimer();

      // 재연결 시 기존 구독 복원
      for (const [, channel] of this.wsChannelByKey) {
        this.wsSendSubscribe(channel);
      }
    };

    this.ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return; // skip binary frames
      try {
        const data = JSON.parse(event.data);
        // Skip non-channel messages (pong, error, etc.)
        if (!data || typeof data !== 'object' || !data.channel) return;
        this.handleWsMessage(data as Record<string, unknown>);
      } catch (e) {
        logger.warn('Failed to parse Pacifica WS message', { error: String(e) });
      }
    };

    this.ws.onclose = () => {
      logger.info('Pacifica WebSocket closed, reconnecting in 3s');
      this.stopPingTimer();
      this.wsReconnectTimer = setTimeout(() => this.ensureWsConnection(), WS_RECONNECT_DELAY_MS);
    };

    this.ws.onerror = (err) => {
      logger.error('Pacifica WebSocket error', { err });
    };
  }

  private startPingTimer(): void {
    this.stopPingTimer();
    this.wsPingTimer = setInterval(() => {
      this.wsSend({ method: 'ping' });
    }, WS_PING_INTERVAL_MS);
  }

  private stopPingTimer(): void {
    if (this.wsPingTimer) {
      clearInterval(this.wsPingTimer);
      this.wsPingTimer = null;
    }
  }

  private wsSend(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private wsSendSubscribe(channel: WsChannel): void {
    const params = this.buildWsParams(channel);
    if (params) {
      this.wsSend({ method: 'subscribe', params });
    }
  }

  private wsSendUnsubscribe(channel: WsChannel): void {
    const params = this.buildWsParams(channel);
    if (params) {
      this.wsSend({ method: 'unsubscribe', params });
    }
  }

  /** Build Pacifica WS subscription params from our WsChannel type */
  private buildWsParams(channel: WsChannel): Record<string, unknown> | null {
    switch (channel.type) {
      case 'orderbook':
        return { source: 'book', symbol: channel.symbol, agg_level: 1 };
      case 'trades':
        return { source: 'trades', symbol: channel.symbol };
      case 'candles':
        return { source: 'candle', symbol: channel.symbol, interval: channel.interval };
      case 'allMids':
        return { source: 'prices' };
      case 'pacificaAccountInfo':
        return { source: 'account_info', account: channel.address };
      case 'pacificaAccountPositions':
        return { source: 'account_positions', account: channel.address };
      case 'pacificaAccountOrders':
        return { source: 'account_order_updates', account: channel.address };
      case 'pacificaAccountFills':
        return { source: 'account_trades', account: channel.address };
      default:
        return null;
    }
  }

  /** Internal subscription key — unique per logical channel */
  private channelKey(channel: WsChannel): string {
    switch (channel.type) {
      case 'orderbook': return `book:${channel.symbol}`;
      case 'trades': return `trades:${channel.symbol}`;
      case 'candles': return `candle:${channel.symbol}:${channel.interval}`;
      case 'allMids': return 'prices';
      case 'pacificaAccountInfo': return `account_info:${channel.address}`;
      case 'pacificaAccountPositions': return `account_positions:${channel.address}`;
      case 'pacificaAccountOrders': return `account_order_updates:${channel.address}`;
      case 'pacificaAccountFills': return `account_trades:${channel.address}`;
      default: return `unsupported:${channel.type}`;
    }
  }

  private handleWsMessage(data: Record<string, unknown>): void {
    // Pacifica WS messages use `channel` field (not `source`).
    // `channel: "subscribe"` = subscription confirmation → skip.
    const channel = data.channel as string | undefined;
    if (!channel || channel === 'subscribe') return;

    const payload = data.data;
    if (payload === undefined || payload === null) return;

    // Map Pacifica channel name → our internal channel key prefix
    let matchKey: string;
    switch (channel) {
      case 'book':
        matchKey = 'book:';
        break;
      case 'trades':
        matchKey = 'trades:';
        break;
      case 'candle':
        matchKey = 'candle:';
        break;
      case 'prices':
        matchKey = 'prices';
        break;
      case 'account_info':
        matchKey = 'account_info:';
        break;
      case 'account_positions':
        matchKey = 'account_positions:';
        break;
      case 'account_order_updates':
        matchKey = 'account_order_updates:';
        break;
      case 'account_trades':
        matchKey = 'account_trades:';
        break;
      default:
        return;
    }

    for (const [key, callbacks] of this.wsSubscriptions) {
      if (key === matchKey || key.startsWith(matchKey)) {
        // For user-data channels, extract the address from the key and pass
        // it along so parseWsPayload can build a properly-keyed WsMessage.
        const address = key.includes(':') ? key.split(':').slice(1).join(':') : '';
        const msg = this.parseWsPayload(channel, payload, address);
        if (msg) {
          for (const cb of callbacks) cb(msg);
        }
      }
    }
  }

  private parseWsPayload(channel: string, data: unknown, address: string = ''): WsMessage | null {
    switch (channel) {
      case 'book': {
        const d = data as PacificaBookResponse;
        const mapLevel = (l: PacificaBookLevel): OrderbookLevel => ({
          price: parseFloat(l.p),
          size: parseFloat(l.a),
          numOrders: l.n,
        });
        const orderbook: Orderbook = {
          symbol: d.s,
          bids: d.l[0].map(mapLevel),
          asks: d.l[1].map(mapLevel),
          timestamp: d.t,
        };
        return { channel: 'orderbook', data: orderbook };
      }
      case 'trades': {
        // WS trades use compact fields: { h, s, p, a, d, tc, t, li }
        // Different from REST: { event_type, price, amount, side, cause, created_at }
        const raw = data as ReadonlyArray<{ h: number; s: string; p: string; a: string; d: string; tc: string; t: number; li: number }>;
        if (!Array.isArray(raw)) return null;
        const trades: Trade[] = raw.map((t, idx) => ({
          id: `${t.h || t.t}-${idx}`,
          symbol: t.s,
          price: parseFloat(t.p),
          size: parseFloat(t.a),
          side: toOrderSide(t.d),
          timestamp: t.t,
        }));
        return { channel: 'trades', data: trades };
      }
      case 'candle': {
        // Pacifica WS candle shape: { t, T, s, i, o, c, h, l, v, n }
        const d = data as { t: number; T: number; s: string; i: string; o: string; c: string; h: string; l: string; v: string; n: number };
        const candle: Candle = {
          timestamp: d.t,
          open: parseFloat(d.o),
          high: parseFloat(d.h),
          low: parseFloat(d.l),
          close: parseFloat(d.c),
          volume: parseFloat(d.v),
        };
        return { channel: 'candles', data: [candle] };
      }
      case 'prices': {
        const raw = data as PacificaPrice[];
        if (!Array.isArray(raw)) return null;
        const mids: Record<string, number> = {};
        for (const p of raw) {
          mids[p.symbol] = parseFloat(p.mid);
        }
        return { channel: 'allMids', data: { dex: null, mids } };
      }

      case 'account_info': {
        const d = data as PacificaWsAccountInfo;
        const equity = parseFloat(d.ae);
        const balance = parseFloat(d.b);
        const marginUsed = parseFloat(d.mu);
        const available = Math.max(0, parseFloat(d.as));
        const accountState: PerpAccountState = {
          address,
          totalEquity: equity,
          totalMarginUsed: marginUsed,
          totalNotional: marginUsed,
          availableBalance: available,
          unrealizedPnl: equity - balance,
          maintenanceMargin: 0,
          crossMarginSummary: {
            accountValue: equity,
            totalNtlPos: marginUsed,
            totalRawUsd: balance,
          },
        };
        return { channel: 'pacificaAccountInfo', data: accountState };
      }

      case 'account_positions': {
        const raw = data as PacificaWsPosition[];
        if (!Array.isArray(raw)) return null;
        const positions: PerpPosition[] = raw.map((p): PerpPosition => {
          const side: OrderSide = p.d === 'bid' ? 'long' : 'short';
          const size = Math.abs(parseFloat(p.a));
          const entryPrice = parseFloat(p.p);
          // Pacifica WS does not push markPrice — use entryPrice as placeholder.
          // The markets allMids WS channel streams real mark prices into the
          // markets cache; UI components merge when rendering the position row.
          const markPrice = entryPrice;
          const margin = parseFloat(p.m);
          const funding = parseFloat(p.f);
          const notional = size * markPrice;
          const marginUsed = margin > 0 ? margin : notional * 0.1;
          const leverage = marginUsed > 0 ? Math.round(notional / marginUsed) : 10;
          // unrealizedPnl is 0 because WS doesn't push markPrice.
          // The REST periodic poll fills it on the next /info refetch.
          const unrealizedPnl = 0;
          const roe = 0;
          return {
            symbol:           p.s,
            side,
            size,
            entryPrice,
            markPrice,
            liquidationPrice: p.l ? parseFloat(p.l) : null,
            unrealizedPnl,
            realizedPnl:      0,
            leverage,
            leverageType:     p.i ? 'isolated' as const : 'cross' as const,
            marginUsed,
            returnOnEquity:   roe,
            fundingPayment:   funding,
          };
        });
        return { channel: 'pacificaAccountPositions', data: positions };
      }

      case 'account_order_updates': {
        const raw = data as PacificaWsOrder[];
        if (!Array.isArray(raw)) return null;
        const orders: PerpOrder[] = raw.map((o): PerpOrder => ({
          orderId:      String(o.i),
          symbol:       o.s,
          side:         o.d === 'bid' ? 'long' : 'short',
          type:         parseOrderType(o.ot),
          price:        o.lp ? parseFloat(o.lp) : (o.ip ? parseFloat(o.ip) : null),
          size:         parseFloat(o.a),
          filledSize:   parseFloat(o.f),
          status:       parseOrderStatus(o.os),
          leverage:     1,
          reduceOnly:   o.r,
          timeInForce:  'gtc',
          triggerPrice: o.sp ? parseFloat(o.sp) : null,
          tpPrice:      null,
          slPrice:      null,
          timestamp:    o.ct,
        }));
        return { channel: 'pacificaAccountOrders', data: orders };
      }

      case 'account_trades': {
        const raw = data as PacificaWsFill[];
        if (!Array.isArray(raw)) return null;
        const fills: Fill[] = raw.map((f): Fill => ({
          id:          f.h,
          orderId:     String(f.i),
          symbol:      f.s,
          side:        parseOrderSide(f.ts),
          price:       parseFloat(f.p),
          size:        parseFloat(f.a),
          fee:         parseFloat(f.f),
          feeToken:    'USDC',
          timestamp:   f.t,
          liquidation: false,
          closedPnl:   parseFloat(f.n),
        }));
        return { channel: 'pacificaAccountFills', data: fills };
      }

      default:
        return null;
    }
  }

  // ── Transfers ──

  async deposit(_params: DepositParams, _signFn: EIP712SignFn): Promise<string> {
    // Pacifica deposits are Solana on-chain USDC transfers to the Pacifica vault.
    // Not supported via REST API — use Solana wallet UI or Relay Bridge.
    throw new Error('Pacifica deposits require Solana on-chain USDC transfer — use Relay Bridge');
  }

  async withdraw(_params: WithdrawParams, _signFn: EIP712SignFn): Promise<string> {
    // POST /account/withdraw with { amount, dest_address } — Ed25519 signed
    const result = await this.postSigned<{ success: boolean; data: unknown }>(
      '/account/withdraw',
      'withdraw',
      { amount: String(_params.amount), dest_address: _params.toAddress },
    );
    return result.success ? 'Withdrawal submitted' : 'Withdrawal failed';
  }

  // ── Builder Code Approval ──

  /**
   * Approve our builder code on Pacifica so per-order fees are attributed to us.
   *
   * Builder code 승인은 agent key 등록과 분리된 독립 단계다:
   * - agent key 없이도 main wallet으로 미리 승인 가능
   * - 승인하지 않으면 주문은 나가지만 builder fee 귀속이 안 됨
   * - 재승인은 언제든 가능 (max_fee_rate 낮춰도 OK)
   *
   * Signing flow: main wallet Ed25519 서명 (not agent key).
   * Pacifica doc: POST /api/v1/account/builder_codes/approve
   * Data signed: { type, timestamp, expiry_window, data: { builder_code, max_fee_rate } }
   * Request body: { account, signature, timestamp, expiry_window, builder_code, max_fee_rate, agent_wallet: null }
   *
   * @param mainAccount — Base58 Solana public key of the main wallet
   * @param mainSignMessage — Ed25519 signMessage from the main wallet (e.g. Phantom)
   */
  async approveBuilderCode(
    mainAccount: string,
    mainSignMessage: (message: Uint8Array) => Promise<Uint8Array>,
  ): Promise<void> {
    const payload = {
      builder_code: PacificaPerpAdapter.BUILDER_CODE,
      max_fee_rate: PacificaPerpAdapter.BUILDER_MAX_FEE_RATE,
    };

    // main wallet으로 서명 (agent key가 아님) — agent_wallet: null 포함.
    // Phantom 팝업 승인을 기다리는 동안 timestamp가 만료되지 않도록
    // expiry_window를 30 s로 넓힌다 (bind_agent_wallet과 동일 이유).
    const body = await signPacificaRequest(
      'approve_builder_code',
      payload,
      mainAccount,
      mainSignMessage,
      30_000,
    );

    // Pacifica doc에 따르면 agent_wallet 필드는 null로 명시해야 한다
    const requestBody = { ...body, agent_wallet: null };

    const url = `${this.apiUrl}/account/builder_codes/approve`;
    logger.info('Approving builder code', { builderCode: PacificaPerpAdapter.BUILDER_CODE });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Builder code approval failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as PacificaEnvelope<unknown>;
    if (!json.success) {
      throw new Error(`Builder code approval failed: ${json.error ?? 'Unknown'}`);
    }

    logger.info('Builder code approved', { builderCode: PacificaPerpAdapter.BUILDER_CODE });
  }

  /**
   * Fetch all builder code approvals for an account.
   * Returns [] when the account has no approvals or on a 404.
   */
  async getBuilderApprovals(
    account: string,
  ): Promise<Array<{ builder_code: string; max_fee_rate: string; updated_at: number }>> {
    const url = `${this.apiUrl}/account/builder_codes/approvals?account=${encodeURIComponent(account)}`;
    const res = await fetch(url);
    if (res.status === 404) return [];
    if (!res.ok) {
      throw new Error(`getBuilderApprovals failed (${res.status}): ${url}`);
    }
    const json = await res.json() as
      | Array<{ builder_code: string; max_fee_rate: string; updated_at: number }>
      | null;
    return json ?? [];
  }

  /**
   * True iff the account has approved PERPCLI with max_fee_rate ≥ 0.001.
   * Convenience wrapper over getBuilderApprovals — used by the UI to decide
   * whether to show the "Approve Builder Fee" button.
   */
  async hasBuilderApproval(account: string): Promise<boolean> {
    const approvals = await this.getBuilderApprovals(account);
    return approvals.some(
      (a) =>
        a.builder_code === PacificaPerpAdapter.BUILDER_CODE &&
        parseFloat(a.max_fee_rate) >= parseFloat(PacificaPerpAdapter.BUILDER_MAX_FEE_RATE),
    );
  }

  // ── Agent Key Registration ──

  /**
   * Register a new agent wallet for Pacifica.
   * Generates a new Solana Ed25519 keypair and binds it via POST /agent/bind.
   * Requires the main wallet's signMessage (from Phantom) for authorization.
   *
   * @param mainAccountBase58 — Solana public key of the main wallet (Base58)
   * @param mainSignMessage — signMessage function from the main wallet (e.g. Phantom)
   * @returns generated agent keypair (public + private, both Base58)
   */
  async registerAgentKey(
    mainAccountBase58: string,
    mainSignMessage: (message: Uint8Array) => Promise<Uint8Array>,
  ): Promise<{ agentPublicKey: string; agentPrivateKeyBase58: string }> {
    // 1. Generate new Ed25519 keypair
    const keypair = nacl.sign.keyPair();
    const agentPublicKey = bs58.encode(keypair.publicKey);
    const agentPrivateKeyBase58 = bs58.encode(keypair.secretKey);

    // 2. Sign bind request with MAIN wallet.
    //
    // `timestamp` is stamped BEFORE Phantom's signMessage popup appears, so
    // the expiry_window must cover the user's approval latency + network
    // round-trip. The default 5 s inside signPacificaRequest is safe for
    // pre-signed agent calls but not for Phantom-gated ones — if the user
    // spends 6 s reading the modal, the message is already "expired" when
    // it hits `/agent/bind` and the server rejects with
    // `{"error":"Verification failed"}`. 30 s is Pacifica's documented
    // upper bound for a fresh signing request and matches what they use
    // for their own frontend wallet-binding flow.
    const body = await signPacificaRequest(
      'bind_agent_wallet',
      { agent_wallet: agentPublicKey },
      mainAccountBase58,
      mainSignMessage,
      30_000,
    );

    // 3. POST /agent/bind
    const url = `${this.apiUrl}/agent/bind`;
    logger.info('Registering agent wallet', { agent: agentPublicKey });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Agent bind failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as PacificaEnvelope<unknown>;
    if (!json.success) {
      throw new Error(`Agent bind failed: ${json.error ?? 'Unknown'}`);
    }

    // 4. Install the agent key. `setAgentKey` (not `setSolanaKey`) keeps
    //    `solanaAccount` pointed at the main wallet so subsequent orders send
    //    `{account: main, agent_wallet: agent}` rather than `account == agent`.
    this.setAgentKey(agentPrivateKeyBase58, agentPublicKey, mainAccountBase58);

    logger.info('Agent wallet registered', { agent: agentPublicKey });
    return { agentPublicKey, agentPrivateKeyBase58 };
  }
}

// ============================================================
// Shared mapper (module-level, used by multiple methods)
// ============================================================

function mapPacificaOrder(o: PacificaOrderRaw): PerpOrder {
  const initial = parseFloat(o.initial_amount);
  const filled = parseFloat(o.filled_amount);
  const cancelled = parseFloat(o.cancelled_amount);
  // Pacifica's REST `/orders` response carries no explicit `status` field;
  // derive from the amount bookkeeping instead. `getOpenOrders` always
  // queries `?status=open`, so in that call path this will resolve to
  // 'open' (or 'partially_filled' for a partially-filled open order).
  const status: PerpOrder['status'] =
    cancelled > 0                ? 'cancelled' :
    filled >= initial && initial > 0 ? 'filled' :
    filled > 0                   ? 'partially_filled' :
                                   'open';
  return {
    orderId:      String(o.order_id),
    symbol:       o.symbol,
    side:         parseOrderSide(o.side),
    type:         parseOrderType(o.order_type),
    price:        o.price ? parseFloat(o.price) : null,
    size:         initial,
    filledSize:   filled,
    status,
    // Leverage + TIF + TP/SL aren't exposed on the `/orders` response.
    // Leverage 0 signals "unknown" to callers that display it; TIF falls
    // back to 'gtc' (the default for Pacifica limit orders).
    leverage:     0,
    reduceOnly:   o.reduce_only,
    timeInForce:  'gtc',
    triggerPrice: o.stop_price ? parseFloat(o.stop_price) : null,
    tpPrice:      null,
    slPrice:      null,
    timestamp:    o.created_at,
  };
}
