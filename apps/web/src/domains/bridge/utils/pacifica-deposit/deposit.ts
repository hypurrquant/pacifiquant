import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { getNetworkConfig, type PacificaNetwork } from './constants';

const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM = new PublicKey('11111111111111111111111111111111');

async function getDepositDiscriminator(): Promise<Uint8Array> {
  const data = new TextEncoder().encode('global:deposit');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hash).slice(0, 8);
}

function getATA(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBytes(), TOKEN_PROGRAM.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM,
  );
  return ata;
}

function getEventAuthority(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('__event_authority')],
    programId,
  );
  return pda;
}

export async function buildDepositInstruction(
  userPubkey: PublicKey,
  // Accepted as u64 lamports (USDC * 10^6) to keep the program call float-free;
  // callers should use viem's parseUnits(state.amount, 6) rather than number math.
  amountLamports: bigint,
  network: PacificaNetwork = 'mainnet',
): Promise<TransactionInstruction> {
  const config = getNetworkConfig(network);
  const programId = new PublicKey(config.programId);
  const centralState = new PublicKey(config.centralState);
  const pacificaVault = new PublicKey(config.pacificaVault);
  const usdcMint = new PublicKey(config.usdcMint);

  const userATA = getATA(userPubkey, usdcMint);
  const eventAuthority = getEventAuthority(programId);

  const discriminator = await getDepositDiscriminator();
  const amountBytes = new Uint8Array(8);
  const view = new DataView(amountBytes.buffer);
  view.setBigUint64(0, amountLamports, true);

  const data = new Uint8Array(discriminator.length + amountBytes.length);
  data.set(discriminator, 0);
  data.set(amountBytes, discriminator.length);

  // Account order is critical — matches Pacifica's deposit instruction layout.
  const keys = [
    { pubkey: userPubkey, isSigner: true, isWritable: true },
    { pubkey: userATA, isSigner: false, isWritable: true },
    { pubkey: centralState, isSigner: false, isWritable: true },
    { pubkey: pacificaVault, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: usdcMint, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ keys, programId, data: Buffer.from(data) });
}
