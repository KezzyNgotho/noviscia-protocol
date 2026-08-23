import * as anchor from '@coral-xyz/anchor';
import { readFileSync } from 'fs';
import { PublicKey, Keypair } from '@solana/web3.js';

async function main(){
  const RPC = process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com';
  const IDL = process.env.PT_IDL || '../../target/idl/position_tracker.json';
  const PROGRAM_ID = process.env.POSITION_TRACKER_PROGRAM || '6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws';
  const ADMIN_KEYPATH = process.env.ANCHOR_WALLET || process.env.HOME + '/.config/solana/new-id.json';

  const idl = JSON.parse(readFileSync(IDL,'utf-8'));
  const adminKp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(ADMIN_KEYPATH,'utf-8'))));
  const provider = new anchor.AnchorProvider(new anchor.web3.Connection(RPC, 'confirmed'), new anchor.Wallet(adminKp), { commitment: 'confirmed' });
  const program = new anchor.Program(idl as anchor.Idl, provider);

  // example: register SOL market using env FEED_HEX and leverage args
  const feedHex = process.env.FEED_HEX || '';
  if (!feedHex) { console.error('Set FEED_HEX env var to Pyth feed hex'); process.exit(1); }
  const feedBytes = Buffer.from(feedHex,'hex');
  const maxLeverageBps = Number(process.env.MAX_LEVERAGE_BPS || 500000);
  const maintenanceMarginBps = Number(process.env.MAINT_BPS || 100);

  // derive PDAs
  const [ptConfig] = PublicKey.findProgramAddressSync([Buffer.from('pt-config')], program.programId);
  const [feedRegistry] = PublicKey.findProgramAddressSync([Buffer.from('pyth-feed-registry')], program.programId);

  // create a keypair for market account (payer will be admin)
  const marketKp = anchor.web3.Keypair.generate();

  try{
    const tx = await program.methods.registerMarket(Array.from(feedBytes), maxLeverageBps, maintenanceMarginBps)
      .accounts({ admin: adminKp.publicKey, ptConfig, feedRegistry, market: marketKp.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([marketKp])
      .rpc();
    console.log('market-registered tx', tx);
  }catch(e:any){
    console.error('failed register_market', e.message ?? e);
  }
}

main().catch((e)=>{ console.error(e); process.exit(1); });
