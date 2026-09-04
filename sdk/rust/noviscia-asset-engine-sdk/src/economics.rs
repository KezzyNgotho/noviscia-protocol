//! # Quantified Risk Pack & Economics — Module 1 of the TVV risk engine
//!
//! Deterministic unit-economics for the Noviscia Total Value Velocity (TVV)
//! engine. Every figure below is computed in **integer arithmetic on USD
//! cents** so an institutional risk committee can reproduce the reference
//! balance sheet exactly — no floats, no hidden rounding.
//!
//! Reference scenario (the audited `$10,000,000` pool):
//!
//! | Step | Formula | Reference result |
//! |---|---|---|
//! | Total slots/yr | `SECONDS_PER_YEAR / 0.4s` | `78,840,000` |
//! | Eligible slots | `S_total × L_jito` | `63,072,000` |
//! | Micro-premium/slot | `(μ × R_base) / S_total` | `≈ $0.00730594` |
//! | Gross revenue | `μ × R_base × L_jito` | `$460,800.00` |
//! | Net revenue | `G × (1−T_jito) − I_infra` | `$403,888.00` |
//! | DIF allocation | `N × R_dif` | `$80,777.60` |
//! | LP yield | `N − D` | `$323,110.40` |
//! | Senior hurdle | `P_sr × 4.50%` | `$315,000.00` |
//! | Junior residual | `Y − Y_sr` | `$8,110.40` |
//!
//! The counterpart of this module ships in `@noviscia/sdk` (`economics.ts`)
//! with byte-for-byte identical results; both are pinned by tests against the
//! reference figures above.

/// Solana slot time in seconds (one block every 400ms).
pub const SLOT_SECONDS_NUM: u64 = 2;
pub const SLOT_SECONDS_DEN: u64 = 5;

/// Seconds per standard year.
pub const SECONDS_PER_YEAR: u64 = 60 * 60 * 24 * 365;

/// Basis-point denominator (1 bps = 0.01%).
pub const BPS: u64 = 10_000;

/// Fixed-point scale for micro-USD ($0.000001).
pub const MICRO_DOLLARS_PER_CENT: u64 = 10_000;

/// The full parameter set of the TVV economics sheet. All ratios are basis
/// points over `BPS`; all money fields are USD cents.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TvvParams {
    /// Total pool capital in USD cents.
    pub pool_usd_cents: u64,
    /// Senior LP tranche share (bps of pool). Default 70%.
    pub senior_bps: u64,
    /// Junior LP first-loss layer share (bps of pool). Default 30%.
    pub junior_bps: u64,
    /// Systemic concentration cap (bps of pool). Default 60%.
    pub systemic_cap_bps: u64,
    /// Single-desk cap (bps of pool). Default 15%.
    pub desk_cap_bps: u64,
    /// Average active slot utilization (bps of systemic cap). Default 40%.
    pub avg_utilization_bps: u64,
    /// Eligible Jito landing rate (bps). Default 80%.
    pub jito_landing_bps: u64,
    /// Implied base annualized borrowing rate (bps). Default 24%.
    pub base_rate_bps: u64,
    /// Jito MEV bundle tip cost as a cut of gross revenue (bps). Default 1.5%.
    pub jito_tip_bps: u64,
    /// DIF reserve cut of net revenue (bps). Default 20%.
    pub dif_bps: u64,
    /// Bare-metal infrastructure cost per year in USD cents. Default $50,000.
    pub infra_usd_cents: u64,
    /// Senior LP contractual fixed hurdle (bps). Default 4.50%.
    pub senior_hurdle_bps: u64,
    /// Junior-tranche drain ratio that trips the hard circuit breaker (bps).
    /// Default 50%.
    pub circuit_breaker_drain_bps: u64,
}

impl Default for TvvParams {
    fn default() -> Self {
        Self::reference_10m()
    }
}

impl TvvParams {
    /// The audited `$10,000,000` reference pool from the economics sheet.
    pub const fn reference_10m() -> Self {
        Self {
            pool_usd_cents: 1_000_000_000, // $10,000,000.00
            senior_bps: 7_000,
            junior_bps: 3_000,
            systemic_cap_bps: 6_000,
            desk_cap_bps: 1_500,
            avg_utilization_bps: 4_000,
            jito_landing_bps: 8_000,
            base_rate_bps: 2_400,
            jito_tip_bps: 150,
            dif_bps: 2_000,
            infra_usd_cents: 5_000_000, // $50,000.00
            senior_hurdle_bps: 450,
            circuit_breaker_drain_bps: 5_000,
        }
    }

