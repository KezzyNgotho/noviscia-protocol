import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import fs from 'fs';
import path from 'path';

const ZERO_BLOCKHASH = new PublicKey(new Uint8Array(32).fill(1)).toBase58();

function resolveIdlPath(programName: string): string | null {
  const idlFile = `${programName}.json`;
  const candidates = [
    path.join(process.cwd(), 'target', 'idl', idlFile),
    path.join(process.cwd(), '..', '..', 'target', 'idl', idlFile),
    path.join(process.cwd(), '..', '..', '..', 'target', 'idl', idlFile),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function readProgramJson(programName: string) {
  const idlPath = resolveIdlPath(programName);
  if (!idlPath) return null;
  try {
    return JSON.parse(fs.readFileSync(idlPath, 'utf8'));
  } catch {
    return null;
  }
}

function makeProvider(connection: Connection, signer?: Keypair) {
  const walletSigner = signer ?? Keypair.generate();
  return new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletSigner as any),
    anchor.AnchorProvider.defaultOptions(),
  );
}

export async function buildNettingSettlementTransaction(
  connection: Connection,
  params: {
    market: string;
    traders?: string[];
    feePayer?: PublicKey;
    signer?: Keypair;
    recentBlockhash?: string;
  } = { market: '' },
): Promise<Transaction> {
  const traders = params.traders ?? [];
  const tx = new Transaction();
  tx.feePayer = params.feePayer ?? params.signer?.publicKey ?? PublicKey.unique();
  tx.recentBlockhash = params.recentBlockhash ?? ZERO_BLOCKHASH;

  const idl = readProgramJson('netting_engine');
  if (!idl) return tx;

  let program: any = null;
  try {
    const provider = makeProvider(connection, params.signer);
    program = new anchor.Program(idl as any, provider);
  } catch {
    return tx;
  }

  for (const traderId of traders) {
    try {
      const traderPub = new PublicKey(traderId);
      const programId = program.programId;
      const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId);
      const [nettingSetPda] = PublicKey.findProgramAddressSync([Buffer.from('netting'), traderPub.toBuffer()], programId);
      const [houseBookPda] = PublicKey.findProgramAddressSync([Buffer.from('housebook')], programId);

      if ((program as any).methods && (program as any).methods.consolidate) {
        const ix = await (program as any).methods.consolidate().accounts({
          config: configPda,
          trader: traderPub,
          nettingSet: nettingSetPda,
          houseBook: houseBookPda,
          systemProgram: SystemProgram.programId,
        }).instruction();
        tx.add(ix as TransactionInstruction);
      }
    } catch {
      // ignore malformed traders or missing account data; keep partial valid tx
    }
  }

  return tx;
}

export async function buildRecallMarginTransaction(
  connection: Connection,
  params: {
    amount: number;
    callerKeypair?: Keypair;
    vaultUsdcMint?: PublicKey;
    vaultUsdcAccount?: PublicKey;
    venueAta?: PublicKey;
    feePayer?: PublicKey;
    recentBlockhash?: string;
  },
): Promise<Transaction> {
  const tx = new Transaction();
  tx.feePayer = params.feePayer ?? params.callerKeypair?.publicKey ?? PublicKey.unique();
  tx.recentBlockhash = params.recentBlockhash ?? ZERO_BLOCKHASH;

  if (!params.callerKeypair || !params.vaultUsdcMint || !params.vaultUsdcAccount || !params.venueAta) {
    return tx;
  }

  const idl = readProgramJson('yield_router');
  if (!idl) return tx;

  let program: any = null;
  try {
    const provider = makeProvider(connection, params.callerKeypair);
    program = new anchor.Program(idl as any, provider);
  } catch {
    return tx;
  }

  try {
    const programId = program.programId;
    const [yrConfig] = PublicKey.findProgramAddressSync([Buffer.from('yr-config')], programId);
    const [vaultConfig] = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-config'), params.vaultUsdcMint.toBuffer()], programId);
    const nvVaultIdl = readProgramJson('nv_usdc_vault');
    if (!nvVaultIdl?.address) return tx;

    if ((program as any).methods && (program as any).methods.recallForMargin) {
      const ix = await (program as any).methods.recallForMargin(new anchor.BN(params.amount)).accounts({
        caller: params.callerKeypair.publicKey,
        yrConfig,
        vaultConfig,
        vaultUsdc: params.vaultUsdcAccount,
        venueAta: params.venueAta,
        nvUsdcVaultProgram: new PublicKey(nvVaultIdl.address),
        tokenProgram: TOKEN_PROGRAM_ID,
      }).instruction();
      tx.add(ix as TransactionInstruction);
    }
  } catch {
    // leave empty tx when the runtime IDL/account set does not match the on-chain program
  }

  return tx;
}

export default {
  buildNettingSettlementTransaction,
  buildRecallMarginTransaction,
};
