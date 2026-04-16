/**
 * TX ABI 검증 스크립트
 *
 * 체크리스트의 실측 TX hash를 조회하여 calldata의 function selector를
 * 우리 코드의 adapter가 사용하는 ABI selector와 비교한다.
 */

import { createPublicClient, http, decodeFunctionData, type Hex } from 'viem';

// ATN key from env (테스트 전용, 하드코딩 금지)
const ATN_KEY = process.env.RPC_ATN_KEY ?? '';

// Chain RPC URLs
const RPC_URLS: Record<number, string> = {
  999: 'https://rpc.hyperliquid.xyz/evm',
  8453: `https://base-mainnet.g.allthatnode.com/full/evm/${ATN_KEY}`,
  10: `https://optimism-mainnet.g.allthatnode.com/full/evm/${ATN_KEY}`,
  56: `https://bsc-mainnet.g.allthatnode.com/full/evm/${ATN_KEY}`,
};

// 우리 코드에서 사용하는 ABI (packages/core/defi/lp/ 에서 추출)
const KNOWN_SELECTORS: Record<string, string> = {
  // Mint
  '0x88316456': 'mint(UniswapV3)',             // uniswap, hyperswap, hybra, pancake
  '0xfe3f3be7': 'mint(Algebra)',                // kittenswap, nest
  '0x6d70c415': 'mint(Ramses)',                 // ramses
  '0xb5007d1f': 'mint(Aerodrome/Velodrome)',    // aerodrome, velodrome
  // Liquidity
  '0x219f5d17': 'increaseLiquidity',
  '0x0c49ccbe': 'decreaseLiquidity',
  '0xfc6f7865': 'collect',
  // NFT
  '0x095ea7b3': 'approve(ERC721)',
  '0x42842e0e': 'safeTransferFrom(ERC721)',     // MasterChef stake
  // PerPoolGauge (Hybra, Aerodrome, Velodrome)
  '0xb6b55f25': 'gauge.deposit',
  '0x2e1a7d4d': 'gauge.withdraw',
  '0x1c4b774b': 'gauge.getReward',
  // MasterChefV3 (PancakeSwap)
  '0x00f714ce': 'masterChef.withdraw',
  '0x18fccc76': 'masterChef.harvest',
  // KittenSwap FarmingCenter
  '0x5739f0b9': 'farmingCenter.enterFarming',
  '0x4473eca6': 'farmingCenter.exitFarming',
  '0x2f2d783d': 'farmingCenter.claimReward',
  // Hybra-specific
  '0x903d4296': 'hybra.gauge.withdraw(uint256,uint8)',
  // Nest-specific (Algebra without deployer)
  '0x9cc1a283': 'mint(Nest/AlgebraNoDeployer)',
  // Multicall (NonfungiblePositionManager)
  '0xac9650d8': 'multicall(bytes[])',
};

// 체크리스트에서 추출한 TX 목록
type TxEntry = {
  dex: string;
  chain: number;
  feature: string;
  hash: Hex;
  expectedSelector: string; // 우리 코드가 사용해야 하는 selector 설명
};

