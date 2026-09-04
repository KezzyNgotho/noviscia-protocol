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

use noviscia_types::{
    ASSET_AUTHORITY_SEED, ASSET_CREDIT_LINE_SEED, ASSET_ENGINE_PROGRAM_ID, ASSET_FEE_VAULT_SEED,
    ASSET_POOL_SEED, ASSET_REGISTRY_SEED, ASSET_VAULT_SEED, DESK_POSITION_SEED,
};

pub use noviscia_types::{AssetEngineRegistry, AssetPool, DeskPosition, InstitutionalCreditLine};

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

/// Per-asset plan used by `register_asset`.
#[derive(Clone, Copy, Debug)]
pub struct AssetParams {
    pub decimals: u8,
    pub base_premium_rate_bps: u16,
    pub premium_cap_bps: u16,
    pub max_capacity: u64,
    pub min_premium_lamports: u64,
}

/// Standard NVSC project-token profile (9 decimals, VAULT-scale tokens, no min premium).
pub const NVSC_PROFILE: AssetParams = AssetParams {
    decimals: 9,
    base_premium_rate_bps: 30,
    premium_cap_bps: 500,
    max_capacity: 100_000_000_000_000,
    min_premium_lamports: 0,
};

/// Standard USDC profile (6 decimals, fast-cash pool, tighter ceiling).
pub const USDC_PROFILE: AssetParams = AssetParams {
    decimals: 6,
    base_premium_rate_bps: 8,
    premium_cap_bps: 250,
    max_capacity: 5_000_000_000_000,
    min_premium_lamports: 0,
};

/// Standard wSOL profile (9 decimals, native-interop).
pub const WSOL_PROFILE: AssetParams = AssetParams {
    decimals: 9,
    base_premium_rate_bps: 12,
    premium_cap_bps: 300,
    max_capacity: 100_000_000_000,
    min_premium_lamports: 0,
};

// ── Instruction Builders ───────────────────────────────────────────────────

/// Build `initialize` — pins the platform mints + guard authority.
#[allow(clippy::too_many_arguments)]
pub fn build_initialize_ix(
    program_id: Pubkey,
    authority: Pubkey,
    guard_authority: Pubkey,
    wsol_mint: Pubkey,
    usdc_mint: Pubkey,
    nvsc_mint: Pubkey,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(authority, true),
        AccountMeta::new(registry_pda(&program_id), false),
        AccountMeta::new_readonly(solana_program::system_program::ID, false),
    ];
    let mut data = anchor_discriminator("initialize").to_vec();
    data.extend_from_slice(guard_authority.as_ref());
    data.extend_from_slice(wsol_mint.as_ref());
    data.extend_from_slice(usdc_mint.as_ref());
    data.extend_from_slice(nvsc_mint.as_ref());
    Instruction { program_id, accounts, data }
}

