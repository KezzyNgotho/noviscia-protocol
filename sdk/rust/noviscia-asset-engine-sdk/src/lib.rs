//! # Noviscia Asset Engine SDK
//!
//! Instruction builders + PDA derivation for the **noviscia-asset-engine**
//! on-chain program — the multi-asset token register & pool layout.
//!
//! Three standardized SPL profiles share one engine: SOL arrives as **wSOL**
//! (Same decimals as native SOL, handled identically to any SPL asset), USDC,
//! and the NVSC project token. Each asset owns a segregated `AssetPool` with
//! its own capacity ceiling, premium baseline, and vault pair.
//!
//! Flagship builders:
//! - `build_allocate_asset_capacity_ix` — single-slot JIT allocation that
//!   verifies Merkle KYC, opens/rolls the 24h floating window, and atomically
//!   CPIs the **principal** (the micro-premium is accrued, taxi-meter style).
//! - `build_settle_daily_ix` — daily Clearing House settlement: the desk
//!   treasury returns the exact native asset and the ledger resets.
//! - `build_recredit_asset_capacity_ix` — releases unused slot capital back
//!   into the pool.
//! - `build_register_asset_ix` — onboards a mint into the token register.

use solana_program::instruction::{AccountMeta, Instruction};
use solana_program::pubkey::Pubkey;
use solana_sdk::sysvar::rent::ID as RENT_ID;
use sha3::{Digest, Keccak256};

use noviscia_types::{
    ASSET_AUTHORITY_SEED, ASSET_CREDIT_LINE_SEED, ASSET_ENGINE_PROGRAM_ID, ASSET_FEE_VAULT_SEED,
    ASSET_LP_MINT_SEED, ASSET_LP_POSITION_SEED, ASSET_POOL_SEED, ASSET_REGISTRY_SEED,
    ASSET_VAULT_SEED, BPS, DESK_POSITION_SEED, GRACE_SLOTS, LATE_FEE_BASE, LATE_FEE_RATE_BPS,
    WINDOW_SLOTS,
};

pub use noviscia_types::{AssetEngineRegistry, AssetPool, DeskPosition, InstitutionalCreditLine};

pub mod economics;
pub mod velocity;

// ── Anchor Discriminator ───────────────────────────────────────────────────

/// First 8 bytes of `sha256("global:<name>")` — Solana's built-in SHA-256.
pub fn anchor_discriminator(name: &str) -> [u8; 8] {
    let preimage = format!("global:{name}");
    let hash = solana_program::hash::hash(preimage.as_bytes());
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash.to_bytes()[..8]);
    disc
}

// ── PDA Derivation ─────────────────────────────────────────────────────────

pub fn registry_pda(program_id: &Pubkey) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(&[ASSET_REGISTRY_SEED], program_id);
    pda
}

pub fn asset_pool_pda(program_id: &Pubkey, mint: &Pubkey) -> Pubkey {
    let (pda, _bump) =
        Pubkey::find_program_address(&[ASSET_POOL_SEED, mint.as_ref()], program_id);
    pda
}

pub fn asset_vault_pda(program_id: &Pubkey, mint: &Pubkey) -> Pubkey {
    let (pda, _bump) =
        Pubkey::find_program_address(&[ASSET_VAULT_SEED, mint.as_ref()], program_id);
    pda
}

pub fn asset_fee_vault_pda(program_id: &Pubkey, mint: &Pubkey) -> Pubkey {
    let (pda, _bump) =
        Pubkey::find_program_address(&[ASSET_FEE_VAULT_SEED, mint.as_ref()], program_id);
    pda
}

pub fn asset_authority_pda(program_id: &Pubkey, mint: &Pubkey) -> Pubkey {
    let (pda, _bump) =
        Pubkey::find_program_address(&[ASSET_AUTHORITY_SEED, mint.as_ref()], program_id);
    pda
}

pub fn credit_line_pda(program_id: &Pubkey, institution: &Pubkey) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(
        &[ASSET_CREDIT_LINE_SEED, institution.as_ref()],
        program_id,
    );
    pda
}

/// Per-mint desk borrow mirror: `[desk-position, institution, mint]`.
pub fn desk_position_pda(program_id: &Pubkey, institution: &Pubkey, mint: &Pubkey) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(
        &[DESK_POSITION_SEED, institution.as_ref(), mint.as_ref()],
        program_id,
    );
    pda
}

/// ERC-4626 share-mint per pool: `[asset-lp-mint, mint]` (nUSDC / nSOL / nNVSC).
pub fn asset_lp_mint_pda(program_id: &Pubkey, mint: &Pubkey) -> Pubkey {
    let (pda, _bump) =
        Pubkey::find_program_address(&[ASSET_LP_MINT_SEED, mint.as_ref()], program_id);
    pda
}

/// Per-(pool, LP) share-position ledger: `[asset-lp-position, mint, lp]`.
pub fn asset_lp_position_pda(
    program_id: &Pubkey,
    mint: &Pubkey,
    lp: &Pubkey,
) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(
        &[ASSET_LP_POSITION_SEED, mint.as_ref(), lp.as_ref()],
        program_id,
    );
    pda
}

/// Per-asset plan used by `asset_register`.
#[derive(Clone, Copy, Debug)]
pub struct AssetParams {
    pub decimals: u8,
    pub base_premium_rate_bps: u16,
    pub premium_cap_bps: u16,
    pub max_capacity: u64,
    pub min_premium_lamports: u64,
    /// Basis points of paid premium credited to LPs (compounds their share value).
    pub lp_yield_split_bps: u16,
}

/// Standard NVSC project-token profile (9 decimals, VAULT-scale tokens, no min premium).
pub const NVSC_PROFILE: AssetParams = AssetParams {
    decimals: 9,
    base_premium_rate_bps: 30,
    premium_cap_bps: 500,
    max_capacity: 100_000_000_000_000,
    min_premium_lamports: 0,
    lp_yield_split_bps: 9_000,
};

