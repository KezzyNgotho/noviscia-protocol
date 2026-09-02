//! Wormhole `Timestamp` type (u32 unix seconds), trimmed to the surface used
//! by `GuardianSet`/the Pyth receiver. Copied from upstream
//! `solana/programs/core-bridge/src/types.rs` (commit 7bd40b5). Apache-2.0.

use {anchor_lang::prelude::*, solana_program::clock::Clock};

/// This struct defines unix timestamp as u32 (as opposed to more modern
/// systems that have adopted i64). Methods for this struct are meant to
/// convert Solana's clock type to this type assuming we are far from year
/// 2038.
#[derive(
    Default,
    Copy,
    PartialEq,
    Eq,
    Debug,
    Clone,
    AnchorSerialize,
    AnchorDeserialize,
    PartialOrd,
    Ord,
    InitSpace,
)]
pub struct Timestamp {
    value: u32,
}

impl Timestamp {
    /// Return the memory representation of this underlying u32 value as a byte
    /// array in big-endian byte order.
    pub fn to_be_bytes(self) -> [u8; 4] {
        self.value.to_be_bytes()
    }
}

impl PartialEq<u32> for Timestamp {
    fn eq(&self, other: &u32) -> bool {
        self.value == *other
    }
}

impl From<u32> for Timestamp {
    fn from(value: u32) -> Self {
        Timestamp { value }
    }
}

impl From<Timestamp> for u32 {
    fn from(timestamp: Timestamp) -> Self {
        timestamp.value
    }
}

impl From<Timestamp> for i64 {
    fn from(timestamp: Timestamp) -> Self {
        i64::from(timestamp.value)
    }
}

impl From<Clock> for Timestamp {
    fn from(clock: Clock) -> Self {
        Self {
            value: clock.unix_timestamp.try_into().expect("timestamp overflow"),
        }
    }
}
