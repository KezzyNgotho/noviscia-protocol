/**
 * Continuous fixed-point compound-rate (slot-based yield) math twin.
 *
 * Byte-parity TS reference for the on-chain `accrue_slot_yield` /
 * `stage_fee_index_growth` helpers in `nv-usdc-vault/src/lib.rs`. All values
 * are u128/u64 lanes expressed as `bigint`; no floats — the release schedule is
 * strictly linear across the accrual window and capped by `pendingFeeIndex`, so
 * Σ released ≡ Σ staged revenue and no unbacked yield is ever minted.
 *
 * The clock is the on-chain slot: revenue is staged into `pendingFeeIndex` and
 * released into `feeIndex` pro-rata per slot (`pending × capped / window`),
 * which is why the exchange rate ticks upward every slot — the same `r_slot`
 * cadence (≈3.8e-9 @ 35% APY) the live ticker displays.
 */

export const SLOTS_PER_YEAR = 78_840_000n;
export const DEFAULT_ACCRUAL_WINDOW_SLOTS = 300n;
export const DEFAULT_TARGET_APY_BPS = 3_500;

/** The slot-accrual state carried on `VaultConfig` (offsets 358–382 on-chain). */
export interface SlotAccrualState {
  /** Cumulative released (realized) revenue per share × INDEX_SCALE. */
  feeIndex: bigint;
  /** Staged but not-yet-released revenue per share × INDEX_SCALE. */
  pendingFeeIndex: bigint;
  /** Last slot the clock was advanced to (never ahead of last + window). */
  lastAccrualSlot: bigint;
  /** Slot window over which staged revenue releases (default 300 ≈ 2 min). */
  accrualWindowSlots: bigint;
}

const MAX_PENDING = (1n << 128n) - 1n;

/**
 * Mutating accrue — a byte-for-byte twin of `accrue_slot_yield`:
 * `release = pending × min(elapsed, window) / window`, `lastAccrualSlot`
 * advances only by the capped elapsed so leftover pending keeps dripping even
 * when calls are sparse. Returns the released delta for callers that need it
 * (0 when nothing moved).
 */
export function accrueSlotYield(state: SlotAccrualState, currentSlot: bigint): bigint {
  if (state.pendingFeeIndex === 0n || state.accrualWindowSlots === 0n) {
    state.lastAccrualSlot = currentSlot;
    return 0n;
  }
  const window = state.accrualWindowSlots;
  let elapsed = currentSlot - state.lastAccrualSlot;
  if (elapsed < 0n) elapsed = 0n; // clock never runs backwards
  if (elapsed === 0n) return 0n;
  const capped = elapsed < window ? elapsed : window;
  const release = (state.pendingFeeIndex * capped) / window;
  if (release > 0n) {
    state.feeIndex = state.feeIndex + release;
    state.pendingFeeIndex = state.pendingFeeIndex - release;
  }
  state.lastAccrualSlot = state.lastAccrualSlot + capped;
  return release;
}

/**
 * Stage a realized NAV-growth delta for per-slot release: first accrue any
 * previously staged index up to `currentSlot`, then top up `pendingFeeIndex`
 * (saturating at u128::MAX — twin of `stage_fee_index_growth`).
 */
export function stageFeeIndexGrowth(
  state: SlotAccrualState,
  delta: bigint,
  currentSlot: bigint,
): void {
  accrueSlotYield(state, currentSlot);
  const overflow = delta > MAX_PENDING - state.pendingFeeIndex;
  state.pendingFeeIndex = overflow ? MAX_PENDING : state.pendingFeeIndex + delta;
}

/**
 * Non-mutating projection of `feeIndex` were the clock advanced to
 * `currentSlot`. Mirrors the `/api/vault/yield` route's
 * `feeIndexProjected = feeIndex + pending × min(elapsed, window)/window`.
 */
export function projectFeeIndex(state: SlotAccrualState, currentSlot: bigint): bigint {
  if (state.pendingFeeIndex === 0n || state.accrualWindowSlots === 0n) return state.feeIndex;
  let elapsed = currentSlot - state.lastAccrualSlot;
  if (elapsed < 0n) elapsed = 0n;
  if (elapsed === 0n) return state.feeIndex;
  if (elapsed > state.accrualWindowSlots) elapsed = state.accrualWindowSlots;
  return state.feeIndex + (state.pendingFeeIndex * elapsed) / state.accrualWindowSlots;
}

/** Range-pin an APY (bps) so the live ticker never shows a runaway rate. */
export function clampTargetApyBps(apyBps: number): number {
  if (apyBps < 0) return 0;
  return apyBps > 10_000 ? 10_000 : apyBps;
}