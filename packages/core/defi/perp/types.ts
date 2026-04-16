/**
 * Perp Trading Domain Types
 *
 * 프로토콜 무관 perp 거래 타입 정의.
 * LP 어댑터와 동일한 패턴 — IPerpAdapter 인터페이스 기반.
 */

// ============================================================
// Market Data
// ============================================================

export type MarketCategory = 'crypto' | 'tradfi' | 'hip3' | 'spot';
export type AssetType = 'perp' | 'spot';

export interface PerpMarket {
  readonly symbol: string;        // e.g. "BTC", "ETH", "PURR/USDC", "xyz:TSLA"
  readonly name: string;          // e.g. "BTC-PERP", "PURR-SPOT"
  /** Previous day's price (24h reference). Used to compute the 24h change
   *  column in the market selector. Sourced from HL's asset ctx `prevDayPx`. */
  readonly prevDayPx: number;
  readonly baseAsset: string;
  readonly quoteAsset: string;    // "USDC" for perps, varies for spot
  readonly maxLeverage: number;   // 1 for spot
  readonly tickSize: number;
  readonly lotSize: number;
  readonly minOrderSize: number;
  readonly makerFee: number;      // basis points — deprecated, use getUserFees()
  readonly takerFee: number;      // basis points — deprecated, use getUserFees()
  readonly fundingRate: number;   // 0 for spot
  readonly openInterest: number;  // 0 for spot
  readonly volume24h: number;
  readonly markPrice: number;
  readonly indexPrice: number;
  readonly category: MarketCategory;
  readonly assetType: AssetType;
  /** HIP-3 deployer name (e.g., 'xyz', 'flx'). null for regular perps/spot. */
  readonly dex: string | null;
  /** Spot-only: markPrice × circulatingSupply. null for perps. */
  readonly marketCap: number | null;
  /** Spot-only: base token's EVM contract address. null for perps. */
  readonly contractAddress: string | null;
}

export interface PerpDex {
  readonly name: string;
  readonly fullName: string;
  readonly deployer: string;
}

/** Hyperliquid userFees 기반 실제 수수료 정보 */
export interface UserFeeInfo {
  /** Perp taker rate (base, without discount) — e.g. 0.00045 = 0.045% */
  readonly perpTaker: number;
  /** Perp maker rate */
  readonly perpMaker: number;
  /** Spot taker rate */
  readonly spotTaker: number;
  /** Spot maker rate */
  readonly spotMaker: number;
  /** Referral 할인율 (0-1) */
  readonly referralDiscount: number;
  /** Staking 할인율 (0-1) */
  readonly stakingDiscount: number;
}

export interface OrderbookLevel {
  readonly price: number;
  readonly size: number;
  readonly numOrders?: number;
}

export interface Orderbook {
  readonly symbol: string;
  readonly bids: readonly OrderbookLevel[];
  readonly asks: readonly OrderbookLevel[];
  readonly timestamp: number;
}

export interface Trade {
  readonly id: string;
  readonly symbol: string;
  readonly price: number;
  readonly size: number;
  readonly side: OrderSide;
  readonly timestamp: number;
}

