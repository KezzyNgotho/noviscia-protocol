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
  mintPool?: PublicKey;
  mintPoolAuthority?: PublicKey;
  mintPoolVault?: PublicKey;
  userMintVault?: PublicKey;
  insuranceBuffer: PublicKey;
  assetRiskConfig?: PublicKey;
  assetExposure?: PublicKey;
  principalPartition: PublicKey;
  timelockedAdmin: PublicKey;
  userVaultState?: PublicKey;
  withdrawalTracker: PublicKey;
  protocolWithdrawal: PublicKey;
}
export function vaultAddresses(usdcMint: PublicKey, user?: PublicKey, collateralMint?: PublicKey): VaultAddresses {
  const pid = PROGRAM_IDS.nvUsdcVault;
  const vaultConfig = pda([B('nv-vault-config'), usdcMint.toBuffer()], pid);
  const result: VaultAddresses = {
    vaultConfig,
    vaultAuthority: pda([B('nv-vault-authority'), usdcMint.toBuffer()], pid),
    vaultUsdc: pda([B('nv-vault-usdc'), usdcMint.toBuffer()], pid),
    nvscusdcMint: pda([B('nvscusdc-mint'), usdcMint.toBuffer()], pid),
    insuranceBuffer: pda([B('insurance-buffer'), vaultConfig.toBuffer()], pid),
    principalPartition: pda([B('principal-partition'), vaultConfig.toBuffer()], pid),
    timelockedAdmin: pda([B('timelocked-admin')], pid),
    withdrawalTracker: pda([B('withdrawal-trk')], pid),
    protocolWithdrawal: pda([B('proto-withdrawal')], pid),
  };
  if (user) {
    result.userVaultState = pda([B('user-vault-state'), user.toBuffer(), vaultConfig.toBuffer()], pid);
  }
  if (collateralMint) {
    const mintPool = pda([B('mint-pool'), vaultConfig.toBuffer(), collateralMint.toBuffer()], pid);
    const mintPoolAuthority = pda([B('mint-pool-authority'), mintPool.toBuffer()], pid);
    result.mintPool = mintPool;
    result.mintPoolAuthority = mintPoolAuthority;
    result.mintPoolVault = pda([B('mint-pool-vault'), mintPool.toBuffer()], pid);
    result.assetRiskConfig = pda([B('asset-risk'), vaultConfig.toBuffer(), collateralMint.toBuffer()], pid);
    result.assetExposure = pda([B('asset-exposure'), vaultConfig.toBuffer(), collateralMint.toBuffer()], pid);
    if (user) {
      result.userMintVault = pda([B('user-mint-vault'), user.toBuffer(), mintPool.toBuffer()], pid);
    }
  }
  return result;
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

// ─── jit-risk (time-slice marketplace) ────────────────────────────────────────
export interface JitRiskAddresses {
  marketplace: PublicKey;
  usdcVault: PublicKey;
  mmRegistration: PublicKey;
  receipt: PublicKey;
}
export function jitRiskAddresses(mm: PublicKey, slot?: number | bigint): JitRiskAddresses {
  const pid = PROGRAM_IDS.jitRisk;
  const slotBuf = Buffer.alloc(8);
  slotBuf.writeBigUInt64LE(BigInt(slot ?? 0));
  return {
    marketplace: pda([B('marketplace')], pid),
    usdcVault: pda([B('usdc_vault')], pid),
    mmRegistration: pda([B('mm'), mm.toBuffer()], pid),
    receipt: slot !== undefined ? pda([B('slice'), mm.toBuffer(), slotBuf], pid) : PublicKey.default,
  };
}
