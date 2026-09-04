//! # Bundle Engine
//!
//! The institutional **Jito Bundle Client Engine**: packages a Noviscia
//! premium/capacity **Transaction A** together with the desk's **Transaction
//! B** into one atomic Jito bundle. Because Jito bundles land all-or-nothing
//! in a single slot, the premium and the trade can never be separated —
//! front-running and "premium paid but trade dropped" are both eliminated.

use solana_program::instruction::Instruction;
use solana_program::pubkey::Pubkey;
use solana_sdk::hash::Hash;
use solana_sdk::message::Message;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::transaction::VersionedTransaction;
#[allow(deprecated)] // aligned with solana-sdk 2.2, replaces the cross-toolchain solana-system-interface crate
use solana_sdk::system_instruction;

use crate::ClientError;

/// One atomic Jito bundle: ordered transactions + the parsed tip.
#[derive(Debug, Clone)]
pub struct AtomicBundle {
    /// Transaction A is the premium/capacity leg; Transaction B is the trade.
    pub transactions: Vec<VersionedTransaction>,
    /// Tip in lamports paid to the Jito tip account.
    pub tip_lamports: u64,
}

/// Build signs the bundle with both fees and all extra instructions.
///
/// - Transaction A: `premium_ix` + a `SystemProgram::transfer` paying the Jito
///   tip, both signed by `fee_payer` (the institutional operator).
/// - Transaction B: `trade_ixs` (the desk's actual order) signed by
///   `fee_payer`.
///
/// Bundle atomicity is guaranteed by Jito: if any transaction inside the
/// bundle fails, none land. Using the same `fee_payer` on both legs also keeps
/// a single account as the sole sponsor of the protected flow.
pub fn build_atomic_bundle(
    premium_ix: Instruction,
    trade_ixs: Vec<Instruction>,
    tip_account: Pubkey,
    tip_lamports: u64,
    fee_payer: &Keypair,
    blockhash: Hash,
) -> Result<AtomicBundle, ClientError> {
    if trade_ixs.is_empty() {
        return Err(ClientError::BundleRejected(
            "desk trade in an atomic bundle must contain at least one instruction".to_string(),
        ));
    }

    // Transaction A — premium + Jito tip in the same slot as the trade.
    let mut leg_a_ixs = vec![premium_ix];
    if tip_lamports > 0 {
        leg_a_ixs.push(system_instruction::transfer(
            &fee_payer.pubkey(),
            &tip_account,
            tip_lamports,
        ));
    }
    let leg_a = build_signed(&leg_a_ixs, fee_payer, blockhash)?;

    // Transaction B — the desk's protected trade.
    let leg_b = build_signed(&trade_ixs, fee_payer, blockhash)?;

    Ok(AtomicBundle {
        transactions: vec![leg_a, leg_b],
        tip_lamports,
    })
}

/// Build a Noviscia capacity bundle: premium Transaction A + desk Transaction B.
///
/// This is the reference institutional flow — the premium leg is produced by
/// the `noviscia-capacity-sdk` builders and sealed into the same Jito bundle
/// as the desk's order, so the two can only land together.
#[allow(clippy::too_many_arguments)]
pub fn build_capacity_bundle(
    operator: &Keypair,
    client_usdc_ata: Pubkey,
    desired_capacity: u64,
    expiry: i64,
    merkle_proof: Vec<[u8; 32]>,
    trade_ixs: Vec<Instruction>,
    tip_account: Pubkey,
    tip_lamports: u64,
    blockhash: Hash,
) -> Result<AtomicBundle, ClientError> {
    let premium_ix = noviscia_capacity_sdk::purchase_capacity_default(
        operator.pubkey(),
        client_usdc_ata,
        desired_capacity,
        expiry,
        merkle_proof,
    );
    build_atomic_bundle(
        premium_ix,
        trade_ixs,
        tip_account,
        tip_lamports,
        operator,
        blockhash,
    )
}

