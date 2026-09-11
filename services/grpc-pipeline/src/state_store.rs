use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use dashmap::DashMap;
/// Default TTL (in seconds) before cached state is considered stale.
const STALE_TTL_SECS: u64 = 30;

/// Mirrors the on-chain 24h floating window (~400ms slots).
const WINDOW_SLOTS: u64 = 216_000;
/// Mirrors the on-chain 2h hard-escalation grace window.
const GRACE_SLOTS: u64 = 18_000;

// ─────────────────────────── Market State ───────────────────────────

#[derive(Debug, Clone)]
pub struct MarketState {
    pub market: String,
    pub price: f64,
    pub confidence: f64,
    pub publish_time: i64,
    pub funding_rate: f64,
    pub slot: u64,
    pub updated_at: Instant,
}

// ─────────────────────────── Position State ─────────────────────────

#[derive(Debug, Clone)]
pub struct PositionState {
    pub wallet: String,
    pub market: String,
    pub is_long: bool,
    pub size_usdc: f64,
    pub entry_price: f64,
    pub unrealized_pnl: f64,
    pub margin_balance: f64,
    pub opened_slot: i64,
    pub updated_at: Instant,
}

// ─────────────────────────── Credit State ───────────────────────────

#[derive(Debug, Clone)]
pub struct CreditState {
    pub wallet: String,
    pub credit_limit: f64,
    pub outstanding: f64,
    pub utilization_bps: f64,
    pub toll_rate_bps: f64,
    pub authorized: bool,
    pub updated_at: Instant,
}

// ─────────────────────────── Pool State ─────────────────────────────

#[derive(Debug, Clone)]
pub struct PoolState {
    pub pool_label: String,
    pub kyc_required: bool,
    pub total_shares: f64,
    pub base_reserve: f64,
    pub quote_reserve: f64,
    pub lp_count: i64,
    pub is_paused: bool,
    pub updated_at: Instant,
}

// ───────────────────────── Capacity Engine State ────────────────────

/// Single-slot clearing & risk engine view for a registered operator.
#[derive(Debug, Clone)]
pub struct CapacityState {
    pub operator: String,
    pub credit_limit: u64,
    pub active_utilization: u64,
    pub available_balance: u64,
    pub margin_posted: u64,
    pub tier: u8,
    pub premium_multiplier_bps: u64,
    pub frozen: bool,
    pub kyc_verified: bool,
    pub current_premium_bps: u64,
    pub load_ratio_bps: u64,
    pub updated_at: Instant,
}

impl CapacityState {
    pub fn available_balance(&self) -> u64 {
        self.credit_limit
            .saturating_add(self.margin_posted)
            .saturating_sub(self.active_utilization)
    }
}

// ─────────────────────────── Tranche State ──────────────────────────

/// Dual-tranche vault NAV view.
#[derive(Debug, Clone)]
pub struct TrancheState {
    pub tranche_label: String,
    pub nav_usdc: f64,
    pub total_shares: f64,
    pub loss_cap_bps: u64,
    pub accepts_deposits: bool,
    pub updated_at: Instant,
}

// ─────────────────── Asset Engine Desk State ────────────────────────

/// Floating-window desk view streamed to the Risk Sentinel: per-mint borrow
/// mirror + the desk's peak utilization, accrued taxi-meter premiums, and the
/// deterministic posture that drives the Phase-2 soft lock / Phase-3 breach
/// escalation wall.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeskPosture {
    NoWindow,
    Open,
    Overdue,
    Breached,
}

impl DeskState {
    pub fn window_posture(&self, current_slot: u64) -> DeskPosture {
        if self.window_start_slot == 0 {
            return DeskPosture::NoWindow;
        }
        let mature = self.window_start_slot.saturating_add(WINDOW_SLOTS);
        if current_slot < mature {
            DeskPosture::Open
        } else if current_slot < mature.saturating_add(GRACE_SLOTS) {
            DeskPosture::Overdue
        } else {
            DeskPosture::Breached
        }
    }
}

