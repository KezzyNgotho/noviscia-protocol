/**
 * TVV-Gate Conductor ("keeper") — the final leg of the self-executing DQAV.
 *
 * Where `spatialArbEngine` computes the *economics* of a cross-venue edge and
 * `tvv_gate.rs` enforces the on-chain Post-Swap Invariant, this module turns a
 * detected opportunity into a real atomic Jito bundle:
 *
 *   1. `sizeToGateCeiling` — cap the draw at the 60% systemic pool cap and the
 *      per-slot gate ceiling, then back out the DEX leg cost + net profit so the
 *      returned USDC is the *principal plus net profit* the gate needs.
 *   2. `buildGateBundle` — compile arm → DEX route → settle. The conditional
 *      leader tip is appended to the arm transaction (Tx-0), so the tip only
 *      lands if the whole bundle settles intact.
 *   3. `runKeeperCycle` — the conductor loop: size, build, sign (fee payer +
 *      searcher + tip payer on Tx-0), submit to the Jito Block Engine, poll
 *      status, and surface landed/reverted outcomes.
 *
 * The instruction arguments and PDAs here are hand-built against the on-chain
 * `nv-usdc-vault` program (the shipped IDL predates the gate), so each builder
 * is a thin, explicit encoding of the Rust `Context<TvvGateArm>` /
 * `Context<TvvGateSettle>` account maps — nothing is guessed.
 */

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  Keypair,
  VersionedTransaction,
  SYSVAR_RENT_PUBKEY,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PROGRAM_IDS, USDC_MINT } from './ids';
import { JitoBundleClient, assembleVersionedTransactions } from './jito';
import { decomposeSpatialArb, type VenuePoolQuote } from './spatialArbEngine';

/** System cap that bounds a single slot's draw (mirrors `C_sys`). */
export const SYSTEMIC_CAP_BPS = 6_000n;

/** Per-slot gate ceiling as a share of the pool — bounded by `C_sys` (60%). */
const DEFAULT_SLOT_CEILING_BPS = SYSTEMIC_CAP_BPS;

/** PDA seeds, byte-for-byte mirroring the Rust `tvv_gate.rs` / `lib.rs` consts. */
const GATE_CONFIG_SEED = Buffer.from('tvv-gate-config');
const GATE_SNAPSHOT_SEED = Buffer.from('tvv-gate-snapshot');
const VAULT_CONFIG_SEED = Buffer.from('nv-vault-config');
const VAULT_AUTHORITY_SEED = Buffer.from('nv-vault-authority');
const VAULT_USDC_SEED = Buffer.from('nv-vault-usdc');

/**
 * Seed for the `GateSnapshot` PDA: `["tvv-gate-snapshot", searcher, slot_key_le]`.
 * Mirrors `seeds = [GATE_SNAPSHOT_SEED, searcher.key(), slot_key.to_le_bytes()]`
 * in the Rust `TvvGateArm` / `TvvGateSettle` builders.
 */
export function gateSnapshotSeed(searcher: PublicKey, slotKey: bigint): Buffer[] {
  const slotLe = Buffer.alloc(8);
  slotLe.writeBigUInt64LE(slotKey);
  return [GATE_SNAPSHOT_SEED, searcher.toBuffer(), slotLe];
}

/** The `GateConfig` PDA: `["tvv-gate-config", vault_config_key]`. */
export function gateConfigAddress(vaultConfig: PublicKey): PublicKey {
  const pid = PROGRAM_IDS.nvUsdcVault;
  const [pda] = PublicKey.findProgramAddressSync([GATE_CONFIG_SEED, vaultConfig.toBuffer()], pid);
  return pda;
}

/** The `GateSnapshot` PDA for a (searcher, slot) execution. */
export function gateSnapshotAddress(searcher: PublicKey, slotKey: bigint): PublicKey {
  const pid = PROGRAM_IDS.nvUsdcVault;
  const [pda] = PublicKey.findProgramAddressSync(gateSnapshotSeed(searcher, slotKey), pid);
  return pda;
}