const TX_LIST: TxEntry[] = [
  // kittenswap (HL)
  { dex: 'kittenswap', chain: 999, feature: 'increaseLiquidity', hash: '0xd9425b8e5b813a046e52f5b80a4101de62bca02d1d3814c34423b9fde5a0482f', expectedSelector: 'increaseLiquidity' },

  // ramses (HL)
  { dex: 'ramses', chain: 999, feature: 'mint', hash: '0x997f98541e44ff3f33b646e5ec02413e3c089e2da2039e86c0588c69d976878f', expectedSelector: 'mint(Ramses)' },
  { dex: 'ramses', chain: 999, feature: 'increaseLiquidity', hash: '0xb365024ac0aa3b6c2c3ce6eb42ea3cac4ce5bd281efbc6ba7aac6c2b92fbe929', expectedSelector: 'increaseLiquidity' },
  { dex: 'ramses', chain: 999, feature: 'remove', hash: '0x0b03c9bb6185c28018072c0f833aca334ac4b5fed289d560b38e9ef66798b13b', expectedSelector: 'decreaseLiquidity or multicall' },

  // nest (HL)
  { dex: 'nest', chain: 999, feature: 'mint', hash: '0x6bdc54e6e1f9d9ccc2b6b11d0d41419cb111710b20937f7a68203d229cd952ef', expectedSelector: 'mint(Nest/AlgebraNoDeployer)' },
  { dex: 'nest', chain: 999, feature: 'increaseLiquidity', hash: '0x3ff772bd3dad860d76806901518cc127fdc8c84fea78bc184a4b4f7dc273d4ee', expectedSelector: 'increaseLiquidity' },
  { dex: 'nest', chain: 999, feature: 'remove', hash: '0xc73d37538380f14162350a77944b6d7435c23e4c20ac4d88cda202da5b561041', expectedSelector: 'decreaseLiquidity or multicall' },

  // hybra (HL)
  { dex: 'hybra', chain: 999, feature: 'mint', hash: '0xe7e7565132669c1724d032c1b8163d8c25ffb868dd0c09eb5b2eed72b4e056e1', expectedSelector: 'mint(Aerodrome/Velodrome)' },
  { dex: 'hybra', chain: 999, feature: 'approve', hash: '0xb99064bb026065e725c1cff662807f84b34a713d9077bb49904719e66ece2339', expectedSelector: 'approve(ERC721)' },
  { dex: 'hybra', chain: 999, feature: 'stake', hash: '0xb553bbb7067bbd731521b019793a5aa927ab764011eb5a082a3ca95d97d9e0a5', expectedSelector: 'gauge.deposit' },
  { dex: 'hybra', chain: 999, feature: 'unstake', hash: '0xe2729952e61e017672fc366812e92199515a569a8edef38b8b92ac7c30ccfc65', expectedSelector: 'hybra.gauge.withdraw' },
  { dex: 'hybra', chain: 999, feature: 'remove', hash: '0x92d28cdabd1fd40ecd1be125d5fd407a947e75b1e6f40ee912d3bef445f246df', expectedSelector: 'decreaseLiquidity or multicall' },

  // hyperswap (HL)
  { dex: 'hyperswap', chain: 999, feature: 'mint', hash: '0xbf3722b9802386aeb310fb709258d580284c16b50b9c97c11943a0f39a8e1f03', expectedSelector: 'mint(UniswapV3)' },
  { dex: 'hyperswap', chain: 999, feature: 'increaseLiquidity', hash: '0x1a4e4b3ae4f0104edcb7e65d9192e940bc050f57d6da32ea0f55e636ab96cbca', expectedSelector: 'increaseLiquidity' },

  // uniswap (Base)
  { dex: 'uniswap', chain: 8453, feature: 'mint', hash: '0xd09a703f6f735106e721b6342ab21837e8f75975e66fa3a285fc4bc3918c6486', expectedSelector: 'mint(UniswapV3)' },
  { dex: 'uniswap', chain: 8453, feature: 'increaseLiquidity', hash: '0x1c9d5d600001c54569d2b84dcc660fb6fed152756c148143578cd64d4c11ed81', expectedSelector: 'increaseLiquidity' },
  { dex: 'uniswap', chain: 8453, feature: 'remove', hash: '0x0084ad21e396ad74ed9a2cf1c2d9d63873f962bf658feb3bc975e6313de234ee', expectedSelector: 'decreaseLiquidity or multicall' },

  // aerodrome (Base)
  { dex: 'aerodrome', chain: 8453, feature: 'mint', hash: '0xc8b5444c15857bf35ff4529d74a2058294f0a9b8e3b63dc9609c3b5a64f3aa16', expectedSelector: 'mint(Aerodrome/Velodrome)' },
  { dex: 'aerodrome', chain: 8453, feature: 'approve', hash: '0x54f7817c675934c0e1f02a1dac48a2860cf9813349e3e8bd8a9b0245babacb41', expectedSelector: 'approve(ERC721)' },
  { dex: 'aerodrome', chain: 8453, feature: 'stake', hash: '0xc5b8ce9e09012f1101ca73df1dfe90956b822a108c768b77f56b2b57e2f4c5fa', expectedSelector: 'gauge.deposit' },
  { dex: 'aerodrome', chain: 8453, feature: 'unstake', hash: '0xb5a34b96af1a2afd0ae5c64a8643f7f180de0e38672f3ac8c8b30ad0a5fa49e2', expectedSelector: 'gauge.withdraw' },
  { dex: 'aerodrome', chain: 8453, feature: 'increaseLiquidity', hash: '0x6603629970585fa89182669736b20edcce5d3ec6cbf119c5c4150044bcf33e90', expectedSelector: 'increaseLiquidity' },
  { dex: 'aerodrome', chain: 8453, feature: 'remove', hash: '0xabe27e58988cabe29d99db271d21955c7f900a13a05a04cdb23a48c7becdd8e1', expectedSelector: 'decreaseLiquidity or multicall' },

  // velodrome (Optimism)
  { dex: 'velodrome', chain: 10, feature: 'mint', hash: '0x85674163de94ca79eb02c893fba82c6e21c4a7c4c1751b3f731f62c04266061b', expectedSelector: 'mint(Aerodrome/Velodrome)' },
  { dex: 'velodrome', chain: 10, feature: 'increaseLiquidity', hash: '0xb5dd52bbad3b37eb54abf0995514082636bde68801fe6eeac871cacd9f81955e', expectedSelector: 'increaseLiquidity' },
  { dex: 'velodrome', chain: 10, feature: 'remove', hash: '0x4d06428a8789ac468db69d8e953e6680ffde111b01b5ce53c0287a4e99b30f55', expectedSelector: 'decreaseLiquidity or multicall' },

  // pancakeSwap (BSC)
  { dex: 'pancakeSwap', chain: 56, feature: 'mint', hash: '0xc2b789b2bcc34c79772560dc7f61ad7f8ce6eb050b545ae2b36f03cff1a19261', expectedSelector: 'mint(UniswapV3)' },
  { dex: 'pancakeSwap', chain: 56, feature: 'stake', hash: '0xc138b7fb95b9d5be047baec7341157a52cd0023acbb3bfab4e3b83fd1713bd1b', expectedSelector: 'safeTransferFrom(ERC721)' },
  { dex: 'pancakeSwap', chain: 56, feature: 'increaseLiquidity', hash: '0x1cf4b97b1b8eaf7e0b6596de6e00483766c81569b7563dc8b074e1d5bf06e633', expectedSelector: 'increaseLiquidity' },
  { dex: 'pancakeSwap', chain: 56, feature: 'unstake', hash: '0xa40a5571bf51fd6ae38b7d71c2ac88f518091ba7c87acdf6d926a5ee9c7867f1', expectedSelector: 'masterChef.withdraw' },
  { dex: 'pancakeSwap', chain: 56, feature: 'remove', hash: '0x14b7b0cbd818efdd92bd684cbfbb9a2bde707f22074317a28279455142c5262a', expectedSelector: 'decreaseLiquidity or multicall' },
];

