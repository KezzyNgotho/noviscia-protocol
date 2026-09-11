import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  YIELD_BPS,
  LEVERAGE_CAP_BPS,
  DEFAULT_LST_CARRY_BPS,
  decomposeApy,
  closesApy,
  weightedVenueFundingApyBps,
  fundingNetApyBps,
  effectiveLeverageRateBps,
  leverageBoostApyBps,
  referenceRegimeFixtures,
  regimeFanBps,
  cycleAverageApyBps,
  mulDivFloor,
  type FundingCarryInputs,
} from './yieldEngine';

describe('yieldEngine', () => {
  it('decomposes the reference compressed regime and closes to the unit', () => {
    const d = decomposeApy({
      venues: [{ venue: 'compressed', fundingApyBps: -500n, weightBps: YIELD_BPS }],
      dispersionApyBps: 400n,
      leverageRateBps: 0n,
    });
    assert.equal(d.lstCarryApyBps, DEFAULT_LST_CARRY_BPS); // 600
    assert.equal(d.weightedFundingApyBps, -500n);
    assert.equal(d.fundingNetApyBps, -405n); // -500 × 0.90 × 0.90
    assert.equal(d.dispersionNetApyBps, 324n); // 400 × 0.81
    assert.equal(d.leverageBoostApyBps, 0n);
    assert.equal(d.grossApyBps, 519n);
    assert.equal(d.netApyBps, 369n); // ~3.7% — inside the 2–5% compressed band
    assert.equal(closesApy(d), true);
  });

  it('pins the neutral and bull regimes on the documented fan', () => {
    const neutral = decomposeApy({
      venues: [{ venue: 'neutral', fundingApyBps: 100n, weightBps: YIELD_BPS }],
      dispersionApyBps: 350n,
      leverageRateBps: 1_500n,
    });
    assert.equal(neutral.netApyBps, 814n); // ~8.1% — inside the 6–10% mid band
    assert.equal(closesApy(neutral), true);

    const bull = decomposeApy({
      venues: [{ venue: 'bull', fundingApyBps: 1_000n, weightBps: YIELD_BPS }],
      dispersionApyBps: 500n,
      leverageRateBps: 2_000n,
    });
    assert.equal(bull.netApyBps, 1_728n); // ~17.3% — inside the 12–25% bull band
    assert.equal(closesApy(bull), true);
  });

  it('heads the honest ~7% cycle average from the regime fixtures', () => {
    const cycle = cycleAverageApyBps();
    assert.ok(cycle >= 690n && cycle <= 720n, `cycle avg out of band: ${cycle}`);
    assert.equal(cycle, 706n); // pinned reference — 7.06%
  });

  it('clamps leverage at 35% of the book, never more', () => {
    assert.equal(LEVERAGE_CAP_BPS, 3_500n);
    assert.equal(effectiveLeverageRateBps(5_000n), 3_500n); // requested 50% → 35%
    assert.equal(effectiveLeverageRateBps(1_000n), 1_000n);
    assert.equal(effectiveLeverageRateBps(-1n), 0n);

    const d = decomposeApy({
      venues: [{ venue: 'bull', fundingApyBps: 1_000n, weightBps: YIELD_BPS }],
      dispersionApyBps: 500n,
      leverageRateBps: 5_000n, // would be 50% without the guard
    });
    assert.equal(d.leverageRateAppliedBps, 3_500n);
    assert.equal(d.leverageBoostApyBps, leverageBoostApyBps(810n, 405n, 5_000n));
    assert.equal(d.leverageBoostApyBps, leverageBoostApyBps(810n, 405n, 3_500n));
  });

  it('only leverages when the carry clears the borrow cost', () => {
    assert.equal(leverageBoostApyBps(100n, 200n, 3_500n, 900n), 0n); // 300 < 900
    assert.equal(leverageBoostApyBps(810n, 405n, 2_000n, 900n), 63n); // 1215 > 900 → 20% of spread
    assert.equal(leverageBoostApyBps(810n, 405n, 0n, 900n), 0n);
  });

  it('weights venue funding and renormalizes partial venue sets', () => {
    const blend = weightedVenueFundingApyBps([
      { venue: 'hyperliquid', fundingApyBps: 156n, weightBps: 4_000n },
      { venue: 'binance', fundingApyBps: -294n, weightBps: 2_500n },
      { venue: 'bybit', fundingApyBps: -776n, weightBps: 1_500n },
      { venue: 'dydx', fundingApyBps: -312n, weightBps: 1_000n },
      { venue: 'drift', fundingApyBps: 1_095n, weightBps: 1_000n },
    ]);
    assert.equal(blend, -50n); // live-style blend ≈ −0.50% annualized

    const renorm = weightedVenueFundingApyBps([
      { venue: 'a', fundingApyBps: 100n, weightBps: 3_000n },
      { venue: 'b', fundingApyBps: -20n, weightBps: 3_000n },
    ]);
    assert.equal(renorm, 40n); // weights sum to 6000 → normalised (60/40 blend)
    assert.equal(weightedVenueFundingApyBps([]), 0n);
  });

  it('floors negative legs conservatively (never rounds a loss up)', () => {
    assert.equal(mulDivFloor(-500n, 9_000n, YIELD_BPS), -450n);
    assert.equal(mulDivFloor(100n, 9_000n, YIELD_BPS), 90n);
    // Non-exact negative division floors away from zero:
    assert.equal(mulDivFloor(-1n, 3n, 2n), -2n); // -1.5 → -2 (floor), JS trunc would give -1
    assert.equal(fundingNetApyBps(-500n), -405n);
    assert.equal(fundingNetApyBps(100n), 81n);
  });

  it('keeps buyback separate from yield', () => {
    const d = decomposeApy({
      venues: [{ venue: 'neutral', fundingApyBps: 100n, weightBps: YIELD_BPS }],
      dispersionApyBps: 350n,
      leverageRateBps: 1_500n,
      buybackApyBps: 100n,
    });
    assert.equal(d.netApyBps, 814n);
    assert.equal(d.buybackApyBps, 100n);
    assert.equal(d.totalTokenAdjustedApyBps, 914n);
    assert.equal(closesApy(d), true);
  });

  it('returns an honest zero-yield decomposition with no market inputs', () => {
    const d = decomposeApy({});
    assert.equal(d.weightedFundingApyBps, 0n);
    assert.equal(d.fundingNetApyBps, 0n);
    assert.equal(d.leverageBoostApyBps, 0n);
    assert.equal(closesApy(d), true);
  });

  it('is byte-for-byte reproducible from a plain input object', () => {
    const inputs: FundingCarryInputs = {
      venues: [{ venue: 'bull', fundingApyBps: 1_000n, weightBps: YIELD_BPS }],
      dispersionApyBps: 500n,
      leverageRateBps: 2_000n,
    };
    const a = decomposeApy(inputs);
    const b = decomposeApy({ ...inputs });
    assert.deepEqual(a, b);
    const fan = regimeFanBps();
    assert.equal(fan.length, 3);
    assert.equal(fan[0].key, 'compressed');
    assert.equal(fan[2].netApyBps, 1_728n);
  });
});