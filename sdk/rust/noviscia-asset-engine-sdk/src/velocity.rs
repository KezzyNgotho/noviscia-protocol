//! # Total Value Velocity (TVV) Specification Sheet — Module 2 of the TVV
//! risk engine
//!
//! The velocity layer answering the institutional question: *"How does a 24%
//! base borrowing rate translate into an organic 15%–35% APY without
//! inflation?"* Everything is re-derived from ledger velocity in **integer
//! arithmetic on USD cents** (micro-USD where a per-slot premium is
//! sub-cent) — no floats, no hidden rounding.
//!
//! Reference matrix (the audited `$10,000,000` pool):
//!
//! | Metric | Value | Function |
//! |---|---|---|
//! | Slots/day | `216,000` | `SLOTS_PER_DAY` |
//! | Capital turnover (Form A) | `63,072,000` turns/yr | `capital_turnover_per_year` |
//! | Per-slot premium factor (Form B) | `3,044,140,030` @q1e18 | `slot_premium_scaling_factor` |
//! | Daily transactional power (Form C) | `$414,720,000,000` /day | `daily_transactional_power_usd_cents` |
//! | Gross APY baseline (Form D) | `4.608%` | `gross_apy_tenths_bps` |
//! | Gross APY at 60% pool (`$6M` active) | `11.52%` | `gross_apy_tenths_bps_at_active_volume` |
//! | 24h-compounded APY | `4.715%` | `compounded_apy_tenths_bps` |
//! | Jito landing gap | `20%` | `jito_gap_bps` |
//! | MEV tip slippage | `$6,912` /yr | `jito_tip_slippage_usd_cents` |
//!
//! The counterpart of this module ships in `@noviscia/sdk` (`velocity.ts`) with
//! byte-for-byte identical results; both are pinned by tests against the values
//! above.

use crate::economics::{
    active_utilization_usd_cents, eligible_slots, gross_revenue_usd_cents, mul_div,
    total_slots_per_year, BPS, MICRO_DOLLARS_PER_CENT, TvvParams,
};

/// Fixed-point scale for the per-slot premium factor (q1e18).
pub const FIXED_1E18: u64 = 1_000_000_000_000_000_000;

/// Ledger cadence: 2.5 slots per second (5/2).
pub const SLOTS_PER_SECOND_NUM: u64 = 5;
pub const SLOTS_PER_SECOND_DEN: u64 = 2;

/// One day of non-stop 400ms slots: `86,400 / 0.4`.
pub const SLOTS_PER_DAY: u64 = 216_000;

/// The 24-hour clearing window: micro-premiums recompound once per day.
pub const COMPOUNDING_PERIODS_PER_YEAR: u64 = 365;

/// Scale used by the discrete 24h-compounding loop (q1e12).
const COMPOUND_SCALE: u64 = 1_000_000_000_000;

/// Flooring `n × m / d` over u128 (for q1e18 products that overflow u64).
fn fdiv128(n: u128, m: u128, d: u128) -> u64 {
    (n * m / d) as u64
}

/// Formula A — the capital turnover multiplier: how many discrete times a
/// dollar of pool capital can clear a single-slot borrow in a year.
/// `2.5 turns/sec × 31,536,000 s × L_jito(80%) = 63,072,000 turns/yr`.
/// Identical to Module 1 `eligible_slots` — restated here as *turnover*.
pub fn capital_turnover_per_year(p: &TvvParams) -> u64 {
    eligible_slots(p)
}

/// Formula B — the micro-premium fee-scaling factor `F_slot` (q1e18 fixed
/// point). The 24% annualized base rate spread across all `78,840,000`
/// physical slots: `R_base / S_total ≈ 3.0441e-9 /slot` (`3,044,140,030` at
/// q1e18). The spec sheet prints the rounded `3.0439e-9`.
pub fn slot_premium_scaling_factor(p: &TvvParams) -> u64 {
    fdiv128(
        (p.base_rate_bps as u128) * (FIXED_1E18 as u128),
        1,
        (total_slots_per_year() as u128) * (BPS as u128),
    )
}

