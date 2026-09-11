//! # gRPC Stream — pool-capacity feed
//!
//! The HFT velocity feed behind `NovisciaTvvClient`. A background subscriber
//! consumes the `noviscia.sandbox.v1.MarketVelocityStream.SubscribePoolState`
//! contract (the Yellowstone "Dragon's Mouth" emulation shared 1:1 with the
//! sandbox and the production pipeline) and folds every `PoolStateUpdate` into
//! an in-process, lock-guarded capacity cache. The hot path
//! (`check_slot_headroom`) is then a plain `HashMap` read — sub-microsecond,
//! no network, no allocation.
//!
//! Headroom for a mint is defined as:
//!
//! ```text
//! headroom = total_idle_capital − active_credit_utilization
//! ```
//!
//! in base units (lamports / micro-USDC), saturating at zero.
//!
//! ## EXCLUSIVITY gate
//!
//! When the current slot is led by a non-Jito block builder, the stream sets
//! `allocation_frozen = true`. The cache exposes this flag immediately —
//! `get()` returns `0` regardless of the real headroom, so the client SDK
//! refuses to compile a bundle ("zero bytes leave the machine").

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use solana_program::hash::hash;
use solana_program::pubkey::Pubkey;
use tokio_stream::StreamExt;

/// Compiled `noviscia.sandbox.v1` wire types.
pub mod v1 {
    tonic::include_proto!("noviscia.sandbox.v1");
}

use v1::market_velocity_stream_client::MarketVelocityStreamClient;
use v1::PoolSubscriptionRequest;

/// Base-58 mint labels from the sandbox feed (`"USDC"`, `"SOL"`, …) mapped
/// onto a stable 32-byte cache key so the SDK stays keyed by `Pubkey` without
/// ever touching the network.
pub fn mint_key(label: &str) -> Pubkey {
    if let Ok(pk) = label.parse::<Pubkey>() {
        return pk;
    }
    let h = hash(label.as_bytes());
    Pubkey::new_from_array(h.to_bytes())
}

/// Available headroom (base units) from a pool-state update.
pub fn headroom_of(total_idle_capital: u64, active_credit_utilization: u64) -> u64 {
    total_idle_capital.saturating_sub(active_credit_utilization)
}

/// In-process capacity cache shared between the feed task and the caller.
///
/// Two `Arc<RwLock<HashMap>>` maps underneath: headroom and a per-mint
/// frozen flag (EXCLUSIVITY). `get()` returns `0` when a mint is frozen so
/// the guardrail in `NovisciaTvvClient` refuses any allocation.
#[derive(Default, Clone)]
pub struct CapacityCache {
    headroom: Arc<RwLock<HashMap<Pubkey, u64>>>,
    frozen: Arc<RwLock<HashMap<Pubkey, bool>>>,
}

impl CapacityCache {
    /// An empty cache.
    pub fn new() -> Self {
        Self::default()
    }

    /// Copy the freshest headroom for `mint` (0 until the first update lands).
    /// Returns 0 immediately while the mint is frozen (non-Jito leader).
    pub fn get(&self, mint: &Pubkey) -> u64 {
        if self.is_allocation_frozen(mint) {
            return 0;
        }
        self.headroom.read().unwrap().get(mint).copied().unwrap_or(0)
    }

    /// Insert/replace the headroom for `mint`.
    pub fn set(&self, mint: Pubkey, headroom: u64) {
        self.headroom.write().unwrap().insert(mint, headroom);
    }

    /// Mark or clear the EXCLUSIVITY freeze for `mint`.
    pub fn set_frozen(&self, mint: Pubkey, frozen: bool) {
        self.frozen.write().unwrap().insert(mint, frozen);
    }

    /// Whether the given pool is currently frozen by a non-Jito leader slot.
    pub fn is_allocation_frozen(&self, mint: &Pubkey) -> bool {
        self.frozen
            .read()
            .unwrap()
            .get(mint)
            .copied()
            .unwrap_or(false)
    }

    /// Snapshot every tracked mint — used by the example's health screen.
    /// Returns `(mint, headroom, frozen)`.
    pub fn snapshot(&self) -> Vec<(Pubkey, u64, bool)> {
        let mut out: Vec<(Pubkey, u64, bool)> = {
            let head = self.headroom.read().unwrap();
            let froz = self.frozen.read().unwrap();
            head.iter()
                .map(|(k, &h)| (*k, h, froz.get(k).copied().unwrap_or(false)))
                .collect()
        };
        out.sort_by_key(|(k, _, _)| *k);
        out
    }
}

/// Fold a single feed update into the cache.
pub fn apply_update(
    cache: &CapacityCache,
    asset_mint: &str,
    total_idle_capital: u64,
    active_credit_utilization: u64,
    allocation_frozen: bool,
) -> u64 {
    let mint = mint_key(asset_mint);
    cache.set_frozen(mint, allocation_frozen);
    let headroom = headroom_of(total_idle_capital, active_credit_utilization);
    cache.set(mint, headroom);
    headroom
}

