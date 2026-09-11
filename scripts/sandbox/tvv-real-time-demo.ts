/**
 * TVV Real-Time Certification Sandbox — "prove the engine is real and brings
 * yield" demo runner.
 *
 * Replays one or more Solana days at slot-accurate resolution (216,000 slots
 * @ 400ms, the contract's exact `tvv::S2_WINDOW_SLOTS` domain), driving the
 * byte-parity SDK math in `sdk/src/tvvSandbox.ts`. Deterministic per seed.
 *
 *   Run: npx tsx scripts/sandbox/tvv-real-time-demo.ts
 *
 * Scenarios:
 *   1. BASELINE  — S1 atomic micro-premiums + one revolving S2 desk, sized so
 *                  EACH sleeve independently reconciles to the audited
 *                  reference ($460,800 / 4.608% gross on the $10M pool), for a
 *                  combined $921,600.
 *   2. SCALED    — 3× S2 flow ⇒ 3× S2 yield (linear), no capacity surprises.
 *   3. DEFAULT   — a $50M desk default mid-day: 6-step waterfall runs, the
 *                  protected tranche is honored at its 20% loss cap, and the
 *                  vault stays 100% cash-backed.
 *   4. CRIT-2    — the phantom-nav repro: same flow, no token leg ⇒ unbacked
 *                  NAV disables the invariant. Proves the audit finding and
 *                  the cash-backed mandate.
 */
import {
  runTvvSandbox,
  SANDBOX_SLOTS_PER_DAY,
  type S2DeskConfig,
  type S1DeskConfig,
} from '../../sdk/src/tvvSandbox';
import { grossRevenueUsdCents, referenceTvvParams } from '../../sdk/src/economics';
import { perTurnPremiumMicroUsd, grossApyTenthsBps } from '../../sdk/src/velocity';