#[derive(Debug, Clone)]
pub struct DeskState {
    pub institution: String,
    pub mint: String,
    pub active_principal: u64,
    pub accumulated_premiums: u64,
    pub window_start_slot: u64,
    pub peak_active_utilization: u64,
    pub last_settlement_timestamp: i64,
    pub updated_at: Instant,
}

// ─────────────────────────── State Store ────────────────────────────

/// Thread-safe in-memory state store backed by `DashMap` for lock-free
/// concurrent reads and writes. Each entry carries a timestamp used for
/// TTL-based stale-data eviction.
pub struct StateStore {
    markets: DashMap<String, MarketState>,
    positions: DashMap<String, PositionState>,
    credits: DashMap<String, CreditState>,
    pools: DashMap<String, PoolState>,
    capacities: DashMap<String, CapacityState>,
    tranches: DashMap<String, TrancheState>,
    desks: DashMap<String, DeskState>,
    /// Cross-DEX price book consumed by the searcher's IDENTIFY stage. Keyed by
    /// `"{venue}:{pool}"`; entries carry integer reserves the searcher math
    /// expects.
    arb_book: DashMap<String, crate::searcher::PoolState>,
    /// Highest slot observed so far, used to stamp detected opportunities.
    last_slot: AtomicU64,
}

impl StateStore {
    pub fn new() -> Self {
        Self {
            markets: DashMap::new(),
            positions: DashMap::new(),
            credits: DashMap::new(),
            pools: DashMap::new(),
            capacities: DashMap::new(),
            tranches: DashMap::new(),
            desks: DashMap::new(),
            arb_book: DashMap::new(),
            last_slot: AtomicU64::new(0),
        }
    }

    // ── Searcher pool book ──

    /// The last slot observed from any parsed event feed.
    pub fn last_slot(&self) -> u64 {
        self.last_slot.load(Ordering::Relaxed)
    }

    /// Remember the highest slot seen so far.
    pub fn note_slot(&self, slot: u64) {
        self.last_slot.fetch_max(slot, Ordering::Relaxed);
    }

    /// Upsert one cross-DEX pool quote into the searcher's book.
    pub fn update_searcher_pool(&self, pool: crate::searcher::PoolState) {
        let key = format!("{}:{}", pool.venue.as_str(), pool.pool);
        self.arb_book.insert(key, pool);
    }

    /// Snapshot of the current cross-DEX book (non-stale entries only).
    pub fn arb_book(&self) -> Vec<crate::searcher::PoolState> {
        self.arb_book
            .iter()
            .map(|entry| entry.value().clone())
            .collect()
    }

    /// Drop a pool from the book (e.g. closed market or evicted feed).
    pub fn remove_searcher_pool(&self, venue: crate::searcher::Venue, pool: &str) {
        let key = format!("{}:{}", venue.as_str(), pool);
        self.arb_book.remove(&key);
    }

    // ── Market ──

    pub fn update_market(&self, state: MarketState) {
        self.markets.insert(state.market.clone(), state);
    }

    pub fn get_market(&self, market: &str) -> Option<MarketState> {
        self.markets.get(market).map(|entry| entry.value().clone()).filter(|s| !s.is_stale())
    }

    // ── Position ──

    /// Key is "{wallet}:{market}".
    pub fn update_position(&self, state: PositionState) {
        let key = format!("{}:{}", state.wallet, state.market);
        self.positions.insert(key, state);
    }

    pub fn get_position(&self, wallet: &str, market: &str) -> Option<PositionState> {
        let key = format!("{}:{}", wallet, market);
        self.positions.get(&key).map(|entry| entry.value().clone()).filter(|s| !s.is_stale())
    }

    // ── Credit ──

    pub fn update_credit(&self, state: CreditState) {
        self.credits.insert(state.wallet.clone(), state);
    }

    pub fn get_credit(&self, wallet: &str) -> Option<CreditState> {
        self.credits.get(wallet).map(|entry| entry.value().clone()).filter(|s| !s.is_stale())
    }

    // ── Pool ──

    pub fn update_pool(&self, state: PoolState) {
        self.pools.insert(state.pool_label.clone(), state);
    }

