/**
 * HyperliquidPerpAdapter — Hyperliquid L1 perp 거래 어댑터
 *
 * Hyperliquid API 구조:
 * - POST /info  — 읽기 (market data, account state, positions)
 * - POST /exchange — 쓰기 (주문, 취소, 출금 — EIP-712 서명 필요)
 * - WSS wss://api.hyperliquid.xyz/ws — 실시간 데이터
 *
 * EIP-712 도메인: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: "0x..." }
 */

import { AdapterError, ApiError, ValidationError } from '@hq/core/lib/error';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, toHex, concat, numberToBytes } from 'viem';
import { encode as msgpackEncode } from '@msgpack/msgpack';
import { PerpAdapterBase } from '../PerpAdapterBase';
import type {
  PerpMarket,
  Orderbook,
  OrderbookLevel,
  Trade,
  Candle,
  CandleInterval,
  PerpAccountState,
  SpotBalance,
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
  ApproveAgentParams,
  ApproveBuilderFeeParams,
  UserFeeInfo,
  PerpDex,
  FundingHistoryEntry,
  OrderSide,
  OrderStatus,
  OrderType,
  TimeInForce,
  PerpActiveAssetData,
} from '../types';
import { createLogger } from '@hq/core/logging';

const logger = createLogger('perp:hyperliquid');

// ============================================================
// Hyperliquid API Constants
// ============================================================

const HL_API_URL = 'https://api.hyperliquid.xyz';
const HL_WS_URL = 'wss://api.hyperliquid.xyz/ws';

/**
 * Ping interval to keep WS alive.
 * Hyperliquid docs: server drops connections that have not received a
 * message from the client in the last 60s. We send { method: "ping" }
 * every 30s to stay well under that threshold.
 * https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket
 */
const WS_PING_INTERVAL_MS = 30_000;
const WS_RECONNECT_DELAY_MS = 3_000;

/**
 * Builder fee: included in all order actions.
 * `b` = builder address (must be registered as HL builder), `f` = fee in 1/10 bps.
 * f=1 → 0.01% per trade. Replace BUILDER_ADDRESS after registering at HL.
 *
 * IMPORTANT: MUST be lowercase. HL normalizes to lowercase before msgpack
 * re-encoding on the server side; if our client sends mixed-case, the
 * server's recomputed connectionId differs from ours and the recovered
 * signer address comes out wrong ("User or API Wallet 0x... does not exist").
 */
export const BUILDER_ADDRESS = '0x362294a899b304c933135781bb1f976ed8062781' as const;
/**
 * Per-order builder fee in tenths of a basis point (HL's native unit on
 * `order.builder.f`). 1 = 0.1 bp = 0.001%.
 *
 * `BUILDER_MAX_FEE_RATE` is the human-readable cap we ask the user to
 * approve once via `approveBuilderFee` — HL requires that the approved
 * ceiling is ≥ whatever we charge on any single order. We pick a value
 * slightly above `BUILDER_FEE` so we have headroom to bump the per-order
 * rate without asking for a new signature every time.
 */
const BUILDER_FEE = 1; // 1/10 bps = 0.001%
/** Cap sent to `approveBuilderFee`. Percent string as HL expects. */
export const BUILDER_MAX_FEE_RATE = '0.01%';

const EIP712_DOMAIN = {
  name: 'Exchange',
  version: '1',
  chainId: 1337,
  verifyingContract: '0x0000000000000000000000000000000000000000',
} as const;

/** User-signed action domain. chainId is dynamic — must match wallet's current chain. */
const USER_SIGNED_DOMAIN_NAME = 'HyperliquidSignTransaction';
const USER_SIGNED_DOMAIN_VERSION = '1';
const USER_SIGNED_DOMAIN_VERIFYING_CONTRACT = '0x0000000000000000000000000000000000000000' as const;

// ============================================================
// Hyperliquid Raw API Types (internal)
// ============================================================

interface HlMeta {
  universe: Array<{
    name: string;
    szDecimals: number;
    maxLeverage: number;
    onlyIsolated: boolean;
  }>;
  /** Token index for the collateral/quote asset (0=USDC, 235=USDE, 360=USDH).
   *  Present in allPerpMetas per-dex entries. */
  collateralToken?: number;
}

interface HlAssetCtx {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string;
  oraclePx: string;
  markPx: string;
  midPx: string;
  impactPxs: [string, string];
}

interface HlSpotToken {
  name: string;
  szDecimals: number;
  weiDecimals: number;
  index: number;
  tokenId: string;
  isCanonical: boolean;
  evmContract?: { address: string };
}

interface HlSpotMeta {
  tokens: HlSpotToken[];
  universe: Array<{
    tokens: [number, number];
    name: string;
    index: number;
    isCanonical: boolean;
  }>;
}

interface HlSpotAssetCtx {
  prevDayPx: string;
  dayNtlVlm: string;
  markPx: string;
  midPx: string;
  circulatingSupply: string;
  coin: string;
  totalSupply: string;
  dayBaseVlm: string;
}

interface HlUserState {
  marginSummary: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  crossMarginSummary: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  crossMaintenanceMarginUsed: string;
  withdrawable: string;
  assetPositions: Array<{
    position: {
      coin: string;
      szi: string;
      entryPx: string;
      positionValue: string;
      unrealizedPnl: string;
      returnOnEquity: string;
      liquidationPx: string | null;
      leverage: { type: string; value: number };
      marginUsed: string;
      cumFunding: { sinceOpen: string; allTime: string };
    };
  }>;
}

/** Raw HL openOrders element shape — used by both REST and WS parse paths */
interface HlOpenOrder {
  coin: string;
  side: string;
  limitPx: string;
  sz: string;
  oid: number;
  timestamp: number;
  origSz: string;
  reduceOnly: boolean;
  orderType: string;
  triggerPx?: string;
  tpsl?: string;
}

interface HlOrderWire {
  a: number;   // asset index
  b: boolean;  // is buy
  p: string;   // price
  s: string;   // size
  r: boolean;  // reduce only
  t: { limit: { tif: string } } | { trigger: { isMarket: boolean; triggerPx: string; tpsl: string } };
}

// ============================================================
// Adapter Implementation
// ============================================================

export class HyperliquidPerpAdapter extends PerpAdapterBase {
  readonly protocolId = 'hyperliquid';
  readonly displayName = 'Hyperliquid';

  private ws: WebSocket | null = null;
  private wsSubscriptions = new Map<string, Set<(msg: WsMessage) => void>>();
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsPingTimer: ReturnType<typeof setInterval> | null = null;
  private wsHasBeenConnected = false;
  private wsReconnectListeners = new Set<() => void>();
  private metaCache: HlMeta | null = null;
  /**
   * Symbol → {
   *   assetIdx:  index within the owning meta's universe (perps) or 0 for spot,
   *   dexIdx:    null for regular/spot, N for HIP-3 builder-deployed perps
   *              where N is the index into `allPerpMetas` (1-based; 0 is
   *              reserved for regular perps),
   *   spotIdx:   null for perps, pair.index for spot (used as the asset-ID
   *              offset: `10000 + spotIdx`),
   *   szDecimals: size decimals for the asset
   * }
   *
   * Asset-ID encoding (see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/asset-ids):
   *   Regular perp:  assetIdx
   *   HIP-3 perp:    100000 + dexIdx * 10000 + assetIdx
   *   Spot:          10000 + spotIdx
   */
  private assetIndexMap = new Map<string, {
    assetIdx: number;
    dexIdx: number | null;
    spotIdx: number | null;
    szDecimals: number;
  }>();
  /** In-flight or resolved perpDexs response cache. Invalidated on disconnect. */
  private perpDexsPromise: Promise<Array<null | { name: string; fullName: string; deployer: string }>> | null = null;

  constructor(
    private readonly apiUrl: string = HL_API_URL,
    private readonly wsUrl: string = HL_WS_URL,
  ) {
    super();
  }

  // ── REST Helpers ──

