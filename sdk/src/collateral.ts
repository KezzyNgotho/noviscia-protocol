import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { NovisciaClient } from './client';
import { ptAddresses, nettingAddresses, yrAddresses, vaultAddresses, feeRoutingAddresses } from './addresses';
import { PROGRAM_IDS, USDC_MINT, NVSCUSDC_MINT, TREASURY_ID } from './ids';

/**
 * Unified Collateral Gateway (Gap 1 pillar of the topology).
 *
 * A single SDK surface that turns a trader intent into fully-formed
 * instructions across every collateral-touching program:
 *   deposit            → nv-usdc-vault (collateralize USDC, mint nvscUSDC)
 *   withdraw           → nv-usdc-vault
 *   openPosition       → position-tracker (JIT Pyth price)
 *   close/liquidate    → position-tracker (+ netting + atomic-recall accounts)
 *   netting margin top → netting-engine (via consolidate / report flows)
 *   recallForMargin    → yield-router (margin-call recall of deployed yield)
 *
 * Every builder takes raw intent (symbol, size, price) and returns ready-to-sign
 * instructions — no layout knowledge leaks into consumers.
 */

export type Side = 'long' | 'short';
export interface CollateralIntent {
  amountUsdc: number;
  user: PublicKey;
}

export class CollateralGateway {
  constructor(private client: NovisciaClient) {}

