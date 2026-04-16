/**
 * LighterPerpAdapter — zkLighter perp adapter (read + WebSocket + WASM trading)
 *
 * Lighter API 구조:
 * - Base URL: https://mainnet.zklighter.elliot.ai
 * - GET /api/v1/orderBooks?filter=perp        — market metadata (basic)
 * - GET /api/v1/orderBookDetails?filter=perp   — rich market data (price, volume, OI, margins)
 * - GET /api/v1/funding-rates                  — current funding rates
 * - GET /api/v1/orderBookOrders?market_id=N    — orderbook levels
 * - GET /api/v1/recentTrades?market_id=N       — recent trades
 * - GET /api/v1/candles?market_id=N            — OHLCV candles
 * - GET /api/v1/account?by=l1_address&value=X  — account info (public, no auth)
 *
 * WebSocket: wss://mainnet.zklighter.elliot.ai/stream
 * - Public channels: order_book/{id}, trade/{id}, market_stats/{id|all}, ticker/{id}
 * - Account channels: account_all/{accountIndex}, user_stats/{accountIndex}
 *
 * 쓰기 작업은 lighter-ts-sdk의 SignerClient(WASM signer 기반)를 사용.
 * setLighterCredentials()로 API key를 설정한 후 placeOrder/cancelOrder 등 사용 가능.
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
  PlaceOrderParams,
  PlaceScaleOrderParams,
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

const logger = createLogger('perp:lighter');

/**
 * Integrator fee: 100 / 1e6 = 0.01% (1 basis point).
 * Applied to both taker and maker orders.
 */
const INTEGRATOR_ACCOUNT_INDEX = 718585;
const INTEGRATOR_FEE = 100; // 100 / 1e6 = 0.01%

/**
 * Type alias for lighter-ts-sdk's SignerClient.
 * The actual class is dynamically imported to avoid loading WASM at module level.
 * Methods return `[txInfo, txHash, error | null]` tuples.
 */
type LighterSignerClient = {
  initialize(): Promise<void>;
  createOrder(params: {
    marketIndex: number;
    clientOrderIndex: number;
    baseAmount: number;
    price: number;
    isAsk: boolean;
    orderType?: number;
    timeInForce?: number;
    reduceOnly?: boolean;
    triggerPrice?: number;
    nonce?: number;
    integratorAccountIndex?: number;
    integratorTakerFee?: number;
    integratorMakerFee?: number;
  }): Promise<[unknown, string, string | null]>;
  createMarketOrder(params: {
    marketIndex: number;
    clientOrderIndex: number;
    baseAmount: number;
    avgExecutionPrice: number;
    isAsk: boolean;
    reduceOnly?: boolean;
    nonce?: number;
    integratorAccountIndex?: number;
    integratorTakerFee?: number;
    integratorMakerFee?: number;
  }): Promise<[unknown, string, string | null]>;
  cancelOrder(params: {
    marketIndex: number;
    orderIndex: number;
    nonce?: number;
  }): Promise<[unknown, string, string | null]>;
  cancelAllOrders(timeInForce: number, time: number, nonce?: number): Promise<[unknown, unknown, string | null]>;
  modifyOrder(
    marketIndex: number,
    orderIndex: number,
    baseAmount: number,
    price: number,
    triggerPrice: number,
    nonce?: number,
  ): Promise<[unknown, string, string | null]>;
  updateLeverage(
    marketIndex: number,
    marginMode: number,
    leverage: number,
    nonce?: number,
  ): Promise<[unknown, string, string | null]>;
  withdraw(params: {
    usdcAmount: number;
    nonce?: number;
    apiKeyIndex: number;
    accountIndex: number;
  }): Promise<[unknown, string, string | null]>;
  approveIntegrator(
    integratorIndex: number,
    maxPerpsTakerFee: number,
    maxPerpsMakerFee: number,
    maxSpotTakerFee: number,
    maxSpotMakerFee: number,
    approvalExpiry: number,
    nonce?: number,
  ): Promise<[unknown, string, string | null]>;
  /** Ensures the WASM client state (createClient) is initialized for the current apiKeyIndex/accountIndex. */
  ensureWasmClient(): Promise<void>;
  close(): Promise<void>;
};

// ============================================================
// Lighter API Constants
// ============================================================

const LIGHTER_API_URL = 'https://mainnet.zklighter.elliot.ai';
const LIGHTER_WS_URL = 'wss://mainnet.zklighter.elliot.ai/stream';

/** Keepalive interval — Lighter requires a frame every 2 minutes; send ping every 90s */
const WS_PING_INTERVAL_MS = 90_000;
/** Reconnect delay after close */
const WS_RECONNECT_DELAY_MS = 3_000;

// ============================================================
// Lighter Raw API Types (internal)
// ============================================================

/** /api/v1/orderBookDetails?filter=perp — rich market data */
interface LighterOrderBookDetail {
  readonly market_id: number;
  readonly symbol: string;
  readonly market_type: string;
  readonly status: string;
  readonly taker_fee: string;
  readonly maker_fee: string;
  readonly min_base_amount: string;
  readonly min_quote_amount: string;
  readonly supported_size_decimals: number;
  readonly supported_price_decimals: number;
  readonly size_decimals: number;
  readonly price_decimals: number;
  readonly min_initial_margin_fraction: number;
  readonly maintenance_margin_fraction: number;
  readonly last_trade_price: number;
  readonly daily_trades_count: number;
  readonly daily_base_token_volume: number;
  readonly daily_quote_token_volume: number;
  readonly daily_price_low: number;
  readonly daily_price_high: number;
  readonly daily_price_change: number;
  readonly open_interest: number;
}

interface LighterFundingRate {
  readonly market_id: number;
  readonly exchange: string;
  readonly symbol: string;
  readonly rate: number;
}

interface LighterOrderBookLevel {
  readonly price: string;
  readonly remaining_base_amount: string;
}

interface LighterOrderBookResponse {
  readonly bids: readonly LighterOrderBookLevel[];
  readonly asks: readonly LighterOrderBookLevel[];
}

interface LighterTrade {
  readonly trade_id_str: string;
  readonly market_id: number;
  readonly price: string;
  readonly size: string;
  readonly is_maker_ask: boolean;
  readonly timestamp: number;
}

interface LighterCandle {
  readonly t: number;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  readonly v: number;
  readonly V: number;
}

/** /api/v1/account response — resolved account */
/** Lighter /account top-level shape: `{ code, total, accounts: [LighterAccountRaw] }` */
interface LighterAccountResponse {
  readonly code: number;
  readonly message?: string;
  readonly total?: number;
  readonly accounts?: readonly LighterAccountRaw[];
}

/** One entry inside `accounts[]` — the actual account record. */
interface LighterAccountRaw {
  readonly code: number;
  readonly account_index: number;
  readonly l1_address: string;
  /** Total USDC deposited (original collateral) */
  readonly collateral: string;
  /** Free balance after positions — what can be used for new orders */
  readonly available_balance: string;
  /** Current marked-to-market equity (collateral + unrealized_pnl, incl. spot assets) */
  readonly total_asset_value: string;
  readonly positions: readonly LighterPosition[];
  /** Free spot-style token balances (USDC cash not tied to positions). */
  readonly assets?: readonly LighterAsset[];
}

interface LighterAsset {
  readonly symbol: string;
  readonly asset_id: number;
  readonly balance: string;
  readonly locked_balance: string;
}

