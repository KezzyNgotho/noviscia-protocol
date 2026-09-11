/**
 * Router-Pool Leg Provider — the on-chain liquidity pool the TVV gate's
 * sequential mode routes its real swap legs through.
 *
 * The vault host's `router_pool.rs` is a constant-product pool (single
 * direction: base → quote) with an insurance cut and (optional) KYC merkle
 * gate. For the devnet proof the pool is the *real liquidity* the searcher
 * trades against between `tvv_gate_arm` and `tvv_gate_settle`: a two-pool
 * circular route (A: USDC→nvUSDC, B: nvUSDC→USDC) nets the searcher a real
 * cross-pool spread, exactly like the cross-venue spatial arb of the keeper.
 *
 * Instruction data and account maps are hand-built against the Rust
 * `Router*` contexts in `lib.rs` — byte-for-byte, nothing guessed. The
 * Anchor discriminators are the first 8 bytes of
 * `sha256("global:<handler>")`.
 */

import { PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PROGRAM_IDS } from './ids';

/** nvUSDC — the vault's own mint (authority is the vault-authority PDA). */
export const NVUSDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_NVUSDC_MINT || '8xiQgJtjv41iDVeZPH2vpbvuW8WHwZDWhvSN1o2UCi4R',
);

// ── Seeds (mirror router_pool.rs) ────────────────────────────────────────────

const ROUTER_POOL_SEED = Buffer.from('router-pool');
const ROUTER_VAULT_SEED = Buffer.from('router-vault');
const ROUTER_LP_MINT_SEED = Buffer.from('router-lp');
const ROUTER_INSURANCE_SEED = Buffer.from('router-insurance');
const ROUTER_LP_ENTRY_SEED = Buffer.from('router-lp-entry');

// ── Discriminators (global:<handler>) ────────────────────────────────────────

export const ROUTER_INITIALIZE_POOL_DISCRIMINATOR = Buffer.from([191, 86, 186, 61, 90, 120, 201, 135]);
export const ROUTER_REGISTER_LP_DISCRIMINATOR = Buffer.from([143, 113, 243, 166, 40, 112, 3, 38]);
export const ROUTER_DEPOSIT_LIQUIDITY_DISCRIMINATOR = Buffer.from([164, 75, 5, 42, 163, 128, 3, 213]);
export const ROUTER_SWAP_DISCRIMINATOR = Buffer.from([98, 80, 88, 210, 149, 106, 65, 167]);
export const ROUTER_WITHDRAW_LIQUIDITY_DISCRIMINATOR = Buffer.from([139, 151, 206, 149, 237, 93, 193, 26]);
export const DEPOSIT_USDC_DISCRIMINATOR = Buffer.from([184, 148, 250, 169, 224, 213, 34, 126]);

// ── Address derivation ───────────────────────────────────────────────────────

export interface RouterPoolAddresses {
  pool: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  lpMint: PublicKey;
  insuranceVault: PublicKey;
  programId: PublicKey;
}

export function routerPoolAddresses(label: Uint8Array, programId: PublicKey = PROGRAM_IDS.nvUsdcVault): RouterPoolAddresses {
  const [pool] = PublicKey.findProgramAddressSync([ROUTER_POOL_SEED, label], programId);
  const [baseVault] = PublicKey.findProgramAddressSync([ROUTER_VAULT_SEED, Buffer.from('base'), label], programId);
  const [quoteVault] = PublicKey.findProgramAddressSync([ROUTER_VAULT_SEED, Buffer.from('quote'), label], programId);
  const [lpMint] = PublicKey.findProgramAddressSync([ROUTER_LP_MINT_SEED, label], programId);
  const [insuranceVault] = PublicKey.findProgramAddressSync([ROUTER_INSURANCE_SEED, label], programId);
  return { pool, baseVault, quoteVault, lpMint, insuranceVault, programId };
}

export function routerLpEntryAddress(pool: PublicKey, wallet: PublicKey, programId: PublicKey = PROGRAM_IDS.nvUsdcVault): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([ROUTER_LP_ENTRY_SEED, pool.toBuffer(), wallet.toBuffer()], programId);
  return pda;
}

export function userVaultStateAddress(user: PublicKey, vaultConfig: PublicKey, programId: PublicKey = PROGRAM_IDS.nvUsdcVault): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('user-vault-state'), user.toBuffer(), vaultConfig.toBuffer()], programId);
  return pda;
}

export function nvusdcMintAddress(programId: PublicKey = PROGRAM_IDS.nvUsdcVault): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('nvscusdc-mint')], programId);
  return pda;
}

// ── Encoding helpers (Anchor) ────────────────────────────────────────────────

function u8Le(value: number): Buffer {
  const b = Buffer.alloc(1);
  b.writeUInt8(value);
  return b;
}
function u64Le(value: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(value);
  return b;
}
function anchorBool(value: boolean): Buffer {
  return Buffer.from([value ? 1 : 0]);
}
function anchorVecI32(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32LE(value);
  return b;
}
function withMeta(
  programId: PublicKey,
  data: Buffer,
  keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[],
): TransactionInstruction {
  return { programId, keys, data };
}

