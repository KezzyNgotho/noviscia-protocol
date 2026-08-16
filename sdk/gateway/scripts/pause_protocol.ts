import * as anchor from '@coral-xyz/anchor';
import { readFileSync } from 'fs';
import { PublicKey, Keypair } from '@solana/web3.js';

async function main(){
  const RPC = process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com';
  const IDL = process.env.PT_IDL || '../../target/idl/position_tracker.json';
  const PROGRAM_ID = process.env.POSITION_TRACKER_PROGRAM || '3zGRWKZq4V3npHbH9Lati46BwgmstTjynWZFFMxarQgY';
  const ADMIN_KEYPATH = process.env.ANCHOR_WALLET || process.env.HOME + '/.config/solana/new-id.json';

  const idl = JSON.parse(readFileSync(IDL,'utf-8'));
  const adminKp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(ADMIN_KEYPATH,'utf-8'))));
  const provider = new anchor.AnchorProvider(new anchor.web3.Connection(RPC, 'confirmed'), new anchor.Wallet(adminKp), { commitment: 'confirmed' });
  const program = new anchor.Program(idl as anchor.Idl, new PublicKey(PROGRAM_ID), provider);

  const pause_opens = process.env.PAUSE_OPENS === '1';
  const pause_deposits = process.env.PAUSE_DEPOSITS === '1';
  const pause_withdrawals = process.env.PAUSE_WITHDRAWALS === '1';
  const pause_liquidations = process.env.PAUSE_LIQUIDATIONS === '1';

  const [ptConfig] = PublicKey.findProgramAddressSync([Buffer.from('pt-config')], program.programId);
  const [timelock] = PublicKey.findProgramAddressSync([Buffer.from('timelocked-admin')], program.programId);

  try{
    const tx = await program.methods.setPauseFlags(pause_opens, pause_deposits, pause_withdrawals, pause_liquidations)
      .accounts({ admin: adminKp.publicKey, ptConfig, timelockedAdmin: timelock })
      .rpc();
    console.log('set_pause_flags tx', tx);
  }catch(e:any){
    console.error('failed set_pause_flags', e.message ?? e);
  }
}

main().catch((e)=>{ console.error(e); process.exit(1); });
