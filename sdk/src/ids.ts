import { PublicKey } from '@solana/web3.js';

const pk = (envKey: string, fallback: string): PublicKey =>
  new PublicKey(process.env[envKey] || fallback);

/**
 * Devnet program IDs for the full Noviscia stack. All may be overridden via
 * env (SDK consumers) / NEXT_PUBLIC_* (web). Defaults mirror
 * app/web/lib/programs.ts plus the programs added by the CCP topology work.
 */
export const PROGRAM_IDS = {
  escrow: pk('NEXT_PUBLIC_ESCROW_PROGRAM_ID', 'CTmCryJca9cFyMRaGdzrhyZeEnjdGLD8ZkEqNcNbvh2D'),
  lending: pk('NEXT_PUBLIC_LENDING_PROGRAM_ID', 'Ea5TXHxsVcnKwMAcAsQkpPN88xr8ndBRpNGDkREWrbSZ'),
  positionTracker: pk('POSITION_TRACKER_PROGRAM_ID', '3zGRWKZq4V3npHbH9Lati46BwgmstTjynWZFFMxarQgY'),
  burnEngine: pk('NEXT_PUBLIC_BURN_PROGRAM_ID', 'nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id'),
  stakingManager: pk('NEXT_PUBLIC_STAKING_PROGRAM_ID', '4VDQjH73DiE3zYt66ukyWY7KMMJrxHUZfjkxRHTPDG75'),
  nvUsdcVault: pk('NEXT_PUBLIC_NV_USDC_VAULT_PROGRAM_ID', 'CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC'),
  yieldDistributor: pk('NEXT_PUBLIC_YIELD_DISTRIBUTOR_PROGRAM_ID', 'CrN1o75FGwcSo6ted7eKxw2kYgkaXDVeWmUaTZCTsLtw'),
  liquidationVault: pk('NEXT_PUBLIC_LIQUIDATION_VAULT_PROGRAM_ID', 'C5mvuPTN7KHQ1NsXSUcD2tEae9fL1pLrNkZD67jRRuf1'),
  predictionMarket: pk('NEXT_PUBLIC_PREDICTION_MARKET_PROGRAM_ID', '3BTcArdsxKhzF2Msjm3JLy343v6ZvQjPusq3V2zRNbpv'),
  tokenNvsc: pk('NEXT_PUBLIC_TOKEN_NVSC_PROGRAM_ID', 'HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT'),
  protocolLpVault: pk('NEXT_PUBLIC_PROTOCOL_LP_VAULT_PROGRAM_ID', 'BJVr4bWdNkaUNff3Se6Wob2edPoc64dAaW3Gkgtf4AgT'),
  bugBounty: pk('NEXT_PUBLIC_BUG_BOUNTY_PROGRAM_ID', 'A8Uk9WuHumfiuuZAHt4y3t3sXmT3cpXVXaFMhpDinjSK'),
  // CCP topology additions
  nettingEngine: pk('NETTING_ENGINE_PROGRAM_ID', '68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56'),
  yieldRouter: pk('YIELD_ROUTER_PROGRAM_ID', 'FKaAPPid8B6hUme4w8bFCDzmvE6DpekXpeiR1sgyLwB4'),
};

export const USDC_MINT = pk('NEXT_PUBLIC_USDC_MINT', 'Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5');
export const NVSC_MINT = pk('NEXT_PUBLIC_NVSC_MINT', '4BXiDT5o9J6aQdJNd36QE1L2YvQqedEKSP1wuQdSgJkg');
export const NVSCUSDC_MINT = pk('NEXT_PUBLIC_NVSCUSDC_MINT', '2TmaUey4Hh2om1kFR77Vw1RDh8H69qcW6UAACVidJeVk');

export const TREASURY_ID = 0;
