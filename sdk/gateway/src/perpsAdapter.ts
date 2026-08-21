import { ProductAdapter } from './index';
import { PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram, SYSVAR_RENT_PUBKEY, ComputeBudgetProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';

const POSITION_TRACKER_ID = new PublicKey('6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws');
const PYTH_RECEIVER = new PublicKey('rec5EKMGg6MxZYaMdyBfgwpByTKgpsR4EfnrYxBmR9w');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

const PT_CONFIG_SEED = Buffer.from('pt-config');

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

export class PerpsAdapter implements ProductAdapter {
  name = 'perps';
  private idlPath?: string;

  constructor(idlPath?: string) {
    this.idlPath = idlPath;
  }

  requiredAccounts(): PublicKey[] {
    return [POSITION_TRACKER_ID];
  }

  async buildActionTx(params: {
    action: 'openPosition' | 'closePosition' | 'depositMargin' | 'withdrawMargin' | 'setTpSl';
    market?: PublicKey;
    side?: number;
    sizeUsdc?: number;
    leverage?: number;
    subId?: number;
    pythFeed?: PublicKey;
    userMarginAccount?: PublicKey;
    userTokenAccount?: PublicKey;
    settlementVault?: PublicKey;
    insuranceVault?: PublicKey;
    priceFeed?: PublicKey;
    pythReceiver?: PublicKey;
    feedRegistry?: PublicKey;
    maxLeverage?: number;
    maintenanceMarginBps?: number;
  }, signer: Keypair): Promise<Transaction> {
    const tx = new Transaction();

    const [ptConfig] = PublicKey.findProgramAddressSync(
      [PT_CONFIG_SEED],
      POSITION_TRACKER_ID,
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
        const program = new anchor.Program(idl as anchor.Idl, POSITION_TRACKER_ID, provider);

        if (params.action === 'openPosition' && (program as any).methods?.openPositionJit) {
          const m = (program as any).methods.openPositionJit(
            new anchor.BN(params.sizeUsdc || 0),
          );
          m.accounts({
            signer: signer.publicKey,
            ptConfig,
            market: params.market || PublicKey.default,
            userMarginAccount: params.userMarginAccount || PublicKey.default,
            userTokenAccount: params.userTokenAccount || PublicKey.default,
            settlementVault: params.settlementVault || PublicKey.default,
            insuranceVault: params.insuranceVault || PublicKey.default,
            priceFeed: params.priceFeed || PublicKey.default,
            pythReceiver: params.pythReceiver || PYTH_RECEIVER,
            tokenProgram: TOKEN_PROGRAM,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          });
          const ix = await m.instruction();
          tx.add(ix as TransactionInstruction);
          return tx;
        }

        if (params.action === 'closePosition' && (program as any).methods?.closePosition) {
          const m = (program as any).methods.closePosition();
          m.accounts({
            signer: signer.publicKey,
            ptConfig,
            market: params.market || PublicKey.default,
            userMarginAccount: params.userMarginAccount || PublicKey.default,
            userTokenAccount: params.userTokenAccount || PublicKey.default,
            settlementVault: params.settlementVault || PublicKey.default,
            insuranceVault: params.insuranceVault || PublicKey.default,
            priceFeed: params.priceFeed || PublicKey.default,
            pythReceiver: params.pythReceiver || PYTH_RECEIVER,
            tokenProgram: TOKEN_PROGRAM,
            systemProgram: SystemProgram.programId,
          });
          const ix = await m.instruction();
          tx.add(ix as TransactionInstruction);
          return tx;
        }

        if (params.action === 'depositMargin' && (program as any).methods?.depositUsdcToMargin) {
          const m = (program as any).methods.depositUsdcToMargin(
            new anchor.BN(params.sizeUsdc || 0),
          );
          m.accounts({
            signer: signer.publicKey,
            ptConfig,
            userMarginAccount: params.userMarginAccount || PublicKey.default,
            userTokenAccount: params.userTokenAccount || PublicKey.default,
            settlementVault: params.settlementVault || PublicKey.default,
            tokenProgram: TOKEN_PROGRAM,
            systemProgram: SystemProgram.programId,
          });
          const ix = await m.instruction();
          tx.add(ix as TransactionInstruction);
          return tx;
        }

        if (params.action === 'withdrawMargin' && (program as any).methods?.withdrawFromMargin) {
          const m = (program as any).methods.withdrawFromMargin(
            new anchor.BN(params.sizeUsdc || 0),
          );
          m.accounts({
            signer: signer.publicKey,
            ptConfig,
            userMarginAccount: params.userMarginAccount || PublicKey.default,
            userTokenAccount: params.userTokenAccount || PublicKey.default,
            settlementVault: params.settlementVault || PublicKey.default,
            tokenProgram: TOKEN_PROGRAM,
            systemProgram: SystemProgram.programId,
          });
          const ix = await m.instruction();
          tx.add(ix as TransactionInstruction);
          return tx;
        }

        if (params.action === 'setTpSl' && (program as any).methods?.setTpSl) {
          const m = (program as any).methods.setTpSl(
            new anchor.BN(params.sizeUsdc || 0),
            new anchor.BN(0), // sl
          );
          m.accounts({
            signer: signer.publicKey,
            ptConfig,
            market: params.market || PublicKey.default,
            userMarginAccount: params.userMarginAccount || PublicKey.default,
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
    const actionDiscriminators: Record<string, Buffer> = {
      openPosition: Buffer.from([0x69, 0x8a, 0x62, 0x4f, 0x49, 0x37, 0xe4, 0x69]),
      closePosition: Buffer.from([0x27, 0x89, 0xe5, 0x80, 0x34, 0x75, 0x2d, 0x58]),
      depositMargin: Buffer.from([0xf8, 0xc6, 0x9e, 0x91, 0xe1, 0x75, 0x87, 0xc8]),
      withdrawMargin: Buffer.from([0x1a, 0x2b, 0x3c, 0x4d, 0x5e, 0x6f, 0x7a, 0x8b]),
      setTpSl: Buffer.from([0x2c, 0x3d, 0x4e, 0x5f, 0x6a, 0x7b, 0x8c, 0x9d]),
    };

    const discriminator = actionDiscriminators[params.action] || Buffer.alloc(8);
    const data = params.sizeUsdc
      ? Buffer.concat([discriminator, Buffer.from(new Uint8Array(new BigUint64Array([BigInt(params.sizeUsdc)]).buffer))])
      : discriminator;

    const keys = [
      { pubkey: signer.publicKey, isSigner: true, isWritable: true },
      { pubkey: ptConfig, isSigner: false, isWritable: true },
      { pubkey: params.market || PublicKey.default, isSigner: false, isWritable: true },
      { pubkey: params.userMarginAccount || PublicKey.default, isSigner: false, isWritable: true },
      { pubkey: params.userTokenAccount || PublicKey.default, isSigner: false, isWritable: true },
      { pubkey: params.settlementVault || PublicKey.default, isSigner: false, isWritable: true },
      { pubkey: params.insuranceVault || PublicKey.default, isSigner: false, isWritable: true },
      { pubkey: params.priceFeed || PublicKey.default, isSigner: false, isWritable: true },
      { pubkey: params.pythReceiver || PYTH_RECEIVER, isSigner: false, isWritable: false },
      { pubkey: params.feedRegistry || PublicKey.default, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ];

    tx.add(new TransactionInstruction({
      keys,
      programId: POSITION_TRACKER_ID,
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
    params: Parameters<PerpsAdapter['buildActionTx']>[0],
    signer: Keypair,
    connection: any,
  ): Promise<string> {
    const tx = await this.buildActionTx(params, signer);
    return this.sendTransactionWithSimulation(connection, tx, signer, params.action);
  }
}
