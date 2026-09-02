//! Minimal local compatibility shim for the Wormhole Core Bridge Solana crate.
//!
//! Only the surface that the vendored `pyth-solano-receiver` program pulls in
//! is re-implemented here, compiled against this workspace's anchor-lang
//! 0.31.1 / solana-program 2 toolchain. This deliberately avoids the upstream
//! `wormhole-core-bridge-solana` git dependency, which pins anchor-lang 0.28
//! and would force a second, conflicting Anchor toolchain into the graph.
//!
//! Upstream: <https://github.com/wormhole-foundation/wormhole>
//! `solana/programs/core-bridge/src` (commit 7bd40b5), Apache-2.0. Only the
//! `sdk::legacy::{AccountVariant, LegacyAccount, LegacyAnchorized}` account
//! plumbing and the legacy `state::GuardianSet`/`types::Timestamp` types are
//! reproduced (trimmed to the Pyth receiver's `post_update_atomic` path).

use anchor_lang::prelude::*;

// Official Wormhole Core Bridge program id. It is held, not loaded, so that
// `LegacyAccount::program_id()` / guardian-set PDA derivations are faithful to
// the on-chain Pyth/wormhole topology.
declare_id!("worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth");

pub mod sdk;
pub mod state;
pub mod types;
