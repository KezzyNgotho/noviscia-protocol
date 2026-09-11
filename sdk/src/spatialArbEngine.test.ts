import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARB_BPS,
  DEFAULT_CAPTURE_EFFICIENCY_BPS,
  DEFAULT_COMBINED_LEG_COST_BPS,
  DEFAULT_COST_AUM_BPS,
  DEFAULT_SLOT_CEILING_BPS,
  decomposeSpatialArb,
  grossSpreadBps,
  netEdgePerTradeBps,
  annualizeEdgeBps,
  cycleAverageSpatialArbApyBps,
  closesSpatialArb,
  effectiveSlotCeilingBps,
  syntheticPoolPair,
  referenceRegimeFixtures,
  type VenuePoolQuote,
} from './spatialArbEngine';

function pool(venue: string, priceUsdcScaled: bigint): VenuePoolQuote {
  return { venue, priceUsdcScaled, weightBps: ARB_BPS };
}

describe('spatialArbEngine', () => {
  it('gross spread is (max-min)/min in bps', () => {
    const s = grossSpreadBps([pool('orca', 100_000_000_000n), pool('phoenix', 101_000_000_000n)]);
    assert.equal(s.grossBps, 100n);
    assert.equal(s.minPriceScaled, 100_000_000_000n);
    assert.equal(s.maxPriceScaled, 101_000_000_000n);
  });

  it('single venue or empty set is no edge', () => {
    assert.equal(grossSpreadBps([pool('orca', 100_000_000_000n)]).grossBps, 0n);
    assert.equal(grossSpreadBps([]).grossBps, 0n);
  });

  it('identical prices yield zero spread', () => {
    const s = grossSpreadBps([pool('orca', 100n), pool('phoenix', 100n), pool('jupiter', 100n)]);
    assert.equal(s.grossBps, 0n);
  });

  it('zero min price yields no spread (division guard)', () => {
    const s = grossSpreadBps([pool('orca', 0n), pool('phoenix', 100n)]);
    assert.equal(s.grossBps, 0n);
  });

  it('net edge subtracts combined leg cost and floors at zero', () => {
    assert.equal(netEdgePerTradeBps(100n, 8n), 92n);
    assert.equal(netEdgePerTradeBps(6n, 8n), 0n);
    assert.equal(netEdgePerTradeBps(0n, 8n), 0n);
  });

  it('annualization is a linear edge × days × ceiling model', () => {
    assert.equal(annualizeEdgeBps(92n, 180n, 3_500n), (92n * 180n * 3_500n) / ARB_BPS);
    assert.equal(annualizeEdgeBps(0n, 180n, 3_500n), 0n);
    assert.equal(annualizeEdgeBps(92n, 0n, 3_500n), 0n);
  });

  it('slot ceiling clamps to the 60% systemic cap', () => {
    assert.equal(DEFAULT_SLOT_CEILING_BPS, 6_000n);
    assert.equal(effectiveSlotCeilingBps(undefined), 6_000n);
    assert.equal(effectiveSlotCeilingBps(7_000n), 6_000n);
    assert.equal(effectiveSlotCeilingBps(-1n), 0n);
    assert.equal(effectiveSlotCeilingBps(3_000n), 3_000n);
  });

  it('dislocated spread produces a positive, capacity-bounded APY', () => {
    const d = decomposeSpatialArb({
      pools: syntheticPoolPair(35n),
      daysCapturedPerYear: 180n,
      slotCeilingBps: 3_500n,
    });
    assert.equal(d.grossSpreadBps, 35n);
    assert.equal(d.netEdgePerTradeBps, 27n); // 35 − 8
    assert.ok(d.capturedEdgePerTradeBps > 0n);
    assert.equal(d.edgeOpen, true);
    assert.ok(d.netApyBps > 0n);
    assert.equal(closesSpatialArb(d), true);
  });

  it('calm spread below combined costs yields zero edge', () => {
    const d = decomposeSpatialArb({
      pools: [pool('orca', 100_000_000_000n), pool('phoenix', 100_010_000_000n)], // 1 bps
      daysCapturedPerYear: 24n,
      slotCeilingBps: 6_000n,
    });
    assert.equal(d.grossSpreadBps, 1n);
    assert.equal(d.netEdgePerTradeBps, 0n);
    assert.equal(d.edgeOpen, false);
    assert.equal(d.netApyBps, 0n);
  });

  it('no live venues or zero capture days means honest zero', () => {
    assert.equal(decomposeSpatialArb({}).grossSpreadBps, 0n);
    const d = decomposeSpatialArb({ pools: syntheticPoolPair(35n) }); // days default 0
    assert.equal(d.edgeOpen, false);
    assert.equal(d.netApyBps, 0n);
  });

  it('buyback is reported separately, never mixed into yield', () => {
    const d = decomposeSpatialArb({
      pools: syntheticPoolPair(40n),
      daysCapturedPerYear: 100n,
      buybackApyBps: 500n,
    });
    assert.equal(d.totalTokenAdjustedApyBps, d.netApyBps + 500n);
    assert.equal(closesSpatialArb(d), true);
  });

  it('cycle average closes and is regime-weighted (~6%)', () => {
    const avg = cycleAverageSpatialArbApyBps();
    assert.ok(avg >= 0n);
    assert.ok(avg < 1_500n, `cycle avg too high: ${avg}`);
  });

  it('decomposition honors default capture efficiency and defaults', () => {
    const d = decomposeSpatialArb({
      pools: syntheticPoolPair(35n),
      daysCapturedPerYear: 180n,
    });
    const expectedCaptured = (27n * DEFAULT_CAPTURE_EFFICIENCY_BPS) / ARB_BPS;
    assert.equal(d.capturedEdgePerTradeBps, expectedCaptured);
    assert.equal(d.costAumBps, DEFAULT_COST_AUM_BPS);
    assert.equal(DEFAULT_COMBINED_LEG_COST_BPS, 8n);
  });

  it('cost is deducted and net never negative', () => {
    const d = decomposeSpatialArb({
      pools: syntheticPoolPair(20n),
      daysCapturedPerYear: 1n,
      slotCeilingBps: 1_000n,
    });
    assert.ok(d.capacityAdjustedApyBps - DEFAULT_COST_AUM_BPS < 0n);
    assert.equal(d.netApyBps, 0n);
  });

  it('regime weight ordering is monotonic', () => {
    const weights = referenceRegimeFixtures().map((f) => decomposeSpatialArb({
      pools: syntheticPoolPair(f.grossSpreadBps),
      daysCapturedPerYear: f.daysCapturedPerYear,
      slotCeilingBps: f.slotCeilingBps,
    }).netApyBps);
    assert.ok(weights[0] <= weights[1]);
    assert.ok(weights[1] <= weights[2]);
  });
});
