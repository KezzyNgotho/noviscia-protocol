/**
 * Reinitialize the staking fee pool + vault after migration closed them.
 * These PDAs are required by sweep_trading_fee_split for the 25% staking share.
 *
 * Run: npx tsx scripts/e2e/e2e-reinit-staking-fee-pool-devnet.ts
 */
import 'dotenv/config';
import * as anchor from '@coral-xyz/anchor';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const RPC = process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com';
const KEYPAIR_PATH = process.env.ANCHOR_WALLET || path.join(process.env.HOME!, '.config/solana/new-id.json');
const USDC_MINT = new PublicKey('Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5');
const STAKING_MANAGER_PROGRAM_ID = new PublicKey('HjxcKV51A7jxE2iqMCDY7EvWFL9XsheuM43DamWGabqb');

const [stakingFeePool] = PublicKey.findProgramAddressSync(
  [Buffer.from('staking-fee-pool')], STAKING_MANAGER_PROGRAM_ID
);
const [stakingFeeVault] = PublicKey.findProgramAddressSync(
  [Buffer.from('staking-fee-pool'), Buffer.from('vault')], STAKING_MANAGER_PROGRAM_ID
);

async function main() {
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'))));
  const connection = new Connection(RPC, 'confirmed');
  const provider = new AnchorProvider(connection, new Wallet(keypair), { commitment: 'confirmed' });
  anchor.setProvider(provider);

  const idlPath = path.join(ROOT, 'target/idl/staking_manager.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
  const sm = new Program(idl as any, provider) as Program<any>;

  console.log('Authority:', keypair.publicKey.toBase58());
  console.log('Staking Fee Pool:', stakingFeePool.toBase58());
  console.log('Staking Fee Vault:', stakingFeeVault.toBase58());

  // Check if pool already exists
  const poolInfo = await connection.getAccountInfo(stakingFeePool);
  if (poolInfo) {
    console.log('Staking fee pool already exists — skipping init.');
    return;
  }

  console.log('Initializing staking fee pool...');
  const tx = await sm.methods
    .initializeStakingFeePool()
    .accounts({
      authority: keypair.publicKey,
      stakingFeePool,
      stakingFeeVault,
      usdcMint: USDC_MINT,
      systemProgram: '11111111111111111111111111111111',
      tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      rent: 'SysvarRent111111111111111111111111111111111',
    })
    .rpc();

  console.log('TX:', tx);
  console.log('Staking fee pool + vault initialized!');

  // Verify
  const vaultInfo = await connection.getAccountInfo(stakingFeeVault);
  console.log(`Vault exists: ${!!vaultInfo}, size: ${vaultInfo?.data.length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