    pub fn get_pool(&self, pool_label: &str) -> Option<PoolState> {
        self.pools.get(pool_label).map(|entry| entry.value().clone()).filter(|s| !s.is_stale())
    }

    // ── Capacity engine ──

    pub fn update_capacity(&self, state: CapacityState) {
        self.capacities.insert(state.operator.clone(), state);
    }

    pub fn get_capacity(&self, operator: &str) -> Option<CapacityState> {
        self.capacities.get(operator).map(|entry| entry.value().clone()).filter(|s| !s.is_stale())
    }

    // ── Tranche vault ──

    pub fn update_tranche(&self, state: TrancheState) {
        self.tranches.insert(state.tranche_label.clone(), state);
    }

    pub fn get_tranche(&self, tranche_label: &str) -> Option<TrancheState> {
        self.tranches.get(tranche_label).map(|entry| entry.value().clone()).filter(|s| !s.is_stale())
    }

    // ── Asset engine desk ──

    /// Key is "{institution}:{mint}".
    pub fn update_desk(&self, state: DeskState) {
        let key = format!("{}:{}", state.institution, state.mint);
        self.desks.insert(key, state);
    }

    pub fn get_desk(&self, institution: &str, mint: &str) -> Option<DeskState> {
        let key = format!("{institution}:{mint}");
        self.desks.get(&key).map(|entry| entry.value().clone()).filter(|s| !s.is_stale())
    }

    // ── Eviction ──

    /// Remove entries older than `STALE_TTL_SECS`. Call periodically (e.g. every 10s).
    pub fn evict_stale(&self) {
        self.markets.retain(|_, v| !v.is_stale());
        self.positions.retain(|_, v| !v.is_stale());
        self.credits.retain(|_, v| !v.is_stale());
        self.pools.retain(|_, v| !v.is_stale());
        self.capacities.retain(|_, v| !v.is_stale());
        self.tranches.retain(|_, v| !v.is_stale());
    }

