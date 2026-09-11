//! # Searcher — the IDENTIFY stage of the self-executing DQAV
//!
//! Cross-DEX spatial arbitrage detector. Consumes per-pool constant-product
//! state (reserves + fee) streamed from the Yellowstone gRPC subscription and
//! finds two-leg arbitrage between the richest-buy and cheapest-sell venues for
//! a token pair:
//!
//! ```text
//! buy  A on venue L (pay B)  ──►  sell A on venue R (receive B)
//! profit = B_out - B_in  > 0  (after both DEX fees and slippage)
//! ```
//!
//! This is the pure math half of the loop. The LOCK + SETTLE half lives
//! on-chain in the `tvv_gate` program account (`tvv_gate_arm` → DEX route →
//! `tvv_gate_settle`, Post-Swap Invariant Constraint). The searcher only ever
//! emits an `Opportunity` that a Jito bundle builder (Tx A + route + tail Tx)
//! may size to the gate's per-slot ceiling.

use serde::{Deserialize, Serialize};

/// Venue identity: which DEX the pool belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Venue {
    Jupiter,
    Orca,
    Phoenix,
}

impl Venue {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Jupiter => "jupiter",
            Self::Orca => "orca",
            Self::Phoenix => "phoenix",
        }
    }

    /// Parse a venue label the observatory/feed uses to tag a pool. Unknown
    /// labels resolve to `None` so unsupported venues are skipped deliberately.
    pub fn from_label(label: &str) -> Option<Self> {
        match label.to_ascii_lowercase().as_str() {
            "jupiter" => Some(Self::Jupiter),
            "orca" => Some(Self::Orca),
            "phoenix" => Some(Self::Phoenix),
            _ => None,
        }
    }
}

/// One leg of the symmetric price path. `buy_a` means "give token B, receive
/// token A"; `sell_a` is the inverse.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Leg {
    BuyA,
    SellA,
}

/// Constant-product pool state snapshot (the observable the searcher tracks).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PoolState {
    pub venue: Venue,
    pub pool: String,
    pub mint_a: String,
    pub mint_b: String,
    /// Reserve of token A and token B in the pool.
    pub reserve_a: u64,
    pub reserve_b: u64,
    /// Fee charged by the pool, in basis points (e.g. 30 = 0.30%).
    pub fee_bps: u16,
}

/// Slip-adjusted constant-product swap output: reserves are (x, y) but we model
/// "give `in_b`, receive `out_a`" style legs, so the caller chooses which
/// reserve pair to move through the invariant `x * y == k`.
pub fn swap_out(reserve_in: u64, reserve_out: u64, amount_in: u64, fee_bps: u16) -> u64 {
    if reserve_in == 0 || amount_in == 0 {
        return 0;
    }
    let fee_paid = amount_in.saturating_mul(fee_bps as u64) / 10_000;
    let effective = amount_in.saturating_sub(fee_paid);
    if effective == 0 {
        return 0;
    }
    // y_out = x * d / (x + d)
    let denom = (reserve_in as u128) + (effective as u128);
    let out = (reserve_out as u128)
        .checked_mul(effective as u128)
        .and_then(|n| n.checked_div(denom))
        .unwrap_or(0) as u64;
    out
}

/// Price impact for a leg, expressed in bps. Used to grade trade quality at
/// a given notional before the on-chain gate is armed.
pub fn price_impact_bps(reserve_in: u64, amount_in: u64) -> u64 {
    if reserve_in == 0 {
        return 0;
    }
    (amount_in as u128)
        .checked_mul(10_000)
        .map(|n| n / (reserve_in as u128))
        .unwrap_or(0) as u64
}

/// A sized two-leg arbitrage that cleared the minimum-spread bar.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Opportunity {
    pub buy: PoolRef,
    pub sell: PoolRef,
    pub mint_a: String,
    pub mint_b: String,
    pub slot: u64,
    /// Slippage-adjusted profit expectation in USDC (base-6) at `size_b`.
    pub expected_profit_usdc: u64,
    /// B-in notional the searcher proposes (bounded by the gate ceiling).
    pub size_b: u64,
    /// Gross mid-price spread after fees, in bps.
    pub net_spread_bps: u64,
    /// Worst-case impact in bps across both legs at this size.
    pub impact_bps: u64,
}

/// A resolvable pool reference for the bundle builder.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PoolRef {
    pub venue: Venue,
    pub pool: String,
    pub leg: Leg,
}

