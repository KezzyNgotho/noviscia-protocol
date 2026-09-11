//! Vault NAV + institutional settlement ledger (COMPOUNDING + SAFETY proofs).
//!
//! The sandbox vault is the on-chain-equivalent of the clearinghouse's
//! perpetual-yield side: micro-premiums flow OUT of desk capital and INTO the
//! vault NAV, so an integrator can watch NAV compound block-by-block while a
//! window is deployed, then clear the 24-hour invoice atomically.
//!
//! Two distinct flows, both observable over the control REST surface:
//!
//! * **Per-block compounding** — while a desk has principal deployed (an open
//!   window) and compounding is enabled, every sandbox slot accrues
//!   `current_premium_rate_bps` worth of premium straight into `nav_units`
//!   ("premium drops into the vault on every block").
//! * **Landed-bundle debt** — each `PROFITTABLE` bundle the Jito emulator
//!   accepts records `SPEC_LOGGED_PREMIUM_DEBT_UNITS` (7,305 µUSD, the spec
//!   constant) as an unpaid clearing invoice.
//! * **`POST /api/v1/sandbox/settle`** — pays the invoice: sweeps the entire
//!   open premium debt into NAV, stamps `last_swept_slot` and unlocks every
//!   desk (posture → NoWindow), so the next window can book immediately.
//!
//! Units: micro-USDC base units throughout (the same base the gRPC pool-state
//! feed speaks), so `nav_units` is directly comparable to pool headroom.
#![allow(dead_code)]

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// TVV baseline premium rate, in tenths of a basis point (4,608 → 4.608% APY).
/// Matches the `current_premium_rate_bps` the pool-state feed streams.
pub const BASE_PREMIUM_RATE_TENTHS_BPS: u64 = 4_608;

/// Accelerated sandbox slots per (real) 24-hour clearing window: 216,000/1,440.
pub const SLOTS_PER_ACCELERATED_DAY: u64 = 150;

/// Converts tenths-of-bps into a per-slot APY fraction for a whole accelerated
/// day: `(tenths_bps / 100_000) / slots_per_day` → 4,608 ⇒ 4.608%/day.
pub const COMPOUND_DENOMINATOR: u64 = 100_000 * SLOTS_PER_ACCELERATED_DAY;

/// Spec-pinned logged premium for a single `PROFITABLE` bundle (µUSD).
/// Mirrored by the Jito emulator's `logged_premium_debt_units` metric.
pub const SPEC_LOGGED_PREMIUM_DEBT_UNITS: u64 = 7_305;

/// Per-slot premium drip, in base units, for deployed capital at a rate.
///
/// `utilization_base * rate_tenths_bps / COMPOUND_DENOMINATOR` — with $1.5M
/// deployed (`1.5e12` µUSDC) and the 4.608% baseline this is exactly
/// $460.80/slot, i.e. 4.608% of $1.5M across a 150-slot accelerated day.
pub fn per_slot_drip(utilization_base: u64, rate_tenths_bps: u64) -> u64 {
    utilization_base.saturating_mul(rate_tenths_bps) / COMPOUND_DENOMINATOR
}

/// Lock-free vault NAV ledger shared between the mock subscriber, the bundle
/// REST gateway and the control surface.
#[derive(Debug, Clone, Default)]
pub struct VaultLedger {
    nav_units: Arc<AtomicU64>,
    open_premium_debt_units: Arc<AtomicU64>,
    sweeps: Arc<AtomicU64>,
    last_swept_slot: Arc<AtomicU64>,
    compounding_blocks: Arc<AtomicU64>,
}

impl VaultLedger {
    pub fn new() -> Self {
        Self::default()
    }

    /// A landed `PROFITABLE` bundle logged premium — record it as an unpaid
    /// clearing invoice.
    pub fn observe_landed_bundle(&self, premium_units: u64) {
        if premium_units > 0 {
            self.open_premium_debt_units
                .fetch_add(premium_units, Ordering::SeqCst);
        }
    }

    /// Compounding leg: accrue one block of premium straight into NAV and
    /// return the drip (µUSDC) so callers can announce the per-block proof.
    /// No-op while no capital is deployed.
    pub fn compound_block(&self, utilization_base: u64, rate_tenths_bps: u64) -> u64 {
        let drip = per_slot_drip(utilization_base, rate_tenths_bps);
        if drip > 0 {
            self.nav_units.fetch_add(drip, Ordering::SeqCst);
            self.compounding_blocks.fetch_add(1, Ordering::SeqCst);
        }
        drip
    }

    /// Settlement leg: pay the open-account invoice, sweeping every µUSD of
    /// open premium debt into NAV. Idempotent — a zero-debt settle still
    /// returns the current NAV unchanged.
    pub fn pay_invoice(&self, at_slot: u64) -> Sweep {
        let swept = self.open_premium_debt_units.swap(0, Ordering::SeqCst);
        let nav_before = self.nav_units.load(Ordering::SeqCst);
        if swept > 0 {
            self.nav_units.fetch_add(swept, Ordering::SeqCst);
            self.sweeps.fetch_add(1, Ordering::SeqCst);
            self.last_swept_slot.store(at_slot, Ordering::SeqCst);
        }
        Sweep {
            swept,
            nav_before,
            nav_after: nav_before + swept,
            swept_at_slot: at_slot,
        }
    }