/// The micro-premium earned on one eligible turn of the active volume, in
/// micro-USD ($1e-6). Reference pool: `≈ $0.0073059` (`7,305` µUSD) — the same
/// band Module 1 pins via `slot_fee_micro_usd`.
pub fn per_turn_premium_micro_usd(p: &TvvParams) -> u64 {
    let active_micro_usd = mul_div(active_utilization_usd_cents(p), MICRO_DOLLARS_PER_CENT, 1);
    fdiv128(
        active_micro_usd as u128,
        slot_premium_scaling_factor(p) as u128,
        FIXED_1E18 as u128,
    )
}

/// The effective annualized premium *on active volume* once the Jito landing
/// rate is applied: `R_base × L_jito = 19.2%` (reference).
pub fn aggregated_premium_bps(p: &TvvParams) -> u64 {
    mul_div(p.base_rate_bps, p.jito_landing_bps, BPS)
}

/// Formula C — the multiplied daily transactional power: live active volume
/// cleared every landing slot.
///
/// Reference: `$2,400,000 × 216,000 slots × 0.80 = $414,720,000,000 /day`.
/// ⚠️ The spec sheet prints `$414,720,000` — a unit slip (1000×). The
/// formula computes `$414.72 billion`; it reconciles with the year line
/// (`V_turnover × active / 365`). We implement the formula.
pub fn daily_transactional_power_usd_cents(p: &TvvParams) -> u64 {
    let slot_notional = mul_div(active_utilization_usd_cents(p), SLOTS_PER_DAY, 1);
    mul_div(slot_notional, p.jito_landing_bps, BPS)
}

/// Formula C in whole dollars (matrix display row).
pub fn daily_volume_velocity_usd(p: &TvvParams) -> u64 {
    daily_transactional_power_usd_cents(p) / 100
}

/// Formula D — the velocity-compounded gross APY on the *pool*, in tenths of
/// a basis point (1 unit = 0.001%). Reference: `$460,800 / $10,000,000 =
/// 4.608%`. Closed form `R_base × L_jito × (active / pool)`.
pub fn gross_apy_tenths_bps(p: &TvvParams) -> u64 {
    mul_div(gross_revenue_usd_cents(p), BPS * 10, p.pool_usd_cents)
}

/// Formula D evaluated at an explicit active-borrowing volume (in USD cents).
/// Scaling $2.4M → $6M (60% of the pool) lifts APY linearly `4.608% → 11.52%`.
pub fn gross_apy_tenths_bps_at_active_volume(active_usd_cents: u64, p: &TvvParams) -> u64 {
    let priced = mul_div(active_usd_cents, p.base_rate_bps, BPS);
    let landed = mul_div(priced, p.jito_landing_bps, BPS);
    mul_div(landed, BPS * 10, p.pool_usd_cents)
}

/// Formula D reconstructed through the *per-slot route*
/// (`μ × F_slot × S_elig`), aggregated in USD cents. Differs from the closed
/// form only by per-turn flooring (≈ `$59` on the reference pool, < 0.02%).
pub fn per_slot_revenue_usd_cents(p: &TvvParams) -> u64 {
    let per_turn = per_turn_premium_micro_usd(p);
    let annual_micro_usd = mul_div(per_turn, capital_turnover_per_year(p), 1);
    mul_div(annual_micro_usd, 1, MICRO_DOLLARS_PER_CENT)
}

/// Proof harness: the two Formula-D routes agree to within 1% of gross —
/// institutional reviewers can verify the velocity model is self-consistent
/// under integer floors.
pub fn formula_d_reconciles(p: &TvvParams) -> bool {
    let closed = gross_revenue_usd_cents(p);
    let slotted = per_slot_revenue_usd_cents(p);
    let diff = closed.abs_diff(slotted);
    diff.saturating_mul(100) <= closed
}

/// Constraint 1 — the Jito gap: non-landing blocks drop velocity by 20%.
pub fn jito_gap_bps(p: &TvvParams) -> u64 {
    BPS.saturating_sub(p.jito_landing_bps)
}

/// Constraint 2 — MEV bundle tip slippage: a flat cut of gross premiums.
pub fn jito_tip_slippage_usd_cents(p: &TvvParams) -> u64 {
    mul_div(gross_revenue_usd_cents(p), p.jito_tip_bps, BPS)
}

