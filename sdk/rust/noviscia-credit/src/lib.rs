//! # Noviscia Credit
//!
//! Credit line instruction builders wrapping `noviscia-credit-line-sdk`.
//! Re-exports the existing SDK types and adds client-side toll calculation
//! and atomic arbitrage transaction helpers.

use solana_program::instruction::{AccountMeta, Instruction};
use solana_program::pubkey::Pubkey;

use noviscia_types::{
    BPS, CREDIT_LINE_SEED, CREDIT_VAULT_SEED,
    LP_NAV_SPLIT_BPS, NV_USDC_VAULT_PROGRAM_ID,
    TOLL_VAULT_SEED, TollResult, BORROWER_SEED,
};

// ── Re-exports ─────────────────────────────────────────────────────────────

pub use noviscia_types::{
    Borrower, CreditLine,
    BORROWER_SEED as RE_BORROWER_SEED,
    CREDIT_LINE_SEED as RE_CREDIT_LINE_SEED,
    CREDIT_VAULT_SEED as RE_CREDIT_VAULT_SEED,
    TOLL_VAULT_SEED as RE_TOLL_VAULT_SEED,
};

// ── PDA Derivation ─────────────────────────────────────────────────────────

/// Derive the credit-line ledger PDA.
pub fn credit_line_pda(program_id: Pubkey) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(&[CREDIT_LINE_SEED], &program_id);
    pda
}

/// Derive the alpha-sleeve credit-vault token account PDA.
pub fn credit_vault_pda(program_id: Pubkey) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(&[CREDIT_VAULT_SEED], &program_id);
    pda
}

/// Derive the 90% toll staging vault token account PDA.
pub fn toll_vault_pda(program_id: Pubkey) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(&[TOLL_VAULT_SEED], &program_id);
    pda
}

/// Derive the per-borrower registry PDA.
pub fn borrower_pda(program_id: Pubkey, owner: &Pubkey) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(
        &[BORROWER_SEED, owner.as_ref()],
        &program_id,
    );
    pda
}

// ── Dynamic Toll Calculator ────────────────────────────────────────────────

/// Mirror of on-chain `toll_and_utilization`. Rate interpolates linearly
/// between `base` (0% util) and `max` (100% util).
///
/// Returns a `TollResult` with the toll amount, effective rate, utilization,
/// and the 90/10 split shares.
pub fn compute_toll(
    base_toll_bps: u64,
    max_toll_bps: u64,
    global_outstanding_cap: u64,
    outstanding: u64,
) -> TollResult {
    let utilization_bps = if global_outstanding_cap == 0 {
        0
    } else {
        ((outstanding as u128)
            .checked_mul(BPS as u128)
            .unwrap_or(u128::MAX)
            .checked_div(global_outstanding_cap as u128)
            .unwrap_or(0) as u64)
            .min(BPS)
    };

    let spread = max_toll_bps.saturating_sub(base_toll_bps);
    let dynamic = base_toll_bps
        .saturating_add((spread as u128)
            .checked_mul(utilization_bps as u128)
            .unwrap_or(0)
            .checked_div(BPS as u128)
            .unwrap_or(0) as u64);
    let rate_bps = dynamic.clamp(base_toll_bps, max_toll_bps);

    let toll_amount = ((outstanding as u128)
        .checked_mul(rate_bps as u128)
        .unwrap_or(0)
        .checked_div(BPS as u128)
        .unwrap_or(0)) as u64;

    let lp_share = ((toll_amount as u128)
        .checked_mul(LP_NAV_SPLIT_BPS as u128)
        .unwrap_or(0)
        .checked_div(BPS as u128)
        .unwrap_or(0)) as u64;
    let treasury_share = toll_amount.saturating_sub(lp_share);

    TollResult {
        toll_amount,
        rate_bps,
        utilization_bps,
        lp_share,
        treasury_share,
    }
}

// ── Anchor Discriminator Helpers ───────────────────────────────────────────

/// Compute the Anchor instruction discriminator: first 8 bytes of
/// `sha256("global:<instruction_name>")` using Solana's built-in SHA-256.
fn anchor_discriminator(name: &str) -> [u8; 8] {
    let preimage = format!("global:{name}");
    let hash = solana_program::hash::hash(preimage.as_bytes());
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash.to_bytes()[..8]);
    disc
}