/// The searcher's fan-out event for the pipeline broadcast channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SearcherEvent {
    OpportunityDetected {
        slug: String,
        slot: u64,
        expected_profit_usdc: u64,
    },
}

impl SearcherEvent {
    pub fn event_type_name(&self) -> &'static str {
        match self {
            Self::OpportunityDetected { .. } => "OpportunityDetected",
        }
    }

    pub fn slot(&self) -> u64 {
        match self {
            Self::OpportunityDetected { slot, .. } => *slot,
        }
    }
}

/// The IDENTIFY engine. Stateless and deterministic: given a pool book it
/// returns the best profitable route, or `None` when no edge exists.
#[derive(Debug, Clone, Default)]
pub struct Searcher {
    /// Minimum net (post-fee, pre-impact) spread before an opportunity fires.
    pub min_net_spread_bps: u64,
    /// Maximum B-leg notional the searcher will propose per slot (USDC base-6).
    pub max_slot_size_usdc: u64,
}

impl Searcher {
    pub fn new(min_net_spread_bps: u64, max_slot_size_usdc: u64) -> Self {
        Self {
            min_net_spread_bps,
            max_slot_size_usdc,
        }
    }

    /// Scan a pool book for the best two-leg spatial-arb route on pair (A, B).
    ///
    /// Returns the route with the highest net spread that still clears both
    /// legs' slippage at `size_b`. `None` when every route is unprofitable.
    pub fn find_arbitrage(
        &self,
        book: &[PoolState],
        slot: u64,
        size_b: u64,
    ) -> Option<Opportunity> {
        let mut best: Option<Opportunity> = None;

        // Buy A (give B) — want the *highest* B-per-A price, i.e. cheapest A.
        // Sell A (receive B) — want the *lowest* B-per-A price, i.e. richest A.
        // For every buy/sell pair:
        for buy_pool in book.iter().filter(|p| p.mint_a != p.mint_b) {
            let b_in = size_b.min(buy_pool.reserve_b);
            let out_a = swap_out(
                buy_pool.reserve_b,
                buy_pool.reserve_a,
                b_in,
                buy_pool.fee_bps,
            );
            if out_a == 0 {
                continue;
            }
            for sell_pool in book.iter().filter(|p| p.venue != buy_pool.venue) {
                let out_b = swap_out(
                    sell_pool.reserve_a,
                    sell_pool.reserve_b,
                    out_a,
                    sell_pool.fee_bps,
                );
                if out_b <= b_in {
                    continue;
                }

                let profit = out_b.saturating_sub(b_in);
                let net_spread_bps = (profit as u128)
                    .checked_mul(10_000)
                    .map(|n| n / (b_in as u128))
                    .unwrap_or(0) as u64;
                if net_spread_bps < self.min_net_spread_bps {
                    continue;
                }

                let impact_bps = price_impact_bps(buy_pool.reserve_b, b_in)
                    .saturating_add(price_impact_bps(sell_pool.reserve_a, out_a));

                // Guard against dust: the on-chain gate enforces the invariant
                // in integer USDC, so only routes whose profit clears at least
                // the tightest resolvable 0.000001 (1 lambda) are forwarded.
                let opp = Opportunity {
                    buy: PoolRef {
                        venue: buy_pool.venue,
                        pool: buy_pool.pool.clone(),
                        leg: Leg::BuyA,
                    },
                    sell: PoolRef {
                        venue: sell_pool.venue,
                        pool: sell_pool.pool.clone(),
                        leg: Leg::SellA,
                    },
                    mint_a: buy_pool.mint_a.clone(),
                    mint_b: buy_pool.mint_b.clone(),
                    slot,
                    expected_profit_usdc: profit.min(self.max_slot_size_usdc),
                    size_b: b_in.min(self.max_slot_size_usdc),
                    net_spread_bps,
                    impact_bps,
                };

                if best.as_ref().map_or(true, |b: &Opportunity| {
                    opp.net_spread_bps > b.net_spread_bps
                }) {
                    best = Some(opp);
                }
            }
        }

        best.filter(|o| o.expected_profit_usdc > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pool(venue: Venue, pool: &str, price_hi: bool) -> PoolState {
        // Two synthetic pools quoting the same pair. `price_hi` marks the pool
        // that prices A richer (sell here); the other prices it cheaper (buy).
        if price_hi {
            PoolState {
                venue,
                pool: pool.into(),
                mint_a: "TOKEN_A".into(),
                mint_b: "USDC".into(),
                reserve_a: 1_000_000_000,
                reserve_b: 1_800_000_000,
                fee_bps: 30,
            }
        } else {
            // Same constant-product $1.8M pool shape: 2.0e9 A / 1.6e9 USDC.
            PoolState {
                venue,
                pool: pool.into(),
                mint_a: "TOKEN_A".into(),
                mint_b: "USDC".into(),
                reserve_a: 2_000_000_000,
                reserve_b: 1_600_000_000,
                fee_bps: 30,
            }
        }
    }

    #[test]
    fn swap_out_applies_fee_then_invariant() {
        // 1_000_000 in, 30 bps fee → 997_000 effective.
        let out = swap_out(1_000_000_000, 2_000_000_000, 1_000_000, 30);
        // out = res_out * eff / (res_in + eff)
        let expected = (2_000_000_000u128 * 997_000u128 / 1_000_997_000u128) as u64;
        assert_eq!(out, expected);
    }

    #[test]
    fn swap_out_zero_reserve_or_input_is_zero() {
        assert_eq!(swap_out(0, 100, 50, 30), 0);
        assert_eq!(swap_out(100, 0, 50, 30), 0);
        assert_eq!(swap_out(100, 100, 0, 30), 0);
    }

    #[test]
    fn swap_out_fee_eats_tiny_input() {
        // 1_000 input with 30 bps → 30 fee → 970 effective, still > 0.
        assert!(swap_out(100_000_000, 100_000_000, 1_000, 30) > 0);
    }

    #[test]
    fn identical_prices_yield_no_opportunity() {
        let book = vec![pool(Venue::Orca, "orca", false), pool(Venue::Phoenix, "phx", false)];
        let s = Searcher::new(50, 1_500_000);
        assert!(s.find_arbitrage(&book, 1, 1_500_000).is_none());
    }

    #[test]
    fn wide_spread_across_venues_fires_opportunity() {
        // Buy the cheap pool, sell into the rich pool.
        let book = vec![pool(Venue::Orca, "orca", false), pool(Venue::Phoenix, "phx", true)];
        let s = Searcher::new(50, 1_500_000);
        let opp = s.find_arbitrage(&book, 42, 1_500_000).expect("opportunity");
        assert_eq!(opp.buy.venue, Venue::Orca);
        assert_eq!(opp.sell.venue, Venue::Phoenix);
        assert!(opp.expected_profit_usdc > 0);
        assert!(opp.net_spread_bps >= 50);
        assert_eq!(opp.slot, 42);
        assert_eq!(opp.size_b, 1_500_000);
    }

    #[test]
    fn same_venue_pair_is_not_traded() {
        // Both pools on the same DEX must not fire (spatial edge requires two
        // independent venues; a single venue is its own price).
        let book = vec![pool(Venue::Orca, "orca-a", false), pool(Venue::Orca, "orca-b", true)];
        let s = Searcher::new(50, 1_500_000);
        assert!(s.find_arbitrage(&book, 1, 1_500_000).is_none());
    }

    #[test]
    fn below_minimum_spread_is_filtered() {
        // Tiny notional on deep pools → profit rounds to zero → ignored.
        let book = vec![pool(Venue::Orca, "orca", false), pool(Venue::Phoenix, "phx", true)];
        let s = Searcher::new(1_000_000, 1_500_000); // absurd min spread
        assert!(s.find_arbitrage(&book, 1, 1_500_000).is_none());
    }

    #[test]
    fn slot_size_is_capped() {
        let book = vec![pool(Venue::Orca, "orca", false), pool(Venue::Phoenix, "phx", true)];
        let s = Searcher::new(50, 500_000);
        let opp = s.find_arbitrage(&book, 7, 1_500_000).expect("opportunity");
        assert_eq!(opp.size_b, 500_000);
        assert_eq!(opp.expected_profit_usdc, opp.expected_profit_usdc.min(500_000));
    }

    #[test]
    fn event_payload_is_classifyable() {
        let ev = SearcherEvent::OpportunityDetected {
            slug: "USDC-SOL".into(),
            slot: 9,
            expected_profit_usdc: 900,
        };
        assert_eq!(ev.event_type_name(), "OpportunityDetected");
        assert_eq!(ev.slot(), 9);
    }
}