/// Constraint 3 — the 24-hour settlement debt gap: micro-premiums compound
/// once per day (clearinghouse reset), never block-by-block.
pub fn compounded_apy_tenths_bps(p: &TvvParams) -> u64 {
    let gross = gross_revenue_usd_cents(p);
    let periods = COMPOUNDING_PERIODS_PER_YEAR;
    let daily = mul_div(gross, COMPOUND_SCALE, p.pool_usd_cents.saturating_mul(periods));
    let mut acc = COMPOUND_SCALE;
    let mut remaining = periods;
    while remaining > 0 {
        acc = acc.saturating_add(mul_div(acc, daily, COMPOUND_SCALE));
        remaining -= 1;
    }
    let gain = acc - COMPOUND_SCALE;
    mul_div(gain, BPS * 10, COMPOUND_SCALE)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p() -> TvvParams {
        TvvParams::reference_10m()
    }

    #[test]
    fn time_anchor_and_matrix_reconcile_to_the_integer() {
        assert_eq!(SLOTS_PER_SECOND_NUM * 86_400 / SLOTS_PER_SECOND_DEN, 216_000);
        assert_eq!(SLOTS_PER_DAY, 216_000);
        assert_eq!(SLOTS_PER_DAY * 365, total_slots_per_year());
    }

    #[test]
    fn formula_a_capital_turnover() {
        assert_eq!(capital_turnover_per_year(&p()), 63_072_000);
        assert_eq!(capital_turnover_per_year(&p()), eligible_slots(&p()));
    }

    #[test]
    fn formula_b_slot_premium_factor_and_per_turn_premium() {
        assert_eq!(slot_premium_scaling_factor(&p()), 3_044_140_030);
        let per_turn = per_turn_premium_micro_usd(&p());
        assert!((7_300..=7_310).contains(&per_turn), "per-turn µUSD: {per_turn}");
        assert_eq!(aggregated_premium_bps(&p()), 1_920); // 24% × 80% = 19.2%
    }

    #[test]
    fn formula_c_daily_transactional_power() {
        // $2,400,000 × 216,000 × 0.80 = $414,720,000,000/day (1000× the spec
        // sheet's printed display; we implement the formula).
        assert_eq!(daily_transactional_power_usd_cents(&p()), 41_472_000_000_000);
        assert_eq!(daily_volume_velocity_usd(&p()), 414_720_000_000);
    }

    #[test]
    fn formula_d_gross_apy_baseline_and_capacity_scale() {
        assert_eq!(gross_apy_tenths_bps(&p()), 4_608); // 4.608%
        let six_m = p().pool_usd_cents * 6_000 / 10_000; // $6,000,000 = 60% of pool
        assert_eq!(gross_apy_tenths_bps_at_active_volume(six_m, &p()), 11_520); // 11.52%
    }

    #[test]
    fn per_slot_route_reconciles_to_the_closed_form() {
        assert!(formula_d_reconciles(&p()));
        let closed = gross_revenue_usd_cents(&p()); // $460,800.00
        let slotted = per_slot_revenue_usd_cents(&p()); // $460,740.96
        assert!(closed > slotted && closed - slotted < 10_000, "drift too large");
    }

    #[test]
    fn the_three_drags() {
        assert_eq!(jito_gap_bps(&p()), 2_000); // 20%
        assert_eq!(jito_tip_slippage_usd_cents(&p()), 691_200); // $6,912 = 1.5% × $460,800
        let apy = compounded_apy_tenths_bps(&p());
        assert!((4_700..=4_730).contains(&apy), "compounded APY: {apy}");
        assert!(apy > gross_apy_tenths_bps(&p()));
    }

    #[test]
    fn scales_to_other_pool_sizes_without_float() {
        let small = TvvParams {
            pool_usd_cents: 100_000_000, // $1,000,000
            ..TvvParams::default()
        };
        assert_eq!(gross_apy_tenths_bps(&small), gross_apy_tenths_bps(&p()));
        assert_eq!(daily_transactional_power_usd_cents(&small), 4_147_200_000_000);
    }
}