/**
 * The vault config / authority / USDC treasury PDAs (single-USDC vault).
 *
 * NOTE: `vaultUsdc` is initialized as the `["nv-vault-usdc", usdc_mint]` PDA
 * (see the Rust `InitializeVault` context), NOT an associated token account.
 * The keeper must hand that PDA to `tvv_gate_arm` / `tvv_gate_settle` — the
 * on-chain constraint is `vault_usdc.key() == vault_config.vault_usdc`.
 */
export function gateVaultAddresses(usdcMint: PublicKey = USDC_MINT): {
  vaultConfig: PublicKey;
  vaultAuthority: PublicKey;
  vaultUsdc: PublicKey;
} {
  const pid = PROGRAM_IDS.nvUsdcVault;
  const [vaultConfig] = PublicKey.findProgramAddressSync([VAULT_CONFIG_SEED, usdcMint.toBuffer()], pid);
  const [vaultAuthority] = PublicKey.findProgramAddressSync([VAULT_AUTHORITY_SEED, usdcMint.toBuffer()], pid);
  const [vaultUsdc] = PublicKey.findProgramAddressSync([VAULT_USDC_SEED, usdcMint.toBuffer()], pid);
  return { vaultConfig, vaultAuthority, vaultUsdc };
}

// ─── Instruction discriminators (Anchor, hand-derived for gate handlers) ─────

/**
 * Discriminator for `tvv_gate_arm(slot_key: u64, arm_amount: u64)`.
 * First 8 bytes of `sha256("global:tvv_gate_arm")` — [
 * 131,252,110,216,167,94,113,16 ].
 */
export const TVV_GATE_ARM_DISCRIMINATOR = Buffer.from([0x83, 0xfc, 0x6e, 0xd8, 0xa7, 0x5e, 0x71, 0x10]);
/**
 * Discriminator for `tvv_gate_settle(slot_key: u64, gross_return: u64)`.
 * First 8 bytes of `sha256("global:tvv_gate_settle")` — [
 * 166,186,137,106,5,167,26,182 ].
 */
export const TVV_GATE_SETTLE_DISCRIMINATOR = Buffer.from([0xa6, 0xba, 0x89, 0x6a, 0x05, 0xa7, 0x1a, 0xb6]);
/**
 * Discriminator for `tvv_gate_configure(active: bool, searcher: Pubkey,
 * slot_ceiling_usd: u64, strict_bundle: bool)`.
 * First 8 bytes of `sha256("global:tvv_gate_configure")` — [ 78,157,68,195,35,122,201,136 ].
 */
export const TVV_GATE_CONFIGURE_DISCRIMINATOR = Buffer.from([0x4e, 0x9d, 0x44, 0xc3, 0x23, 0x7a, 0xc9, 0x88]);

function u64Le(value: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(value);
  return b;
}

function withMeta(
  programId: PublicKey,
  data: Buffer,
  keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[],
): TransactionInstruction {
  return { programId, keys, data };
}

/**
 * Hand-built `tvv_gate_arm` instruction. Account order mirrors the Rust
 * `TvvGateArm` context exactly; the wallet-program (anchor) invocation maps to
 * a token CPI internally, so no extra account inference is required here beyond
 * the explicit list.
 */