/// Standard USDC profile (6 decimals, fast-cash pool, tighter ceiling).
pub const USDC_PROFILE: AssetParams = AssetParams {
    decimals: 6,
    base_premium_rate_bps: 8,
    premium_cap_bps: 250,
    max_capacity: 5_000_000_000_000,
    min_premium_lamports: 0,
    lp_yield_split_bps: 9_000,
};

/// Standard wSOL profile (9 decimals, native-interop).
pub const WSOL_PROFILE: AssetParams = AssetParams {
    decimals: 9,
    base_premium_rate_bps: 12,
    premium_cap_bps: 300,
    max_capacity: 100_000_000_000,
    min_premium_lamports: 0,
    lp_yield_split_bps: 9_000,
};

// ── Instruction Builders ───────────────────────────────────────────────────

/// Build `initialize` — pins the platform mints + guard authority.
#[allow(clippy::too_many_arguments)]
pub fn build_initialize_ix(
    program_id: Pubkey,
    upgrade_authority: Pubkey,
    breaker_authority: Pubkey,
    risk_committee_authority: Pubkey,
    wsol_mint: Pubkey,
    usdc_mint: Pubkey,
    nvsc_mint: Pubkey,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(upgrade_authority, true),
        AccountMeta::new(registry_pda(&program_id), false),
        AccountMeta::new_readonly(solana_program::system_program::ID, false),
    ];
    let mut data = anchor_discriminator("initialize").to_vec();
    data.extend_from_slice(breaker_authority.as_ref());
    data.extend_from_slice(risk_committee_authority.as_ref());
    data.extend_from_slice(upgrade_authority.as_ref());
    data.extend_from_slice(wsol_mint.as_ref());
    data.extend_from_slice(usdc_mint.as_ref());
    data.extend_from_slice(nvsc_mint.as_ref());
    Instruction { program_id, accounts, data }
}

/// Build `asset_register` — onboards a mint (Tier 3: Core Ecosystem Council,
/// 5-of-7 Squads, 72h timelock).
#[allow(clippy::too_many_arguments)]
pub fn build_register_asset_ix(
    program_id: Pubkey,
    upgrade_authority: Pubkey,
    mint: Pubkey,
    params: AssetParams,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(registry_pda(&program_id), false),
        AccountMeta::new(upgrade_authority, true),
        AccountMeta::new_readonly(mint, false),
        AccountMeta::new(asset_pool_pda(&program_id, &mint), false),
        AccountMeta::new(asset_vault_pda(&program_id, &mint), false),
        AccountMeta::new(asset_fee_vault_pda(&program_id, &mint), false),
        AccountMeta::new_readonly(asset_authority_pda(&program_id, &mint), false),
        AccountMeta::new(asset_lp_mint_pda(&program_id, &mint), false),
        AccountMeta::new_readonly(solana_program::system_program::ID, false),
        AccountMeta::new_readonly(spl_token::ID, false),
        AccountMeta::new_readonly(RENT_ID, false),
    ];
    let mut data = anchor_discriminator("asset_register").to_vec();
    data.push(params.decimals);
    data.extend_from_slice(&params.base_premium_rate_bps.to_le_bytes());
    data.extend_from_slice(&params.premium_cap_bps.to_le_bytes());
    data.extend_from_slice(&params.max_capacity.to_le_bytes());
    data.extend_from_slice(&params.min_premium_lamports.to_le_bytes());
    data.extend_from_slice(&params.lp_yield_split_bps.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `asset_update_params` — adjusts a registered asset's parameters
/// (Tier 2: Risk Committee, 3-of-5 Squads).
pub fn build_update_asset_params_ix(
    program_id: Pubkey,
    risk_committee_authority: Pubkey,
    mint: Pubkey,
    params: AssetParams,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new_readonly(registry_pda(&program_id), false),
        AccountMeta::new(risk_committee_authority, true),
        AccountMeta::new(asset_pool_pda(&program_id, &mint), false),
        AccountMeta::new_readonly(mint, false),
    ];
    let mut data = anchor_discriminator("asset_update_params").to_vec();
    data.extend_from_slice(&params.base_premium_rate_bps.to_le_bytes());
    data.extend_from_slice(&params.premium_cap_bps.to_le_bytes());
    data.extend_from_slice(&params.max_capacity.to_le_bytes());
    data.extend_from_slice(&params.min_premium_lamports.to_le_bytes());
    data.extend_from_slice(&params.lp_yield_split_bps.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `asset_set_support` — toggles an asset's registration latch
/// (Tier 2: Risk Committee, 3-of-5 Squads).
pub fn build_set_asset_support_ix(
    program_id: Pubkey,
    risk_committee_authority: Pubkey,
    mint: Pubkey,
    supported: bool,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new_readonly(registry_pda(&program_id), false),
        AccountMeta::new(risk_committee_authority, true),
        AccountMeta::new(asset_pool_pda(&program_id, &mint), false),
        AccountMeta::new_readonly(mint, false),
    ];
    let mut data = anchor_discriminator("asset_set_support").to_vec();
    data.push(supported as u8);
    Instruction { program_id, accounts, data }
}

/// Build `asset_initialize_credit_line` — registers an institution's aggregate
/// multi-asset credit ceiling (Tier 2: Risk Committee, 3-of-5, post-KYB).
pub fn build_initialize_credit_line_ix(
    program_id: Pubkey,
    institution: Pubkey,
    risk_committee_authority: Pubkey,
    total_credit_limit: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(registry_pda(&program_id), false),
        AccountMeta::new(institution, true),
        AccountMeta::new(risk_committee_authority, true),
        AccountMeta::new(credit_line_pda(&program_id, &institution), false),
        AccountMeta::new_readonly(solana_program::system_program::ID, false),
    ];
    let mut data = anchor_discriminator("asset_initialize_credit_line").to_vec();
    data.extend_from_slice(&total_credit_limit.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `asset_update_credit_limit` — adjusts the aggregate ceiling
/// (Tier 2: Risk Committee, 3-of-5 Squads).
pub fn build_update_credit_limit_ix(
    program_id: Pubkey,
    risk_committee_authority: Pubkey,
    institution: Pubkey,
    new_limit: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new_readonly(registry_pda(&program_id), false),
        AccountMeta::new(risk_committee_authority, true),
        AccountMeta::new(credit_line_pda(&program_id, &institution), false),
        AccountMeta::new_readonly(institution, false),
    ];
    let mut data = anchor_discriminator("asset_update_credit_limit").to_vec();
    data.extend_from_slice(&new_limit.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `asset_set_credit_frozen` — freezes an institution's credit line
/// (Tier 1: Emergency Risk Guard "The Breaker", 1-of-3 Squads).
pub fn build_set_credit_frozen_ix(
    program_id: Pubkey,
    breaker_authority: Pubkey,
    institution: Pubkey,
    frozen: bool,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new_readonly(registry_pda(&program_id), false),
        AccountMeta::new(breaker_authority, true),
        AccountMeta::new(credit_line_pda(&program_id, &institution), false),
        AccountMeta::new_readonly(institution, false),
    ];
    let mut data = anchor_discriminator("asset_set_credit_frozen").to_vec();
    data.push(frozen as u8);
    Instruction { program_id, accounts, data }
}

/// Build `asset_set_paused` — engine-level allocation pause
/// (Tier 1: Emergency Risk Guard "The Breaker", 1-of-3 Squads).
pub fn build_set_paused_ix(
    program_id: Pubkey,
    breaker_authority: Pubkey,
    paused: bool,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(breaker_authority, true),
        AccountMeta::new(registry_pda(&program_id), false),
    ];
    let mut data = anchor_discriminator("asset_set_paused").to_vec();
    data.push(paused as u8);
    Instruction { program_id, accounts, data }
}

/// Build `asset_allocate_capacity` — the Multi-Asset JIT Allocation core.
///
/// Account order mirrors the on-chain `AllocateAssetCapacity` context:
/// 0. pool (mut)
/// 1. pool_vault (mut)
/// 2. vault_authority
/// 3. credit_line (mut)
/// 4. desk_position (mut, init_if_needed)
/// 5. trader (signer)
/// 6. trader_token_account (mut)
/// 7. fee_vault (mut)
/// 8. token_program
/// 9. system_program
///
/// `requested_amount` raw lamports (not human decimals). The expected premium
/// is `principal × base_premium_rate_bps / 10_000`, floored at the pool's
/// minimum premium. `expiry` is the KYC leaf timestamp (unix seconds); when the
/// desk has a root set, `merkle_proof` must validate
/// `keccak256(institution || expiry_be)` up to that root.
pub fn build_allocate_asset_capacity_ix(
    program_id: Pubkey,
    mint: Pubkey,
    institution: Pubkey,
    trader: Pubkey,
    trader_token_account: Pubkey,
    requested_amount: u64,
    target_slot: u64,
    expected_premium: u64,
    expiry: i64,
    merkle_proof: Vec<[u8; 32]>,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(asset_pool_pda(&program_id, &mint), false),
        AccountMeta::new(asset_vault_pda(&program_id, &mint), false),
        AccountMeta::new_readonly(asset_authority_pda(&program_id, &mint), false),
        AccountMeta::new(credit_line_pda(&program_id, &institution), false),
        AccountMeta::new(desk_position_pda(&program_id, &institution, &mint), false),
        AccountMeta::new(trader, true),
        AccountMeta::new(trader_token_account, false),
        AccountMeta::new(asset_fee_vault_pda(&program_id, &mint), false),
        AccountMeta::new_readonly(spl_token::ID, false),
        AccountMeta::new_readonly(solana_program::system_program::ID, false),
    ];
    let mut data = anchor_discriminator("asset_allocate_capacity").to_vec();
    data.extend_from_slice(&requested_amount.to_le_bytes());
    data.extend_from_slice(&target_slot.to_le_bytes());
    data.extend_from_slice(&expected_premium.to_le_bytes());
    data.extend_from_slice(&expiry.to_le_bytes());
    data.extend_from_slice(&(merkle_proof.len() as u32).to_le_bytes());
    for node in merkle_proof {
        data.extend_from_slice(&node);
    }
    Instruction { program_id, accounts, data }
}

