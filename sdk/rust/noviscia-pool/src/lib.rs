//! # Noviscia Pool
//!
//! Permissioned pool instruction builders for the Noviscia protocol.
//! Supports KYC-gated deposits/withdrawals with optional merkle proof
//! verification, constant-product swaps, and client-side KYC hash
//! computation matching the on-chain layout.

use sha3::{Digest, Keccak256};
use solana_program::instruction::{AccountMeta, Instruction};
use solana_program::pubkey::Pubkey;

use noviscia_types::{
    BPS, INSURANCE_SEED, LP_ENTRY_SEED, LP_MINT_SEED, LpTier, POOL_SEED,
    POOL_VAULT_SEED, PoolConfig,
};

// ── Constants ──────────────────────────────────────────────────────────────

/// Maximum merkle tree depth (supports up to 2^20 ≈ 1M LPs).
pub const MAX_MERKLE_DEPTH: usize = 20;

// ── Anchor Discriminator ───────────────────────────────────────────────────

/// Compute the Anchor instruction discriminator: first 8 bytes of
/// `sha256("global:<instruction_name>")` using Solana's built-in SHA-256.
fn anchor_discriminator(name: &str) -> [u8; 8] {
    let preimage = format!("global:{name}");
    let hash = solana_program::hash::hash(preimage.as_bytes());
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash.to_bytes()[..8]);
    disc
}

// ── PDA Derivation ─────────────────────────────────────────────────────────

/// Derive the pool config PDA from a label.
pub fn pool_pda(program_id: &Pubkey, label: &[u8]) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(
        &[POOL_SEED, label],
        program_id,
    );
    pda
}

/// Derive the pool base vault PDA.
pub fn pool_vault_pda(program_id: &Pubkey, label: &[u8]) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(
        &[POOL_VAULT_SEED, b"base", label],
        program_id,
    );
    pda
}

/// Derive the pool quote vault PDA.
pub fn pool_quote_vault_pda(program_id: &Pubkey, label: &[u8]) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(
        &[POOL_VAULT_SEED, b"quote", label],
        program_id,
    );
    pda
}

/// Derive the LP mint PDA.
pub fn lp_mint_pda(program_id: &Pubkey, label: &[u8]) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(
        &[LP_MINT_SEED, label],
        program_id,
    );
    pda
}

/// Derive the insurance reserve vault PDA.
pub fn insurance_vault_pda(program_id: &Pubkey, label: &[u8]) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(
        &[INSURANCE_SEED, label],
        program_id,
    );
    pda
}

/// Derive the LP entry PDA for a wallet in a given pool.
pub fn lp_entry_pda(program_id: &Pubkey, pool: &Pubkey, wallet: &Pubkey) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(
        &[LP_ENTRY_SEED, pool.as_ref(), wallet.as_ref()],
        program_id,
    );
    pda
}

// ── KYC Hash ───────────────────────────────────────────────────────────────

/// Compute `keccak256(wallet || tier || expiry_timestamp)` matching the
/// on-chain `compute_kyc_hash`.
pub fn compute_kyc_hash(wallet: &Pubkey, tier: LpTier, expiry: i64) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(wallet.as_ref());
    hasher.update(&(tier as u8).to_le_bytes());
    hasher.update(&expiry.to_le_bytes());
    hasher.finalize().into()
}

// ── Merkle Proof Verification ──────────────────────────────────────────────

/// Verify a keccak256 merkle proof client-side: recompute root from leaf up
/// through siblings, matching the on-chain `verify_merkle_proof`.
pub fn verify_merkle_proof(
    leaf: &[u8; 32],
    proof: &[[u8; 32]],
    expected_root: &[u8; 32],
) -> bool {
    let mut current = *leaf;
    for sibling in proof {
        let mut combined = [0u8; 64];
        if current <= *sibling {
            combined[..32].copy_from_slice(&current);
            combined[32..].copy_from_slice(sibling);
        } else {
            combined[..32].copy_from_slice(sibling);
            combined[32..].copy_from_slice(&current);
        }
        let mut hasher = Keccak256::new();
        hasher.update(&combined);
        current = hasher.finalize().into();
    }
    current == *expected_root
}

