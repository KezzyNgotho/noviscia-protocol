//! # Swap Observatory — cross-DEX pool book feed
//!
//! Feeds the searcher's IDENTIFY stage with constant-product pool quotes from
//! the supported venues (Jupiter, Orca, Phoenix). In local / devnet execution
//! the book is seeded from a JSON snapshot via `POOL_BOOK_SEED`; a production
//! deployment swaps `load_book_seed` for a live Geyser/Yellowstone account
//! subscription per venue pool (the intake boundary is one function).

use std::sync::Arc;

use anyhow::{bail, Context, Result};
use serde::Deserialize;

use crate::searcher::{PoolState, Venue};
use crate::state_store::StateStore;

/// JSON shape of the seed snapshot. `slot` is optional so hand-written seeds
/// don't need to track an RPC slot.
#[derive(Debug, Clone, Deserialize)]
struct SeedPool {
    venue: String,
    pool: String,
    #[serde(alias = "mint_a")]
    mint_a: String,
    #[serde(alias = "mint_b")]
    mint_b: String,
    #[serde(alias = "reserve_a")]
    reserve_a: u64,
    #[serde(alias = "reserve_b")]
    reserve_b: u64,
    #[serde(default, alias = "fee_bps")]
    fee_bps: u16,
    #[serde(default)]
    slot: u64,
}

/// Parse pool quotes from a JSON array and load them into the store's book.
/// `spec` is either an inline JSON document or `file:<path>` pointing at one.
pub fn load_book_seed(state: &Arc<StateStore>, spec: &str) -> Result<()> {
    let spec = spec.trim();
    let json = if let Some(path) = spec.strip_prefix("file:") {
        std::fs::read_to_string(path)
            .with_context(|| format!("read pool book seed file '{path}'"))?
    } else {
        spec.to_string()
    };

    let pools: Vec<SeedPool> = serde_json::from_str(&json)
        .context("parse pool book seed (expected an array of pool quotes)")?;

    let mut loaded = 0usize;
    for seed in pools {
        let Some(venue) = Venue::from_label(&seed.venue) else {
            tracing::warn!(venue = %seed.venue, "skipping pool with unsupported venue");
            continue;
        };
        if seed.reserve_a == 0 || seed.reserve_b == 0 {
            tracing::warn!(pool = %seed.pool, "skipping pool with zero reserves");
            continue;
        }
        if seed.mint_a == seed.mint_b {
            tracing::warn!(pool = %seed.pool, "skipping degenerate pool (same mint both sides)");
            continue;
        }
        state.update_searcher_pool(PoolState {
            venue,
            pool: seed.pool,
            mint_a: seed.mint_a,
            mint_b: seed.mint_b,
            reserve_a: seed.reserve_a,
            reserve_b: seed.reserve_b,
            fee_bps: seed.fee_bps,
        });
        state.note_slot(seed.slot);
        loaded += 1;
    }

    if loaded == 0 {
        bail!("pool book seed loaded 0 pools — nothing for the searcher to scan");
    }
    tracing::info!(pools = loaded, "pool book seed loaded");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_state() -> Arc<StateStore> {
        Arc::new(StateStore::new())
    }

    #[test]
    fn seed_no_pools_is_an_error() {
        let state = test_state();
        assert!(load_book_seed(&state, "[]").is_err());
    }

    #[test]
    fn seed_loads_supported_venues_and_skips_unsupported() {
        let state = test_state();
        let json = r#"[
            {"venue":"orca","pool":"or1","mint_a":"A","mint_b":"B","reserve_a":2000,"reserve_b":1800,"fee_bps":30},
            {"venue":"jupiter","pool":"ju1","mint_a":"A","mint_b":"B","reserve_a":1000,"reserve_b":1600,"fee_bps":25},
            {"venue":"raydium","pool":"ray1","mint_a":"A","mint_b":"B","reserve_a":5000,"reserve_b":5000,"fee_bps":25}
        ]"#;
        load_book_seed(&state, json).expect("seed ok");

        let book = state.arb_book();
        assert_eq!(book.len(), 2);
        // Only the supported venues made it in; the raydium pool is dropped.
        assert!(book
            .iter()
            .all(|p| matches!(p.venue, Venue::Orca | Venue::Jupiter)));
    }

    #[test]
    fn seed_skips_zero_reserve_and_degenerate_pools() {
        let state = test_state();
        let json = r#"[
            {"venue":"phoenix","pool":"px1","mint_a":"A","mint_b":"B","reserve_a":0,"reserve_b":100,"fee_bps":10},
            {"venue":"orca","pool":"or2","mint_a":"A","mint_b":"A","reserve_a":100,"reserve_b":100,"fee_bps":10},
            {"venue":"orca","pool":"or3","mint_a":"A","mint_b":"B","reserve_a":1000,"reserve_b":1000,"fee_bps":10}
        ]"#;
        load_book_seed(&state, json).expect("seed ok");
        let book = state.arb_book();
        assert_eq!(book.len(), 1);
        assert_eq!(book[0].pool, "or3");
    }

    #[test]
    fn seed_slot_is_remembered() {
        let state = test_state();
        let json = r#"[
            {"venue":"phoenix","pool":"px1","mint_a":"A","mint_b":"B","reserve_a":1000,"reserve_b":1000,"fee_bps":10,"slot":420}
        ]"#;
        load_book_seed(&state, json).expect("seed ok");
        assert_eq!(state.last_slot(), 420);
    }

    #[test]
    fn tip_free_venues_are_not_present_after_seed_of_unknown_only() {
        let state = test_state();
        let json = r#"[
            {"venue":"meteora","pool":"m1","mint_a":"A","mint_b":"B","reserve_a":1,"reserve_b":1,"fee_bps":10}
        ]"#;
        // All pools unsupported → nothing loaded → error surfaces.
        assert!(load_book_seed(&state, json).is_err());
        assert!(state.arb_book().is_empty());
    }
}