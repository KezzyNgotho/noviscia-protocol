/**
 * Devnet e2e proof for the Jit-Risk Time-Slice Marketplace (TVV yield stack).
 *
 * Reproduces the §11.4 demo table of docs/TVV_FINANCIAL_ENGINEERING.md:
 *   pool $100k, floor $20k, ψ=25% (writable base $80k → cap $20k), δ̅=4e-9.
 *
 *  1. risk_initialize_marketplace (admin) — MarketplaceState + USDC vault
 *  2. seed the pool vault with $100k (off-chain transfer, = insurance fund capital)
 *  3. register two desks (MMs) with per-MM credit ceilings
 *  4. risk_rent_slice  $10k @ δ=4e-9 → premium exactly $0.00004 (atomic, same-slot)
 *  5. risk_reserve_slice $10k @ δ=4e-9, collateral C=$11k (110% haircut)
 *  6. risk_settle_slice profit  → full C released back to the desk
 *  7. risk_reserve_slice $10k + settle adversarial −$13k
 *        → C forfeited ($11k), residual $2k → pool absorbs min(10%·A, residual) = $1k
 *        → loss ratio >> 8000bps → marketplace AUTO-FREEZES
 *  8. risk_unfreeze (admin), risk_sweep_premiums → 85/15 NAV/backstop split
 *  9. risk_suspend_mm desk_B → further risk_reserve_slice REJECTED
 * 10. final ledger assertions on-chain
 *
 * Usage: npx tsx scripts/e2e/e2e-jit-risk-devnet.ts
 */
import 'dotenv/config';
import * as anchor from '@coral-xyz/anchor';
import { BN, Program } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  mintTo, transfer, getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

import { JitRiskClient } from '../../sdk/src/jitRisk';
import { USDC_MINT } from '../../sdk/src/ids';

const ROOT = path.resolve(__dirname, '../..');
const RPC = process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com';

const USDC_DECIMALS = 6;
const usd = (n: number) => n * 10 ** USDC_DECIMALS; // dollars → raw units

function loadKp(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf-8'))));
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function reserveAndSettle(
  jr: JitRiskClient,
  conn: Connection,
  mm: Keypair,
  amount: number,
  delta: BN,
  pnl: number,
): Promise<void> {
  const devnetHiccup = (msg: string) =>
    /Unknown action|Blockhash not found|TransactionExpired|Simulation failed|fetch failed|typeerror/i.test(msg);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slot = (await conn.getSlot()) + 4;
    const receiptPda = jr.receipt(mm.publicKey, slot);
    try {
      await jr.riskReserveSlice(mm.publicKey, amount, delta, slot, mm).rpc();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (!devnetHiccup(msg)) throw e;
      // Send glitch: if the receipt actually landed, keep going; else retry fresh.
      if (!(await conn.getAccountInfo(receiptPda))) {
        console.log(`  • send hiccup on reserve, fresh slot retry (${attempt + 1}/5)`);
        continue;
      }
    }
    try {
      await jr.riskSettleSlice(mm.publicKey, slot, pnl).rpc();
      return;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (/ReceiptExpired|stale|aged/i.test(msg)) {
        // Aged out of the freshness window: reap (permissionless; unwinds
        // outstanding + collateral; absorb is 0 here since A < C) and retry.
        await jr.riskReapExpiredSlice(mm.publicKey, slot).rpc();
        console.log(`  • reaped stale receipt @ slot ${slot}, retrying (${attempt + 1}/5)`);
        continue;
      }
      if (devnetHiccup(msg)) {
        // Landed-or-not ambiguity: reap if it exists so the ledger stays clean.
        if (await conn.getAccountInfo(receiptPda)) {
          await jr.riskReapExpiredSlice(mm.publicKey, slot).rpc().catch(() => {});
        }
        console.log(`  • send hiccup on settle, fresh slot retry (${attempt + 1}/5)`);
        continue;
      }
      throw e;
    }
  }
  throw new Error(`reserve+settle did not land within 5 attempts (pnl=${pnl})`);
}