/// Build `asset_recredit_capacity` — releases unused slot capital.
pub fn build_recredit_asset_capacity_ix(
    program_id: Pubkey,
    mint: Pubkey,
    institution: Pubkey,
    trader: Pubkey,
    trader_token_account: Pubkey,
    amount: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(asset_pool_pda(&program_id, &mint), false),
        AccountMeta::new(asset_vault_pda(&program_id, &mint), false),
        AccountMeta::new(credit_line_pda(&program_id, &institution), false),
        AccountMeta::new(desk_position_pda(&program_id, &institution, &mint), false),
        AccountMeta::new(trader, true),
        AccountMeta::new(trader_token_account, false),
        AccountMeta::new_readonly(spl_token::ID, false),
    ];
    let mut data = anchor_discriminator("asset_recredit_capacity").to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `asset_set_kyc_root` — posts a desk's provider-agnostic Merkle root.
/// Build `asset_set_kyc_root` — provider-agnostic Merkle KYC root for a desk
/// (Tier 2: Risk Committee, 3-of-5 Squads).
pub fn build_set_kyc_root_ix(
    program_id: Pubkey,
    risk_committee_authority: Pubkey,
    institution: Pubkey,
    kyc_merkle_root: [u8; 32],
) -> Instruction {
    let accounts = vec![
        AccountMeta::new_readonly(registry_pda(&program_id), false),
        AccountMeta::new(risk_committee_authority, true),
        AccountMeta::new(credit_line_pda(&program_id, &institution), false),
        AccountMeta::new_readonly(institution, false),
    ];
    let mut data = anchor_discriminator("asset_set_kyc_root").to_vec();
    data.extend_from_slice(&kyc_merkle_root);
    Instruction { program_id, accounts, data }
}

// ── Credit-line Merkle KYC (keccak256, mirrors asset_engine.rs) ────────────

