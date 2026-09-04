import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  referenceTvvParams,
  defaultTvvParams,
  seniorTrancheUsdCents,
  juniorTrancheUsdCents,
  totalSlotsPerYear,
  eligibleSlots,
  systemicCapUsdCents,
  deskCapUsdCents,
  activeUtilizationUsdCents,
  slotFeeMicroUsd,
  grossRevenueUsdCents,
  netRevenueUsdCents,
  difAllocationUsdCents,
  totalLpYieldUsdCents,
  seniorYieldUsdCents,
  juniorYieldUsdCents,
  circuitBreakerDrainUsdCents,
  juniorDrainRatioBps,
  hardLockTriggered,
  type TvvParams,
} from './economics';

describe('economics', () => {
  it('reconciles the reference balance sheet to the cent', () => {
    const p = referenceTvvParams();

    assert.equal(totalSlotsPerYear(), 78_840_000n);
    assert.equal(eligibleSlots(p), 63_072_000n);

    assert.equal(systemicCapUsdCents(p), 600_000_000n); // $6,000,000
    assert.equal(deskCapUsdCents(p), 150_000_000n); // $1,500,000
    assert.equal(seniorTrancheUsdCents(p), 700_000_000n); // $7,000,000
    assert.equal(juniorTrancheUsdCents(p), 300_000_000n); // $3,000,000
    assert.equal(activeUtilizationUsdCents(p), 240_000_000n); // $2,400,000

    const fee = slotFeeMicroUsd(p);
    assert.ok(fee >= 7_300n && fee <= 7_310n, `fee µUSD out of band: ${fee}`);

    assert.equal(grossRevenueUsdCents(p), 46_080_000n); // $460,800.00
    assert.equal(netRevenueUsdCents(p), 40_388_800n); // $403,888.00
    assert.equal(difAllocationUsdCents(p), 8_077_760n); // $80,777.60
    assert.equal(totalLpYieldUsdCents(p), 32_311_040n); // $323,110.40

    assert.equal(seniorYieldUsdCents(p), 31_500_000n); // $315,000.00
    assert.equal(juniorYieldUsdCents(p), 811_040n); // $8,110.40
  });

  it('trips the hard circuit breaker only after half the junior layer drains', () => {
    const p = referenceTvvParams();

    assert.equal(circuitBreakerDrainUsdCents(p), 150_000_000n); // $1,500,000

    const below = 147_000_000n;
    assert.equal(hardLockTriggered(p, below), false);
    assert.equal(juniorDrainRatioBps(below, juniorTrancheUsdCents(p)), 4_900n);

    assert.equal(hardLockTriggered(p, 150_000_000n), true);
    assert.equal(juniorDrainRatioBps(150_000_000n, juniorTrancheUsdCents(p)), 5_000n);
  });

  it('scales to other pool sizes without float arithmetic', () => {
    const small: TvvParams = {
      ...defaultTvvParams(),
      poolUsdCents: 100_000_000n, // $1,000,000
    };
    assert.equal(grossRevenueUsdCents(small), 4_608_000n); // $46,080.00
    assert.equal(juniorTrancheUsdCents(small), 30_000_000n); // $300,000
  });

  it('is byte-for-byte identical to the Rust twin reference figures', () => {
    const p = referenceTvvParams();
    const expected = {
      totalSlotsPerYear: 78_840_000n,
      eligibleSlots: 63_072_000n,
      grossRevenueUsdCents: 46_080_000n,
      netRevenueUsdCents: 40_388_800n,
      difAllocationUsdCents: 8_077_760n,
      totalLpYieldUsdCents: 32_311_040n,
      seniorYieldUsdCents: 31_500_000n,
      juniorYieldUsdCents: 811_040n,
    };
    assert.equal(totalSlotsPerYear(), expected.totalSlotsPerYear);
    assert.equal(eligibleSlots(p), expected.eligibleSlots);
    assert.equal(grossRevenueUsdCents(p), expected.grossRevenueUsdCents);
    assert.equal(netRevenueUsdCents(p), expected.netRevenueUsdCents);
    assert.equal(difAllocationUsdCents(p), expected.difAllocationUsdCents);
    assert.equal(totalLpYieldUsdCents(p), expected.totalLpYieldUsdCents);
    assert.equal(seniorYieldUsdCents(p), expected.seniorYieldUsdCents);
    assert.equal(juniorYieldUsdCents(p), expected.juniorYieldUsdCents);
  });
});