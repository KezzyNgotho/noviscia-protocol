import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  accrueSlotYield,
  stageFeeIndexGrowth,
  projectFeeIndex,
  clampTargetApyBps,
  SLOTS_PER_YEAR,
  DEFAULT_ACCRUAL_WINDOW_SLOTS,
} from './accrual';
import type { SlotAccrualState } from './accrual';

function state(pending: bigint, window: bigint = 10n, last: bigint = 0n, fee: bigint = 0n): SlotAccrualState {
  return { feeIndex: fee, pendingFeeIndex: pending, lastAccrualSlot: last, accrualWindowSlots: window };
}

describe('accrueSlotYield', () => {
  it('releases staged revenue pro-rata over the window (in-slot drip)', () => {
    const s = state(100n);
    assert.equal(accrueSlotYield(s, 5n), 50n); // 100 × 5/10
    assert.equal(s.feeIndex, 50n);
    assert.equal(s.pendingFeeIndex, 50n);
    assert.equal(s.lastAccrualSlot, 5n);

    // Second step finishes the window (clamped at `window`, no overshoot).
    assert.equal(accrueSlotYield(s, 100n), 50n);
    assert.equal(s.feeIndex, 100n);
    assert.equal(s.pendingFeeIndex, 0n);
    assert.equal(s.lastAccrualSlot, 15n);
  });

  it('caps elapsed at the window (a 10k-slot gap releases only the window)', () => {
    const s = state(100n);
    assert.equal(accrueSlotYield(s, 10_000n), 100n);
    assert.equal(s.feeIndex, 100n);
    assert.equal(s.pendingFeeIndex, 0n);
    assert.equal(s.lastAccrualSlot, 10n);
  });

  it('with no pending revenue, the clock fast-forwards (index untouched)', () => {
    const s = state(0n);
    assert.equal(accrueSlotYield(s, 9_999n), 0n);
    assert.equal(s.feeIndex, 0n);
    assert.equal(s.lastAccrualSlot, 9_999n);
  });

  it('with a zero window, the clock fast-forwards (never divides by zero)', () => {
    const s = state(100n, 0n);
    assert.equal(accrueSlotYield(s, 9_999n), 0n);
    assert.equal(s.pendingFeeIndex, 100n);
    assert.equal(s.lastAccrualSlot, 9_999n);
  });

  it('same-slot calls are a no-op', () => {
    const s = state(100n, 10n, 7n, 10n);
    assert.equal(accrueSlotYield(s, 7n), 0n);
    assert.equal(s.feeIndex, 10n);
    assert.equal(s.pendingFeeIndex, 100n);
    assert.equal(s.lastAccrualSlot, 7n);
  });

  it('a backwards clock is ignored (never reverts released revenue)', () => {
    const s = state(100n, 10n, 50n);
    assert.equal(accrueSlotYield(s, 20n), 0n);
    assert.equal(s.feeIndex, 0n);
    assert.equal(s.lastAccrualSlot, 50n);
  });

  it('sparse calls drip the leftover and Σ released ≡ staged revenue', () => {
    const s = state(1_000n, 100n);
    accrueSlotYield(s, 30n); // 300 (capped elapsed 30)
    accrueSlotYield(s, 45n); // 105 (capped elapsed 15 → clock at 45)
    accrueSlotYield(s, 250n); // window end → remaining 595
    assert.equal(s.feeIndex, 1_000n, 'everything staged eventually hits the index');
    assert.equal(s.pendingFeeIndex, 0n);
    assert.equal(s.lastAccrualSlot, 145n, 'advanced per call: 30+15+100');
  });
});

describe('stageFeeIndexGrowth', () => {
  it('accrues stale revenue first, then tops up the pending pool', () => {
    const s = state(100n, 10n);
    stageFeeIndexGrowth(s, 50n, 5n);
    assert.equal(s.feeIndex, 50n, 'stale staged revenue released first');
    assert.equal(s.pendingFeeIndex, 100n, '50 leftover + 50 newly staged');
    assert.equal(s.lastAccrualSlot, 5n);

    // Same-slot top-up adds without a second release.
    stageFeeIndexGrowth(s, 25n, 5n);
    assert.equal(s.pendingFeeIndex, 125n);
    assert.equal(s.lastAccrualSlot, 5n);
  });

  it('saturates at u128::MAX for runaway staging', () => {
    const s = state((1n << 128n) - 1n - 5n, 10n, 1n);
    stageFeeIndexGrowth(s, 500n, 1n); // same-slot → no release first
    assert.equal(s.pendingFeeIndex, (1n << 128n) - 1n);
  });
});

describe('projectFeeIndex', () => {
  it('matches accrue-to-current-slot without mutating state', () => {
    const s = state(200n, 50n, 100n, 1_000_000_000_000_000_000n);
    assert.equal(projectFeeIndex(s, 125n), 1_000_000_000_000_000_100n); // +200 × 25/50
    assert.equal(s.pendingFeeIndex, 200n, 'projection is read-only');
    assert.equal(s.lastAccrualSlot, 100n);
    assert.equal(s.feeIndex, 1_000_000_000_000_000_000n);
  });

  it('caps the projection at the window (no unbounded forward-look)', () => {
    const s = state(200n, 50n, 100n);
    assert.equal(projectFeeIndex(s, 10_000n), 200n);
  });

  it('returns the realized index when nothing is staged', () => {
    const s = state(0n, 50n, 100n, 777n);
    assert.equal(projectFeeIndex(s, 10_000n), 777n);
  });
});

describe('constants', () => {
  it('pins the compound clock to the on-chain values', () => {
    assert.equal(SLOTS_PER_YEAR, 78_840_000n);
    assert.equal(DEFAULT_ACCRUAL_WINDOW_SLOTS, 300n);
  });
  it('clamps the display APY to a sane band', () => {
    assert.equal(clampTargetApyBps(-100), 0);
    assert.equal(clampTargetApyBps(3_500), 3_500);
    assert.equal(clampTargetApyBps(99_999), 10_000);
  });
});