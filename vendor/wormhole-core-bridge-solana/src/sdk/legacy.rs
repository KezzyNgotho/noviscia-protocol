//! Legacy account plumbing for pre-Anchor Wormhole programs (Core Bridge).
//!
//! Copied verbatim from upstream
//! `solana/programs/core-bridge/src/legacy/utils/mod.rs` (commit 7bd40b5),
//! trimmed to the account portion needed by the Pyth Solana Receiver's
//! `post_update_atomic` guardian-set deserialization. Apache-2.0.

use anchor_lang::prelude::*;

/// Trait for account schemas of legacy programs (intended for Core Bridge and
/// Token Bridge, but can be used for any legacy program). A legacy account
/// requires a defined discriminator (if there is none, yikes, then it will be
/// an empty array) and a program ID, which will usually just be `crate::ID`
/// (defined using [declare_id](anchor_lang::prelude::declare_id)).
pub trait LegacyAccount: AnchorSerialize + AnchorDeserialize + Clone {
    /// Account discriminator. If there is none, use an empty slice.
    const DISCRIMINATOR: &'static [u8];

    /// Owner of the account.
    fn program_id() -> Pubkey;
}

/// Wrapper for legacy accounts implementing [LegacyAccount]. This wrapper
/// provides the convenience of not having to implement [AccountSerialize] and
/// [AccountDeserialize] for each legacy account.
#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LegacyAnchorized<T: LegacyAccount>(pub T);

impl<T> AsRef<T> for LegacyAnchorized<T>
where
    T: LegacyAccount,
{
    fn as_ref(&self) -> &T {
        &self.0
    }
}

impl<T> From<T> for LegacyAnchorized<T>
where
    T: LegacyAccount,
{
    fn from(acct: T) -> Self {
        Self(acct)
    }
}

impl<T> Owner for LegacyAnchorized<T>
where
    T: LegacyAccount,
{
    fn owner() -> Pubkey {
        T::program_id()
    }
}

impl<T> std::ops::Deref for LegacyAnchorized<T>
where
    T: LegacyAccount,
{
    type Target = T;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<T> std::ops::DerefMut for LegacyAnchorized<T>
where
    T: LegacyAccount,
{
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl<T> AccountSerialize for LegacyAnchorized<T>
where
    T: LegacyAccount,
{
    fn try_serialize<W: std::io::Write>(&self, writer: &mut W) -> Result<()> {
        writer
            .write_all(T::DISCRIMINATOR)
            .and_then(|_| self.0.serialize(writer))
            .map_err(|_| error!(ErrorCode::AccountDidNotSerialize))
    }
}

impl<T> AccountDeserialize for LegacyAnchorized<T>
where
    T: LegacyAccount,
{
    fn try_deserialize(buf: &mut &[u8]) -> Result<Self> {
        let disc_len = T::DISCRIMINATOR.len();
        if buf.len() < disc_len {
            return err!(ErrorCode::AccountDidNotDeserialize);
        };
        if *T::DISCRIMINATOR != buf[..disc_len] {
            return err!(ErrorCode::AccountDidNotDeserialize);
        }
        Self::try_deserialize_unchecked(buf)
    }

    fn try_deserialize_unchecked(buf: &mut &[u8]) -> Result<Self> {
        let mut data = &buf[T::DISCRIMINATOR.len()..];
        Ok(Self(T::deserialize(&mut data)?))
    }
}

#[derive(Debug, Clone)]
pub enum AccountVariant<T>
where
    T: LegacyAccount + AccountSerialize + AccountDeserialize + anchor_lang::Discriminator,
{
    Anchor(T),
    Legacy(T),
}

impl<T> AccountVariant<T>
where
    T: LegacyAccount + AccountSerialize + AccountDeserialize + anchor_lang::Discriminator,
{
    pub fn inner(&self) -> &T {
        match self {
            Self::Anchor(inner) => inner,
            Self::Legacy(inner) => inner,
        }
    }

    pub fn inner_mut(&mut self) -> &mut T {
        match self {
            Self::Anchor(inner) => inner,
            Self::Legacy(inner) => inner,
        }
    }
}

impl<T> AccountDeserialize for AccountVariant<T>
where
    T: LegacyAccount + AccountSerialize + AccountDeserialize + anchor_lang::Discriminator,
{
    fn try_deserialize_unchecked(buf: &mut &[u8]) -> Result<Self> {
        require!(buf.len() >= 8, ErrorCode::AccountDidNotDeserialize);
        if buf[..8] == *<T as anchor_lang::Discriminator>::DISCRIMINATOR {
            AccountDeserialize::try_deserialize_unchecked(buf).map(Self::Anchor)
        } else {
            LegacyAnchorized::try_deserialize(buf)
                .map(|acc| acc.0)
                .map(Self::Legacy)
        }
    }
}

impl<T> AccountSerialize for AccountVariant<T>
where
    T: LegacyAccount + AccountSerialize + AccountDeserialize + anchor_lang::Discriminator,
{
    fn try_serialize<W: std::io::Write>(&self, writer: &mut W) -> Result<()> {
        match self {
            Self::Anchor(inner) => AccountSerialize::try_serialize(inner, writer),
            Self::Legacy(inner) => writer
                .write_all(<T as LegacyAccount>::DISCRIMINATOR)
                .and_then(|_| inner.serialize(writer))
                .map_err(|_| error!(ErrorCode::AccountDidNotSerialize)),
        }
    }
}
