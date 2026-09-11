//! # noviscia-tvv — Rust math twin for the on-chain TVV module
//!
//! Byte-parity reference for the S1 (atomic) + S2 (credit) math in
//! `nv-usdc-vault::tvv`. Mirrors the on-chain integer arithmetic so a reviewer
//! can replay the guard-rails (slot ceiling, toll slice, margin floor,
//! 6-step default waterfall) entirely off-chain.

pub const BPS: u64 = 10_000;
/// S1 per-slot premium ceiling (50 bps).
pub const S1_TOLL_MAX_BPS: u16 = 500;
/// S2 default margin requirement (30% of limit).
pub const DEFAULT_S2_MARGIN_BPS: u16 = 3_000;
/// S2 margin floor (50% of posted margin).
pub const S2_MARGIN_FLOOR_BPS: u16 = 5_000;
/// Insurance usage rate-limit per window.
pub const INSURANCE_USE_WINDOW_CAP: u64 = 3;
/// S2 end-of-day window (24h @ 400ms).
pub const S2_WINDOW_SLOTS: u64 = 216_000;

/// S1 capacity check: draw allowed only within the live slot window + ceiling.
pub fn s1_draw_allowed(
    active: bool,
    slot_key: u64,
    current_slot: u64,
    draws_this_slot: u64,
    slot_ceiling_usd: u64,
    amount: u64,
) -> bool {
    if !active || amount == 0 {
        return false;
    }
    if slot_key != current_slot {
        return false;
    }
    draws_this_slot
        .checked_add(amount)
        .map(|v| v <= slot_ceiling_usd)
        .unwrap_or(false)
}

/// S1 per-slot toll: `principal * toll_bps / 10_000` (integer floor).
pub fn s1_toll(principal: u64, toll_bps: u16) -> u64 {
    (principal as u128)
        .checked_mul(toll_bps as u128)
        .map(|v| v / BPS as u128)
        .map(|v| v as u64)
        .unwrap_or(0)
}

/// 90/10 toll split -> (nav_boost, treasury_cut).
pub fn toll_split(toll: u64) -> (u64, u64) {
    let nav: u64 = (toll as u128 * 9_000 / 10_000) as u64;
    (nav, toll - nav)
}

/// S2 draw headroom: `limit - drawn` (saturating).
pub fn s2_available(total_limit: u64, drawn: u64) -> u64 {
    total_limit.saturating_sub(drawn)
}

/// Margin haircut floor: `margin * floor_bps / 10_000`.
pub fn margin_haircut_floor(margin: u64, floor_bps: u16) -> u64 {
    (margin as u128)
        .checked_mul(floor_bps as u128)
        .map(|v| v / BPS as u128)
        .map(|v| v as u64)
        .unwrap_or(0)
}

/// S2 draw health gate: posted margin must cover `floor_bps %` of drawn usage.
pub fn s2_draw_healthy(margin: u64, floor_bps: u16, drawn_after: u64) -> bool {
    let floor_needed = (drawn_after as u128)
        .checked_mul(floor_bps as u128)
        .map(|v| v / BPS as u128)
        .map(|v| v as u64)
        .unwrap_or(u64::MAX);
    margin >= floor_needed
}

/// End-of-day window elapsed.
pub fn s2_window_elapsed(day_open_slot: u64, current_slot: u64, window_slots: u64) -> bool {
    current_slot
        .checked_sub(day_open_slot)
        .map(|elapsed| elapsed >= window_slots)
        .unwrap_or(false)
}

/// Loss remaining after applying the desk's posted margin.
pub fn waterfall_after_margin(loss: u64, margin: u64) -> u64 {
    loss.saturating_sub(margin)
}

/// Simulate the full default waterfall in strict order: protected →
/// institutional → insurance → default fund.
#[allow(clippy::too_many_arguments)]
pub fn simulate_waterfall(
    uncovered: u64,
    protected_cap: u64,
    insti_remaining: u64,
    insurance_remaining: u64,
    default_fund: u64,
) -> (u64, u64, u64, u64, u64) {
    let mut rest = uncovered;

    let protected_eaten = protected_cap.min(rest);
    rest -= protected_eaten;

    let insti_eaten = insti_remaining.min(rest);
    rest -= insti_eaten;

    let insurance_eaten = insurance_remaining.min(rest);
    rest -= insurance_eaten;

    let default_eaten = default_fund.min(rest);
    rest -= default_eaten;

    (rest, protected_eaten, insti_eaten, insurance_eaten, default_eaten)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn s1_draw_respects_window_and_ceiling() {
        assert!(s1_draw_allowed(true, 42, 42, 0, 1_000_000, 500_000));
        assert!(!s1_draw_allowed(true, 42, 43, 0, 1_000_000, 500_000));
        assert!(!s1_draw_allowed(true, 42, 42, 0, 1_000_000, 1_500_000));
        assert!(!s1_draw_allowed(false, 42, 42, 0, 1_000_000, 100));
    }

    #[test]
    fn s1_draw_accumulates() {
        assert!(s1_draw_allowed(true, 7, 7, 600_000, 1_000_000, 400_000));
        assert!(!s1_draw_allowed(true, 7, 7, 600_000, 1_000_000, 400_001));
    }

    #[test]
    fn toll_and_split() {
        assert_eq!(s1_toll(1_000_000, 5), 500);
        let (nav, treasury) = toll_split(1_000_000);
        assert_eq!((nav, treasury), (900_000, 100_000));
    }

    #[test]
    fn s2_margin_health() {
        assert_eq!(s2_available(1_500_000, 1_000_000), 500_000);
        assert_eq!(margin_haircut_floor(1_000_000, 5_000), 500_000);
        assert!(s2_draw_healthy(300_000, 5_000, 400_000));
        assert!(!s2_draw_healthy(300_000, 5_000, 700_000));
        assert!(!s2_draw_healthy(0, 5_000, 5));
    }

    #[test]
    fn waterfall_saturating_and_ordered() {
        assert_eq!(waterfall_after_margin(1_000_000, 400_000), 600_000);
        assert_eq!(waterfall_after_margin(1_000_000, 1_200_000), 0);
        let (u, p, i, ins, d) = simulate_waterfall(1_000_000, 300_000, 200_000, 150_000, 100_000);
        assert_eq!((p, i, ins, d), (300_000, 200_000, 150_000, 100_000));
        assert_eq!(u, 250_000);
    }
}
