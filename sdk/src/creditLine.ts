import { AnchorProvider, BN, Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PROGRAM_IDS, USDC_MINT } from './ids';
import { vaultAddresses } from './addresses';

/**
 * Anchor-typed account shapes for Noviscia Credit Line
 * (fields per target/idl/noviscia_credit_line.json).
 */
export interface CreditLineState {
  authority: PublicKey;
  tollRecipient: PublicKey;
  usdcMint: PublicKey;
  baseTollBps: bigint;
  maxTollBps: bigint;
  borrowerCap: bigint;
  globalOutstandingCap: bigint;
  totalOutstanding: bigint;
  bump: number;
  creditVaultBump: number;
  tollVaultBump: number;
}

export interface BorrowerState {
  owner: PublicKey;
  authorized: boolean;
  creditLimit: bigint;
  outstanding: bigint;
  bump: number;
}

/** 90% of each toll → omni-pool (LP NAV) via accumulate_protocol_fees. */
export const LP_NAV_SPLIT_BPS = 9000;
/** 10% of each toll → system treasury. */
export const TREASURY_SPLIT_BPS = 1000;
/** BPS denominator. */
export const BPS = 10000;

export const CREDIT_LINE_PROGRAM_ID = PROGRAM_IDS.creditLine;

const B = (s: string): Buffer => Buffer.from(s);

/**
 * CreditLineClient — SDK surface for the Noviscia Credit Line.
 *
 * The credit-line handlers were folded into the netting-engine host (Stage 3
 * of the 19→4 consolidation); `CREDIT_LINE_PROGRAM_ID` resolves to the host
 * address and every instruction here is the host's `cl_*` handler. The PDA
 * seeds and account layouts are unchanged from the standalone program.
 *
 * Single-block, collateralized credit for institutional desks. Four
 * instructions bundle into one Solana ~400ms slot:
 *
 *   1. `clPullCredit`    draw USDC from the alpha-sleeve credit vault
 *   2. external swap   (e.g. Raydium) buy the target asset low
 *   3. external swap   (e.g. Meteora) sell the asset high
 *   4. `clRepayAndSettle` the Atomic Balance-State Constraint
 *
 * The toll is dynamic (interpolates with utilization, clamped to
 * `[base, max]` bps) and spliced 90/10: 90% is swept natively into the
 * `nv-usdc-vault` omni-pool (LP NAV), 10% goes to the system treasury.
 */
export class CreditLineClient {
  readonly program: Program;
  readonly provider: AnchorProvider;
  readonly usdcMint: PublicKey;

  constructor(program: Program, opts: { usdcMint?: PublicKey } = {}) {
    if (program.programId.toBase58() !== CREDIT_LINE_PROGRAM_ID.toBase58()) {
      throw new Error(`CreditLineClient: wrong program id ${program.programId}`);
    }
    this.program = program;
    this.provider = program.provider as AnchorProvider;
    this.usdcMint = opts.usdcMint ?? USDC_MINT;
  }

  /** Coerce u64/i64 args to BN (anchor borsh needs BN, not JS numbers). */
  private bn(v: number | bigint): BN {
    return new BN(v.toString());
  }

  // ── PDA derivations ─────────────────────────────────────────────────────────

  /** [b"credit-line"] — singleton ledger PDA. */
  creditLine(): PublicKey {
    return PublicKey.findProgramAddressSync([B('credit-line')], this.program.programId)[0];
  }

  /** [b"credit-vault"] — alpha-sleeve USDC vault (authority = ledger PDA). */
  creditVault(): PublicKey {
    return PublicKey.findProgramAddressSync([B('credit-vault')], this.program.programId)[0];
  }

  /** [b"toll-vault"] — 90% toll staging vault (swept to the omni-pool). */
  tollVault(): PublicKey {
    return PublicKey.findProgramAddressSync([B('toll-vault')], this.program.programId)[0];
  }

  /** [b"borrower", owner] — per-desk registry PDA. */
  borrower(owner: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([B('borrower'), owner.toBuffer()], this.program.programId)[0];
  }

  /** `nv-usdc-vault` pool accounts that receive the 90% LP-NAV sweep. */
  vaultAccounts(): { vaultConfig: PublicKey; vaultUsdc: PublicKey } {
    const v = vaultAddresses(this.usdcMint);
    return { vaultConfig: v.vaultConfig, vaultUsdc: v.vaultUsdc };
  }

  // ── fetch helpers ───────────────────────────────────────────────────────────

  /** Indexed account accessor (untyped Program — names validated at runtime). */
  private get accounts(): Record<string, { fetch: (addr: PublicKey) => Promise<unknown> }> {
    return this.program.account as unknown as Record<string, { fetch: (addr: PublicKey) => Promise<unknown> }>;
  }

  async getCreditLine(): Promise<CreditLineState> {
    return (await this.accounts.creditLine.fetch(this.creditLine())) as unknown as CreditLineState;
  }

  async getBorrower(owner: PublicKey): Promise<BorrowerState> {
    return (await this.accounts.borrower.fetch(this.borrower(owner))) as unknown as BorrowerState;
  }

  // ── governance ───────────────────────────────────────────────────────────────

