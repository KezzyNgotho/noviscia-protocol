import { AnchorProvider, BN, Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PROGRAM_IDS, USDC_MINT } from './ids';

/** Anchor-typed account shapes for jit-risk (fields per target/idl/jit_risk.json). */
export interface MarketplaceState {
  authority: PublicKey;
  usdcVault: PublicKey;
  usdcMint: PublicKey;
  insuranceFundFloorUsdc: bigint;
  writableBps: number;
  riskBudgetBps: number;
  maxSliceUsdc: bigint;
  maxSlotAge: number;
  deltaMinWad: bigint;
  deltaMaxWad: bigint;
  premiumMin: bigint;
  outstandingUsdc: bigint;
  collateralHeldUsdc: bigint;
  premiumLedgerTotal: bigint;
  premiumSweptLedger: bigint;
  lossLedgerReserve: bigint;
  forfeitureLedgerTotal: bigint;
  backstopReserve: bigint;
  atomicSessions: bigint;
  createdAt: bigint;
  frozen: boolean;
  bump: number;
  vaultBump: number;
}

export interface MmRegistration {
  mm: PublicKey;
  status: number;
  creditCeilingUsdc: bigint;
  slicesWritten: bigint;
  slicesWin: bigint;
  slicesLoss: bigint;
  lossLedgerUsdc: bigint;
  mmOutstandingUsdc: bigint;
  slotsOccupied: bigint;
  lastRentedSlot: bigint;
  flaggedForReview: boolean;
  bump: number;
}

export interface CapacityReceipt {
  mm: PublicKey;
  slot: bigint;
  amountUsdc: bigint;
  premium: bigint;
  collateral: bigint;
  rbBps: number;
  status: number;
  settlementPnl: bigint;
  bump: number;
}

export const MM_STATUS_ACTIVE = 1;
export const MM_STATUS_SUSPENDED = 2;
export const SLICE_RESERVED = 0;
export const SLICE_SETTLED = 1;
export const SLICE_DEFAULTED = 2;
export const SLICE_REAPED = 3;

export const JIT_RISK_PROGRAM_ID = PROGRAM_IDS.jitRisk;

const B = (s: string): Buffer => Buffer.from(s);

/**
 * JitRiskClient — SDK surface for the Jit-Risk Time-Slice Marketplace.
 *
 * Markets idle insurance-pool risk capacity to market makers for a single
 * Solana slot (400ms). Two primitives:
 *   - `rentSlice`: atomic micro-premium paid inside the buyer's own tx — risk
 *     enters and exits within the same slot (zero in-flight window).
 *   - `reserveSlice` / `settleSlice`: collateralized in-flight capacity keyed
 *     by [slice, mm, slot] that dissolves at settlement.
 *
 * All derivations use the fixed program ID 3w9GrHBXpMNSc3P3kBWmHwkhEr1u5FBQrTiD4k3NAXwh.
 */
export class JitRiskClient {
  readonly program: Program;
  readonly provider: AnchorProvider;
  readonly usdcMint: PublicKey;

  constructor(program: Program, opts: { usdcMint?: PublicKey } = {}) {
    if (program.programId.toBase58() !== JIT_RISK_PROGRAM_ID.toBase58()) {
      throw new Error(`JitRiskClient: wrong program id ${program.programId}`);
    }
    this.program = program;
    this.provider = program.provider as AnchorProvider;
    this.usdcMint = opts.usdcMint ?? USDC_MINT;
  }

  /** Coerce u64/i64 args to BN (anchor 0.32 borsh needs BN, not JS numbers). */
  private bn(v: number | bigint): BN {
    return new BN(v.toString());
  }

  // ── PDA derivations ─────────────────────────────────────────────────────────

  /** [b"marketplace"] — singleton marketplace state. */
  marketplace(): PublicKey {
    return PublicKey.findProgramAddressSync([B('marketplace')], this.program.programId)[0];
  }

