/**
 * Set fee split on-chain via the new `set_fee_split` admin instruction.
 * Activates the configurable fee splits in PtConfig (previously all zeros,
 * falling back to compile-time defaults).
 *
 * Run: npx tsx scripts/e2e-set-fee-split-devnet.ts
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

// ── Fee split values (bps) ──
// Current compile-time defaults: vault=60%, staking=25%, default_fund=15%, ccp_equity=2.5%
// These match the existing protocol behavior — we're making them explicit on-chain.
const TRADING_FEE_VAULT_SHARE_BPS = 6_000;   // 60%
const TRADING_FEE_STAKING_SHARE_BPS = 2_500;  // 25%
const DEFAULT_FUND_FEE_BPS = 1_500;           // 15%
const CCP_EQUITY_FEE_BPS = 250;               // 2.5%

const PT_PROGRAM_ID = new PublicKey('6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws');
const PT_CONFIG = new PublicKey('CUm1SK9jQvqETp41dptANVi7NcxeXpgisyyCbo1MTXXu');
const TIMELOCKED_ADMIN = new PublicKey('6BnVCx1DLtpzZQfHpUxDtjjLU2gW88DCWcfYU21r1Bwh');

async function main() {
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'))));
  const connection = new Connection(RPC, 'confirmed');
  const provider = new AnchorProvider(connection, new Wallet(keypair), { commitment: 'confirmed' });
  anchor.setProvider(provider);

  const idlPath = path.join(ROOT, 'target/idl/position_tracker.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
  const pt = new Program(idl as any, provider) as Program<any>;

  console.log('Admin:', keypair.publicKey.toBase58());
  console.log('PT Config:', PT_CONFIG.toBase58());
  console.log('Timelocked Admin:', TIMELOCKED_ADMIN.toBase58());
  console.log('');

  // Validate constraints
  if (TRADING_FEE_VAULT_SHARE_BPS < TRADING_FEE_STAKING_SHARE_BPS) {
    throw new Error('vault_share must be >= staking_share');
  }
  if (DEFAULT_FUND_FEE_BPS + CCP_EQUITY_FEE_BPS >= 10_000) {
    throw new Error('default_fund + ccp_equity must be < 10000');
  }

  // Step 1: Resize pt_config if needed
  const accountInfo = await connection.getAccountInfo(PT_CONFIG);
  if (!accountInfo) throw new Error('pt_config account not found');
  const currentLen = accountInfo.data.length;
  const targetLen = 113; // SPACE_V4 + 8 bytes for fee splits

  if (currentLen < targetLen) {
    console.log(`Step 1: Resizing pt_config from ${currentLen} to ${targetLen} bytes...`);
    try {
      const resizeTx = await pt.methods
        .resizePtConfig()
        .accounts({
          admin: keypair.publicKey,
          ptConfig: PT_CONFIG,
          timelockedAdmin: TIMELOCKED_ADMIN,
          systemProgram: '11111111111111111111111111111111',
        })
        .rpc();
      console.log('Resize TX:', resizeTx);
      // Wait for confirmation
      await new Promise(r => setTimeout(r, 2000));
    } catch (err: any) {
      console.error('Resize failed:', err.message || err);
      if (err.logs) console.error('Logs:', err.logs.slice(-5).join('\n'));
      process.exit(1);
    }
  } else {
    console.log(`Step 1: pt_config already ${currentLen} bytes, no resize needed.`);
  }

  // Step 2: Set fee split
  console.log('');
  console.log('Step 2: Setting fee split:');
  console.log(`  Vault share:       ${TRADING_FEE_VAULT_SHARE_BPS} bps (${TRADING_FEE_VAULT_SHARE_BPS / 100}%)`);
  console.log(`  Staking share:     ${TRADING_FEE_STAKING_SHARE_BPS} bps (${TRADING_FEE_STAKING_SHARE_BPS / 100}%)`);
  console.log(`  Default fund:      ${DEFAULT_FUND_FEE_BPS} bps (${DEFAULT_FUND_FEE_BPS / 100}%)`);
  console.log(`  CCP equity:        ${CCP_EQUITY_FEE_BPS} bps (${CCP_EQUITY_FEE_BPS / 100}%)`);
  console.log('');

  try {
    const tx = await pt.methods
      .setFeeSplit(
        TRADING_FEE_VAULT_SHARE_BPS,
        TRADING_FEE_STAKING_SHARE_BPS,
        DEFAULT_FUND_FEE_BPS,
        CCP_EQUITY_FEE_BPS,
      )
      .accounts({
        admin: keypair.publicKey,
        ptConfig: PT_CONFIG,
        timelockedAdmin: TIMELOCKED_ADMIN,
      })
      .rpc();

    console.log('TX signature:', tx);
    console.log('Fee split activated on-chain!');

    // Verify: read back the pt_config account
    const configData = await connection.getAccountInfo(PT_CONFIG);
    if (configData) {
      const d = configData.data;
      const SPACE_V4 = 8 + 32 + 32 + 1 + 1 + 1 + 1 + 1 + 1 + 2 + 8 + 8 + 2 + 1 + 1 + 4 + 1; // 105
      if (d.length >= SPACE_V4 + 8) {
        const vault = d.readUInt16LE(SPACE_V4);
        const staking = d.readUInt16LE(SPACE_V4 + 2);
        const defaultFund = d.readUInt16LE(SPACE_V4 + 4);
        const ccpEquity = d.readUInt16LE(SPACE_V4 + 6);
        console.log('');
        console.log('On-chain verification:');
        console.log(`  Account size:  ${d.length} bytes`);
        console.log(`  Vault share:   ${vault} bps (${vault / 100}%)`);
        console.log(`  Staking share: ${staking} bps (${staking / 100}%)`);
        console.log(`  Default fund:  ${defaultFund} bps (${defaultFund / 100}%)`);
        console.log(`  CCP equity:    ${ccpEquity} bps (${ccpEquity / 100}%)`);
      }
    }
  } catch (err: any) {
    console.error('Transaction failed:', err.message || err);
    if (err.logs) console.error('Logs:', err.logs.slice(-10).join('\n'));
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
