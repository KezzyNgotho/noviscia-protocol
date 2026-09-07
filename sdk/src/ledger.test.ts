import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  referenceTvvParams,
  type TvvParams,
  mulDiv,
  ECONOMICS_BPS,
  seniorTrancheUsdCents,
  juniorTrancheUsdCents,
  deskCapUsdCents,
  systemicCapUsdCents,
  netRevenueUsdCents,
  difAllocationUsdCents,
  totalLpYieldUsdCents,
} from './economics';
import {
  DAYS_PER_YEAR,
  ledgerSummary,
  ledgerReconcilesToAnnual,
  runLedger,
  referenceDeskSchedule,
  fullUtilizationSchedule,
  breachedDeskSchedule,
  dayInfraUsdCents,
  daySeniorHurdleUsdCents,
  dayDeskTollMicro,
  landedRealSlotsPerDay,
  initialReserve,
  type DeskSchedule,
} from './ledger';

const USD_CENTS = (usd: number): bigint => BigInt(Math.round(usd * 100));

describe('ledger (TVV Module 4 — settlement ledger, no-drain sandbox)', () => {
  it('reference year closes to the workbook within 1% and never violates no-drain', () => {
    const p = referenceTvvParams();
    const state = runLedger(p, referenceDeskSchedule(p), Number(DAYS_PER_YEAR));
    const rec = ledgerReconcilesToAnnual(state);
    assert.equal(state.daysSettled.length, 365);
    assert.equal(state.breaches.length, 0);
    assert.equal(state.reserve.frozen, false);
    assert.deepEqual(state.violations, []);
    // Headline numbers: $460,800 gross → $403,888 net → $80,777.60 DIF →
    // $323,110.40 LP (senior $315,000 + junior $8,110.40), within 1%.
    assert.ok(
      rec.withinTolerance,
      `net=${rec.net} dif=${rec.dif} lp=${rec.lpPool} senior=${rec.senior} junior=${rec.junior}`,
    );
  });

  it('fee split is exactly DIF 20% + LP 80% of net, tip 1.5% of gross, infra $50k/365', () => {
    const p = referenceTvvParams();
    const day0 = runLedger(p, referenceDeskSchedule(p), 1).daysSettled[0];
    // tip = 1.5% of gross (mirrors jitoTipBps), floored per day.
    assert.equal(day0.jitoTipCents, mulDiv(day0.grossTollsCents, 150n, ECONOMICS_BPS));
    assert.equal(day0.infraCents, dayInfraUsdCents(p));
    // net = gross − tip − infra; DIF = 20% of net; LP = 80% of net.
    assert.equal(day0.netCents, day0.grossTollsCents - day0.jitoTipCents - day0.infraCents);
    assert.equal(day0.difCents, mulDiv(day0.netCents, 2_000n, ECONOMICS_BPS));
    assert.equal(day0.lpPayoutCents, day0.netCents - day0.difCents);
  });

  it('financial-model headline: a day of desk-b lending costs ~$473 and clears via 24h batch', () => {
    const p = referenceTvvParams();
    // desk-b borrows $0.9M every landing slot → per-slot toll × landed-slots.
    const micro = dayDeskTollMicro(p, mulDiv(deskCapUsdCents(p), 6_000n, ECONOMICS_BPS));
    const cents = mulDiv(micro, 1n, 10_000n);
    // Roughly $473/day — desk-level lending visible at daily batch granularity.
    assert.ok(cents > 46_000n && cents < 48_000n, `cents=${cents}`);
    assert.equal(landedRealSlotsPerDay(p), 172_800n);
  });

  it('senior hurdle accrues 4.50%/365; a payout drought just withholds (never impairs principal)', () => {
    const p = referenceTvvParams();
    assert.equal(daySeniorHurdleUsdCents(p), USD_CENTS(863.01));
    // A starving desk (1% of cap ≈ $78.90/day gross) cannot cover the $50k/yr
    // infrastructure bill: the ops shortfall is funded from DIF then junior —
    // senior principal $7M stays untouched, C3 never trips. Real fixed costs
    // are never created out of nothing (C1 conservation holds day by day).
    const starving: DeskSchedule[] = [
      { deskId: 'starve', utilBpsPerDay: new Array(30).fill(100n), settling: true },
    ];
    const state = runLedger(p, starving, 30);
    assert.equal(state.reserve.seniorLiabilityUsdCents, seniorTrancheUsdCents(p));
    // Junior absorbs only the ops shortfall (< $10k) — never forged dollars.
    assert.ok(
      state.reserve.juniorEquityUsdCents >= juniorTrancheUsdCents(p) - USD_CENTS(10_000),
      `junior=${state.reserve.juniorEquityUsdCents}`,
    );
    assert.deepEqual(state.violations, []);
  });

  it('full utilization (4 max desks, $6M active) drives junior APY to ~18.4%', () => {
    const p: TvvParams = { ...referenceTvvParams(), avgUtilizationBps: 10_000n };
    const state = runLedger(p, fullUtilizationSchedule(p), Number(DAYS_PER_YEAR));
    const rec = ledgerReconcilesToAnnual(state, p);
    assert.ok(rec.withinTolerance, ledgerSummary(state));
    // Junior APY in the 18.3%–18.6% band (the workbook's 18.4259%).
    const apyPct = Number(rec.juniorApyTenthsBps) / 10;
    assert.ok(apyPct > 18.3 && apyPct < 18.6, `juniorApy=${apyPct}%`);
    assert.deepEqual(state.violations, []);
  });

  it('a non-settling desk breaches through L1→L5; money only leaves via realized loss', () => {
    const p = referenceTvvParams();
    const state = runLedger(p, breachedDeskSchedule(p), Number(DAYS_PER_YEAR));
    assert.equal(state.breaches.length, 1);
    assert.equal(state.breaches[0].deskId, 'desk-a');
    // $1.5M default: 10% collateral + 45% effective LoC recovered; remainder
    // covered by DIF then junior — no uncovered loss, no senior impairment.
    assert.equal(state.breaches[0].uncoveredUsdCents, 0n);
    assert.equal(state.reserve.uncoveredUsdCents, 0n);
    assert.ok(state.reserve.juniorDrainedUsdCents > 0n);
    assert.equal(state.reserve.frozen, false);
    assert.deepEqual(state.violations, []);
    // The rest of the year still settles (365 days), junior stays solvent.
    assert.equal(state.daysSettled.length, Number(DAYS_PER_YEAR));
    assert.ok(state.reserve.juniorEquityUsdCents > 0n);
  });

  it('systemic saturating breaches drain 50%+ of junior and trip the hard circuit breaker', () => {
    const p = referenceTvvParams();
    const fourBreaching: DeskSchedule[] = ['desk-a', 'desk-b', 'desk-c', 'desk-d'].map((id) => ({
      deskId: id,
      utilBpsPerDay: new Array(90).fill(10_000n),
      settling: false,
    }));
    const state = runLedger(p, fourBreaching, 90);
    assert.ok(state.reserve.frozen, 'circuit breaker must trip at 50% junior drain');
    assert.equal(state.reserve.uncoveredUsdCents, 0n);
    // Senior is never impaired: liability = principal + accrued, ≥ $7M principal.
    assert.ok(state.reserve.seniorLiabilityUsdCents >= seniorTrancheUsdCents(p));
    assert.deepEqual(state.violations, []);
  });

  it('cap enforcement trips a C2 violation when a desk over-borrows its cap', () => {
    const p = referenceTvvParams();
    const oversized: DeskSchedule[] = [
      { deskId: 'hulk', utilBpsPerDay: new Array(10).fill(12_000n), settling: true },
    ];
    const state = runLedger(p, oversized, 10);
    assert.ok(
      state.violations.some((v) => v.startsWith('C2-desk-cap')),
      `expected C2-desk-cap violation, got: ${state.violations.join('; ')}`,
    );
  });

  it('no-drain invariants hold every-single-day on the reference run (C1 conservation exact)', () => {
    const p = referenceTvvParams();
    const state = runLedger(p, referenceDeskSchedule(p), Number(DAYS_PER_YEAR));
    assert.deepEqual(state.violations, []);
    // Cross-run: every day is conservative; downtowns can't beat senior principal without exhaustion.
    assert.ok(initialReserve(p).seniorLiabilityUsdCents === seniorTrancheUsdCents(p));
    assert.ok(initialReserve(p).juniorEquityUsdCents === juniorTrancheUsdCents(p));
    const deck = referenceDeskSchedule(p).reduce(
      (a, d) => a + mulDiv(deskCapUsdCents(p), d.utilBpsPerDay[0], ECONOMICS_BPS),
      0n,
    );
    const sys = systemicCapUsdCents(p);
    void sys;
    assert.equal(deck, mulDiv(p.poolUsdCents, 2_400n, ECONOMICS_BPS)); // μ = $2.4M
  });

  it('ledgerSummary prints a reviewer-friendly one-liner', () => {
    const p = referenceTvvParams();
    const s = runLedger(p, referenceDeskSchedule(p), 10);
    const line = ledgerSummary(s);
    assert.match(line, /days=10 settled=10 breaches=0 frozen=false violations=0/);
    assert.match(line, /juniorApy=/);
  });
});