// ── Instruction Builders ───────────────────────────────────────────────────

/// Build a `deposit_liquidity` instruction.
///
/// When `kyc_required = true` on the pool, provide a valid merkle proof.
/// An empty proof is acceptable for open (non-KYC) pools.
///
/// Account order mirrors the on-chain `DepositLiquidity` context:
/// 0. user (signer, mut)
/// 1. pool_config (mut)
/// 2. lp_entry
/// 3. token_program
pub fn build_deposit_ix(
    program_id: Pubkey,
    user: Pubkey,
    pool_config: Pubkey,
    amount: u64,
    merkle_proof: Vec<[u8; 32]>,
) -> Instruction {
    let lp_entry = lp_entry_pda(&program_id, &pool_config, &user);

    let accounts = vec![
        AccountMeta::new(user, true),                      // user (signer)
        AccountMeta::new(pool_config, false),              // pool_config
        AccountMeta::new_readonly(lp_entry, false),        // lp_entry
        AccountMeta::new_readonly(spl_token::ID, false),   // token_program
    ];

    let mut data = anchor_discriminator("deposit_liquidity").to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    // Borsh Vec<[u8; 32]>: length as u32 LE, then each 32-byte hash.
    let proof_len = merkle_proof.len() as u32;
    data.extend_from_slice(&proof_len.to_le_bytes());
    for hash in &merkle_proof {
        data.extend_from_slice(hash);
    }

    Instruction {
        program_id,
        accounts,
        data,
    }
}

/// Build a `withdraw_liquidity` instruction.
///
/// When `kyc_required = true` on the pool, provide a valid merkle proof.
///
/// Account order mirrors the on-chain `WithdrawLiquidity` context:
/// 0. user (signer, mut)
/// 1. pool_config (mut)
/// 2. lp_entry
/// 3. token_program
pub fn build_withdraw_ix(
    program_id: Pubkey,
    user: Pubkey,
    pool_config: Pubkey,
    shares_to_burn: u64,
    merkle_proof: Vec<[u8; 32]>,
) -> Instruction {
    let lp_entry = lp_entry_pda(&program_id, &pool_config, &user);

    let accounts = vec![
        AccountMeta::new(user, true),                      // user (signer)
        AccountMeta::new(pool_config, false),              // pool_config
        AccountMeta::new_readonly(lp_entry, false),        // lp_entry
        AccountMeta::new_readonly(spl_token::ID, false),   // token_program
    ];

    let mut data = anchor_discriminator("withdraw_liquidity").to_vec();
    data.extend_from_slice(&shares_to_burn.to_le_bytes());
    let proof_len = merkle_proof.len() as u32;
    data.extend_from_slice(&proof_len.to_le_bytes());
    for hash in &merkle_proof {
        data.extend_from_slice(hash);
    }

    Instruction {
        program_id,
        accounts,
        data,
    }
}

/// Build a `swap` instruction (constant-product AMM).
///
/// Account order mirrors the on-chain `Swap` context:
/// 0. user (signer, mut)
/// 1. pool_config (mut)
/// 2. pool_vault (mut)
/// 3. pool_quote_vault (mut)
/// 4. insurance_vault (mut)
/// 5. user_base_ata (mut)
/// 6. user_quote_ata (mut)
/// 7. token_program
pub fn build_swap_ix(
    program_id: Pubkey,
    user: Pubkey,
    pool_config: Pubkey,
    label: &[u8],
    user_base_ata: Pubkey,
    user_quote_ata: Pubkey,
    amount_in: u64,
    min_amount_out: u64,
) -> Instruction {
    let vault = pool_vault_pda(&program_id, label);
    let quote_vault = pool_quote_vault_pda(&program_id, label);
    let insurance = insurance_vault_pda(&program_id, label);

    let accounts = vec![
        AccountMeta::new(user, true),                      // user (signer)
        AccountMeta::new(pool_config, false),              // pool_config
        AccountMeta::new(vault, false),                    // pool_vault (base)
        AccountMeta::new(quote_vault, false),              // pool_quote_vault
        AccountMeta::new(insurance, false),                // insurance_vault
        AccountMeta::new(user_base_ata, false),            // user_base_ata
        AccountMeta::new(user_quote_ata, false),           // user_quote_ata
        AccountMeta::new_readonly(spl_token::ID, false),   // token_program
    ];

    let mut data = anchor_discriminator("swap").to_vec();
    data.extend_from_slice(&amount_in.to_le_bytes());
    data.extend_from_slice(&min_amount_out.to_le_bytes());

    Instruction {
        program_id,
        accounts,
        data,
    }
}