async function main() {
  const admin = loadKp(path.join(process.env.HOME!, '.config/solana/new-id.json'));
  const desksFile = path.join(ROOT, 'scripts/e2e/.desks.json');
  let deskA: Keypair, deskB: Keypair;
  if (fs.existsSync(desksFile)) {
    const pairs = JSON.parse(fs.readFileSync(desksFile, 'utf-8'));
    deskA = Keypair.fromSecretKey(Uint8Array.from(pairs.deskA));
    deskB = Keypair.fromSecretKey(Uint8Array.from(pairs.deskB));
  } else {
    deskA = new Keypair();
    deskB = new Keypair();
    fs.writeFileSync(desksFile, JSON.stringify({ deskA: [...deskA.secretKey], deskB: [...deskB.secretKey] }, null, 2));
  }
  const conn = new Connection(RPC, 'confirmed');
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(admin), { commitment: 'confirmed' });

  const idl = JSON.parse(fs.readFileSync(path.join(ROOT, 'target/idl/noviscia_capacity.json'), 'utf-8'));
  const program = new Program(idl, provider) as Program;
  const jr = new JitRiskClient(program, { usdcMint: USDC_MINT });
  const marketplacePda = jr.marketplace();
  const vaultPda = jr.usdcVault();

  console.log(`Admin:        ${admin.publicKey.toBase58()}`);
  console.log(`Marketplace:  ${marketplacePda.toBase58()}`);
  console.log(`USDC vault:   ${vaultPda.toBase58()}`);
  console.log(`USDC mint:    ${USDC_MINT.toBase58()}`);
  console.log(`Desk A:       ${deskA.publicKey.toBase58()}`);
  console.log(`Desk B:       ${deskB.publicKey.toBase58()}`);

  // ── USDC harness: the devnet protocol USDC (admin is mint authority) ──────
  const adminUsdc = await getOrCreateAssociatedTokenAccount(conn, admin, USDC_MINT, admin.publicKey);
  const deskAUsdc = await getOrCreateAssociatedTokenAccount(conn, admin, USDC_MINT, deskA.publicKey);
  const deskBUsdc = await getOrCreateAssociatedTokenAccount(conn, admin, USDC_MINT, deskB.publicKey);
  await mintTo(conn, admin, USDC_MINT, adminUsdc.address, admin.publicKey, usd(300_000));
  await mintTo(conn, admin, USDC_MINT, deskAUsdc.address, admin.publicKey, usd(100_000));
  await mintTo(conn, admin, USDC_MINT, deskBUsdc.address, admin.publicKey, usd(100_000));

  // Desks need ~0.0015 SOL each: risk_reserve_slice pays rent for the receipt PDA
  // out of the mm signer's lamports (faucet is per-IP throttled, so fund from admin).
  const deskSol = 0.01 * 1e9;
  for (const d of [deskA, deskB]) {
    const bal = await conn.getBalance(d.publicKey);
    if (bal < deskSol) {
      const transferLamports = deskSol - bal;
      if (transferLamports > 0) {
        await conn.sendTransaction(
          new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: admin.publicKey,
              toPubkey: d.publicKey,
              lamports: transferLamports,
            })
          ),
          [admin],
        );
      }
    }
  }

  // ── 1. initialize_marketplace ──────────────────────────────────────────────
  if (!(await conn.getAccountInfo(marketplacePda))) {
    await jr.riskInitializeMarketplace({
      authority: admin.publicKey,
      insuranceFundFloorUsdc: usd(20_000),
      writableBps: 2500,
      riskBudgetBps: 1000,
      maxSliceUsdc: usd(50_000),
      maxSlotAge: 8,
      deltaMinWad: 4000,
      deltaMaxWad: 8000,
      premiumMin: 1,
    }).rpc();
  }
  console.log('✓ risk_initialize_marketplace');

  // ── 2. seed the pool vault ($100k = insurance fund capital parked) ─────────
  const vaultAmount = Number((await conn.getTokenAccountBalance(vaultPda)).value.amount);
  if (vaultAmount < usd(100_000)) {
    await transfer(conn, admin, adminUsdc.address, vaultPda, admin.publicKey, usd(100_000) - vaultAmount);
  }
  const vaultAmountFinal = Number((await conn.getTokenAccountBalance(vaultPda)).value.amount);
  assert(vaultAmountFinal >= usd(100_000), `pool vault must hold ≥ $100k (holds ${vaultAmountFinal})`);
  console.log(`✓ pool vault seeded: $${(vaultAmountFinal / 1e6).toLocaleString()}`);

  const mp0 = await jr.getMarketplace();
  console.log(`  writable base = vault($${(vaultAmountFinal / 1e6)})-floor($${(Number(mp0.insuranceFundFloorUsdc) / 1e6)}) → cap = 25% of $80k = $20k`);

  // Resumable across runs: clear any freeze left by a previous interrupted run.
  if (mp0.frozen) {
await jr.riskUnfreeze().rpc();
    console.log('• unfroze marketplace left over from a previous run');
  }

  // ── 3. register two desks (idempotent across reruns) ──────────────────────
  if (!(await conn.getAccountInfo(jr.mmRegistration(deskA.publicKey)))) {
    await jr.riskRegisterMm(deskA.publicKey, usd(20_000)).rpc();
  }
  if (!(await conn.getAccountInfo(jr.mmRegistration(deskB.publicKey)))) {
    await jr.riskRegisterMm(deskB.publicKey, usd(20_000)).rpc();
  }
  console.log('✓ risk_register_mm deskA + deskB (ceiling $20k each)');

  // ── 4. risk_rent_slice (atomic, same-slot zero in-flight window) ───────────
  const delta = new BN(4000);
  const rentPremium = 40; // $10k × 4e-9 = 40 raw = $0.00004
  const premiumsBeforeRent = Number((await jr.getMarketplace()).premiumLedgerTotal);
  const preRent = await conn.getTokenAccountBalance(vaultPda);
  await jr.riskRentSlice(deskA.publicKey, usd(10_000), delta, deskA).rpc();
  const postRent = await conn.getTokenAccountBalance(vaultPda);
  assert(Number(postRent.value.amount) === Number(preRent.value.amount) + rentPremium,
    'risk_rent_slice premium must land in vault ($0.00004)');
  let mp = await jr.getMarketplace();
  assert(Number(mp.premiumLedgerTotal) === premiumsBeforeRent + rentPremium, 'premium ledger grows by $0.00004');
  console.log(`✓ risk_rent_slice: $10k @ δ=4e-9 → premium ${rentPremium} raw ($0.00004)`, `atomic_sessions=${Number(mp.atomicSessions)}`);

  // Devnet RPC lag ⇒ widen the in-flight window to 16 slots (program caps at 16).
  await jr.riskUpdateParams({ maxSlotAge: 16 }).rpc();
  console.log(`✓ max_slot_age → 16 (devnet RPC latency)`);

  // ── 5. reserve + 6. settle profit (in-flight window dissolves) ─────────────
  // With max_slice=$50k allowance we still have $40k, so one fresh receipt
  // watchers the leftover $11k collateral from the last run too.
  const outBeforeProfit = Number((await jr.getMarketplace()).outstandingUsdc);
  const colBeforeProfit = Number((await jr.getMarketplace()).collateralHeldUsdc);
  const lossBeforeProfit = Number((await jr.getMarketplace()).lossLedgerReserve);
  await reserveAndSettle(jr, conn, deskB, usd(10_000), delta, 100);
  mp = await jr.getMarketplace();
  assert(Number(mp.outstandingUsdc) === outBeforeProfit, 'outstanding unwound after settle');
  assert(Number(mp.collateralHeldUsdc) === colBeforeProfit, 'collateral released after the healthy settle');
  assert(Number(mp.lossLedgerReserve) === lossBeforeProfit, 'healthy settle adds no pool loss');
  console.log('✓ reserve+settle deskB: $10k parked in-flight → pnl=+$0.0001, full $11k collateral released');

  const outBeforeAdv = Number((await jr.getMarketplace()).outstandingUsdc);
  const colBeforeAdv = Number((await jr.getMarketplace()).collateralHeldUsdc);
  const lossBeforeAdv = Number((await jr.getMarketplace()).lossLedgerReserve);
  await reserveAndSettle(jr, conn, deskB, usd(10_000), delta, -usd(13_000));
  mp = await jr.getMarketplace();
  assert(Number(mp.outstandingUsdc) === outBeforeAdv, 'outstanding unwound after default');
  assert(Number(mp.collateralHeldUsdc) === colBeforeAdv, 'collateral forfeited after default');
  assert(
    Number(mp.lossLedgerReserve) === lossBeforeAdv + usd(1_000),
    'pool absorbs +$1k (min(10%·A, residual))',
  );
  console.log('✓ settle −$13k: forfeit $11k → pool absorbs $1k');

  const lossRatioBps = Number(mp.lossLedgerReserve) * 10_000 / Math.max(1, Number(mp.premiumLedgerTotal));
  assert(mp.frozen === true, 'loss ratio must trigger auto-freeze');
  console.log(`✓ AUTOMATIC FREEZE — loss ratio ${Math.round(lossRatioBps)}bps ≥ 8000bps`);

  let rentBlocked = false;
  try {
    await jr.riskRentSlice(deskA.publicKey, usd(1_000), delta, deskA).rpc();
  } catch (e: any) {
    rentBlocked = /Frozen/i.test(e?.message ?? String(e));
    if (!rentBlocked) throw e;
  }
  assert(rentBlocked, 'risk_rent_slice must be rejected while frozen');
  console.log('✓ risk_rent_slice rejected while frozen');

  // ── 8. risk_unfreeze + risk_sweep_premiums 85/15 ───────────────────────────
  await jr.riskUnfreeze().rpc();
  mp = await jr.getMarketplace();
  assert(mp.frozen === false, 'unfrozen');
  const beforeSwept = Number((await jr.getMarketplace()).premiumSweptLedger);
  const totalPremiums = Number((await jr.getMarketplace()).premiumLedgerTotal);
  const pending = totalPremiums - beforeSwept;
  if (pending > 0) {
    const backstopBefore = Number((await jr.getMarketplace()).backstopReserve);
    await jr.riskSweepPremiums().rpc();
    const backstopAfter = Number((await jr.getMarketplace()).backstopReserve);
    const expected = Math.floor((pending * 1500) / 10_000);
    assert(backstopAfter === backstopBefore + expected, `backstop grew by exactly 15% of ${pending} raw`);
    console.log(`✓ risk_sweep_premiums: ${pending} raw → NAV ${pending - expected} / backstop ${expected}`);
  } else {
    console.log('  (premiumSwept == premiumLedger — nothing pending, skipping sweep)');
  }
  mp = await jr.getMarketplace();

  // ── 9. suspend desk_B blocks new capacity ──────────────────────────────────
  await jr.riskSuspendMm(deskB.publicKey).rpc();
  let suspendBlocked = false;
  try {
    const s = await conn.getSlot();
    await jr.riskReserveSlice(deskB.publicKey, usd(1_000), delta, s, deskB).rpc();
  } catch (e: any) {
    suspendBlocked = /Suspended/i.test(e?.message ?? String(e));
    if (!suspendBlocked) throw e;
  }
  assert(suspendBlocked, 'suspended desk must be rejected');
  console.log('✓ risk_suspend_mm deskB → risk_reserve_slice rejected');

  // ── 10. final state ────────────────────────────────────────────────────────
  mp = await jr.getMarketplace();
  console.log('\n── Final MarketplaceState ──');
  console.log(`  outstanding=$${Number(mp.outstandingUsdc)/1e6} collateral=$` +
    `${Number(mp.collateralHeldUsdc)/1e6} loss_ledger=$${Number(mp.lossLedgerReserve)/1e6}`);
  console.log(`  premium_ledger_total=${Number(mp.premiumLedgerTotal)} swept=` +
    `${Number(mp.premiumSweptLedger)} backstop_reserve=${Number(mp.backstopReserve)}`);
  console.log(`  forfeiture_ledger=$${Number(mp.forfeitureLedgerTotal)/1e6} atomic_sessions=${Number(mp.atomicSessions)}`);

  console.log('\n✓ Jit-Risk marketplace proven end-to-end on live devnet:');
  console.log('  atomic same-slot rent $0.00004 · collateralized in-flight $10k/$11k');
  console.log('  adversarial −$13k → pool absorbs 0.1% of grant (RB=10%)');
  console.log('  auto-freeze → unfreeze → 85/15 premium sweep → suspend/block');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});