    /// Senior tranche size in USD cents.
    pub fn senior_tranche_usd_cents(&self) -> u64 {
        mul_div(self.pool_usd_cents, self.senior_bps, BPS)
    }

    /// Junior first-loss layer size in USD cents.
    pub fn junior_tranche_usd_cents(&self) -> u64 {
        mul_div(self.pool_usd_cents, self.junior_bps, BPS)
    }
}

/// Flooring `n × m / d`, exact over u128.
fn mul_div(n: u64, m: u64, d: u64) -> u64 {
    (n as u128 * m as u128 / d as u128) as u64
}

/// Step A — total operational slots per year: `78,840,000`.
pub fn total_slots_per_year() -> u64 {
    SECONDS_PER_YEAR * SLOT_SECONDS_DEN / SLOT_SECONDS_NUM
}

/// Step B — eligible (Jito-landing) trading slots per year.
pub fn eligible_slots(p: &TvvParams) -> u64 {
    mul_div(total_slots_per_year(), p.jito_landing_bps, BPS)
}

/// Systemic concentration cap (`C_sys`) in USD cents. Default: 60% of pool.
pub fn systemic_cap_usd_cents(p: &TvvParams) -> u64 {
    mul_div(p.pool_usd_cents, p.systemic_cap_bps, BPS)
}

/// Single-desk cap (`C_desk`) in USD cents. Default: 15% of pool.
pub fn desk_cap_usd_cents(p: &TvvParams) -> u64 {
    mul_div(p.pool_usd_cents, p.desk_cap_bps, BPS)
}

/// Average active slot utilization (`μ`) in USD cents. Default: 40% of
/// `C_sys` = 24% of pool.
pub fn active_utilization_usd_cents(p: &TvvParams) -> u64 {
    mul_div(
        systemic_cap_usd_cents(p),
        p.avg_utilization_bps,
        BPS,
    )
}

/// Step C — the micro-premium fee per slot, in micro-USD ($1e-6), floored.
/// Exact form is `(μ × R_base) / S_total`; the sheet displays this as
/// `≈ $0.00730594` per slot for the reference pool.
pub fn slot_fee_micro_usd(p: &TvvParams) -> u64 {
    let annual_usd_cents = mul_div(
        active_utilization_usd_cents(p),
        p.base_rate_bps,
        BPS,
    );
    mul_div(
        annual_usd_cents,
        MICRO_DOLLARS_PER_CENT,
        total_slots_per_year(),
    )
}

/// Step D — gross annualized revenue in USD cents. Equivalent closed form
/// `μ × R_base × L_jito` (no per-slot rounding): `$460,800.00` for the
/// reference pool.
pub fn gross_revenue_usd_cents(p: &TvvParams) -> u64 {
    let active = active_utilization_usd_cents(p);
    let priced = mul_div(active, p.base_rate_bps, BPS);
    mul_div(priced, p.jito_landing_bps, BPS)
}

/// Step E — net revenue after the Jito tip cut and bare-metal infra cost:
/// `(G × (1 − T_jito)) − I_infra`.
pub fn net_revenue_usd_cents(p: &TvvParams) -> u64 {
    let gross = gross_revenue_usd_cents(p);
    let after_tip = gross.saturating_sub(mul_div(gross, p.jito_tip_bps, BPS));
    after_tip.saturating_sub(p.infra_usd_cents)
}

/// Step F — Default Insurance Fund (DIF) reserve cut of net revenue.
pub fn dif_allocation_usd_cents(p: &TvvParams) -> u64 {
    mul_div(net_revenue_usd_cents(p), p.dif_bps, BPS)
}

/// Step G — total residual yield distributed to LP tranches: `N − D`.
pub fn total_lp_yield_usd_cents(p: &TvvParams) -> u64 {
    net_revenue_usd_cents(p).saturating_sub(dif_allocation_usd_cents(p))
}

/// Senior LP contractual fixed hurdle: `P_sr × R_hurdle`.
pub fn senior_yield_usd_cents(p: &TvvParams) -> u64 {
    mul_div(p.senior_tranche_usd_cents(), p.senior_hurdle_bps, BPS)
}