export interface Candle {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export type CandleInterval =
  | '1m' | '3m' | '5m' | '15m' | '30m'
  | '1h' | '2h' | '4h' | '6h' | '12h'
  | '1d' | '1w' | '1M';

// ============================================================
// Account & Positions
// ============================================================

/**
 * HL `activeAssetData` — per-user, per-coin trading context.
 * Returns max trade size + available-to-trade USDC for [long, short].
 * Directly drives the "Available to Trade" row in the order form.
 */
export interface PerpActiveAssetData {
  readonly user: string;
  readonly symbol: string;
  readonly leverageType: 'cross' | 'isolated';
  readonly leverageValue: number;
  /** [long, short] — USDC amount user can commit as collateral in each direction. */
  readonly availableToTrade: readonly [number, number];
  /** [long, short] — max position size user can open. */
  readonly maxTradeSizes: readonly [number, number];
  readonly markPrice: number;
}

export interface PerpAccountState {
  readonly address: string;
  /** Perp-only account value (HL `marginSummary.accountValue`).
   *  NOT the full Unified Account Portfolio Value — that also requires spot. */
  readonly totalEquity: number;
  /** Total initial margin committed across ALL perp positions (cross + isolated).
   *  HL `marginSummary.totalMarginUsed`. Drives "Unified Account Ratio". */
  readonly totalMarginUsed: number;
  /** Total notional across ALL perp positions (cross + isolated).
   *  HL `marginSummary.totalNtlPos`. Drives "Unified Account Leverage". */
  readonly totalNotional: number;
  readonly availableBalance: number;
  readonly unrealizedPnl: number;
  /** Cross maintenance margin used (HL `crossMaintenanceMarginUsed`).
   *  Shown as "Perps Maintenance Margin" — distinct from the ratio metric. */
  readonly maintenanceMargin: number;
  readonly crossMarginSummary: {
    readonly accountValue: number;
    readonly totalNtlPos: number;
    readonly totalRawUsd: number;
  };
}

export interface SpotBalance {
  readonly coin: string;
  readonly token: number;
  readonly total: string;
  readonly hold: string;
  readonly entryNtl: string;
}

export interface PerpPosition {
  readonly symbol: string;
  readonly side: OrderSide;
  readonly size: number;            // absolute size
  readonly entryPrice: number;
  readonly markPrice: number;
  readonly liquidationPrice: number | null;
  readonly unrealizedPnl: number;
  readonly realizedPnl: number;
  readonly leverage: number;
  /** 'cross' or 'isolated' — needed to separate isolated margin from cross
   *  margin in HL's Unified Account Ratio formula. */
  readonly leverageType: 'cross' | 'isolated';
  readonly marginUsed: number;
  readonly returnOnEquity: number;   // ROE %
  readonly fundingPayment: number;
}

export type OrderSide = 'long' | 'short';
export type OrderType = 'market' | 'limit' | 'stop_market' | 'stop_limit' | 'take_market' | 'take_limit';
export type OrderStatus = 'open' | 'filled' | 'partially_filled' | 'cancelled' | 'rejected' | 'triggered';
export type TimeInForce = 'gtc' | 'ioc' | 'alo';  // good-til-cancel, immediate-or-cancel, add-liquidity-only
export type TpSlTrigger = 'mark' | 'last';
export type MarginMode = 'cross' | 'isolated';

export interface PerpOrder {
  readonly orderId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly type: OrderType;
  readonly price: number | null;     // null for market orders
  readonly size: number;
  readonly filledSize: number;
  readonly status: OrderStatus;
  readonly leverage: number;
  readonly reduceOnly: boolean;
  readonly timeInForce: TimeInForce;
  readonly triggerPrice: number | null;  // for stop orders
  readonly tpPrice: number | null;
  readonly slPrice: number | null;
  readonly timestamp: number;
}

export interface Fill {
  readonly id: string;
  readonly orderId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly price: number;
  readonly size: number;
  readonly fee: number;
  readonly feeToken: string;
  readonly timestamp: number;
  readonly liquidation: boolean;
  /** Realized PnL locked in when this fill closed (part of) a position.
   *  Sourced from HL's `userFills[].closedPnl`. 0 for opening fills. */
  readonly closedPnl: number;
}

export interface FundingHistoryEntry {
  readonly timestamp: number;
  readonly symbol: string;
  readonly size: number;   // signed position size at time of funding
  readonly payment: number; // USDC amount (negative = paid, positive = received)
  readonly rate: number;   // funding rate at that time
}

// ============================================================
// Order Params
// ============================================================

export interface PlaceOrderParams {
  readonly symbol: string;
  readonly side: OrderSide;
  readonly type: OrderType;
  readonly size: number;
  readonly price?: number;           // required for limit/stop_limit
  readonly leverage: number;
  readonly reduceOnly?: boolean;
  readonly timeInForce?: TimeInForce;
  readonly triggerPrice?: number;     // for stop orders
  readonly slippageBps?: number;     // market order slippage tolerance (default 50 = 0.5%)
  readonly tpsl?: {
    readonly tp?: { price: number; trigger: TpSlTrigger };
    readonly sl?: { price: number; trigger: TpSlTrigger };
  };
  /** Agent wallet의 master address — agent key로 서명 시 필수 */
  readonly vaultAddress?: `0x${string}`;
}

export interface PlaceScaleOrderParams {
  readonly symbol: string;
  readonly side: OrderSide;
  readonly startPrice: number;
  readonly endPrice: number;
  readonly totalSize: number;
  /** 2 ~ 20 */
  readonly totalOrders: number;
  /** 0.1 ~ 10.0. 1.0 = uniform. >1 = more size at end. <1 = more size at start. */
  readonly sizeSkew: number;
  readonly timeInForce?: TimeInForce;
  readonly reduceOnly?: boolean;
  readonly vaultAddress?: `0x${string}`;
}

export interface CancelOrderParams {
  readonly symbol: string;
  readonly orderId: string;
  readonly vaultAddress?: `0x${string}`;
}

export interface ModifyOrderParams {
  readonly orderId: string;
  readonly symbol: string;
  /** Side of the order being modified — required because HL's batchModify
   *  wire format must carry `b: boolean` (true = buy/long). Sell-side
   *  modifies used to post wrong-side orders to HL before this field existed. */
  readonly side: OrderSide;
  readonly price?: number;
  readonly size?: number;
  readonly triggerPrice?: number;
  readonly vaultAddress?: `0x${string}`;
}

export interface UpdateLeverageParams {
  readonly symbol: string;
  readonly leverage: number;
  readonly marginMode: MarginMode;
  readonly vaultAddress?: `0x${string}`;
}

// ============================================================
// Results
// ============================================================

export interface OrderResult {
  readonly success: boolean;
  readonly orderId: string | null;
  readonly error?: string;
  readonly status?: OrderStatus;
}

// ============================================================
// WebSocket Channels
// ============================================================

/**
 * HL WebSocket channels — mirrors the actual wire protocol observed on
 * app.hyperliquid.xyz via Chrome DevTools `Network.webSocketFrameSent` capture.
 * See docs/guide/web/architecture/perp-hl-wire-protocol.md.
 */
export type WsChannel =
  | { type: 'orderbook'; symbol: string }
  | { type: 'trades'; symbol: string }
  | { type: 'candles'; symbol: string; interval: CandleInterval }
  | { type: 'ticker'; symbol: string }
  /** All markets' mid prices. `dex: 'ALL_DEXS'` = regular perps + HIP-3. Omit for regular perps only. */
  | { type: 'allMids'; dex?: string }
  /** Unified per-user push — positions/orders/fills/account in one snapshot */
  | { type: 'webData3'; address: string }
  /** Real-time context (funding / OI / mark / oracle / impact) for a single coin */
  | { type: 'activeAssetCtx'; symbol: string }
  /** Per-user data (leverage, availableToTrade) for a single coin */
  | { type: 'activeAssetData'; address: string; symbol: string }
  /** Live asset contexts for ALL perp DEXes (regular + HIP-3) */
  | { type: 'allDexsAssetCtxs' }
  /** Live asset contexts for all spot markets */
  | { type: 'spotAssetCtxs' }
  /**
   * Per-user clearinghouse state pushed for every perp DEX the user holds
   * exposure in (regular perps + each HIP-3 group). Replaces REST
   * polling on `clearinghouseState` — HL's own frontend subscribes to
   * this instead of calling the info endpoint.
   */
  | { type: 'allDexsClearinghouseState'; address: string }
  /**
   * Per-user live open orders push, scoped to `dex: 'ALL_DEXS'` so the
   * stream covers regular + HIP-3 orders in one subscription. Replaces
   * REST polling on `openOrders`.
   */
  | { type: 'openOrdersLive'; address: string; dex?: string }
  /**
   * Per-user fills stream. `aggregateByTime: true` matches HL frontend —
   * small partial fills are coalesced by timestamp so a single large
   * market order doesn't produce 50 individual rows. First push is a
   * snapshot; subsequent pushes are appended deltas.
   */
  | { type: 'userFillsLive'; address: string; aggregateByTime?: boolean }
  /**
   * Per-user spot clearinghouse state. Replaces REST
   * `spotClearinghouseState` — HL pushes the entire spot balances
   * snapshot whenever anything (trade, deposit, transfer) changes it.
   */
  | { type: 'spotState'; address: string }
  /**
   * Per-user historical order stream — terminal-state orders (filled,
   * canceled, rejected, triggered). Replaces REST `historicalOrders`
   * polling. First push is a snapshot of the most recent orders;
   * subsequent pushes are append-only.
   */
  | { type: 'userHistoricalOrdersLive'; address: string }
  /**
   * Per-user funding payment stream. Pushes every time the user's
   * position accrues a funding payment. Replaces REST `userFunding`
   * polling. First push is a snapshot; subsequent pushes are deltas.
   */
  | { type: 'userFundingsLive'; address: string }
  // ── Pacifica user-data channels ──
  /** Pacifica account info push (balance, equity, margin). */
  | { type: 'pacificaAccountInfo'; address: string }
  /** Pacifica open-positions push. */
  | { type: 'pacificaAccountPositions'; address: string }
  /** Pacifica open-orders delta push. */
  | { type: 'pacificaAccountOrders'; address: string }
  /** Pacifica fills (trades) push. */
  | { type: 'pacificaAccountFills'; address: string };

/** Asset context shared by activeAssetCtx + allDexsAssetCtxs + (partially) spotAssetCtxs */
export interface HlAssetCtxPayload {
  readonly funding: string;
  readonly openInterest: string;
  readonly prevDayPx: string;
  readonly dayNtlVlm: string;
  readonly premium: string;
  readonly oraclePx: string;
  readonly markPx: string;
  readonly midPx: string;
  readonly impactPxs: readonly [string, string];
  readonly dayBaseVlm: string;
}

export interface HlSpotAssetCtxPayload {
  readonly coin: string;
  readonly prevDayPx: string;
  readonly dayNtlVlm: string;
  readonly markPx: string;
  readonly midPx: string;
  readonly circulatingSupply: string;
  readonly totalSupply: string;
  readonly dayBaseVlm: string;
}

export type WsMessage =
  | { channel: 'orderbook'; data: Orderbook }
  | { channel: 'trades'; data: Trade[] }
  | { channel: 'candles'; data: Candle[] }
  | { channel: 'ticker'; data: PerpMarket }
  | { channel: 'allMids'; data: { dex: string | null; mids: Record<string, number> } }
  | { channel: 'webData3'; data: Record<string, unknown> }
  | { channel: 'activeAssetCtx'; data: { coin: string; ctx: HlAssetCtxPayload } }
  | { channel: 'activeAssetData'; data: { user: string; coin: string; leverage: { type: 'cross' | 'isolated'; value: number }; maxTradeSzs: readonly [string, string]; availableToTrade: readonly [string, string]; markPx: string } }
  | { channel: 'allDexsAssetCtxs'; data: { ctxs: ReadonlyArray<readonly [string, ReadonlyArray<HlAssetCtxPayload>]> } }
  | { channel: 'spotAssetCtxs'; data: readonly HlSpotAssetCtxPayload[] }
  /**
   * HL push shape (observed in live captures):
   *   { user, clearinghouseStates: Array<[dexName, HlUserState]> }
   * where dexName is "" for regular perps and the HIP-3 group name
   * (e.g. "xyz") for each HIP-3 deployer the user has exposure in.
   * Only the payload fields we actually consume are typed — the raw
   * HlUserState is kept as unknown and parsed via the adapter's static
   * `parseAccountState` / `parsePositions` helpers.
   */
  | { channel: 'allDexsClearinghouseState'; data: { user: string; clearinghouseStates: ReadonlyArray<readonly [string, unknown]> } }
  /** Per-user live open orders push — full array, same shape as REST openOrders. */
  | { channel: 'openOrdersLive'; data: { user: string; dex?: string; openOrders: unknown } }
  /**
   * Per-user fills push. `isSnapshot: true` on the first frame, false on
   * incremental deltas. The adapter normalizes both shapes into a `Fill[]`
   * so UI code can just `setQueryData` with the merged array.
   */
  | { channel: 'userFillsLive'; data: { isSnapshot: boolean; fills: Fill[] } }
  /** Per-user spot state push — matches REST `spotClearinghouseState.balances`. */
  | { channel: 'spotState'; data: { user: string; balances: SpotBalance[] } }
  /**
   * Per-user historical orders push — terminal-state orders. Same shape
   * as REST `historicalOrders` after parsing.
   */
  | { channel: 'userHistoricalOrdersLive'; data: { isSnapshot: boolean; orders: PerpOrder[] } }
  /** Per-user funding payment push. */
  | { channel: 'userFundingsLive'; data: { isSnapshot: boolean; fundings: FundingHistoryEntry[] } }
  // ── Pacifica user-data messages ──
  /** Pacifica account info — already-parsed, cryptic field names resolved. */
  | { channel: 'pacificaAccountInfo'; data: PerpAccountState }
  /** Pacifica positions — markPrice is entry price as WS placeholder; unrealizedPnl is 0. */
  | { channel: 'pacificaAccountPositions'; data: PerpPosition[] }
  /** Pacifica open-orders snapshot after applying WS delta. */
  | { channel: 'pacificaAccountOrders'; data: PerpOrder[] }
  /** Pacifica fills delta — new fills since last push. */
  | { channel: 'pacificaAccountFills'; data: Fill[] };

// ============================================================
// Agent Wallet
// ============================================================

export type AgentWalletState =
  | { type: 'disconnected' }
  | { type: 'generated'; agentAddress: `0x${string}`; agentPrivateKey: `0x${string}`; masterAddress: `0x${string}` }
  | { type: 'imported'; agentAddress: `0x${string}`; agentPrivateKey: `0x${string}`; masterAddress: `0x${string}` | null };

export interface ApproveAgentParams {
  readonly agentAddress: `0x${string}`;
  readonly agentName: string | null;
  /** Wallet's current chainId — used as both action.signatureChainId and EIP-712 domain.chainId.
   *  HL backend reconstructs the signing domain from signatureChainId when recovering the signer.
   *  MetaMask and some other wallets reject signTypedData_v4 unless domain.chainId === walletChainId. */
  readonly signatureChainId: number;
}

/**
 * Aster V3 agent 승인 파라미터.
 * Domain A EIP-712 서명(chainId=56)에 사용되며, approve POST body와 동일한 값을 담는다.
 */
export interface ApproveAsterAgentParams {
  readonly user: `0x${string}`;
  readonly agentAddress: `0x${string}`;
  readonly agentName: string;
  /** ms — 통상 Date.now() + 365 * 24 * 3600 * 1000 */
  readonly expiredMs: number;
  /** microsec — 통상 Date.now() * 1000. Nonce와 Expired가 서로 다른 단위임에 주의 */
  readonly nonceMicros: number;
  /** IP 제한 없으면 "" */
  readonly ipWhitelist: string;
  /** 메인 지갑의 현재 chainId — Aster는 56(BNB Chain)이어야 서명 검증 통과 */
  readonly signatureChainId: number;
  /**
   * Optional builder approval — when present, builder + maxFeeRate are
   * approved in the same atomic call. Server signs them into the same
   * EIP-712 typed struct as ApproveAgent.
   * Official /fapi/v3/approveAgent spec accepts optional builder fields:
   * "Builder authorization can be done together during Agent approval,
   *  or separately after Agent approval."
   */
  readonly builder?: `0x${string}`;
  readonly maxFeeRate?: string;
  readonly builderName?: string;
}

/**
 * Aster V3 builder 승인 파라미터.
 *
 * POST body: `{ user, nonce, signature, builder, maxFeeRate }`
 * Signed struct primaryType = 'ApproveBuilder' on the same Domain A
 * (chainId=56) used by ApproveAgent. Aster capitalises every body field
 * when folding it into the typed struct (builder→Builder, maxFeeRate→
 * MaxFeeRate) per the authentication doc.
 */
export interface ApproveAsterBuilderParams {
  readonly user: `0x${string}`;
  readonly builder: `0x${string}`;
  /**
   * Max fee rate cap as a decimal string (e.g. "0.001" = 0.1%). Aster
   * recommends sending this as a string to avoid JS float drift — the
   * server compares it against each order's feeRate using the same
   * textual representation.
   */
  readonly maxFeeRate: string;
  /** microsec — matches ApproveAgent nonce scale for consistency */
  readonly nonceMicros: number;
  /** 메인 지갑의 현재 chainId — Aster는 56(BNB Chain)이어야 서명 검증 통과 */
  readonly signatureChainId: number;
}

/**
 * HL `approveBuilderFee` — grants a builder (frontend operator) permission
 * to charge a per-trade fee up to `maxFeeRate`. The fee charged on each
 * order (`builder.f` in tenths-of-basis-points) must be ≤ this cap.
 *
 * HL blocks any order with `builder.*` until the user has signed one of
 * these approvals, surfacing `"Builder fee has not been approved."` from
 * the exchange. The approval MUST be signed by the main wallet — agent
 * wallets cannot sign user-level actions.
 *
 * Docs: https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes
 */
export interface ApproveBuilderFeeParams {
  /** Builder EOA that will receive fees. Must match `builder.b` on placeOrder. */
  readonly builderAddress: `0x${string}`;
  /** Cap on what this builder can charge, expressed as a percent string
   *  ("0.1%" = 10 basis points). HL enforces hard caps: perps ≤ 0.1%,
   *  spot ≤ 1%. A single user can have at most 10 concurrent approvals. */
  readonly maxFeeRate: string;
  /** Main wallet's current chainId — see ApproveAgentParams.signatureChainId. */
  readonly signatureChainId: number;
}

// ============================================================
// Transfer
// ============================================================

export interface DepositParams {
  readonly amount: number;        // USDC amount
  readonly fromAddress: string;
}

export interface WithdrawParams {
  readonly amount: number;
  readonly toAddress: string;
  /** Wallet's current chainId — same requirement as ApproveAgentParams.signatureChainId. */
  readonly signatureChainId: number;
}

// ============================================================
// Adapter Interface
// ============================================================

export interface IPerpAdapter {
  readonly protocolId: string;
  readonly displayName: string;

