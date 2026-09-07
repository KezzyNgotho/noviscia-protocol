//! # Borrower Feasibility Proof — Module 3 of the TVV risk engine
//!
//! The desk-level economics that prove the micro-premium is a **structural
//! credit util** (renting capital velocity), not an emission: a searcher pays a
//! sub-cent toll because it is imperceptible against the spread they already
//! capture.
//!
//! Reference scenario (the audited `$10,000,000` pool, max desk):
//!
//! | Item | Formula | Result |
//! |---|---|---|
//! | Single-desk cap (`C_desk`) | 15% of `$10M` | `$1,500,000` |
//! | Per-slot toll on a max desk | `C_desk × R_base / S_total` | `≈ $0.004566` (4,566 µUSD) |
//! | Cross-DEX spread @ 15 bps | `C_desk × 0.15%` | `$2,250.00` |
//! | Aggressive Jito MEV tip (60%) | `60% × spread` | `$1,350.00` |
//! | Borrower net (ex-ante toll) | spread − tip | `$900.00` |
//! | Toll share of gross spread | toll / spread | `2,029 ppb` (≈ 0.0002%) |
//! | Toll share of borrower net | toll / net | `≈ 5 ppm` |
//! | Max-desk annual toll @ full landing | toll × `S_elig` | `$287,986.75` |
//!
//! All figures are integer arithmetic on USD cents / micro-USD, the byte-for-byte
//! twin of `@noviscia/sdk` `feasibility.ts` (Module 3).
//!
//! Precision notes for reviewers: exact integer floors give the max-desk toll
//! `$0.004566` (the `$0.004565` printed in marketing material rounds down), and
//! the borrower net is an exact `$900.00` (`$2,250 − $1,350`).

use crate::economics::{mul_div, total_slots_per_year, BPS, MICRO_DOLLARS_PER_CENT, TvvParams};
use crate::economics::{desk_cap_usd_cents, eligible_slots, systemic_cap_usd_cents};

/// The reference cross-DEX mismatch used by the borrower example (15 bps).
pub const REF_MISMATCH_BPS: u64 = 15;
/// The aggressive Jito bundle tip share used by the borrower example (60%).
pub const REF_TIP_SHARE_BPS: u64 = 6_000;

const PARTS_PER_BILLION: u64 = 1_000_000_000;
const PARTS_PER_MILLION: u64 = 1_000_000;

/// The single-slot toll on a specific desk, in micro-USD ($1e-6):
/// `floor(desk × R_base / S_total)`. Reference max desk: 4,566 µUSD.
pub fn desk_slot_toll_micro_usd(p: &TvvParams, desk_usd_cents: u64) -> u64 {
    let annual = mul_div(desk_usd_cents, p.base_rate_bps, BPS);
    mul_div(annual, MICRO_DOLLARS_PER_CENT, total_slots_per_year())
}

/// The toll on a max-sized desk (`C_desk`). Reference: 4,566 µUSD / slot.
pub fn max_desk_slot_toll_micro_usd(p: &TvvParams) -> u64 {
    desk_slot_toll_micro_usd(p, desk_cap_usd_cents(p))
}

/// The execution-sizing lever the HFT pitch rests on: how many times the desk's
/// own fluid wallet cash the single-desk cap lets it borrow per slot.
/// Reference: a desk with `$100,000` fluid on its wallet borrows **15×** that
/// at the `$1.5M` cap. Zero wallet cash → 0× (no multiplier).
pub fn desk_sizing_multiplier_usd(p: &TvvParams, wallet_usd_cents: u64) -> u64 {
    if wallet_usd_cents == 0 {
        return 0;
    }
    desk_cap_usd_cents(p) / wallet_usd_cents
}

/// How many max-sized desks the systemic cap can host at once on the reference
/// pool: `floor(C_sys / C_desk)`, floored at 1. Reference: 60% / 15% = **4**.
pub fn max_concurrent_max_desks(p: &TvvParams) -> u64 {
    let sys = systemic_cap_usd_cents(p);
    let desk = desk_cap_usd_cents(p);
    if desk == 0 {
        return 0;
    }
    (sys / desk).max(1)
}

/// Gross spread a desk captures on one route: `desk × mismatch_bps / BPS`.
pub fn borrower_gross_spread_usd_cents(desk_usd_cents: u64, mismatch_bps: u64) -> u64 {
    mul_div(desk_usd_cents, mismatch_bps, BPS)
}

/// The Jito MEV tip the desk pays to win the bundle auction.
pub fn borrower_tip_usd_cents(gross_usd_cents: u64, tip_share_bps: u64) -> u64 {
    mul_div(gross_usd_cents, tip_share_bps, BPS)
}

/// Borrower net after the tip and the Noviscia toll, floored at zero cents.
/// The toll is sub-cent per trade, so it floors away at cent precision.
pub fn borrower_net_usd_cents(
    p: &TvvParams,
    desk_usd_cents: u64,
    mismatch_bps: u64,
    tip_share_bps: u64,
) -> u64 {
    let gross = borrower_gross_spread_usd_cents(desk_usd_cents, mismatch_bps);
    let tip = borrower_tip_usd_cents(gross, tip_share_bps);
    let toll_cents = mul_div(desk_slot_toll_micro_usd(p, desk_usd_cents), 1, MICRO_DOLLARS_PER_CENT);
    gross.saturating_sub(tip).saturating_sub(toll_cents)
}

/// The toll as parts-per-billion of the gross spread (reference: 2,029 ppb).
pub fn toll_share_of_gross_ppb(p: &TvvParams, desk_usd_cents: u64, mismatch_bps: u64) -> u64 {
    let toll = desk_slot_toll_micro_usd(p, desk_usd_cents);
    let gross = borrower_gross_spread_usd_cents(desk_usd_cents, mismatch_bps);
    mul_div(toll, PARTS_PER_BILLION, gross * MICRO_DOLLARS_PER_CENT)
}

