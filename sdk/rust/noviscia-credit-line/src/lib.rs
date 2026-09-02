//! # Noviscia Credit Line SDK
//!
//! A low-latency instruction builder that institutional desks and dApps compile
//! directly into their own software. It removes the network round-trip for the
//! Noviscia Credit Line: instead of hand-assembling Anchor account arrays, a
//! quant calls two single-line methods that produce ready-to-sign Solana
//! instructions.
//!
//! ## Single-block flow
//!
//! Everything runs inside **one** Solana transaction (one ~400ms slot):
//!
//! ```text
//!  1. pull_credit      draw USDC from the alpha-sleeve credit vault
//!  2. external swap    (e.g. Raydium) buy the target asset low
//!  3. external swap    (e.g. Meteora) sell the asset high
//!  4. repay_and_settle the Atomic Balance-State Constraint
//! ```
//!
//! If the desk's cross-venue spread is not enough to return `principal + toll`
//! in step 4, the ledger's balance-state check rejects the settle transfer and
//! the **entire transaction rolls back** — the credit vault and every borrower
//! ledger revert, and the pool is untouched. No oracle, no off-chain risk pass,
//! no reentrancy.
//!
//! The toll fee is **dynamic**: it scales with utilization of the shared credit
//! cap and is clamped to `[base, max]` basis points on-chain. See
//! [`noviscia_credit_line::toll_and_utilization`].

use anchor_lang::InstructionData;
use solana_program::instruction::{AccountMeta, Instruction};
use solana_program::pubkey::Pubkey;

/// Convenience re-export of the on-chain program's types.
pub use noviscia_credit_line::{
    BORROWER_SEED, CREDIT_LINE_SEED, CREDIT_VAULT_SEED, TOLL_VAULT_SEED, CreditLine, Borrower,
};

/// Client-side mirror of the deployed program ID.
pub const CREDIT_LINE_PROGRAM_ID: Pubkey =
    noviscia_credit_line::ID;

/// The `nv-usdc-vault` omni-pool program that receives the 90% LP-NAV sweep
/// (via `accumulate_protocol_fees`).
pub const NV_USDC_VAULT_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC");

/// Offline credit-line client. Holds only public addresses — never keys.
pub struct NovisciaCreditLineClient {
    pub program_id: Pubkey,
    /// Borrower's wallet (the signer on `pull` / `repay_and_settle`).
    pub user_wallet: Pubkey,
    /// Borrower's USDC token account (receives the draw, funds the repay).
    pub user_usdc: Pubkey,
    /// The alpha-sleeve credit vault PDA token account.
    pub sovereign_vault: Pubkey,
    /// The shared credit-line ledger PDA.
    pub credit_line: Pubkey,
    /// Where the 10% system treasury share of the toll is captured.
    pub treasury_vault: Pubkey,
    /// The 90% toll staging vault PDA (swept into the omni-pool).
    pub toll_vault: Pubkey,
    /// `nv-usdc-vault` global vault-config account (omni-pool LP NAV).
    pub vault_config: Pubkey,
    /// `nv-usdc-vault` USDC pool account (omni-pool LP NAV).
    pub vault_usdc: Pubkey,
    /// SPL Token program (used in every transfer CPI).
    pub token_program: Pubkey,
    /// `nv-usdc-vault` program (feeds the 90% LP-NAV sweep).
    pub nv_usdc_vault_program: Pubkey,
}

impl NovisciaCreditLineClient {
    /// Build a client from the canonical PDAs and the borrower's addresses.
    /// `vault_config` / `vault_usdc` are the `nv-usdc-vault` pool accounts
    /// (`vault_pool_config` / `vault_pool_usdc`) that receive the LP-NAV sweep.
    pub fn new(
        program_id: Pubkey,
        user_wallet: Pubkey,
        user_usdc: Pubkey,
        sovereign_vault: Pubkey,
        credit_line: Pubkey,
        treasury_vault: Pubkey,
        vault_config: Pubkey,
        vault_usdc: Pubkey,
    ) -> Self {
        Self {
            program_id,
            user_wallet,
            user_usdc,
            sovereign_vault,
            credit_line,
            treasury_vault,
            toll_vault: toll_vault_pda(program_id),
            vault_config,
            vault_usdc,
            token_program: spl_token::ID,
            nv_usdc_vault_program: NV_USDC_VAULT_PROGRAM_ID,
        }
    }

    /// Step 1 — build the single-block "pull" instruction.
    ///
    /// Releases `requested_amount` (USDC base-6) from the alpha-sleeve vault
    /// into the borrower's USDC account. The toll is *not* set here: it is
    /// computed dynamically and clamped on-chain in `repay_and_settle`.
    pub fn build_pull_credit_ix(&self, requested_amount: u64) -> Result<Instruction, SdkError> {
        let borrower = borrower_pda(self.program_id, &self.user_wallet)?;

        let accounts = vec![
            AccountMeta::new(self.user_wallet, true),   // borrower_owner (signer)
            AccountMeta::new(self.credit_line, false),  // credit_line (mut)
            AccountMeta::new(borrower, false),          // borrower (mut)
            AccountMeta::new(self.sovereign_vault, false), // credit_vault (mut)
            AccountMeta::new(self.user_usdc, false),    // borrower_token_account (mut)
            AccountMeta::new_readonly(self.token_program, false), // token_program
        ];

        let ix = noviscia_credit_line::instruction::PullCredit {
            amount: requested_amount,
        };
        Ok(Instruction {
            program_id: self.program_id,
            accounts,
            data: ix.data(),
        })
    }

