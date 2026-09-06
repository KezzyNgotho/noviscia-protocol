import { PublicKey } from '@solana/web3.js';

const pk = (envKey: string, fallback: string): PublicKey =>
  new PublicKey(process.env[envKey] || fallback);

/**
 * Devnet program IDs for the full Noviscia stack. All may be overridden via
 * env (SDK consumers) / NEXT_PUBLIC_* (web). Defaults mirror
 * app/web/lib/programs.ts plus the programs added by the CCP topology work.
 */
export const PROGRAM_IDS = {
  escrow: pk('NEXT_PUBLIC_ESCROW_PROGRAM_ID', '2WPb3wsyp4G6zFPx8sTYf3bTDyySxwpo1Ja8H6RCHXCZ'),
  positionTracker: pk('POSITION_TRACKER_PROGRAM_ID', '6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws'),
  burnEngine: pk('NEXT_PUBLIC_BURN_PROGRAM_ID', 'nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id'),
  stakingManager: pk('NEXT_PUBLIC_STAKING_PROGRAM_ID', 'HjxcKV51A7jxE2iqMCDY7EvWFL9XsheuM43DamWGabqb'),
  nvUsdcVault: pk('NEXT_PUBLIC_NV_USDC_VAULT_PROGRAM_ID', 'CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC'),
  yieldDistributor: pk('NEXT_PUBLIC_YIELD_DISTRIBUTOR_PROGRAM_ID', 'CrN1o75FGwcSo6ted7eKxw2kYgkaXDVeWmUaTZCTsLtw'),
  liquidationVault: pk('NEXT_PUBLIC_LIQUIDATION_VAULT_PROGRAM_ID', 'Cwma3FfMKhoLkgfrGYgErVPoFWEtHpx7DNc4wArpRHBz'),
  predictionMarket: pk('NEXT_PUBLIC_PREDICTION_MARKET_PROGRAM_ID', 'GtTJWLa6MXjZoNucGHWVnE9LpZTw6Dsr5K1gxpM1Q4fe'),
  tokenNvsc: pk('NEXT_PUBLIC_TOKEN_NVSC_PROGRAM_ID', 'HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT'),
  protocolLpVault: pk('NEXT_PUBLIC_PROTOCOL_LP_VAULT_PROGRAM_ID', '2WUt24rRNWsdi8sE56y74b7rJGgKbxSBsu7ntDkGAJkd'),
  bugBounty: pk('NEXT_PUBLIC_BUG_BOUNTY_PROGRAM_ID', 'A8Uk9WuHumfiuuZAHt4y3t3sXmT3cpXVXaFMhpDinjSK'),
  // CCP topology additions
  nettingEngine: pk('NETTING_ENGINE_PROGRAM_ID', '68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56'),
  yieldRouter: pk('YIELD_ROUTER_PROGRAM_ID', 'FKaAPPid8B6hUme4w8bFCDzmvE6DpekXpeiR1sgyLwB4'),
  clearingRegistry: pk('CLEARING_REGISTRY_PROGRAM_ID', 'Hg5QvSsnb22gHexUTnvvfff3EJZxWnsFKRM8bZ8n7Jmo'),
  spotDex: pk('NEXT_PUBLIC_SPOT_DEX_PROGRAM_ID', '8C4try8mEHukT4Z99Dpi3x1rNaBYhXms81uoU47JwLiN'),
  jitRisk: pk('JIT_RISK_PROGRAM_ID', 'JDsM18uSZ1UJEP49XdKSjumdftpuZ8cJbpb8CkBaBiMc'),
  // Credit line — folded into the netting-engine host as `cl_*` handlers (Stage 3).
  creditLine: pk('NEXT_PUBLIC_CREDIT_LINE_PROGRAM_ID', '68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56'),
  // Institutional asset lifecycle (asset_* handlers on the noviscia-capacity host)
  assetEngine: pk('ASSET_ENGINE_PROGRAM_ID', 'JDsM18uSZ1UJEP49XdKSjumdftpuZ8cJbpb8CkBaBiMc'),
};

export const USDC_MINT = pk('NEXT_PUBLIC_USDC_MINT', 'Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5');
export const NVSC_MINT = pk('NEXT_PUBLIC_NVSC_MINT', '4BXiDT5o9J6aQdJNd36QE1L2YvQqedEKSP1wuQdSgJkg');
export const NVSCUSDC_MINT = pk('NEXT_PUBLIC_NVSCUSDC_MINT', '2TmaUey4Hh2om1kFR77Vw1RDh8H69qcW6UAACVidJeVk');
export const ASSET_ENGINE_PROGRAM_ID = pk('ASSET_ENGINE_PROGRAM_ID', 'JDsM18uSZ1UJEP49XdKSjumdftpuZ8cJbpb8CkBaBiMc');

export const TREASURY_ID = 0;
