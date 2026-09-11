import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  s1DrawAllowed,
  s1Toll,
  tollSplit,
  s2Available,
  marginHaircutFloor,
  s2DrawHealthy,
  s2WindowElapsed,
  waterfallAfterMargin,
  simulateWaterfall,
  DEFAULT_S2_MARGIN_BPS,
} from './tvv';

function cap(active: boolean, ceiling: number, slotKey: number) {
  return {
    vaultConfig: 'x',
    active,
    slotCeilingUsd: ceiling,
    jitoWindowSlots: 2,
    strictBundle: true,
    tollBps: 5,
    drawsThisSlot: 0,
    slotKey,
  };
}

test('s1_draw respects slot window and ceiling', () => {
  const c = cap(true, 1_000_000, 42);
  assert.equal(s1DrawAllowed(c, 42, 500_000), true);
  assert.equal(s1DrawAllowed(c, 43, 500_000), false); // wrong slot
  assert.equal(s1DrawAllowed(c, 42, 1_500_000), false); // over ceiling
  assert.equal(s1DrawAllowed(c, 42, 0), false); // zero
  assert.equal(s1DrawAllowed(cap(false, 1_000_000, 42), 42, 100), false);
});

test('s1 draws accumulate against ceiling', () => {
  const used = { ...cap(true, 1_000_000, 7), drawsThisSlot: 600_000 };
  assert.equal(s1DrawAllowed(used, 7, 400_000), true);
  assert.equal(s1DrawAllowed(used, 7, 400_001), false);
});

test('s1 toll is bps slice', () => {
  assert.equal(s1Toll(1_000_000, 5), 500);
  assert.equal(s1Toll(100, 5), 0); // floors to 0
  assert.equal(s1Toll(1_000_000, 0), 0);
});

test('toll split is 90/10', () => {
  const [nav, treasury] = tollSplit(1_000_000);
  assert.equal(nav, 900_000);
  assert.equal(treasury, 100_000);
  assert.equal(nav + treasury, 1_000_000);
});

test('s2 draw bounded by limit', () => {
  const base = { desk: 'd', vaultConfig: 'v', totalLimit: 1_500_000, drawn: 0, marginPosted: 0, marginBps: DEFAULT_S2_MARGIN_BPS, frozen: false, dayOpenSlot: 0 };
  assert.equal(s2Available(base), 1_500_000);
  assert.equal(s2Available({ ...base, drawn: 1_000_000 }), 500_000);
  assert.equal(s2Available({ ...base, drawn: 1_500_000 }), 0);
});

test('margin haircut floor', () => {
  assert.equal(marginHaircutFloor(1_000_000, 5_000), 500_000);
  assert.equal(marginHaircutFloor(0, 5_000), 0);
});

test('draw health requires margin floor', () => {
  assert.equal(s2DrawHealthy(300_000, 5_000, 100_000), true);
  assert.equal(s2DrawHealthy(300_000, 5_000, 400_000), true);
  assert.equal(s2DrawHealthy(300_000, 5_000, 700_000), false);
  assert.equal(s2DrawHealthy(0, 5_000, 5), false);
});

test('window elapsed', () => {
  assert.equal(s2WindowElapsed(100, 101, 1), true);
  assert.equal(s2WindowElapsed(100, 100, 1), false);
});

test('waterfall after margin is saturating', () => {
  assert.equal(waterfallAfterMargin(1_000_000, 400_000), 600_000);
  assert.equal(waterfallAfterMargin(1_000_000, 1_200_000), 0);
});

test('waterfall order preserved', () => {
  const [uncovered, p, i, ins, d] = simulateWaterfall(1_000_000, 300_000, 200_000, 150_000, 100_000);
  assert.deepEqual([p, i, ins, d], [300_000, 200_000, 150_000, 100_000]);
  assert.equal(uncovered, 250_000);
});

test('waterfall stops at first covering layer', () => {
  const [uncovered, p, i, ins, d] = simulateWaterfall(100_000, 500_000, 500_000, 500_000, 500_000);
  assert.equal(uncovered, 0);
  assert.equal(p, 100_000);
  assert.equal(i, 0);
  assert.equal(ins, 0);
  assert.equal(d, 0);
});