/// Build `register_asset` — onboards a mint into the token register.
#[allow(clippy::too_many_arguments)]
pub fn build_register_asset_ix(
    program_id: Pubkey,
    authority: Pubkey,
    mint: Pubkey,
    params: AssetParams,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(registry_pda(&program_id), false),
        AccountMeta::new(authority, true),
        AccountMeta::new_readonly(mint, false),
        AccountMeta::new(asset_pool_pda(&program_id, &mint), false),
        AccountMeta::new(asset_vault_pda(&program_id, &mint), false),
        AccountMeta::new(asset_fee_vault_pda(&program_id, &mint), false),
        AccountMeta::new_readonly(asset_authority_pda(&program_id, &mint), false),
        AccountMeta::new_readonly(solana_program::system_program::ID, false),
        AccountMeta::new_readonly(spl_token::ID, false),
        AccountMeta::new_readonly(RENT_ID, false),
    ];
    let mut data = anchor_discriminator("register_asset").to_vec();
    data.push(params.decimals);
    data.extend_from_slice(&params.base_premium_rate_bps.to_le_bytes());
    data.extend_from_slice(&params.premium_cap_bps.to_le_bytes());
    data.extend_from_slice(&params.max_capacity.to_le_bytes());
    data.extend_from_slice(&params.min_premium_lamports.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `update_asset_params` — adjusts a registered asset's parameters.
pub fn build_update_asset_params_ix(
    program_id: Pubkey,
    authority: Pubkey,
    mint: Pubkey,
    params: AssetParams,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new_readonly(registry_pda(&program_id), false),
        AccountMeta::new(authority, true),
        AccountMeta::new(asset_pool_pda(&program_id, &mint), false),
        AccountMeta::new_readonly(mint, false),
    ];
    let mut data = anchor_discriminator("update_asset_params").to_vec();
    data.extend_from_slice(&params.base_premium_rate_bps.to_le_bytes());
    data.extend_from_slice(&params.premium_cap_bps.to_le_bytes());
    data.extend_from_slice(&params.max_capacity.to_le_bytes());
    data.extend_from_slice(&params.min_premium_lamports.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `set_asset_support` — toggles an asset's registration latch.
pub fn build_set_asset_support_ix(
    program_id: Pubkey,
    authority: Pubkey,
    mint: Pubkey,
    supported: bool,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new_readonly(registry_pda(&program_id), false),
        AccountMeta::new(authority, true),
        AccountMeta::new(asset_pool_pda(&program_id, &mint), false),
        AccountMeta::new_readonly(mint, false),
    ];
    let mut data = anchor_discriminator("set_asset_support").to_vec();
    data.push(supported as u8);
    Instruction { program_id, accounts, data }
}

/// Build `initialize_credit_line` — registers an institution's aggregate
/// multi-asset credit ceiling.
pub fn build_initialize_credit_line_ix(
    program_id: Pubkey,
    institution: Pubkey,
    authority: Pubkey,
    total_credit_limit: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(institution, true),
        AccountMeta::new(authority, true),
        AccountMeta::new(credit_line_pda(&program_id, &institution), false),
        AccountMeta::new_readonly(solana_program::system_program::ID, false),
    ];
    let mut data = anchor_discriminator("initialize_credit_line").to_vec();
    data.extend_from_slice(&total_credit_limit.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `update_credit_limit` — adjusts the aggregate ceiling.
pub fn build_update_credit_limit_ix(
    program_id: Pubkey,
    authority: Pubkey,
    institution: Pubkey,
    new_limit: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(authority, true),
        AccountMeta::new(credit_line_pda(&program_id, &institution), false),
        AccountMeta::new_readonly(institution, false),
    ];
    let mut data = anchor_discriminator("update_credit_limit").to_vec();
    data.extend_from_slice(&new_limit.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `set_credit_frozen` — freezes an institution's credit line.
pub fn build_set_credit_frozen_ix(
    program_id: Pubkey,
    authority: Pubkey,
    institution: Pubkey,
    frozen: bool,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new_readonly(registry_pda(&program_id), false),
        AccountMeta::new(authority, true),
        AccountMeta::new(credit_line_pda(&program_id, &institution), false),
        AccountMeta::new_readonly(institution, false),
    ];
    let mut data = anchor_discriminator("set_credit_frozen").to_vec();
    data.push(frozen as u8);
    Instruction { program_id, accounts, data }
}

/// Build `set_paused` — engine-level allocation pause.
pub fn build_set_paused_ix(program_id: Pubkey, authority: Pubkey, paused: bool) -> Instruction {
    let accounts = vec![
        AccountMeta::new(authority, true),
        AccountMeta::new(registry_pda(&program_id), false),
    ];
    let mut data = anchor_discriminator("set_paused").to_vec();
    data.push(paused as u8);
    Instruction { program_id, accounts, data }
}

/// Build `allocate_asset_capacity` — the Multi-Asset JIT Allocation core.
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
    let mut data = anchor_discriminator("allocate_asset_capacity").to_vec();
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

/// Build `recredit_asset_capacity` — releases unused slot capital.
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
    let mut data = anchor_discriminator("recredit_asset_capacity").to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `set_kyc_root` — posts a desk's provider-agnostic Merkle root.
pub fn build_set_kyc_root_ix(
    program_id: Pubkey,
    authority: Pubkey,
    institution: Pubkey,
    kyc_merkle_root: [u8; 32],
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(authority, true),
        AccountMeta::new(credit_line_pda(&program_id, &institution), false),
        AccountMeta::new_readonly(institution, false),
    ];
    let mut data = anchor_discriminator("set_kyc_root").to_vec();
    data.extend_from_slice(&kyc_merkle_root);
    Instruction { program_id, accounts, data }
}

/// Build `settle_daily` — Phase 3 daily clearing house settlement.
///
/// The desk treasury returns the exact native asset:
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
    let mut data = anchor_discriminator("settle_daily").to_vec();
    data.extend_from_slice(&principal_payment.to_le_bytes());
    data.extend_from_slice(&premium_payment.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `deposit_asset_liquidity` — LP seeds a pool vault in native asset.
pub fn build_deposit_asset_liquidity_ix(
    program_id: Pubkey,
    mint: Pubkey,
    provider: Pubkey,
    provider_token_account: Pubkey,
    amount: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(asset_pool_pda(&program_id, &mint), false),
        AccountMeta::new(asset_vault_pda(&program_id, &mint), false),
        AccountMeta::new(provider, true),
        AccountMeta::new(provider_token_account, false),
        AccountMeta::new_readonly(spl_token::ID, false),
    ];
    let mut data = anchor_discriminator("deposit_asset_liquidity").to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `withdraw_asset_liquidity` — engine/guard authority returns idle PDP capital.
pub fn build_withdraw_asset_liquidity_ix(
    program_id: Pubkey,
    authority: Pubkey,
    mint: Pubkey,
    destination: Pubkey,
    amount: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(registry_pda(&program_id), false),
        AccountMeta::new(authority, true),
        AccountMeta::new(asset_pool_pda(&program_id, &mint), false),
        AccountMeta::new(asset_vault_pda(&program_id, &mint), false),
        AccountMeta::new_readonly(asset_authority_pda(&program_id, &mint), false),
        AccountMeta::new(destination, false),
        AccountMeta::new_readonly(spl_token::ID, false),
    ];
    let mut data = anchor_discriminator("withdraw_asset_liquidity").to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `withdraw_asset_fees` — sweeps a per-asset fee vault.
pub fn build_withdraw_asset_fees_ix(
    program_id: Pubkey,
    authority: Pubkey,
    mint: Pubkey,
    destination: Pubkey,
    amount: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(asset_pool_pda(&program_id, &mint), false),
        AccountMeta::new(authority, true),
        AccountMeta::new(asset_fee_vault_pda(&program_id, &mint), false),
        AccountMeta::new_readonly(asset_authority_pda(&program_id, &mint), false),
        AccountMeta::new(destination, false),
        AccountMeta::new_readonly(spl_token::ID, false),
    ];
    let mut data = anchor_discriminator("withdraw_asset_fees").to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction { program_id, accounts, data }
}

// ── Default program convenience ────────────────────────────────────────────

pub fn register_asset_default(authority: Pubkey, mint: Pubkey, profile: AssetParams) -> Instruction {
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
        );
        assert_eq!(&settle.data[..8], &anchor_discriminator("settle_daily"));
        assert_eq!(settle.accounts.len(), 8);
        assert_eq!(settle.accounts[0].pubkey, asset_pool_pda(&ASSET_ENGINE_PROGRAM_ID, &mint));
        assert_eq!(settle.accounts[4].pubkey, desk_position_pda(&ASSET_ENGINE_PROGRAM_ID, &institution, &mint));
        assert_eq!(settle.accounts[5].pubkey, treasury);
        assert!(settle.accounts[5].is_signer);

        // set_kyc_root carries the 32-byte root and references the credit line.
        let root = [42u8; 32];
        let kyc = build_set_kyc_root_ix(ASSET_ENGINE_PROGRAM_ID, Pubkey::new_unique(), institution, root);
        assert_eq!(&kyc.data[..8], &anchor_discriminator("set_kyc_root"));
        assert_eq!(&kyc.data[8..40], &root);
        assert_eq!(
            kyc.accounts[1].pubkey,
            credit_line_pda(&ASSET_ENGINE_PROGRAM_ID, &institution)
        );

        // Liquidity builders hit the vault pair + change the idle ledger.
        let depositor = Pubkey::new_unique();
        let pool_ata = Pubkey::new_unique();
        let dep = build_deposit_asset_liquidity_ix(
            ASSET_ENGINE_PROGRAM_ID, mint, depositor, pool_ata, 2_000_000_000,
        );
        assert_eq!(dep.accounts[1].pubkey, asset_vault_pda(&ASSET_ENGINE_PROGRAM_ID, &mint));
        assert_eq!(dep.accounts.len(), 5);

        let wd = build_withdraw_asset_liquidity_ix(
            ASSET_ENGINE_PROGRAM_ID, Pubkey::new_unique(), mint, Pubkey::new_unique(), 1_000,
        );
        assert_eq!(wd.accounts[0].pubkey, registry_pda(&ASSET_ENGINE_PROGRAM_ID));
        assert_eq!(wd.accounts.len(), 7);
    }

    #[test]
    fn register_ix_lays_out_the_five_asset_pdas() {
        let mint = Pubkey::new_unique();
        let authority = Pubkey::new_unique();
        let ix = build_register_asset_ix(ASSET_ENGINE_PROGRAM_ID, authority, mint, USDC_PROFILE);
        assert_eq!(ix.accounts.len(), 10);
        let pool = asset_pool_pda(&ASSET_ENGINE_PROGRAM_ID, &mint);
        let vault = asset_vault_pda(&ASSET_ENGINE_PROGRAM_ID, &mint);
        let fee_vault = asset_fee_vault_pda(&ASSET_ENGINE_PROGRAM_ID, &mint);
        assert_eq!(ix.accounts[3].pubkey, pool);
        assert_eq!(ix.accounts[4].pubkey, vault);
        assert_eq!(ix.accounts[5].pubkey, fee_vault);
        assert_ne!(pool, vault);
        assert_ne!(vault, fee_vault);
        // decimals byte then bps/capacity args
        assert_eq!(ix.data[8], USDC_PROFILE.decimals);
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
        assert_eq!(&ix.data[..8], &anchor_discriminator("set_paused"));
        assert_eq!(ix.data.len(), 9);
        assert_eq!(
            noviscia_types::WSOL_MINT.to_string().starts_with("So111"),
            true
        );
    }
}