/// Connect, subscribe and stream until the connection drops, then hand control
/// back so `run_feed` can reconnect. Pulls the wire contract served on the
/// same port by `sandbox-hub` (`:10000`) and, in production, the feed mirror.
async fn run_session(
    endpoint: &str,
    mints: Vec<String>,
    cache: &CapacityCache,
) -> Result<(), String> {
    let mut client = MarketVelocityStreamClient::connect(endpoint.to_string())
        .await
        .map_err(|e| format!("connect {endpoint}: {e}"))?;

    let request = PoolSubscriptionRequest {
        app_token: "noviscia-client".to_string(),
        asset_mints: mints,
    };

    let mut stream = client
        .subscribe_pool_state(request)
        .await
        .map_err(|e| format!("subscribe: {e}"))?
        .into_inner();

    while let Some(update) = stream.next().await {
        let update = update.map_err(|e| format!("stream error: {e}"))?;
        let _ = apply_update(
            cache,
            &update.asset_mint,
            update.total_idle_capital,
            update.active_credit_utilization,
            update.allocation_frozen,
        );
    }
    Ok(())
}

/// Background ingestion loop: keep a session alive (reconnect every 300ms on
/// drop) until `stop` is set or the task is aborted.
pub async fn run_feed(
    endpoint: String,
    mints: Vec<String>,
    cache: CapacityCache,
    stop: Arc<AtomicBool>,
) {
    while !stop.load(std::sync::atomic::Ordering::Relaxed) {
        match run_session(&endpoint, mints.clone(), &cache).await {
            Ok(()) => {
                eprintln!("feed: session ended gracefully, reconnecting");
                tokio::time::sleep(Duration::from_millis(300)).await;
            }
            Err(e) => {
                eprintln!("feed: {e}; reconnecting in 300ms");
                tokio::time::sleep(Duration::from_millis(300)).await;
            }
        }
    }
}

/// Spawn the feed on the current tokio runtime and return the shared cache.
/// The returned handle aborts the loop when dropped/aborted.
pub fn spawn_feed(endpoint: String, mints: Vec<String>) -> (CapacityCache, tokio::task::JoinHandle<()>) {
    let cache = CapacityCache::new();
    let stop = Arc::new(AtomicBool::new(false));
    let handle = tokio::spawn(run_feed(endpoint, mints, cache.clone(), stop));
    (cache, handle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    #[test]
    fn headroom_is_capital_minus_utilization() {
        assert_eq!(headroom_of(1_500_000_000, 1_200_000_000), 300_000_000);
    }

    #[test]
    fn headroom_saturates_at_zero() {
        assert_eq!(headroom_of(100, 101), 0);
        assert_eq!(headroom_of(0, u64::MAX), 0);
    }

    #[test]
    fn mint_key_accepts_raw_pubkeys_and_labels() {
        let pk = Pubkey::new_unique();
        assert_eq!(mint_key(&pk.to_string()), pk);
        // Sandbox labels ("USDC", "SOL") hash to a stable, distinct key.
        assert_ne!(mint_key("USDC"), mint_key("SOL"));
        assert_eq!(mint_key("USDC"), mint_key("USDC"));
    }

    #[test]
    fn apply_update_folds_into_cache() {
        let cache = CapacityCache::new();
        let usdc = mint_key("USDC");
        assert_eq!(apply_update(&cache, "USDC", 500, 200, false), 300);
        assert_eq!(cache.get(&usdc), 300);
        assert!(!cache.is_allocation_frozen(&usdc));
    }

    #[test]
    fn frozen_returns_zero_despite_positive_headroom() {
        let cache = CapacityCache::new();
        let usdc = mint_key("USDC");
        apply_update(&cache, "USDC", 1_000_000_000, 0, false);
        assert_eq!(cache.get(&usdc), 1_000_000_000);
        apply_update(&cache, "USDC", 1_000_000_000, 0, true);
        assert!(cache.is_allocation_frozen(&usdc));
        assert_eq!(cache.get(&usdc), 0, "frozen pool must read headroom 0");
        // Unfreeze → headroom returns.
        apply_update(&cache, "USDC", 1_000_000_000, 0, false);
        assert_eq!(cache.get(&usdc), 1_000_000_000);
    }

    #[test]
    fn unknown_mint_reads_zero() {
        let cache = CapacityCache::new();
        assert_eq!(cache.get(&Pubkey::new_unique()), 0);
    }

    #[test]
    fn snapshot_is_sorted_and_complete() {
        let cache = CapacityCache::new();
        apply_update(&cache, "USDC", 500, 0, false);
        apply_update(&cache, "SOL", 300, 0, true);
        let snap = cache.snapshot();
        assert_eq!(snap.len(), 2);
        assert!(snap.windows(2).all(|w| w[0].0 < w[1].0));
        // SOL is frozen; USDC is not.
        let usdc = snap.iter().find(|(k, _, _)| *k == mint_key("USDC")).unwrap();
        assert!(!usdc.2);
        let sol = snap.iter().find(|(k, _, _)| *k == mint_key("SOL")).unwrap();
        assert!(sol.2);
        assert!(AtomicBool::new(true).load(Ordering::Relaxed));
    }
}
