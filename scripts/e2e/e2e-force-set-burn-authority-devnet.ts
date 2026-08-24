/**
 * One-time migration: set burn_state.authority to the new pt-config PDA.
 * Uses raw instruction with computed Anchor discriminator.
 */
import 'dotenv/config';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';

const RPC = process.env.SOLANA_RPC_DEVNET || 'https://devnet.helius-rpc.com/?api-key=26358ecf-b65d-4d55-99d7-157e796bcf52';
const KEYPAIR_PATH = process.env.ANCHOR_WALLET || path.join(process.env.HOME!, '.config/solana/new-id.json');
const BURN_ENGINE = new PublicKey('nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id');
const BURN_STATE = new PublicKey('EH2VWWDnhfmin2gq2VC5jVck451bPtaRsqTwnbQcXMjK');
const PT_CONFIG = new PublicKey('CUm1SK9jQvqETp41dptANVi7NcxeXpgisyyCbo1MTXXu');

const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'))));
const conn = new Connection(RPC, 'confirmed');

// Anchor discriminator = first 8 bytes of sha256('global:force_set_authority')
const disc = crypto.createHash('sha256').update('global:force_set_authority').digest();
const data = Buffer.alloc(40);
disc.copy(data, 0, 0, 8);
PT_CONFIG.toBuffer().copy(data, 8);

async function main() {
  console.log('Admin:', keypair.publicKey.toBase58());
  console.log('Setting burn_state.authority to:', PT_CONFIG.toBase58());

  const ix = new TransactionInstruction({
    programId: BURN_ENGINE,
    keys: [
      { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: BURN_STATE, isSigner: false, isWritable: true },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = keypair.publicKey;
  tx.sign(keypair);

  const sig = await conn.sendRawTransaction(tx.serialize());
  console.log('TX:', sig);
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
  console.log('Done! burn_state.authority = pt-config PDA');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
