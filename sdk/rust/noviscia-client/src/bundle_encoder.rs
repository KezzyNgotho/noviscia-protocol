//! # Bundle Encoder
//!
//! Compiles an **atomic Jito bundle** for a single TVV slot turn:
//!
//! - **Transaction A — Allotment + Merkle Verification + Micro-Fee:**
//!   Calls `purchase_capacity` (on-chain allotment + Merkle proof in the
//!   instruction data, 29-byte fixed prefix + variable-length proof) plus
//!   a SOL micro-fee transfer to the Jito tip account.
//! - **Transaction B — Private Arbitrage:** the desk's confidential order
//!   instructions.
//!
//! Both legs are signed by the same fee-payer and sealed inside one Jito
//! bundle. Atomicity is guaranteed by the Jito block engine: if *any*
//! instruction in *either* transaction fails, the entire bundle is dropped
//! and zero capital leaves the machine.
//!
//! This module is a thin, documented interface over the existing
//! [`crate::bundle_engine`] which already implements the two-leg Jito
//! atomic bundle construction. It exists to match the HFT integration
//! pitch's naming convention while being completely honest about the real
//! on-chain mechanics (Jito bundles carry multiple transactions, not a
//! single versioned transaction).

use solana_program::instruction::Instruction;
use solana_program::pubkey::Pubkey;
use solana_sdk::hash::Hash;
use solana_sdk::signature::{Keypair, Signer};

use crate::bundle_engine;
use crate::bundle_engine::AtomicBundle;
use crate::ClientError;

/// Compile a two-transaction Jito bundle.
///
/// * `premium_operator` — the fee-payer / capacity operator (carries the
///   fee-payer keypair for both legs).
/// * `client_usdc_ata` — the operator's USDC Associated Token Account
///   (destination of the allotted capacity).
/// * `desired_capacity` — the allotment in base units (µUSDC) for this turn.
/// * `expiry` — on-chain capacity expiry; for sandbox runs, pass
///   [`grpc_stream::SLOT_EXPIRY_EPOCH_SECS`] + `target_slot` (ignored by
///   the emulator; on mainnet pass a valid unix-timestamp deadline).
/// * `merkle_proof` — the KYC / Merkle verification path (Vec of 32-byte
///   nodes; can be empty for production `kyc_merkle_proof` paths that skip
///   the on-chain verifier).
/// * `trade_ixs` — the desk's private arbitrage instructions (leg B).
/// * `tip_account` — the selected Jito tip account (one of the three
///   `JITO_TIP_ACCOUNTS`).
/// * `tip_lamports` — the Jito micro-fee in lamports.
/// * `blockhash` — a recent blockhash required for transaction signing.
///
/// Returns an [`AtomicBundle`] ready for submission via
/// [`crate::NovisciaClient::send_atomic_bundle`].
#[allow(clippy::too_many_arguments)]
pub fn compile_atomic_bundle(
    premium_operator: &Keypair,
    client_usdc_ata: Pubkey,
    desired_capacity: u64,
    expiry: i64,
    merkle_proof: Vec<[u8; 32]>,
    trade_ixs: Vec<Instruction>,
    tip_account: Pubkey,
    tip_lamports: u64,
    blockhash: Hash,
) -> Result<AtomicBundle, ClientError> {
    bundle_engine::build_capacity_bundle(
        premium_operator,
        client_usdc_ata,
        desired_capacity,
        expiry,
        merkle_proof,
        trade_ixs,
        tip_account,
        tip_lamports,
        blockhash,
    )
}

/// Build *only* the **Transaction A allotment instruction** (the on-chain
/// Merkle-verifying, capacity-purchasing step) without assembling the full
/// bundle. Useful for offline dry-run validation of the instruction data
/// and account list before bundling.
pub fn allotment_instruction(
    premium_operator: &Keypair,
    client_usdc_ata: Pubkey,
    desired_capacity: u64,
    expiry: i64,
    merkle_proof: Vec<[u8; 32]>,
) -> Instruction {
    noviscia_capacity_sdk::purchase_capacity_default(
        premium_operator.pubkey(),
        client_usdc_ata,
        desired_capacity,
        expiry,
        merkle_proof,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_sdk::hash::Hash;
    use solana_sdk::message::VersionedMessage;

    fn dummy_trade_ix(program: &Pubkey) -> Instruction {
        Instruction {
            program_id: *program,
            accounts: vec![],
            data: vec![],
        }
    }

    #[test]
    fn compile_builds_two_legs_with_tip() {
        let operator = Keypair::new();
        let ata = Pubkey::new_unique();
        let tip_acct = Pubkey::new_unique();
        let program = Pubkey::new_unique();
        let proof = vec![[1u8; 32]];
        let bundle = compile_atomic_bundle(
            &operator,
            ata,
            1_500_000,
            1_750_000_000,
            proof,
            vec![dummy_trade_ix(&program), dummy_trade_ix(&program)],
            tip_acct,
            5_000,
            Hash::new_unique(),
        )
        .unwrap();
        assert_eq!(bundle.transactions.len(), 2);
        assert_eq!(bundle.tip_lamports, 5_000);
    }

    #[test]
    fn leg_a_contains_tip_transfer() {
        let operator = Keypair::new();
        let ata = Pubkey::new_unique();
        let tip_acct = Pubkey::new_unique();
        let program = Pubkey::new_unique();
        let bundle = compile_atomic_bundle(
            &operator,
            ata,
            1_500_000,
            1_750_000_000,
            vec![],
            vec![dummy_trade_ix(&program)],
            tip_acct,
            5_000,
            Hash::new_unique(),
        )
        .unwrap();
        // Leg A: premium ix + system transfer (tip) → 2 instructions
        let leg_a = &bundle.transactions[0];
        let leg_a_msg = match &leg_a.message {
            VersionedMessage::Legacy(m) => m.clone(),
            _ => unreachable!(),
        };
        assert_eq!(leg_a_msg.instructions.len(), 2);
        let last = leg_a_msg.instructions.last().unwrap();
        assert_eq!(
            *last.program_id(&leg_a_msg.account_keys),
            solana_sdk::system_program::ID
        );
    }

    #[test]
    fn allotment_instruction_encodes_merkle_data() {
        let operator = Keypair::new();
        let ata = Pubkey::new_unique();
        let proof = vec![[1u8; 32], [2u8; 32]];
        let ix = allotment_instruction(&operator, ata, 500_000, 1_750_000_000, proof);
        assert_eq!(ix.program_id, noviscia_capacity_sdk::CAPACITY_PROGRAM_ID);
        // 8 (discriminator) + 8 (capacity u64) + 8 (expiry i64) + 4 (vec len u32) + 2×32 (proof) = 88
        assert_eq!(ix.data.len(), 8 + 8 + 8 + 4 + (2 * 32));
    }

    #[test]
    fn empty_trade_rejected() {
        let operator = Keypair::new();
        let ata = Pubkey::new_unique();
        assert!(compile_atomic_bundle(
            &operator,
            ata,
            1_000,
            1_750_000_000,
            vec![],
            vec![],
            Pubkey::new_unique(),
            1_000,
            Hash::new_unique(),
        )
        .is_err());
    }
}