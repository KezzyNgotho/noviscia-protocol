import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PROGRAM_IDS } from './ids';

export function pda(seeds: (Buffer | Uint8Array)[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

const B = (s: string): Buffer => Buffer.from(s);

// ─── position-tracker ─────────────────────────────────────────────────────────
export interface PtAddresses {
  ptConfig: PublicKey;
  settlementVault: PublicKey;
  position: PublicKey;
  collateralVault: PublicKey;
  referral: PublicKey;
}
export function ptAddresses(owner: PublicKey, market: PublicKey, subId = 0): PtAddresses {
  const pid = PROGRAM_IDS.positionTracker;
  return {
    ptConfig: pda([B('pt-config')], pid),
    settlementVault: pda([B('settlement-vault')], pid),
    position: pda([B('position'), owner.toBuffer(), market.toBuffer(), Buffer.from([subId])], pid),
    collateralVault: pda([B('collateral-vault'), pda([B('position'), owner.toBuffer(), market.toBuffer(), Buffer.from([subId])], pid).toBuffer()], pid),
    referral: pda([B('referral'), owner.toBuffer()], pid),
  };
}

// ─── netting engine (CCP ledger) ──────────────────────────────────────────────
export interface NettingAddresses {
  config: PublicKey;
  houseBook: PublicKey;
  venue: PublicKey;
  netPosition: PublicKey;
  nettingSet: PublicKey;
}
export function nettingAddresses(trader: PublicKey, venueId = 0): NettingAddresses {
  const pid = PROGRAM_IDS.nettingEngine;
  return {
    config: pda([B('config')], pid),
    houseBook: pda([B('housebook')], pid),
    venue: pda([B('venue'), Buffer.from([venueId])], pid),
    netPosition: pda([B('position'), pda([B('venue'), Buffer.from([venueId])], pid).toBuffer(), trader.toBuffer()], pid),
    nettingSet: pda([B('netting'), trader.toBuffer()], pid),
  };
}

// ─── yield-router (atomic recall orchestrator) ─────────────────────────────────
export interface YieldRouterAddresses {
  yrConfig: PublicKey;
  venueAta: PublicKey;
}
export function yrAddresses(usdcMint: PublicKey): YieldRouterAddresses {
  const pid = PROGRAM_IDS.yieldRouter;
  const yrConfig = pda([B('yr-config')], pid);
  const venueAta = getAssociatedTokenAddressSync(usdcMint, yrConfig, true, TOKEN_PROGRAM_ID);
  return { yrConfig, venueAta };
}

// ─── nv-usdc-vault (omni-pool) ─────────────────────────────────────────────────
export interface VaultAddresses {
  vaultConfig: PublicKey;
  vaultAuthority: PublicKey;
  vaultUsdc: PublicKey;
  nvscusdcMint: PublicKey;
  mintPool: PublicKey;
  mintPoolAuthority: PublicKey;
  mintPoolVault: PublicKey;
  userMintVault: PublicKey;
  insuranceBuffer: PublicKey;
  assetRiskConfig: PublicKey;
  assetExposure: PublicKey;
  principalPartition: PublicKey;
  timelockedAdmin: PublicKey;
  userVaultState: PublicKey;
  withdrawalTracker: PublicKey;
  protocolWithdrawal: PublicKey;
}
export function vaultAddresses(usdcMint: PublicKey, user?: PublicKey): VaultAddresses {
  const pid = PROGRAM_IDS.nvUsdcVault;
  const mintPool = pda([B('mint-pool')], pid);
  const mintPoolAuthority = pda([B('mint-pool-authority')], pid);
  return {
    vaultConfig: pda([B('nv-vault-config'), usdcMint.toBuffer()], pid),
    vaultAuthority: pda([B('nv-vault-authority'), usdcMint.toBuffer()], pid),
    vaultUsdc: pda([B('nv-vault-usdc'), usdcMint.toBuffer()], pid),
    nvscusdcMint: pda([B('nvscusdc-mint'), usdcMint.toBuffer()], pid),
    mintPool,
    mintPoolAuthority,
    mintPoolVault: pda([B('mint-pool-vault')], pid),
    userMintVault: user
      ? pda([B('user-mint-vault'), mintPoolAuthority.toBuffer(), user.toBuffer()], pid)
      : pda([B('user-mint-vault')], pid),
    insuranceBuffer: pda([B('insurance-buffer'), usdcMint.toBuffer()], pid),
    assetRiskConfig: pda([B('asset-risk'), usdcMint.toBuffer()], pid),
    assetExposure: pda([B('asset-exposure'), usdcMint.toBuffer()], pid),
    principalPartition: pda([B('principal-partition'), usdcMint.toBuffer()], pid),
    timelockedAdmin: pda([B('timelocked-admin'), usdcMint.toBuffer()], pid),
    userVaultState: user
      ? pda([B('user-vault-state'), usdcMint.toBuffer(), user.toBuffer()], pid)
      : pda([B('user-vault-state'), usdcMint.toBuffer()], pid),
    withdrawalTracker: pda([B('withdrawal-trk')], pid),
    protocolWithdrawal: pda([B('proto-withdrawal')], pid),
  };
}

// ─── burn-engine + staking (fee routing) ───────────────────────────────────────
export interface FeeRoutingAddresses {
  burnState: PublicKey;
  burnVaultUsdc: PublicKey;
  stakingFeePool: PublicKey;
  stakingFeeVault: PublicKey;
  stakeAccount: PublicKey;
}
export function feeRoutingAddresses(usdcMint: PublicKey, staker?: PublicKey): FeeRoutingAddresses {
  const burnState = pda([B('burn_state')], PROGRAM_IDS.burnEngine);
  const stakingFeePool = pda([B('staking-fee-pool')], PROGRAM_IDS.stakingManager);
  return {
    burnState,
    burnVaultUsdc: getAssociatedTokenAddressSync(usdcMint, burnState, true, TOKEN_PROGRAM_ID),
    stakingFeePool,
    stakingFeeVault: pda([B('staking-fee-pool'), B('vault')], PROGRAM_IDS.stakingManager),
    stakeAccount: staker
      ? pda([B('stake'), staker.toBuffer()], PROGRAM_IDS.stakingManager)
      : pda([B('stake')], PROGRAM_IDS.stakingManager),
  };
}