// ── Instruction builders ─────────────────────────────────────────────────────

/** `router_initialize_pool(label, kyc_required, fee_bps, insurance_cut_bps)`. */
export function buildRouterInitializePoolIx(options: {
  programId?: PublicKey;
  authority: PublicKey;
  label: Uint8Array;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  kycRequired?: boolean;
  feeBps?: bigint;
  insuranceCutBps?: bigint;
}): TransactionInstruction {
  const pid = options.programId ?? PROGRAM_IDS.nvUsdcVault;
  const addr = routerPoolAddresses(options.label, pid);
  const data = Buffer.concat([
    ROUTER_INITIALIZE_POOL_DISCRIMINATOR,
    Buffer.from(options.label),
    anchorBool(options.kycRequired ?? false),
    u64Le(options.feeBps ?? 0n),
    u64Le(options.insuranceCutBps ?? 0n),
  ]);
  return withMeta(pid, data, [
    { pubkey: options.authority, isSigner: true, isWritable: true },
    { pubkey: addr.pool, isSigner: false, isWritable: true },
    { pubkey: options.baseMint, isSigner: false, isWritable: false },
    { pubkey: options.quoteMint, isSigner: false, isWritable: false },
    { pubkey: addr.baseVault, isSigner: false, isWritable: true },
    { pubkey: addr.quoteVault, isSigner: false, isWritable: true },
    { pubkey: addr.lpMint, isSigner: false, isWritable: true },
    { pubkey: addr.insuranceVault, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ]);
}

/** `router_register_lp(tier, kyc_expiry)` — pool authority only. */
export function buildRouterRegisterLpIx(options: {
  programId?: PublicKey;
  authority: PublicKey;
  label: Uint8Array;
  lpWallet: PublicKey;
  tier?: number;
  kycExpiry?: bigint;
}): TransactionInstruction {
  const pid = options.programId ?? PROGRAM_IDS.nvUsdcVault;
  const addr = routerPoolAddresses(options.label, pid);
  const lpEntry = routerLpEntryAddress(addr.pool, options.lpWallet, pid);
  const data = Buffer.concat([
    ROUTER_REGISTER_LP_DISCRIMINATOR,
    u8Le(options.tier ?? 2),
    u64Le(options.kycExpiry ?? 0n),
  ]);
  return withMeta(pid, data, [
    { pubkey: options.authority, isSigner: true, isWritable: true },
    { pubkey: addr.pool, isSigner: false, isWritable: true },
    { pubkey: options.lpWallet, isSigner: false, isWritable: false },
    { pubkey: lpEntry, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]);
}

/** `router_deposit_liquidity(amount, merkle_proof)` — base tokens in, LP shares out. */
export function buildRouterDepositLiquidityIx(options: {
  programId?: PublicKey;
  user: PublicKey;
  label: Uint8Array;
  userBaseAta: PublicKey;
  userLpAta: PublicKey;
  amount: bigint;
}): TransactionInstruction {
  const pid = options.programId ?? PROGRAM_IDS.nvUsdcVault;
  const addr = routerPoolAddresses(options.label, pid);
  const lpEntry = routerLpEntryAddress(addr.pool, options.user, pid);
  const data = Buffer.concat([ROUTER_DEPOSIT_LIQUIDITY_DISCRIMINATOR, u64Le(options.amount), anchorVecI32(0)]);
  return withMeta(pid, data, [
    { pubkey: options.user, isSigner: true, isWritable: true },
    { pubkey: addr.pool, isSigner: false, isWritable: true },
    { pubkey: lpEntry, isSigner: false, isWritable: false },
    { pubkey: addr.baseVault, isSigner: false, isWritable: true },
    { pubkey: addr.lpMint, isSigner: false, isWritable: true },
    { pubkey: options.userBaseAta, isSigner: false, isWritable: true },
    { pubkey: options.userLpAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ]);
}

/** `router_swap(amount_in, min_amount_out)` — real CP leg, base → quote. */
export function buildRouterSwapIx(options: {
  programId?: PublicKey;
  user: PublicKey;
  label: Uint8Array;
  userBaseAta: PublicKey;
  userQuoteAta: PublicKey;
  amountIn: bigint;
  minAmountOut: bigint;
}): TransactionInstruction {
  const pid = options.programId ?? PROGRAM_IDS.nvUsdcVault;
  const addr = routerPoolAddresses(options.label, pid);
  const data = Buffer.concat([ROUTER_SWAP_DISCRIMINATOR, u64Le(options.amountIn), u64Le(options.minAmountOut)]);
  return withMeta(pid, data, [
    { pubkey: options.user, isSigner: true, isWritable: true },
    { pubkey: addr.pool, isSigner: false, isWritable: true },
    { pubkey: addr.baseVault, isSigner: false, isWritable: true },
    { pubkey: addr.quoteVault, isSigner: false, isWritable: true },
    { pubkey: addr.insuranceVault, isSigner: false, isWritable: true },
    { pubkey: options.userBaseAta, isSigner: false, isWritable: true },
    { pubkey: options.userQuoteAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ]);
}

/** `router_withdraw_liquidity(shares_to_burn, merkle_proof)` — burn LP → base. */
export function buildRouterWithdrawLiquidityIx(options: {
  programId?: PublicKey;
  user: PublicKey;
  label: Uint8Array;
  userBaseAta: PublicKey;
  userLpAta: PublicKey;
  sharesToBurn: bigint;
}): TransactionInstruction {
  const pid = options.programId ?? PROGRAM_IDS.nvUsdcVault;
  const addr = routerPoolAddresses(options.label, pid);
  const lpEntry = routerLpEntryAddress(addr.pool, options.user, pid);
  const data = Buffer.concat([ROUTER_WITHDRAW_LIQUIDITY_DISCRIMINATOR, u64Le(options.sharesToBurn), anchorVecI32(0)]);
  return withMeta(pid, data, [
    { pubkey: options.user, isSigner: true, isWritable: true },
    { pubkey: addr.pool, isSigner: false, isWritable: true },
    { pubkey: lpEntry, isSigner: false, isWritable: false },
    { pubkey: addr.baseVault, isSigner: false, isWritable: true },
    { pubkey: addr.lpMint, isSigner: false, isWritable: true },
    { pubkey: options.userBaseAta, isSigner: false, isWritable: true },
    { pubkey: options.userLpAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ]);
}

/**
 * `deposit_usdc(amount, min_shares)` — vault deposit that mints nvUSDC at NAV.
 * Used to mint the pool's nvUSDC side the protocol way (the mint authority is
 * the vault-authority PDA; only vault handlers can mint).
 */
export function buildDepositUsdcIx(options: {
  programId?: PublicKey;
  user: PublicKey;
  payer: PublicKey;
  vaultConfig: PublicKey;
  vaultAuthority: PublicKey;
  vaultUsdc: PublicKey;
  userUsdc: PublicKey;
  nvusdcMint: PublicKey;
  userNvusdc: PublicKey;
  amount: bigint;
  minShares: bigint;
}): TransactionInstruction {
  const pid = options.programId ?? PROGRAM_IDS.nvUsdcVault;
  const state = userVaultStateAddress(options.user, options.vaultConfig, pid);
  const data = Buffer.concat([DEPOSIT_USDC_DISCRIMINATOR, u64Le(options.amount), u64Le(options.minShares)]);
  return withMeta(pid, data, [
    { pubkey: options.user, isSigner: true, isWritable: true },
    { pubkey: options.payer, isSigner: true, isWritable: true },
    { pubkey: options.vaultConfig, isSigner: false, isWritable: true },
    { pubkey: options.vaultAuthority, isSigner: false, isWritable: false },
    { pubkey: options.vaultUsdc, isSigner: false, isWritable: true },
    { pubkey: options.userUsdc, isSigner: false, isWritable: true },
    { pubkey: options.nvusdcMint, isSigner: false, isWritable: true },
    { pubkey: options.userNvusdc, isSigner: false, isWritable: true },
    { pubkey: state, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]);
}

// ── On-chain pool state mirror ───────────────────────────────────────────────

export interface RouterPoolState {
  exists: boolean;
  authority?: string;
  baseMint?: string;
  quoteMint?: string;
  feeBps?: bigint;
  insuranceCutBps?: bigint;
  totalShares?: bigint;
  baseReserve?: bigint;
  quoteReserve?: bigint;
  paused?: boolean;
}

/** Decode a raw `RouterPool` account (layout mirrored from router_pool.rs). */
export function decodeRouterPool(data: Uint8Array | null): RouterPoolState {
  if (!data) return { exists: false };
  const d = Buffer.from(data);
  const pk = (o: number): string => new PublicKey(d.subarray(o, o + 32)).toBase58();
  return {
    exists: true,
    authority: pk(8),
    baseMint: pk(72),
    quoteMint: pk(104),
    feeBps: d.readBigUInt64LE(169),
    insuranceCutBps: d.readBigUInt64LE(177),
    totalShares: d.readBigUInt64LE(185),
    baseReserve: d.readBigUInt64LE(193),
    quoteReserve: d.readBigUInt64LE(201),
    paused: d[217] === 1,
  };
}

/**
 * Exact constant-product swap math, mirroring the on-chain `RouterSwap`
 * handler: `fee = amount_in * fee_bps / 10000`, then `k = base*quote`,
 * `amount_out = quote − k/(base + amount_in_after_fee)`.
 */
export function routerSwapOut(baseReserve: bigint, quoteReserve: bigint, amountIn: bigint, feeBps: bigint): bigint {
  if (amountIn <= 0n || baseReserve === 0n || quoteReserve === 0n) return 0n;
  const fee = (amountIn * feeBps) / 10000n;
  const after = amountIn - fee;
  const k = baseReserve * quoteReserve;
  const newBase = baseReserve + after;
  const newQuote = k / newBase;
  return quoteReserve - newQuote;
}