    /// Apply a parsed event to update the appropriate state bucket.
    pub fn apply_event(&self, event: &crate::event_parser::ParsedEvent) {
        use crate::event_parser::ParsedEvent;
        self.note_slot(event.slot());
        match event {
            ParsedEvent::CreditPulled {
                borrower,
                amount: _,
                outstanding,
                ..
            } => {
                let wallet = borrower.clone();
                let existing = self
                    .credits
                    .get(&wallet)
                    .map(|e| e.value().clone())
                    .unwrap_or_else(|| CreditState {
                        wallet: wallet.clone(),
                        credit_limit: 0.0,
                        outstanding: 0.0,
                        utilization_bps: 0.0,
                        toll_rate_bps: 0.0,
                        authorized: true,
                        updated_at: Instant::now(),
                    });
                self.update_credit(CreditState {
                    outstanding: *outstanding as f64,
                    ..existing
                });
            }
            ParsedEvent::CreditSettled {
                borrower,
                principal: _,
                rate_bps,
                utilization_bps,
                ..
            } => {
                let wallet = borrower.clone();
                let existing = self
                    .credits
                    .get(&wallet)
                    .map(|e| e.value().clone())
                    .unwrap_or_else(|| CreditState {
                        wallet: wallet.clone(),
                        credit_limit: 0.0,
                        outstanding: 0.0,
                        utilization_bps: 0.0,
                        toll_rate_bps: 0.0,
                        authorized: true,
                        updated_at: Instant::now(),
                    });
                self.update_credit(CreditState {
                    utilization_bps: *utilization_bps as f64,
                    toll_rate_bps: *rate_bps as f64,
                    ..existing
                });
            }
            ParsedEvent::LiquidityDeposited {
                pool,
                amount,
                shares,
                ..
            } => {
                let label = pool.clone();
                let existing = self
                    .pools
                    .get(&label)
                    .map(|e| e.value().clone())
                    .unwrap_or_else(|| PoolState {
                        pool_label: label.clone(),
                        kyc_required: false,
                        total_shares: 0.0,
                        base_reserve: 0.0,
                        quote_reserve: 0.0,
                        lp_count: 0,
                        is_paused: false,
                        updated_at: Instant::now(),
                    });
                self.update_pool(PoolState {
                    total_shares: existing.total_shares + *shares as f64,
                    base_reserve: existing.base_reserve + *amount as f64,
                    ..existing
                });
            }
            ParsedEvent::LiquidityWithdrawn {
                pool,
                amount,
                shares,
                ..
            } => {
                let label = pool.clone();
                let existing = self
                    .pools
                    .get(&label)
                    .map(|e| e.value().clone())
                    .unwrap_or_else(|| PoolState {
                        pool_label: label.clone(),
                        kyc_required: false,
                        total_shares: 0.0,
                        base_reserve: 0.0,
                        quote_reserve: 0.0,
                        lp_count: 0,
                        is_paused: false,
                        updated_at: Instant::now(),
                    });
                self.update_pool(PoolState {
                    total_shares: existing.total_shares - *shares as f64,
                    base_reserve: existing.base_reserve - *amount as f64,
                    ..existing
                });
            }
            ParsedEvent::SwapExecuted {
                pool,
                amount_in,
                amount_out,
                ..
            } => {
                let label = pool.clone();
                let existing = self
                    .pools
                    .get(&label)
                    .map(|e| e.value().clone())
                    .unwrap_or_else(|| PoolState {
                        pool_label: label.clone(),
                        kyc_required: false,
                        total_shares: 0.0,
                        base_reserve: 0.0,
                        quote_reserve: 0.0,
                        lp_count: 0,
                        is_paused: false,
                        updated_at: Instant::now(),
                    });
                self.update_pool(PoolState {
                    base_reserve: existing.base_reserve + *amount_in as f64,
                    quote_reserve: existing.quote_reserve - *amount_out as f64,
                    ..existing
                });
            }
            ParsedEvent::PositionOpened {
                wallet,
                market,
                is_long,
                size_usdc,
                entry_price,
                ..
            } => {
                self.update_position(PositionState {
                    wallet: wallet.clone(),
                    market: market.clone(),
                    is_long: *is_long,
                    size_usdc: *size_usdc as f64,
                    entry_price: *entry_price as f64,
                    unrealized_pnl: 0.0,
                    margin_balance: 0.0,
                    opened_slot: event.slot() as i64,
                    updated_at: Instant::now(),
                });
            }
            ParsedEvent::PositionClosed { wallet, market, .. } => {
                let key = format!("{}:{}", wallet, market);
                self.positions.remove(&key);
            }
            ParsedEvent::Liquidated { wallet, market, .. } => {
                let key = format!("{}:{}", wallet, market);
                self.positions.remove(&key);
            }
            ParsedEvent::BidSubmitted {
                slot,
                bidder,
                tip,
                ..
            } => {
                // Gateway auction events don't map to a primary state bucket;
                // they flow through as EventEnvelopes to streaming clients.
                tracing::debug!(slot, bidder = %bidder, tip, "bid submitted");
            }
            ParsedEvent::AuctionSettled {
                slot,
                winner,
                premium_tips,
                ..
            } => {
                tracing::debug!(slot, winner = %winner, premium_tips, "auction settled");
            }
        }
    }
}

impl Default for StateStore {
    fn default() -> Self {
        Self::new()
    }
}

// ── Helpers ──

trait IsStale {
    fn is_stale(&self) -> bool;
}

impl IsStale for MarketState {
    fn is_stale(&self) -> bool {
        self.updated_at.elapsed().as_secs() > STALE_TTL_SECS
    }
}

impl IsStale for PositionState {
    fn is_stale(&self) -> bool {
        self.updated_at.elapsed().as_secs() > STALE_TTL_SECS
    }
}

impl IsStale for CreditState {
    fn is_stale(&self) -> bool {
        self.updated_at.elapsed().as_secs() > STALE_TTL_SECS
    }
}

impl IsStale for PoolState {
    fn is_stale(&self) -> bool {
        self.updated_at.elapsed().as_secs() > STALE_TTL_SECS
    }
}

