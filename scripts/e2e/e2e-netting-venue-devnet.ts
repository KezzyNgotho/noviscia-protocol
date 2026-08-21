/**
 * Verify the CCP netting ledger end-to-end on devnet:
 *   create an event market → place a bet → confirm the bet was novated into
 *   the netting engine (venue #1, event) as a `NetPosition` + HouseBook
 *   exposure. Proves the "Multilateral Netting & Novation" box is live.
 *
 * Run: NODE_OPTIONS="--dns-result-order=ipv4first" npx tsx scripts/e2e/e2e-netting-venue-devnet.ts
 * Signer: the deployer wallet (creates market + mints USDC + pays for bets).
 */
import { AnchorProvider, Program, Wallet, BN } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createMintToInstruction,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import { ipv4Connection } from '../utils/ipv4-fetch';

const ROOT = path.resolve(__dirname, '../..');
const RPC = process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com';
const CLEARING_PID = new PublicKey('GtTJWLa6MXjZoNucGHWVnE9LpZTw6Dsr5K1gxpM1Q4fe');
const NETTING_PID = new PublicKey('68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56');
const USDC_MINT = new PublicKey('Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5');
const USDC_DECIMALS = 6;
const ZERO32 = Array(32).fill(0);

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail += 1; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

function loadKeypair(filePath: string): Keypair {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(resolved, 'utf-8'))));
}
function resolveAdminKeypair(): Keypair {
  const candidates = [process.env.ADMIN_KEYPAIR_PATH, process.env.ANCHOR_WALLET, path.join(require('os').homedir(), '.config/solana/new-id.json')];
  for (const p of candidates) if (p && fs.existsSync(p)) return loadKeypair(p);
  throw new Error('No admin keypair found');
}

function getMarketPda(creator: PublicKey, endTime: number | BN): PublicKey {
  const t = BN.isBN(endTime) ? endTime : new BN(endTime);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('market'), creator.toBuffer(), t.toArrayLike(Buffer, 'le', 8)], CLEARING_PID)[0];
}
function getPositionPda(user: PublicKey, market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('position'), user.toBuffer(), market.toBuffer()], CLEARING_PID)[0];
}

async function usdcBalance(connection: Connection, ata: PublicKey): Promise<bigint> {
  try { return (await import('@solana/spl-token')).getAccount(connection, ata, 'confirmed').then(i => i.amount); }
  catch { return 0n; }
}

async function mintUsdc(connection: Connection, admin: Keypair, to: PublicKey, amountUsdc: number) {
  const ata = getAssociatedTokenAddressSync(USDC_MINT, to);
  const tx = new Transaction();
  if (!(await connection.getAccountInfo(ata))) {
    tx.add(createAssociatedTokenAccountInstruction(admin.publicKey, ata, to, USDC_MINT));
  }
  tx.add(createMintToInstruction(USDC_MINT, ata, admin.publicKey, BigInt(Math.floor(amountUsdc * 10 ** USDC_DECIMALS))));
  await sendAndConfirmTransaction(connection, tx, [admin]);
  return ata;
}