/// The toll as parts-per-million of the borrower's net profit (≈ 5 ppm).
pub fn toll_share_of_net_ppm(
    p: &TvvParams,
    desk_usd_cents: u64,
    mismatch_bps: u64,
    tip_share_bps: u64,
) -> u64 {
    let toll = desk_slot_toll_micro_usd(p, desk_usd_cents);
    let net = borrower_net_usd_cents(p, desk_usd_cents, mismatch_bps, tip_share_bps);
    mul_div(toll, PARTS_PER_MILLION, net * MICRO_DOLLARS_PER_CENT)
}

/// A single desk at `desk` paying the toll on every eligible landing slot for
/// a year: `toll × S_elig`. Reference max desk: `$287,986.75`.
pub fn desk_annual_toll_usd_cents_at_full_landing(p: &TvvParams, desk_usd_cents: u64) -> u64 {
    let annual_micro_usd = mul_div(desk_slot_toll_micro_usd(p, desk_usd_cents), eligible_slots(p), 1);
    mul_div(annual_micro_usd, 1, MICRO_DOLLARS_PER_CENT)
}

/// Proof harness: the per-slot annual toll reconstructs the closed form
/// `desk × R_base × L_jito` within 1% under integer flooring.
pub fn desk_annual_toll_reconciles(p: &TvvParams, desk_usd_cents: u64) -> bool {
    let priced = mul_div(desk_usd_cents, p.base_rate_bps, BPS);
    let closed = mul_div(priced, p.jito_landing_bps, BPS);
    let slotted = desk_annual_toll_usd_cents_at_full_landing(p, desk_usd_cents);
    let diff = closed.abs_diff(slotted);
    diff * 100 <= closed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn max_desk_slot_toll_is_4566_micro_usd() {
        let p = TvvParams::reference_10m();
        assert_eq!(max_desk_slot_toll_micro_usd(&p), 4_566);
        assert_eq!(desk_slot_toll_micro_usd(&p, 150_000_000), 4_566);
        // Halving the desk halves the toll within one µUSD of the floor.
        let half = desk_slot_toll_micro_usd(&p, 75_000_000);
        assert!((2_282..=2_283).contains(&half));
    }

    #[test]
    fn borrower_pnl_on_the_reference_route() {
        let p = TvvParams::reference_10m();
        let desk = 150_000_000; // $1,500,000
        assert_eq!(borrower_gross_spread_usd_cents(desk, REF_MISMATCH_BPS), 225_000);
        assert_eq!(
            borrower_tip_usd_cents(
                borrower_gross_spread_usd_cents(desk, REF_MISMATCH_BPS),
                REF_TIP_SHARE_BPS,
            ),
            135_000,
        );
        // The sub-cent toll floors to $0 at cent precision: net = $900.00.
        assert_eq!(borrower_net_usd_cents(&p, desk, REF_MISMATCH_BPS, REF_TIP_SHARE_BPS), 90_000);
    }

    #[test]
    fn toll_is_imperceptible_in_ppb_and_ppm() {
        let p = TvvParams::reference_10m();
        let desk = 150_000_000;
        assert_eq!(toll_share_of_gross_ppb(&p, desk, REF_MISMATCH_BPS), 2_029);
        assert_eq!(toll_share_of_net_ppm(&p, desk, REF_MISMATCH_BPS, REF_TIP_SHARE_BPS), 5);
    }

    #[test]
    fn max_desk_annual_toll_at_full_landing_reconciles() {
        let p = TvvParams::reference_10m();
        let desk = 150_000_000;
        assert_eq!(desk_annual_toll_usd_cents_at_full_landing(&p, desk), 28_798_675);
        assert!(desk_annual_toll_reconciles(&p, desk));
        // Closed form: $288,000 (1.5M × 24% × 80%); per-slot drift < 1%.
        let closed: u64 = 28_800_000;
        assert!(closed.abs_diff(28_798_675) * 100 <= closed);
    }

    #[test]
    fn desk_sizing_multiplier_is_15x_cap_vs_100k_wallet() {
        let p = TvvParams::reference_10m();
        assert_eq!(desk_sizing_multiplier_usd(&p, 0), 0); // no cash → no multiplier
        assert_eq!(desk_sizing_multiplier_usd(&p, 10_000_000), 15); // $100k → 15×
        assert_eq!(desk_sizing_multiplier_usd(&p, 150_000_000), 1); // full-wallet desk → 1×
    }

    #[test]
    fn max_concurrent_max_desks_is_four_on_reference_pool() {
        let p = TvvParams::reference_10m();
        assert_eq!(max_concurrent_max_desks(&p), 4);
        // Pathological caps (C_sys < C_desk) never drop below 1 desk.
        let weird = TvvParams {
            systemic_cap_bps: 500,
            desk_cap_bps: 1_500,
            ..TvvParams::default()
        };
        assert_eq!(max_concurrent_max_desks(&weird), 1);
    }

    #[test]
    fn scales_with_desk_size_and_floors_at_zero() {
        let small = TvvParams {
            pool_usd_cents: 100_000_000, // $1,000,000
            ..TvvParams::default()
        };
        let desk = 15_000_000; // 15% of the $1M pool
        assert_eq!(desk_slot_toll_micro_usd(&small, desk), 456);
        assert_eq!(borrower_net_usd_cents(&small, desk, 1, 10_000), 0);
        assert_eq!(borrower_net_usd_cents(&small, desk, 0, REF_TIP_SHARE_BPS), 0);
    }
}