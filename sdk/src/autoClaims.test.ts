/**
 * Claim-free automatic NAV: after a gate settle books profit, LP share value
 * must appreciate with NO explicit claim step, and a redeem at NAV must return
 * principal + the full accrued yield. This pins the on-chain ordering in
 * `tvv_gate_settle` (nv-usdc-vault/src/lib.rs):
 *
 *   1. accrue_slot_yield(cfg, clock.slot)            (lib.rs:5359)
 *   2. total_assets += nav_profit                     (lib.rs:5363)
 *   3. pending_fee_index += nav_profit × SCALE / old  (lib.rs:5370-5376)
 *
 * and the redeem/claim math twins:
 *   - redeem USDC  = shares × total_assets / total_shares   (lib.rs:6172 compute_redeem_usdc)
 *   - claim USDC   = shares × (fee_index − snapshot) / SCALE (lib.rs:1392-1396 claim_yield)
 *
 * The byte-parity slot-accrual twins come from ./accrual.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  accrueSlotYield,
  stageFeeIndexGrowth,
  type SlotAccrualState,
  DEFAULT_ACCRUAL_WINDOW_SLOTS,
} from './accrual';

const FEE_INDEX_SCALE = 1_000_000_000_000_000_000n; // lib.rs:451 (1e18)
const CARRY_BPS = 2_000n; // 20%
const DIF_BPS = 1_500n; // 15% of carry

function settleProfit(
  state: SlotAccrualState,
  vault: { totalAssets: bigint },
  profit: bigint,
  slot: bigint,
): { navProfit: bigint; difRetained: bigint; carryPending: bigint } {
  accrueSlotYield(state, slot); // lib.rs:5359
  const carry = (profit * CARRY_BPS) / 10_000n;
  const difRetained = (carry * DIF_BPS) / 10_000n;
  const carryPending = carry - difRetained;
  const navProfit = profit - carry;
  const oldTotalAssets = vault.totalAssets;
  vault.totalAssets += navProfit; // lib.rs:5363
  if (oldTotalAssets > 0n && navProfit > 0n) {
    const delta = (navProfit * FEE_INDEX_SCALE) / oldTotalAssets;
    state.pendingFeeIndex += delta; // lib.rs:5370-5376
  }
  return { navProfit, difRetained, carryPending };
}

const redeemAtNav = (shares: bigint, vault: { totalAssets: bigint; totalShares: bigint }): bigint =>
  (shares * vault.totalAssets) / vault.totalShares; // compute_redeem_usdc parity

const claimableYield = (shares: bigint, feeIndex: bigint, snapshot: bigint): bigint =>
  (shares * (feeIndex - snapshot)) / FEE_INDEX_SCALE; // claim_yield parity

describe('claim-free automatic NAV', () => {
  it('a profitable settle appreciates share NAV instantly, with no claim step', () => {
    const vault = { totalAssets: 1_000_000_000_000n, totalShares: 1_000_000_000_000n }; // 1 USDC/share
    const accrual: SlotAccrualState = {
      feeIndex: 0n,
      pendingFeeIndex: 0n,
      lastAccrualSlot: 100n,
      accrualWindowSlots: DEFAULT_ACCRUAL_WINDOW_SLOTS,
    };
    const lpShares = 100_000_000_000n; // 10% of the pool

    // A gate settle books 5,000 USDC profit (20% carry / 15% DIF).
    const profit = 5_000_000_000n; // atoms
    const { navProfit, difRetained, carryPending } = settleProfit(accrual, vault, profit, 150n);

    assert.equal(navProfit, 4_000_000_000n);
    assert.equal(difRetained, 150_000_000n);
    assert.equal(carryPending, 850_000_000n);

    // NAV/share already up at the settle slot — redemption is claim-free.
    const redeemNow = redeemAtNav(lpShares, vault);
    assert.equal(redeemNow, 100_400_000_000n); // principal 100,000 + 400 USDC yield, no claim called
    assert.ok(redeemNow > 100_000_000_000n);

    // The same claim-free amount holds after the full accrual window elapses.
    accrueSlotYield(accrual, 150n + DEFAULT_ACCRUAL_WINDOW_SLOTS);
    const redeemLater = redeemAtNav(lpShares, vault);
    assert.equal(redeemLater, redeemNow, 'redemption is claim-free at any slot');
  });

  it('slot release drains staged index into claimable yield, Σ released ≡ Σ staged', () => {
    const vault = { totalAssets: 1_000_000_000_000n, totalShares: 1_000_000_000_000n };
    const accrual: SlotAccrualState = {
      feeIndex: 0n,
      pendingFeeIndex: 0n,
      lastAccrualSlot: 100n,
      accrualWindowSlots: DEFAULT_ACCRUAL_WINDOW_SLOTS,
    };
    const lpShares = 100_000_000_000n;

    settleProfit(accrual, vault, 10_000_000_000n, 150n);
    const staged = accrual.pendingFeeIndex;
    assert.ok(staged > 0n, 'settle stages the index delta for per-slot release');

    let released = 0n;
    for (let s = 151n; s <= 150n + DEFAULT_ACCRUAL_WINDOW_SLOTS; s++) {
      released += accrueSlotYield(accrual, s);
    }

    // Per-slot drip conserves: released + residual ≡ staged (integer floors
    // leave a tail in pending that any later call drips; no yield is minted).
    assert.ok(accrual.feeIndex > 0n, 'per-slot drip made yield claimable without any claim step');
    assert.ok(accrual.pendingFeeIndex > 0n, 'integer floor leaves a tail to drip next call');
    assert.equal(released + accrual.pendingFeeIndex, staged, 'Σ released + residual ≡ Σ staged');
    assert.equal(accrual.feeIndex + accrual.pendingFeeIndex, staged);

    // A call past the window drains pending×window/window = pending entirely.
    const residual = accrual.pendingFeeIndex;
    const drained = accrueSlotYield(accrual, 150n + 2n * DEFAULT_ACCRUAL_WINDOW_SLOTS);
    assert.equal(drained, residual, 'full auto-release drains pending');
    assert.equal(accrual.pendingFeeIndex, 0n);
    assert.equal(accrual.feeIndex, staged);

    // The claimable-yield (fee_index) path and the redeem-at-NAV path agree.
    const viaIndex = claimableYield(lpShares, accrual.feeIndex, 0n);
    const viaNav = redeemAtNav(lpShares, vault) - lpShares;
    assert.equal(viaIndex, viaNav);
  });

  it('late claims catch up automatically — a claim mid-window pays the released portion only, fully later', () => {
    const vault = { totalAssets: 1_000_000_000_000n, totalShares: 1_000_000_000_000n };
    const accrual: SlotAccrualState = {
      feeIndex: 0n,
      pendingFeeIndex: 0n,
      lastAccrualSlot: 100n,
      accrualWindowSlots: DEFAULT_ACCRUAL_WINDOW_SLOTS,
    };
    const lpShares = 100_000_000_000n;

    settleProfit(accrual, vault, 10_000_000_000n, 150n);
    const totalYield = claimableYield(lpShares, accrual.feeIndex + accrual.pendingFeeIndex, 0n);

    // Claim at slot 200 — only the linearly-released slice is claimable, then it
    // becomes fully claimable once the window elapses (claims never lose yield).
    accrueSlotYield(accrual, 200n);
    const mid = claimableYield(lpShares, accrual.feeIndex, 0n);
    assert.ok(mid > 0n && mid < totalYield);

    accrueSlotYield(accrual, 200n + DEFAULT_ACCRUAL_WINDOW_SLOTS);
    const full = claimableYield(lpShares, accrual.feeIndex, 0n);
    assert.equal(full, totalYield);
  });
});