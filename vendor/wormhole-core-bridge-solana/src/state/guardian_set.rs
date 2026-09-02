//! Guardian set account (legacy Wormhole schema: no discriminator prefix).
//!
//! Copied from upstream `solana/programs/core-bridge/src/legacy/state/
//! guardian_set.rs` (commit 7bd40b5). Apache-2.0.
//!
//! Note: this type is hand-rolled instead of `#[account]`-derived because
//! anchor 0.31's generated code refers to the unqualified
//! `GuardianSet::DISCRIMINATOR`, which would collide with the
//! `LegacyAccount::DISCRIMINATOR` const. Both layouts (anchor / legacy) are
//! serialized explicitly, matching the `#[account]` binary format so
//! `AccountVariant` dispatches identically.

use crate::{
    sdk::legacy::{AccountVariant, LegacyAccount},
    types::Timestamp,
};
use anchor_lang::prelude::*;
use std::fmt::Debug;
use std::io::{Read, Write};

/// Account used to store a guardian set. The keys encoded in this account are
/// Ethereum pubkeys. Its expiration time is determined at the time a guardian
/// set is updated to a new set.
///
/// NOTE: The account schema is the same as legacy guardian sets (borsh, no
/// discriminator prefix). Guardian sets are produced by the Core Bridge
/// program, which writes the legacy layout. `AccountVariant` inspects the
/// first 8 bytes and falls back to the legacy layout if the Anchor
/// discriminator is absent.
pub struct GuardianSet {
    /// Index representing an incrementing version number for this guardian
    /// set.
    pub index: u32,

    /// Ethereum-style public keys.
    pub keys: Vec<[u8; 20]>,

    /// Timestamp representing the time this guardian became active.
    pub creation_time: Timestamp,

    /// Expiration time when VAAs issued by this set are no longer valid.
    pub expiration_time: Timestamp,
}

impl LegacyAccount for GuardianSet {
    const DISCRIMINATOR: &'static [u8] = &[];

    fn program_id() -> Pubkey {
        crate::ID
    }
}

impl Owner for AccountVariant<GuardianSet> {
    fn owner() -> Pubkey {
        crate::ID
    }
}

impl GuardianSet {
    pub const SEED_PREFIX: &'static [u8] = b"GuardianSet";

    pub fn is_active(&self, timestamp: &Timestamp) -> bool {
        // Note: This is a fix for Wormhole on mainnet. The initial guardian
        // set was never expired so we block it here.
        if self.index == 0 && self.creation_time == 1628099186 {
            false
        } else {
            self.expiration_time == 0 || self.expiration_time >= *timestamp
        }
    }
}

impl Clone for GuardianSet {
    fn clone(&self) -> Self {
        Self {
            index: self.index,
            keys: self.keys.clone(),
            creation_time: self.creation_time,
            expiration_time: self.expiration_time,
        }
    }
}

impl Default for GuardianSet {
    fn default() -> Self {
        Self {
            index: 0,
            keys: Vec::new(),
            creation_time: Timestamp::default(),
            expiration_time: Timestamp::default(),
        }
    }
}

impl Debug for GuardianSet {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GuardianSet")
            .field("index", &self.index)
            .field("keys", &self.keys)
            .field("creation_time", &self.creation_time)
            .field("expiration_time", &self.expiration_time)
            .finish()
    }
}

impl AnchorSerialize for GuardianSet {
    fn serialize<W: Write>(&self, writer: &mut W) -> std::result::Result<(), std::io::Error> {
        AnchorSerialize::serialize(&self.index, writer)?;
        AnchorSerialize::serialize(&self.keys, writer)?;
        AnchorSerialize::serialize(&self.creation_time, writer)?;
        AnchorSerialize::serialize(&self.expiration_time, writer)?;
        Ok(())
    }
}

impl AnchorDeserialize for GuardianSet {
    fn deserialize(buf: &mut &[u8]) -> std::result::Result<Self, std::io::Error> {
        let index = <u32 as AnchorDeserialize>::deserialize(buf)?;
        let keys = <Vec<[u8; 20]> as AnchorDeserialize>::deserialize(buf)?;
        let creation_time = <Timestamp as AnchorDeserialize>::deserialize(buf)?;
        let expiration_time = <Timestamp as AnchorDeserialize>::deserialize(buf)?;
        Ok(Self {
            index,
            keys,
            creation_time,
            expiration_time,
        })
    }

    fn deserialize_reader<R: Read>(reader: &mut R) -> std::result::Result<Self, std::io::Error> {
        let mut buf = Vec::new();
        reader.read_to_end(&mut buf)?;
        Self::deserialize(&mut buf.as_slice())
    }
}

impl anchor_lang::Discriminator for GuardianSet {
    const DISCRIMINATOR: &'static [u8] = &[0x78, 0x4d, 0x4a, 0x62, 0x22, 0x53, 0x60, 0x7d];
}

impl AccountSerialize for GuardianSet {
    fn try_serialize<W: Write>(&self, writer: &mut W) -> Result<()> {
        writer
            .write_all(<Self as anchor_lang::Discriminator>::DISCRIMINATOR)
            .and_then(|_| AnchorSerialize::serialize(self, writer))
            .map_err(|_| error!(ErrorCode::AccountDidNotSerialize))
    }
}

impl AccountDeserialize for GuardianSet {
    fn try_deserialize(buf: &mut &[u8]) -> Result<Self> {
        if buf.len() < 8 || buf[..8] != *<Self as anchor_lang::Discriminator>::DISCRIMINATOR {
            return err!(ErrorCode::AccountDidNotDeserialize);
        }
        Self::try_deserialize_unchecked(buf)
    }

    fn try_deserialize_unchecked(buf: &mut &[u8]) -> Result<Self> {
        let data = &buf[8..];
        AnchorDeserialize::deserialize(&mut &data[..])
            .map_err(|_| error!(ErrorCode::AccountDidNotDeserialize))
    }
}