  /**
   * One-time bootstrap: creates the ledger + alpha-sleeve credit vault + 90%
   * toll staging vault (host handler `cl_initialize`).
   */
  initialize(params: {
    authority: PublicKey;
    tollRecipient: PublicKey;
    usdcMint: PublicKey;
    baseTollBps: number | bigint;
    maxTollBps: number | bigint;
    borrowerCap: number | bigint;
    globalOutstandingCap: number | bigint;
  }) {
    return this.program.methods
      .clInitialize(
        params.tollRecipient,
        this.bn(params.baseTollBps) as never,
        this.bn(params.maxTollBps) as never,
        this.bn(params.borrowerCap) as never,
        this.bn(params.globalOutstandingCap) as never,
      )
      .accountsStrict({
        authority: params.authority,
        creditLine: this.creditLine(),
        creditVault: this.creditVault(),
        tollVault: this.tollVault(),
        usdcMint: params.usdcMint,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as never);
  }

  /** Authority-only: whitelist (or revoke) a desk and set its credit limit (host `cl_register_borrower`). */
  registerBorrower(borrowerOwner: PublicKey, creditLimit: number | bigint, authority?: PublicKey) {
    return this.program.methods
      .clRegisterBorrower(this.bn(creditLimit) as never)
      .accountsStrict({
        authority: authority ?? this.provider.publicKey,
        creditLine: this.creditLine(),
        borrowerOwner,
        borrower: this.borrower(borrowerOwner),
        systemProgram: SystemProgram.programId,
      } as never);
  }

  // ── trading primitives ───────────────────────────────────────────────────────

  /**
   * Step 1 — the Pull. Atomically release `amount` USDC (base-6) from the
   * alpha-sleeve credit vault into the borrower's USDC token account, inside
   * the same transaction as the adjacent arbitrage swaps and the final repay. Host handler `cl_pull_credit`.
   */
  pullCredit(borrowerOwner: PublicKey, amount: number | bigint, signer?: { publicKey: PublicKey; secretKey: Uint8Array }) {
    const builder = this.program.methods
      .clPullCredit(this.bn(amount) as never)
      .accountsStrict({
        borrowerOwner,
        creditLine: this.creditLine(),
        borrower: this.borrower(borrowerOwner),
        creditVault: this.creditVault(),
        borrowerTokenAccount: getBorrowerUsdc(borrowerOwner, this.usdcMint),
        tokenProgram: TOKEN_PROGRAM_ID,
      } as never);
    return signer ? builder.signers([signer]) : builder;
  }

  /**
   * Step 4 — the Atomic Balance-State Constraint. Returns `principal` (base-6)
   * to the alpha-sleeve vault, routes 10% of the dynamic toll to the system
   * treasury, and sweeps the remaining 90% into the `nv-usdc-vault` omni-pool
   * (LP NAV) natively via `accumulate_protocol_fees`.
   *
   * Because both the principal return and the toll split are enforced here,
   * if the borrower cannot cover `principal + toll` the transfer CPI reverts
   * and the entire transaction rolls back — the pool is never left short.
   * Host handler `cl_repay_and_settle`.
   */
  repayAndSettle(
    borrowerOwner: PublicKey,
    treasuryVault: PublicKey,
    principal: number | bigint,
    signer?: { publicKey: PublicKey; secretKey: Uint8Array },
  ) {
    const { vaultConfig, vaultUsdc } = this.vaultAccounts();
    const builder = this.program.methods
      .clRepayAndSettle(this.bn(principal) as never)
      .accountsStrict({
        borrowerOwner,
        creditLine: this.creditLine(),
        borrower: this.borrower(borrowerOwner),
        creditVault: this.creditVault(),
        borrowerTokenAccount: getBorrowerUsdc(borrowerOwner, this.usdcMint),
        tollRecipientAccount: treasuryVault,
        tollVault: this.tollVault(),
        vaultConfig,
        vaultUsdc,
        nvUsdcVaultProgram: PROGRAM_IDS.nvUsdcVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as never);
    return signer ? builder.signers([signer]) : builder;
  }

  /**
   * Compose the full single-block credit bundle (pull → repay) as an atomic
   * instruction list. External venue swap instructions (Raydium buy / Meteora
   * sell) can be interleaved at `index 1` / `index 2` by the caller; the bundle
   * is submitted as one transaction (one recent blockhash, one slot).
   *
   * Returns the raw `TransactionInstruction`s so desks can splice in venue
   * swaps in the middle and sign with their own keypair/tip logic.
   */
  async buildCreditBundle(
    borrowerOwner: PublicKey,
    treasuryVault: PublicKey,
    principal: number | bigint,
    signer?: { publicKey: PublicKey; secretKey: Uint8Array },
  ): Promise<TransactionInstruction[]> {
    const pull = await this.pullCredit(borrowerOwner, principal, signer).instruction();
    const repay = await this.repayAndSettle(borrowerOwner, treasuryVault, principal, signer).instruction();
    return [pull, repay];
  }
}

/** Borrower's USDC associated token account (signing / settling the draw). */
export function getBorrowerUsdc(owner: PublicKey, mint: PublicKey = USDC_MINT): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID);
}