impl IsStale for CapacityState {
    fn is_stale(&self) -> bool {
        self.updated_at.elapsed().as_secs() > STALE_TTL_SECS
    }
}

impl IsStale for TrancheState {
    fn is_stale(&self) -> bool {
        self.updated_at.elapsed().as_secs() > STALE_TTL_SECS
    }
}

impl IsStale for DeskState {
    fn is_stale(&self) -> bool {
        self.updated_at.elapsed().as_secs() > STALE_TTL_SECS
    }
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    fn market(market: &str, price: f64, slot: u64) -> MarketState {
        MarketState {
            market: market.to_string(),
            price,
            confidence: 0.99,
            publish_time: 0,
            funding_rate: 0.0001,
            slot,
            updated_at: Instant::now(),
        }
    }

    fn credit(wallet: &str, limit: f64, outstanding: f64) -> CreditState {
        CreditState {
            wallet: wallet.to_string(),
            credit_limit: limit,
            outstanding,
            utilization_bps: 0.0,
            toll_rate_bps: 5.0,
            authorized: true,
            updated_at: Instant::now(),
        }
    }

    fn pool(label: &str, shares: f64) -> PoolState {
        PoolState {
            pool_label: label.to_string(),
            kyc_required: false,
            total_shares: shares,
            base_reserve: shares * 2.0,
            quote_reserve: shares * 100.0,
            lp_count: 1,
            is_paused: false,
            updated_at: Instant::now(),
        }
    }

    #[test]
    fn market_update_and_get() {
        let store = StateStore::new();
        let m = market("SOL-PERP", 142.50, 100);
        store.update_market(m.clone());
        let got = store.get_market("SOL-PERP").expect("should exist");
        assert_eq!(got.price, 142.50);
        assert_eq!(got.slot, 100);
    }

    #[test]
    fn market_get_returns_none_for_missing() {
        let store = StateStore::new();
        assert!(store.get_market("NONEXISTENT").is_none());
    }

    #[test]
    fn position_update_and_get() {
        let store = StateStore::new();
        store.update_position(PositionState {
            wallet: "wallet1".into(),
            market: "SOL-PERP".into(),
            is_long: true,
            size_usdc: 1000.0,
            entry_price: 140.0,
            unrealized_pnl: 50.0,
            margin_balance: 500.0,
            opened_slot: 99,
            updated_at: Instant::now(),
        });
        let got = store.get_position("wallet1", "SOL-PERP").expect("should exist");
        assert!(got.is_long);
        assert_eq!(got.size_usdc, 1000.0);
    }

    #[test]
    fn credit_update_and_get() {
        let store = StateStore::new();
        let c = credit("desk1", 100_000.0, 25_000.0);
        store.update_credit(c.clone());
        let got = store.get_credit("desk1").expect("should exist");
        assert_eq!(got.credit_limit, 100_000.0);
        assert_eq!(got.outstanding, 25_000.0);
    }

    #[test]
    fn pool_update_and_get() {
        let store = StateStore::new();
        let p = pool("SOL-USDC Institutional", 50_000.0);
        store.update_pool(p.clone());
        let got = store.get_pool("SOL-USDC Institutional").expect("should exist");
        assert_eq!(got.total_shares, 50_000.0);
    }

    #[test]
    fn stale_data_eviction() {
        let store = StateStore::new();

        // Insert a market, then manually age it.
        store.update_market(MarketState {
            market: "STALE-TEST".into(),
            price: 1.0,
            confidence: 1.0,
            publish_time: 0,
            funding_rate: 0.0,
            slot: 1,
            updated_at: Instant::now() - std::time::Duration::from_secs(STALE_TTL_SECS + 1),
        });

        // Should be filtered as stale.
        assert!(store.get_market("STALE-TEST").is_none());

        // evict_stale removes it from the map entirely.
        store.evict_stale();
        assert!(store.markets.get("STALE-TEST").is_none());
    }

    #[test]
    fn fresh_data_not_evicted() {
        let store = StateStore::new();
        store.update_market(market("FRESH-TEST", 42.0, 1));
        assert!(store.get_market("FRESH-TEST").is_some());
        store.evict_stale();
        assert!(store.get_market("FRESH-TEST").is_some());
    }

