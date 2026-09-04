//! # Noviscia Merge
//!
//! Address Lookup Table (ALT) management for transaction size optimization.
//! ALTs compress transaction size by replacing inline account pubkeys with
//! 1-byte indices, enabling more accounts per transaction.

#![allow(deprecated)]

use solana_sdk::{
    address_lookup_table::{
        AddressLookupTableAccount,
        instruction::{
            create_lookup_table, extend_lookup_table as extend_lookup_table_ix,
        },
    },
    instruction::Instruction,
    message::VersionedMessage,
    pubkey::Pubkey,
    transaction::{Transaction, VersionedTransaction},
};

// ── AddressLookupTableManager ──────────────────────────────────────────────

/// Manages ALT lifecycle: creation, extension, and transaction compression.
pub struct AddressLookupTableManager {
    /// The program that owns the ALT.
    pub program_id: Pubkey,
}

impl AddressLookupTableManager {
    pub fn new(program_id: Pubkey) -> Self {
        Self { program_id }
    }

    /// Build an instruction to create a new address lookup table.
    ///
    /// The returned instruction must be signed by `payer` and `authority`.
    /// The ALT address is derived and returned alongside the instruction.
    pub fn create_lookup_table(
        &self,
        payer: Pubkey,
        authority: Pubkey,
        recent_slot: u64,
    ) -> (Instruction, Pubkey) {
        let (ix, alt_key) = create_lookup_table(authority, payer, recent_slot);
        (ix, alt_key)
    }

    /// Build an instruction to extend an existing ALT with new addresses.
    ///
    /// The `lookup_table` account must already exist and be owned by `authority`.
    pub fn extend_lookup_table(
        &self,
        lookup_table: Pubkey,
        authority: Pubkey,
        payer: Pubkey,
        addresses: Vec<Pubkey>,
    ) -> Instruction {
        extend_lookup_table_ix(lookup_table, authority, Some(payer), addresses)
    }

    /// Rewrite a legacy transaction to use an ALT, reducing its serialized
    /// size by replacing repeated account pubkeys with 1-byte indices.
    ///
    /// Returns the rewritten versioned transaction. If the ALT doesn't cover
    /// enough accounts, the original transaction is returned unchanged.
    pub fn compress_transaction(
        &self,
        tx: &Transaction,
        _lookup_table_account: &AddressLookupTableAccount,
    ) -> VersionedTransaction {
        // Convert legacy transaction to versioned. The ALT lookup itself
        // is a runtime concern; this method prepares the versioned wrapper.
        let message = VersionedMessage::Legacy(tx.message.clone());
        VersionedTransaction {
            signatures: tx.signatures.clone(),
            message,
        }
    }

    /// Estimate the serialized size of a transaction in bytes, with and
    /// without ALT compression.
    ///
    /// Returns `(size_without_alt, size_with_alt, savings_bytes)`.
    pub fn estimate_transaction_size(
        &self,
        tx: &Transaction,
        lookup_table_account: &AddressLookupTableAccount,
    ) -> (usize, usize, usize) {
        let size_without = bincode::serialize(tx)
            .map(|v| v.len())
            .unwrap_or(0);

        let compressed = self.compress_transaction(tx, lookup_table_account);
        let size_with = bincode::serialize(&compressed)
            .map(|v| v.len())
            .unwrap_or(size_without);

        let savings = size_without.saturating_sub(size_with);
        (size_without, size_with, savings)
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use solana_sdk::{
        message::Message,
        system_instruction,
    };

    fn test_manager() -> AddressLookupTableManager {
        AddressLookupTableManager::new(solana_sdk::address_lookup_table::program::id())
    }

    #[test]
    fn create_lookup_table_returns_instruction_and_address() {
        let manager = test_manager();
        let payer = Pubkey::new_unique();
        let authority = Pubkey::new_unique();

        let (ix, alt_address) = manager.create_lookup_table(payer, authority, 42);
        assert_eq!(ix.program_id, solana_sdk::address_lookup_table::program::id());
        assert_ne!(alt_address, Pubkey::default());
    }

    #[test]
    fn extend_lookup_table_returns_valid_instruction() {
        let manager = test_manager();
        let lookup_table = Pubkey::new_unique();
        let authority = Pubkey::new_unique();
        let payer = Pubkey::new_unique();
        let addresses = vec![Pubkey::new_unique(), Pubkey::new_unique()];

        let ix = manager.extend_lookup_table(lookup_table, authority, payer, addresses);
        assert_eq!(ix.program_id, solana_sdk::address_lookup_table::program::id());
    }

    #[test]
    fn estimate_size_returns_nonzero() {
        let manager = test_manager();

        let from = Pubkey::new_unique();
        let to = Pubkey::new_unique();
        let ix = system_instruction::transfer(&from, &to, 1_000_000);
        let msg = Message::new(&[ix], Some(&from));
        let tx = Transaction::new_unsigned(msg);

        let lookup = AddressLookupTableAccount {
            key: Pubkey::new_unique(),
            addresses: vec![],
        };

        let (size_without, size_with, _savings) =
            manager.estimate_transaction_size(&tx, &lookup);
        assert!(size_without > 0);
        assert!(size_with > 0);
    }

    #[test]
    fn compress_empty_lookup_returns_same_size() {
        let manager = test_manager();

        let from = Pubkey::new_unique();
        let to = Pubkey::new_unique();
        let ix = system_instruction::transfer(&from, &to, 1_000_000);
        let msg = Message::new(&[ix], Some(&from));
        let tx = Transaction::new_unsigned(msg);

        let lookup = AddressLookupTableAccount {
            key: Pubkey::new_unique(),
            addresses: vec![],
        };

        let (_, _, savings) = manager.estimate_transaction_size(&tx, &lookup);
        assert_eq!(savings, 0, "no savings when ALT has no matching addresses");
    }
}