  // Market data (REST)
  getMarkets(): Promise<PerpMarket[]>;
  getOrderbook(symbol: string, nSigFigs?: number): Promise<Orderbook>;
  getTrades(symbol: string, limit?: number): Promise<Trade[]>;
  /**
   * Fetch candles ending at `endTime` (inclusive, ms). Defaults to now.
   * Chart's infinite-scroll passes the oldest loaded candle's timestamp
   * to fetch the next older page. Must match PerpAdapterBase.getCandles.
   */
  getCandles(symbol: string, interval: CandleInterval, limit?: number, endTime?: number): Promise<Candle[]>;

  // User fees (실제 user별 수수료 rate)
  getUserFees(address: string): Promise<UserFeeInfo>;

  // HIP-3 deployer list
  getPerpDexs(): Promise<PerpDex[]>;

  // Account (REST)
  getAccountState(address: string): Promise<PerpAccountState>;
  getPositions(address: string): Promise<PerpPosition[]>;
  getOpenOrders(address: string): Promise<PerpOrder[]>;
  getOrderHistory(address: string, limit?: number): Promise<PerpOrder[]>;
  getFills(address: string, limit?: number): Promise<Fill[]>;
  getFundingHistory(address: string, startTime?: number): Promise<FundingHistoryEntry[]>;

  // Trading (REST — requires signing)
  placeOrder(params: PlaceOrderParams, signFn: EIP712SignFn): Promise<OrderResult>;
  placeScaleOrder(params: PlaceScaleOrderParams, signFn: EIP712SignFn): Promise<OrderResult>;
  cancelOrder(params: CancelOrderParams, signFn: EIP712SignFn): Promise<OrderResult>;
  modifyOrder(params: ModifyOrderParams, signFn: EIP712SignFn): Promise<OrderResult>;
  updateLeverage(params: UpdateLeverageParams, signFn: EIP712SignFn): Promise<void>;

  // WebSocket
  subscribe(channel: WsChannel, callback: (msg: WsMessage) => void): Unsubscribe;
  disconnect(): void;

  // Transfers
  deposit(params: DepositParams, signFn: EIP712SignFn): Promise<string>;
  withdraw(params: WithdrawParams, signFn: EIP712SignFn): Promise<string>;
}

/** EIP-712 서명 함수 — wallet adapter에서 주입 */
export type EIP712SignFn = (payload: {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}) => Promise<`0x${string}`>;

export type Unsubscribe = () => void;