    #[test]
    fn position_key_format() {
        let store = StateStore::new();
        store.update_position(PositionState {
            wallet: "abc".into(),
            market: "ETH-PERP".into(),
            is_long: false,
            size_usdc: 0.0,
            entry_price: 0.0,
            unrealized_pnl: 0.0,
            margin_balance: 0.0,
            opened_slot: 0,
            updated_at: Instant::now(),
        });
        // Should not be findable with swapped args.
        assert!(store.get_position("ETH-PERP", "abc").is_none());
        assert!(store.get_position("abc", "ETH-PERP").is_some());
    }

    #[test]
    fn capacity_update_and_get() {
        let store = StateStore::new();
        store.update_capacity(CapacityState {
            operator: "desk1".into(),
            credit_limit: 500_000,
            active_utilization: 200_000,
            available_balance: 0,
            margin_posted: 100_000,
            tier: 1,
            premium_multiplier_bps: 100,
            frozen: false,
            kyc_verified: true,
            current_premium_bps: 25,
            load_ratio_bps: 5_000,
            updated_at: Instant::now(),
        });
        let got = store.get_capacity("desk1").expect("should exist");
        assert_eq!(got.credit_limit, 500_000);
        assert_eq!(got.available_balance(), 400_000);
    }

    #[test]
    fn tranche_update_and_get() {
        let store = StateStore::new();
        store.update_tranche(TrancheState {
            tranche_label: "Protected".into(),
            nav_usdc: 1_000_000.0,
            total_shares: 1_000_000.0,
            loss_cap_bps: 200,
            accepts_deposits: true,
            updated_at: Instant::now(),
        });
        let got = store.get_tranche("Protected").expect("should exist");
        assert_eq!(got.nav_usdc, 1_000_000.0);
        assert_eq!(got.loss_cap_bps, 200);
    }

    #[test]
    fn desk_update_and_get_is_institution_mint_scoped() {
        let store = StateStore::new();
        store.update_desk(DeskState {
            institution: "desk1".into(),
            mint: "USDC".into(),
            active_principal: 150_000_000,
            accumulated_premiums: 12_500,
            window_start_slot: 1_234_567,
            peak_active_utilization: 180_000_000,
            last_settlement_timestamp: 1_758_000_000,
            updated_at: Instant::now(),
        });
        let got = store.get_desk("desk1", "USDC").expect("should exist");
        assert_eq!(got.active_principal, 150_000_000);
        assert_eq!(got.peak_active_utilization, 180_000_000);
        assert_eq!(got.accumulated_premiums, 12_500);
        // Wrong mint / wrong institution must not resolve.
        assert!(store.get_desk("desk1", "SOL").is_none());
        assert!(store.get_desk("desk2", "USDC").is_none());
    }

    #[test]
    fn desk_posture_tracks_soft_lock_grace_and_breach() {
        let desk = DeskState {
            institution: "desk1".into(),
            mint: "USDC".into(),
            active_principal: 150_000_000,
            accumulated_premiums: 12_500,
            window_start_slot: 1_000_000,
            peak_active_utilization: 180_000_000,
            last_settlement_timestamp: 0,
            updated_at: Instant::now(),
        };
        assert_eq!(desk.window_posture(1_000_000), DeskPosture::Open);
        let mature = 1_000_000 + WINDOW_SLOTS;
        assert_eq!(desk.window_posture(mature - 1), DeskPosture::Open);
        assert_eq!(desk.window_posture(mature), DeskPosture::Overdue);
        assert_eq!(desk.window_posture(mature + GRACE_SLOTS - 1), DeskPosture::Overdue);
        assert_eq!(desk.window_posture(mature + GRACE_SLOTS), DeskPosture::Breached);

        // A desk that has never borrowed reports no-window.
        let fresh = DeskState {
            window_start_slot: 0,
            ..desk
        };
        assert_eq!(fresh.window_posture(99_999_999), DeskPosture::NoWindow);
    }
}
