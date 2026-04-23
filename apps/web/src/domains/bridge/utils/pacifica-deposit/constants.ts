export const MAINNET_PROGRAM_ID = 'PCFA5iYgmqK6MqPhWNKg7Yv7auX7VZ4Cx7T1eJyrAMH';
export const MAINNET_CENTRAL_STATE = '9Gdmhq4Gv1LnNMp7aiS1HSVd7pNnXNMsbuXALCQRmGjY';
export const MAINNET_PACIFICA_VAULT = '72R843XwZxqWhsJceARQQTTbYtWy6Zw9et2YV4FpRHTa';
export const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export const TESTNET_PROGRAM_ID = 'peRPsYCcB1J9jvrs29jiGdjkytxs8uHLmSPLKKP9ptm';
export const TESTNET_CENTRAL_STATE = '2zPRq1Qvdq5A4Ld6WsH7usgCge4ApZRYfhhf5VAjfXxv';
export const TESTNET_PACIFICA_VAULT = '5SDFdHZGTZbyRYu54CgmRkCGnPHC5pYaN27p7XGLqnBs';
export const TESTNET_USDC_MINT = 'USDPqRbLidFGufty2s3oizmDEKdqx7ePTqzDMbf5ZKM';

export const USDC_DECIMALS = 6;

export const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
export const TESTNET_RPC = 'https://api.devnet.solana.com';

export type PacificaNetwork = 'mainnet' | 'testnet';

export function getNetworkConfig(network: PacificaNetwork = 'mainnet') {
  if (network === 'testnet') {
    return {
      rpcUrl: TESTNET_RPC,
      programId: TESTNET_PROGRAM_ID,
      centralState: TESTNET_CENTRAL_STATE,
      pacificaVault: TESTNET_PACIFICA_VAULT,
      usdcMint: TESTNET_USDC_MINT,
    };
  }
  return {
    rpcUrl: MAINNET_RPC,
    programId: MAINNET_PROGRAM_ID,
    centralState: MAINNET_CENTRAL_STATE,
    pacificaVault: MAINNET_PACIFICA_VAULT,
    usdcMint: MAINNET_USDC_MINT,
  };
}