// ── Instruction Builders ───────────────────────────────────────────────────

/// Build a `cl_pull_credit` instruction.
///
/// Account order mirrors the on-chain `PullCredit` context:
/// 0. borrower_owner (signer, mut)
/// 1. credit_line (mut)
/// 2. borrower (mut)
/// 3. credit_vault (mut)
/// 4. borrower_token_account (mut)
/// 5. token_program
pub fn build_pull_credit_ix(
    program_id: Pubkey,
    user_wallet: Pubkey,
    user_usdc: Pubkey,
    requested_amount: u64,
) -> Instruction {
    let cl = credit_line_pda(program_id);
    let borrower = borrower_pda(program_id, &user_wallet);
    let vault = credit_vault_pda(program_id);

    let accounts = vec![
        AccountMeta::new(user_wallet, true),               // borrower_owner (signer)
        AccountMeta::new(cl, false),                       // credit_line (mut)
        AccountMeta::new(borrower, false),                 // borrower (mut)
        AccountMeta::new(vault, false),                    // credit_vault (mut)
        AccountMeta::new(user_usdc, false),                // borrower_token_account (mut)
        AccountMeta::new_readonly(spl_token::ID, false),   // token_program
    ];

    let mut data = anchor_discriminator("cl_pull_credit").to_vec();
    data.extend_from_slice(&requested_amount.to_le_bytes());

    Instruction {
        program_id,
        accounts,
        data,
    }
}

/// Build a `cl_repay_and_settle` instruction.
///
/// Account order mirrors the on-chain `RepayAndSettle` context:
/// 0. borrower_owner (signer, mut)
/// 1. credit_line (mut)
/// 2. borrower (mut)
/// 3. credit_vault (mut)
/// 4. borrower_token_account (mut)
/// 5. toll_recipient_account (mut)
/// 6. toll_vault (mut)
/// 7. vault_config (mut)
/// 8. vault_usdc (mut)
/// 9. nv_usdc_vault_program
/// 10. token_program
pub fn build_repay_and_settle_ix(
    program_id: Pubkey,
    user_wallet: Pubkey,
    user_usdc: Pubkey,
    treasury_vault: Pubkey,
    vault_config: Pubkey,
    vault_usdc: Pubkey,
    principal: u64,
) -> Instruction {
    let cl = credit_line_pda(program_id);
    let borrower = borrower_pda(program_id, &user_wallet);
    let vault = credit_vault_pda(program_id);
    let toll = toll_vault_pda(program_id);

    let accounts = vec![
        AccountMeta::new(user_wallet, true),               // borrower_owner (signer)
        AccountMeta::new(cl, false),                       // credit_line (mut)
        AccountMeta::new(borrower, false),                 // borrower (mut)
        AccountMeta::new(vault, false),                    // credit_vault (mut)
        AccountMeta::new(user_usdc, false),                // borrower_token_account (mut)
        AccountMeta::new(treasury_vault, false),           // toll_recipient_account (mut)
        AccountMeta::new(toll, false),                     // toll_vault (mut)
        AccountMeta::new(vault_config, false),             // vault_config (mut)
        AccountMeta::new(vault_usdc, false),               // vault_usdc (mut)
        AccountMeta::new_readonly(NV_USDC_VAULT_PROGRAM_ID, false), // nv_usdc_vault_program
        AccountMeta::new_readonly(spl_token::ID, false),   // token_program
    ];

    let mut data = anchor_discriminator("cl_repay_and_settle").to_vec();
    data.extend_from_slice(&principal.to_le_bytes());

    Instruction {
        program_id,
        accounts,
        data,
    }
}

// ── Atomic Arbitrage Helper ────────────────────────────────────────────────

