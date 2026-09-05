/**
 * Total Value Velocity (TVV) Specification Sheet — Module 2 of the TVV risk engine.
 *
 * The velocity layer that answers the institutional question: *"How does a 24%
 * base borrowing rate translate into an organic 15%–35% APY without
 * inflation?"* It re-derives Module 1's `$460,800` gross on the reference
 * `$10,000,000` pool purely from ledger velocity (2.5 single-slot turns/sec,
 * 80% eligible Jito landing), and adds the three structural drags (Jito gap,
 * MEV tip slippage, 24-hour settlement compounding).
 *
 * Every figure is computed in **integer (bigint) arithmetic on USD cents**
 * (micro-USD where a per-slot premium is sub-cent), the byte-for-byte twin of
 * `noviscia-asset-engine-sdk::velocity`.
 *
 * Reference matrix (audited `$10,000,000` pool):
 *
 * | Metric | Value | Function |
 * |---|---|---|
 * | Max network slots/yr | `78,840,000` | `totalSlotsPerYear` (Module 1) |
 * | Slots/day | `216,000` | `slotsPerDay` |
 * | Capital turnover (Form A) | `63,072,000` turns/yr | `capitalTurnoverPerYear` |
 * | Per-slot premium factor (Form B) | `3.0441e-9` /slot | `slotPremiumScalingFactor` |
 * | Daily transactional power (Form C) | `$414,720,000,000` /day | `dailyTransactionalPowerUsdCents` |
 * | Gross APY baseline (Form D) | `4.608%` | `grossApyTenthsBps` |
 * | Gross APY at 60% pool (`$6M` active) | `11.52%` | `grossApyTenthsBpsAtActiveVolume` |
 * | 24h-compounded APY | ≈ `4.71%` | `compoundedApyTenthsBps` |
 * | Jito landing gap | `20%` | `jitoGapBps` |
 * | MEV tip slippage | `$6,912` /yr | `jitoTipSlippageUsdCents` |
 */

import {
  ECONOMICS_BPS,
  MICRO_DOLLARS_PER_CENT,
  mulDiv,
  totalSlotsPerYear,
  eligibleSlots,
  activeUtilizationUsdCents,
  grossRevenueUsdCents,
  type TvvParams,
} from './economics';

/** Fixed-point scale for the per-slot premium factor (q1e18). */
export const FIXED_1E18 = 1_000_000_000_000_000_000n;

/** Ledger cadence: 2.5 slots per second = 5/2. */
export const SLOTS_PER_SECOND_NUM = 5n;
export const SLOTS_PER_SECOND_DEN = 2n;

/** One day of non-stop 400ms slots: `86,400 / 0.4`. */
export const SLOTS_PER_DAY = 216_000n;

/** The 24-hour clearing window: micro-premiums recompound once per day. */
export const COMPOUNDING_PERIODS_PER_YEAR = 365n;

/** Scale used by the discrete 24h-compounding loop (q1e12). */
const COMPOUND_SCALE = 1_000_000_000_000n;

/**
 * Formula A — the capital turnover multiplier: how many discrete times a
 * dollar of pool capital can clear a single-slot borrow in a year.
 *
 * `2.5 turns/sec × 31,536,000 s × L_jito(80%) = 63,072,000 turns/yr`.
 * Identical to Module 1 `eligibleSlots` — restated here as *turnover*.
 */
export function capitalTurnoverPerYear(p: TvvParams): bigint {
  return eligibleSlots(p);
}

/**
 * Formula B — the micro-premium fee-scaling factor `F_slot` (q1e18 fixed
 * point). The 24% annualized base rate spread across all `78,840,000`
 * physical slots: `R_base / S_total ≈ 3.0441e-9 /slot` (`3,044,139,075` at
 * q1e18). The spec sheet prints the rounded `3.0439e-9`.
 */
export function slotPremiumScalingFactor(p: TvvParams): bigint {
  return mulDiv(
    p.baseRateBps * FIXED_1E18,
    1n,
    totalSlotsPerYear() * ECONOMICS_BPS,
  );
}

/**
 * The micro-premium earned on one eligible turn of the active volume, in
 * micro-USD ($1e-6). Reference pool: `≈ $0.0073059` (`7,305` µUSD) — the same
 * band Module 1 pins via `slotFeeMicroUsd`.
 */
export function perTurnPremiumMicroUsd(p: TvvParams): bigint {
  const activeMicroUsd = mulDiv(activeUtilizationUsdCents(p), MICRO_DOLLARS_PER_CENT, 1n);
  return mulDiv(activeMicroUsd, slotPremiumScalingFactor(p), FIXED_1E18);
}

/**
 * The effective annualized premium *on active volume* once the Jito landing
 * rate is applied: `R_base × L_jito = 19.2%` (reference). This is the
 * aggregation the per-slot `F_slot` reconstructs.
 */