// Chain clients
const clients = new Map<number, ReturnType<typeof createPublicClient>>();

function getClient(chainId: number) {
  if (!clients.has(chainId)) {
    const url = RPC_URLS[chainId];
    if (!url) throw new Error(`No RPC URL for chain ${chainId}`);
    clients.set(chainId, createPublicClient({ transport: http(url) }));
  }
  return clients.get(chainId)!;
}

async function verifyTx(entry: TxEntry): Promise<{ entry: TxEntry; selector: string; functionName: string; match: boolean }> {
  const client = getClient(entry.chain);
  const tx = await client.getTransaction({ hash: entry.hash });
  const selector = tx.input.slice(0, 10) as string; // 0x + 4 bytes = 10 chars
  const functionName = KNOWN_SELECTORS[selector] ?? `UNKNOWN(${selector})`;

  // "or" 패턴 처리 (remove는 multicall일 수 있음)
  const expected = entry.expectedSelector.split(' or ');
  const match = expected.some(e => functionName.includes(e) || functionName === e);

  return { entry, selector, functionName, match };
}

async function main() {
  console.log(`\n=== TX ABI 검증 (${TX_LIST.length}개 TX) ===\n`);

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const entry of TX_LIST) {
    try {
      const result = await verifyTx(entry);
      const icon = result.match ? '✅' : '❌';
      console.log(`${icon} ${entry.dex}/${entry.feature} (chain ${entry.chain}): ${result.functionName}`);

      if (result.match) {
        passed++;
      } else {
        failed++;
        failures.push(`${entry.dex}/${entry.feature}: expected "${entry.expectedSelector}", got "${result.functionName}"`);
      }
    } catch (err) {
      console.log(`⚠️ ${entry.dex}/${entry.feature} (chain ${entry.chain}): RPC ERROR - ${err instanceof Error ? err.message : err}`);
      failed++;
      failures.push(`${entry.dex}/${entry.feature}: RPC error`);
    }

    // Rate limit 방지
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n=== 결과 ===`);
  console.log(`통과: ${passed}/${TX_LIST.length}`);
  console.log(`실패: ${failed}/${TX_LIST.length}`);

  if (failures.length > 0) {
    console.log(`\n불일치 목록:`);
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
  }
}

main().catch(console.error);