/// Serialize a single-signed message into a versioned transaction.
fn build_signed(
    ixs: &[Instruction],
    fee_payer: &Keypair,
    blockhash: Hash,
) -> Result<VersionedTransaction, ClientError> {
    let message = Message::new(ixs, Some(&fee_payer.pubkey()));
    let mut tx = solana_sdk::transaction::Transaction::new_unsigned(message);
    tx.sign(&[fee_payer], blockhash);
    Ok(tx.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_sdk::hash::Hash;
    use solana_sdk::message::VersionedMessage;
    use solana_sdk::pubkey::Pubkey;

    fn sample_ix(program: &Pubkey) -> Instruction {
        Instruction {
            program_id: *program,
            accounts: vec![],
            data: vec![],
        }
    }

    #[test]
    fn atomic_bundle_has_two_legs() {
        let program = Pubkey::new_unique();
        let fee_payer = Keypair::new();
        let tip_account = Pubkey::new_unique();
        let bundle = build_atomic_bundle(
            sample_ix(&program),
            vec![sample_ix(&program), sample_ix(&program)],
            tip_account,
            5_000,
            &fee_payer,
            Hash::new_unique(),
        )
        .unwrap();
        assert_eq!(bundle.transactions.len(), 2);
        assert_eq!(bundle.tip_lamports, 5_000);
    }

    #[test]
    fn leg_a_pays_tip_to_tip_account() {
        let program = Pubkey::new_unique();
        let fee_payer = Keypair::new();
        let tip_account = Pubkey::new_unique();
        let bundle = build_atomic_bundle(
            sample_ix(&program),
            vec![sample_ix(&program)],
            tip_account,
            5_000,
            &fee_payer,
            Hash::new_unique(),
        )
        .unwrap();
        // Leg A contains premium ix + system transfer; leg B the trade off.
        let leg_a = &bundle.transactions[0];
        let leg_a_message = match &leg_a.message {
            VersionedMessage::Legacy(m) => m.clone(),
            _ => unreachable!(),
        };
        // 2 instructions + the fee-payer signature.
        assert_eq!(leg_a_message.instructions.len(), 2);
        // The transfer instruction is the last on leg A.
        let last = leg_a_message.instructions.last().unwrap();
        assert_eq!(
            *last.program_id(&leg_a_message.account_keys),
            solana_sdk::system_program::ID
        );
    }

    #[test]
    fn empty_trade_rejected() {
        let program = Pubkey::new_unique();
        let fee_payer = Keypair::new();
        assert!(build_atomic_bundle(
            sample_ix(&program),
            vec![],
            Pubkey::new_unique(),
            1_000,
            &fee_payer,
            Hash::new_unique(),
        )
        .is_err());
    }

    #[test]
    fn tip_optional_when_zero() {
        let program = Pubkey::new_unique();
        let fee_payer = Keypair::new();
        let bundle = build_atomic_bundle(
            sample_ix(&program),
            vec![sample_ix(&program)],
            Pubkey::new_unique(),
            0,
            &fee_payer,
            Hash::new_unique(),
        )
        .unwrap();
        let leg_a = match &bundle.transactions[0].message {
            VersionedMessage::Legacy(m) => m.clone(),
            _ => unreachable!(),
        };
        assert_eq!(leg_a.instructions.len(), 1);
    }

    #[test]
    fn capacity_bundle_seals_premium_and_trade() {
        let operator = Keypair::new();
        let ata = Pubkey::new_unique();
        let bundle = build_capacity_bundle(
            &operator,
            ata,
            1_000_000,
            1_700_000_000,
            vec![[9u8; 32]],
            vec![sample_ix(&Pubkey::new_unique())],
            Pubkey::new_unique(),
            5_000,
            Hash::new_unique(),
        )
        .unwrap();
        assert_eq!(bundle.transactions.len(), 2);
        // Transaction A references the capacity program (premium leg).
        let leg_a = match &bundle.transactions[0].message {
            VersionedMessage::Legacy(m) => m.clone(),
            _ => unreachable!(),
        };
        assert_eq!(
            leg_a.instructions[0].program_id(&leg_a.account_keys),
            &noviscia_capacity_sdk::CAPACITY_PROGRAM_ID
        );
    }

    #[test]
    fn system_transfer_balance() {
        // Guard: system_instruction::transfer is available (import sanity).
        let from = Pubkey::new_unique();
        let to = Pubkey::new_unique();
        let ix = system_instruction::transfer(&from, &to, 42);
        assert_eq!(ix.program_id, solana_sdk::system_program::ID);
    }
}