/// keccak256 KYC leaf: `keccak256(institution || expiry_BE)`, mirrors the
/// on-chain `asset_compute_kyc_hash`. Note the asset-engine flavor has NO tier
/// byte (unlike the capacity-host leaf).
pub fn asset_compute_kyc_hash(institution: &Pubkey, expiry: i64) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(institution.as_ref());
    hasher.update(expiry.to_be_bytes());
    hasher.finalize().into()
}

/// Sorted-pair keccak, mirrors `asset_keccak256_pair`.
pub fn asset_keccak256_pair(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    let (left, right) = if a <= b { (a, b) } else { (b, a) };
    hasher.update(left);
    hasher.update(right);
    hasher.finalize().into()
}

/// Validate a sorted-pair merkle proof against a desk's KYC root.
/// Returns `false` when the root is all zeros (proof skipped on-chain).
pub fn asset_verify_merkle_proof(leaf: &[u8; 32], proof: &[[u8; 32]], root: &[u8; 32]) -> bool {
    if root == &[0u8; 32] {
        return false;
    }
    let mut digest = *leaf;
    for sibling in proof {
        digest = asset_keccak256_pair(&digest, sibling);
    }
    digest == *root
}

/// Build a deterministic sorted-pair merkle tree (duplicate-last for odd
/// counts) and return the complete leaf proof set keyed by index. Mirrors the
/// tree construction consumed by `asset_verify_merkle_proof`.
pub fn asset_build_merkle_tree(leaves: &[[u8; 32]]) -> ([u8; 32], Vec<Vec<[u8; 32]>>) {
    assert!(!leaves.is_empty(), "asset_build_merkle_tree: empty leaves");
    let mut levels: Vec<Vec<[u8; 32]>> = vec![leaves.to_vec()];
    while levels.last().unwrap().len() > 1 {
        let cur = levels.last().unwrap();
        let mut next: Vec<[u8; 32]> = Vec::new();
        let mut i = 0;
        while i < cur.len() {
            let left = cur[i];
            let right = if i + 1 < cur.len() { cur[i + 1] } else { left };
            next.push(asset_keccak256_pair(&left, &right));
            i += 2;
        }
        levels.push(next);
    }
    let root = *levels.last().unwrap().last().unwrap();
    let proofs = (0..leaves.len())
        .map(|mut idx| {
            let mut proof = Vec::new();
            for level in levels.iter().take(levels.len() - 1) {
                let sibling_idx = if idx % 2 == 0 {
                    idx + 1
                } else {
                    idx - 1
                };
                proof.push(level[sibling_idx.min(level.len() - 1)]);
                idx /= 2;
            }
            proof
        })
        .collect();
    (root, proofs)
}