interface LighterPosition {
  readonly market_id: number;
  readonly symbol: string;
  /** 1 = long, -1 = short. Lighter represents direction separately from size. */
  readonly sign: number;
  /** Absolute size (decimal string) */
  readonly position: string;
  readonly avg_entry_price: string;
  /** Notional value = |size| × mark */
  readonly position_value: string;
  readonly unrealized_pnl: string;
  readonly realized_pnl: string;
  readonly liquidation_price: string;
  readonly allocated_margin: string;
  readonly initial_margin_fraction: string;
  /** 0 = cross, 1 = isolated */
  readonly margin_mode: number;
}

// ============================================================
// Interval mapping
// ============================================================

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

// ============================================================
// LighterPerpAdapter
// ============================================================

export class LighterPerpAdapter extends PerpAdapterBase {
  readonly protocolId = 'lighter';
  readonly displayName = 'Lighter';

  /** symbol → market_id mapping built lazily from /orderBookDetails */
  private symbolToMarketId: Map<string, number> = new Map();
  /** market_id → detail mapping built lazily from /orderBookDetails */
  private marketDetails: Map<number, LighterOrderBookDetail> = new Map();
  /** l1_address → account_index cache (null = not found on chain) */
  private accountIndexCache: Map<string, number | null> = new Map();

  // ── Lighter credentials (set via setLighterCredentials) ──
  /** 40-byte hex API key for WASM signer (no 0x prefix) */
  private lighterApiKey: string | null = null;
  /** Lighter account index (integer) */
  private lighterAccountIndex: number | null = null;
  /** API key slot index — slots 0-3 are reserved; default 4 */
  private lighterApiKeyIndex: number = 4;

  /**
   * SignerClient instance — lazy-initialized on first trading call.
   * Uses lighter-ts-sdk's SignerClient which wraps the WASM signer
   * and manages nonces, transaction submission internally.
   */
  private signerClient: LighterSignerClient | null = null;
  private signerInitPromise: Promise<void> | null = null;

  /**
   * Store Lighter trading credentials.
   * Invalidates any existing signer so it will be re-created on next trade.
   *
   * @param apiKey        40-byte hex API key (without 0x prefix)
   * @param accountIndex  Lighter account index
   * @param apiKeyIndex   Key slot index (0-3 reserved; default 4)
   */
  setLighterCredentials(apiKey: string, accountIndex: number, apiKeyIndex: number = 4): void {
    this.lighterApiKey = apiKey;
    this.lighterAccountIndex = accountIndex;
    this.lighterApiKeyIndex = apiKeyIndex;
    // Invalidate existing signer — it will be re-created with new credentials
    this.signerClient = null;
    this.signerInitPromise = null;
    logger.info(`Lighter credentials set — accountIndex=${accountIndex}, apiKeyIndex=${apiKeyIndex}`);
  }

  /** Whether trading credentials have been set via setLighterCredentials(). */
  hasCredentials(): boolean {
    return this.lighterApiKey !== null && this.lighterAccountIndex !== null;
  }

  /** Wipe trading credentials + signer. Use when the user disconnects. */
  clearLighterCredentials(): void {
    this.lighterApiKey = null;
    this.lighterAccountIndex = null;
    this.lighterApiKeyIndex = 4;
    this.signerClient = null;
    this.signerInitPromise = null;
    logger.info('Lighter credentials cleared');
  }

  /** Returns the current API key index slot, or null if credentials not set. */
  getApiKeyIndex(): number | null {
    return this.lighterApiKey !== null ? this.lighterApiKeyIndex : null;
  }

  /**
   * Lazily initialize the SignerClient with WASM signer.
   * The SDK handles WASM loading, client creation, and nonce management.
   */
  private async ensureSignerClient(): Promise<LighterSignerClient> {
    if (this.lighterApiKey === null || this.lighterAccountIndex === null) {
      throw new Error('Lighter trading requires API key setup — use setLighterCredentials()');
    }

    if (!this.signerClient) {
      // Prevent concurrent initialization
      if (!this.signerInitPromise) {
        this.signerInitPromise = this.initSignerClient();
      }
      await this.signerInitPromise;
    }

    // Always ensure WASM `createClient` has been called for the current
    // (apiKeyIndex, accountIndex). Some SDK paths (createOrder /
    // cancelOrder / approveIntegrator) reach into `wasmModule` directly
    // and throw `client is not created for apiKeyIndex: N accountIndex: M`
    // when the WASM-side client state was never initialized. `ensureWasmClient`
    // is idempotent (guarded by `this.clientCreated`) so the extra call on
    // every signing op is cheap.
    await this.signerClient!.ensureWasmClient();

    return this.signerClient!;
  }

  private async initSignerClient(): Promise<void> {
    // Dynamic import — lighter-ts-sdk uses WASM, must only load client-side
    const { SignerClient } = await import('lighter-ts-sdk');

    // packages/core has no DOM types — use globalThis to detect browser environment
    const isBrowser = typeof globalThis !== 'undefined'
      && typeof (globalThis as Record<string, unknown>).document !== 'undefined';
    const wasmConfig = isBrowser
      ? { wasmPath: '/wasm/lighter/lighter-signer.wasm', wasmExecPath: '/wasm/lighter/wasm_exec.js' }
      : undefined;

    const client = new SignerClient({
      url: LIGHTER_API_URL,
      privateKey: this.lighterApiKey!,
      accountIndex: this.lighterAccountIndex!,
      apiKeyIndex: this.lighterApiKeyIndex,
      wasmConfig,
    });

    await client.initialize();
    this.signerClient = client as unknown as LighterSignerClient;
    logger.info('Lighter SignerClient initialized (WASM signer ready)');
  }

  // ── WebSocket state ──
  private ws: WebSocket | null = null;
  private wsSubscriptions = new Map<string, Set<(msg: WsMessage) => void>>();
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsPingTimer: ReturnType<typeof setInterval> | null = null;


  // ── Internal Helpers ──

