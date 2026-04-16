/**
 * benchmark-rpc.mjs
 *
 * 모든 체인의 모든 RPC를 벤치마크:
 *   - multicall batch size별 (10, 50, 100, 200, 500) 성공률 + 레이턴시
 *   - burst test: 연속 5회 요청 (delay 0) 성공률
 *   - 체인별 결과 즉시 저장 (docs/vfat/rpc-benchmark/)
 *
 * 실행: node scripts/benchmark-rpc.mjs
 */

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(ROOT, 'packages/core/package.json'));
const { createPublicClient, http } = require('viem');

const MC3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const TICK_ABI = [{
  name: 'tickSpacing', type: 'function', inputs: [],
  outputs: [{ type: 'int24' }], stateMutability: 'view',
}];

const OUT_DIR = resolve(ROOT, 'docs/vfat/rpc-benchmark');
const BATCH_SIZES = [10, 50, 100, 200, 500];
const BURST_COUNT = 5;       // 연속 요청 횟수
const TIMEOUT_MS = 20_000;
const PARALLEL_CHAINS = 3;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function makeClient(chainId, rpcUrl) {
  return createPublicClient({
    chain: {
      id: chainId, name: `chain-${chainId}`,
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
      contracts: { multicall3: { address: MC3 } },
    },
    transport: http(rpcUrl, { timeout: TIMEOUT_MS, retryCount: 0 }),
  });
}

// 단일 multicall 테스트
async function testMulticall(client, pools, batchSize) {
  const batch = pools.slice(0, batchSize);
  const t0 = performance.now();
  try {
    const results = await Promise.race([
      client.multicall({
        contracts: batch.map(p => ({
          address: p.address, abi: TICK_ABI, functionName: 'tickSpacing',
        })),
        allowFailure: true,
      }),
      sleep(TIMEOUT_MS).then(() => { throw new Error('timeout'); }),
    ]);
    const latency = Math.round(performance.now() - t0);
    const ok = results.filter(r => r.status === 'success').length;
    return { success: true, latency, ok, total: batch.length, error: null };
  } catch (e) {
    const latency = Math.round(performance.now() - t0);
    const msg = e.message?.slice(0, 150) || 'unknown';
    return { success: false, latency, ok: 0, total: batch.length, error: msg };
  }
}

// burst test: batch 50으로 연속 N회 (delay 0)
async function testBurst(client, pools) {
  const batch = pools.slice(0, 50);
  const contracts = batch.map(p => ({
    address: p.address, abi: TICK_ABI, functionName: 'tickSpacing',
  }));

  const results = [];
  const t0 = performance.now();

  for (let i = 0; i < BURST_COUNT; i++) {
    const rt0 = performance.now();
    try {
      const res = await Promise.race([
        client.multicall({ contracts, allowFailure: true }),
        sleep(TIMEOUT_MS).then(() => { throw new Error('timeout'); }),
      ]);
      const latency = Math.round(performance.now() - rt0);
      const ok = res.filter(r => r.status === 'success').length;
      results.push({ i, success: true, latency, ok });
    } catch (e) {
      const latency = Math.round(performance.now() - rt0);
      results.push({ i, success: false, latency, error: e.message?.slice(0, 100) });
    }
  }

  const totalTime = Math.round(performance.now() - t0);
  const successCount = results.filter(r => r.success).length;
  return {
    burstCount: BURST_COUNT,
    successCount,
    totalTimeMs: totalTime,
    avgLatencyMs: Math.round(totalTime / BURST_COUNT),
    requests: results,
  };
}

// 개별 호출 레이턴시 테스트
async function testSingleCall(client, pool) {
  const t0 = performance.now();
  try {
    await Promise.race([
      client.readContract({
        address: pool.address, abi: TICK_ABI, functionName: 'tickSpacing',
      }),
      sleep(10_000).then(() => { throw new Error('timeout'); }),
    ]);
    return { success: true, latency: Math.round(performance.now() - t0) };
  } catch (e) {
    return { success: false, latency: Math.round(performance.now() - t0), error: e.message?.slice(0, 100) };
  }
}