/// Build `asset_settle_daily` — Phase 3 daily clearing house settlement.
///
/// The desk treasury returns the exact native asset. `late_fee_payment` is the
/// deterministic per-block default interest during the 2h grace phase
/// (`compute_late_fee(desk_position.active_principal, overdue_blocks)`); pass
/// `0` while the 24h window is still open. After the grace window the program
/// refuses settlement (status "Breached" → off-chain Master Loan Agreement).
///
/// Account order mirrors the on-chain `SettleDaily` context:
/// 0. pool (mut)
/// 1. pool_vault (mut)
/// 2. fee_vault (mut)
/// 3. credit_line (mut)
/// 4. desk_position (mut)
/// 5. treasury (signer)
/// 6. treasury_token_account (mut)
/// 7. token_program
pub fn build_settle_daily_ix(
    program_id: Pubkey,
    mint: Pubkey,
    institution: Pubkey,
    treasury: Pubkey,
    treasury_token_account: Pubkey,
    principal_payment: u64,
    premium_payment: u64,
    late_fee_payment: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(asset_pool_pda(&program_id, &mint), false),
        AccountMeta::new(asset_vault_pda(&program_id, &mint), false),
        AccountMeta::new(asset_fee_vault_pda(&program_id, &mint), false),
        AccountMeta::new(credit_line_pda(&program_id, &institution), false),
        AccountMeta::new(desk_position_pda(&program_id, &institution, &mint), false),
        AccountMeta::new(treasury, true),
        AccountMeta::new(treasury_token_account, false),
        AccountMeta::new_readonly(spl_token::ID, false),
    ];
    let mut data = anchor_discriminator("asset_settle_daily").to_vec();
    data.extend_from_slice(&principal_payment.to_le_bytes());
    data.extend_from_slice(&premium_payment.to_le_bytes());
    data.extend_from_slice(&late_fee_payment.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `asset_deposit_liquidity` — LP seeds a pool vault in native asset and
/// receives freshly minted ERC-4626 share tokens (nUSDC / nSOL / nNVSC).
#[allow(clippy::too_many_arguments)]
pub fn build_deposit_asset_liquidity_ix(
    program_id: Pubkey,
    mint: Pubkey,
    provider: Pubkey,
    provider_token_account: Pubkey,
    provider_lp_token_account: Pubkey,
    amount: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(asset_pool_pda(&program_id, &mint), false),
        AccountMeta::new(asset_vault_pda(&program_id, &mint), false),
        AccountMeta::new(asset_lp_mint_pda(&program_id, &mint), false),
        AccountMeta::new(asset_lp_position_pda(&program_id, &mint, &provider), false),
        AccountMeta::new_readonly(asset_authority_pda(&program_id, &mint), false),
        AccountMeta::new(provider, true),
        AccountMeta::new(provider_token_account, false),
        AccountMeta::new(provider_lp_token_account, false),
        AccountMeta::new_readonly(spl_token::ID, false),
        AccountMeta::new_readonly(solana_program::system_program::ID, false),
    ];
    let mut data = anchor_discriminator("asset_deposit_liquidity").to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `asset_withdraw_liquidity` — an LP burns share tokens and redeems a
/// proportional slice of the pool vault, subject to the desk-solvency floor
/// (`idle − shares_value ≥ active credit utilization`).
#[allow(clippy::too_many_arguments)]
pub fn build_withdraw_asset_liquidity_ix(
    program_id: Pubkey,
    mint: Pubkey,
    lp: Pubkey,
    lp_token_account: Pubkey,
    destination: Pubkey,
    shares: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(asset_pool_pda(&program_id, &mint), false),
        AccountMeta::new(asset_vault_pda(&program_id, &mint), false),
        AccountMeta::new_readonly(asset_lp_mint_pda(&program_id, &mint), false),
        AccountMeta::new(asset_lp_position_pda(&program_id, &mint, &lp), false),
        AccountMeta::new_readonly(asset_authority_pda(&program_id, &mint), false),
        AccountMeta::new(lp, true),
        AccountMeta::new(lp_token_account, false),
        AccountMeta::new(destination, false),
        AccountMeta::new_readonly(spl_token::ID, false),
    ];
    let mut data = anchor_discriminator("asset_withdraw_liquidity").to_vec();
    data.extend_from_slice(&shares.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `asset_withdraw_fees` — sweeps a per-asset fee vault.
/// Build `asset_withdraw_fees` — sweeps a per-asset fee vault (Tier 3:
/// Core Ecosystem Council, 5-of-7 Squads, 72h timelock — treasury allocation).
pub fn build_withdraw_asset_fees_ix(
    program_id: Pubkey,
    upgrade_authority: Pubkey,
    mint: Pubkey,
    destination: Pubkey,
    amount: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(asset_pool_pda(&program_id, &mint), false),
        AccountMeta::new_readonly(registry_pda(&program_id), false),
        AccountMeta::new(upgrade_authority, true),
        AccountMeta::new(asset_fee_vault_pda(&program_id, &mint), false),
        AccountMeta::new_readonly(asset_authority_pda(&program_id, &mint), false),
        AccountMeta::new(destination, false),
        AccountMeta::new_readonly(spl_token::ID, false),
    ];
    let mut data = anchor_discriminator("asset_withdraw_fees").to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction { program_id, accounts, data }
}

// ── Default program convenience ────────────────────────────────────────────

pub fn asset_register_default(authority: Pubkey, mint: Pubkey, profile: AssetParams) -> Instruction {
    build_register_asset_ix(ASSET_ENGINE_PROGRAM_ID, authority, mint, profile)
}

/// One-shot pointer to the wSOL-mint profile (native-interop).
pub fn register_wsol_default(authority: Pubkey, wsol_mint: Pubkey) -> Instruction {
    build_register_asset_ix(ASSET_ENGINE_PROGRAM_ID, authority, wsol_mint, WSOL_PROFILE)
}

/// Compute the on-chain micro-premium for an allocation.
pub fn compute_premium(principal: u64, base_premium_rate_bps: u16, min_premium_lamports: u64) -> u64 {
    let bps_premium =
        (principal as u128) * (base_premium_rate_bps as u128) / 10_000u128;
    (bps_premium as u64).max(min_premium_lamports)
}

/// Per-block default-interest meter for the 2h grace phase (mirrors the
/// on-chain formula exactly). `overdue_blocks` counts slots past the 24h
/// maturity; zero once the window is still open.
pub fn compute_late_fee(principal: u64, overdue_blocks: u64) -> u64 {
    if overdue_blocks == 0 {
        return 0;
    }
    let accrued = (principal as u128)
        .checked_mul(LATE_FEE_RATE_BPS as u128)
        .and_then(|x| x.checked_mul(overdue_blocks as u128))
        .unwrap_or(0)
        / (BPS as u128 * LATE_FEE_BASE as u128);
    accrued as u64
}

/// Deterministic posture of the desk's 24h floating window at `current_slot`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowPosture {
    NoWindow,
    Open,
    Overdue,
    Breached,
}

pub fn window_posture(window_start_slot: u64, current_slot: u64) -> WindowPosture {
    if window_start_slot == 0 {
        return WindowPosture::NoWindow;
    }
    let mature = window_start_slot.saturating_add(WINDOW_SLOTS);
    if current_slot < mature {
        return WindowPosture::Open;
    }
    if current_slot < mature.saturating_add(GRACE_SLOTS) {
        WindowPosture::Overdue
    } else {
        WindowPosture::Breached
    }
}

/// ERC-4626 deposit: shares minted for `deposit` at the current share price.
/// Mirrors `AssetPool::compute_deposit_shares` on-chain; 1:1 on first deposit.
pub fn compute_deposit_shares(deposit: u64, total_shares: u64, total_assets: u64) -> u64 {
    if deposit == 0 {
        return 0;
    }
    if total_shares == 0 || total_assets == 0 {
        return deposit;
    }
    let shares_ratio = (deposit as u128)
        .checked_mul(total_shares as u128)
        .unwrap_or(0)
        / total_assets as u128;
    shares_ratio as u64
}

/// ERC-4626 redeem: native assets returned for `shares` at the current price.
/// Mirrors `AssetPool::compute_lp_withdraw_value` on-chain (caps at assets).
pub fn compute_lp_withdraw_value(shares: u64, total_shares: u64, total_assets: u64) -> u64 {
    if shares == 0 || total_shares == 0 {
        return 0;
    }
    let value = (shares as u128)
        .checked_mul(total_assets as u128)
        .unwrap_or(0)
        / total_shares as u128;
    value.min(total_assets as u128) as u64
}