// ── Pool Math Helpers ──────────────────────────────────────────────────────

/// Compute LP shares for a deposit using constant-product invariant.
/// `shares = amount_in * total_shares / reserve` (or amount_in if first
/// deposit).
pub fn compute_deposit_shares(pool: &PoolConfig, amount: u64) -> u64 {
    if pool.total_shares == 0 || pool.base_reserve == 0 {
        amount
    } else {
        ((amount as u128)
            .checked_mul(pool.total_shares as u128)
            .unwrap()
            .checked_div(pool.base_reserve as u128)
            .unwrap()) as u64
    }
}

/// Compute base token withdrawal for a given number of LP shares.
pub fn compute_withdraw_amount(pool: &PoolConfig, shares: u64) -> u64 {
    if pool.total_shares == 0 {
        return 0;
    }
    ((shares as u128)
        .checked_mul(pool.base_reserve as u128)
        .unwrap()
        .checked_div(pool.total_shares as u128)
        .unwrap()) as u64
}

/// Compute swap output with fee using constant-product formula.
/// Returns `(amount_out, fee)`.
pub fn compute_swap_output(
    amount_in: u64,
    base_reserve: u64,
    quote_reserve: u64,
    fee_bps: u64,
) -> Option<(u64, u64)> {
    let fee = (amount_in as u128)
        .checked_mul(fee_bps as u128)?
        .checked_div(BPS as u128)? as u64;
    let amount_in_after_fee = amount_in.checked_sub(fee)?;

    let k = (base_reserve as u128).checked_mul(quote_reserve as u128)?;
    let new_base = (base_reserve as u128).checked_add(amount_in_after_fee as u128)?;
    let new_quote = k.checked_div(new_base)?;
    let amount_out = (quote_reserve as u128).checked_sub(new_quote)? as u64;

    Some((amount_out, fee))
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_pool(total_shares: u64, base_reserve: u64, quote_reserve: u64) -> PoolConfig {
        PoolConfig {
            authority: Pubkey::default(),
            label: *b"test-pool-0000000000000000000000",
            base_mint: Pubkey::default(),
            quote_mint: Pubkey::default(),
            kyc_required: false,
            kyc_merkle_root: [0u8; 32],
            fee_bps: 30,
            insurance_cut_bps: 10,
            total_shares,
            base_reserve,
            quote_reserve,
            lp_count: 0,
            is_paused: false,
            bump: 0,
            vault_bump: 0,
            lp_mint_bump: 0,
            insurance_bump: 0,
        }
    }

    #[test]
    fn deposit_first_lp_gets_1_to_1() {
        let pool = sample_pool(0, 0, 0);
        assert_eq!(compute_deposit_shares(&pool, 1_000_000), 1_000_000);
    }

    #[test]
    fn deposit_subsequent_lp_gets_proportional() {
        let pool = sample_pool(100_000, 500_000, 1_000_000);
        assert_eq!(compute_deposit_shares(&pool, 100_000), 20_000);
    }

    #[test]
    fn withdraw_proportional() {
        let pool = sample_pool(100_000, 500_000, 1_000_000);
        assert_eq!(compute_withdraw_amount(&pool, 20_000), 100_000);
    }

    #[test]
    fn withdraw_zero_shares() {
        let pool = sample_pool(100_000, 500_000, 1_000_000);
        assert_eq!(compute_withdraw_amount(&pool, 0), 0);
    }

    #[test]
    fn kyc_hash_is_deterministic() {
        let wallet = Pubkey::new_unique();
        let h1 = compute_kyc_hash(&wallet, LpTier::Institutional, 1735689600);
        let h2 = compute_kyc_hash(&wallet, LpTier::Institutional, 1735689600);
        assert_eq!(h1, h2);
    }

    #[test]
    fn kyc_hash_differs_by_tier() {
        let wallet = Pubkey::new_unique();
        let h1 = compute_kyc_hash(&wallet, LpTier::Retail, 1735689600);
        let h2 = compute_kyc_hash(&wallet, LpTier::Institutional, 1735689600);
        assert_ne!(h1, h2);
    }

    #[test]
    fn kyc_hash_differs_by_expiry() {
        let wallet = Pubkey::new_unique();
        let h1 = compute_kyc_hash(&wallet, LpTier::Institutional, 1735689600);
        let h2 = compute_kyc_hash(&wallet, LpTier::Institutional, 1735776000);
        assert_ne!(h1, h2);
    }

    #[test]
    fn merkle_proof_empty_tree() {
        let leaf = [0u8; 32];
        let root = [0u8; 32];
        assert!(verify_merkle_proof(&leaf, &[], &root));
    }

    #[test]
    fn merkle_proof_single_level() {
        let a = [1u8; 32];
        let b = [2u8; 32];

        let mut combined = [0u8; 64];
        combined[..32].copy_from_slice(&a);
        combined[32..].copy_from_slice(&b);
        let mut hasher = Keccak256::new();
        hasher.update(&combined);
        let root: [u8; 32] = hasher.finalize().into();

        assert!(verify_merkle_proof(&a, &[b], &root));
        assert!(verify_merkle_proof(&b, &[a], &root));
    }

    #[test]
    fn swap_output_basic() {
        let (out, fee) = compute_swap_output(10_000, 1_000_000, 1_000_000, 30).unwrap();
        assert_eq!(fee, 30);
        assert!(out > 0);
        assert!(out < 10_000);
    }

    #[test]
    fn pool_pdas_are_deterministic() {
        let pid = Pubkey::new_unique();
        let label = b"test-pool";
        assert_eq!(pool_pda(&pid, label), pool_pda(&pid, label));
        assert_eq!(pool_vault_pda(&pid, label), pool_vault_pda(&pid, label));
        assert_eq!(lp_mint_pda(&pid, label), lp_mint_pda(&pid, label));
        assert_eq!(
            insurance_vault_pda(&pid, label),
            insurance_vault_pda(&pid, label)
        );
    }

    #[test]
    fn different_labels_yield_different_pdas() {
        let pid = Pubkey::new_unique();
        assert_ne!(pool_pda(&pid, b"pool-a"), pool_pda(&pid, b"pool-b"));
    }

    #[test]
    fn deposit_ix_data_format() {
        let ix = build_deposit_ix(
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            1_000_000,
            vec![],
        );
        // 8 (discriminator) + 8 (amount u64) + 4 (vec length u32) = 20
        assert_eq!(ix.data.len(), 20);
    }

    #[test]
    fn swap_ix_data_format() {
        let pid = Pubkey::new_unique();
        let user = Pubkey::new_unique();
        let pool = Pubkey::new_unique();
        let ix = build_swap_ix(
            pid,
            user,
            pool,
            b"test-pool",
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            1_000_000,
            900_000,
        );
        // 8 (discriminator) + 8 (amount_in) + 8 (min_amount_out) = 24
        assert_eq!(ix.data.len(), 24);
        assert!(ix.accounts[0].is_signer);
        assert_eq!(ix.accounts.len(), 8);
    }
}
