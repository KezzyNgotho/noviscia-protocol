/**
 * noviscia-clearing devnet proof script.
 *
 * Part A — Full settlement loop (instant): create a manual market, bet both
 *   sides, verify fees + state-hash chain, cancel, refund both positions, then
 *   sweep the collected fees into the nv-usdc-vault NAV. Proves the clr-config
 *   fee authority end-to-end: 15% → default fund, 2.5% → CCP equity, remainder
 *   → LP NAV via accumulate_protocol_fees(FEE_TYPE_PREDICTION).
 *
 * Part B — Resolution lifecycle (timelock-bound): create a manual market, bet
 *   both sides, wait for end_time, propose a creator resolution, dispute it
 *   (permissionless), re-propose. confirm_resolution + claim_winnings are
 *   gated by the 1h resolution timelock, so they run in a follow-up pass:
 *     npx tsx scripts/e2e/e2e-clearing-devnet.ts --confirm <market>
 *
 * Run: npx tsx scripts/e2e/e2e-clearing-devnet.ts
 */
import { AnchorProvider, Program, Wallet, BN } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  createMintToInstruction,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const ROOT = path.resolve(__dirname, '../..');
const RPC = process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com';
const CLEARING_PROGRAM_ID = new PublicKey('GtTJWLa6MXjZoNucGHWVnE9LpZTw6Dsr5K1gxpM1Q4fe');
const NV_USDC_VAULT_PROGRAM_ID = new PublicKey('CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC');
const USDC_MINT = new PublicKey('Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5');
const USDC_DECIMALS = 6;
const ZERO32 = Array(32).fill(0);
const USERS_FILE = path.join(ROOT, '.cache/e2e-clearing-users.json');

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

function loadKeypair(filePath: string): Keypair {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(resolved, 'utf-8'))));
}

function resolveAdminKeypair(): Keypair {
  const candidates = [process.env.ADMIN_KEYPAIR_PATH, process.env.ANCHOR_WALLET, path.join(require('os').homedir(), '.config/solana/new-id.json')];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return loadKeypair(p);
  }
  throw new Error('No admin keypair found (tried ADMIN_KEYPAIR_PATH, ANCHOR_WALLET, ~/.config/solana/new-id.json)');
}

async function usdcBalance(connection: Connection, ata: PublicKey): Promise<bigint> {
  try {
    const info = await getAccount(connection, ata, 'confirmed');
    return info.amount;
  } catch {
    return 0n;
  }
}

async function mintUsdc(connection: Connection, admin: Keypair, to: PublicKey, amountUsdc: number) {
  const ata = getAssociatedTokenAddressSync(USDC_MINT, to);
  const tx = new Transaction();
  if (!(await connection.getAccountInfo(ata))) {
    tx.add(createAssociatedTokenAccountInstruction(admin.publicKey, ata, to, USDC_MINT));
  }
  tx.add(createMintToInstruction(USDC_MINT, ata, admin.publicKey, BigInt(Math.floor(amountUsdc * 10 ** USDC_DECIMALS))));
  const sig = await sendAndConfirmTransaction(connection, tx, [admin]);
  return { sig, ata };
}

// ── state-hash chain (mirrors programs/noviscia-clearing/src/state.rs) ──
const STATE_HASH_DOMAIN = Buffer.from('noviscia-clear-state-v1');
const RESOLUTION_HASH_DOMAIN = Buffer.from('noviscia-clear-resolution-v1');

function positionStateHash(
  user: PublicKey, market: PublicKey, outcomeId: number,
  amount: bigint, grossAmount: bigint, odds: bigint, previousHash: Uint8Array,
): Uint8Array {
  const buf = Buffer.concat([
    STATE_HASH_DOMAIN,
    user.toBuffer(), market.toBuffer(),
    Buffer.from([outcomeId]),
    u64le(amount), u64le(grossAmount), u64le(odds),
    Buffer.from(previousHash),
  ]);
  return Uint8Array.from(createHash('sha256').update(buf).digest());
}

function resolutionProofHash(
  market: PublicKey, proposedOutcome: number, referencePrice: bigint,
  proposedAt: bigint, feedId: Uint8Array,
): Uint8Array {
  const buf = Buffer.concat([
    RESOLUTION_HASH_DOMAIN,
    market.toBuffer(),
    Buffer.from([proposedOutcome]),
    u64le(referencePrice), u64le(proposedAt),
    Buffer.from(feedId),
  ]);
  return Uint8Array.from(createHash('sha256').update(buf).digest());
}

function u64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
}

