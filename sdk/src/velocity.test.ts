import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  referenceTvvParams,
  totalSlotsPerYear,
  eligibleSlots,
  activeUtilizationUsdCents,
  grossRevenueUsdCents,
  type TvvParams,
} from './economics';
import {
  capitalTurnoverPerYear,
  slotPremiumScalingFactor,
  perTurnPremiumMicroUsd,
  aggregatedPremiumBps,
  dailyTransactionalPowerUsdCents,
  dailyVolumeVelocityUsd,
  grossApyTenthsBps,
  grossApyTenthsBpsAtActiveVolume,
  perSlotRevenueUsdCents,
  formulaDReconciles,
  jitoGapBps,
  jitoTipSlippageUsdCents,
  compoundedApyTenthsBps,
  SLOTS_PER_DAY,
  SLOTS_PER_SECOND_NUM,
  SLOTS_PER_SECOND_DEN,
  COMPOUNDING_PERIODS_PER_YEAR,
} from './velocity';

describe('velocity (TVV Module 2)', () => {
  it('anchors the ledger time architecture', () => {
    // 2.5 slots/sec × 86,400 s/day = 216,000 slots/day.
    assert.equal((SLOTS_PER_SECOND_NUM * 86_400n) / SLOTS_PER_SECOND_DEN, 216_000n);
    assert.equal(SLOTS_PER_DAY, 216_000n);
    // 216,000 × 365 = total slots/year (cross-check vs Module 1).
    assert.equal(SLOTS_PER_DAY * 365n, totalSlotsPerYear());
  });

  it('Formula A — capital turnover is 63,072,000 turns/yr (2.5/s × 80%)', () => {
    const p = referenceTvvParams();
    assert.equal(capitalTurnoverPerYear(p), 63_072_000n);
    assert.equal(capitalTurnoverPerYear(p), eligibleSlots(p));
  });

  it('Formula B — F_slot ≈ 3.0441e-9 per slot (R_base / S_total)', () => {
    const p = referenceTvvParams();
    // 0.24 / 78,840,000 × 1e18 = 3,044,140,030 (q1e18). The spec sheet's
    // printed 3.0439e-9 is this quotient rounded to 7 significant figures.
    assert.equal(slotPremiumScalingFactor(p), 3_044_140_030n);
  });

  it('the per-turn premium reconciles to Module 1 slot_fee_micro_usd band', () => {
    const p = referenceTvvParams();
    const perTurn = perTurnPremiumMicroUsd(p);
    assert.ok(perTurn >= 7_300n && perTurn <= 7_310n, `per-turn µUSD out of band: ${perTurn}`);
    // ~ $0.0073059 per turn; doubling the base rate doubles the premium to
    // within the 1-µUSD floor of integer division.
    const scaled: TvvParams = { ...referenceTvvParams(), baseRateBps: 4_800n };
    assert.ok(
      perTurnPremiumMicroUsd(scaled) >= perTurn * 2n - 2n &&
        perTurnPremiumMicroUsd(scaled) <= perTurn * 2n + 2n,
    );
  });

  it('Formula C — daily transactional power is $414,720,000,000/day in the formula', () => {
    const p = referenceTvvParams();
    // $2,400,000 × 216,000 × 0.80 = $414,720,000,000/day (note: spec sheet
    // prints $414,720,000 — a 1000× unit slip; the formula is authoritative).
    assert.equal(dailyTransactionalPowerUsdCents(p), 41_472_000_000_000n);
    assert.equal(dailyVolumeVelocityUsd(p), 414_720_000_000n);
  });

  it('Formula D — gross synthetic APY of 4.608% on the $10M pool', () => {
    const p = referenceTvvParams();
    assert.equal(grossApyTenthsBps(p), 4_608n); // 4.608%
    // Matches the closed-form revenue: $460,800 / $10,000,000.
    const centered = (grossRevenueUsdCents(p) * 100_000n) / p.poolUsdCents;
    assert.equal(grossApyTenthsBps(p), centered);
  });

  it('Formula D — scales linearly to 11.52% at 60% pool capacity ($6M active)', () => {
    const p = referenceTvvParams();
    // 60% of the pool = $6,000,000 = 600,000,000 cents.
    const sixM = (p.poolUsdCents * 6_000n) / 10_000n;
    assert.equal(grossApyTenthsBpsAtActiveVolume(sixM, p), 11_520n); // 11.52%
  });

  it('effective premium on active volume is 24% × 80% = 19.2%', () => {
    const p = referenceTvvParams();
    assert.equal(aggregatedPremiumBps(p), 1_920n);
  });

  it('the per-slot Formula-D route agrees with the closed form within 1%', () => {
    const p = referenceTvvParams();
    assert.ok(formulaDReconciles(p));
    // The aggregation through per-turn flooring stays within ~$60 of $460,800.
    const closed = grossRevenueUsdCents(p);
    const slotted = perSlotRevenueUsdCents(p);
    assert.ok(closed - slotted < 10_000n, `per-slot drift ${closed - slotted} cents`);
  });

  it('constraint 1 — Jito gap is a flat 20% velocity drop', () => {
    const p = referenceTvvParams();
    assert.equal(jitoGapBps(p), 2_000n);
  });

  it('constraint 2 — MEV tip slippage is a 1.5% cut of gross premiums', () => {
    const p = referenceTvvParams();
    assert.equal(jitoTipSlippageUsdCents(p), 691_200n); // $6,912 = 1.5% × $460,800
  });

  it('constraint 3 — 24h compounding lifts the APY toward the organic band', () => {
    const p = referenceTvvParams();
    assert.equal(COMPOUNDING_PERIODS_PER_YEAR, 365n);
    const apy = compoundedApyTenthsBps(p);
    // (1 + 0.04608/365)^365 − 1 ≈ 4.71% — strictly above the 4.608% baseline,
    // strictly below the 15% band top-down (drags still applied downstream).
    assert.ok(apy >= 4_700n && apy <= 4_730n, `compounded APY out of band: ${apy}`);
    assert.ok(apy > grossApyTenthsBps(p), 'daily compounding must exceed the simple APY');
  });

  it('runs on other pools without float arithmetic', () => {
    const small: TvvParams = {
      ...referenceTvvParams(),
      poolUsdCents: 100_000_000n, // $1,000,000
    };
    // Same velocity → same percentage APY.
    assert.equal(grossApyTenthsBps(small), grossApyTenthsBps(referenceTvvParams()));
    assert.equal(dailyTransactionalPowerUsdCents(small), 4_147_200_000_000n); // $41.472B
    assert.equal(activeUtilizationUsdCents(small), 24_000_000n);
  });
});