  /** Deposit USDC into the omni-pool vault; mints nvscUSDC for the user. */
  async deposit(user: PublicKey, amountUsdc: number): Promise<TransactionInstruction> {
    const vault = vaultAddresses(USDC_MINT, user, USDC_MINT);
    const userUsdc = getAssociatedTokenAddressSync(USDC_MINT, user, false, TOKEN_PROGRAM_ID);
    const userNvusdc = getAssociatedTokenAddressSync(NVSCUSDC_MINT, user, false, TOKEN_PROGRAM_ID);
    return this.client.nvUsdcVault.methods
      .deposit(new anchor.BN(amountUsdc))
      .accounts({
        user,
        nvUsdcVaultProgram: PROGRAM_IDS.nvUsdcVault,
        usdcMint: USDC_MINT,
        nvscusdcMint: vault.nvscusdcMint,
        vaultConfig: vault.vaultConfig,
        vaultAuthority: vault.vaultAuthority,
        vaultUsdc: vault.vaultUsdc,
        userUsdc,
        userNvusdc,
        insuranceBuffer: vault.insuranceBuffer,
        assetRiskConfig: vault.assetRiskConfig,
        assetExposure: vault.assetExposure,
        principalPartition: vault.principalPartition,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();
  }

  /** Withdraw USDC from the omni-pool vault (burns nvscUSDC). */
  async withdraw(user: PublicKey, amountUsdc: number): Promise<TransactionInstruction> {
    const vault = vaultAddresses(USDC_MINT, user, USDC_MINT);
    const userUsdc = getAssociatedTokenAddressSync(USDC_MINT, user, false, TOKEN_PROGRAM_ID);
    const userNvusdc = getAssociatedTokenAddressSync(NVSCUSDC_MINT, user, false, TOKEN_PROGRAM_ID);
    return this.client.nvUsdcVault.methods
      .withdraw(new anchor.BN(amountUsdc))
      .accounts({
        user,
        nvUsdcVaultProgram: PROGRAM_IDS.nvUsdcVault,
        usdcMint: USDC_MINT,
        nvscusdcMint: vault.nvscusdcMint,
        vaultConfig: vault.vaultConfig,
        vaultAuthority: vault.vaultAuthority,
        vaultUsdc: vault.vaultUsdc,
        userUsdc,
        userNvusdc,
        insuranceBuffer: vault.insuranceBuffer,
        assetRiskConfig: vault.assetRiskConfig,
        assetExposure: vault.assetExposure,
        principalPartition: vault.principalPartition,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();
  }

  /**
   * Open (or add to) a perps position. `signedPayload`/`merkleUpdate` come from
   * the JIT Pyth oracle feed for `market` (see sandbox.fetchJitPrice).
   */
  openPosition(
    user: PublicKey,
    market: PublicKey,
    subId: number,
    side: Side,
    sizeUsdc: number,
    priceUpdateAccount: PublicKey,
    signedPayload: Buffer,
    merkleUpdate: Buffer,
    guardianSet: PublicKey,
    pythConfig: PublicKey,
    treasury: PublicKey,
  ): Promise<TransactionInstruction> {
    const pt = ptAddresses(user, market, subId);
    const vault = vaultAddresses(USDC_MINT, user);
    const fee = feeRoutingAddresses(USDC_MINT, user);
    const userUsdc = getAssociatedTokenAddressSync(USDC_MINT, user, false, TOKEN_PROGRAM_ID);
    const userNvusdc = getAssociatedTokenAddressSync(NVSCUSDC_MINT, user, false, TOKEN_PROGRAM_ID);
    return this.client.positionTracker.methods
      .openPositionFromFeed(
        subId, side === 'long' ? 0 : 1, new anchor.BN(sizeUsdc),
        signedPayload, merkleUpdate, TREASURY_ID,
      )
      .accounts({
        trader: user,
        ptConfig: pt.ptConfig,
        market,
        position: pt.position,
        collateralVault: pt.collateralVault,
        traderUsdc: userUsdc,
        traderNvusdc: userNvusdc,
        vaultConfig: vault.vaultConfig,
        vaultAuthority: vault.vaultAuthority,
        vaultUsdc: vault.vaultUsdc,
        nvusdcMint: NVSCUSDC_MINT,
        nvUsdcVaultProgram: PROGRAM_IDS.nvUsdcVault,
        settlementVault: pt.settlementVault,
        burnEngineProgram: PROGRAM_IDS.burnEngine,
        burnState: fee.burnState,
        burnVaultUsdc: fee.burnVaultUsdc,
        stakingManagerProgram: PROGRAM_IDS.stakingManager,
        stakingFeePool: fee.stakingFeePool,
        stakingFeeVault: fee.stakingFeeVault,
        stakeAccount: fee.stakeAccount,
        priceUpdateAccount,
        guardianSet,
        pythConfig,
        treasury,
        pythReceiverProgram: new PublicKey('rec5EKMGg6MxZYaMdyBfgwpByTKgpsR4EfnrYxBmR9w'),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();
  }

  /**
   * Liquidation instruction — composes the 5 netting accounts AND the optional
   * 7 yield-router accounts so recall happens atomically when the vault's
   * on-hand LP-owned USDC is short (Pillar 4).
   */
  liquidate(
    liquidator: PublicKey,
    owner: PublicKey,
    market: PublicKey,
    subId: number,
    priceUpdateAccount: PublicKey,
    signedPayload: Buffer,
    merkleUpdate: Buffer,
    guardianSet: PublicKey,
    pythConfig: PublicKey,
    treasury: PublicKey,
    referrerUsdc: PublicKey,
    opts: { withNetting?: boolean; withRecall?: boolean } = { withNetting: true, withRecall: true },
  ): Promise<TransactionInstruction> {
    const pt = ptAddresses(owner, market, subId);
    const vault = vaultAddresses(USDC_MINT, owner);
    const liquidatorNvusdc = getAssociatedTokenAddressSync(NVSCUSDC_MINT, liquidator, false, TOKEN_PROGRAM_ID);

    const netting = nettingAddresses(owner, 0);
    const yr = yrAddresses(USDC_MINT);

    const remaining = [] as { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
    if (opts.withNetting !== false) {
      remaining.push(
        { pubkey: PROGRAM_IDS.nettingEngine, isSigner: false, isWritable: false },
        { pubkey: netting.config, isSigner: false, isWritable: true },
        { pubkey: netting.venue, isSigner: false, isWritable: true },
        { pubkey: netting.netPosition, isSigner: false, isWritable: true },
        { pubkey: netting.houseBook, isSigner: false, isWritable: true },
      );
    }
    if (opts.withRecall !== false) {
      remaining.push(
        { pubkey: PROGRAM_IDS.yieldRouter, isSigner: false, isWritable: false },
        { pubkey: yr.yrConfig, isSigner: false, isWritable: true },
        { pubkey: vault.vaultConfig, isSigner: false, isWritable: true },
        { pubkey: vault.vaultUsdc, isSigner: false, isWritable: true },
        { pubkey: yr.venueAta, isSigner: false, isWritable: true },
        { pubkey: PROGRAM_IDS.nvUsdcVault, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      );
    }

    return this.client.positionTracker.methods
      .liquidate(subId, signedPayload, merkleUpdate, TREASURY_ID)
      .accounts({
        liquidator,
        ptConfig: pt.ptConfig,
        market,
        owner,
        position: pt.position,
        collateralVault: pt.collateralVault,
        liquidatorNvusdc,
        vaultConfig: vault.vaultConfig,
        vaultAuthority: vault.vaultAuthority,
        vaultUsdc: vault.vaultUsdc,
        nvusdcMint: NVSCUSDC_MINT,
        nvUsdcVaultProgram: PROGRAM_IDS.nvUsdcVault,
        settlementVault: pt.settlementVault,
        priceUpdateAccount,
        guardianSet,
        pythConfig,
        treasury,
        pythReceiverProgram: new PublicKey('rec5EKMGg6MxZYaMdyBfgwpByTKgpsR4EfnrYxBmR9w'),
        referral: pt.referral,
        referrerUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .remainingAccounts(remaining)
      .instruction();
  }

  /**
   * Margin-call recall of deployed yield capital through the yield-router.
   * `caller` must be the pt-config PDA, clr-config PDA, or router admin.
   */
  recallForMargin(
    caller: PublicKey,
    usdcAmount: number,
    vaultConfig: PublicKey,
    vaultUsdc: PublicKey,
    venueAta: PublicKey,
  ): Promise<TransactionInstruction> {
    const yr = yrAddresses(USDC_MINT);
    return this.client.yieldRouter.methods
      .recallForMargin(new anchor.BN(usdcAmount))
      .accounts({
        caller,
        yrConfig: yr.yrConfig,
        vaultConfig,
        vaultUsdc,
        venueAta,
        nvUsdcVaultProgram: PROGRAM_IDS.nvUsdcVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .instruction();
  }
}