    pub fn nav_units(&self) -> u64 {
        self.nav_units.load(Ordering::SeqCst)
    }

    pub fn open_premium_debt_units(&self) -> u64 {
        self.open_premium_debt_units.load(Ordering::SeqCst)
    }

    pub fn sweep_count(&self) -> u64 {
        self.sweeps.load(Ordering::SeqCst)
    }

    pub fn last_swept_slot(&self) -> u64 {
        self.last_swept_slot.load(Ordering::SeqCst)
    }

    pub fn compounding_blocks(&self) -> u64 {
        self.compounding_blocks.load(Ordering::SeqCst)
    }

    /// Spec-conformant snapshot for `GET /api/v1/sandbox/vault`.
    pub fn snapshot_json(&self, slot: u64, posture: i32) -> serde_json::Value {
        serde_json::json!({
            "slot": slot,
            "nav_units": self.nav_units(),
            "open_premium_debt_units": self.open_premium_debt_units(),
            "premium_rate_tenths_bps": BASE_PREMIUM_RATE_TENTHS_BPS,
            "compounding_blocks": self.compounding_blocks(),
            "sweep_count": self.sweeps.load(Ordering::SeqCst),
            "last_swept_slot": self.last_swept_slot(),
            "desk_posture": posture,
        })
    }
}

/// Result of a settlement sweep.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Sweep {
    pub swept: u64,
    pub nav_before: u64,
    pub nav_after: u64,
    pub swept_at_slot: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drip_is_exactly_four_point_six_percent_of_deployed_capital_per_day() {
        // $1.5M in µUSDC at the 4.608% baseline across 150 accelerated slots.
        assert_eq!(
            per_slot_drip(1_500_000_000_000, BASE_PREMIUM_RATE_TENTHS_BPS),
            460_800_000
        );
        // 150 blocks × $460.80 = $69,120 = 4.608% of $1.5M.
        assert_eq!(
            per_slot_drip(1_500_000_000_000, BASE_PREMIUM_RATE_TENTHS_BPS)
                * SLOTS_PER_ACCELERATED_DAY,
            1_500_000_000_000 * BASE_PREMIUM_RATE_TENTHS_BPS
                / (100_000 * SLOTS_PER_ACCELERATED_DAY)
                * SLOTS_PER_ACCELERATED_DAY
        );
        assert_eq!(per_slot_drip(0, BASE_PREMIUM_RATE_TENTHS_BPS), 0);
        assert_eq!(per_slot_drip(1_000, 0), 0);
    }

    #[test]
    fn landed_bundle_opens_invoice() {
        let vault = VaultLedger::new();
        vault.observe_landed_bundle(SPEC_LOGGED_PREMIUM_DEBT_UNITS);
        assert_eq!(vault.open_premium_debt_units(), 7_305);
        assert_eq!(vault.nav_units(), 0);
    }

    #[test]
    fn compounding_drips_straight_into_nav() {
        let vault = VaultLedger::new();
        let drip = vault.compound_block(1_500_000_000_000, 4_608);
        assert_eq!(drip, 460_800_000);
        assert_eq!(vault.nav_units(), drip);
        assert_eq!(vault.compounding_blocks(), 1);
        assert_eq!(vault.compound_block(0, 4_608), 0);
        assert_eq!(vault.compounding_blocks(), 1);
    }

    #[test]
    fn settle_sweeps_open_debt_into_nav() {
        let vault = VaultLedger::new();
        vault.observe_landed_bundle(SPEC_LOGGED_PREMIUM_DEBT_UNITS);
        let sweep = vault.pay_invoice(1_000);
        assert_eq!(
            sweep,
            Sweep {
                swept: 7_305,
                nav_before: 0,
                nav_after: 7_305,
                swept_at_slot: 1_000,
            }
        );
        assert_eq!(vault.nav_units(), 7_305);
        assert_eq!(vault.open_premium_debt_units(), 0);
        assert_eq!(vault.sweep_count(), 1);
        assert_eq!(vault.last_swept_slot(), 1_000);
    }

    #[test]
    fn settle_is_idempotent_when_no_debt() {
        let vault = VaultLedger::new();
        vault.compound_block(1_500_000_000_000, 4_608);
        let before = vault.nav_units();
        let sweep = vault.pay_invoice(50);
        assert_eq!(sweep.swept, 0);
        assert_eq!(sweep.nav_before, before);
        assert_eq!(sweep.nav_after, before);
        assert_eq!(vault.sweep_count(), 0);
    }

    #[test]
    fn snapshot_carries_live_state() {
        let vault = VaultLedger::new();
        vault.observe_landed_bundle(7_305);
        let s = vault.snapshot_json(42, 1);
        assert_eq!(s["slot"], 42);
        assert_eq!(s["open_premium_debt_units"], 7_305);
        assert_eq!(s["nav_units"], 0);
        assert_eq!(s["desk_posture"], 1);
        assert_eq!(s["premium_rate_tenths_bps"], 4_608);
    }
}