export function aggregatedPremiumBps(p: TvvParams): bigint {
  return mulDiv(p.baseRateBps, p.jitoLandingBps, ECONOMICS_BPS);
}

/**
 * Formula C — the multiplied daily transactional power: live active volume
 * cleared every landing slot.
 *
 * Reference: `$2,400,000 × 216,000 slots × 0.80 = $414,720,000,000 /day`.
 * ⚠️ The spec sheet prints `$414,720,000` — a unit slip (1000×). The formula
 * computes `$414.72 billion`; the figure reconciles to the year line
 * (`V_turnover × active` / 365). We implement the formula.
 */
export function dailyTransactionalPowerUsdCents(p: TvvParams): bigint {
  const slotNotional = mulDiv(activeUtilizationUsdCents(p), SLOTS_PER_DAY, 1n);
  return mulDiv(slotNotional, p.jitoLandingBps, ECONOMICS_BPS);
}

/** Formula C in whole dollars (for the matrix display row). */
export function dailyVolumeVelocityUsd(p: TvvParams): bigint {
  return dailyTransactionalPowerUsdCents(p) / 100n;
}

/**
 * Formula D — the velocity-compounded gross APY on the *pool*, in tenths of a
 * basis point (1 unit = 0.001%). Reference: `$460,800 / $10,000,000 = 4.608%`.
 *
 * Closed form `R_base × L_jito × (active / pool)`; equals
 * `grossRevenueUsdCents(p) / poolUsdCents`.
 */
export function grossApyTenthsBps(p: TvvParams): bigint {
  return mulDiv(grossRevenueUsdCents(p), ECONOMICS_BPS * 10n, p.poolUsdCents);
}

/**
 * Formula D evaluated at an explicit active-borrowing volume (whole dollars'
 * worth in USD cents). Reference: scaling $2.4M → $6M (60% of the pool) lifts
 * APY linearly `4.608% → 11.52%`.
 */
export function grossApyTenthsBpsAtActiveVolume(activeUsdCents: bigint, p: TvvParams): bigint {
  const priced = mulDiv(activeUsdCents, p.baseRateBps, ECONOMICS_BPS);
  const landed = mulDiv(priced, p.jitoLandingBps, ECONOMICS_BPS);
  return mulDiv(landed, ECONOMICS_BPS * 10n, p.poolUsdCents);
}

/**
 * Formula D reconstructed through the *per-slot route* (`μ × F_slot × S_elig`),
 * aggregated in USD cents. Differs from the closed form only by per-turn
 * flooring (≈ `$59` on the reference pool, < 0.02%).
 */
export function perSlotRevenueUsdCents(p: TvvParams): bigint {
  const perTurn = perTurnPremiumMicroUsd(p);
  const annualMicroUsd = mulDiv(perTurn, capitalTurnoverPerYear(p), 1n);
  return mulDiv(annualMicroUsd, 1n, MICRO_DOLLARS_PER_CENT);
}

/**
 * Proof harness: the two Formula-D routes agree to within 1% of gross —
 * institutional reviewers can verify the velocity model is self-consistent
 * under integer floors.
 */
export function formulaDReconciles(p: TvvParams): boolean {
  const closed = grossRevenueUsdCents(p);
  const slotted = perSlotRevenueUsdCents(p);
  const diff = closed > slotted ? closed - slotted : slotted - closed;
  return diff * 100n <= closed;
}

/** Constraint 1 — the Jito gap: non-landing blocks drop velocity by 20%. */
export function jitoGapBps(p: TvvParams): bigint {
  return ECONOMICS_BPS - p.jitoLandingBps;
}

/** Constraint 2 — MEV bundle tip slippage: a flat cut of gross premiums. */
export function jitoTipSlippageUsdCents(p: TvvParams): bigint {
  return mulDiv(grossRevenueUsdCents(p), p.jitoTipBps, ECONOMICS_BPS);
}

/**
 * Constraint 3 — the 24-hour settlement debt gap: micro-premiums compound
 * once per day (clearinghouse reset), never block-by-block. Shows the gross
 * APY after daily compounding.
 */
export function compoundedApyTenthsBps(p: TvvParams): bigint {
  const gross = grossRevenueUsdCents(p);
  const periods = COMPOUNDING_PERIODS_PER_YEAR;
  const daily = mulDiv(gross, COMPOUND_SCALE, p.poolUsdCents * periods);
  let acc = COMPOUND_SCALE;
  for (let i = 0n; i < periods; i++) {
    acc = acc + mulDiv(acc, daily, COMPOUND_SCALE);
  }
  const gain = acc - COMPOUND_SCALE;
  return mulDiv(gain, ECONOMICS_BPS * 10n, COMPOUND_SCALE);
}