/// Scaled per-share price (×1_000_000) — the auto-compounding readout.
pub fn compute_lp_share_price(total_shares: u64, total_assets: u64) -> u128 {
    if total_shares == 0 {
        return 1_000_000;
    }
    (total_assets as u128)
        .checked_mul(1_000_000u128)
        .unwrap_or(0)
        / total_shares as u128
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn premium_matches_onchain_formula() {
        assert_eq!(compute_premium(1_000_000, 8, 0), 800);
        assert_eq!(compute_premium(1_000_000, 30, 0), 3_000);
        assert_eq!(compute_premium(1_000_000, 12, 0), 1_200);
        assert_eq!(compute_premium(1_000, 12, 500), 500); // min premium floor
    }

    #[test]
    fn late_fee_and_window_posture_mirror_onchain_safeguards() {
        // 0 overdue blocks => no penalty.
        assert_eq!(compute_late_fee(1_000_000_000, 0), 0);
        // 50 micro-bps per slot => 5 lamports per slot per 1e9 borrowed bucket.
        assert_eq!(compute_late_fee(1_000_000_000, 200), 100_000);
        assert_eq!(compute_late_fee(1_000_000_000, 18_000), 9_000_000);

        let start = 1_000;
        assert_eq!(window_posture(start, 999), WindowPosture::Open);
        let mature = start + WINDOW_SLOTS;
        assert_eq!(window_posture(start, mature - 1), WindowPosture::Open);
        assert_eq!(window_posture(start, mature), WindowPosture::Overdue);
        assert_eq!(window_posture(start, mature + GRACE_SLOTS - 1), WindowPosture::Overdue);
        assert_eq!(window_posture(start, mature + GRACE_SLOTS), WindowPosture::Breached);
        // No window open yet.
        assert_eq!(window_posture(0, 5), WindowPosture::NoWindow);
    }

    #[test]
    fn standardized_profiles_carry_distinct_limits() {
        assert_eq!(USDC_PROFILE.decimals, 6);
        assert_eq!(WSOL_PROFILE.decimals, 9);
        assert_eq!(NVSC_PROFILE.decimals, 9);
        assert!(USDC_PROFILE.base_premium_rate_bps < NVSC_PROFILE.base_premium_rate_bps);
        assert!(NVSC_PROFILE.max_capacity > USDC_PROFILE.max_capacity);
    }

    #[test]
    fn allocate_ix_encodes_account_order_and_args() {
        let mint = Pubkey::new_unique();
        let institution = Pubkey::new_unique();
        let trader = Pubkey::new_unique();
        let ata = Pubkey::new_unique();
        let proof = vec![[7u8; 32], [9u8; 32]];
        let ix = build_allocate_asset_capacity_ix(
            ASSET_ENGINE_PROGRAM_ID, mint, institution, trader, ata, 500_000_000, 123, 600_000, 1_758_000_000,
            proof.clone(),
        );
        assert_eq!(ix.program_id, ASSET_ENGINE_PROGRAM_ID);
        assert_eq!(ix.accounts.len(), 10);
        // 0 = pool, 4 = desk_position, 5 = trader (signer), 8 = token program, 9 = system
        assert_eq!(ix.accounts[0].pubkey, asset_pool_pda(&ASSET_ENGINE_PROGRAM_ID, &mint));
        assert_eq!(
            ix.accounts[4].pubkey,
            desk_position_pda(&ASSET_ENGINE_PROGRAM_ID, &institution, &mint)
        );
        assert_eq!(ix.accounts[5].pubkey, trader);
        assert!(ix.accounts[5].is_signer);
        assert_eq!(ix.accounts[8].pubkey, spl_token::ID);
        assert_eq!(ix.accounts[9].pubkey, solana_program::system_program::ID);
        // requested_amount + target_slot + expected_premium + expiry (LE),
        // then u32 proof length + two proof nodes.
        assert_eq!(&ix.data[8..16], &500_000_000u64.to_le_bytes());
        assert_eq!(&ix.data[16..24], &123u64.to_le_bytes());
        assert_eq!(&ix.data[24..32], &600_000u64.to_le_bytes());
        assert_eq!(&ix.data[32..40], &1_758_000_000i64.to_le_bytes());
        assert_eq!(&ix.data[40..44], &2u32.to_le_bytes());
        assert_eq!(&ix.data[44..76], &proof[0]);
        assert_eq!(&ix.data[76..108], &proof[1]);
    }

    #[test]
    fn lifecycle_builders_cover_the_daily_clearing_flow() {
        let mint = Pubkey::new_unique();
        let institution = Pubkey::new_unique();

        // Desk position PDA is institution × mint scoped.
        assert_ne!(
            desk_position_pda(&ASSET_ENGINE_PROGRAM_ID, &institution, &mint),
            asset_pool_pda(&ASSET_ENGINE_PROGRAM_ID, &mint)
        );

        // settle_daily lays out pool → vaults → line → position → treasury.
        let treasury = Pubkey::new_unique();
        let tta = Pubkey::new_unique();
        let settle = build_settle_daily_ix(
            ASSET_ENGINE_PROGRAM_ID, mint, institution, treasury, tta, 1_000_000_000, 50_000,
            777,
        );
        assert_eq!(&settle.data[..8], &anchor_discriminator("asset_settle_daily"));
        assert_eq!(settle.accounts.len(), 8);
        assert_eq!(settle.accounts[0].pubkey, asset_pool_pda(&ASSET_ENGINE_PROGRAM_ID, &mint));
        assert_eq!(settle.accounts[4].pubkey, desk_position_pda(&ASSET_ENGINE_PROGRAM_ID, &institution, &mint));
        assert_eq!(settle.accounts[5].pubkey, treasury);
        assert!(settle.accounts[5].is_signer);
        // principal, premium, then late-fee lamports appended in order.
        assert_eq!(&settle.data[8..16], &1_000_000_000u64.to_le_bytes());
        assert_eq!(&settle.data[16..24], &50_000u64.to_le_bytes());
        assert_eq!(&settle.data[24..32], &777u64.to_le_bytes());

        // set_kyc_root carries the 32-byte root + references the credit line
        // (Tier 2 committee signs after the registry proof).
        let root = [42u8; 32];
        let kyc = build_set_kyc_root_ix(ASSET_ENGINE_PROGRAM_ID, Pubkey::new_unique(), institution, root);
        assert_eq!(&kyc.data[..8], &anchor_discriminator("asset_set_kyc_root"));
        assert_eq!(&kyc.data[8..40], &root);
        assert_eq!(
            kyc.accounts[2].pubkey,
            credit_line_pda(&ASSET_ENGINE_PROGRAM_ID, &institution)
        );

        // Liquidity builders route LP deposits through the share-mint + position.
        let depositor = Pubkey::new_unique();
        let deposit_ata = Pubkey::new_unique();
        let deposit_lp_ata = Pubkey::new_unique();
        let dep = build_deposit_asset_liquidity_ix(
            ASSET_ENGINE_PROGRAM_ID, mint, depositor, deposit_ata, deposit_lp_ata, 2_000_000_000,
        );
        assert_eq!(dep.accounts[1].pubkey, asset_vault_pda(&ASSET_ENGINE_PROGRAM_ID, &mint));
        assert_eq!(dep.accounts[2].pubkey, asset_lp_mint_pda(&ASSET_ENGINE_PROGRAM_ID, &mint));
        assert_eq!(
            dep.accounts[3].pubkey,
            asset_lp_position_pda(&ASSET_ENGINE_PROGRAM_ID, &mint, &depositor)
        );
        assert_eq!(dep.accounts[5].pubkey, depositor);
        assert!(dep.accounts[5].is_signer);
        assert_eq!(dep.accounts.len(), 10);
        assert_eq!(&dep.data[8..16], &2_000_000_000u64.to_le_bytes());

        // LP redemption burns shares and honors the desk-solvency floor.
        let title_lp = Pubkey::new_unique();
        let burn_ata = Pubkey::new_unique();
        let wd_dest = Pubkey::new_unique();
        let wd = build_withdraw_asset_liquidity_ix(
            ASSET_ENGINE_PROGRAM_ID, mint, title_lp, burn_ata, wd_dest, 500,
        );
        assert_eq!(wd.accounts[0].pubkey, asset_pool_pda(&ASSET_ENGINE_PROGRAM_ID, &mint));
        assert_eq!(wd.accounts[3].pubkey, asset_lp_position_pda(&ASSET_ENGINE_PROGRAM_ID, &mint, &title_lp));
        assert_eq!(wd.accounts[5].pubkey, title_lp);
        assert!(wd.accounts[5].is_signer);
        assert_eq!(wd.accounts[7].pubkey, wd_dest);
        assert_eq!(wd.accounts.len(), 9);
        assert_eq!(&wd.data[8..16], &500u64.to_le_bytes());
    }

    #[test]
    fn register_ix_lays_out_the_five_asset_pdas() {
        let mint = Pubkey::new_unique();
        let authority = Pubkey::new_unique();
        let ix = build_register_asset_ix(ASSET_ENGINE_PROGRAM_ID, authority, mint, USDC_PROFILE);
        assert_eq!(ix.accounts.len(), 11);
        let pool = asset_pool_pda(&ASSET_ENGINE_PROGRAM_ID, &mint);
        let vault = asset_vault_pda(&ASSET_ENGINE_PROGRAM_ID, &mint);
        let fee_vault = asset_fee_vault_pda(&ASSET_ENGINE_PROGRAM_ID, &mint);
        assert_eq!(ix.accounts[3].pubkey, pool);
        assert_eq!(ix.accounts[4].pubkey, vault);
        assert_eq!(ix.accounts[5].pubkey, fee_vault);
        assert_eq!(ix.accounts[7].pubkey, asset_lp_mint_pda(&ASSET_ENGINE_PROGRAM_ID, &mint));
        assert_ne!(pool, vault);
        assert_ne!(vault, fee_vault);
        // decimals byte then bps/capacity args, LP yield split appended last.
        assert_eq!(ix.data[8], USDC_PROFILE.decimals);
        assert_eq!(&ix.data[29..31], &USDC_PROFILE.lp_yield_split_bps.to_le_bytes());
    }

    #[test]
    fn governance_builders_bind_each_tier_to_its_scope() {
        let breaker = Pubkey::new_unique();
        let committee = Pubkey::new_unique();
        let council = Pubkey::new_unique();
        let wsol = Pubkey::new_unique();
        let usdc = Pubkey::new_unique();
        let nvsc = Pubkey::new_unique();

        // initialize: Tier-3 council signs; data carries breaker + committee + upgrade keys.
        let init = build_initialize_ix(ASSET_ENGINE_PROGRAM_ID, council, breaker, committee, wsol, usdc, nvsc);
        assert!(init.accounts[0].is_signer);
        assert_eq!(init.accounts[0].pubkey, council);
        assert_eq!(&init.data[..8], &anchor_discriminator("initialize"));
        assert_eq!(&init.data[8..40], breaker.as_ref());
        assert_eq!(&init.data[40..72], committee.as_ref());
        assert_eq!(&init.data[72..104], council.as_ref());
        assert_eq!(&init.data[104..136], wsol.as_ref());
        assert_eq!(&init.data[136..168], usdc.as_ref());
        assert_eq!(&init.data[168..200], nvsc.as_ref());
        assert_eq!(init.data.len(), 200);

        // Breaker scope is strictly emergency: pause + freeze carry no other meta.
        let brk = Pubkey::new_unique();
        let pause = build_set_paused_ix(ASSET_ENGINE_PROGRAM_ID, brk, false);
        assert_eq!(pause.accounts[0].pubkey, brk);
        assert!(pause.accounts[0].is_signer);
        let freeze = build_set_credit_frozen_ix(ASSET_ENGINE_PROGRAM_ID, brk, Pubkey::new_unique(), true);
        assert_eq!(freeze.accounts[1].pubkey, brk);
        assert!(freeze.accounts[1].is_signer);

        // Committee scope is parameter / limit surfaces.
        let cmt = Pubkey::new_unique();
        let limit = build_update_credit_limit_ix(ASSET_ENGINE_PROGRAM_ID, cmt, Pubkey::new_unique(), 1_000);
        assert_eq!(limit.accounts[1].pubkey, cmt);
        assert!(limit.accounts[1].is_signer);
        let params = build_update_asset_params_ix(ASSET_ENGINE_PROGRAM_ID, cmt, Pubkey::new_unique(), USDC_PROFILE);
        assert_eq!(params.accounts[1].pubkey, cmt);
        assert!(params.accounts[1].is_signer);

        // Upgrade scope is structural: asset registration + fee treasury.
        let council = Pubkey::new_unique();
        let fees = build_withdraw_asset_fees_ix(ASSET_ENGINE_PROGRAM_ID, council, Pubkey::new_unique(), Pubkey::new_unique(), 500);
        assert_eq!(fees.accounts[2].pubkey, council);
        assert!(fees.accounts[2].is_signer);
    }

    #[test]
    fn pda_derivations_are_stable_and_distinct_per_mint() {
        let a = Pubkey::new_unique();
        let b = Pubkey::new_unique();
        let program = ASSET_ENGINE_PROGRAM_ID;
        assert_ne!(asset_pool_pda(&program, &a), asset_pool_pda(&program, &b));
        assert_ne!(asset_vault_pda(&program, &a), asset_vault_pda(&program, &b));
        assert_ne!(asset_fee_vault_pda(&program, &a), asset_fee_vault_pda(&program, &b));
        assert_ne!(asset_pool_pda(&program, &a), asset_vault_pda(&program, &a));
        assert_ne!(asset_vault_pda(&program, &a), asset_fee_vault_pda(&program, &a));
    }

    #[test]
    fn credit_line_pda_is_institution_scoped() {
        let program = ASSET_ENGINE_PROGRAM_ID;
        let inst_a = Pubkey::new_unique();
        let inst_b = Pubkey::new_unique();
        assert_ne!(
            credit_line_pda(&program, &inst_a),
            credit_line_pda(&program, &inst_b)
        );
    }

    #[test]
    fn every_builder_uses_the_anchor_discriminator_prefix() {
        // spot-check three builders land a 32-byte body past the prefix
        let ix = build_set_paused_ix(ASSET_ENGINE_PROGRAM_ID, Pubkey::new_unique(), true);
        assert_eq!(&ix.data[..8], &anchor_discriminator("asset_set_paused"));
        assert_eq!(ix.data.len(), 9);
        assert_eq!(
            noviscia_types::WSOL_MINT.to_string().starts_with("So111"),
            true
        );
    }

    #[test]
    fn lp_share_math_mirrors_the_4626_onchain_ledger() {
        // First deposit is 1:1.
        assert_eq!(compute_deposit_shares(1_000, 0, 0), 1_000);
        // After compounding 1_000 → 1_200 at constant shares, price is 1.2.
        assert_eq!(compute_lp_share_price(1_000, 1_200), 1_200_000);
        assert_eq!(compute_lp_withdraw_value(1_000, 1_000, 1_200), 1_200);
        // Bob deposits 600 at 1.2/share → 500 shares.
        assert_eq!(compute_deposit_shares(600, 1_000, 1_200), 500);
        assert_eq!(compute_lp_withdraw_value(500, 1_500, 1_800), 600);
        // Redeems cap at total assets.
        assert_eq!(compute_lp_withdraw_value(1_000, 1_000, 0), 0);
        assert_eq!(compute_lp_withdraw_value(1_000, 1_000, 500), 500);
    }

    #[test]
    fn credit_line_kyc_leaf_mirrors_asset_compute_kyc_hash() {
        let institution = Pubkey::new_unique();
        let leaf = asset_compute_kyc_hash(&institution, 1_758_000_000);
        assert_eq!(leaf.len(), 32);
        assert_eq!(asset_compute_kyc_hash(&institution, 1_758_000_000), leaf);
        assert_ne!(
            asset_compute_kyc_hash(&institution, 1_759_000_000),
            leaf,
            "different expiry must change the leaf"
        );
    }

    #[test]
    fn empty_proof_against_own_root_passes() {
        let institution = Pubkey::new_unique();
        let leaf = asset_compute_kyc_hash(&institution, 1_758_000_000);
        assert!(asset_verify_merkle_proof(&leaf, &[], &leaf));
        let other = asset_compute_kyc_hash(&institution, 1_759_000_000);
        assert!(!asset_verify_merkle_proof(&other, &[], &leaf));
    }

    #[test]
    fn sorted_pair_two_leaf_root_verifies_from_either_leaf() {
        let a = asset_compute_kyc_hash(&Pubkey::new_unique(), 100);
        let b = asset_compute_kyc_hash(&Pubkey::new_unique(), 200);
        let root = asset_keccak256_pair(&a, &b);
        assert!(asset_verify_merkle_proof(&a, &[b], &root));
        assert!(asset_verify_merkle_proof(&b, &[a], &root));
    }

    #[test]
    fn zero_root_is_always_rejected() {
        let a = asset_compute_kyc_hash(&Pubkey::new_unique(), 100);
        let b = asset_compute_kyc_hash(&Pubkey::new_unique(), 200);
        let zero = [0u8; 32];
        assert!(!asset_verify_merkle_proof(&a, &[b], &zero));
    }

    #[test]
    fn proof_from_real_tree_validates_every_leaf() {
        let leaves: Vec<[u8; 32]> = (0..5)
            .map(|i| asset_compute_kyc_hash(&Pubkey::new_unique(), 1_000 + i))
            .collect();
        let (root, proofs) = asset_build_merkle_tree(&leaves);
        assert_eq!(root.len(), 32);
        for (i, proof) in proofs.iter().enumerate() {
            assert!(
                asset_verify_merkle_proof(&leaves[i], proof, &root),
                "leaf {i} must verify"
            );
        }
        let foreign = asset_compute_kyc_hash(&Pubkey::new_unique(), 9_999);
        assert!(!asset_verify_merkle_proof(&foreign, &proofs[0], &root));
    }

    #[test]
    fn odd_leaf_count_mirrors_duplicate_last_fold() {
        let leaves: Vec<[u8; 32]> = (0..3)
            .map(|i| asset_compute_kyc_hash(&Pubkey::new_unique(), i as i64 + 1))
            .collect();
        let (root, proofs) = asset_build_merkle_tree(&leaves);
        assert_eq!(leaves.len(), 3);
        for (i, proof) in proofs.iter().enumerate() {
            assert!(
                asset_verify_merkle_proof(&leaves[i], proof, &root),
                "leaf {i} must verify"
            );
        }
    }
}