async function benchmarkRpc(chainId, rpcUrl, pools) {
  const host = new URL(rpcUrl).hostname;
  const client = makeClient(chainId, rpcUrl);

  const result = {
    chainId,
    rpcUrl,
    host,
    poolCount: pools.length,
    timestamp: new Date().toISOString(),
    singleCall: null,
    multicall: {},
    burst: null,
  };

  // 1. 단일 호출 레이턴시 (baseline)
  result.singleCall = await testSingleCall(client, pools[0]);
  if (!result.singleCall.success) {
    // RPC 자체가 안 되면 나머지 스킵
    console.log(`    ${host}: single call failed — skip`);
    return result;
  }

  // 2. multicall batch size 테스트
  for (const size of BATCH_SIZES) {
    if (size > pools.length) {
      result.multicall[size] = { skipped: true, reason: `only ${pools.length} pools` };
      continue;
    }
    result.multicall[size] = await testMulticall(client, pools, size);
    // 실패하면 더 큰 사이즈는 의미 없음
    if (!result.multicall[size].success) {
      for (const bigger of BATCH_SIZES.filter(s => s > size)) {
        result.multicall[bigger] = { skipped: true, reason: `size ${size} failed` };
      }
      break;
    }
    await sleep(500); // RPC 쿨다운
  }

  // 3. burst test
  await sleep(1000); // 쿨다운
  result.burst = await testBurst(client, pools);

  return result;
}

async function benchmarkChain(chainId, rpcs, pools) {
  const outPath = resolve(OUT_DIR, `chain-${chainId}.json`);
  if (existsSync(outPath)) {
    console.log(`[skip] chain ${chainId}: already benchmarked`);
    return;
  }

  console.log(`[bench] chain ${chainId}: ${pools.length} pools, ${rpcs.length} RPCs`);
  const results = [];

  for (const rpcUrl of rpcs) {
    const host = new URL(rpcUrl).hostname;
    console.log(`  testing ${host}...`);
    const r = await benchmarkRpc(chainId, rpcUrl, pools);

    const mc = Object.entries(r.multicall)
      .filter(([, v]) => v.success)
      .map(([size, v]) => `${size}→${v.latency}ms`)
      .join(', ');
    const burstOk = r.burst ? `${r.burst.successCount}/${r.burst.burstCount}` : '-';
    console.log(`    single: ${r.singleCall?.latency || '-'}ms | mc: [${mc || 'none'}] | burst: ${burstOk}`);

    results.push(r);
    await sleep(2000); // RPC간 쿨다운
  }

  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`[saved] chain ${chainId}\n`);
}

async function main() {
  const t0 = Date.now();
  mkdirSync(OUT_DIR, { recursive: true });

  const chains = JSON.parse(readFileSync(resolve(ROOT, 'docs/report/vfat-chain.json'), 'utf-8'));
  const rpcMap = new Map(chains.map(c => [c.chainId, c.rpcUrls || []]));

  // enriched pool 데이터 로드 (tickSpacing 성공한 것만 사용)
  const enrichedDir = resolve(ROOT, 'docs/vfat/enriched');
  const poolMap = new Map();
  for (const c of chains) {
    const p = resolve(enrichedDir, `chain-${c.chainId}.json`);
    try {
      const pools = JSON.parse(readFileSync(p, 'utf-8'))
        .filter(p => p.tickSpacing != null); // 유효한 pool만
      if (pools.length > 0) poolMap.set(c.chainId, pools);
    } catch {}
  }

  // 체인 정렬: pool 수 내림차순
  const chainIds = [...poolMap.keys()].sort((a, b) => poolMap.get(b).length - poolMap.get(a).length);

  console.log(`Benchmarking ${chainIds.length} chains, ${[...poolMap.values()].reduce((s, p) => s + p.length, 0)} pools\n`);

  // 3개 체인 병렬
  const batches = chunk(chainIds, PARALLEL_CHAINS);
  for (const batch of batches) {
    await Promise.all(
      batch.map(cid => benchmarkChain(cid, rpcMap.get(cid) || [], poolMap.get(cid) || []))
    );
  }

  // 최종 요약
  console.log('\n═══ Summary ═══\n');
  for (const cid of chainIds) {
    const p = resolve(OUT_DIR, `chain-${cid}.json`);
    try {
      const results = JSON.parse(readFileSync(p, 'utf-8'));
      for (const r of results) {
        const maxOk = BATCH_SIZES
          .filter(s => r.multicall[s]?.success)
          .slice(-1)[0] || 0;
        const lat = r.multicall[maxOk]?.latency || '-';
        const burst = r.burst ? `${r.burst.successCount}/${r.burst.burstCount}` : '-';
        console.log(`chain ${String(cid).padEnd(7)} ${r.host.padEnd(45)} maxBatch=${String(maxOk).padEnd(4)} lat=${String(lat).padEnd(6)}ms burst=${burst}`);
      }
    } catch {}
  }

  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