async function main() {
  const admin = resolveAdminKeypair();
  const connection = ipv4Connection(RPC);
  const provider = new AnchorProvider(connection, new Wallet(admin), { commitment: 'confirmed' });

  const clrIdl = JSON.parse(fs.readFileSync(path.join(ROOT, 'target/idl/noviscia_clearing.json'), 'utf-8'));
  const netIdl = JSON.parse(fs.readFileSync(path.join(ROOT, 'target/idl/netting_engine.json'), 'utf-8'));
  const clr = new Program(clrIdl, provider);
  const net = new Program(netIdl, provider);

  const [clearingConfig] = PublicKey.findProgramAddressSync([Buffer.from('clr-config')], CLEARING_PID);
  const [nettingConfig] = PublicKey.findProgramAddressSync([Buffer.from('config')], NETTING_PID);
  const [nettingHouseBook] = PublicKey.findProgramAddressSync([Buffer.from('housebook')], NETTING_PID);
  const [nettingVenue] = PublicKey.findProgramAddressSync([Buffer.from('venue'), Buffer.from([1])], NETTING_PID);

  // A funded trader (fresh keypair each run). Fund SOL from the admin wallet —
  // the devnet airdrop faucet is rate-limited — then mint USDC.
  const trader = Keypair.generate();
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: trader.publicKey, lamports: 500_000_000 })
    ),
    [admin],
  );
  await mintUsdc(connection, admin, trader.publicKey, 500);

  const [nettingPosition] = PublicKey.findProgramAddressSync(
    [Buffer.from('position'), nettingVenue.toBuffer(), trader.publicKey.toBuffer()], NETTING_PID);

  console.log('clearing_config   :', clearingConfig.toBase58());
  console.log('netting_config    :', nettingConfig.toBase58());
  console.log('netting_venue #1  :', nettingVenue.toBase58());
  console.log('netting_house_book:', nettingHouseBook.toBase58());
  console.log('trader            :', trader.publicKey.toBase58());
  console.log('netting_position  :', nettingPosition.toBase58());

  const cfgRaw = await net.account.nettingConfig.fetch(nettingConfig);
  const venueRaw = await net.account.venue.fetch(nettingVenue);
  check('venue #1 owner_authority == clr-config', venueRaw.ownerAuthority.toBase58() === clearingConfig.toBase58(),
    `kind ${Number(venueRaw.kind)} (1=event)`);

  const now = Math.floor(Date.now() / 1000);
  const endTimeBn = new BN(now + 300);
  const market = getMarketPda(admin.publicKey, endTimeBn);
  const marketVault = getAssociatedTokenAddressSync(USDC_MINT, market, true);
  const userUsdc = getAssociatedTokenAddressSync(USDC_MINT, trader.publicKey);
  console.log('  end_time :', endTimeBn.toString(), '| market :', market.toBase58());

  console.log(`\n[1] create_market — ${market.toBase58()}`);
  await clr.methods
    .createMarket('ccp netting verify', 'novation ledger e2e', 'e2e',
      endTimeBn,
      [{ name: 'Yes', probability: 50 }, { name: 'No', probability: 50 }],
      200, ZERO32, new BN(0))
    .accountsStrict({
      creator: admin.publicKey, clearingConfig, market, marketVault,
      usdcMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    } as any)
    .rpc();
  check('create_market ok', (await connection.getAccountInfo(market)) !== null);

  console.log(`\n[2] place_bet (100 USDC on outcome 0) → should novate into netting venue #1`);
  const betAmount = 100n * 10n ** 6n;
  await clr.methods
    .placeBet(0, new BN(betAmount.toString()))
    .accountsStrict({
      user: trader.publicKey, market, userPosition: getPositionPda(trader.publicKey, market),
      userTokenAccount: userUsdc, marketVault,
      usdcMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      clearingConfig,
      nettingConfig, nettingVenue, nettingPosition, nettingHouseBook, nettingProgram: NETTING_PID,
    } as any)
    .signers([trader])
    .rpc();
  check('place_bet ok (tx confirmed)', true);

  console.log('\n[3] read back the netting ledger');
  const pos = await net.account.netPosition.fetch(nettingPosition);
  const netNotional = BigInt(pos.netNotionalUsdc.toString());
  const gross = BigInt(pos.grossNotionalUsdc.toString());
  check('netting NetPosition.net_notional == +100 USDC (long side 0)', netNotional === betAmount,
    `${Number(netNotional) / 10 ** USDC_DECIMALS} USDC`);
  check('NetPosition.gross_notional == 100 USDC', gross === betAmount,
    `${Number(gross) / 10 ** USDC_DECIMALS} USDC`);

  const book = await net.account.houseBook.fetch(nettingHouseBook);
  const totalNet = BigInt(book.totalNetUsdc.toString());
  const totalGross = BigInt(book.totalGrossUsdc.toString());
  check('HouseBook.total_net == +100 USDC', totalNet === betAmount,
    `${Number(totalNet) / 10 ** USDC_DECIMALS} USDC`);
  check('HouseBook.total_gross == 100 USDC', totalGross === betAmount,
    `${Number(totalGross) / 10 ** USDC_DECIMALS} USDC`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
