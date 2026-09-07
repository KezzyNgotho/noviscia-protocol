import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { referenceTvvParams, deskCapUsdCents, type TvvParams } from './economics';
import {
  REF_MISMATCH_BPS,
  REF_TIP_SHARE_BPS,
  deskSlotTollMicroUsd,
  maxDeskSlotTollMicroUsd,
  deskSizingMultiplierUsd,
  borrowerGrossSpreadUsdCents,
  borrowerTipUsdCents,
  borrowerNetUsdCents,
  tollShareOfGrossPpb,
  tollShareOfNetPpm,
  deskAnnualTollUsdCentsAtFullLanding,
  deskAnnualTollReconciles,
  maxConcurrentMaxDesks,
} from './feasibility';

const USD_CENTS = (usd: number): bigint => BigInt(Math.round(usd * 100));

describe('feasibility (TVV Module 3 — borrower economics)', () => {
  it('anchors the max-desk slot toll to $0.004566 (exact integer floor)', () => {
    const p = referenceTvvParams();
    // $1.5M desk × 24% = $360,000/yr = 36,000,000 cents; × 10,000 µUSD/cent
    // ÷ 78,840,000 slots = 4,566 µUSD (the deck's "$0.004565" rounds down).
    assert.equal(maxDeskSlotTollMicroUsd(p), 4_566n);
    // Generic form at the same desk.
    assert.equal(deskSlotTollMicroUsd(p, USD_CENTS(1_500_000)), 4_566n);
    // Halving the desk halves the toll (within 1 µUSD of integer floor).
    assert.ok(
      deskSlotTollMicroUsd(p, USD_CENTS(750_000)) >= 2_282n &&
        deskSlotTollMicroUsd(p, USD_CENTS(750_000)) <= 2_283n,
    );
  });

  it('borrower P&L on the reference route: $2,250 gross, $1,350 tip, exact $900 net', () => {
    const p = referenceTvvParams();
    const desk = USD_CENTS(1_500_000);
    // $1.5M × 15 bps = $2,250.00 gross spread.
    assert.equal(borrowerGrossSpreadUsdCents(desk, REF_MISMATCH_BPS), USD_CENTS(2_250));
    // Aggressive 60% Jito bundle tip → $1,350.
    assert.equal(
      borrowerTipUsdCents(borrowerGrossSpreadUsdCents(desk, REF_MISMATCH_BPS), REF_TIP_SHARE_BPS),
      USD_CENTS(1_350),
    );
    // Net = $2,250 − $1,350 − toll(sub-cent, floors to $0) → $900.00.
    assert.equal(borrowerNetUsdCents(p, desk, REF_MISMATCH_BPS, REF_TIP_SHARE_BPS), USD_CENTS(900));
  });

  it('toll is imperceptible: 2,029 ppb of spread and ≈ 5 ppm of net', () => {
    const p = referenceTvvParams();
    const desk = USD_CENTS(1_500_000);
    // 4,566 µUSD / ($2,250 = 2,250,000,000 µUSD) = 2,029 parts per billion.
    assert.equal(tollShareOfGrossPpb(p, desk, REF_MISMATCH_BPS), 2_029n);
    // 4,566 µUSD / ($900 net = 900,000,000 µUSD) → 5 parts per million.
    assert.equal(tollShareOfNetPpm(p, desk, REF_MISMATCH_BPS, REF_TIP_SHARE_BPS), 5n);
  });

  it('max-desk annual toll at full landing is $287,986.75 and reconciles to the closed form', () => {
    const p = referenceTvvParams();
    const desk = USD_CENTS(1_500_000);
    // 4,566 µUSD × 63,072,000 eligibility slots = $287,986.75.
    assert.equal(deskAnnualTollUsdCentsAtFullLanding(p, desk), USD_CENTS(287_986.75));
    // Closed form $1.5M × 24% × 80% = $288,000; per-slot drift < 1%.
    assert.ok(deskAnnualTollReconciles(p, desk));
    // A single max desk at full utilization generates ~62% of the $460,800 gross.
    const pct = (Number(deskAnnualTollUsdCentsAtFullLanding(p, desk)) / 46_080_000) * 100;
    assert.ok(pct > 62 && pct < 63, `pct=${pct}`);
  });

  it('the "multi-fold" sizing lever: $100k wallet cash → 15× the desk cap', () => {
    const p = referenceTvvParams();
    assert.equal(deskCapUsdCents(p), 150_000_000n); // $1.5M single-desk cap
    // $1.5M / $100k = 15 — the desk sizes 15× its fluid wallet balance.
    assert.equal(deskSizingMultiplierUsd(p, USD_CENTS(100_000)), 15n);
    // No fluid cash → no multiplier; a full-wallet desk gets 1×.
    assert.equal(deskSizingMultiplierUsd(p, 0n), 0n);
    assert.equal(deskSizingMultiplierUsd(p, USD_CENTS(1_500_000)), 1n);
  });

  it('the reference pool hosts at most 4 max desks (C_sys 60% / C_desk 15%)', () => {
    const p = referenceTvvParams();
    assert.equal(maxConcurrentMaxDesks(p), 4n);
    // Pathological caps (C_sys < C_desk) never drop below 1 desk.
    const weird: TvvParams = { ...referenceTvvParams(), systemicCapBps: 500n, deskCapBps: 1_500n };
    assert.equal(maxConcurrentMaxDesks(weird), 1n);
  });

  it('scales across pool sizes and tolerates an unprofitable route', () => {
    const small: TvvParams = { ...referenceTvvParams(), poolUsdCents: 100_000_000n }; // $1M pool
    const desk = USD_CENTS(150_000); // 15% of the $1M pool
    // Toll is desk-proportional, not pool-proportional: $150k cap → 456 µUSD
    // (exactly 1/10 of the $1.5M-cap toll 4,566 µUSD, same 24% base rate).
    assert.equal(deskSlotTollMicroUsd(small, desk), 456n);
    assert.equal(maxDeskSlotTollMicroUsd(small) === 0n, false, 'desk cap must be > 0');
    // A 100%-tip (or zero-spread) route floors the borrower net at $0 —
    // the guarantee is "never negative", before and after the toll.
    assert.equal(
      borrowerNetUsdCents(small, desk, 1n, 10_000n),
      0n,
      'unprofitable routes must floor net at $0, never go negative',
    );
    assert.equal(borrowerNetUsdCents(small, desk, 0n, 6_000n), 0n);
  });
});