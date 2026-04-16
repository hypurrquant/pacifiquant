/**
 * Funding Arbitrage Execution — cross-DEX funding rate arb helper
 *
 * Simultaneously opens a long on the low-rate exchange and a short on the
 * high-rate exchange, earning the funding differential.
 */

import type { PerpAdapterBase } from '../PerpAdapterBase';
import type { EIP712SignFn, OrderResult, PerpMarket } from '../types';

export interface FundingArbParams {
  readonly symbol: string;
  readonly sizeUsd: number;
  readonly markPrice: number;
  readonly longAdapter: PerpAdapterBase;
  readonly shortAdapter: PerpAdapterBase;
}

export interface FundingArbResult {
  readonly longResult: OrderResult;
  readonly shortResult: OrderResult;
  readonly longExchange: string;
  readonly shortExchange: string;
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

function gcdInt(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function compatibleLotSize(left: number, right: number): number {
  const decimals = Math.max(stepDecimals(left), stepDecimals(right));
  const scale = Math.pow(10, decimals);
  const leftUnits = Math.max(1, Math.round(left * scale));
  const rightUnits = Math.max(1, Math.round(right * scale));
  const lcm = (leftUnits / gcdInt(leftUnits, rightUnits)) * rightUnits;
  return lcm / scale;
}

function floorToStep(value: number, step: number): number {
  if (!(step > 0)) return value;
  return Number((Math.floor(value / step) * step).toFixed(stepDecimals(step)));
}

async function getMarketBySymbol(adapter: PerpAdapterBase, symbol: string): Promise<PerpMarket> {
  const markets = await adapter.getMarkets();
  const market = markets.find(entry => entry.symbol === symbol);
  if (!market) {
    throw new Error(`Funding arb market not found on ${adapter.protocolId}: ${symbol}`);
  }
  return market;
}

export async function executeFundingArb(
  params: FundingArbParams,
  signFn: EIP712SignFn,
): Promise<FundingArbResult> {
  const [longMarket, shortMarket] = await Promise.all([
    getMarketBySymbol(params.longAdapter, params.symbol),
    getMarketBySymbol(params.shortAdapter, params.symbol),
  ]);

  const rawSize = params.sizeUsd / params.markPrice;
  const commonLotSize = compatibleLotSize(longMarket.lotSize, shortMarket.lotSize);
  const size = floorToStep(rawSize, commonLotSize);

  if (!(size > 0)) {
    throw new Error(`Funding arb size ${rawSize} is below the common lot size ${commonLotSize}`);
  }

  const minSize = Math.max(longMarket.minOrderSize, shortMarket.minOrderSize);
  if (size < minSize) {
    throw new Error(`Funding arb size ${size} is below the venue minimum ${minSize}`);
  }

  const [longResult, shortResult] = await Promise.all([
    params.longAdapter.placeOrder(
      {
        symbol: params.symbol,
        side: 'long',
        type: 'market',
        size,
        leverage: 1,
        price: params.markPrice,
        slippageBps: 50,
      },
      signFn,
    ),
    params.shortAdapter.placeOrder(
      {
        symbol: params.symbol,
        side: 'short',
        type: 'market',
        size,
        leverage: 1,
        price: params.markPrice,
        slippageBps: 50,
      },
      signFn,
    ),
  ]);

  return {
    longResult,
    shortResult,
    longExchange: params.longAdapter.protocolId,
    shortExchange: params.shortAdapter.protocolId,
  };
}
