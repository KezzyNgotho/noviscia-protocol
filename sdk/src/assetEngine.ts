/**
 * Noviscia Asset Engine — multi-asset token register, JIT credit allocation,
 * daily clearing, ERC-4626 LP share vaults, and three-tier governance RBAC.
 *
 * Faithful TypeScript mirror of `sdk/rust/noviscia-asset-engine-sdk`:
 * identical PDA seeds, account orders, signer/writable flags, and Anchor
 * data layouts (sha256(global:<ix>) discriminators, little-endian scalars),
 * so instructions built here interop bit-for-bit with the on-chain program.
 */

import { createHash } from 'node:crypto';
import { PublicKey, SystemProgram, TransactionInstruction, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { ASSET_ENGINE_PROGRAM_ID } from './ids';

export { ASSET_ENGINE_PROGRAM_ID } from './ids';

// ── Constants (mirror noviscia-types) ─────────────────────────────────────────

export const ASSET_REGISTRY_SEED = Buffer.from('asset-registry');
export const ASSET_POOL_SEED = Buffer.from('asset-pool');
export const ASSET_VAULT_SEED = Buffer.from('asset-vault');
export const ASSET_FEE_VAULT_SEED = Buffer.from('asset-fees');
export const ASSET_AUTHORITY_SEED = Buffer.from('asset-authority');
export const ASSET_CREDIT_LINE_SEED = Buffer.from('credit-line');
export const DESK_POSITION_SEED = Buffer.from('desk-position');
export const ASSET_LP_MINT_SEED = Buffer.from('asset-lp-mint');
export const ASSET_LP_POSITION_SEED = Buffer.from('asset-lp-position');

/** 24h rolling window at 400ms slots (× 400ms = 86,400s). */
export const WINDOW_SLOTS = 216_000n;
/** 2-hour operational grace (× 400ms = 7,200s). */
export const GRACE_SLOTS = 18_000n;
/** Per-slot late-fee meter calibration. */
export const LATE_FEE_BASE = 10_000n;
export const LATE_FEE_RATE_BPS = 50n;
export const BPS = 10_000n;
/** LP share-price scaling (×1_000_000). */
export const LP_PRICE_SCALE = 1_000_000n;

// ── Anchor discriminator (first 8 bytes of sha256("global:<name>")) ──────────

export function anchorDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

// ── Asset parameters (mirror SDK AssetParams) ─────────────────────────────────

export interface AssetParams {
  decimals: number;
  basePremiumRateBps: number;
  premiumCapBps: number;
  maxCapacity: bigint;
  minPremiumLamports: bigint;
  /** BPS of paid premium credited to LPs (compounds their share value). */
  lpYieldSplitBps: number;
}

export const NVSC_PROFILE: AssetParams = {
  decimals: 9,
  basePremiumRateBps: 30,
  premiumCapBps: 500,
  maxCapacity: 100_000_000_000_000n,
  minPremiumLamports: 0n,
  lpYieldSplitBps: 9_000,
};

export const USDC_PROFILE: AssetParams = {
  decimals: 6,
  basePremiumRateBps: 8,
  premiumCapBps: 250,
  maxCapacity: 5_000_000_000_000n,
  minPremiumLamports: 0n,
  lpYieldSplitBps: 9_000,
};

export const WSOL_PROFILE: AssetParams = {
  decimals: 9,
  basePremiumRateBps: 12,
  premiumCapBps: 300,
  maxCapacity: 100_000_000_000n,
  minPremiumLamports: 0n,
  lpYieldSplitBps: 9_000,
};

// ── On-chain account shapes (decode pointers; mirror noviscia-types) ─────────

export interface AssetEngineRegistry {
  breakerAuthority: PublicKey;
  riskCommitteeAuthority: PublicKey;
  upgradeAuthority: PublicKey;
  wsolMint: PublicKey;
  usdcMint: PublicKey;
  nvscMint: PublicKey;
  supportedCount: number;
  paused: boolean;
  bump: number;
}

export interface InstitutionalCreditLine {
  institution: PublicKey;
  authority: PublicKey;
  totalCreditLimit: bigint;
  activeUtilization: bigint;
  peakActiveUtilization: bigint;
  accumulatedPremiums: bigint;
  lastSettlementTimestamp: bigint;
  windowStartSlot: bigint;
  kycMerkleRoot: Uint8Array;
  frozen: boolean;
  bump: number;
}

export interface DeskPosition {
  institution: PublicKey;
  mint: PublicKey;
  activePrincipal: bigint;
  dormantPrincipal: bigint;
  slot: bigint;
  premiumAccrued: bigint;
  bump: number;
}

export interface AssetPool {
  mint: PublicKey;
  poolBump: number;
  vault: PublicKey;
  feeVault: PublicKey;
  vaultAuthority: PublicKey;
  decimals: number;
  supported: boolean;
  totalIdleCapital: bigint;
  totalOutstandingPrincipal: bigint;
  basePremiumRateBps: number;
  premiumCapBps: number;
  maxCapacity: bigint;
  minPremiumLamports: bigint;
  debtPerShare: bigint;
  lpYieldSplitBps: number;
  totalShares: bigint;
  lastDepositTimestamp: bigint;
  bump: number;
}

// ── PDA derivation (mirror SDK pda fns) ───────────────────────────────────────

function pda(seeds: (Buffer | Uint8Array)[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

export function registryPDA(programId: PublicKey = ASSET_ENGINE_PROGRAM_ID): PublicKey {
  return pda([ASSET_REGISTRY_SEED], programId);
}
export function assetPoolPDA(mint: PublicKey, programId: PublicKey = ASSET_ENGINE_PROGRAM_ID): PublicKey {
  return pda([ASSET_POOL_SEED, mint.toBuffer()], programId);
}
export function assetVaultPDA(mint: PublicKey, programId: PublicKey = ASSET_ENGINE_PROGRAM_ID): PublicKey {
  return pda([ASSET_VAULT_SEED, mint.toBuffer()], programId);
}
export function assetFeeVaultPDA(mint: PublicKey, programId: PublicKey = ASSET_ENGINE_PROGRAM_ID): PublicKey {
  return pda([ASSET_FEE_VAULT_SEED, mint.toBuffer()], programId);
}
export function assetAuthorityPDA(mint: PublicKey, programId: PublicKey = ASSET_ENGINE_PROGRAM_ID): PublicKey {
  return pda([ASSET_AUTHORITY_SEED, mint.toBuffer()], programId);
}
export function creditLinePDA(institution: PublicKey, programId: PublicKey = ASSET_ENGINE_PROGRAM_ID): PublicKey {
  return pda([ASSET_CREDIT_LINE_SEED, institution.toBuffer()], programId);
}
export function deskPositionPDA(
  institution: PublicKey,
  mint: PublicKey,
  programId: PublicKey = ASSET_ENGINE_PROGRAM_ID,
): PublicKey {
  return pda([DESK_POSITION_SEED, institution.toBuffer(), mint.toBuffer()], programId);
}
export function assetLpMintPDA(mint: PublicKey, programId: PublicKey = ASSET_ENGINE_PROGRAM_ID): PublicKey {
  return pda([ASSET_LP_MINT_SEED, mint.toBuffer()], programId);
}
export function assetLpPositionPDA(
  mint: PublicKey,
  lp: PublicKey,
  programId: PublicKey = ASSET_ENGINE_PROGRAM_ID,
): PublicKey {
  return pda([ASSET_LP_POSITION_SEED, mint.toBuffer(), lp.toBuffer()], programId);
}

// ── Serialization helpers (little-endian, mirror Anchor borsh) ────────────────

const le16 = (v: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
};
const le64 = (v: number | bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
};
const le64S = (v: number | bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(v));
  return b;
};
const le32 = (v: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
};

// ── Instruction builders (mirror SDK build_*_ix) ───────────────────────────────

const M = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({
  pubkey,
  isSigner,
  isWritable,
});

/**
 * `asset_initialize` — pins the platform mints + three-tier Squads keys.
 * Signed by the Tier-3 Core Ecosystem Council (upgrade authority).
 */
export function buildInitializeIx(
  programId: PublicKey | undefined,
  params: {
    upgradeAuthority: PublicKey;
    breakerAuthority: PublicKey;
    riskCommitteeAuthority: PublicKey;
    wsolMint: PublicKey;
    usdcMint: PublicKey;
    nvscMint: PublicKey;
  },
): TransactionInstruction {
  const pid = programId ?? ASSET_ENGINE_PROGRAM_ID;
  const data = Buffer.concat([
    anchorDiscriminator('asset_initialize'),
    params.breakerAuthority.toBuffer(),
    params.riskCommitteeAuthority.toBuffer(),
    params.upgradeAuthority.toBuffer(),
    params.wsolMint.toBuffer(),
    params.usdcMint.toBuffer(),
    params.nvscMint.toBuffer(),
  ]);
  return new TransactionInstruction({
    programId: pid,
    keys: [
      M(params.upgradeAuthority, true, true),
      M(registryPDA(pid), false, true),
      M(SystemProgram.programId, false, false),
    ],
    data,
  });
}

/** `asset_register` — onboards a mint (Tier 3: Council, 5-of-7, 72h timelock). */
export function buildRegisterAssetIx(
  programId: PublicKey | undefined,
  upgradeAuthority: PublicKey,
  mint: PublicKey,
  params: AssetParams,
): TransactionInstruction {
  const pid = programId ?? ASSET_ENGINE_PROGRAM_ID;
  const data = Buffer.concat([
    anchorDiscriminator('asset_register'),
    Buffer.from([params.decimals]),
    le16(params.basePremiumRateBps),
    le16(params.premiumCapBps),
    le64(params.maxCapacity),
    le64(params.minPremiumLamports),
    le16(params.lpYieldSplitBps),
  ]);
  return new TransactionInstruction({
    programId: pid,
    keys: [
      M(registryPDA(pid), false, true),
      M(upgradeAuthority, true, true),
      M(mint, false, false),
      M(assetPoolPDA(mint, pid), false, true),
      M(assetVaultPDA(mint, pid), false, true),
      M(assetFeeVaultPDA(mint, pid), false, true),
      M(assetLpMintPDA(mint, pid), false, true),
      M(assetAuthorityPDA(mint, pid), false, false),
      M(SystemProgram.programId, false, false),
      M(TOKEN_PROGRAM_ID, false, false),
      M(SYSVAR_RENT_PUBKEY, false, false),
    ],
    data,
  });
}

/** `asset_update_params` — adjusts a registered asset (Tier 2: Risk Committee). */
export function buildUpdateAssetParamsIx(
  programId: PublicKey | undefined,
  riskCommitteeAuthority: PublicKey,
  mint: PublicKey,
  params: AssetParams,
): TransactionInstruction {
  const pid = programId ?? ASSET_ENGINE_PROGRAM_ID;
  const data = Buffer.concat([
    anchorDiscriminator('asset_update_params'),
    le16(params.basePremiumRateBps),
    le16(params.premiumCapBps),
    le64(params.maxCapacity),
    le64(params.minPremiumLamports),
    le16(params.lpYieldSplitBps),
  ]);
  return new TransactionInstruction({
    programId: pid,
    keys: [
      M(registryPDA(pid), false, false),
      M(riskCommitteeAuthority, true, true),
      M(assetPoolPDA(mint, pid), false, true),
      M(mint, false, false),
    ],
    data,
  });
}

/** `asset_set_support` — toggles a supported latch (Tier 2: Risk Committee). */
export function buildSetAssetSupportIx(
  programId: PublicKey | undefined,
  riskCommitteeAuthority: PublicKey,
  mint: PublicKey,
  supported: boolean,
): TransactionInstruction {
  const pid = programId ?? ASSET_ENGINE_PROGRAM_ID;
  const data = Buffer.concat([
    anchorDiscriminator('asset_set_support'),
    Buffer.from([supported ? 1 : 0]),
  ]);
  return new TransactionInstruction({
    programId: pid,
    keys: [
      M(registryPDA(pid), false, false),
      M(riskCommitteeAuthority, true, true),
      M(assetPoolPDA(mint, pid), false, true),
      M(mint, false, false),
    ],
    data,
  });
}

/** `asset_initialize_credit_line` — desk ceiling (Tier 2: Risk Committee, post-KYB). */
export function buildInitializeCreditLineIx(
  programId: PublicKey | undefined,
  institution: PublicKey,
  riskCommitteeAuthority: PublicKey,
  totalCreditLimit: bigint,
): TransactionInstruction {
  const pid = programId ?? ASSET_ENGINE_PROGRAM_ID;
  const data = Buffer.concat([
    anchorDiscriminator('asset_initialize_credit_line'),
    le64(totalCreditLimit),
  ]);
  return new TransactionInstruction({
    programId: pid,
    keys: [
      M(registryPDA(pid), false, true),
      M(institution, true, true),
      M(riskCommitteeAuthority, true, true),
      M(creditLinePDA(institution, pid), false, true),
      M(SystemProgram.programId, false, false),
    ],
    data,
  });
}

/** `asset_update_credit_limit` — changes the ceiling (Tier 2: Risk Committee). */
export function buildUpdateCreditLimitIx(
  programId: PublicKey | undefined,
  riskCommitteeAuthority: PublicKey,
  institution: PublicKey,
  newLimit: bigint,
): TransactionInstruction {
  const pid = programId ?? ASSET_ENGINE_PROGRAM_ID;
  const data = Buffer.concat([
    anchorDiscriminator('asset_update_credit_limit'),
    le64(newLimit),
  ]);
  return new TransactionInstruction({
    programId: pid,
    keys: [
      M(registryPDA(pid), false, false),
      M(riskCommitteeAuthority, true, true),
      M(creditLinePDA(institution, pid), false, true),
      M(institution, false, false),
    ],
    data,
  });
}

/** `asset_set_credit_frozen` — desk freeze (Tier 1: Breaker, 1-of-3). */
export function buildSetCreditFrozenIx(
  programId: PublicKey | undefined,
  breakerAuthority: PublicKey,
  institution: PublicKey,
  frozen: boolean,
): TransactionInstruction {
  const pid = programId ?? ASSET_ENGINE_PROGRAM_ID;
  const data = Buffer.concat([
    anchorDiscriminator('asset_set_credit_frozen'),
    Buffer.from([frozen ? 1 : 0]),
  ]);
  return new TransactionInstruction({
    programId: pid,
    keys: [
      M(registryPDA(pid), false, false),
      M(breakerAuthority, true, true),
      M(creditLinePDA(institution, pid), false, true),
      M(institution, false, false),
    ],
    data,
  });
}

/** `asset_set_paused` — engine-level allocation pause (Tier 1: Breaker, 1-of-3). */
export function buildSetPausedIx(
  programId: PublicKey | undefined,
  breakerAuthority: PublicKey,
  paused: boolean,
): TransactionInstruction {
  const pid = programId ?? ASSET_ENGINE_PROGRAM_ID;
  const data = Buffer.concat([
    anchorDiscriminator('asset_set_paused'),
    Buffer.from([paused ? 1 : 0]),
  ]);
  return new TransactionInstruction({
    programId: pid,
    keys: [M(breakerAuthority, true, true), M(registryPDA(pid), false, true)],
    data,
  });
}

/**
 * `asset_allocate_capacity` — single-slot JIT allocation. `expiry` is the KYC
 * leaf timestamp (unix seconds); `merkleProof` must validate against the root.
 */
export function buildAllocateAssetCapacityIx(
  programId: PublicKey | undefined,
  params: {
    mint: PublicKey;
    institution: PublicKey;
    trader: PublicKey;
    traderTokenAccount: PublicKey;
    requestedAmount: bigint;
    targetSlot: bigint;
    expectedPremium: bigint;
    expiry: bigint;
    merkleProof: Uint8Array[];
  },
): TransactionInstruction {
  const pid = programId ?? ASSET_ENGINE_PROGRAM_ID;
  const data = Buffer.concat([
    anchorDiscriminator('asset_allocate_capacity'),
    le64(params.requestedAmount),
    le64(params.targetSlot),
    le64(params.expectedPremium),
    le64S(params.expiry),
    le32(params.merkleProof.length),
    ...params.merkleProof.map((n) => Buffer.from(n)),
  ]);
  return new TransactionInstruction({
    programId: pid,
    keys: [
      M(assetPoolPDA(params.mint, pid), false, true),
      M(assetVaultPDA(params.mint, pid), false, true),
      M(assetAuthorityPDA(params.mint, pid), false, false),
      M(creditLinePDA(params.institution, pid), false, true),
      M(deskPositionPDA(params.institution, params.mint, pid), false, true),
      M(params.trader, true, true),
      M(params.traderTokenAccount, false, true),
      M(assetFeeVaultPDA(params.mint, pid), false, true),
      M(TOKEN_PROGRAM_ID, false, false),
      M(SystemProgram.programId, false, false),
    ],
    data,
  });
}

/** `asset_recredit_capacity` — releases unused slot capital. */
export function buildRecreditAssetCapacityIx(
  programId: PublicKey | undefined,
  mint: PublicKey,
  institution: PublicKey,
  trader: PublicKey,
  traderTokenAccount: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const pid = programId ?? ASSET_ENGINE_PROGRAM_ID;
  const data = Buffer.concat([
    anchorDiscriminator('asset_recredit_capacity'),
    le64(amount),
  ]);
  return new TransactionInstruction({
    programId: pid,
    keys: [
      M(assetPoolPDA(mint, pid), false, true),
      M(assetVaultPDA(mint, pid), false, true),
      M(creditLinePDA(institution, pid), false, true),
      M(deskPositionPDA(institution, mint, pid), false, true),
      M(trader, true, true),
      M(traderTokenAccount, false, true),
      M(TOKEN_PROGRAM_ID, false, false),
    ],
    data,
  });
}

/** `asset_set_kyc_root` — desk's provider-agnostic Merkle KYC root (Tier 2). */
export function buildSetKycRootIx(
  programId: PublicKey | undefined,
  riskCommitteeAuthority: PublicKey,
  institution: PublicKey,
  kycMerkleRoot: Uint8Array,
): TransactionInstruction {
  const pid = programId ?? ASSET_ENGINE_PROGRAM_ID;
  const data = Buffer.concat([
    anchorDiscriminator('asset_set_kyc_root'),
    Buffer.from(kycMerkleRoot),
  ]);
  return new TransactionInstruction({
    programId: pid,
    keys: [
      M(registryPDA(pid), false, false),
      M(riskCommitteeAuthority, true, true),
      M(creditLinePDA(institution, pid), false, true),
      M(institution, false, false),
    ],
    data,
  });
}

/** `asset_settle_daily` — 24h clearing house settlement in the exact borrowed asset. */
export function buildSettleDailyIx(
  programId: PublicKey | undefined,
  mint: PublicKey,
  institution: PublicKey,
  treasury: PublicKey,
  treasuryTokenAccount: PublicKey,
  principalPayment: bigint,
  premiumPayment: bigint,
  lateFeePayment: bigint,
): TransactionInstruction {
  const pid = programId ?? ASSET_ENGINE_PROGRAM_ID;
  const data = Buffer.concat([
    anchorDiscriminator('asset_settle_daily'),
    le64(principalPayment),
    le64(premiumPayment),
    le64(lateFeePayment),
  ]);
  return new TransactionInstruction({
    programId: pid,
    keys: [
      M(assetPoolPDA(mint, pid), false, true),
      M(assetVaultPDA(mint, pid), false, true),
      M(assetFeeVaultPDA(mint, pid), false, true),
      M(creditLinePDA(institution, pid), false, true),
      M(deskPositionPDA(institution, mint, pid), false, true),
      M(treasury, true, true),
      M(treasuryTokenAccount, false, true),
      M(TOKEN_PROGRAM_ID, false, false),
    ],
    data,
  });
}

/** `asset_deposit_liquidity` — LP seeds a vault, mints ERC-4626 shares. */
export function buildDepositAssetLiquidityIx(
  programId: PublicKey | undefined,
  mint: PublicKey,
  provider: PublicKey,
  providerTokenAccount: PublicKey,
  providerLpTokenAccount: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const pid = programId ?? ASSET_ENGINE_PROGRAM_ID;
  const data = Buffer.concat([
    anchorDiscriminator('asset_deposit_liquidity'),
    le64(amount),
  ]);
  return new TransactionInstruction({
    programId: pid,
    keys: [
      M(assetPoolPDA(mint, pid), false, true),
      M(assetVaultPDA(mint, pid), false, true),
      M(assetLpMintPDA(mint, pid), false, true),
      M(assetLpPositionPDA(mint, provider, pid), false, true),
      M(assetAuthorityPDA(mint, pid), false, false),
      M(provider, true, true),
      M(providerTokenAccount, false, true),
      M(providerLpTokenAccount, false, true),
      M(TOKEN_PROGRAM_ID, false, false),
      M(SystemProgram.programId, false, false),
    ],
    data,
  });
}

/** `asset_withdraw_liquidity` — burn shares, redeem subject to solvency floor. */
export function buildWithdrawAssetLiquidityIx(
  programId: PublicKey | undefined,
  mint: PublicKey,
  lp: PublicKey,
  lpTokenAccount: PublicKey,
  destination: PublicKey,
  shares: bigint,
): TransactionInstruction {
  const pid = programId ?? ASSET_ENGINE_PROGRAM_ID;
  const data = Buffer.concat([
    anchorDiscriminator('asset_withdraw_liquidity'),
    le64(shares),
  ]);
  return new TransactionInstruction({
    programId: pid,
    keys: [
      M(assetPoolPDA(mint, pid), false, true),
      M(assetVaultPDA(mint, pid), false, true),
      M(assetLpMintPDA(mint, pid), false, false),
      M(assetLpPositionPDA(mint, lp, pid), false, true),
      M(assetAuthorityPDA(mint, pid), false, false),
      M(lp, true, true),
      M(lpTokenAccount, false, true),
      M(destination, false, true),
      M(TOKEN_PROGRAM_ID, false, false),
    ],
    data,
  });
}

/** `asset_withdraw_fees` — treasury sweep of a fee vault (Tier 3: Council). */
export function buildWithdrawAssetFeesIx(
  programId: PublicKey | undefined,
  upgradeAuthority: PublicKey,
  mint: PublicKey,
  destination: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const pid = programId ?? ASSET_ENGINE_PROGRAM_ID;
  const data = Buffer.concat([
    anchorDiscriminator('asset_withdraw_fees'),
    le64(amount),
  ]);
  return new TransactionInstruction({
    programId: pid,
    keys: [
      M(assetPoolPDA(mint, pid), false, true),
      M(registryPDA(pid), false, false),
      M(upgradeAuthority, true, true),
      M(assetFeeVaultPDA(mint, pid), false, true),
      M(assetAuthorityPDA(mint, pid), false, false),
      M(destination, false, true),
      M(TOKEN_PROGRAM_ID, false, false),
    ],
    data,
  });
}

// ── Math helpers (mirror SDK compute_* fns) ───────────────────────────────────

/** Micro-premium on an allocation: principal × bps / 10_000, floored. */
export function computePremium(
  principal: bigint,
  basePremiumRateBps: number,
  minPremiumLamports: bigint,
): bigint {
  const bps = (principal * BigInt(basePremiumRateBps)) / 10_000n;
  return bps > minPremiumLamports ? bps : minPremiumLamports;
}

/** Per-block default-interest meter for the grace phase (mirror on-chain). */
export function computeLateFee(principal: bigint, overdueBlocks: bigint): bigint {
  if (overdueBlocks === 0n) return 0n;
  return (principal * LATE_FEE_RATE_BPS * overdueBlocks) / (BPS * LATE_FEE_BASE);
}

/** Deterministic posture of the 24h floating window at `currentSlot`. */
export type WindowPosture = 'NoWindow' | 'Open' | 'Overdue' | 'Breached';

export function windowPosture(windowStartSlot: bigint, currentSlot: bigint): WindowPosture {
  if (windowStartSlot === 0n) return 'NoWindow';
  const mature = windowStartSlot + WINDOW_SLOTS;
  if (currentSlot < mature) return 'Open';
  if (currentSlot < mature + GRACE_SLOTS) return 'Overdue';
  return 'Breached';
}

/** ERC-4626 deposit: 1:1 on first deposit, else shares = deposit × totalShares / totalAssets. */
export function computeDepositShares(
  deposit: bigint,
  totalShares: bigint,
  totalAssets: bigint,
): bigint {
  if (deposit === 0n) return 0n;
  if (totalShares === 0n || totalAssets === 0n) return deposit;
  return (deposit * totalShares) / totalAssets;
}

/** ERC-4626 redeem: assets = shares × totalAssets / totalShares (capped). */
export function computeLpWithdrawValue(
  shares: bigint,
  totalShares: bigint,
  totalAssets: bigint,
): bigint {
  if (shares === 0n || totalShares === 0n) return 0n;
  const value = (shares * totalAssets) / totalShares;
  return value > totalAssets ? totalAssets : value;
}

/** Scaled per-share price (×1_000_000) — the auto-compounding readout. */
export function computeLpSharePrice(totalShares: bigint, totalAssets: bigint): bigint {
  if (totalShares === 0n) return LP_PRICE_SCALE;
  return (totalAssets * LP_PRICE_SCALE) / totalShares;
}

/** One-shot convenience: register wSOL/USDC/NVSC with its standard profile. */
export function registerAssetDefault(
  upgradeAuthority: PublicKey,
  mint: PublicKey,
  profile: AssetParams,
): TransactionInstruction {
  return buildRegisterAssetIx(ASSET_ENGINE_PROGRAM_ID, upgradeAuthority, mint, profile);
}