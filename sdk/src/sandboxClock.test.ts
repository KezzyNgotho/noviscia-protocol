import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCELERATION,
  REAL_SLOTS_PER_DAY,
  REAL_GRACE_SLOTS,
  WINDOW_SANDBOX_SLOTS,
  GRACE_SANDBOX_SLOTS,
  SANDBOX_CADENCE_MS,
  realToSandboxSlots,
  sandboxToRealSlots,
  postureAt,
  Posture,
  windowWallClockSeconds,
} from './sandboxClock';
import {
  describePosture,
  frozenDesks,
  anyFrozen,
  sandboxSlotsToWallMs,
} from './sandboxAccelerator';

test('1440x projection collapses a real day to 60s', () => {
  assert.equal(ACCELERATION, 1_440);
  assert.equal(WINDOW_SANDBOX_SLOTS, 150);
  assert.equal(GRACE_SANDBOX_SLOTS, 12.5);
  assert.equal(realToSandboxSlots(REAL_SLOTS_PER_DAY), 150);
  assert.equal(realToSandboxSlots(REAL_GRACE_SLOTS), GRACE_SANDBOX_SLOTS);
  assert.equal(sandboxToRealSlots(WINDOW_SANDBOX_SLOTS), REAL_SLOTS_PER_DAY);
});

test('one accelerated day at the stream cadence is exactly 60s', () => {
  assert.equal(windowWallClockSeconds(SANDBOX_CADENCE_MS), 60);
  assert.equal(windowWallClockSeconds(600), 90);
});

test('sandbox window is a rational 150 + 12.5 slots', () => {
  assert.equal(WINDOW_SANDBOX_SLOTS, 150);
  assert.equal(GRACE_SANDBOX_SLOTS, 12.5);
  // The grace projection is NOT an integer — that's the point of the rational
  // scale which the sandbox stream advances at half-slot resolution.
  assert.ok(!Number.isInteger(GRACE_SANDBOX_SLOTS));
});

test('posture machine agrees with on-chain semantics', () => {
  const w = 100;
  assert.equal(postureAt(w, 100, true), Posture.Open);
  assert.equal(postureAt(w, w + 149, true), Posture.Open);
  // t == w + WINDOW is OVERDUE, exactly as on-chain `>= mature`.
  assert.equal(postureAt(w, w + 150, true), Posture.Overdue);
  assert.equal(postureAt(w, w + 162, true), Posture.Overdue); // within 12.5 grace
  assert.equal(postureAt(w, w + 163, true), Posture.Breached); // 262.5 ≥ mature+grace
  assert.equal(postureAt(0, 999, true), Posture.NoWindow); // window never opened
  assert.equal(postureAt(w, 999999, false), Posture.NoWindow);
});

test('freeze predicate isolates only breached desks', () => {
  const desks = [
    { institution: 'A', mint: 'USDC', posture: Posture.Open },
    { institution: 'B', mint: 'NVSC', posture: Posture.Breached },
    { institution: 'C', mint: 'wSOL', posture: Posture.Overdue },
  ];
  assert.deepEqual(frozenDesks(desks), [{ institution: 'B', mint: 'NVSC' }]);
  assert.equal(anyFrozen(desks), true);
  assert.equal(anyFrozen(desks.filter((d) => d.posture !== Posture.Breached)), false);
});

test('wall-clock projections are round-trip consistent', () => {
  assert.equal(sandboxSlotsToWallMs(WINDOW_SANDBOX_SLOTS, 400), 60_000);
  assert.equal(realToSandboxSlots(REAL_SLOTS_PER_DAY) * ACCELERATION, REAL_SLOTS_PER_DAY);
});

test('human-readable posture labels', () => {
  assert.match(describePosture(Posture.Open), /open.*clearing window/i);
  assert.match(describePosture(Posture.Breached), /breached/i);
  assert.match(describePosture(Posture.NoWindow), /nothing outstanding/i);
});