function getMarketPda(creator: PublicKey, endTime: number | BN): PublicKey {
  const t = BN.isBN(endTime) ? endTime : new BN(endTime);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('market'), creator.toBuffer(), t.toArrayLike(Buffer, 'le', 8)],
    CLEARING_PROGRAM_ID
  )[0];
}

function getPositionPda(user: PublicKey, market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('position'), user.toBuffer(), market.toBuffer()],
    CLEARING_PROGRAM_ID
  )[0];
}

async function fetchMarket(program: Program, market: PublicKey) {
  return (program.account as any).market.fetch(market) as Promise<Record<string, any>>;
}

async function main() {
  const admin = resolveAdminKeypair();
  const connection = new Connection(RPC, 'confirmed');
  const provider = new AnchorProvider(connection, new Wallet(admin), { commitment: 'confirmed' });
  const idl = JSON.parse(fs.readFileSync(path.join(ROOT, 'target/idl/noviscia_clearing.json'), 'utf-8'));
  const program = new Program(idl, provider);

  const [clearingConfig] = PublicKey.findProgramAddressSync([Buffer.from('clr-config')], CLEARING_PROGRAM_ID);
  const [timelockedAdmin] = PublicKey.findProgramAddressSync([Buffer.from('timelocked-admin')], CLEARING_PROGRAM_ID);
  const [vaultConfig] = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-config'), USDC_MINT.toBuffer()], NV_USDC_VAULT_PROGRAM_ID);
  const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-authority'), USDC_MINT.toBuffer()], NV_USDC_VAULT_PROGRAM_ID);
  const vaultUsdc = getAssociatedTokenAddressSync(USDC_MINT, vaultAuthority, true);
  const feeStaging = getAssociatedTokenAddressSync(USDC_MINT, clearingConfig, true);

  console.log('admin            :', admin.publicKey.toBase58());
  console.log('clearing         :', CLEARING_PROGRAM_ID.toBase58());
  console.log('clr-config       :', clearingConfig.toBase58());
  console.log('timelocked-admin :', timelockedAdmin.toBase58());
  console.log('vault_config     :', vaultConfig.toBase58());
  console.log('vault_usdc       :', vaultUsdc.toBase58());

  if (process.argv[2] === '--confirm') {
    await confirmMode(program, connection, admin, process.argv[3]);
    return;
  }

  // ─────────────────────────── Part A ───────────────────────────
  console.log('\n=== Part A — full settlement loop: create → bet → cancel → refund → fee sweep ===');

  const userA = Keypair.generate();
  const userB = Keypair.generate();
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify({ a: Array.from(userA.secretKey), b: Array.from(userB.secretKey) }));

  for (const u of [userA, userB]) {
    const sig = await connection.requestAirdrop(u.publicKey, 10_000_000_000).catch(() => undefined);
    if (sig) {
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if ((await connection.getBalance(u.publicKey)) > 0) break;
      }
    }
    await mintUsdc(connection, admin, u.publicKey, 1_000);
  }
  check('test users funded (SOL + USDC)', true, `${userA.publicKey.toBase58().slice(0, 6)}, ${userB.publicKey.toBase58().slice(0, 6)}`);

  const now = Math.floor(Date.now() / 1000);
  const marketA = getMarketPda(admin.publicKey, now + 300);
  const marketVaultA = getAssociatedTokenAddressSync(USDC_MINT, marketA, true);
  const vaultUsdcBefore = await usdcBalance(connection, vaultUsdc);

  console.log(`\n[1] create_market (manual) — ${marketA.toBase58()}`);
  {
    const sig = await program.methods
      .createMarket('e2e clearing settle loop', 'manual market for e2e proof', 'e2e',
        new BN(now + 300),
        [{ name: 'Yes', probability: 50 }, { name: 'No', probability: 50 }],
        200, ZERO32, new BN(0))
      .accounts({
        creator: admin.publicKey, clearingConfig, market: marketA, marketVault: marketVaultA,
        usdcMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      } as any)
      .rpc();
    const m = await fetchMarket(program, marketA);
    check('create_market ok', Object.keys(m.status)[0] === 'active', sig.slice(0, 8));
  }

  console.log('\n[2] place_bet both sides (100 USDC each, 200bps fee)');
  const betAmount = 100n * 10n ** 6n;
  for (const [user, outcomeId] of [[userA, 0], [userB, 1]] as [Keypair, number][]) {
    const userUsdc = getAssociatedTokenAddressSync(USDC_MINT, user.publicKey);
    const sig = await program.methods
      .placeBet(outcomeId, new BN(betAmount.toString()))
      .accounts({
        user: user.publicKey, market: marketA, userPosition: getPositionPda(user.publicKey, marketA),
        userTokenAccount: userUsdc, marketVault: marketVaultA,
        usdcMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      } as any)
      .signers([user])
      .rpc();
    check(`place_bet user ${outcomeId === 0 ? 'A' : 'B'} (outcome ${outcomeId})`, true, sig.slice(0, 8));
  }

  const mktA1 = await fetchMarket(program, marketA);
  const feesCollected = BigInt(mktA1.feesCollected.toString());
  const expectFees = 2n * (betAmount * 200n / 10_000n); // 4 USDC
  check('market vault holds 200 USDC gross', (await usdcBalance(connection, marketVaultA)) === 2n * betAmount,
    `${Number(await usdcBalance(connection, marketVaultA)) / 10 ** USDC_DECIMALS} USDC`);
  check('fees_collected = 4 USDC (2 bets × 2%)', feesCollected === expectFees, `${Number(feesCollected) / 10 ** USDC_DECIMALS} USDC`);
  check('participants = 2', Number(mktA1.participants) === 2);

  console.log('   verifying SHA-256 state-hash chains…');
  for (const [user, outcomeId] of [[userA, 0], [userB, 1]] as [Keypair, number][]) {
    const pos = await (program.account as any).userPosition.fetch(getPositionPda(user.publicKey, marketA));
    const amount = BigInt(pos.amount.toString());
    const gross = BigInt(pos.grossAmount.toString());
    const odds = BigInt(pos.odds.toString());
    const expected = positionStateHash(user.publicKey, marketA, outcomeId, amount, gross, odds, new Uint8Array(32));
    const stored = Uint8Array.from(pos.stateHash as number[]);
    const netExpected = betAmount - betAmount * 200n / 10_000n;
    check(`position ${user.publicKey.toBase58().slice(0, 6)} hash chain valid (net=${Number(netExpected) / 10 ** 6} USDC, odds=${odds})`,
      Buffer.from(expected).equals(Buffer.from(stored)));
  }

  console.log('\n[3] cancel_market (creator)');
  {
    const sig = await program.methods.cancelMarket()
      .accounts({ caller: admin.publicKey, market: marketA, timelockedAdmin } as any).rpc();
    const m = await fetchMarket(program, marketA);
    check('status → Cancelled', Object.keys(m.status)[0] === 'cancelled', sig.slice(0, 8));
  }

  console.log('\n[4] claim_refund both users (gross incl. fee)');
  for (const user of [userA, userB]) {
    const userUsdc = getAssociatedTokenAddressSync(USDC_MINT, user.publicKey);
    const before = await usdcBalance(connection, userUsdc);
    const sig = await program.methods.claimRefund()
      .accounts({
        user: user.publicKey, market: marketA, userPosition: getPositionPda(user.publicKey, marketA),
        userTokenAccount: userUsdc, marketVault: marketVaultA, usdcMint: USDC_MINT,
        tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      } as any)
      .signers([user]).rpc();
    const after = await usdcBalance(connection, userUsdc);
    check(`refund ${user.publicKey.toBase58().slice(0, 6)} = 100 USDC gross`, after - before === betAmount, sig.slice(0, 8));
  }
  check('market vault now holds only fees', (await usdcBalance(connection, marketVaultA)) === feesCollected,
    `${Number(await usdcBalance(connection, marketVaultA)) / 10 ** USDC_DECIMALS} USDC`);

  console.log('\n[5] withdraw_fees → vault NAV sweep (clr-config authority)');
  {
    const sig = await program.methods.withdrawFees()
      .accounts({
        clearingConfig, market: marketA, marketVault: marketVaultA, feeStaging,
        nvUsdcVaultProgram: NV_USDC_VAULT_PROGRAM_ID, vaultConfig, vaultUsdc,
        usdcMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .rpc();
    check('withdraw_fees ok', true, sig.slice(0, 8));
  }
  const mktA3 = await fetchMarket(program, marketA);
  const vaultUsdcAfter = await usdcBalance(connection, vaultUsdc);
  const defaultFundCut = feesCollected * 1500n / 10_000n;
  const ccpEquityCut = feesCollected * 250n / 10_000n;
  const netSweep = feesCollected - defaultFundCut - ccpEquityCut;
  check('fees_collected zeroed', BigInt(mktA3.feesCollected.toString()) === 0n);
  check('market vault drained', (await usdcBalance(connection, marketVaultA)) === 0n);
  check('vault_usdc grew by net sweep (82.5% of 4 USDC)',
    vaultUsdcAfter - vaultUsdcBefore === netSweep,
    `+${Number(vaultUsdcAfter - vaultUsdcBefore) / 10 ** 6} USDC (default fund ${Number(defaultFundCut) / 10 ** 6}, ccp equity ${Number(ccpEquityCut) / 10 ** 6})`);
  check('fee_staging back to 0 (in-then-out atomic)', (await usdcBalance(connection, feeStaging)) === 0n);

  // ─────────────────────────── Part B ───────────────────────────
  console.log('\n=== Part B — resolution lifecycle: propose → dispute → re-propose ===');

  const endTimeB = now + 60;
  const marketB = getMarketPda(admin.publicKey, endTimeB);
  const marketVaultB = getAssociatedTokenAddressSync(USDC_MINT, marketB, true);

  {
    const sig = await program.methods
      .createMarket('e2e clearing resolution', 'resolution lifecycle proof', 'e2e',
        new BN(endTimeB),
        [{ name: 'Yes', probability: 50 }, { name: 'No', probability: 50 }],
        200, ZERO32, new BN(0))
      .accounts({
        creator: admin.publicKey, clearingConfig, market: marketB, marketVault: marketVaultB,
        usdcMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      } as any)
      .rpc();
    check('create_market (B) ok', true, sig.slice(0, 8));
  }

  for (const [user, outcomeId] of [[userA, 0], [userB, 1]] as [Keypair, number][]) {
    const userUsdc = getAssociatedTokenAddressSync(USDC_MINT, user.publicKey);
    await program.methods.placeBet(outcomeId, new BN((50n * 10n ** 6n).toString()))
      .accounts({
        user: user.publicKey, market: marketB, userPosition: getPositionPda(user.publicKey, marketB),
        userTokenAccount: userUsdc, marketVault: marketVaultB,
        usdcMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      } as any)
      .signers([user]).rpc();
  }
  check('bets placed on B (both sides)', true);

  console.log(`\n[6] waiting until end_time (${new Date(endTimeB * 1000).toISOString()}) passes…`);
  while (Math.floor(Date.now() / 1000) < endTimeB + 2) {
    await new Promise((r) => setTimeout(r, 2000));
  }

  const [resolutionProofB] = PublicKey.findProgramAddressSync([Buffer.from('resolution'), marketB.toBuffer()], CLEARING_PROGRAM_ID);

  console.log('[7] resolve_market (creator, manual)');
  {
    const sig = await program.methods.resolveMarket(1, [], [], 0)
      .accounts({
        proposer: admin.publicKey, clearingConfig, market: marketB, resolutionProof: resolutionProofB,
        timelockedAdmin, systemProgram: SystemProgram.programId,
      } as any)
      .rpc();
    const m = await fetchMarket(program, marketB);
    check('status → ResolutionProposed', Object.keys(m.status)[0] === 'resolutionProposed', sig.slice(0, 8));
    const proof = await (program.account as any).resolutionProof.fetch(resolutionProofB);
    const proposedAt = BigInt(proof.proposedAt.toString());
    const confirmAfter = BigInt(proof.confirmAfter.toString());
    const expected = resolutionProofHash(marketB, 1, 0n, proposedAt, Uint8Array.from(proof.feedId as number[]));
    check('proposed_outcome = 1 (No)', proof.proposedOutcome === 1);
    check('confirm_after = proposed_at + 3600', confirmAfter - proposedAt === 3600n);
    check('proof hash chain valid', Buffer.from(expected).equals(Buffer.from(Uint8Array.from(proof.proofHash as number[]))));
  }

  console.log('[8] dispute_resolution (permissionless)');
  {
    const sig = await program.methods.disputeResolution()
      .accounts({ caller: userA.publicKey, market: marketB, resolutionProof: resolutionProofB } as any)
      .signers([userA]).rpc();
    const m = await fetchMarket(program, marketB);
    check('status → Active', Object.keys(m.status)[0] === 'active', sig.slice(0, 8));
    const proof = await (program.account as any).resolutionProof.fetch(resolutionProofB);
    check('proof cleared (confirm_after = 0)', Number(proof.confirmAfter.toString()) === 0);
  }

  console.log('[9] re-resolve (fresh proposal restarts timelock)');
  {
    const sig = await program.methods.resolveMarket(0, [], [], 0)
      .accounts({
        proposer: admin.publicKey, clearingConfig, market: marketB, resolutionProof: resolutionProofB,
        timelockedAdmin, systemProgram: SystemProgram.programId,
      } as any)
      .rpc();
    const m = await fetchMarket(program, marketB);
    check('status → ResolutionProposed again', Object.keys(m.status)[0] === 'resolutionProposed', sig.slice(0, 8));
    const proof = await (program.account as any).resolutionProof.fetch(resolutionProofB);
    check('proposed_outcome = 0 (Yes)', proof.proposedOutcome === 0);
    const confirmAfter = Number(proof.confirmAfter.toString());
    console.log(`\n  confirm_resolution becomes valid at ${new Date(confirmAfter * 1000).toISOString()}`);
    console.log(`  then confirm + claim + sweep via: npx tsx scripts/e2e/e2e-clearing-devnet.ts --confirm ${marketB.toBase58()}`);
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

async function confirmMode(program: Program, connection: Connection, admin: Keypair, marketArg: string) {
  if (!marketArg) throw new Error('--confirm requires <market address>');
  const market = new PublicKey(marketArg);
  const [resolutionProof] = PublicKey.findProgramAddressSync([Buffer.from('resolution'), market.toBuffer()], CLEARING_PROGRAM_ID);
  const [clearingConfig] = PublicKey.findProgramAddressSync([Buffer.from('clr-config')], CLEARING_PROGRAM_ID);
  const [vaultConfig] = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-config'), USDC_MINT.toBuffer()], NV_USDC_VAULT_PROGRAM_ID);
  const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-authority'), USDC_MINT.toBuffer()], NV_USDC_VAULT_PROGRAM_ID);
  const vaultUsdc = getAssociatedTokenAddressSync(USDC_MINT, vaultAuthority, true);
  const feeStaging = getAssociatedTokenAddressSync(USDC_MINT, clearingConfig, true);
  const marketVault = getAssociatedTokenAddressSync(USDC_MINT, market, true);

  const users = fs.existsSync(USERS_FILE)
    ? JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'))
    : null;

  const m = await fetchMarket(program, market);
  check('market is ResolutionProposed', Object.keys(m.status)[0] === 'resolutionProposed');
  const proof = await (program.account as any).resolutionProof.fetch(resolutionProof);
  const winning = proof.proposedOutcome;
  const confirmAfter = Number(proof.confirmAfter.toString());
  check('timelock elapsed', Math.floor(Date.now() / 1000) >= confirmAfter,
    `confirm_after=${new Date(confirmAfter * 1000).toISOString()}`);
  if (fail > 0) { console.log('timelock not elapsed — run again later.'); process.exit(1); }

  console.log('[confirm] confirm_resolution');
  {
    const sig = await program.methods.confirmResolution()
      .accounts({ caller: admin.publicKey, market, resolutionProof } as any).rpc();
    const m2 = await fetchMarket(program, market);
    check('status → Resolved', Object.keys(m2.status)[0] === 'resolved', sig.slice(0, 8));
    check('winning_outcome recorded', Number(m2.winningOutcome.toString()) === winning);
  }

  console.log('[claim] claim winnings for persisted test users');
  if (users) {
    for (const key of ['a', 'b']) {
      const user = Keypair.fromSecretKey(Uint8Array.from(users[key]));
      const pos = await (program.account as any).userPosition.fetch(getPositionPda(user.publicKey, market)).catch(() => null);
      if (!pos) { console.log(`  (skip — no position for ${user.publicKey.toBase58().slice(0, 6)})`); continue; }
      const userUsdc = getAssociatedTokenAddressSync(USDC_MINT, user.publicKey);
      const before = await usdcBalance(connection, userUsdc);
      const sig = await program.methods.claimWinnings()
        .accounts({
          user: user.publicKey, market, userPosition: getPositionPda(user.publicKey, market),
          userTokenAccount: userUsdc, marketVault, usdcMint: USDC_MINT,
          tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        } as any)
        .signers([user]).rpc();
      const after = await usdcBalance(connection, userUsdc);
      const paid = pos.outcomeId === winning;
      check(`claim ${user.publicKey.toBase58().slice(0, 6)} (outcome ${pos.outcomeId}${paid ? ' = WINNER' : ''})`,
        paid ? after - before === BigInt(pos.potentialReturn.toString()) : after === before, sig.slice(0, 8));
    }
  }

  console.log('[sweep] withdraw remaining fees');
  {
    const marketInfo = await fetchMarket(program, market);
    if (BigInt(marketInfo.feesCollected.toString()) > 0n) {
      const sig = await program.methods.withdrawFees()
        .accounts({
          clearingConfig, market, marketVault, feeStaging, nvUsdcVaultProgram: NV_USDC_VAULT_PROGRAM_ID,
          vaultConfig, vaultUsdc, usdcMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .rpc();
      check('withdraw_fees ok', true, sig.slice(0, 8));
    } else {
      check('no fees to sweep (already withdrawn)', true);
    }
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