  private async postInfo<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${this.apiUrl}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...payload }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(`Hyperliquid /info error (${res.status}): ${text}`, res.status, 'HTTP', null, text, text);
    }
    return res.json() as Promise<T>;
  }

  private async postExchange(action: Record<string, unknown>, signature: `0x${string}`, nonce: number, vaultAddress?: `0x${string}`): Promise<unknown> {
    const body: Record<string, unknown> = {
      action,
      nonce,
      signature: {
        r: signature.slice(0, 66),
        s: '0x' + signature.slice(66, 130),
        v: parseInt(signature.slice(130, 132), 16),
      },
    };
    if (vaultAddress) {
      body.vaultAddress = vaultAddress;
    }
    const res = await fetch(`${this.apiUrl}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(`Hyperliquid /exchange error (${res.status}): ${text}`, res.status, 'HTTP', null, text, text);
    }
    return res.json();
  }

  private async ensureMeta(): Promise<HlMeta> {
    if (this.metaCache) return this.metaCache;
    this.metaCache = await this.postInfo<HlMeta>('meta');
    // NOTE: do NOT clear `assetIndexMap` here. `getMarkets()` may have
    // already populated it with HIP-3 + spot entries — clearing would
    // drop them and cause "Unknown symbol: @N" on subsequent orders.
    // `.set()` overwrites any stale regular-perp entries with fresh
    // szDecimals, which is the only thing `meta` alone can refresh.
    this.metaCache.universe.forEach((asset, idx) => {
      this.assetIndexMap.set(asset.name, { assetIdx: idx, dexIdx: null, spotIdx: null, szDecimals: asset.szDecimals });
    });
    return this.metaCache;
  }

  private getAssetEntry(symbol: string): { assetIdx: number; dexIdx: number | null; spotIdx: number | null; szDecimals: number } {
    const entry = this.assetIndexMap.get(symbol);
    if (entry === undefined) throw new ValidationError(`Unknown symbol: ${symbol}`);
    return entry;
  }

  /**
   * Asset ID expected by HL `/exchange` for the `a` field on order actions
   * and the `asset` field on `updateLeverage`, per:
   *   https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/asset-ids
   *
   * - Regular perps: `assetIdx` (index in the main meta universe)
   * - HIP-3 builder-deployed perps: `100000 + dexIdx * 10000 + assetIdx`
   *   where `dexIdx` is the 1-based index into `allPerpMetas` (0 reserved
   *   for regular perps, 1..N = HIP-3 dexes in response order).
   * - Spot: `10000 + spotIdx` where `spotIdx` is the pair.index in spotMeta.universe.
   */
  private getOrderAssetId(symbol: string): number {
    const { assetIdx, dexIdx, spotIdx } = this.getAssetEntry(symbol);
    if (spotIdx !== null) return 10_000 + spotIdx;
    if (dexIdx === null) return assetIdx;
    return 100_000 + dexIdx * 10_000 + assetIdx;
  }

  private getNonce(): number {
    return Date.now();
  }

  /**
   * HL L1 action hash: keccak256(msgpack(action) || nonce_8bytes_BE || vaultAddressByte)
   *
   * Vault byte encoding:
   *   - null/undefined vaultAddress → 0x00
   *   - with vaultAddress → 0x01 || 20 bytes of address
   */
  private buildL1ActionHash(action: Record<string, unknown>, nonce: number, vaultAddress?: `0x${string}`): `0x${string}` {
    const packed = msgpackEncode(action);
    const nonceBytes = numberToBytes(BigInt(nonce), { size: 8 });

    let vaultBytes: Uint8Array;
    if (vaultAddress) {
      const addrBytes = new Uint8Array(20);
      const hex = vaultAddress.replace(/^0x/, '');
      for (let i = 0; i < 20; i++) {
        addrBytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      vaultBytes = new Uint8Array(21);
      vaultBytes[0] = 0x01;
      vaultBytes.set(addrBytes, 1);
    } else {
      vaultBytes = new Uint8Array([0x00]);
    }

    const concatenated = concat([
      new Uint8Array(packed as Uint8Array),
      nonceBytes,
      vaultBytes,
    ]);

    return keccak256(toHex(concatenated));
  }

  /**
   * HL L1 action signing — action → actionHash → phantomAgent → EIP-712 sign.
   * Mainnet uses source: 'a', testnet uses source: 'b'.
   */
  private async signL1Action(
    action: Record<string, unknown>,
    nonce: number,
    vaultAddress: `0x${string}` | undefined,
    signFn: EIP712SignFn,
  ): Promise<`0x${string}`> {
    const connectionId = this.buildL1ActionHash(action, nonce, vaultAddress);
    const phantomAgent = {
      source: 'a', // mainnet
      connectionId,
    };

    return signFn({
      domain: { ...EIP712_DOMAIN },
      types: {
        Agent: [
          { name: 'source', type: 'string' },
          { name: 'connectionId', type: 'bytes32' },
        ],
      },
      primaryType: 'Agent',
      message: phantomAgent,
    });
  }

  // ============================================================
  // Market Data
  // ============================================================

  async getMarkets(): Promise<PerpMarket[]> {
    // HL sequence (verified via CDP capture):
    //   1. metaAndAssetCtxs → regular perp meta + initial ctxs (fast paint)
    //   2. allPerpMetas    → Array<HlMeta>, index 0 = regular, 1..N = HIP-3
    //                        metas only (NO ctxs — HL streams those via
    //                        allDexsAssetCtxs WS after load)
    //   3. perpDexs        → HIP-3 deployer name list (cached)
    //   4. spotMetaAndAssetCtxs → spot meta + ctxs
    //
    // HIP-3 ctxs are initially stubbed with zeros; useRealtimeAllDexsAssetCtxs
    // + useRealtimeAllMids populate them within the first second.
    const [metaAndCtxs, allPerpMetas, perpDexsRaw] = await Promise.all([
      this.postInfo<[HlMeta, HlAssetCtx[]]>('metaAndAssetCtxs'),
      this.postInfo<Array<HlMeta>>('allPerpMetas'),
      this.fetchPerpDexsCached(),
    ]);
    const [regularMeta, regularCtxs] = metaAndCtxs;

    this.metaCache = regularMeta;
    // Don't clear the map on refetch — if HIP-3 or spot fetch below fails
    // (rate limit, transient outage), we'd lose their entries and spot
    // orders would start throwing "Unknown symbol: @N". `.set()` overwrites
    // regular-perp entries in place; stale rows for delisted symbols are
    // harmless (the exchange rejects orders for them anyway).
    regularMeta.universe.forEach((asset, idx) => {
      this.assetIndexMap.set(asset.name, { assetIdx: idx, dexIdx: null, spotIdx: null, szDecimals: asset.szDecimals });
    });

    const markets: PerpMarket[] = regularMeta.universe.map((asset, i) =>
      this.buildMarket(asset, regularCtxs[i], 'crypto'),
    );

    // HIP-3 perps — fetch real ctxs per dex via metaAndAssetCtxs(dex=name).
    // perpDexs index aligns with allPerpMetas index: [null, dex1, dex2, ...].
    // Each dex has a `collateralToken` index (0=USDC, 235=USDE, 360=USDH)
    // that determines the quote asset for its markets.
    const COLLATERAL_TOKEN_NAMES: Record<number, string> = {
      0: 'USDC', 235: 'USDE', 268: 'USDT0', 360: 'USDH',
    };
    // Fetch ctxs for all HIP-3 dexes in parallel.
    // We retain the original `i` (index into allPerpMetas) as `dexIdx` —
    // it is the value HL expects in the asset-ID encoding
    // `100000 + dexIdx * 10000 + assetIdx` for /exchange order actions.
    const hip3Dexes: Array<{
      dexIdx: number;
      dexEntry: { name: string; fullName: string; deployer: string };
      dexMeta: HlMeta;
    }> = [];
    for (let i = 1; i < allPerpMetas.length; i++) {
      const dexEntry = perpDexsRaw[i];
      const dexMeta = allPerpMetas[i];
      if (!dexEntry || !dexMeta?.universe) continue;
      hip3Dexes.push({ dexIdx: i, dexEntry, dexMeta });
    }
    const hip3CtxResults = await Promise.all(
      hip3Dexes.map(({ dexEntry }) =>
        this.postInfo<[HlMeta, HlAssetCtx[]]>('metaAndAssetCtxs', { dex: dexEntry.name })
          .then(([, ctxs]) => ctxs)
          .catch(() => null),
      ),
    );
    for (let j = 0; j < hip3Dexes.length; j++) {
      const { dexIdx, dexEntry, dexMeta } = hip3Dexes[j];
      const ctxs = hip3CtxResults[j];
      const collateralIdx = dexMeta.collateralToken ?? 0;
      const quoteAsset = COLLATERAL_TOKEN_NAMES[collateralIdx] ?? 'USDC';
      dexMeta.universe.forEach((asset, assetIdx) => {
        this.assetIndexMap.set(asset.name, { assetIdx, dexIdx, spotIdx: null, szDecimals: asset.szDecimals });
        const ctx = ctxs?.[assetIdx];
        if (ctx) {
          markets.push(this.buildMarket(asset, ctx, 'hip3', dexEntry.name, quoteAsset));
        }
      });
    }

    // 3) Spot markets
    try {
      const spotRaw = await this.postInfo<[HlSpotMeta, HlSpotAssetCtx[]]>('spotMetaAndAssetCtxs');
      const [spotMeta, spotCtxs] = spotRaw;
      const tokenMap = new Map(spotMeta.tokens.map(t => [t.index, t]));
      // HL's universe (290 pairs) and ctxs (308 entries) arrays differ
      // in length — positional mapping `ctxs[i]` is WRONG. Instead,
      // match by `pair.name → ctx.coin` (both use the same identifier:
      // "PURR/USDC" for canonical, "@N" for non-canonical).
      const ctxByCoin = new Map(spotCtxs.map(c => [c.coin, c]));

      // Pass 1: register EVERY pair in assetIndexMap regardless of mark
      // price. The asset-ID mapping is a static property of the pair
      // (spot_id = 10000 + pair.index) — it must not depend on volatile
      // market data, or an illiquid pair (markPx=0) becomes un-orderable
      // via its cached market row.
      spotMeta.universe.forEach((pair) => {
        const [baseIdx] = pair.tokens;
        const baseTk = tokenMap.get(baseIdx);
        if (!baseTk) return;
        // ctx.coin === pair.name for spot, so key the map by pair.name
        // so this registration happens even when ctx is missing.
        this.assetIndexMap.set(pair.name, {
          assetIdx: 0,
          dexIdx: null,
          spotIdx: pair.index,
          szDecimals: baseTk.szDecimals,
        });
      });

      // Pass 2: push market rows for pairs with a valid mark price.
      spotMeta.universe.forEach((pair) => {
        const ctx = ctxByCoin.get(pair.name);
        if (!ctx) return;
        const [baseIdx, quoteIdx] = pair.tokens;
        const baseTk = tokenMap.get(baseIdx);
        const quoteTk = tokenMap.get(quoteIdx);
        if (!baseTk || !quoteTk) return;

        const markPrice = parseFloat(ctx.markPx);
        if (!isFinite(markPrice) || markPrice <= 0) return;

        const circulatingSupply = parseFloat(ctx.circulatingSupply);
        const marketCap = isFinite(circulatingSupply) ? markPrice * circulatingSupply : null;

        // Canonical pairs have pair.name like "PURR/USDC" (human-readable).
        // Non-canonical (most spot) have pair.name = "@1" (index).
        // For non-canonical, construct the display name from the underlying
        // token names (baseTk.name / quoteTk.name). The symbol field stays
        // as ctx.coin (e.g., "@1") because HL WS channels reference it.
        const isCanonicalPair = pair.name.includes('/');
        const baseSymbol = isCanonicalPair ? pair.name.split('/')[0] : baseTk.name;
        const quoteSymbol = isCanonicalPair ? pair.name.split('/')[1] : quoteTk.name;
        const displayName = `${baseSymbol}/${quoteSymbol}`;

        markets.push({
          symbol: ctx.coin,
          name: displayName,
          baseAsset: baseSymbol,
          quoteAsset: quoteSymbol,
          maxLeverage: 1,
          tickSize: HyperliquidPerpAdapter.computeTickSize(markPrice, baseTk.szDecimals, true),
          lotSize: Math.pow(10, -baseTk.szDecimals),
          minOrderSize: Math.pow(10, -baseTk.szDecimals),
          makerFee: 0,  // deprecated — use getUserFees() for actual rates
          takerFee: 0,
          fundingRate: 0,
          openInterest: 0,
          volume24h: parseFloat(ctx.dayNtlVlm),
          markPrice,
          indexPrice: markPrice,
          prevDayPx: parseFloat(ctx.prevDayPx),
          category: 'spot',
          assetType: 'spot',
          dex: null,
          marketCap,
          contractAddress: baseTk.evmContract?.address ?? null,
        });
      });
    } catch (err) {
      logger.warn('Failed to fetch spot markets', { err });
    }

    return markets;
  }

  /** HIP-3 deployer 목록 */
  async getPerpDexs(): Promise<PerpDex[]> {
    try {
      const raw = await this.fetchPerpDexsCached();
      return raw
        .filter((d): d is { name: string; fullName: string; deployer: string } => d !== null)
        .map(d => ({ name: d.name, fullName: d.fullName ?? d.name, deployer: d.deployer }));
    } catch (err) {
      logger.warn('getPerpDexs failed', { err });
      return [];
    }
  }

  /**
   * Cached perpDexs fetch. The HL `perpDexs` response (HIP-3 deployer list)
   * is effectively static per session — deploy events are rare. Both
   * getMarkets() and getPerpDexs() share this promise so there's only one
   * POST per instance lifetime.
   */
  private fetchPerpDexsCached(): Promise<Array<null | { name: string; fullName: string; deployer: string }>> {
    if (!this.perpDexsPromise) {
      this.perpDexsPromise = this.postInfo<Array<null | { name: string; fullName: string; deployer: string }>>('perpDexs')
        .catch((err) => {
          // On failure, clear the cache so the next caller retries.
          this.perpDexsPromise = null;
          throw err;
        });
    }
    return this.perpDexsPromise;
  }

  /** HL `activeAssetData` — per-user per-coin available-to-trade + max size. */
  async getActiveAssetData(address: string, symbol: string): Promise<PerpActiveAssetData> {
    const raw = await this.postInfo<{
      user: string;
      coin: string;
      leverage: { type: 'cross' | 'isolated'; value: number };
      maxTradeSzs: [string, string];
      availableToTrade: [string, string];
      markPx: string;
    }>('activeAssetData', { user: address, coin: symbol });
    return HyperliquidPerpAdapter.parseActiveAssetData(raw);
  }

  /**
   * Pure parser for activeAssetData — shared by REST + WS paths. Used by
   * the order form's "Available to Trade" row which must reflect HL's
   * per-coin, per-direction computation, not the account-wide withdrawable.
   */
  static parseActiveAssetData(raw: {
    user: string;
    coin: string;
    leverage: { type: 'cross' | 'isolated'; value: number };
    maxTradeSzs: readonly [string, string];
    availableToTrade: readonly [string, string];
    markPx: string;
  }): PerpActiveAssetData {
    return {
      user: raw.user,
      symbol: raw.coin,
      leverageType: raw.leverage.type,
      leverageValue: raw.leverage.value,
      availableToTrade: [parseFloat(raw.availableToTrade[0]), parseFloat(raw.availableToTrade[1])],
      maxTradeSizes: [parseFloat(raw.maxTradeSzs[0]), parseFloat(raw.maxTradeSzs[1])],
      markPrice: parseFloat(raw.markPx),
    };
  }

  /** Hyperliquid userFees → UserFeeInfo */
  async getUserFees(address: string): Promise<UserFeeInfo> {
    try {
      const res = await this.postInfo<{
        userCrossRate: string;
        userAddRate: string;
        userSpotCrossRate: string;
        userSpotAddRate: string;
        activeReferralDiscount: string;
        activeStakingDiscount: { discount: string };
      }>('userFees', { user: address });

      return {
        perpTaker: parseFloat(res.userCrossRate),
        perpMaker: parseFloat(res.userAddRate),
        spotTaker: parseFloat(res.userSpotCrossRate),
        spotMaker: parseFloat(res.userSpotAddRate),
        referralDiscount: parseFloat(res.activeReferralDiscount),
        stakingDiscount: parseFloat(res.activeStakingDiscount?.discount ?? '0'),
      };
    } catch (err) {
      logger.warn('getUserFees failed, returning defaults', { err });
      return {
        perpTaker: 0.00045,
        perpMaker: 0.00015,
        spotTaker: 0.0007,
        spotMaker: 0.0004,
        referralDiscount: 0,
        stakingDiscount: 0,
      };
    }
  }

  // Tradfi 마켓 식별자 (S&P500, NDX, NIKKEI 등)
  private static readonly TRADFI_SYMBOLS = new Set([
    'S&P500', 'SPX', 'NDX', 'NIKKEI', 'DJIA', 'FTSE', 'DAX', 'GOLD', 'SILVER', 'OIL', 'WTI', 'BRENT', 'PAXG',
  ]);

  private buildMarket(
    asset: { name: string; szDecimals: number; maxLeverage: number; onlyIsolated?: boolean },
    ctx: HlAssetCtx,
    defaultCategory: 'crypto' | 'hip3',
    dex: string | null = null,
    quoteAsset: string = 'USDC',
  ): PerpMarket {
    // HIP-3 심볼 "xyz:TSLA" → baseAsset "TSLA"
    // crypto 심볼 "BTC" → baseAsset "BTC"
    const rawName = asset.name;
    const baseAsset = rawName.includes(':')
      ? rawName.split(':', 2)[1]
      : rawName;
    const isTradfi = HyperliquidPerpAdapter.TRADFI_SYMBOLS.has(baseAsset);
    const category = isTradfi ? 'tradfi' : defaultCategory;

    const markPx = parseFloat(ctx.markPx);
    return {
      symbol: rawName,
      name: `${baseAsset}-${quoteAsset}`,
      baseAsset,
      quoteAsset,
      maxLeverage: asset.maxLeverage,
      tickSize: HyperliquidPerpAdapter.computeTickSize(markPx, asset.szDecimals, false),
      lotSize: Math.pow(10, -asset.szDecimals),
      minOrderSize: Math.pow(10, -asset.szDecimals),
      makerFee: 0,  // deprecated — use getUserFees() for actual rates
      takerFee: 0,
      fundingRate: parseFloat(ctx.funding),
      openInterest: parseFloat(ctx.openInterest),
      volume24h: parseFloat(ctx.dayNtlVlm),
      markPrice: parseFloat(ctx.markPx),
      indexPrice: parseFloat(ctx.oraclePx),
      prevDayPx: parseFloat(ctx.prevDayPx),
      category,
      assetType: 'perp',
      dex,
      marketCap: null,
      contractAddress: null,
    };
  }

  async getOrderbook(symbol: string, nSigFigs?: number): Promise<Orderbook> {
    const payload: Record<string, unknown> = { coin: symbol };
    if (nSigFigs !== undefined) payload.nSigFigs = nSigFigs;
    const raw = await this.postInfo<{
      levels: [Array<{ px: string; sz: string; n: number }>, Array<{ px: string; sz: string; n: number }>];
    }>('l2Book', payload);

    const mapLevel = (l: { px: string; sz: string; n: number }): OrderbookLevel => ({
      price: parseFloat(l.px),
      size: parseFloat(l.sz),
      numOrders: l.n,
    });

    return {
      symbol,
      bids: raw.levels[0].map(mapLevel),
      asks: raw.levels[1].map(mapLevel),
      timestamp: Date.now(),
    };
  }

  async getTrades(symbol: string, limit: number = 100): Promise<Trade[]> {
    const raw = await this.postInfo<Array<{
      coin: string;
      side: string;
      px: string;
      sz: string;
      time: number;
      hash: string;
    }>>('recentTrades', { coin: symbol });

    return raw.slice(0, limit).map(t => ({
      id: t.hash,
      symbol: t.coin,
      price: parseFloat(t.px),
      size: parseFloat(t.sz),
      side: t.side === 'B' ? 'long' as const : 'short' as const,
      timestamp: t.time,
    }));
  }

  async getCandles(
    symbol: string,
    interval: CandleInterval,
    limit: number = 300,
    endTime: number = Date.now(),
  ): Promise<Candle[]> {
    const intervalMs = this.intervalToMs(interval);
    const startTime = endTime - intervalMs * limit;

    const raw = await this.postInfo<Array<{
      t: number; o: string; h: string; l: string; c: string; v: string;
    }>>('candleSnapshot', {
      req: {
        coin: symbol,
        interval,
        startTime,
        endTime,
      },
    });

    return raw.map(c => ({
      timestamp: c.t,
      open: parseFloat(c.o),
      high: parseFloat(c.h),
      low: parseFloat(c.l),
      close: parseFloat(c.c),
      volume: parseFloat(c.v),
    }));
  }

  // ============================================================
  // Account
  // ============================================================

  async getAccountState(address: string): Promise<PerpAccountState> {
    const state = await this.postInfo<HlUserState>('clearinghouseState', { user: address });
    return HyperliquidPerpAdapter.parseAccountState(address, state);
  }

  /**
   * Parse clearinghouseState → PerpAccountState.
   * Exposed as a pure static so WS hooks (useRealtimeWebData3) can patch
   * the cache directly without going through REST.
   */
  static parseAccountState(address: string, state: HlUserState): PerpAccountState {
    return {
      address,
      // marginSummary covers cross + isolated perp; do NOT use crossMarginSummary
      // here since Unified Account metrics must include isolated positions too.
      totalEquity: parseFloat(state.marginSummary.accountValue),
      totalMarginUsed: parseFloat(state.marginSummary.totalMarginUsed),
      totalNotional: parseFloat(state.marginSummary.totalNtlPos),
      // HL의 'withdrawable'가 실제 available to trade — accountValue - marginUsed가 아님
      availableBalance: parseFloat(state.withdrawable),
      unrealizedPnl: state.assetPositions.reduce(
        (sum, ap) => sum + parseFloat(ap.position.unrealizedPnl),
        0,
      ),
      maintenanceMargin: parseFloat(state.crossMaintenanceMarginUsed),
      crossMarginSummary: {
        accountValue: parseFloat(state.crossMarginSummary.accountValue),
        totalNtlPos: parseFloat(state.crossMarginSummary.totalNtlPos),
        totalRawUsd: parseFloat(state.crossMarginSummary.totalRawUsd),
      },
    };
  }

  async getSpotBalances(address: string): Promise<SpotBalance[]> {
    const state = await this.postInfo<{ balances: Array<{ coin: string; token: number; total: string; hold: string; entryNtl: string }> }>(
      'spotClearinghouseState',
      { user: address },
    );
    return state.balances;
  }

  async getPositions(address: string): Promise<PerpPosition[]> {
    const state = await this.postInfo<HlUserState>('clearinghouseState', { user: address });
    return HyperliquidPerpAdapter.parsePositions(state);
  }

  /**
   * Parse clearinghouseState → PerpPosition[].
   * Exposed as a pure static so WS hooks (useRealtimeWebData3) can patch
   * the cache directly without going through REST.
   */
  static parsePositions(state: HlUserState): PerpPosition[] {
    return state.assetPositions
      .filter(ap => parseFloat(ap.position.szi) !== 0)
      .map(ap => {
        const pos = ap.position;
        const size = parseFloat(pos.szi);
        const side: OrderSide = size > 0 ? 'long' : 'short';
        const absSize = Math.abs(size);
        const entryPrice = parseFloat(pos.entryPx);
        const unrealizedPnl = parseFloat(pos.unrealizedPnl);
        const marginUsed = parseFloat(pos.marginUsed);
        // HL's `positionValue` field is |szi| * markPx (current notional
        // USD value of the position), so markPrice = positionValue / |size|.
        // This is exact — previously we derived it from entryPrice + pnl/size
        // which produces the same value only when funding/fees are zero.
        const positionValue = parseFloat(pos.positionValue);
        const markPrice = absSize > 0 && isFinite(positionValue)
          ? positionValue / absSize
          : entryPrice;

        return {
          symbol: pos.coin,
          side,
          size: absSize,
          entryPrice,
          markPrice,
          liquidationPrice: pos.liquidationPx ? parseFloat(pos.liquidationPx) : null,
          unrealizedPnl,
          realizedPnl: 0, // HL doesn't expose per-position realized PnL in state
          leverage: pos.leverage.value,
          leverageType: pos.leverage.type === 'isolated' ? 'isolated' : 'cross',
          marginUsed,
          returnOnEquity: parseFloat(pos.returnOnEquity) * 100,
          // HL's cumFunding.sinceOpen is a LIABILITY: positive value means
          // the user has PAID that much in funding, negative means they
          // RECEIVED. Flip the sign so PerpPosition.fundingPayment follows
          // the "positive = user's gain" convention used by our UI (and HL
          // web) — matches how PnL is reported.
          fundingPayment: -parseFloat(pos.cumFunding.sinceOpen),
        };
      });
  }

  async getOpenOrders(address: string): Promise<PerpOrder[]> {
    const raw = await this.postInfo<Array<HlOpenOrder>>('openOrders', { user: address });
    return this.parseOpenOrders(raw);
  }

  /** Pure parser for openOrders array — shared by REST (getOpenOrders) and WS (useRealtimeWebData3) paths */
  parseOpenOrders(raw: ReadonlyArray<HlOpenOrder>): PerpOrder[] {
    return raw.map(o => this.mapHlOrder(o));
  }

  async getOrderHistory(address: string, limit: number = 200): Promise<PerpOrder[]> {
    // HL's `historicalOrders` info endpoint returns every order the user has
    // placed along with its terminal status (filled / canceled / triggered /
    // rejected). This is what HL's own UI populates the "Order History" tab
    // from, so no derivation from fills is needed.
    const raw = await this.postInfo<Array<{
      order: HlOpenOrder;
      status: string;
      statusTimestamp: number;
    }>>('historicalOrders', { user: address });

    return raw.slice(0, limit).map(entry => {
      const base = this.mapHlOrder(entry.order);
      return {
        ...base,
        status: HyperliquidPerpAdapter.normalizeHistoricalStatus(entry.status),
        // Prefer the statusTimestamp (when the order reached its terminal
        // state) over the original placement timestamp — it's what HL's UI
        // sorts the Order History tab by.
        timestamp: entry.statusTimestamp,
      };
    });
  }

  /**
   * Normalize HL's historicalOrders status string into our OrderStatus union.
   * HL ships dozens of canceled / rejected sub-categories; collapse the long
   * tail into the canonical five values used by our UI. Anything unknown
   * gets mapped to 'cancelled' as a safe sink.
   */
  static normalizeHistoricalStatus(raw: string): OrderStatus {
    const s = raw.toLowerCase();
    if (s === 'open') return 'open';
    if (s === 'filled') return 'filled';
    if (s === 'triggered') return 'triggered';
    if (s.includes('reject')) return 'rejected';
    // canceled, marginCanceled, siblingFilledCanceled, reduceOnlyCanceled, …
    return 'cancelled';
  }

  async getFills(address: string, limit: number = 100): Promise<Fill[]> {
    const raw = await this.postInfo<Array<{
      coin: string;
      px: string;
      sz: string;
      side: string;
      time: number;
      startPosition: string;
      dir: string;
      closedPnl: string;
      hash: string;
      oid: number;
      crossed: boolean;
      fee: string;
      liquidation: boolean;
    }>>('userFills', { user: address });

    return raw.slice(0, limit).map(f => ({
      id: f.hash,
      orderId: String(f.oid),
      symbol: f.coin,
      side: f.side === 'B' ? 'long' as const : 'short' as const,
      price: parseFloat(f.px),
      size: parseFloat(f.sz),
      fee: parseFloat(f.fee),
      feeToken: 'USDC',
      timestamp: f.time,
      liquidation: f.liquidation,
      closedPnl: parseFloat(f.closedPnl),
    }));
  }

  async getFundingHistory(address: string, startTime?: number): Promise<FundingHistoryEntry[]> {
    const raw = await this.postInfo<Array<{
      time: number;
      hash?: string;
      delta: {
        type: string;
        coin: string;
        usdc: string;
        szi: string;
        fundingRate: string;
        nSamples?: number;
      };
    }>>('userFunding', {
      user: address,
      startTime: startTime ?? Date.now() - 30 * 24 * 60 * 60 * 1000, // last 30 days
    });
    return raw
      .filter(r => r.delta?.type === 'funding')
      .map(r => ({
        timestamp: r.time,
        symbol: r.delta.coin,
        size: parseFloat(r.delta.szi),
        // HL's usdc is a liability (positive = user paid). Flip to match
        // the "positive = user gain" convention used by PerpPosition and
        // the UI color coding.
        payment: -parseFloat(r.delta.usdc),
        rate: parseFloat(r.delta.fundingRate),
      }));
  }

  // ============================================================
  // Agent Wallet
  // ============================================================

  /**
   * Agent wallet 승인 — 메인 지갑으로 서명하여 agent 주소에 거래 권한 부여
   */
  async approveAgent(params: ApproveAgentParams, signFn: EIP712SignFn): Promise<void> {
    const nonce = this.getNonce();
    // action과 message의 agentName은 반드시 동일해야 함 (signature 검증 일치)
    const agentNameStr = params.agentName ?? '';
    // Use the wallet's current chain for both action.signatureChainId and domain.chainId.
    // HL backend recovers the signer using signatureChainId as the domain.chainId.
    const sigChainIdHex = `0x${params.signatureChainId.toString(16)}`;

    const action = {
      type: 'approveAgent',
      hyperliquidChain: 'Mainnet',
      signatureChainId: sigChainIdHex,
      agentAddress: params.agentAddress,
      agentName: agentNameStr,
      nonce,
    };

    const signature = await signFn({
      domain: {
        name: USER_SIGNED_DOMAIN_NAME,
        version: USER_SIGNED_DOMAIN_VERSION,
        chainId: params.signatureChainId,
        verifyingContract: USER_SIGNED_DOMAIN_VERIFYING_CONTRACT,
      },
      types: {
        'HyperliquidTransaction:ApproveAgent': [
          { name: 'hyperliquidChain', type: 'string' },
          { name: 'agentAddress', type: 'address' },
          { name: 'agentName', type: 'string' },
          { name: 'nonce', type: 'uint64' },
        ],
      },
      primaryType: 'HyperliquidTransaction:ApproveAgent',
      message: {
        hyperliquidChain: 'Mainnet',
        agentAddress: params.agentAddress,
        agentName: agentNameStr,
        nonce,
      },
    });

    // approveAgent는 user-signed action이므로 vaultAddress 없이 전송
    await this.postExchange(action, signature, nonce);
  }

  /**
   * Builder fee 승인 — 메인 지갑으로 서명하여 builder가 주문당 `maxFeeRate`
   * 까지 과금할 수 있도록 허가한다. 승인 없이 `order.builder.*`를 붙여
   * 주문을 보내면 HL이 "Builder fee has not been approved."로 거절한다.
   *
   * Agent wallet으로는 서명 불가 — 반드시 main EOA가 필요하다.
   */
  async approveBuilderFee(params: ApproveBuilderFeeParams, signFn: EIP712SignFn): Promise<void> {
    const nonce = this.getNonce();
    const sigChainIdHex = `0x${params.signatureChainId.toString(16)}`;

    const action = {
      type: 'approveBuilderFee',
      hyperliquidChain: 'Mainnet',
      signatureChainId: sigChainIdHex,
      maxFeeRate: params.maxFeeRate,
      builder: params.builderAddress,
      nonce,
    };

    const signature = await signFn({
      domain: {
        name: USER_SIGNED_DOMAIN_NAME,
        version: USER_SIGNED_DOMAIN_VERSION,
        chainId: params.signatureChainId,
        verifyingContract: USER_SIGNED_DOMAIN_VERIFYING_CONTRACT,
      },
      types: {
        'HyperliquidTransaction:ApproveBuilderFee': [
          { name: 'hyperliquidChain', type: 'string' },
          { name: 'maxFeeRate', type: 'string' },
          { name: 'builder', type: 'address' },
          { name: 'nonce', type: 'uint64' },
        ],
      },
      primaryType: 'HyperliquidTransaction:ApproveBuilderFee',
      message: {
        hyperliquidChain: 'Mainnet',
        maxFeeRate: params.maxFeeRate,
        builder: params.builderAddress,
        nonce,
      },
    });

    await this.postExchange(action, signature, nonce);
  }

  /**
   * Returns HL's current approved max-fee-rate for `(user, builder)`, in
   * tenths of a basis point. `0` means no approval exists.
   */
  async getMaxBuilderFee(user: `0x${string}`, builder: `0x${string}`): Promise<number> {
    const res = await fetch(`${this.apiUrl}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'maxBuilderFee', user, builder }),
    });
    if (!res.ok) throw new Error(`HL /info maxBuilderFee ${res.status}`);
    const val = await res.json() as number | null;
    return typeof val === 'number' ? val : 0;
  }

  /** Our builder address / per-order fee — exposed so the UI can pre-check
   *  approval status and wire the approval modal without re-hardcoding. */
  static readonly BUILDER_ADDRESS: `0x${string}` = BUILDER_ADDRESS;
  static readonly BUILDER_FEE = BUILDER_FEE;
  static readonly BUILDER_MAX_FEE_RATE = BUILDER_MAX_FEE_RATE;

  /**
   * Agent private key → EIP712SignFn 생성 (viem signTypedData)
   */
  static createAgentSignFn(agentPrivateKey: `0x${string}`): EIP712SignFn {
    const account = privateKeyToAccount(agentPrivateKey);

    return async (payload) => {
      const signature = await account.signTypedData({
        domain: payload.domain as any,
        types: payload.types as any,
        primaryType: payload.primaryType as any,
        message: payload.message as any,
      });
      return signature;
    };
  }

  // ============================================================
  // Trading (EIP-712 signed)
  // ============================================================

  async placeOrder(params: PlaceOrderParams, signFn: EIP712SignFn): Promise<OrderResult> {
    // ensureMeta populates the regular-perp entries; getMarkets (if already
    // called) also populates HIP-3 entries. For HIP-3 markets `xyz:CL` the
    // entry is only present after getMarkets has run — we rely on the UI
    // flow loading markets before placing an order, which is already how
    // the TradingLayout bootstrap works.
    await this.ensureMeta();
    const entry = this.getAssetEntry(params.symbol);
    const orderAssetId = this.getOrderAssetId(params.symbol);
    const szDecimals = entry.szDecimals;
    const isSpot = params.symbol.includes('/') || params.symbol.startsWith('@');

    const orderWire = this.buildOrderWire(params, orderAssetId, szDecimals, isSpot);
    const nonce = this.getNonce();

    // action 필드 순서는 Python SDK와 동일해야 함 — msgpack key order matters
    const action = {
      type: 'order',
      orders: [orderWire],
      grouping: 'na',
      builder: { b: BUILDER_ADDRESS, f: BUILDER_FEE },
    };

    const signature = await this.signL1Action(action, nonce, params.vaultAddress, signFn);

    try {
      const result = await this.postExchange(action, signature, nonce, params.vaultAddress) as {
        status: string;
        response?: string | { type: string; data?: { statuses: Array<{ resting?: { oid: number }; filled?: { oid: number }; error?: string }> } };
      };

      // HL top-level error shape: { status: "err", response: "message" }
      if (result.status === 'err') {
        const msg = typeof result.response === 'string' ? result.response : 'HL rejected order';
        return { success: false, orderId: null, error: msg };
      }

      if (
        result.status === 'ok' &&
        typeof result.response !== 'string' &&
        result.response?.data?.statuses?.[0]
      ) {
        const s = result.response.data.statuses[0];
        if (s.error) {
          return { success: false, orderId: null, error: s.error };
        }
        const oid = s.resting?.oid ?? s.filled?.oid ?? null;
        return { success: true, orderId: oid ? String(oid) : null };
      }

      logger.warn('Unexpected HL /exchange response', { result });
      return { success: false, orderId: null, error: `Unknown response: ${JSON.stringify(result).slice(0, 200)}` };
    } catch (err) {
      logger.error('placeOrder failed', { err });
      return { success: false, orderId: null, error: err instanceof Error ? err.message : 'Order failed' };
    }
  }

  /**
   * Scale order: split into N limit orders between startPrice and endPrice.
   * - Prices: linearly distributed between start and end
   * - Sizes: linear skew k_i = 1 + (skew - 1) * (i / (N-1)), normalized to totalSize
   *   - skew = 1.0 → uniform
   *   - skew > 1.0 → more size at end
   *   - skew < 1.0 → more size at start
   * All N orders submitted in a single bulk action (one signature).
   */
  async placeScaleOrder(params: PlaceScaleOrderParams, signFn: EIP712SignFn): Promise<OrderResult> {
    await this.ensureMeta();
    const entry = this.getAssetEntry(params.symbol);
    const orderAssetId = this.getOrderAssetId(params.symbol);
    const szDecimals = entry.szDecimals;

    const n = Math.max(2, Math.min(20, Math.floor(params.totalOrders)));
    const { startPrice, endPrice, totalSize, sizeSkew } = params;

    if (!(totalSize > 0)) throw new ValidationError('totalSize must be > 0');
    if (!(startPrice > 0) || !(endPrice > 0)) throw new ValidationError('prices must be > 0');
    if (sizeSkew <= 0) throw new ValidationError('sizeSkew must be > 0');

    // Compute weights and normalize
    const weights: number[] = [];
    let weightSum = 0;
    for (let i = 0; i < n; i++) {
      const ratio = i / (n - 1);
      const w = 1 + (sizeSkew - 1) * ratio;
      weights.push(w);
      weightSum += w;
    }

    const tif = params.timeInForce === 'ioc' ? 'Ioc' : params.timeInForce === 'alo' ? 'Alo' : 'Gtc';
    const isBuy = params.side === 'long';

    const isSpot = params.symbol.includes('/') || params.symbol.startsWith('@');

    const orderWires: HlOrderWire[] = [];
    for (let i = 0; i < n; i++) {
      const priceRatio = i / (n - 1);
      const price = startPrice + (endPrice - startPrice) * priceRatio;
      const size = (totalSize * weights[i]) / weightSum;
      orderWires.push({
        a: orderAssetId,
        b: isBuy,
        p: HyperliquidPerpAdapter.roundHlPrice(price, szDecimals, isSpot),
        s: HyperliquidPerpAdapter.roundHlSize(size, szDecimals),
        r: params.reduceOnly ?? false,
        t: { limit: { tif } },
      });
    }

    const nonce = this.getNonce();
    const action = {
      type: 'order',
      orders: orderWires,
      grouping: 'na',
      builder: { b: BUILDER_ADDRESS, f: BUILDER_FEE },
    };

    const signature = await this.signL1Action(action, nonce, params.vaultAddress, signFn);

    try {
      const result = await this.postExchange(action, signature, nonce, params.vaultAddress) as {
        status: string;
        response?: string | { type: string; data?: { statuses: Array<{ resting?: { oid: number }; filled?: { oid: number }; error?: string }> } };
      };

      if (result.status === 'err') {
        const msg = typeof result.response === 'string' ? result.response : 'HL rejected scale order';
        return { success: false, orderId: null, error: msg };
      }

      if (
        result.status === 'ok' &&
        typeof result.response !== 'string' &&
        result.response?.data?.statuses
      ) {
        const statuses = result.response.data.statuses;
        const firstError = statuses.find(s => s.error);
        if (firstError) {
          return { success: false, orderId: null, error: firstError.error };
        }
        const firstOid = statuses[0]?.resting?.oid ?? statuses[0]?.filled?.oid ?? null;
        return { success: true, orderId: firstOid ? String(firstOid) : null };
      }

      logger.warn('Unexpected HL /exchange response (scale)', { result });
      return { success: false, orderId: null, error: `Unknown response: ${JSON.stringify(result).slice(0, 200)}` };
    } catch (err) {
      logger.error('placeScaleOrder failed', { err });
      return { success: false, orderId: null, error: err instanceof Error ? err.message : 'Scale order failed' };
    }
  }

  async cancelOrder(params: CancelOrderParams, signFn: EIP712SignFn): Promise<OrderResult> {
    await this.ensureMeta();
    const orderAssetId = this.getOrderAssetId(params.symbol);
    const nonce = this.getNonce();

    const action = {
      type: 'cancel',
      cancels: [{ a: orderAssetId, o: parseInt(params.orderId) }],
    };

    const signature = await this.signL1Action(action, nonce, params.vaultAddress, signFn);

    try {
      await this.postExchange(action, signature, nonce, params.vaultAddress);
      return { success: true, orderId: params.orderId };
    } catch (err) {
      return { success: false, orderId: params.orderId, error: err instanceof Error ? err.message : 'Cancel failed' };
    }
  }

  async modifyOrder(params: ModifyOrderParams, signFn: EIP712SignFn): Promise<OrderResult> {
    if (params.price === undefined && params.size === undefined) {
      return { success: false, orderId: params.orderId, error: 'Modify requires at least price or size' };
    }
    await this.ensureMeta();
    const entry = this.getAssetEntry(params.symbol);
    const orderAssetId = this.getOrderAssetId(params.symbol);
    const szDecimals = entry.szDecimals;
    const isSpot = params.symbol.includes('/') || params.symbol.startsWith('@');
    const nonce = this.getNonce();

    const action = {
      type: 'batchModify',
      modifies: [
        {
          oid: parseInt(params.orderId),
          order: {
            a: orderAssetId,
            b: params.side === 'long',
            p: HyperliquidPerpAdapter.roundHlPrice(params.price ?? 0, szDecimals, isSpot),
            s: HyperliquidPerpAdapter.roundHlSize(params.size ?? 0, szDecimals),
            r: false,
            t: { limit: { tif: 'Gtc' } },
          },
        },
      ],
    };

    const signature = await this.signL1Action(action, nonce, params.vaultAddress, signFn);

    try {
      await this.postExchange(action, signature, nonce, params.vaultAddress);
      return { success: true, orderId: params.orderId };
    } catch (err) {
      return { success: false, orderId: params.orderId, error: err instanceof Error ? err.message : 'Modify failed' };
    }
  }

  async updateLeverage(params: UpdateLeverageParams, signFn: EIP712SignFn): Promise<void> {
    await this.ensureMeta();
    const orderAssetId = this.getOrderAssetId(params.symbol);
    const nonce = this.getNonce();

    const action = {
      type: 'updateLeverage',
      asset: orderAssetId,
      isCross: params.marginMode === 'cross',
      leverage: params.leverage,
    };

    const signature = await this.signL1Action(action, nonce, params.vaultAddress, signFn);

    await this.postExchange(action, signature, nonce, params.vaultAddress);
  }

  // ============================================================
  // WebSocket
  // ============================================================

  subscribe(channel: WsChannel, callback: (msg: WsMessage) => void): Unsubscribe {
    this.ensureWsConnection();
    const key = this.channelKey(channel);

    if (!this.wsSubscriptions.has(key)) {
      this.wsSubscriptions.set(key, new Set());
      this.wsSend({ method: 'subscribe', subscription: this.buildWsSub(channel) });
    }

    this.wsSubscriptions.get(key)!.add(callback);

    return () => {
      const subs = this.wsSubscriptions.get(key);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.wsSubscriptions.delete(key);
          this.wsSend({ method: 'unsubscribe', subscription: this.buildWsSub(channel) });
        }
      }
    };
  }

  /**
   * Register a callback fired every time the WebSocket transitions from
   * closed/connecting back to OPEN after the first connection. Used by
   * hooks that need to backfill data gaps after a network outage
   * (e.g. candles snapshot refetch).
   *
   * Returns an Unsubscribe function.
   */
  onReconnect(callback: () => void): Unsubscribe {
    this.wsReconnectListeners.add(callback);
    return () => { this.wsReconnectListeners.delete(callback); };
  }

  disconnect(): void {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    this.stopPingTimer();
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

    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      logger.info('WebSocket connected');
      const wasReconnect = this.wsHasBeenConnected;
      this.wsHasBeenConnected = true;

      // Start heartbeat — HL drops idle connections after 60s client-side silence
      this.startPingTimer();

      // 재연결 시 기존 구독 복원
      for (const [key] of this.wsSubscriptions) {
        const channel = this.parseChannelKey(key);
        if (channel) {
          this.wsSend({ method: 'subscribe', subscription: this.buildWsSub(channel) });
        }
      }

      // Fire reconnect listeners so callers (e.g. candles hook) can
      // invalidate their caches and backfill any bars missed during the
      // outage. Only fires on RE-connect, not the initial connection.
      if (wasReconnect) {
        for (const cb of this.wsReconnectListeners) {
          try { cb(); } catch (err) { logger.warn('onReconnect listener failed', { err }); }
        }
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        this.handleWsMessage(data);
      } catch {
        logger.warn('Failed to parse WS message');
      }
    };

    this.ws.onclose = () => {
      logger.info('WebSocket closed, reconnecting in 3s');
      this.stopPingTimer();
      this.wsReconnectTimer = setTimeout(() => this.ensureWsConnection(), WS_RECONNECT_DELAY_MS);
    };

    this.ws.onerror = (err) => {
      logger.error('WebSocket error', { err });
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

  private handleWsMessage(data: Record<string, unknown>): void {
    const channel = data.channel as string;
    const payload = data.data;

    if (!channel || !payload) return;

    // 모든 매칭 구독에 브로드캐스트
    for (const [key, callbacks] of this.wsSubscriptions) {
      if (key === channel || key.startsWith(channel + ':')) {
        const msg = this.parseWsPayload(channel, payload);
        if (msg) {
          for (const cb of callbacks) cb(msg);
        }
      }
    }
  }

  private parseWsPayload(channel: string, data: unknown): WsMessage | null {
    switch (channel) {
      case 'l2Book':
        return { channel: 'orderbook', data: this.parseWsOrderbook(data) } as WsMessage;
      case 'trades':
        return { channel: 'trades', data: this.parseWsTrades(data as Array<Record<string, unknown>>) } as WsMessage;
      case 'candle':
        return { channel: 'candles', data: [this.parseWsCandle(data as Record<string, unknown>)] } as WsMessage;
      case 'allMids': {
        // HL shape when subscribing with dex param: { dex: "ALL_DEXS", mids: { COIN: "price" } }
        // Fallback (no dex param, legacy): { COIN: "price" } directly.
        const d = data as { dex?: string; mids?: Record<string, string> } | Record<string, string>;
        const hasWrapper = typeof d === 'object' && d !== null && 'mids' in d;
        const midsRaw = hasWrapper ? (d as { mids: Record<string, string> }).mids : (d as Record<string, string>);
        const dex = hasWrapper ? (d as { dex?: string }).dex ?? null : null;
        const mids: Record<string, number> = {};
        for (const [k, v] of Object.entries(midsRaw ?? {})) mids[k] = parseFloat(v);
        return { channel: 'allMids', data: { dex, mids } } as WsMessage;
      }
      case 'webData3':
        return { channel: 'webData3', data: data as Record<string, unknown> } as WsMessage;
      case 'activeAssetCtx':
        return { channel: 'activeAssetCtx', data: data } as WsMessage;
      case 'activeAssetData':
        return { channel: 'activeAssetData', data: data } as WsMessage;
      case 'allDexsAssetCtxs':
        return { channel: 'allDexsAssetCtxs', data: data } as WsMessage;
      case 'spotAssetCtxs':
        return { channel: 'spotAssetCtxs', data: data } as WsMessage;
      case 'allDexsClearinghouseState':
        return { channel: 'allDexsClearinghouseState', data: data } as WsMessage;
      case 'openOrders':
        // HL's WS `openOrders` push is the per-user live open-order stream
        // (distinct from REST /info openOrders). Surface as internal
        // 'openOrdersLive' so hooks can subscribe via a typed channel.
        return { channel: 'openOrdersLive', data: data } as WsMessage;
      case 'userFills': {
        // Shape: { isSnapshot: bool, user, fills: HlFill[] } (aggregateByTime)
        // If the payload doesn't carry the `fills` array we return null
        // and let handleWsMessage drop the frame — that way a shape
        // mismatch never overwrites the REST snapshot with `[]`.
        const d = data as { isSnapshot?: boolean; fills?: unknown };
        if (!Array.isArray(d.fills)) return null;
        const rawFills = d.fills as Array<{ coin: string; px: string; sz: string; side: string; time: number; closedPnl: string; hash: string; oid: number; fee: string; liquidation: boolean }>;
        const fills: Fill[] = rawFills.map(f => ({
          id: f.hash,
          orderId: String(f.oid),
          symbol: f.coin,
          side: f.side === 'B' ? 'long' as const : 'short' as const,
          price: parseFloat(f.px),
          size: parseFloat(f.sz),
          fee: parseFloat(f.fee),
          feeToken: 'USDC',
          timestamp: f.time,
          liquidation: f.liquidation,
          closedPnl: parseFloat(f.closedPnl),
        }));
        return { channel: 'userFillsLive', data: { isSnapshot: !!d.isSnapshot, fills } } as WsMessage;
      }
      case 'spotState': {
        // HL wraps as `{ user, balances }`. If `balances` is missing
        // (unexpected shape) we drop the frame so the REST snapshot
        // isn't clobbered by an empty array.
        const d = data as { user?: string; balances?: unknown };
        if (!Array.isArray(d.balances)) return null;
        return { channel: 'spotState', data: { user: d.user ?? '', balances: d.balances as SpotBalance[] } } as WsMessage;
      }
      case 'userHistoricalOrders': {
        // Shape: { isSnapshot: bool, orderHistory: Array<{ order, status, statusTimestamp }> }
        const d = data as { isSnapshot?: boolean; orderHistory?: unknown };
        if (!Array.isArray(d.orderHistory)) return null;
        const entries = d.orderHistory as Array<{ order: HlOpenOrder; status: string; statusTimestamp: number }>;
        const orders: PerpOrder[] = entries.map(entry => {
          const base = this.mapHlOrder(entry.order);
          return {
            ...base,
            status: HyperliquidPerpAdapter.normalizeHistoricalStatus(entry.status),
            timestamp: entry.statusTimestamp,
          };
        });
        return { channel: 'userHistoricalOrdersLive', data: { isSnapshot: !!d.isSnapshot, orders } } as WsMessage;
      }
      case 'userFundings': {
        // Shape: { isSnapshot: bool, fundings: Array<{ time, delta }> }
        const d = data as { isSnapshot?: boolean; fundings?: unknown };
        if (!Array.isArray(d.fundings)) return null;
        const entries = d.fundings as Array<{ time: number; delta: { type: string; coin: string; usdc: string; szi: string; fundingRate: string } }>;
        const fundings: FundingHistoryEntry[] = entries
          .filter(r => r.delta?.type === 'funding')
          .map(r => ({
            timestamp: r.time,
            symbol: r.delta.coin,
            size: parseFloat(r.delta.szi),
            // Flip sign to match the positive = user gain convention,
            // same transformation getFundingHistory applies to REST data.
            payment: -parseFloat(r.delta.usdc),
            rate: parseFloat(r.delta.fundingRate),
          }));
        return { channel: 'userFundingsLive', data: { isSnapshot: !!d.isSnapshot, fundings } } as WsMessage;
      }
      default:
        return null;
    }
  }

  private parseWsOrderbook(data: unknown): Orderbook {
    const d = data as { coin: string; levels: Array<Array<{ px: string; sz: string; n: number }>> };
    return {
      symbol: d.coin,
      bids: d.levels[0].map(l => ({ price: parseFloat(l.px), size: parseFloat(l.sz), numOrders: l.n })),
      asks: d.levels[1].map(l => ({ price: parseFloat(l.px), size: parseFloat(l.sz), numOrders: l.n })),
      timestamp: Date.now(),
    };
  }

  private parseWsTrades(data: Array<Record<string, unknown>>): Trade[] {
    return data.map(t => ({
      id: t.hash as string,
      symbol: t.coin as string,
      price: parseFloat(t.px as string),
      size: parseFloat(t.sz as string),
      side: (t.side === 'B' ? 'long' : 'short') as OrderSide,
      timestamp: t.time as number,
    }));
  }

  private parseWsCandle(data: Record<string, unknown>): Candle {
    return {
      timestamp: data.t as number,
      open: parseFloat(data.o as string),
      high: parseFloat(data.h as string),
      low: parseFloat(data.l as string),
      close: parseFloat(data.c as string),
      volume: parseFloat(data.v as string),
    };
  }

  // ============================================================
  // Transfers
  // ============================================================

  async deposit(_params: DepositParams, _signFn: EIP712SignFn): Promise<string> {
    // Hyperliquid deposit은 L1 USDC 전송 — Relay Bridge에서 처리
    throw new AdapterError('Direct deposit not supported. Use Relay Bridge for cross-chain deposits.');
  }

  async withdraw(params: WithdrawParams, signFn: EIP712SignFn): Promise<string> {
    const nonce = this.getNonce();
    const sigChainIdHex = `0x${params.signatureChainId.toString(16)}`;

    const action = {
      type: 'withdraw3',
      hyperliquidChain: 'Mainnet',
      signatureChainId: sigChainIdHex,
      amount: params.amount.toString(),
      time: nonce,
      destination: params.toAddress,
    };

    const signature = await signFn({
      domain: {
        name: USER_SIGNED_DOMAIN_NAME,
        version: USER_SIGNED_DOMAIN_VERSION,
        chainId: params.signatureChainId,
        verifyingContract: USER_SIGNED_DOMAIN_VERIFYING_CONTRACT,
      },
      types: {
        'HyperliquidTransaction:Withdraw': [
          { name: 'hyperliquidChain', type: 'string' },
          { name: 'destination', type: 'string' },
          { name: 'amount', type: 'string' },
          { name: 'time', type: 'uint64' },
        ],
      },
      primaryType: 'HyperliquidTransaction:Withdraw',
      message: {
        hyperliquidChain: 'Mainnet',
        destination: params.toAddress,
        amount: params.amount.toString(),
        time: nonce,
      },
    });

    const result = await this.postExchange(action, signature, nonce);
    return JSON.stringify(result);
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * HL price rounding — official rules from the Python SDK:
   *   - Max 5 significant figures (integer prices always allowed)
   *   - Max (MAX_DECIMALS - szDecimals) decimal places
   *     where MAX_DECIMALS = 6 for perps, 8 for spot
   *   - Prices > 100,000 → round to integer
   */
  private static roundHlPrice(px: number, szDecimals: number, isSpot: boolean): string {
    if (px > 100_000) return Math.round(px).toString();
    const maxDecimals = isSpot ? 8 : 6;
    const sigFig5 = parseFloat(px.toPrecision(5));
    const maxDp = maxDecimals - szDecimals;
    return Number(sigFig5.toFixed(maxDp)).toString();
  }

  /** HL size rounding — round to `szDecimals` decimal places. */
  private static roundHlSize(sz: number, szDecimals: number): string {
    return Number(sz.toFixed(szDecimals)).toString();
  }

  private buildOrderWire(params: PlaceOrderParams, assetIndex: number, szDecimals: number, isSpot: boolean): HlOrderWire {
    const isBuy = params.side === 'long';

    let orderType: HlOrderWire['t'];
    if (params.type === 'market') {
      orderType = { limit: { tif: 'Ioc' } };
    } else if (params.type === 'limit') {
      const tif = params.timeInForce === 'ioc' ? 'Ioc' : params.timeInForce === 'alo' ? 'Alo' : 'Gtc';
      orderType = { limit: { tif } };
    } else {
      // stop_market / stop_limit / take_market / take_limit — trigger orders
      const isTake = params.type === 'take_limit' || params.type === 'take_market';
      const isMarketTrigger = params.type === 'stop_market' || params.type === 'take_market';
      orderType = {
        trigger: {
          isMarket: isMarketTrigger,
          triggerPx: params.triggerPrice?.toString() ?? '0',
          tpsl: isTake ? 'tp' : 'sl',
        },
      };
    }

    // Market order: use slippage-adjusted price for protection
    let rawPrice: number;
    if (params.type === 'market' || params.type === 'take_market' || params.type === 'stop_market') {
      // HL requires a limit price even for IOC market orders as slippage protection
      const slippageBps = params.slippageBps ?? 50; // default 0.5%
      const slippageMultiplier = slippageBps / 10000;
      const referencePrice = parseFloat(params.price?.toString() ?? '0');
      if (referencePrice > 0) {
        rawPrice = isBuy
          ? referencePrice * (1 + slippageMultiplier)
          : referencePrice * (1 - slippageMultiplier);
      } else {
        rawPrice = 0;
      }
    } else {
      rawPrice = parseFloat(params.price?.toString() ?? '0');
    }

    return {
      a: assetIndex,
      b: isBuy,
      p: HyperliquidPerpAdapter.roundHlPrice(rawPrice, szDecimals, isSpot),
      s: HyperliquidPerpAdapter.roundHlSize(params.size, szDecimals),
      r: params.reduceOnly ?? false,
      t: orderType,
    };
  }

  private mapHlOrder(o: HlOpenOrder): PerpOrder {
    // HL openOrders.orderType is a display-oriented string like
    //   "Limit", "Market", "Stop Market", "Stop Limit",
    //   "Take Profit Market", "Take Profit Limit",
    //   and limit variants include tif suffixes: "Alo", "Ioc", "Gtc".
    // We coerce it into our internal OrderType + TimeInForce shape.
    const rawType = (o.orderType ?? '').toLowerCase();
    const tpsl = (o.tpsl ?? '').toLowerCase();

    let type: OrderType;
    if (rawType.includes('stop') || tpsl === 'sl') {
      type = rawType.includes('market') ? 'stop_market' : 'stop_limit';
    } else if (rawType.includes('take') || tpsl === 'tp') {
      type = rawType.includes('market') ? 'take_market' : 'take_limit';
    } else if (rawType.includes('market')) {
      type = 'market';
    } else {
      type = 'limit';
    }

    let timeInForce: TimeInForce = 'gtc';
    if (rawType.includes('alo')) timeInForce = 'alo';
    else if (rawType.includes('ioc')) timeInForce = 'ioc';

    return {
      orderId: String(o.oid),
      symbol: o.coin,
      side: (o.side === 'B' ? 'long' : 'short') as OrderSide,
      type,
      price: parseFloat(o.limitPx),
      size: parseFloat(o.sz),
      filledSize: parseFloat(o.origSz) - parseFloat(o.sz),
      status: 'open' as OrderStatus,
      leverage: 0, // not available in open orders
      reduceOnly: o.reduceOnly,
      timeInForce,
      triggerPrice: o.triggerPx ? parseFloat(o.triggerPx) : null,
      tpPrice: null,
      slPrice: null,
      timestamp: o.timestamp,
    };
  }

  private channelKey(channel: WsChannel): string {
    switch (channel.type) {
      case 'orderbook': return `l2Book:${channel.symbol}`;
      case 'trades': return `trades:${channel.symbol}`;
      case 'candles': return `candle:${channel.symbol}:${channel.interval}`;
      case 'ticker': return `allMids:${channel.symbol ?? ''}`;
      case 'allMids': return `allMids:${channel.dex ?? ''}`;
      case 'webData3': return `webData3:${channel.address}`;
      case 'activeAssetCtx': return `activeAssetCtx:${channel.symbol}`;
      case 'activeAssetData': return `activeAssetData:${channel.address}:${channel.symbol}`;
      case 'allDexsAssetCtxs': return 'allDexsAssetCtxs';
      case 'spotAssetCtxs': return 'spotAssetCtxs';
      case 'allDexsClearinghouseState': return `allDexsClearinghouseState:${channel.address}`;
      case 'openOrdersLive': return `openOrders:${channel.address}:${channel.dex ?? 'ALL_DEXS'}`;
      case 'userFillsLive': return `userFills:${channel.address}`;
      case 'spotState': return `spotState:${channel.address}`;
      case 'userHistoricalOrdersLive': return `userHistoricalOrders:${channel.address}`;
      case 'userFundingsLive': return `userFundings:${channel.address}`;
      // Pacifica-only user-data channels — HL never subscribes to these,
      // but including a default keeps the switch exhaustive after the
      // shared `WsChannel` union picked them up.
      case 'pacificaAccountInfo':
      case 'pacificaAccountPositions':
      case 'pacificaAccountOrders':
      case 'pacificaAccountFills':
        return `unsupported:${channel.type}`;
    }
  }

  private buildWsSub(channel: WsChannel): Record<string, unknown> {
    switch (channel.type) {
      case 'orderbook': return { type: 'l2Book', coin: channel.symbol, nSigFigs: null };
      case 'trades': return { type: 'trades', coin: channel.symbol };
      case 'candles': return { type: 'candle', coin: channel.symbol, interval: channel.interval };
      case 'ticker': return { type: 'allMids', dex: 'ALL_DEXS' };
      case 'allMids': return channel.dex ? { type: 'allMids', dex: channel.dex } : { type: 'allMids' };
      case 'webData3': return { type: 'webData3', user: channel.address };
      case 'activeAssetCtx': return { type: 'activeAssetCtx', coin: channel.symbol };
      case 'activeAssetData': return { type: 'activeAssetData', user: channel.address, coin: channel.symbol };
      case 'allDexsAssetCtxs': return { type: 'allDexsAssetCtxs' };
      case 'spotAssetCtxs': return { type: 'spotAssetCtxs' };
      case 'allDexsClearinghouseState': return { type: 'allDexsClearinghouseState', user: channel.address };
      case 'openOrdersLive': return { type: 'openOrders', user: channel.address, dex: channel.dex ?? 'ALL_DEXS' };
      case 'userFillsLive': return { type: 'userFills', user: channel.address, aggregateByTime: channel.aggregateByTime ?? true };
      case 'spotState': return { type: 'spotState', user: channel.address };
      case 'userHistoricalOrdersLive': return { type: 'userHistoricalOrders', user: channel.address };
      case 'userFundingsLive': return { type: 'userFundings', user: channel.address };
      // Pacifica-only channels never reach this builder (HL's subscribe
      // path gates them out), but the switch must exhaust the shared
      // `WsChannel` union to type-check.
      case 'pacificaAccountInfo':
      case 'pacificaAccountPositions':
      case 'pacificaAccountOrders':
      case 'pacificaAccountFills':
        return {};
    }
  }

  private parseChannelKey(key: string): WsChannel | null {
    const [type, ...rest] = key.split(':');
    switch (type) {
      case 'l2Book': return { type: 'orderbook', symbol: rest[0] };
      case 'trades': return { type: 'trades', symbol: rest[0] };
      case 'candle': return { type: 'candles', symbol: rest[0], interval: rest[1] as CandleInterval };
      case 'allMids': return rest[0] ? { type: 'allMids', dex: rest[0] } : { type: 'allMids' };
      case 'webData3': return { type: 'webData3', address: rest[0] };
      case 'activeAssetCtx': return { type: 'activeAssetCtx', symbol: rest[0] };
      case 'activeAssetData': return { type: 'activeAssetData', address: rest[0], symbol: rest[1] };
      case 'allDexsAssetCtxs': return { type: 'allDexsAssetCtxs' };
      case 'spotAssetCtxs': return { type: 'spotAssetCtxs' };
      case 'allDexsClearinghouseState': return { type: 'allDexsClearinghouseState', address: rest[0] };
      case 'openOrders': return { type: 'openOrdersLive', address: rest[0], dex: rest[1] };
      case 'userFills': return { type: 'userFillsLive', address: rest[0] };
      case 'spotState': return { type: 'spotState', address: rest[0] };
      case 'userHistoricalOrders': return { type: 'userHistoricalOrdersLive', address: rest[0] };
      case 'userFundings': return { type: 'userFundingsLive', address: rest[0] };
      default: return null;
    }
  }

  /**
   * Compute the price tick size dynamically using HL's rounding rules:
   *   - Max 5 significant figures
   *   - Max (maxDecimals - szDecimals) decimal places
   *     where maxDecimals = 6 for perps, 8 for spot
   *   - Prices > 100k are integers
   *
   * Returns the smallest allowed price increment for this asset.
   * Replaces the old hardcoded `getSignificantDecimals` map.
   */
  private static computeTickSize(markPrice: number, szDecimals: number, isSpot: boolean): number {
    if (markPrice > 100_000 || markPrice <= 0) return 1;
    const maxDp = (isSpot ? 8 : 6) - szDecimals;
    // 5 sig figs → how many decimal places for this price magnitude?
    const sigFigDp = Math.max(0, 4 - Math.floor(Math.log10(markPrice)));
    const dp = Math.min(sigFigDp, maxDp);
    return Math.pow(10, -dp);
  }

  private intervalToMs(interval: CandleInterval): number {
    const map: Record<CandleInterval, number> = {
      '1m': 60_000, '3m': 180_000, '5m': 300_000,
      '15m': 900_000, '30m': 1_800_000,
      '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000,
      '6h': 21_600_000, '12h': 43_200_000,
      '1d': 86_400_000, '1w': 604_800_000, '1M': 2_592_000_000,
    };
    return map[interval];
  }
}
