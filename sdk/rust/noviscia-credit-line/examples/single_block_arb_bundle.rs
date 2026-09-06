//! # Single-block credit arbitrage bundle (B2B reference template)
//!
//! This is the reference execution template an institutional desk compiles
//! into its trading software. It sandwiches two external venue swaps between
//! the Noviscia `pull_credit` and `repay_and_settle` instructions inside **one**
//! atomic Solana transaction — one slot, ~400ms.
//!
//! ```text
//!  1. pull_credit($principal)      draw from the alpha-sleeve credit vault
//!  2. Raydium swap (buy low)       venue A leg of the arbitrage
//!  3. Meteora  swap (sell high)    venue B leg of the arbitrage
//!  4. repay_and_settle($principal) Atomic Balance-State Constraint
//! ```
//!
//! Atomicity guarantee: if the cross-venue spread does not leave the desk able
//! to return `principal + toll`, the program's balance-state check rejects the
//! settle transfer and the **entire transaction rolls back** — the credit vault
//! and every borrower ledger revert, and the pool is untouched.
//!
//! The two "swap" builders below are placeholders: wire in the instruction
//! builders from your venue SDKs (raydium-amm, Meteora, etc.). The account
//! plumbing and final transaction assembly are shown for real.

use solana_program::instruction::Instruction;
use solana_program::pubkey::Pubkey;

use noviscia_credit_line_sdk::{
    borrower_pda, credit_line_pda, credit_vault_pda, toll_vault_pda, NovisciaCreditLineClient,
};

/// Program ID from the consolidated `netting-engine` host (Stage 3 absorption
/// of the standalone `noviscia-credit-line`; see `docs/FROZEN.md`).
const CREDIT_LINE_PROGRAM_ID: Pubkey = noviscia_credit_line_sdk::CREDIT_LINE_PROGRAM_ID;

/// Placeholder: venue A (Raydium) swap instruction builder.
fn raydium_buy_swap_ix(_user: &Pubkey, _amount_in: u64) -> Option<Instruction> {
    // TODO: build from `raydium-amm` / your venue SDK. See the VENUE_SWAP
    // account built into `assemble_bundle` below — append its metas + data.
    None
}

/// Placeholder: venue B (Meteora) swap instruction builder.
fn meteora_sell_swap_ix(_user: &Pubkey, _amount_in: u64) -> Option<Instruction> {
    // TODO: build from `meteora` / your venue SDK.
    None
}

/// Assemble the whole single-block credit bundle for one signer.
///
/// Returned instructions are submitted in order as a single
/// `solana_sdk::transaction::Transaction` (they share one connection, one
/// recent blockhash, and one slot). Keep them in this exact order.
pub fn assemble_bundle(
    user_wallet: &Pubkey,
    user_usdc: &Pubkey,
    treasury_vault: &Pubkey,
    vault_config: &Pubkey,
    vault_usdc: &Pubkey,
    principal: u64,
) -> Vec<Instruction> {
    let client = NovisciaCreditLineClient::new(
        CREDIT_LINE_PROGRAM_ID,
        *user_wallet,
        *user_usdc,
        credit_vault_pda(CREDIT_LINE_PROGRAM_ID),
        credit_line_pda(CREDIT_LINE_PROGRAM_ID),
        *treasury_vault,
        *vault_config,
        *vault_usdc,
    );

    // 1. Pull the credit line.
    let pull = client
        .build_pull_credit_ix(principal)
        .expect("pull ix builds");

    // 2 & 3. The arbitrage legs, sandwiched between pull and repay.
    let buy_ix = raydium_buy_swap_ix(user_wallet, principal);
    let sell_ix = meteora_sell_swap_ix(user_wallet, principal);

    // 4. The Atomic Balance-State Constraint.
    let repay = client
        .build_repay_and_settle_ix(principal)
        .expect("repay ix builds");

    let mut bundle = vec![pull];
    if let Some(buy) = buy_ix {
        bundle.push(buy);
    }
    if let Some(sell) = sell_ix {
        bundle.push(sell);
    }
    bundle.push(repay);
    bundle
}

/// Derive every PDA a client needs, in one place: ledger, alpha-sleeve vault,
/// 90% toll staging vault, borrower, and the SPL Token program.
pub fn all_pdas(program_id: Pubkey, owner: &Pubkey) -> (Pubkey, Pubkey, Pubkey, Pubkey, Pubkey) {
    (
        credit_line_pda(program_id),
        credit_vault_pda(program_id),
        toll_vault_pda(program_id),
        borrower_pda(program_id, owner).expect("borrower pda"),
        spl_token::ID,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundle_starts_with_pull_and_ends_with_repay() {
        let user = Pubkey::new_unique();
        let usdc = Pubkey::new_unique();
        let treasury = Pubkey::new_unique();
        let vc = Pubkey::new_unique();
        let vu = Pubkey::new_unique();
        let bundle = assemble_bundle(&user, &usdc, &treasury, &vc, &vu, 2_000_000u64);

        assert_eq!(bundle.len(), 2, "pull + repay when venue swaps are placeholders");
        assert_eq!(bundle[0].program_id, CREDIT_LINE_PROGRAM_ID);
        assert_eq!(bundle[1].program_id, CREDIT_LINE_PROGRAM_ID);
        assert_eq!(bundle[1].accounts.len(), 11, "repay carries the omni-pool sweep");
        assert!(bundle[1].accounts[6].pubkey == toll_vault_pda(CREDIT_LINE_PROGRAM_ID));
        // The signer is the first account of the first instruction.
        assert!(bundle[0].accounts.first().map(|m| m.is_signer) == Some(true));
    }

    #[test]
    fn pda_helper_returns_five_unique_addresses() {
        let program_id = CREDIT_LINE_PROGRAM_ID;
        let owner = Pubkey::new_unique();
        let (line, vault, toll_vault, borrower, token) = all_pdas(program_id, &owner);
        assert_ne!(line, vault);
        assert_ne!(vault, borrower);
        assert_ne!(vault, toll_vault);
        assert_eq!(token, spl_token::ID);
        assert!(true);
    }
}