  /** [b"usdc_vault"] — pool collateral vault (authority = marketplace PDA). */
  usdcVault(): PublicKey {
    return PublicKey.findProgramAddressSync([B('usdc_vault')], this.program.programId)[0];
  }

  /** [b"mm", mm] — market-maker registration. */
  mmRegistration(mm: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([B('mm'), mm.toBuffer()], this.program.programId)[0];
  }

  /** [b"slice", mm, slot.to_le_bytes()] — in-flight capacity receipt. */
  receipt(mm: PublicKey, slot: number | bigint): PublicKey {
    const slotBuf = Buffer.alloc(8);
    slotBuf.writeBigUInt64LE(BigInt(slot));
    return PublicKey.findProgramAddressSync(
      [B('slice'), mm.toBuffer(), slotBuf],
      this.program.programId,
    )[0];
  }

  /** MM's USDC ATA (signing / receiving release). */
  mmTokenAccount(mm: PublicKey, mint?: PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(mint ?? this.usdcMint, mm, false, TOKEN_PROGRAM_ID);
  }

  /** Associated token account owned by the marketplace PDA. */
  poolTokenAccount(mint?: PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(
      mint ?? this.usdcMint,
      this.marketplace(),
      true,
      TOKEN_PROGRAM_ID,
    );
  }

  /** nv-usdc-vault config PDA: [b"nv-vault-config", usdc_mint]. */
  vaultConfig(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [B('nv-vault-config'), this.usdcMint.toBuffer()],
      PROGRAM_IDS.nvUsdcVault,
    )[0];
  }

  /** nv-usdc-vault pool USDC PDA: [b"nv-vault-usdc", usdc_mint]. */
  vaultUsdc(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [B('nv-vault-usdc'), this.usdcMint.toBuffer()],
      PROGRAM_IDS.nvUsdcVault,
    )[0];
  }

  // ── fetch helpers ───────────────────────────────────────────────────────────

  /** Indexed account accessor (untyped Program — names validated at runtime). */
  private get accounts(): Record<string, { fetch: (addr: PublicKey) => Promise<unknown> }> {
    return this.program.account as unknown as Record<string, { fetch: (addr: PublicKey) => Promise<unknown> }>;
  }

  async getMarketplace(): Promise<MarketplaceState> {
    return (await this.accounts.marketplaceState.fetch(this.marketplace())) as unknown as MarketplaceState;
  }

  async getMmRegistration(mm: PublicKey): Promise<MmRegistration> {
    return (await this.accounts.mmRegistration.fetch(this.mmRegistration(mm))) as unknown as MmRegistration;
  }

  async getReceipt(mm: PublicKey, slot: number | bigint): Promise<CapacityReceipt> {
    return (await this.accounts.capacityReceipt.fetch(this.receipt(mm, slot))) as unknown as CapacityReceipt;
  }