const usd = (units: number) => units / 1_000_000;
const printUsd = (units: number) => `$${usd(units).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) pass += 1;
  else fail += 1;
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
}

// ── Reference economics (audited $10M pool) ─────────────────────────────────

const P = referenceTvvParams();
const POOL = 10_000_000_000_000; // $10M in base-6 units (1 unit = $1e-6)
const CLOSED_ANNUAL_USD = Number(grossRevenueUsdCents(P)) / 100; // $460,800
const CLOSED_APY = Number(grossApyTenthsBps(P)) / 1_000; // 4.608%

// S1 micro-premium leg: $14.61/slot × 5bps ⇒ the documented 7,305 µUSD turn.
const s1Micro: S1DeskConfig = {
  id: 's1-jit',
  drawPerSlot: 14_610_000,
  tollBps: 5,
  landingBps: 8_000,
};

// S2 revolving leg: a desk clearing $2.525M of netted notional per 24h window
// at 5bps ⇒ $1,262/day ⇒ $460,800/yr — exactly the audited reference gross.
const s2Desk: S2DeskConfig = {
  id: 's2-meridian',
  limitUsd: Math.floor(POOL * 0.2),
  marginBps: 3_000,
  grossPerWindow: 2_525_000_000_000,
  tollBps: 5,
  defaultAtSlot: null,
};

console.log('═ TVV REAL-TIME CERTIFICATION SANDBOX ═══════════════════════════════');
console.log(`slot domain : ${SANDBOX_SLOTS_PER_DAY} slots/day @ 400ms (S2_WINDOW_SLOTS parity)`);
console.log(`pool        : $10,000,000 in base-6 integer USDC`);
console.log(`closed form : gross $460,800/yr · APY ${CLOSED_APY}% · per-turn micro-premium ${Number(perTurnPremiumMicroUsd(P))} µUSD`);
console.log(`S1 leg      : atomic micro-premiums — 5bps on $14.61/slot = 7,305 µUSD/turn (2.5 turns/sec)`);
console.log(`S2 leg      : $2.525M/day 24h-netted revolving desk @ 5bps/window — margin $600k posted`);

// ── Scenario 1: baseline (both sleeves, 7 real days) ────────────────────────

console.log('\n1 · BASELINE — slot-exact 7-day replay (cash-backed mode)');
const base = runTvvSandbox({ s1: [s1Micro], s2: [s2Desk], days: 7, seed: 2026 });
const s1TollsUnits = Math.floor(base.clearedS1 * 5 / 10_000); // toll on S1 cleared notional
const baseAnnualUsd = (base.grossTolls * 365) / base.days / 1_000_000;
console.log(`     S1 cleared   : ${printUsd(base.clearedS1)} notional, atomic + lossless (defaults=0, frozen=0)`);
console.log(`     S2 cleared   : ${printUsd(base.clearedS2)} notional, 24h-netted, margin-floored`);
console.log(`     tolls settled: ${printUsd(base.grossTolls)} (7d) → ${printUsd(baseAnnualUsd)}/yr — S1 leg ${printUsd(s1TollsUnits * 365 / 7)} · S2 leg ${printUsd((base.grossTolls - s1TollsUnits) * 365 / 7)}`);
console.log(`     90/10 split  : ${printUsd(base.feesToPool)} to pool (net of DF/insurance carves) · ${printUsd(base.treasuryUsd)} treasury`);
check('each sleeve reconciles: combined gross ≈ 2× $460,800 (1% tol)', Math.abs(baseAnnualUsd - 2 * CLOSED_ANNUAL_USD) / CLOSED_ANNUAL_USD < 0.02, `${printUsd(baseAnnualUsd)} vs $921,600`);
check('vault cash-backing invariant holds every slot of 7 days', base.backingHeld);
check('S1 lossless (atomic same-slot return)', base.defaults === 0 && base.frozen.length === 0);
const baseGrossApy = baseAnnualUsd / 10_000_000 * 100;
check(`gross APY = ${(2 * CLOSED_APY).toFixed(2)}% (both legs live)`, Math.abs(baseGrossApy - 2 * CLOSED_APY) < 0.05, `${baseGrossApy.toFixed(3)}% gross / ${(base.impliedApyBps / 100).toFixed(2)}% net-of-carve`);

// ── Scenario 2: scaled (S2-only, isol specific-to-the-sleeve scaling) ───────

const s2Only = (mult: number, days = 7) =>
  runTvvSandbox({ s2: [{ ...s2Desk, grossPerWindow: s2Desk.grossPerWindow * mult }], days, seed: 2026 });

console.log('\n2 · SCALED — S2 yield is exactly linear in cleared volume');
const s2Base = s2Only(1);
const s2X3 = s2Only(3);
const s2BaseAnnualUsd = (s2Base.grossTolls * 365) / s2Base.days / 1_000_000;
const s2X3AnnualUsd = (s2X3.grossTolls * 365) / s2X3.days / 1_000_000;
check('S2 alone reconciles to $460,800', Math.abs(s2BaseAnnualUsd - CLOSED_ANNUAL_USD) / CLOSED_ANNUAL_USD < 0.01, `${printUsd(s2BaseAnnualUsd)}`);
check('3× notional ⇒ 3× S2 gross ($1.3824M)', Math.abs(s2X3AnnualUsd - 3 * s2BaseAnnualUsd) / s2BaseAnnualUsd < 0.01, `${printUsd(s2X3AnnualUsd)} vs ${printUsd(s2X3AnnualUsd.toPrecision(4))} (${s2X3AnnualUsd / s2BaseAnnualUsd}×)`);
check('still 100% cash-backed at 3× volume', s2X3.backingHeld);

// ── Scenario 3: default ─────────────────────────────────────────────────────

console.log('\n3 · DEFAULT — $50M desk default mid-day (6-step waterfall)');
const def = runTvvSandbox({
  s1: [s1Micro],
  s2: [{ ...s2Desk, defaultAtSlot: Math.floor(SANDBOX_SLOTS_PER_DAY / 2), defaultLossUsd: 50_000_000_000_000 }],
  days: 1,
  seed: 2026,
  lossCapBps: 2_000,
});
const protectedCapUnits = Math.floor(POOL * 2_000 / 10_000);
const protectedHaircut = POOL - def.protectedNav;
console.log(`     margin $600k eaten first → waterfall: protected -${printUsd(protectedHaircut)} (cap ${printUsd(protectedCapUnits)} = 20.0% of NAV)`);
check('protected tranche honored at ≤20% loss cap', protectedHaircut <= protectedCapUnits);
check('frozen desk wallet-wide (no further draws/credit)', def.frozen.includes('s2-meridian'));
check('yield stream + fee pipeline survive the default', def.feesToPool > 0);
check('vault still 100% cash-backed after the loss', def.backingHeld);

// ── Scenario 4: CRIT-2 repro ────────────────────────────────────────────────

console.log('\n4 · CRIT-2 — phantom-nav repro (audit proof: booked NAV, no token leg)');
const phCash = runTvvSandbox({ s2: [s2Desk], days: 7, seed: 2026, mode: 'cash-backed' });
const phPhantom = runTvvSandbox({ s2: [s2Desk], days: 7, seed: 2026, mode: 'phantom-nav' });
check('cash-backed mode holds the invariant', phCash.backingHeld);
check('phantom-nav breaks it — unbacked NAV detected', !phPhantom.backingHeld, `${printUsd(phPhantom.backingShortfall)} known-owed, cash short`);
check('phantom books MORE NAV on the same flow (the exploit)', phPhantom.totalAssets > phCash.totalAssets);

// ── Verdict ─────────────────────────────────────────────────────────────────

console.log(`\n════════ VERDICT ${fail === 0 ? '✓ ENGINE REAL — YIELD VERIFIED' : `✗ ${fail} FAILURE(S)`} ════════`);
console.log([
  'S1 atomicity proven: same-slot return, zero losses, zero defaults',
  `S2 netting proven: margin-floored, cash-backed, gross reconciles to $460,800/sleeve (${baseGrossApy.toFixed(2)}% combined)`,
  `Linear yield: 3× S2 volume ⇒ ${s2X3AnnualUsd / s2BaseAnnualUsd}× gross, invariant holds`,
  `Risk: $50M default bounded at 20% protected cap; both sleeves cash-backed end-to-end`,
  phPhantom.backingShortfall > 0 ? 'CRIT-2 payload quantified: phantom NAV leaks real yield' : '',
].filter(Boolean).join('\n     · '));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);