export function buildGateArmIx(options: {
  programId?: PublicKey;
  searcher: PublicKey;
  vaultConfig: PublicKey;
  vaultUsdc: PublicKey;
  searcherUsdc: PublicKey;
  vaultAuthority: PublicKey;
  gate: PublicKey;
  snapshot: PublicKey;
  slotKey: bigint;
  armAmount: bigint;
}): TransactionInstruction {
  const pid = options.programId ?? PROGRAM_IDS.nvUsdcVault;
  const data = Buffer.concat([TVV_GATE_ARM_DISCRIMINATOR, u64Le(options.slotKey), u64Le(options.armAmount)]);
  return withMeta(pid, data, [
    { pubkey: options.searcher, isSigner: true, isWritable: true },
    { pubkey: options.vaultConfig, isSigner: false, isWritable: false },
    { pubkey: options.vaultUsdc, isSigner: false, isWritable: true },
    { pubkey: options.searcherUsdc, isSigner: false, isWritable: true },
    { pubkey: options.vaultAuthority, isSigner: false, isWritable: false },
    { pubkey: options.gate, isSigner: false, isWritable: false },
    { pubkey: options.snapshot, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ]);
}

/**
 * Hand-built `tvv_gate_configure` instruction. Account order mirrors the Rust
 * `TvvGateConfigure` context: timelocked-admin approves the protocol searcher,
 * per-slot ceiling (bounded to 60% of the pool on-chain) and strict mode.
 */
export function buildGateConfigureIx(options: {
  programId?: PublicKey;
  admin: PublicKey;
  vaultConfig: PublicKey;
  timelockedAdmin: PublicKey;
  gate: PublicKey;
  active: boolean;
  searcher: PublicKey;
  slotCeilingUsd: bigint;
  strictBundle: boolean;
}): TransactionInstruction {
  const pid = options.programId ?? PROGRAM_IDS.nvUsdcVault;
  const args = Buffer.concat([
    Buffer.from([options.active ? 1 : 0]),
    options.searcher.toBuffer(),
    u64Le(options.slotCeilingUsd),
    Buffer.from([options.strictBundle ? 1 : 0]),
  ]);
  const data = Buffer.concat([TVV_GATE_CONFIGURE_DISCRIMINATOR, args]);
  return withMeta(pid, data, [
    { pubkey: options.admin, isSigner: true, isWritable: true },
    { pubkey: options.vaultConfig, isSigner: false, isWritable: true },
    { pubkey: options.timelockedAdmin, isSigner: false, isWritable: false },
    { pubkey: options.gate, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ]);
}

/**
 * Hand-built `tvv_gate_settle` instruction (tail Tx).
 */
export function buildGateSettleIx(options: {
  programId?: PublicKey;
  searcher: PublicKey;
  vaultConfig: PublicKey;
  vaultUsdc: PublicKey;
  searcherUsdc: PublicKey;
  gate: PublicKey;
  snapshot: PublicKey;
  slotKey: bigint;
  grossReturn: bigint;
}): TransactionInstruction {
  const pid = options.programId ?? PROGRAM_IDS.nvUsdcVault;
  const data = Buffer.concat([TVV_GATE_SETTLE_DISCRIMINATOR, u64Le(options.slotKey), u64Le(options.grossReturn)]);
  return withMeta(pid, data, [
    { pubkey: options.searcher, isSigner: true, isWritable: true },
    { pubkey: options.vaultConfig, isSigner: false, isWritable: true },
    { pubkey: options.vaultUsdc, isSigner: false, isWritable: true },
    { pubkey: options.searcherUsdc, isSigner: false, isWritable: true },
    { pubkey: options.gate, isSigner: false, isWritable: false },
    { pubkey: options.snapshot, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ]);
}

// ─── Sizing ───────────────────────────────────────────────────────────────────

export interface GateSizingInputs {
  /** Vault pool size in USDC base units (e.g. `amount` of the vault USDC ATA). */
  poolUsdc: bigint;
  /** Gross cross-venue spread in bps (max − min over min). */
  grossSpreadBps: bigint;
  /** Combined two-leg cost (fees + slippage + tip) in bps. Default 8. */
  combinedLegCostBps?: bigint;
  /** Share of the pool a single slot may draw, bounded to the 60% systemic cap. */
  slotCeilingBps?: bigint;
}

export interface GateSizingResult {
  /** Draw (arm) amount the gate moves from the vault into the searcher. */
  armAmount: bigint;
  /** Gross return the searcher must repay: principal + net profit. */
  grossReturn: bigint;
  /** Net profit staged into vault NAV on settle. */
  profit: bigint;
  /** Net spread per trade after combined leg cost (bps). */
  netSpreadBps: bigint;
  /** True when a real, post-cost, capturable edge exists. */
  edgeOpen: boolean;
}

/**
 * Size a gate draw from a live opportunity. The arm amount is the pool deployed
 * up to the per-slot ceiling (clamped to the 60% systemic cap), and the gross
 * return is principal plus the *net of cost* edge — the exact values the gate's
 * post-swap invariant (`final >= initial`) validates on settle.
 */
export function sizeToGateCeiling(input: GateSizingInputs): GateSizingResult {
  const ceilingBps = input.slotCeilingBps ?? DEFAULT_SLOT_CEILING_BPS;
  const effCeiling = ceilingBps > SYSTEMIC_CAP_BPS ? SYSTEMIC_CAP_BPS : ceilingBps < 0n ? 0n : ceilingBps;
  const armAmount = (input.poolUsdc * effCeiling) / 10_000n;

  const d = decomposeSpatialArb({
    pools: syntheticPrices(input.grossSpreadBps),
    daysCapturedPerYear: 1n,
    slotCeilingBps: effCeiling,
    combinedLegCostBps: input.combinedLegCostBps,
    captureEfficiencyBps: 10_000n, // keeper sizes on net-of-cost edge directly
  });

  const netSpreadBps = d.netEdgePerTradeBps;
  const edgeOpen = d.edgeOpen && netSpreadBps > 0n;
  const profit = edgeOpen ? (armAmount * netSpreadBps) / 10_000n : 0n;
  const grossReturn = armAmount + profit;
  return { armAmount, grossReturn, profit, netSpreadBps, edgeOpen };
}

function syntheticPrices(grossSpreadBps: bigint): VenuePoolQuote[] {
  const lo = 1_000_000_000n;
  const hi = (lo * (10_000n + grossSpreadBps)) / 10_000n;
  return [
    { venue: 'keeper-lo', priceUsdcScaled: lo, weightBps: 5_000n },
    { venue: 'keeper-hi', priceUsdcScaled: hi, weightBps: 5_000n },
  ];
}

// ─── Bundle construction ──────────────────────────────────────────────────────

export interface GateBundleOptions {
  /** Instruction groups for the in-bundle DEX route (Tx-1). May be empty for
   *  tests — the searcher's opaque arb legs normally live here. */
  routeIxs?: TransactionInstruction[];
  /** Address lookup tables referenced by the route transaction (Jupiter legs). */
  routeLookupTables?: AddressLookupTableAccount[];
  /** Optional leader tip; appended to Tx-0 so it pays only if the bundle holds. */
  tip?: {
    tipAccount: PublicKey;
    tipPayer: PublicKey;
    lamports: number | bigint;
    /** Signer that authorizes the tip transfer (must match `tipPayer`). */
    tipPayerKeypair: Keypair;
  };
  /** Keypairs signing Tx-0 (the searcher). */
  armSigners: Keypair[];
  /** Keypairs signing Tx-1 (the DEX route). */
  routeSigners?: Keypair[];
  /** Keypairs signing Tx-2 (settle — the searcher). */
  settleSigners: Keypair[];
  /** Fee payer for every transaction. */
  feePayer: Keypair;
  /** Single shared blockhash for one-slot atomicity. */
  recentBlockhash: string;
  accounts: GateArmAccounts;
  slotKey: bigint;
  armAmount: bigint;
  grossReturn: bigint;
}

export interface GateArmAccounts {
  searcher: PublicKey;
  vaultConfig: PublicKey;
  vaultUsdc: PublicKey;
  searcherUsdc: PublicKey;
  vaultAuthority: PublicKey;
  gate: PublicKey;
  snapshot: PublicKey;
}

/**
 * Build, sign and serialize the arm → route → settle gate bundle.
 */
export function buildGateBundle(o: GateBundleOptions): VersionedTransaction[] {
  const armIx = buildGateArmIx({
    searcher: o.accounts.searcher,
    vaultConfig: o.accounts.vaultConfig,
    vaultUsdc: o.accounts.vaultUsdc,
    searcherUsdc: o.accounts.searcherUsdc,
    vaultAuthority: o.accounts.vaultAuthority,
    gate: o.accounts.gate,
    snapshot: o.accounts.snapshot,
    slotKey: o.slotKey,
    armAmount: o.armAmount,
  });
  const settleIx = buildGateSettleIx({
    searcher: o.accounts.searcher,
    vaultConfig: o.accounts.vaultConfig,
    vaultUsdc: o.accounts.vaultUsdc,
    searcherUsdc: o.accounts.searcherUsdc,
    gate: o.accounts.gate,
    snapshot: o.accounts.snapshot,
    slotKey: o.slotKey,
    grossReturn: o.grossReturn,
  });

  const txs = assembleVersionedTransactions(
    [
      [armIx],
      ...(o.routeIxs && o.routeIxs.length > 0 ? [o.routeIxs] : []),
      [settleIx],
    ],
    {
      feePayer: o.feePayer.publicKey,
      recentBlockhash: o.recentBlockhash,
      tip: o.tip,
      lookupTables: [
        [],
        ...(o.routeIxs && o.routeIxs.length > 0 ? [o.routeLookupTables ?? []] : []),
        [],
      ],
    },
  );

  txs[0].sign([o.feePayer, ...o.armSigners, ...(o.tip ? [o.tip.tipPayerKeypair] : [])]);
  if (txs[1]) txs[1].sign([o.feePayer, ...(o.routeSigners ?? [])]);
  const settleTx = txs[txs.length - 1];
  settleTx.sign([o.feePayer, ...o.settleSigners]);
  return txs;
}

// ─── Conductor loop ───────────────────────────────────────────────────────────

export interface KeeperOutcome {
  bundleId: string;
  submitted: boolean;
  landed: boolean;
  status?: 'processed' | 'confirmed' | 'finalized' | null;
}

export interface KeeperCycleInputs extends GateSizingInputs {
  routeIxs?: TransactionInstruction[];
  tip?: GateBundleOptions['tip'];
  armSigners: Keypair[];
  routeSigners?: Keypair[];
  settleSigners: Keypair[];
  feePayer: Keypair;
  recentBlockhash: string;
  accounts: GateArmAccounts;
  slotKey: bigint;
  /** How long to poll (ms) before giving up on landing. Default 5000. */
  pollMs?: number;
  /** Poll cadence (ms). Default 1000. */
  pollIntervalMs?: number;
}

/**
 * Run a single keeper cycle: size to the gate ceiling, build, sign, submit to
 * the Jito Block Engine and poll until it lands, reverts or times out.
 */
export async function runKeeperCycle(
  input: KeeperCycleInputs,
  client: JitoBundleClient,
): Promise<KeeperOutcome> {
  const sizing = sizeToGateCeiling(input);
  if (!sizing.edgeOpen) {
    throw new Error('keeper: no capturable edge (spread <= combined leg cost)');
  }
  if (!input.tip) {
    throw new Error('keeper: refusing to land without a conditional tip; set tip for landability');
  }

  const pollMs = input.pollMs ?? 5_000;
  const pollIntervalMs = input.pollIntervalMs ?? 1_000;

  const txs = buildGateBundle({
    routeIxs: input.routeIxs,
    tip: input.tip,
    armSigners: input.armSigners,
    routeSigners: input.routeSigners,
    settleSigners: input.settleSigners,
    feePayer: input.feePayer,
    recentBlockhash: input.recentBlockhash,
    accounts: input.accounts,
    slotKey: input.slotKey,
    armAmount: sizing.armAmount,
    grossReturn: sizing.grossReturn,
  });

  const bundleId = await client.sendBundle(txs);

  const deadline = Date.now() + pollMs;
  for (;;) {
    const [status] = (await client.getBundleStatuses([bundleId])) ?? [];
    if (status) {
      return {
        bundleId,
        submitted: true,
        landed: true,
        status: status.confirmationStatus,
      };
    }
    if (Date.now() >= deadline) {
      return { bundleId, submitted: true, landed: false, status: null };
    }
    await sleep(pollIntervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