  private async get<T>(path: string): Promise<T> {
    const url = `${LIGHTER_API_URL}${path}`;
    logger.debug(`GET ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Lighter API error ${res.status}: ${path}`);
    }
    return res.json() as Promise<T>;
  }

  private async ensureMarketsLoaded(): Promise<void> {
    if (this.symbolToMarketId.size > 0) return;
    await this.loadMarkets();
  }

  private async loadMarkets(): Promise<void> {
    const resp = await this.get<{ order_book_details: readonly LighterOrderBookDetail[] }>(
      '/api/v1/orderBookDetails?filter=perp',
    );

    this.symbolToMarketId.clear();
    this.marketDetails.clear();
    for (const detail of resp.order_book_details) {
      this.symbolToMarketId.set(detail.symbol, detail.market_id);
      this.marketDetails.set(detail.market_id, detail);
    }
  }

  private async getMarketId(symbol: string): Promise<number> {
    await this.ensureMarketsLoaded();
    const id = this.symbolToMarketId.get(symbol);
    if (id === undefined) {
      throw new Error(`Lighter: unknown symbol "${symbol}"`);
    }
    return id;
  }

  /**
   * Resolve an L1 (wallet) address to a Lighter account_index.
   * Returns null if the account is not registered on Lighter.
   */
  private async resolveAccountIndex(address: string): Promise<number | null> {
    const lowercased = address.toLowerCase();
    const cached = this.accountIndexCache.get(lowercased);
    if (cached !== undefined) return cached;

    // Lighter's `/account?by=l1_address&value=…` expects lowercase addresses
    // and returns HTTP 400 for unknown accounts rather than a 200 + empty
    // body. Swallow the thrown 400/404 so callers can distinguish
    // "unregistered" from genuine errors by our `null` return.
    let resp: LighterAccountResponse;
    try {
      resp = await this.get<LighterAccountResponse>(
        `/api/v1/account?by=l1_address&value=${lowercased}`,
      );
    } catch {
      this.accountIndexCache.set(lowercased, null);
      return null;
    }

    const account = resp.accounts?.[0];
    if (resp.code !== 200 || !account) {
      this.accountIndexCache.set(lowercased, null);
      return null;
    }

    this.accountIndexCache.set(lowercased, account.account_index);
    return account.account_index;
  }

  // ── Market Data ──

  async getMarkets(): Promise<PerpMarket[]> {
    const [detailsResp, fundingResp] = await Promise.all([
      this.get<{ order_book_details: readonly LighterOrderBookDetail[] }>(
        '/api/v1/orderBookDetails?filter=perp',
      ),
      this.get<{ funding_rates: readonly LighterFundingRate[] }>('/api/v1/funding-rates'),
    ]);

    // Rebuild internal maps from the authoritative details source
    this.symbolToMarketId.clear();
    this.marketDetails.clear();
    for (const detail of detailsResp.order_book_details) {
      this.symbolToMarketId.set(detail.symbol, detail.market_id);
      this.marketDetails.set(detail.market_id, detail);
    }

    // Build funding rate lookup: market_id → rate (lighter exchange only)
    const fundingByMarketId = new Map<number, number>();
    for (const fr of fundingResp.funding_rates) {
      if (fr.exchange === 'lighter') {
        fundingByMarketId.set(fr.market_id, fr.rate);
      }
    }

    return detailsResp.order_book_details.map((d): PerpMarket => {
      // min_initial_margin_fraction is basis points where 10000 = 100%
      // e.g. 200 = 2% → maxLeverage = 10000/200 = 50x
      const maxLeverage = d.min_initial_margin_fraction > 0
        ? Math.floor(10000 / d.min_initial_margin_fraction)
        : 1;
      const tickSize = Math.pow(10, -d.price_decimals);
      const lotSize = Math.pow(10, -d.size_decimals);
      const minOrderSize = parseFloat(d.min_base_amount);
      const fundingRate = fundingByMarketId.get(d.market_id) ?? 0;
      const takerFee = parseFloat(d.taker_fee);
      const makerFee = parseFloat(d.maker_fee);

      return {
        symbol: d.symbol,
        name: `${d.symbol}-USDC`,
        prevDayPx: d.daily_price_change !== 0 && d.last_trade_price !== 0
          ? d.last_trade_price / (1 + d.daily_price_change / 100)
          : 0,
        baseAsset: d.symbol,
        quoteAsset: 'USDC',
        maxLeverage,
        tickSize,
        lotSize,
        minOrderSize,
        makerFee,
        takerFee,
        fundingRate,
        openInterest: d.open_interest,
        volume24h: d.daily_quote_token_volume,
        markPrice: d.last_trade_price,
        indexPrice: d.last_trade_price,
        category: 'crypto',
        assetType: 'perp',
        dex: null,
        marketCap: null,
        contractAddress: null,
      };
    });
  }

  async getOrderbook(symbol: string, _nSigFigs?: number): Promise<Orderbook> {
    const marketId = await this.getMarketId(symbol);
    const data = await this.get<LighterOrderBookResponse>(
      `/api/v1/orderBookOrders?market_id=${marketId}&limit=20`,
    );

    const mapLevel = (lvl: LighterOrderBookLevel): OrderbookLevel => ({
      price: parseFloat(lvl.price),
      size: parseFloat(lvl.remaining_base_amount),
    });

    return {
      symbol,
      bids: data.bids.map(mapLevel),
      asks: data.asks.map(mapLevel),
      timestamp: Date.now(),
    };
  }

  async getTrades(symbol: string, limit = 100): Promise<Trade[]> {
    const marketId = await this.getMarketId(symbol);
    const data = await this.get<{ trades: readonly LighterTrade[] }>(
      `/api/v1/recentTrades?market_id=${marketId}&limit=${limit}`,
    );

    return data.trades.map((t): Trade => ({
      id: t.trade_id_str,
      symbol,
      price: parseFloat(t.price),
      size: parseFloat(t.size),
      // is_maker_ask=true means the maker is on the ask side, so buyer is aggressor → 'long'
      side: t.is_maker_ask ? 'long' : 'short',
      timestamp: t.timestamp,
    }));
  }

  async getCandles(
    symbol: string,
    interval: CandleInterval,
    limit = 300,
    endTime: number = Date.now(),
  ): Promise<Candle[]> {
    const marketId = await this.getMarketId(symbol);
    const resolution = INTERVAL_MAP[interval];
    // Lighter requires start_timestamp and end_timestamp (seconds)
    const endTimestamp = Math.floor(endTime / 1000);
    const startTimestamp = endTimestamp - this.intervalToSeconds(interval) * limit;
    const data = await this.get<{ c: readonly LighterCandle[] }>(
      `/api/v1/candles?market_id=${marketId}&resolution=${resolution}&start_timestamp=${startTimestamp}&end_timestamp=${endTimestamp}&count_back=${limit}`,
    );

    return (data.c ?? []).map((c): Candle => ({
      timestamp: c.t,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
      volume: c.v,
    }));
  }

  private intervalToSeconds(interval: CandleInterval): number {
    const map: Record<CandleInterval, number> = {
      '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
      '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '12h': 43200,
      '1d': 86400, '1w': 604800, '1M': 2592000,
    };
    return map[interval];
  }

  // ── Fees ──

  async getUserFees(_address: string): Promise<UserFeeInfo> {
    await this.ensureMarketsLoaded();

    // Use the first available market's fees as defaults (all Lighter perp markets share fee tiers)
    let takerFee = 0.0005;
    let makerFee = 0.0002;

    const firstDetail = this.marketDetails.values().next().value;
    if (firstDetail) {
      takerFee = parseFloat((firstDetail as LighterOrderBookDetail).taker_fee);
      makerFee = parseFloat((firstDetail as LighterOrderBookDetail).maker_fee);
    }

    return {
      perpTaker: takerFee,
      perpMaker: makerFee,
      spotTaker: takerFee,
      spotMaker: makerFee,
      referralDiscount: 0,
      stakingDiscount: 0,
    };
  }

  // ── HIP-3 ──

  async getPerpDexs(): Promise<PerpDex[]> {
    // Lighter does not have a HIP-3 equivalent
    return [];
  }

  // ── Account (public read — no auth required) ──

  async getAccountState(address: string): Promise<PerpAccountState> {
    let resp: LighterAccountResponse;
    try {
      resp = await this.get<LighterAccountResponse>(
        `/api/v1/account?by=l1_address&value=${address.toLowerCase()}`,
      );
    } catch {
      return LighterPerpAdapter.emptyAccountState(address);
    }

    // Lighter returns `{ code, total, accounts: [...] }`. Account-not-found
    // yields code !== 200 or an empty accounts array.
    const account = resp.accounts?.[0];
    if (resp.code !== 200 || !account) {
      return LighterPerpAdapter.emptyAccountState(address);
    }

    // Cache the resolved account index
    this.accountIndexCache.set(address.toLowerCase(), account.account_index);

    // Field mapping (verified against live `/account` response):
    //   collateral         — original USDC deposit
    //   total_asset_value  — marked-to-market equity (collateral + pnl)
    //   available_balance  — free balance usable for new orders
    const collateral = parseFloat(account.collateral);
    const totalEquity = parseFloat(account.total_asset_value);
    const availableBalance = parseFloat(account.available_balance);

    let unrealizedPnl = 0;
    let totalMarginUsed = 0;
    let totalNotional = 0;
    for (const pos of account.positions ?? []) {
      unrealizedPnl += parseFloat(pos.unrealized_pnl);
      totalMarginUsed += parseFloat(pos.allocated_margin);
      totalNotional += parseFloat(pos.position_value);
    }

    return {
      address,
      totalEquity,
      totalMarginUsed,
      totalNotional,
      availableBalance,
      unrealizedPnl,
      maintenanceMargin: 0, // Lighter does not expose this separately
      crossMarginSummary: {
        accountValue: totalEquity,
        totalNtlPos: totalNotional,
        totalRawUsd: collateral,
      },
    };
  }

  async getPositions(address: string): Promise<PerpPosition[]> {
    let resp: LighterAccountResponse;
    try {
      resp = await this.get<LighterAccountResponse>(
        `/api/v1/account?by=l1_address&value=${address.toLowerCase()}`,
      );
    } catch {
      return [];
    }

    const account = resp.accounts?.[0];
    if (resp.code !== 200 || !account) return [];

    return (account.positions ?? [])
      // Lighter returns a row for EVERY market (even with zero position);
      // strip zero-size entries so the UI only sees real positions.
      .filter(p => parseFloat(p.position) !== 0)
      .map((p): PerpPosition => {
        const size = parseFloat(p.position);
        const entryPrice = parseFloat(p.avg_entry_price);
        const notional = parseFloat(p.position_value);
        // Lighter omits markPrice on positions — derive from |notional| / size.
        const markPrice = size > 0 ? Math.abs(notional) / size : 0;
        const unrealizedPnl = parseFloat(p.unrealized_pnl);
        const isIsolated = p.margin_mode === 1;
        // Mirror HL convention: `marginUsed` on a position is per-position
        // allocation for isolated, and 0 for cross (cross uses the
        // account-wide `totalMarginUsed`). Consumers like AccountInfoPanel
        // subtract per-position `marginUsed` only for isolated entries,
        // so populating cross positions with `allocated_margin` would
        // double-count available balance on the UI.
        const marginUsed = isIsolated ? parseFloat(p.allocated_margin) : 0;
        // Lighter's `initial_margin_fraction` is a percentage (e.g. "33.33"
        // → 3x leverage). Deriving leverage from notional/allocated_margin
        // collapses to 1x for cross positions (where allocated_margin
        // equals notional), hence we use the imf instead.
        const imf = parseFloat(p.initial_margin_fraction);
        const leverage = imf > 0 ? 100 / imf : 1;
        // ROE stays based on the real margin actually backing the position
        // (allocated_margin) regardless of margin mode, so the displayed
        // return % reflects the user's actual capital at risk.
        const effectiveMargin = parseFloat(p.allocated_margin);
        const roe = effectiveMargin > 0 ? (unrealizedPnl / effectiveMargin) * 100 : 0;
        const liqPrice = parseFloat(p.liquidation_price);

        return {
          symbol: p.symbol,
          side: p.sign === 1 ? 'long' : 'short',
          size,
          entryPrice,
          markPrice,
          liquidationPrice: liqPrice > 0 ? liqPrice : null,
          unrealizedPnl,
          realizedPnl: parseFloat(p.realized_pnl),
          leverage,
          leverageType: isIsolated ? 'isolated' : 'cross',
          marginUsed,
          returnOnEquity: roe,
          fundingPayment: 0, // Lighter doesn't expose funding_payment in /account
        };
      });
  }

  async getOpenOrders(address: string): Promise<PerpOrder[]> {
    // Lighter's /account endpoint does NOT include orders; the active
    // orders endpoint (/accountActiveOrders) requires API-key auth.
    // Until an authenticated flow is wired, return empty to keep the UI
    // stable for unauthenticated users.
    logger.debug(`getOpenOrders(${address}) — needs authenticated /accountActiveOrders (not yet wired)`);
    return [];
  }

  async getOrderHistory(address: string, _limit?: number): Promise<PerpOrder[]> {
    // Same as getOpenOrders — requires authenticated endpoint.
    logger.debug(`getOrderHistory(${address}) — needs authenticated /orderHistory (not yet wired)`);
    return [];
  }

  async getFills(address: string, _limit?: number): Promise<Fill[]> {
    // Lighter's /api/v1/account does not provide a separate fills endpoint.
    // Return empty array — fills can be reconstructed from order history on the UI side.
    logger.debug(`getFills called for ${address} — Lighter has no separate fills endpoint`);

    // Resolve account to validate address, then return empty
    const accountIndex = await this.resolveAccountIndex(address);
    if (accountIndex === null) return [];

    return [];
  }

  async getFundingHistory(address: string, _startTime?: number): Promise<FundingHistoryEntry[]> {
    // Lighter's public API does not expose per-user funding history.
    logger.debug(`getFundingHistory called for ${address} — not available via Lighter API`);
    return [];
  }

  // ── Trading Helpers ──

  /**
   * Convert a human-readable value to integer ticks for the Lighter WASM signer.
   * e.g. toTicks(1.5, 2) = 150
   */
  private toTicks(value: number, decimals: number): number {
    return Math.round(value * Math.pow(10, decimals));
  }

  /**
   * Generate a unique client order index from current timestamp.
   * Must fit in uint48 — SDK uses it for dedup.
   */
  private nextClientOrderIndex(): number {
    return Math.floor(Date.now() / 1000) % 281_474_976_710_000;
  }

  /**
   * Get market detail for tick conversion (size_decimals, price_decimals).
   * Throws if symbol is unknown.
   */
  private getMarketDetail(marketId: number): LighterOrderBookDetail {
    const detail = this.marketDetails.get(marketId);
    if (!detail) {
      throw new Error(`Lighter: no market detail for marketId=${marketId}`);
    }
    return detail;
  }

  // ── Trading (WASM signer via SignerClient) ──

  async placeOrder(params: PlaceOrderParams, _signFn: EIP712SignFn): Promise<OrderResult> {
    const client = await this.ensureSignerClient();
    await this.ensureMarketsLoaded();

    const marketId = await this.getMarketId(params.symbol);
    const detail = this.getMarketDetail(marketId);
    const isAsk = params.side === 'short';
    const baseAmount = this.toTicks(params.size, detail.supported_size_decimals);
    const clientOrderIndex = this.nextClientOrderIndex();

    try {
      const isMarket = params.type === 'market';
      const isStopMarket = params.type === 'stop_market';
      const isStopLimit = params.type === 'stop_limit';
      const isTakeMarket = params.type === 'take_market';
      const isTakeLimit = params.type === 'take_limit';

      if (isMarket) {
        // Market order — use createMarketOrder with slippage-adjusted avg price
        const markPrice = detail.last_trade_price;
        const slippageBps = params.slippageBps ?? 50; // default 0.5%
        const slippageMultiplier = 1 + slippageBps / 10_000;
        // For buy: cap at markPrice * (1 + slippage), for sell: floor at markPrice * (1 - slippage)
        const avgExecutionPrice = isAsk
          ? this.toTicks(markPrice * (1 / slippageMultiplier), detail.supported_price_decimals)
          : this.toTicks(markPrice * slippageMultiplier, detail.supported_price_decimals);

        const [, txHash, error] = await client.createMarketOrder({
          marketIndex: marketId,
          clientOrderIndex,
          baseAmount,
          avgExecutionPrice,
          isAsk,
          reduceOnly: params.reduceOnly ?? false,
          integratorAccountIndex: INTEGRATOR_ACCOUNT_INDEX,
          integratorTakerFee: INTEGRATOR_FEE,
          integratorMakerFee: INTEGRATOR_FEE,
        });

        if (error) return { success: false, orderId: null, error };
        return { success: true, orderId: txHash };
      }

      // Limit / Stop / Take orders
      const price = this.toTicks(params.price ?? 0, detail.supported_price_decimals);

      // Map our OrderType to Lighter's numeric order types
      let orderType = 0; // LIMIT
      if (isStopMarket) orderType = 2;       // STOP_LOSS
      else if (isStopLimit) orderType = 3;   // STOP_LOSS_LIMIT
      else if (isTakeMarket) orderType = 4;  // TAKE_PROFIT
      else if (isTakeLimit) orderType = 5;   // TAKE_PROFIT_LIMIT

      // Map our TimeInForce to Lighter's numeric TIF
      let timeInForce = 1; // GOOD_TILL_TIME (default)
      if (params.timeInForce === 'ioc') timeInForce = 0;      // IMMEDIATE_OR_CANCEL
      else if (params.timeInForce === 'alo') timeInForce = 2;  // POST_ONLY

      const triggerPrice = params.triggerPrice !== undefined
        ? this.toTicks(params.triggerPrice, detail.supported_price_decimals)
        : 0;

      const [, txHash, error] = await client.createOrder({
        marketIndex: marketId,
        clientOrderIndex,
        baseAmount,
        price,
        isAsk,
        orderType,
        timeInForce,
        reduceOnly: params.reduceOnly ?? false,
        triggerPrice,
        integratorAccountIndex: INTEGRATOR_ACCOUNT_INDEX,
        integratorTakerFee: INTEGRATOR_FEE,
        integratorMakerFee: INTEGRATOR_FEE,
      });

      if (error) return { success: false, orderId: null, error };
      return { success: true, orderId: txHash };
    } catch (err) {
      logger.error('placeOrder failed', { err });
      return { success: false, orderId: null, error: err instanceof Error ? err.message : 'Order failed' };
    }
  }

  /**
   * Scale order: split into N limit orders between startPrice and endPrice.
   * Lighter has no native bulk order API — we submit individual limit orders.
   */
  async placeScaleOrder(params: PlaceScaleOrderParams, _signFn: EIP712SignFn): Promise<OrderResult> {
    const client = await this.ensureSignerClient();
    await this.ensureMarketsLoaded();

    const n = Math.max(2, Math.min(20, Math.floor(params.totalOrders)));
    const { startPrice, endPrice, totalSize, sizeSkew } = params;

    if (!(totalSize > 0)) throw new Error('totalSize must be > 0');
    if (!(startPrice > 0) || !(endPrice > 0)) throw new Error('prices must be > 0');
    if (sizeSkew <= 0) throw new Error('sizeSkew must be > 0');

    const marketId = await this.getMarketId(params.symbol);
    const detail = this.getMarketDetail(marketId);
    const isAsk = params.side === 'short';

    // Compute weights and normalize
    const weights: number[] = [];
    let weightSum = 0;
    for (let i = 0; i < n; i++) {
      const ratio = i / (n - 1);
      const w = 1 + (sizeSkew - 1) * ratio;
      weights.push(w);
      weightSum += w;
    }

    let timeInForce = 1; // GTT
    if (params.timeInForce === 'ioc') timeInForce = 0;
    else if (params.timeInForce === 'alo') timeInForce = 2;

    let firstTxHash: string | null = null;

    try {
      for (let i = 0; i < n; i++) {
        const priceRatio = i / (n - 1);
        const price = startPrice + (endPrice - startPrice) * priceRatio;
        const size = (totalSize * weights[i]) / weightSum;

        const [, txHash, error] = await client.createOrder({
          marketIndex: marketId,
          clientOrderIndex: this.nextClientOrderIndex(),
          baseAmount: this.toTicks(size, detail.supported_size_decimals),
          price: this.toTicks(price, detail.supported_price_decimals),
          isAsk,
          orderType: 0, // LIMIT
          timeInForce,
          reduceOnly: params.reduceOnly ?? false,
          triggerPrice: 0,
          integratorAccountIndex: INTEGRATOR_ACCOUNT_INDEX,
          integratorTakerFee: INTEGRATOR_FEE,
          integratorMakerFee: INTEGRATOR_FEE,
        });

        if (error) {
          logger.error(`Scale order leg ${i + 1}/${n} failed`, { error });
        }
        if (i === 0) {
          firstTxHash = txHash;
        }
      }

      return { success: true, orderId: firstTxHash };
    } catch (err) {
      logger.error('placeScaleOrder failed', { err });
      return {
        success: false,
        orderId: firstTxHash,
        error: err instanceof Error ? err.message : 'Scale order failed',
      };
    }
  }

  async cancelOrder(params: CancelOrderParams, _signFn: EIP712SignFn): Promise<OrderResult> {
    const client = await this.ensureSignerClient();
    await this.ensureMarketsLoaded();

    const marketId = await this.getMarketId(params.symbol);

    try {
      const [, txHash, error] = await client.cancelOrder({
        marketIndex: marketId,
        orderIndex: parseInt(params.orderId, 10),
      });

      if (error) return { success: false, orderId: params.orderId, error };
      return { success: true, orderId: txHash || params.orderId };
    } catch (err) {
      return {
        success: false,
        orderId: params.orderId,
        error: err instanceof Error ? err.message : 'Cancel failed',
      };
    }
  }

  /**
   * Modify order — uses Lighter's native modifyOrder (atomic cancel+replace).
   */
  async modifyOrder(params: ModifyOrderParams, _signFn: EIP712SignFn): Promise<OrderResult> {
    const client = await this.ensureSignerClient();
    await this.ensureMarketsLoaded();

    const marketId = await this.getMarketId(params.symbol);
    const detail = this.getMarketDetail(marketId);

    // Retrieve existing order to fill in unchanged fields
    // If price/size not provided, use 0 (SDK interprets as "keep existing")
    const baseAmount = params.size !== undefined
      ? this.toTicks(params.size, detail.supported_size_decimals)
      : 0;
    const price = params.price !== undefined
      ? this.toTicks(params.price, detail.supported_price_decimals)
      : 0;
    const triggerPrice = params.triggerPrice !== undefined
      ? this.toTicks(params.triggerPrice, detail.supported_price_decimals)
      : 0;

    try {
      const [, txHash, error] = await client.modifyOrder(
        marketId,
        parseInt(params.orderId, 10),
        baseAmount,
        price,
        triggerPrice,
      );

      if (error) return { success: false, orderId: params.orderId, error };
      return { success: true, orderId: txHash || params.orderId };
    } catch (err) {
      return {
        success: false,
        orderId: params.orderId,
        error: err instanceof Error ? err.message : 'Modify failed',
      };
    }
  }

  async updateLeverage(params: UpdateLeverageParams, _signFn: EIP712SignFn): Promise<void> {
    const client = await this.ensureSignerClient();
    await this.ensureMarketsLoaded();
    // Ensure WASM createClient is called (required before any signing)
    await client.ensureWasmClient();

    const marketId = await this.getMarketId(params.symbol);
    const marginMode = params.marginMode === 'isolated' ? 1 : 0;
    // IMF = 10_000 / leverage (e.g. 10x → 1000, 3x → 3333)
    const fraction = Math.floor(10_000 / params.leverage);

    // The deployed WASM signUpdateLeverage expects 7 args:
    //   (marketIndex, fraction, marginMode, skipNonce, nonce, apiKeyIndex, accountIndex)
    // but the SDK's WasmSigner.signUpdateLeverage passes only 6 (no skipNonce).
    // We bypass the wrapper and call wasmModule directly with skipNonce=0,
    // falling back to the 6-arg signature if the WASM is the older build.
    type RawWasmModuleWithLeverage = {
      signUpdateLeverage: (
        marketIndex: number,
        fraction: number,
        marginMode: number,
        skipNonce: number,
        nonce: number,
        apiKeyIndex: number,
        accountIndex: number,
      ) => { txType?: number; txInfo?: string; txHash?: string; error?: string };
    };

    const rawModule = (client as unknown as { wallet?: { wasmModule?: RawWasmModuleWithLeverage } }).wallet?.wasmModule;
    if (!rawModule || typeof rawModule.signUpdateLeverage !== 'function') {
      throw new Error(
        'Lighter SDK internal changed: wasmModule.signUpdateLeverage not accessible. ' +
        'Revert lighter-ts-sdk to a known-compatible version.',
      );
    }

    // Fetch nonce
    const nonceRes = await this.get<{ nonce?: number; next_nonce?: number }>(
      `/api/v1/nextNonce?account_index=${this.lighterAccountIndex}&api_key_index=${this.lighterApiKeyIndex}`,
    );
    const nonce = nonceRes.nonce ?? nonceRes.next_nonce ?? 0;

    let signed = rawModule.signUpdateLeverage(
      marketId, fraction, marginMode, 0 /* skipNonce */, nonce, this.lighterApiKeyIndex, this.lighterAccountIndex!,
    );
    // Fallback: older WASM build expects 6 args (no skipNonce)
    if (signed.error && String(signed.error).includes('expects 6 args')) {
      type SixArgFn = (mi: number, f: number, mm: number, n: number, aki: number, ai: number) => typeof signed;
      signed = (rawModule.signUpdateLeverage as unknown as SixArgFn)(
        marketId, fraction, marginMode, nonce, this.lighterApiKeyIndex, this.lighterAccountIndex!,
      );
    }

    if (signed.error) {
      throw new Error(`updateLeverage failed: ${signed.error}`);
    }
    if (!signed.txInfo) {
      throw new Error('updateLeverage: WASM returned no txInfo');
    }

    // POST to sendTx
    const sendRes = await fetch(`${LIGHTER_API_URL}/api/v1/sendTx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        tx_type: String(signed.txType ?? 20),
        tx_info: signed.txInfo,
      }),
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text();
      throw new Error(`updateLeverage sendTx failed (${sendRes.status}): ${errText}`);
    }

    const result = await sendRes.json() as { code: number; message?: string };
    if (result.code !== 200) {
      throw new Error(`updateLeverage failed: ${result.message ?? JSON.stringify(result)}`);
    }
  }

  // ============================================================
  // WebSocket
  // ============================================================

  subscribe(channel: WsChannel, callback: (msg: WsMessage) => void): Unsubscribe {
    const lighterChannel = this.toLighterChannel(channel);
    if (lighterChannel === null) {
      // HL-specific channel with no Lighter equivalent → no-op
      return () => { /* no-op */ };
    }

    this.ensureWsConnection();
    const key = lighterChannel;

    if (!this.wsSubscriptions.has(key)) {
      this.wsSubscriptions.set(key, new Set());
      this.wsSend({ type: 'subscribe', channel: key });
    }

    this.wsSubscriptions.get(key)!.add(callback);

    return () => {
      const subs = this.wsSubscriptions.get(key);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.wsSubscriptions.delete(key);
          this.wsSend({ type: 'unsubscribe', channel: key });
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
  }

  private ensureWsConnection(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;

    this.ws = new WebSocket(LIGHTER_WS_URL);

    this.ws.onopen = () => {
      logger.info('Lighter WebSocket connected');
      // Start keepalive ping
      this.startPing();

      // 재연결 시 기존 구독 복원
      for (const [channelKey] of this.wsSubscriptions) {
        this.wsSend({ type: 'subscribe', channel: channelKey });
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        this.handleWsMessage(data);
      } catch {
        logger.warn('Failed to parse Lighter WS message');
      }
    };

    this.ws.onclose = () => {
      logger.info('Lighter WebSocket closed, reconnecting in 3s');
      this.stopPing();
      this.wsReconnectTimer = setTimeout(() => this.ensureWsConnection(), WS_RECONNECT_DELAY_MS);
    };

    this.ws.onerror = (err) => {
      logger.error('Lighter WebSocket error', { err });
    };
  }

  private wsSend(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private startPing(): void {
    this.stopPing();
    this.wsPingTimer = setInterval(() => {
      // Lighter keepalive: send any frame. An empty JSON object works.
      this.wsSend({ type: 'ping' });
    }, WS_PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.wsPingTimer) {
      clearInterval(this.wsPingTimer);
      this.wsPingTimer = null;
    }
  }

  /**
   * Map WsChannel (HL-centric union) to a Lighter WS channel string.
   * Returns null for channels that have no Lighter equivalent.
   */
  private toLighterChannel(channel: WsChannel): string | null {
    switch (channel.type) {
      case 'orderbook': {
        const id = this.symbolToMarketId.get(channel.symbol);
        return id !== undefined ? `order_book/${id}` : null;
      }
      case 'trades': {
        const id = this.symbolToMarketId.get(channel.symbol);
        return id !== undefined ? `trade/${id}` : null;
      }
      case 'ticker': {
        const id = this.symbolToMarketId.get(channel.symbol);
        return id !== undefined ? `market_stats/${id}` : null;
      }
      case 'allMids':
        return 'market_stats/all';
      // HL-specific channels with no Lighter equivalent → no-op
      case 'candles':
      case 'webData3':
      case 'activeAssetCtx':
      case 'activeAssetData':
      case 'allDexsAssetCtxs':
      case 'spotAssetCtxs':
      case 'allDexsClearinghouseState':
      case 'openOrdersLive':
      case 'userFillsLive':
      case 'spotState':
      case 'userHistoricalOrdersLive':
      case 'userFundingsLive':
      // Pacifica-only channels — Lighter has no equivalent feed.
      case 'pacificaAccountInfo':
      case 'pacificaAccountPositions':
      case 'pacificaAccountOrders':
      case 'pacificaAccountFills':
        return null;
    }
  }

  private handleWsMessage(data: Record<string, unknown>): void {
    const channel = data.channel as string | undefined;
    if (!channel) return;

    const payload = data.data ?? data;

    // Broadcast to all matching subscriptions
    const callbacks = this.wsSubscriptions.get(channel);
    if (!callbacks || callbacks.size === 0) return;

    const msg = this.parseWsPayload(channel, payload);
    if (msg) {
      for (const cb of callbacks) cb(msg);
    }
  }

  private parseWsPayload(channel: string, data: unknown): WsMessage | null {
    // order_book/{market_id}
    if (channel.startsWith('order_book/')) {
      return this.parseWsOrderbook(channel, data);
    }
    // trade/{market_id}
    if (channel.startsWith('trade/')) {
      return this.parseWsTrades(channel, data);
    }
    // market_stats/{market_id} or market_stats/all
    if (channel.startsWith('market_stats/')) {
      return this.parseWsMarketStats(channel, data);
    }
    return null;
  }

  private parseWsOrderbook(channel: string, data: unknown): WsMessage | null {
    const marketId = this.extractMarketId(channel);
    const symbol = this.marketIdToSymbol(marketId);
    if (symbol === null) return null;

    const d = data as { bids?: ReadonlyArray<{ price: string; remaining_base_amount: string }>; asks?: ReadonlyArray<{ price: string; remaining_base_amount: string }> };
    const mapLevel = (lvl: { price: string; remaining_base_amount: string }): OrderbookLevel => ({
      price: parseFloat(lvl.price),
      size: parseFloat(lvl.remaining_base_amount),
    });

    const orderbook: Orderbook = {
      symbol,
      bids: (d.bids ?? []).map(mapLevel),
      asks: (d.asks ?? []).map(mapLevel),
      timestamp: Date.now(),
    };

    return { channel: 'orderbook', data: orderbook };
  }

  private parseWsTrades(channel: string, data: unknown): WsMessage | null {
    const marketId = this.extractMarketId(channel);
    const symbol = this.marketIdToSymbol(marketId);
    if (symbol === null) return null;

    const raw = data as ReadonlyArray<{ trade_id_str: string; price: string; size: string; is_maker_ask: boolean; timestamp: number }> | { trade_id_str: string; price: string; size: string; is_maker_ask: boolean; timestamp: number };

    const arr = Array.isArray(raw) ? raw : [raw];
    const trades: Trade[] = arr.map(t => ({
      id: t.trade_id_str,
      symbol,
      price: parseFloat(t.price),
      size: parseFloat(t.size),
      side: t.is_maker_ask ? 'long' as const : 'short' as const,
      timestamp: t.timestamp,
    }));

    return { channel: 'trades', data: trades };
  }

  private parseWsMarketStats(channel: string, data: unknown): WsMessage | null {
    // market_stats/all → allMids
    if (channel === 'market_stats/all') {
      const stats = data as ReadonlyArray<{ symbol: string; last_trade_price: number }>;
      const mids: Record<string, number> = {};
      for (const s of (Array.isArray(stats) ? stats : [])) {
        mids[s.symbol] = s.last_trade_price;
      }
      return { channel: 'allMids', data: { dex: null, mids } };
    }

    // market_stats/{market_id} → ticker (PerpMarket)
    const marketId = this.extractMarketId(channel);
    const detail = this.marketDetails.get(marketId);
    if (!detail) return null;

    const d = data as {
      last_trade_price?: number;
      daily_quote_token_volume?: number;
      open_interest?: number;
      daily_price_change?: number;
      funding_rate?: number;
    };

    const markPrice = d.last_trade_price ?? detail.last_trade_price;
    const volume24h = d.daily_quote_token_volume ?? detail.daily_quote_token_volume;
    const openInterest = d.open_interest ?? detail.open_interest;
    const fundingRate = d.funding_rate ?? 0;
    const maxLeverage = detail.min_initial_margin_fraction > 0
      ? Math.floor(10000 / detail.min_initial_margin_fraction)
      : 1;

    const market: PerpMarket = {
      symbol: detail.symbol,
      name: `${detail.symbol}-USDC`,
      prevDayPx: 0,
      baseAsset: detail.symbol,
      quoteAsset: 'USDC',
      maxLeverage,
      tickSize: Math.pow(10, -detail.price_decimals),
      lotSize: Math.pow(10, -detail.size_decimals),
      minOrderSize: parseFloat(detail.min_base_amount),
      makerFee: parseFloat(detail.maker_fee),
      takerFee: parseFloat(detail.taker_fee),
      fundingRate,
      openInterest,
      volume24h,
      markPrice,
      indexPrice: markPrice,
      category: 'crypto',
      assetType: 'perp',
      dex: null,
      marketCap: null,
      contractAddress: null,
    };

    return { channel: 'ticker', data: market };
  }

  private extractMarketId(channel: string): number {
    const parts = channel.split('/');
    return parseInt(parts[parts.length - 1], 10);
  }

  private marketIdToSymbol(marketId: number): string | null {
    const detail = this.marketDetails.get(marketId);
    return detail ? detail.symbol : null;
  }

  // ── Transfers ──

  async deposit(_params: DepositParams, _signFn: EIP712SignFn): Promise<string> {
    // Lighter L2 deposits require L1 bridge interaction (not a signed L2 tx).
    // Use the Relay Bridge or Lighter L1 bridge client for deposits.
    throw new Error('Lighter deposits require L1 bridge — use Relay Bridge integration');
  }

  async withdraw(params: WithdrawParams, _signFn: EIP712SignFn): Promise<string> {
    const client = await this.ensureSignerClient();

    // Lighter uses 6 decimals for USDC (1 USDC = 1_000_000)
    const usdcAmount = Math.round(params.amount * 1_000_000);

    const [, txHash, error] = await client.withdraw({
      usdcAmount,
      nonce: undefined,
      apiKeyIndex: this.lighterApiKeyIndex,
      accountIndex: this.lighterAccountIndex!,
    });

    if (error) {
      throw new Error(`Lighter withdraw failed: ${error}`);
    }
    return txHash;
  }

  // ── API Key Registration ──

  /**
   * Generate and register a new Lighter API key on-chain via ChangePubKey.
   * Requires EVM wallet for L1 signature on the ChangePubKey transaction.
   *
   * Flow:
   * 1. Initialize a temporary signer client
   * 2. Generate new API keypair via WASM
   * 3. Fetch nonce from /api/v1/nextNonce
   * 4. Sign ChangePubKey with the new key
   * 5. Sign messageToSign with the user's EVM wallet (L1 signature)
   * 6. Submit to /api/v1/sendTx
   *
   * @param evmSignMessage — EVM personal_sign from the connected wallet
   * @param address — EVM L1 address (used to resolve the Lighter account index
   *                  before the first API key exists; the adapter can't infer
   *                  it from the signer alone).
   * @param apiKeyIndex — key slot (0-3 reserved; default 4)
   * @returns the generated API key and account index
   */
  async registerApiKey(
    evmSignMessage: (message: string) => Promise<string>,
    address: string,
    apiKeyIndex: number = 4,
  ): Promise<{ apiKey: string; accountIndex: number; apiKeyIndex: number }> {
    // Resolve account index from address if we haven't already — the UI
    // flow calls registerApiKey before any credentials are set, so we can
    // not rely on lighterAccountIndex being pre-populated.
    if (this.lighterAccountIndex === null) {
      const resolved = await this.resolveAccountIndex(address);
      if (resolved === null) {
        throw new Error(
          `Lighter account not found for address ${address}. ` +
          `Deposit USDC to Lighter first to create an account.`,
        );
      }
      this.lighterAccountIndex = resolved;
    }

    // 1. Initialize WasmSignerClient for key generation + ChangePubKey signing
    const { WasmSignerClient } = await import('lighter-ts-sdk');

    const isBrowser = typeof globalThis !== 'undefined'
      && typeof (globalThis as Record<string, unknown>).document !== 'undefined';
    const wasmConfig = isBrowser
      ? { wasmPath: '/wasm/lighter/lighter-signer.wasm', wasmExecPath: '/wasm/lighter/wasm_exec.js' }
      : {};

    const wasmClient = new WasmSignerClient(wasmConfig);
    await wasmClient.initialize();

    // 2. Generate new API keypair
    const keyPair = await wasmClient.generateAPIKey();
    if (!keyPair) {
      throw new Error('Failed to generate Lighter API key pair');
    }
    const { privateKey, publicKey } = keyPair;

    // 3. Fetch nonce
    const nonceRes = await this.get<{ nonce?: number; next_nonce?: number }>(
      `/api/v1/nextNonce?account_index=${this.lighterAccountIndex}&api_key_index=${apiKeyIndex}`,
    );
    const nonce = nonceRes.nonce ?? nonceRes.next_nonce ?? 0;

    // 4. Create signer client with new key and sign ChangePubKey
    await wasmClient.createClient({
      url: LIGHTER_API_URL,
      privateKey,
      chainId: 304, // Lighter mainnet chain ID
      apiKeyIndex,
      accountIndex: this.lighterAccountIndex,
    });

    // The SDK's `signChangePubKey` wrapper (lighter-ts-sdk 1.0.11) passes
    // 4 args to the underlying WASM module, but the current lighter-go
    // WASM expects 5:
    //   (pubKeyHex, skipNonce, nonce, apiKeyIndex, accountIndex).
    // We reach into `wasmClient.wasmModule` (a PRIVATE field) and call
    // `signChangePubKey` directly with `skipNonce=0`, falling back to
    // the 4-arg legacy signature if the deployed WASM is older.
    //
    // Stability caveat: this relies on an SDK internal. If you bump
    // lighter-ts-sdk verify that:
    //   1. `WasmSignerClient` still exposes a `wasmModule` field (rename
    //      to `_wasmModule` / `module` breaks us silently).
    //   2. The WASM's `signChangePubKey` arity and argument order match
    //      the `RawWasmModule` type below.
    // The runtime guard below surfaces a clear error if #1 breaks so we
    // don't hang on undefined.
    type RawWasmModule = {
      signChangePubKey: (
        pubKey: string,
        skipNonce: number,
        nonce: number,
        apiKeyIndex: number,
        accountIndex: number,
      ) => {
        txType?: number;
        txInfo?: string;
        txHash?: string;
        messageToSign?: string;
        error?: string;
      };
    };
    const rawModule = (wasmClient as unknown as { wasmModule?: RawWasmModule }).wasmModule;
    if (!rawModule || typeof rawModule.signChangePubKey !== 'function') {
      throw new Error(
        'Lighter SDK internal changed: `wasmClient.wasmModule.signChangePubKey` is not callable. ' +
        'Revert lighter-ts-sdk to a known-compatible version or port this bypass.',
      );
    }
    let signed = rawModule.signChangePubKey(
      publicKey, 0, nonce, apiKeyIndex, this.lighterAccountIndex,
    );
    // Fallback to 4-arg legacy signature if the older WASM is deployed.
    if (signed.error && String(signed.error).includes('expects 4 args')) {
      const legacy = (rawModule.signChangePubKey as unknown as (
        p: string, n: number, a: number, ai: number,
      ) => typeof signed);
      signed = legacy(publicKey, nonce, apiKeyIndex, this.lighterAccountIndex);
    }

    if (signed.error) throw new Error(`SignChangePubKey failed: ${signed.error}`);
    if (!signed.txInfo || !signed.messageToSign) {
      throw new Error('SignChangePubKey returned incomplete response');
    }

    // 5. EVM L1 signature on messageToSign
    const l1Sig = await evmSignMessage(signed.messageToSign);

    // 6. Inject L1Sig into txInfo and submit
    const txInfo = JSON.parse(signed.txInfo) as Record<string, unknown>;
    txInfo.L1Sig = l1Sig;

    const sendRes = await fetch(`${LIGHTER_API_URL}/api/v1/sendTx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        tx_type: String(signed.txType ?? 0),
        tx_info: JSON.stringify(txInfo),
      }),
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text();
      throw new Error(`ChangePubKey sendTx failed (${sendRes.status}): ${errText}`);
    }

    const result = await sendRes.json() as { code: number; message?: string };
    if (result.code !== 200) {
      throw new Error(`ChangePubKey failed: ${result.message ?? JSON.stringify(result)}`);
    }

    // 7. Store credentials for future trading. The SDK's SignerClient holds
    //    the L1 signer internally for subsequent signed ops (approveIntegrator,
    //    updateLeverage, etc.) — no separate adapter-level copy needed.
    this.setLighterCredentials(privateKey, this.lighterAccountIndex, apiKeyIndex);

    logger.info('Lighter API key registered', { accountIndex: this.lighterAccountIndex, apiKeyIndex });
    return { apiKey: privateKey, accountIndex: this.lighterAccountIndex, apiKeyIndex };
  }

  // ── Integrator Approval ──

  /**
   * Approve our integrator account on Lighter so per-order fees are attributed to us.
   *
   * 이 단계는 registerApiKey와 독립적이다 — 이미 자격증명이 설정된 후에만 호출 가능.
   * Agent key 없이는 서명할 수 없으며, 반대로 이미 등록된 자격증명만으로 충분하다.
   *
   * Lighter fee 단위 안내:
   * - Fee 값은 1/1_000_000 단위 (microUnit): 1000 = 1000/1e6 = 0.1% = 10 bps
   * - INTEGRATOR_FEE = 100 → 0.01% per-order 실제 과금
   * - 여기서 1000을 승인 상한선으로 넣는 이유: 서버가 실제로 per-order에 붙이는
   *   INTEGRATOR_FEE(100)보다 10× 높은 헤드룸을 확보해 향후 요율 조정 시 재승인 없이 가능
   *
   * Lighter tx_type 45 = TX_TYPE_APPROVE_INTEGRATOR (SDK 상수 참조).
   * Uses the SDK's public approveIntegrator() method (WasmSignerClient) which
   * handles WASM initialization, signing, and sendTx internally.
   *
   * Throws a clear error if credentials are not set.
   */
  async approveIntegrator(): Promise<void> {
    if (this.lighterAccountIndex === null || this.lighterApiKey === null) {
      throw new Error(
        'Lighter credentials not set — call registerApiKey() or setLighterCredentials() first',
      );
    }

    // 1. Ensure the WASM signer is initialized (reuses the same client as placeOrder).
    //    `ensureSignerClient` now calls `ensureWasmClient` internally — no
    //    explicit second call needed.
    const client = await this.ensureSignerClient();

    // 2. One year from now — gives headroom before re-approval needed
    const approvalExpiry = Date.now() + 365 * 24 * 60 * 60 * 1000;

    // 3. Call the SDK's public `approveIntegrator(integratorIndex, feePerps×2,
    //    feeSpot×2, approvalExpiry, nonce?)`. The SDK internally handles WASM
    //    signing (with the 10→9 arg fallback), nonce auto-management, and
    //    sendTx submission — all bits the old manual `client.wallet`-based
    //    path tried (and failed) to reproduce. The return tuple is
    //    `[rawResult, txHash, errorOrNull]`.
    //
    //    Fee headroom: 1000/1e6 = 0.1% — 10× above INTEGRATOR_FEE (0.01%).
    const clientWithApprove = client as unknown as {
      approveIntegrator: (
        integratorIndex: number,
        maxPerpsTakerFee: number,
        maxPerpsMakerFee: number,
        maxSpotTakerFee: number,
        maxSpotMakerFee: number,
        approvalExpiry: number,
        nonce?: number,
      ) => Promise<[unknown, string, string | null]>;
    };
    if (typeof clientWithApprove.approveIntegrator !== 'function') {
      throw new Error('Lighter SDK internal changed: SignerClient.approveIntegrator not found.');
    }
    const [, txHash, errOrNull] = await clientWithApprove.approveIntegrator(
      INTEGRATOR_ACCOUNT_INDEX,
      1000, 1000, 1000, 1000,
      approvalExpiry,
    );
    if (errOrNull) {
      throw new Error(`approveIntegrator failed: ${errOrNull}`);
    }
    logger.info('Lighter integrator approved', { txHash });

    logger.info('Lighter integrator approved', {
      integratorIndex: INTEGRATOR_ACCOUNT_INDEX,
      accountIndex: this.lighterAccountIndex,
    });
  }

  // ── Static Helpers ──

  private static emptyAccountState(address: string): PerpAccountState {
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

  // mapLighterOrder removed — the /account endpoint no longer ships orders,
  // and the authenticated /accountActiveOrders flow has not been wired in
  // this revision. Re-introduce alongside the corresponding adapter method.
}
