import { ProductAdapter } from './index';
import { PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram, SYSVAR_RENT_PUBKEY, ComputeBudgetProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';

const SPOT_DEX_PROGRAM_ID = new PublicKey('8C4tr3b6JpEoqyh1tL9FwcS3S5E7uY9vLiN7tToWRfjf');
const NETTING_ENGINE_ID = new PublicKey('68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56');

const POOL_SEED = Buffer.from('amm-pool');
const POOL_LP_MINT_SEED = Buffer.from('amm-lp-mint');
const CONFIG_SEED = Buffer.from('dex-config');

function classifyTxError(msg: string): 'transient' | 'permanent' {
  if (msg.includes('Blockhash not found') || msg.includes('expired') ||
      msg.includes('429') || msg.includes('503') || msg.includes('TransactionExpiredBlockheightExceededError')) {
    return 'transient';
  }
  return 'permanent';
}

async function estimatePriorityFee(connection: any): Promise<number> {
  try {
    const fees = await connection.getRecentPrioritizationFees();
    if (!fees || fees.length === 0) return 10_000;
    const sorted = fees.map((f: any) => f.prioritizationFee).sort((a: number, b: number) => a - b);
    return Math.max(sorted[Math.floor(sorted.length * 0.75)] ?? 10_000, 5_000);
  } catch {
    return 10_000;
  }
}

export class SpotAdapter implements ProductAdapter {
  name = 'spot-dex';
  private idlPath?: string;

  constructor(idlPath?: string) {
    this.idlPath = idlPath;
  }

  requiredAccounts(): PublicKey[] {
    return [SPOT_DEX_PROGRAM_ID];
  }

  async buildActionTx(params: {
    action: 'swap' | 'addLiquidity' | 'removeLiquidity';
    poolIndex?: number;
    amountIn?: number;
    minAmountOut?: number;
    swapBaseToQuote?: boolean;
    maxBaseAmount?: number;
    maxQuoteAmount?: number;
    minLpTokens?: number;
    lpTokensToBurn?: number;
    userBaseAccount?: PublicKey;
    userQuoteAccount?: PublicKey;
    userLpAccount?: PublicKey;
    nettingConfig?: PublicKey;
    nettingVenue?: PublicKey;
    nettingPosition?: PublicKey;
    nettingHouseBook?: PublicKey;
    payer?: PublicKey;
  }, signer: Keypair): Promise<Transaction> {
    const tx = new Transaction();
    const poolIndex = params.poolIndex ?? 0;

    const [poolPda] = PublicKey.findProgramAddressSync(
      [POOL_SEED, Buffer.from(new Uint8Array(new Uint32Array([poolIndex]).buffer))],
      SPOT_DEX_PROGRAM_ID,
    );

    const [lpMint] = PublicKey.findProgramAddressSync(
      [POOL_LP_MINT_SEED, Buffer.from(new Uint8Array(new Uint32Array([poolIndex]).buffer))],
      SPOT_DEX_PROGRAM_ID,
    );

    const [dexConfig] = PublicKey.findProgramAddressSync(
      [CONFIG_SEED],
      SPOT_DEX_PROGRAM_ID,
    );

    if (this.idlPath) {
      try {
        const idlRaw = fs.readFileSync(path.resolve(this.idlPath), 'utf-8');
        const idl = JSON.parse(idlRaw);
        const provider = new anchor.AnchorProvider(
          new anchor.web3.Connection(process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com'),
          new anchor.Wallet(signer),
          { commitment: 'confirmed' },
        );
        const program = new anchor.Program(idl as anchor.Idl, provider);

        if (params.action === 'swap' && (program as any).methods?.swap) {
          const m = (program as any).methods.swap(
            new anchor.BN(params.amountIn || 0),
            new anchor.BN(params.minAmountOut || 0),
            params.swapBaseToQuote ?? true,
          );
          m.accounts({
            user: signer.publicKey,
            dexConfig,
            pool: poolPda,
            baseVault: PublicKey.default,
            quoteVault: PublicKey.default,
            userBaseAccount: params.userBaseAccount || PublicKey.default,
            userQuoteAccount: params.userQuoteAccount || PublicKey.default,
            nettingConfig: params.nettingConfig || PublicKey.default,
            nettingVenue: params.nettingVenue || PublicKey.default,
            nettingPosition: params.nettingPosition || PublicKey.default,
            nettingHouseBook: params.nettingHouseBook || PublicKey.default,
            payer: params.payer || signer.publicKey,
            nettingProgram: NETTING_ENGINE_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          });
          const ix = await m.instruction();
          tx.add(ix as TransactionInstruction);
          return tx;
        }

        if (params.action === 'addLiquidity' && (program as any).methods?.addLiquidity) {
          const m = (program as any).methods.addLiquidity(
            new anchor.BN(params.maxBaseAmount || 0),
            new anchor.BN(params.maxQuoteAmount || 0),
            new anchor.BN(params.minLpTokens || 0),
          );
          m.accounts({
            user: signer.publicKey,
            dexConfig,
            pool: poolPda,
            lpMint,
            baseVault: PublicKey.default,
            quoteVault: PublicKey.default,
            userLpAccount: params.userLpAccount || PublicKey.default,
            userBaseAccount: params.userBaseAccount || PublicKey.default,
            userQuoteAccount: params.userQuoteAccount || PublicKey.default,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          });
          const ix = await m.instruction();
          tx.add(ix as TransactionInstruction);
          return tx;
        }

        if (params.action === 'removeLiquidity' && (program as any).methods?.removeLiquidity) {
          const m = (program as any).methods.removeLiquidity(
            new anchor.BN(params.lpTokensToBurn || 0),
            new anchor.BN(0),
            new anchor.BN(0),
          );
          m.accounts({
            user: signer.publicKey,
            dexConfig,
            pool: poolPda,
            lpMint,
            baseVault: PublicKey.default,
            quoteVault: PublicKey.default,
            userLpAccount: params.userLpAccount || PublicKey.default,
            userBaseAccount: params.userBaseAccount || PublicKey.default,
            userQuoteAccount: params.userQuoteAccount || PublicKey.default,
            tokenProgram: TOKEN_PROGRAM_ID,
          });
          const ix = await m.instruction();
          tx.add(ix as TransactionInstruction);
          return tx;
        }
      } catch {
        // Fall through to raw instruction
      }
    }

    // Fallback: build raw instruction
    const discriminator = Buffer.from(
      params.action === 'swap'
        ? [0xf8, 0xc6, 0x9e, 0x91, 0xe1, 0x75, 0x87, 0xc8] // swap
        : params.action === 'addLiquidity'
          ? [0x69, 0x8a, 0x62, 0x4f, 0x49, 0x37, 0xe4, 0x69] // add_liquidity
          : [0x27, 0x89, 0xe5, 0x80, 0x34, 0x75, 0x2d, 0x58], // remove_liquidity
    );

    const data = params.action === 'swap'
      ? Buffer.concat([
          discriminator,
          Buffer.from(new Uint8Array(new BigUint64Array([BigInt(params.amountIn || 0)].map(BigInt.prototype.valueOf)).buffer)),
          Buffer.from(new Uint8Array(new BigUint64Array([BigInt(params.minAmountOut || 0)].map(BigInt.prototype.valueOf)).buffer)),
          Buffer.from([params.swapBaseToQuote ? 1 : 0]),
        ])
      : params.action === 'addLiquidity'
        ? Buffer.concat([
            discriminator,
            Buffer.from(new Uint8Array(new BigUint64Array([BigInt(params.maxBaseAmount || 0)].map(BigInt.prototype.valueOf)).buffer)),
            Buffer.from(new Uint8Array(new BigUint64Array([BigInt(params.maxQuoteAmount || 0)].map(BigInt.prototype.valueOf)).buffer)),
            Buffer.from(new Uint8Array(new BigUint64Array([BigInt(params.minLpTokens || 0)].map(BigInt.prototype.valueOf)).buffer)),
          ])
        : Buffer.concat([
            discriminator,
            Buffer.from(new Uint8Array(new BigUint64Array([BigInt(params.lpTokensToBurn || 0)].map(BigInt.prototype.valueOf)).buffer)),
            Buffer.from(new Uint8Array(new BigUint64Array([0n].map(BigInt.prototype.valueOf)).buffer)),
            Buffer.from(new Uint8Array(new BigUint64Array([0n].map(BigInt.prototype.valueOf)).buffer)),
          ]);

    const keys = params.action === 'swap'
      ? [
          { pubkey: signer.publicKey, isSigner: true, isWritable: true },
          { pubkey: dexConfig, isSigner: false, isWritable: false },
          { pubkey: poolPda, isSigner: false, isWritable: true },
          { pubkey: PublicKey.default, isSigner: false, isWritable: true }, // base_vault
          { pubkey: PublicKey.default, isSigner: false, isWritable: true }, // quote_vault
          { pubkey: params.userBaseAccount || PublicKey.default, isSigner: false, isWritable: true },
          { pubkey: params.userQuoteAccount || PublicKey.default, isSigner: false, isWritable: true },
          { pubkey: params.nettingConfig || PublicKey.default, isSigner: false, isWritable: true },
          { pubkey: params.nettingVenue || PublicKey.default, isSigner: false, isWritable: true },
          { pubkey: params.nettingPosition || PublicKey.default, isSigner: false, isWritable: true },
          { pubkey: params.nettingHouseBook || PublicKey.default, isSigner: false, isWritable: true },
          { pubkey: params.payer || signer.publicKey, isSigner: true, isWritable: true },
          { pubkey: NETTING_ENGINE_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ]
      : params.action === 'addLiquidity'
        ? [
            { pubkey: signer.publicKey, isSigner: true, isWritable: true },
            { pubkey: dexConfig, isSigner: false, isWritable: false },
            { pubkey: poolPda, isSigner: false, isWritable: true },
            { pubkey: lpMint, isSigner: false, isWritable: true },
            { pubkey: PublicKey.default, isSigner: false, isWritable: true }, // base_vault
            { pubkey: PublicKey.default, isSigner: false, isWritable: true }, // quote_vault
            { pubkey: params.userBaseAccount || PublicKey.default, isSigner: false, isWritable: true },
            { pubkey: params.userQuoteAccount || PublicKey.default, isSigner: false, isWritable: true },
            { pubkey: params.userLpAccount || PublicKey.default, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ]
        : [
            { pubkey: signer.publicKey, isSigner: true, isWritable: true },
            { pubkey: dexConfig, isSigner: false, isWritable: false },
            { pubkey: poolPda, isSigner: false, isWritable: true },
            { pubkey: lpMint, isSigner: false, isWritable: true },
            { pubkey: PublicKey.default, isSigner: false, isWritable: true }, // base_vault
            { pubkey: PublicKey.default, isSigner: false, isWritable: true }, // quote_vault
            { pubkey: params.userBaseAccount || PublicKey.default, isSigner: false, isWritable: true },
            { pubkey: params.userQuoteAccount || PublicKey.default, isSigner: false, isWritable: true },
            { pubkey: params.userLpAccount || PublicKey.default, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          ];

    tx.add(new TransactionInstruction({
      keys,
      programId: SPOT_DEX_PROGRAM_ID,
      data,
    }));

    return tx;
  }

  private async sendTransactionWithSimulation(
    connection: any,
    tx: any,
    signer: Keypair,
    label: string,
  ): Promise<string> {
    const maxAttempts = 3;
    const computeUnits = 400_000;
    let priorityFee = await estimatePriorityFee(connection);

    tx.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        tx.recentBlockhash = blockhash;
        tx.lastValidBlockHeight = lastValidBlockHeight;
        tx.feePayer = tx.feePayer || signer.publicKey;

        const simulation = await connection.simulateTransaction(tx, [signer]);
        if (simulation.value.err) {
          const errMsg = JSON.stringify(simulation.value.err);
          if (attempt < maxAttempts && classifyTxError(errMsg) === 'transient') {
            priorityFee = Math.min(priorityFee * 2, 500_000);
            await new Promise(r => setTimeout(r, 1000 * attempt));
            continue;
          }
          throw new Error(`[${label}] Simulation failed: ${errMsg}`);
        }

        const sig = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
          maxRetries: 0,
        });

        await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
        return sig;
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (attempt < maxAttempts && classifyTxError(msg) === 'transient') {
          priorityFee = Math.min(priorityFee * 2, 500_000);
          await new Promise(r => setTimeout(r, 1000 * attempt));
          continue;
        }
        throw e;
      }
    }
    throw new Error(`[${label}] Failed after ${maxAttempts} attempts`);
  }

  async buildAndSendActionTx(
    params: Parameters<SpotAdapter['buildActionTx']>[0],
    signer: Keypair,
    connection: any,
  ): Promise<string> {
    const tx = await this.buildActionTx(params, signer);
    return this.sendTransactionWithSimulation(connection, tx, signer, params.action);
  }
}
