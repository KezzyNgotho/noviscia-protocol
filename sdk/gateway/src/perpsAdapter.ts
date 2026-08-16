import { ProductAdapter } from './index';
import { PublicKey, Keypair, Transaction, TransactionInstruction } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';

export class PerpsAdapter implements ProductAdapter {
  name = 'perps';
  constructor(public idlPath?: string, public programId?: PublicKey) {}

  requiredAccounts(): PublicKey[] { return []; }

  async buildActionTx(params: any, signer: Keypair): Promise<Transaction> {
    // PoC: use the local IDL (if available) to build an Anchor instruction for `open_position_jit`.
    if (!this.idlPath || !this.programId) {
      // return placeholder tx
      return new Transaction();
    }
    const idlRaw = fs.readFileSync(path.resolve(this.idlPath), 'utf-8');
    const idl = JSON.parse(idlRaw);
    const provider = new anchor.AnchorProvider(new anchor.web3.Connection(process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com'), new anchor.Wallet(signer), { commitment: 'confirmed' });
    const program = new anchor.Program(idl as anchor.Idl, provider);

    // Build the instruction using a 'methods' builder if present; otherwise fallback to raw ix by name
    if ((program as any).methods && (program as any).methods.openPositionJit) {
      // adapt params minimally for PoC
      const m = (program as any).methods.openPositionJit(new anchor.BN(params.size || 0));
      // caller is expected to pass accounts in params.accounts
      if (params.accounts) m.accounts(params.accounts);
      const ix = await m.instruction();
      const tx = new Transaction().add(ix as TransactionInstruction);
      return tx;
    }

    // Fallback: search instruction by name in IDL and construct raw ix with no data
    const instr = (idl as any).instructions?.find((i: any) => i.name.toLowerCase().includes('open') || i.name.toLowerCase().includes('position'));
    if (instr) {
      const ix = new TransactionInstruction({ keys: [], programId: this.programId, data: Buffer.alloc(0) });
      return new Transaction().add(ix);
    }
    return new Transaction();
  }
}