/// Build the instructions for an atomic single-block credit arbitrage:
/// `cl_pull_credit` → external swaps → `cl_repay_and_settle`.
///
/// Returns the credit line instructions (pull + repay). External swap
/// instructions should be sandwiched between them by the caller.
pub fn build_atomic_arb_tx(
    program_id: Pubkey,
    user_wallet: Pubkey,
    user_usdc: Pubkey,
    treasury_vault: Pubkey,
    vault_config: Pubkey,
    vault_usdc: Pubkey,
    principal: u64,
) -> (Instruction, Instruction) {
    let pull = build_pull_credit_ix(
        program_id,
        user_wallet,
        user_usdc,
        principal,
    );
    let repay = build_repay_and_settle_ix(
        program_id,
        user_wallet,
        user_usdc,
        treasury_vault,
        vault_config,
        vault_usdc,
        principal,
    );
    (pull, repay)
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use noviscia_types::CREDIT_LINE_PROGRAM_ID;

    #[test]
    fn toll_at_zero_utilization_uses_base_rate() {
        let result = compute_toll(2, 20, 1_000_000_000, 0);
        assert_eq!(result.rate_bps, 2, "at 0% util the base rate applies");
        assert_eq!(result.utilization_bps, 0);
        assert_eq!(result.toll_amount, 0, "zero outstanding => zero toll");
    }

    #[test]
    fn toll_at_full_utilization_is_clamped_to_max() {
        let result = compute_toll(2, 20, 1_000_000_000, 1_000_000_000);
        assert_eq!(result.utilization_bps, BPS, "fully utilized");
        assert_eq!(result.rate_bps, 20, "clamped to max rate");
        assert_eq!(result.toll_amount, 1_000_000_000 * 20 / BPS);
    }

    #[test]
    fn toll_interpolates_monotonically() {
        let result = compute_toll(2, 22, 10_000_000_000, 5_000_000_000);
        assert_eq!(result.utilization_bps, 5_000, "50% utilization in bps");
        // 2 + (22-2) * 0.50 = 12 bps
        assert_eq!(result.rate_bps, 12);
    }

    #[test]
    fn toll_split_90_10() {
        let result = compute_toll(2, 20, 10_000_000_000, 1_000_000_000);
        assert_eq!(
            result.lp_share + result.treasury_share,
            result.toll_amount,
            "split conserves the toll"
        );
        assert_eq!(result.lp_share, result.toll_amount * 9 / 10);
        assert_eq!(result.treasury_share, result.toll_amount / 10);
    }

    #[test]
    fn zero_global_cap_never_underflows() {
        let result = compute_toll(5, 30, 0, 0);
        assert_eq!(result.utilization_bps, 0);
        assert_eq!(result.rate_bps, 5);
        assert_eq!(result.toll_amount, 0);
    }

    #[test]
    fn pdas_are_deterministic() {
        let program_id = CREDIT_LINE_PROGRAM_ID;
        assert_eq!(credit_line_pda(program_id), credit_line_pda(program_id));
        assert_eq!(credit_vault_pda(program_id), credit_vault_pda(program_id));
        assert_eq!(toll_vault_pda(program_id), toll_vault_pda(program_id));
    }

    #[test]
    fn borrower_pda_depends_on_owner() {
        let program_id = CREDIT_LINE_PROGRAM_ID;
        let a = Pubkey::new_unique();
        let b = Pubkey::new_unique();
        assert_ne!(borrower_pda(program_id, &a), borrower_pda(program_id, &b));
    }

    #[test]
    fn pull_ix_has_six_accounts() {
        let ix = build_pull_credit_ix(
            CREDIT_LINE_PROGRAM_ID,
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            2_000_000,
        );
        assert_eq!(ix.accounts.len(), 6);
        assert!(ix.accounts[0].is_signer);
    }

    #[test]
    fn repay_ix_has_eleven_accounts() {
        let ix = build_repay_and_settle_ix(
            CREDIT_LINE_PROGRAM_ID,
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            2_000_000,
        );
        assert_eq!(ix.accounts.len(), 11);
    }

    #[test]
    fn pull_ix_data_starts_with_discriminator() {
        let ix = build_pull_credit_ix(
            CREDIT_LINE_PROGRAM_ID,
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            12345678,
        );
        assert_eq!(ix.data.len(), 8 + 8, "discriminator (8) + u64 arg (8)");
    }

    #[test]
    fn arb_returns_two_instructions() {
        let (pull, repay) = build_atomic_arb_tx(
            CREDIT_LINE_PROGRAM_ID,
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            2_000_000,
        );
        assert_eq!(pull.program_id, CREDIT_LINE_PROGRAM_ID);
        assert_eq!(repay.program_id, CREDIT_LINE_PROGRAM_ID);
        assert_eq!(pull.accounts.len(), 6);
        assert_eq!(repay.accounts.len(), 11);
    }
}