/// Junior LP performance residual: everything above the senior hurdle.
pub fn junior_yield_usd_cents(p: &TvvParams) -> u64 {
    total_lp_yield_usd_cents(p).saturating_sub(senior_yield_usd_cents(p))
}

/// Junior-tranche drain (in USD cents) that trips the on-chain hard circuit
/// breaker. Default: 50% of the junior first-loss layer = `$1,500,000`.
pub fn circuit_breaker_drain_usd_cents(p: &TvvParams) -> u64 {
    mul_div(p.junior_tranche_usd_cents(), p.circuit_breaker_drain_bps, BPS)
}

/// Junior-tranche drain ratio in bps given the junior tranche size.
pub fn junior_drain_ratio_bps(drained_usd_cents: u64, junior_usd_cents: u64) -> u64 {
    if junior_usd_cents == 0 {
        return 0;
    }
    mul_div(drained_usd_cents, BPS, junior_usd_cents)
}

/// Hard circuit breaker predicate: a cascading liquidation down to the
/// `circuit_breaker_drain_bps` floor freezes every credit facility so the
/// senior principal can never be impaired.
pub fn hard_lock_triggered(p: &TvvParams, drained_usd_cents: u64) -> bool {
    junior_drain_ratio_bps(drained_usd_cents, p.junior_tranche_usd_cents())
        >= p.circuit_breaker_drain_bps
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_balance_sheet_reconciles_to_the_cent() {
        let p = TvvParams::reference_10m();

        // Step A / B
        assert_eq!(total_slots_per_year(), 78_840_000);
        assert_eq!(eligible_slots(&p), 63_072_000);

        // Caps
        assert_eq!(systemic_cap_usd_cents(&p), 600_000_000); // $6,000,000
        assert_eq!(desk_cap_usd_cents(&p), 150_000_000); // $1,500,000
        assert_eq!(p.senior_tranche_usd_cents(), 700_000_000); // $7,000,000
        assert_eq!(p.junior_tranche_usd_cents(), 300_000_000); // $3,000,000
        assert_eq!(active_utilization_usd_cents(&p), 240_000_000); // $2,400,000

        // Step C — per-slot fee ≈ $0.0073059 (7,305 µUSD)
        let fee = slot_fee_micro_usd(&p);
        assert!(fee >= 7_300 && fee <= 7_310, "fee µUSD out of band: {fee}");

        // Steps D → G
        assert_eq!(gross_revenue_usd_cents(&p), 46_080_000); // $460,800.00
        assert_eq!(net_revenue_usd_cents(&p), 40_388_800); // $403,888.00
        assert_eq!(dif_allocation_usd_cents(&p), 8_077_760); // $80,777.60
        assert_eq!(total_lp_yield_usd_cents(&p), 32_311_040); // $323,110.40

        // Tranche distribution
        assert_eq!(senior_yield_usd_cents(&p), 31_500_000); // $315,000.00
        assert_eq!(junior_yield_usd_cents(&p), 811_040); // $8,110.40
    }

    #[test]
    fn tail_risk_circuit_breaker_trips_only_after_half_the_junior_layer() {
        let p = TvvParams::reference_10m();

        assert_eq!(circuit_breaker_drain_usd_cents(&p), 150_000_000); // $1,500,000

        // 49% of the junior layer: not tripped.
        let below = 147_000_000;
        assert!(!hard_lock_triggered(&p, below));
        assert_eq!(junior_drain_ratio_bps(below, p.junior_tranche_usd_cents()), 4_900);

        // Exact 50% floor: hard lock.
        assert!(hard_lock_triggered(&p, 150_000_000));
        assert_eq!(
            junior_drain_ratio_bps(150_000_000, p.junior_tranche_usd_cents()),
            5_000
        );
    }

    #[test]
    fn scales_to_other_pool_sizes_without_float() {
        let small = TvvParams {
            pool_usd_cents: 100_000_000, // $1,000,000
            ..TvvParams::default()
        };
        assert_eq!(gross_revenue_usd_cents(&small), 4_608_000); // $46,080.00
        assert_eq!(small.junior_tranche_usd_cents(), 30_000_000); // $300,000
    }
}