// ── governance ────────────────────────────────────────────────────────────────

  /** Admin bootstrap: creates MarketplaceState + USDC vault. */
  initializeMarketplace(params: {
    authority: PublicKey;
    insuranceFundFloorUsdc: number | bigint;
    writableBps: number;
    riskBudgetBps: number;
    maxSliceUsdc: number | bigint;
    maxSlotAge: number;
    deltaMinWad: number | bigint;
    deltaMaxWad: number | bigint;
    premiumMin: number | bigint;
  }) {
    const { insuranceFundFloorUsdc, writableBps, riskBudgetBps, maxSliceUsdc, maxSlotAge, deltaMinWad, deltaMaxWad, premiumMin } = params;
    return this.program.methods
      .initializeMarketplace({
        authority: params.authority,
        insuranceFundFloorUsdc: this.bn(insuranceFundFloorUsdc),
        writableBps,
        riskBudgetBps,
        maxSliceUsdc: this.bn(maxSliceUsdc),
        maxSlotAge,
        deltaMinWad: this.bn(deltaMinWad),
        deltaMaxWad: this.bn(deltaMaxWad),
        premiumMin: this.bn(premiumMin),
      } as never)
      .accountsStrict({
        marketplace: this.marketplace(),
        usdcVault: this.usdcVault(),
        usdcMint: this.usdcMint,
        authority: params.authority,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as never);
  }

  /** Admin: onboard a market maker with a per-MM credit ceiling. */
  registerMm(mm: PublicKey, creditCeilingUsdc: number | bigint) {
    return this.program.methods
      .registerMm(mm, this.bn(creditCeilingUsdc) as never)
      .accountsStrict({
        marketplace: this.marketplace(),
        mmRegistration: this.mmRegistration(mm),
        mm,
        authority: this.provider.publicKey,
        systemProgram: SystemProgram.programId,
      } as never);
  }

  /** Admin: suspend a market maker (blocks new slices). */
  suspendMm(mm: PublicKey) {
    return this.program.methods
      .suspendMm(mm)
      .accountsStrict({
        marketplace: this.marketplace(),
        mmRegistration: this.mmRegistration(mm),
        mm,
        authority: this.provider.publicKey,
      } as never);
  }

  /** Admin: flag a desk for synthetic-volume review (§3.3 redline). Emits SyntheticDeskFlagged. */
  flagDesk(mm: PublicKey) {
    return this.program.methods
      .flagDesk(mm)
      .accountsStrict({
        marketplace: this.marketplace(),
        mmRegistration: this.mmRegistration(mm),
        mm,
        authority: this.provider.publicKey,
      } as never);
  }

  /** Admin: one-sided parameter update (each field validated independently). */
  updateParams(params: {
    writableBps?: number;
    riskBudgetBps?: number;
    maxSliceUsdc?: number | bigint;
    maxSlotAge?: number;
    deltaMinWad?: number | bigint;
    deltaMaxWad?: number | bigint;
    premiumMin?: number | bigint;
    insuranceFundFloorUsdc?: number | bigint;
  }) {
    return this.program.methods
      .updateParams({
        writableBps: params.writableBps ?? null,
        riskBudgetBps: params.riskBudgetBps ?? null,
        maxSliceUsdc: params.maxSliceUsdc != null ? this.bn(params.maxSliceUsdc) : null,
        maxSlotAge: params.maxSlotAge ?? null,
        deltaMinWad: params.deltaMinWad != null ? this.bn(params.deltaMinWad) : null,
        deltaMaxWad: params.deltaMaxWad != null ? this.bn(params.deltaMaxWad) : null,
        premiumMin: params.premiumMin != null ? this.bn(params.premiumMin) : null,
        insuranceFundFloorUsdc: params.insuranceFundFloorUsdc != null ? this.bn(params.insuranceFundFloorUsdc) : null,
      } as never)
      .accountsStrict({
        marketplace: this.marketplace(),
        authority: this.provider.publicKey,
      } as never);
  }

  /** Admin kill-switch. */
  forceFreeze() {
    return this.program.methods
      .forceFreeze()
      .accountsStrict({
        marketplace: this.marketplace(),
        authority: this.provider.publicKey,
      } as never);
  }

  /** Admin resume. */
  unfreeze() {
    return this.program.methods
      .unfreeze()
      .accountsStrict({
        marketplace: this.marketplace(),
        authority: this.provider.publicKey,
      } as never);
  }

  /**
   * Admin sync: reconcile the marketplace safety floor from the live perps
   * insurance ledger (`position-tracker::Market.insurance_fund_usdc`), so the
   * writable base excludes the real CCP insurance reserve.
   */
  syncInsuranceFloor(insuranceMarket: PublicKey) {
    return this.program.methods
      .syncInsuranceFloor()
      .accountsStrict({
        marketplace: this.marketplace(),
        authority: this.provider.publicKey,
        insuranceMarket,
      } as never);
  }

  // ── trading primitives ───────────────────────────────────────────────────────

  /**
   * Atomic slice: buyer composes this into their arbitrage tx; premium paid in
   * the same transaction → risk lives for exactly one slot.
   *
   * `signer` must be the market maker's keypair (rent_slice requires `mm: Signer`).
   */
  rentSlice(mm: PublicKey, amount: number | bigint, deltaWad: number | bigint, signer?: { publicKey: PublicKey; secretKey: Uint8Array }) {
    const builder = this.program.methods
      .rentSlice(this.bn(amount) as never, this.bn(deltaWad) as never)
      .accountsStrict({
        marketplace: this.marketplace(),
        mmRegistration: this.mmRegistration(mm),
        mm,
        mmTokenAccount: this.mmTokenAccount(mm),
        usdcVault: this.usdcVault(),
        usdcMint: this.usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as never);
    return signer ? builder.signers([signer]) : builder;
  }

  /** In-flight: premium + collateral C = (1+μ)·A parked into the pool vault.
   *
   * `signer` must be the market maker's keypair (reserve_slice requires `mm: Signer`). */
  reserveSlice(
    mm: PublicKey,
    amount: number | bigint,
    deltaWad: number | bigint,
    slotKey: number | bigint,
    signer?: { publicKey: PublicKey; secretKey: Uint8Array },
  ) {
    const builder = this.program.methods
      .reserveSlice(this.bn(amount) as never, this.bn(deltaWad) as never, this.bn(slotKey) as never)
      .accountsStrict({
        marketplace: this.marketplace(),
        mmRegistration: this.mmRegistration(mm),
        mm,
        receipt: this.receipt(mm, slotKey),
        mmTokenAccount: this.mmTokenAccount(mm),
        usdcVault: this.usdcVault(),
        usdcMint: this.usdcMint,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as never);
    return signer ? builder.signers([signer]) : builder;
  }

  /** Permissionless settlement within the freshness window. `pnl` is the adjudicated buyer slot PnL. */
  settleSlice(mm: PublicKey, slotKey: number | bigint, pnl: number | bigint, mmTokenAccount?: PublicKey) {
    return this.program.methods
      .settleSlice(mm, this.bn(slotKey) as never, this.bn(pnl) as never)
      .accountsStrict({
        marketplace: this.marketplace(),
        mmRegistration: this.mmRegistration(mm),
        mm,
        receipt: this.receipt(mm, slotKey),
        mmBeneficiary: this.provider.publicKey,
        mmTokenAccount: mmTokenAccount ?? this.mmTokenAccount(mm),
        usdcVault: this.usdcVault(),
        usdcMint: this.usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as never);
  }

  /** Permissionless: dissolve stale Reserved receipts older than max_slot_age. */
  reapExpiredSlice(mm: PublicKey, slotKey: number | bigint) {
    return this.program.methods
      .reapExpiredSlice(mm, this.bn(slotKey) as never)
      .accountsStrict({
        marketplace: this.marketplace(),
        mmRegistration: this.mmRegistration(mm),
        mm,
        receipt: this.receipt(mm, slotKey),
        mmBeneficiary: this.provider.publicKey,
        usdcMint: this.usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as never);
  }

  /**
   * Apply the 85/15 premium split: LP NAV / backstop reservation.
   *
   * The 85% NAV share is CPI-pushed into `nv-usdc-vault` as a
   * `FEE_TYPE_CAPACITY` protocol fee — the marketplace PDA signs as the source
   * token authority, so the pool's `fee_index`/NAV grows by the swept premium.
   */
  sweepPremiums() {
    return this.program.methods
      .sweepPremiums()
      .accountsStrict({
        marketplace: this.marketplace(),
        usdcVault: this.usdcVault(),
        usdcMint: this.usdcMint,
        vaultConfig: this.vaultConfig(),
        vaultUsdc: this.vaultUsdc(),
        nvUsdcVaultProgram: PROGRAM_IDS.nvUsdcVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as never);
  }
}