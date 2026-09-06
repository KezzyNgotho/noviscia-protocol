//! Deterministic clearing-window posture (on-chain grammar, sandbox clock).
//!
//! This mirrors `noviscia-asset-engine` (programs/cluster-2-tvv-gate/noviscia-asset-engine
//! lib.rs) exactly, projected onto the sandbox's 1,440× accelerated clock:
//!
//!   real WINDOW_SLOTS = 216,000   → 150 sandbox slots   (one real day → 60 s)
//!   real GRACE_SLOTS  =  18,000   →  12.5 sandbox slots (grace → 5 s)
//!   breach = window_start + WINDOW + GRACE
//!
//! No randomness, no wall clock — the posture for a given
//! `(window_start_slot, current_slot)` pair is a pure function, exactly like
//! the on-chain derivation.
#![allow(dead_code)]

/// Sandbox-slot width of one full clearing window (real WINDOW_SLOTS/1440).
pub const WINDOW_SANDBOX_SLOTS: f64 = 150.0;
/// Sandbox-slot width of the grace period (real GRACE_SLOTS/1440).
pub const GRACE_SANDBOX_SLOTS: f64 = 12.5;
/// 1440× acceleration — one real day (86,400 s) collapses to 60 s.
pub const ACCELERATION: u64 = 1_440;
/// Real slots per day (on-chain constant, source of the projection).
pub const REAL_SLOTS_PER_DAY: u64 = 216_000;
/// Real slots the on-chain engine allows as grace before breach.
pub const REAL_GRACE_SLOTS: u64 = 18_000;

/// Window posture, byte-compatible with proto `DeskPosture`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(i32)]
pub enum Posture {
    NoWindow = 0,
    Open = 1,
    Overdue = 2,
    Breached = 3,
}

impl Posture {
    pub fn as_proto_i32(&self) -> i32 {
        *self as i32
    }
}

/// The number of real slots that collapse into a sandbox window (kept as a
/// rational projection — 216,000 real slots are NOT an integer sandbox count).
pub fn real_slots_per_sandbox_slot() -> f64 {
    ACCELERATION as f64
}

/// Sandbox-slot projection of a real slot count (scale 1/10 — grace lands on
/// 12.5, exactly as the spec requires).
pub fn real_to_sandbox_slots(real_slots: u64) -> f64 {
    real_slots as f64 / ACCELERATION as f64
}

/// Real-slot projection of a sandbox-slot count.
pub fn sandbox_to_real_slots(sandbox_slots: f64) -> u64 {
    (sandbox_slots * ACCELERATION as f64) as u64
}

/// Deterministic posture for a desk.
///
/// - `window_start_slot == 0`      → NoWindow (nothing outstanding)
/// - `t < start + WINDOW`          → Open (within the clearing window)
/// - `t < start + WINDOW + GRACE`  → Overdue (in grace, toll accrues)
/// - otherwise                     → Breached (reverted/expired, credit frozen)
pub fn posture_at(window_start_slot: u64, current_slot: u64, outstanding: bool) -> Posture {
    if !outstanding || window_start_slot == 0 {
        return Posture::NoWindow;
    }
    let start = window_start_slot as f64;
    let t = current_slot as f64;
    let mature = start + WINDOW_SANDBOX_SLOTS;
    if t < mature {
        Posture::Open
    } else if t < mature + GRACE_SANDBOX_SLOTS {
        Posture::Overdue
    } else {
        Posture::Breached
    }
}

/// Seconds of wall-clock real time a sandbox window spans (60 s for 150 slots
/// at the 400 ms cadence).
pub fn window_wall_clock_seconds(current_slot: u64, cadence_ms: u64) -> u64 {
    current_slot * cadence_ms / 1_000
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projection_is_exact() {
        assert_eq!(
            real_to_sandbox_slots(REAL_SLOTS_PER_DAY),
            WINDOW_SANDBOX_SLOTS
        );
        assert_eq!(real_to_sandbox_slots(REAL_GRACE_SLOTS), GRACE_SANDBOX_SLOTS);
        assert_eq!(
            sandbox_to_real_slots(WINDOW_SANDBOX_SLOTS),
            REAL_SLOTS_PER_DAY
        );
    }

    #[test]
    fn no_window_when_nothing_outstanding() {
        assert_eq!(posture_at(0, 0, false), Posture::NoWindow);
        assert_eq!(posture_at(0, 10_000, false), Posture::NoWindow);
    }

    #[test]
    fn open_inside_window() {
        assert_eq!(posture_at(100, 100, true), Posture::Open);
        assert_eq!(posture_at(100, 249, true), Posture::Open);
        // Window is [start, start+WINDOW) — slot 250 (start+150) is the first
        // OVERDUE slot, exactly matching on-chain `t >= window + WINDOW_SLOTS`.
        assert_eq!(posture_at(100, 250, true), Posture::Overdue);
    }

    #[test]
    fn overdue_in_grace() {
        assert_eq!(posture_at(100, 251, true), Posture::Overdue);
        // 100 + 150 = 250 mature; +12.5 grace → breaches at 262.5.
        assert_eq!(posture_at(100, 262, true), Posture::Overdue);
    }

    #[test]
    fn breached_after_grace() {
        assert_eq!(posture_at(100, 263, true), Posture::Breached);
        assert_eq!(posture_at(100, 10_000, true), Posture::Breached);
    }

    #[test]
    fn grace_is_one_twelfth_of_window() {
        assert_eq!(ACCELERATION, 1_440);
        assert_eq!(REAL_SLOTS_PER_DAY / ACCELERATION, 150);
        // On-chain grace is exactly WINDOW/12 (18_000 = 216_000/12).
        assert_eq!(REAL_GRACE_SLOTS * 12, REAL_SLOTS_PER_DAY);
        assert_eq!(GRACE_SANDBOX_SLOTS, WINDOW_SANDBOX_SLOTS / 12.0);
    }
}