    /// Step 4 — build the final "repay and settle" instruction.
    ///
    /// The Atomic Balance-State Constraint: returns `principal` to the vault,
    /// routes 10% of the dynamic toll to the system treasury, and sweeps the
    /// remaining 90% into the `nv-usdc-vault` omni-pool (LP NAV) natively.
    /// Account order matches the on-chain `RepayAndSettle` accounts struct.
    pub fn build_repay_and_settle_ix(&self, principal: u64) -> Result<Instruction, SdkError> {
        let borrower = borrower_pda(self.program_id, &self.user_wallet)?;

        let accounts = vec![
            AccountMeta::new(self.user_wallet, true),   // borrower_owner (signer)
            AccountMeta::new(self.credit_line, false),  // credit_line (mut)
            AccountMeta::new(borrower, false),          // borrower (mut)
            AccountMeta::new(self.sovereign_vault, false), // credit_vault (mut)
            AccountMeta::new(self.user_usdc, false),    // borrower_token_account (mut)
            AccountMeta::new(self.treasury_vault, false), // toll_recipient_account (mut)
            AccountMeta::new(self.toll_vault, false),   // toll_vault (mut)
            AccountMeta::new(self.vault_config, false), // vault_config (mut)
            AccountMeta::new(self.vault_usdc, false),   // vault_usdc (mut)
            AccountMeta::new_readonly(self.nv_usdc_vault_program, false), // nv_usdc_vault_program
            AccountMeta::new_readonly(self.token_program, false), // token_program
        ];

        let ix = noviscia_credit_line::instruction::RepayAndSettle { principal };
        Ok(Instruction {
            program_id: self.program_id,
            accounts,
            data: ix.data(),
        })
    }
}

/// Derive the per-borrower registry PDA.
pub fn borrower_pda(program_id: Pubkey, owner: &Pubkey) -> Result<Pubkey, SdkError> {
    let (pda, _bump) = Pubkey::find_program_address(
        &[BORROWER_SEED, owner.as_ref()],
        &program_id,
    );
    Ok(pda)
}

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

/// Errors surfaced while building instructions.
#[derive(Debug)]
pub enum SdkError {
    /// On-chain instruction serialization failed.
    Serialize(anchor_lang::error::Error),
    /// A caller-supplied value was invalid.
    InvalidInput(String),
}

impl std::fmt::Display for SdkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SdkError::Serialize(e) => write!(f, "instruction serialization error: {e}"),
            SdkError::InvalidInput(msg) => write!(f, "invalid input: {msg}"),
        }
    }
}

impl std::error::Error for SdkError {}

impl From<anchor_lang::error::Error> for SdkError {
    fn from(e: anchor_lang::error::Error) -> Self {
        SdkError::Serialize(e)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> NovisciaCreditLineClient {
        let program_id = CREDIT_LINE_PROGRAM_ID;
        let user_wallet = Pubkey::new_unique();
        let user_usdc = Pubkey::new_unique();
        NovisciaCreditLineClient::new(
            program_id,
            user_wallet,
            user_usdc,
            credit_vault_pda(program_id),
            credit_line_pda(program_id),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
        )
    }

    #[test]
    fn pull_ix_targets_program_and_marks_signer() {
        let c = sample();
        let ix = c.build_pull_credit_ix(2_000_000u64).unwrap();
        assert_eq!(ix.program_id, CREDIT_LINE_PROGRAM_ID);
        assert!(ix.accounts[0].is_signer, "borrower_owner must sign");
        assert!(ix.accounts[0].is_writable);
        assert_eq!(ix.accounts.len(), 6, "pull has 6 accounts (no toll recipient)");
        assert!(!ix.accounts[5].is_writable, "token program is readonly");
        assert!(!ix.data.is_empty());
    }

    #[test]
    fn repay_ix_includes_omnipool_sweep_accounts() {
        let c = sample();
        let ix = c.build_repay_and_settle_ix(2_000_000u64).unwrap();
        assert_eq!(ix.accounts.len(), 11, "repay adds toll + omni-pool accounts");
        assert_eq!(ix.accounts[5].pubkey, c.treasury_vault, "index 5 = toll_recipient");
        assert_eq!(ix.accounts[6].pubkey, c.toll_vault, "index 6 = toll staging vault");
        assert!(!ix.accounts[9].is_writable, "nv_usdc_vault_program is readonly");
        assert!(!ix.accounts[10].is_writable, "token program is readonly");
    }

    #[test]
    fn pdas_are_deterministic() {
        let program_id = CREDIT_LINE_PROGRAM_ID;
        let owner = Pubkey::new_unique();
        assert_eq!(borrower_pda(program_id, &owner).unwrap(), borrower_pda(program_id, &owner).unwrap());
        assert_eq!(credit_line_pda(program_id), credit_line_pda(program_id));
        assert_eq!(credit_vault_pda(program_id), credit_vault_pda(program_id));
        assert_eq!(toll_vault_pda(program_id), toll_vault_pda(program_id));
    }
}
