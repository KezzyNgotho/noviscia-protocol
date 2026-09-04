//! # Noviscia Capacity
//!
//! Instruction builders for the **noviscia-capacity** on-chain program — the
//! single-slot clearing & risk engine. Includes:
//!
//! - `build_purchase_capacity_ix` — **Transaction A** of the atomic Jito
//!   bundle: Merkle KYC + dynamic premium + slot reservation.
//! - Utilization reporting, slot settlement, and the instant programmatic
//!   credit freeze (`freeze_client`).
//! - keccak256 merkle helpers matching the on-chain layout.

use sha3::{Digest, Keccak256};
use solana_program::instruction::{AccountMeta, Instruction};
use solana_program::pubkey::Pubkey;

use noviscia_types::{
    BPS, CAPACITY_SEED, CLIENT_SEED, ClientTier, CONGESTION_SEED, SLOT_LEDGER_SEED,
    TREASURY_AUTH_SEED, TREASURY_SEED,
};

/// Re-exported `noviscia-capacity` program id for callers.
pub use noviscia_types::CAPACITY_PROGRAM_ID;

// ── Constants ──────────────────────────────────────────────────────────────

/// Maximum merkle tree depth (supports up to 2^20 ≈ 1M verified clients).
pub const MAX_MERKLE_DEPTH: usize = 20;

// ── Anchor Discriminator ───────────────────────────────────────────────────

/// Compute the Anchor instruction discriminator: first 8 bytes of
/// `sha256("global:<instruction_name>")` using Solana's built-in SHA-256.
pub fn anchor_discriminator(name: &str) -> [u8; 8] {
    let preimage = format!("global:{name}");
    let hash = solana_program::hash::hash(preimage.as_bytes());
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash.to_bytes()[..8]);
    disc
}

// ── PDA Derivation ─────────────────────────────────────────────────────────

pub fn config_pda(program_id: &Pubkey) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(&[CAPACITY_SEED], program_id);
    pda
}

pub fn congestion_pda(program_id: &Pubkey) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(&[CONGESTION_SEED], program_id);
    pda
}

pub fn client_pda(program_id: &Pubkey, operator: &Pubkey) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(&[CLIENT_SEED, operator.as_ref()], program_id);
    pda
}

pub fn ledger_pda(program_id: &Pubkey, operator: &Pubkey) -> Pubkey {
    let (pda, _bump) =
        Pubkey::find_program_address(&[SLOT_LEDGER_SEED, operator.as_ref()], program_id);
    pda
}

pub fn treasury_pda(program_id: &Pubkey) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(&[TREASURY_SEED], program_id);
    pda
}

pub fn treasury_auth_pda(program_id: &Pubkey) -> Pubkey {
    let (pda, _bump) = Pubkey::find_program_address(&[TREASURY_AUTH_SEED], program_id);
    pda
}

// ── Merkle KYC (keccak256, mirrors on-chain) ───────────────────────────────

/// keccak256 KYC leaf: `keccak256(operator || tier || expiry)`.
pub fn compute_kyc_hash(operator: &Pubkey, tier: ClientTier, expiry: i64) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(operator.as_ref());
    hasher.update([tier as u8]);
    hasher.update(expiry.to_be_bytes());
    hasher.finalize().into()
}

/// Verify a keccak256 merkle proof.
pub fn verify_merkle_proof(leaf: &[u8; 32], proof: &[[u8; 32]], root: &[u8; 32]) -> bool {
    if root == &[0u8; 32] {
        return false;
    }
    let mut digest = *leaf;
    for sibling in proof {
        let mut h = Keccak256::new();
        let (l, r) = if digest <= *sibling {
            (&digest, sibling)
        } else {
            (sibling, &digest)
        };
        h.update(l);
        h.update(r);
        let out: [u8; 32] = h.finalize().into();
        digest = out;
    }
    digest == *root
}

/// Dynamic micro-premium pricing model (mirrors `compute_premium_bps` on-chain).
pub fn compute_premium_bps(
    base_premium_bps: u64,
    premium_cap_bps: u64,
    congestion_multiplier_bps: u64,
    load_ratio_bps: u64,
    tier_multiplier_bps: u64,
) -> u64 {
    let congestion_charge = (congestion_multiplier_bps as u128)
        .checked_mul(load_ratio_bps as u128)
        .unwrap_or(0)
        .checked_div(BPS as u128)
        .unwrap_or(0);
    let raw = (base_premium_bps as u128)
        .checked_add(congestion_charge)
        .unwrap_or(base_premium_bps as u128)
        .checked_mul(tier_multiplier_bps as u128)
        .unwrap_or(0)
        .checked_div(BPS as u128)
        .unwrap_or(0);
    raw.min(premium_cap_bps as u128) as u64
}

/// Encodes a merkle proof Vec<[u8; 32]> as borsh (u32 len + leaves).
fn append_proof(data: &mut Vec<u8>, proof: &[[u8; 32]]) {
    data.extend_from_slice(&(proof.len() as u32).to_le_bytes());
    for leaf in proof {
        data.extend_from_slice(leaf);
    }
}

/// Appends a borsh string (u32 len + utf8).
fn append_string(data: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    data.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    data.extend_from_slice(bytes);
}

// ── Instruction Builders ───────────────────────────────────────────────────

/// Build `initialize` — creates the engine config, oracle, treasury vault.
pub fn build_initialize_ix(
    program_id: Pubkey,
    authority: Pubkey,
    guard_authority: Pubkey,
    usdc_mint: Pubkey,
    treasury: Pubkey,
    treasury_auth: Pubkey,
    base_premium_bps: u64,
    premium_cap_bps: u64,
    congestion_multiplier_bps: u64,
    min_premium_lamports: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(authority, true),
        AccountMeta::new_readonly(guard_authority, false),
        AccountMeta::new(config_pda(&program_id), false),
        AccountMeta::new(congestion_pda(&program_id), false),
        AccountMeta::new(treasury, false),
        AccountMeta::new_readonly(treasury_auth, false),
        AccountMeta::new_readonly(usdc_mint, false),
        AccountMeta::new_readonly(solana_program::system_program::ID, false),
        AccountMeta::new_readonly(spl_token::ID, false),
        AccountMeta::new_readonly(solana_program::sysvar::rent::ID, false),
    ];
    let mut data = anchor_discriminator("initialize").to_vec();
    data.extend_from_slice(&base_premium_bps.to_le_bytes());
    data.extend_from_slice(&premium_cap_bps.to_le_bytes());
    data.extend_from_slice(&congestion_multiplier_bps.to_le_bytes());
    data.extend_from_slice(&min_premium_lamports.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `set_kyc_merkle_root`.
pub fn build_set_kyc_merkle_root_ix(
    program_id: Pubkey,
    authority: Pubkey,
    new_root: [u8; 32],
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(authority, true),
        AccountMeta::new(config_pda(&program_id), false),
    ];
    let mut data = anchor_discriminator("set_kyc_merkle_root").to_vec();
    data.extend_from_slice(&new_root);
    Instruction { program_id, accounts, data }
}

/// Build `set_pricing`.
pub fn build_set_pricing_ix(
    program_id: Pubkey,
    authority: Pubkey,
    base_premium_bps: u64,
    premium_cap_bps: u64,
    congestion_multiplier_bps: u64,
    min_premium_lamports: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(authority, true),
        AccountMeta::new(config_pda(&program_id), false),
    ];
    let mut data = anchor_discriminator("set_pricing").to_vec();
    data.extend_from_slice(&base_premium_bps.to_le_bytes());
    data.extend_from_slice(&premium_cap_bps.to_le_bytes());
    data.extend_from_slice(&congestion_multiplier_bps.to_le_bytes());
    data.extend_from_slice(&min_premium_lamports.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `update_congestion` (keeper-fed).
pub fn build_update_congestion_ix(
    program_id: Pubkey,
    keeper: Pubkey,
    load_ratio_bps: u64,
    cu_consumed: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(keeper, true),
        AccountMeta::new_readonly(config_pda(&program_id), false),
        AccountMeta::new(congestion_pda(&program_id), false),
    ];
    let mut data = anchor_discriminator("update_congestion").to_vec();
    data.extend_from_slice(&load_ratio_bps.to_le_bytes());
    data.extend_from_slice(&cu_consumed.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `register_client`.
pub fn build_register_client_ix(
    program_id: Pubkey,
    operator: Pubkey,
    tier: ClientTier,
    credit_limit: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(operator, true),
        AccountMeta::new(client_pda(&program_id, &operator), false),
        AccountMeta::new(ledger_pda(&program_id, &operator), false),
        AccountMeta::new_readonly(solana_program::system_program::ID, false),
    ];
    let mut data = anchor_discriminator("register_client").to_vec();
    data.push(tier as u8);
    data.extend_from_slice(&credit_limit.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `update_credit`.
pub fn build_update_credit_ix(
    program_id: Pubkey,
    signer: Pubkey,
    operator: Pubkey,
    credit_limit: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(signer, true),
        AccountMeta::new_readonly(operator, false),
        AccountMeta::new(client_pda(&program_id, &operator), false),
    ];
    let mut data = anchor_discriminator("update_credit").to_vec();
    data.extend_from_slice(&credit_limit.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `deposit_margin`.
pub fn build_deposit_margin_ix(
    program_id: Pubkey,
    signer: Pubkey,
    operator: Pubkey,
    client_usdc_ata: Pubkey,
    amount: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(signer, true),
        AccountMeta::new(client_pda(&program_id, &operator), false),
        AccountMeta::new_readonly(operator, false),
        AccountMeta::new(client_usdc_ata, false),
        AccountMeta::new(treasury_pda(&program_id), false),
        AccountMeta::new_readonly(treasury_auth_pda(&program_id), false),
        AccountMeta::new_readonly(spl_token::ID, false),
    ];
    let mut data = anchor_discriminator("deposit_margin").to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `withdraw_margin`.
pub fn build_withdraw_margin_ix(
    program_id: Pubkey,
    signer: Pubkey,
    operator: Pubkey,
    client_usdc_ata: Pubkey,
    amount: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(signer, true),
        AccountMeta::new(client_pda(&program_id, &operator), false),
        AccountMeta::new_readonly(operator, false),
        AccountMeta::new(client_usdc_ata, false),
        AccountMeta::new(treasury_pda(&program_id), false),
        AccountMeta::new_readonly(treasury_auth_pda(&program_id), false),
        AccountMeta::new_readonly(spl_token::ID, false),
    ];
    let mut data = anchor_discriminator("withdraw_margin").to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `purchase_capacity` — **Transaction A** of the atomic bundle.
///
/// Account order mirrors the on-chain `PurchaseCapacity` context:
/// 0. operator (signer)
/// 1. client (mut)
/// 2. ledger (mut)
/// 3. config
/// 4. oracle
/// 5. client_usdc_ata (mut)
/// 6. treasury (mut)
/// 7. token_program
pub fn build_purchase_capacity_ix(
    program_id: Pubkey,
    operator: Pubkey,
    client_usdc_ata: Pubkey,
    treasury: Pubkey,
    desired_capacity: u64,
    expiry: i64,
    merkle_proof: Vec<[u8; 32]>,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(operator, true),
        AccountMeta::new(client_pda(&program_id, &operator), false),
        AccountMeta::new(ledger_pda(&program_id, &operator), false),
        AccountMeta::new_readonly(config_pda(&program_id), false),
        AccountMeta::new_readonly(congestion_pda(&program_id), false),
        AccountMeta::new(client_usdc_ata, false),
        AccountMeta::new(treasury, false),
        AccountMeta::new_readonly(spl_token::ID, false),
    ];
    let mut data = anchor_discriminator("purchase_capacity").to_vec();
    data.extend_from_slice(&desired_capacity.to_le_bytes());
    data.extend_from_slice(&expiry.to_le_bytes());
    append_proof(&mut data, &merkle_proof);
    Instruction { program_id, accounts, data }
}

/// Build `report_utilization`.
pub fn build_report_utilization_ix(
    program_id: Pubkey,
    signer: Pubkey,
    operator: Pubkey,
    cu_used: u64,
    notional: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(signer, true),
        AccountMeta::new_readonly(operator, false),
        AccountMeta::new(client_pda(&program_id, &operator), false),
        AccountMeta::new(ledger_pda(&program_id, &operator), false),
        AccountMeta::new_readonly(config_pda(&program_id), false),
    ];
    let mut data = anchor_discriminator("report_utilization").to_vec();
    data.extend_from_slice(&cu_used.to_le_bytes());
    data.extend_from_slice(&notional.to_le_bytes());
    Instruction { program_id, accounts, data }
}

/// Build `settle_slot`.
pub fn build_settle_slot_ix(
    program_id: Pubkey,
    signer: Pubkey,
    operator: Pubkey,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(signer, true),
        AccountMeta::new_readonly(operator, false),
        AccountMeta::new(client_pda(&program_id, &operator), false),
        AccountMeta::new(ledger_pda(&program_id, &operator), false),
        AccountMeta::new_readonly(config_pda(&program_id), false),
    ];
    Instruction {
        program_id,
        accounts,
        data: anchor_discriminator("settle_slot").to_vec(),
    }
}

/// Build `freeze_client` — instant programmatic credit freeze.
pub fn build_freeze_client_ix(
    program_id: Pubkey,
    signer: Pubkey,
    operator: Pubkey,
    reason: &str,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(signer, true),
        AccountMeta::new_readonly(operator, false),
        AccountMeta::new(client_pda(&program_id, &operator), false),
        AccountMeta::new(ledger_pda(&program_id, &operator), false),
        AccountMeta::new_readonly(config_pda(&program_id), false),
    ];
    let mut data = anchor_discriminator("freeze_client").to_vec();
    append_string(&mut data, reason);
    Instruction { program_id, accounts, data }
}

/// Build `unfreeze_client`.
pub fn build_unfreeze_client_ix(
    program_id: Pubkey,
    signer: Pubkey,
    operator: Pubkey,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(signer, true),
        AccountMeta::new_readonly(operator, false),
        AccountMeta::new(client_pda(&program_id, &operator), false),
        AccountMeta::new(ledger_pda(&program_id, &operator), false),
        AccountMeta::new_readonly(config_pda(&program_id), false),
    ];
    Instruction {
        program_id,
        accounts,
        data: anchor_discriminator("unfreeze_client").to_vec(),
    }
}

/// Build `set_paused`.
pub fn build_set_paused_ix(program_id: Pubkey, authority: Pubkey, paused: bool) -> Instruction {
    let accounts = vec![
        AccountMeta::new(authority, true),
        AccountMeta::new(config_pda(&program_id), false),
    ];
    let mut data = anchor_discriminator("set_paused").to_vec();
    data.push(paused as u8);
    Instruction { program_id, accounts, data }
}

/// Build `withdraw_treasury`.
pub fn build_withdraw_treasury_ix(
    program_id: Pubkey,
    authority: Pubkey,
    treasury: Pubkey,
    treasury_auth: Pubkey,
    destination: Pubkey,
    amount: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(authority, true),
        AccountMeta::new_readonly(config_pda(&program_id), false),
        AccountMeta::new(treasury, false),
        AccountMeta::new_readonly(treasury_auth, false),
        AccountMeta::new(destination, false),
        AccountMeta::new_readonly(spl_token::ID, false),
    ];
    let mut data = anchor_discriminator("withdraw_treasury").to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction { program_id, accounts, data }
}

// ── Default program convenience ────────────────────────────────────────────

/// Build a `purchase_capacity` instruction against the devnet program id.
pub fn purchase_capacity_default(
    operator: Pubkey,
    client_usdc_ata: Pubkey,
    desired_capacity: u64,
    expiry: i64,
    merkle_proof: Vec<[u8; 32]>,
) -> Instruction {
    build_purchase_capacity_ix(
        CAPACITY_PROGRAM_ID,
        operator,
        client_usdc_ata,
        treasury_pda(&CAPACITY_PROGRAM_ID),
        desired_capacity,
        expiry,
        merkle_proof,
    )
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn premium_matches_onchain_formula() {
        assert_eq!(compute_premium_bps(10, 200, 200, 0, BPS), 10);
        assert_eq!(compute_premium_bps(10, 500, 200, 5_000, BPS), 110);
        assert_eq!(compute_premium_bps(10, 150, 200, BPS, BPS), 150);
        assert_eq!(compute_premium_bps(10, 500, 200, 5_000, 5_000), 55);
    }

    #[test]
    fn kyc_hash_is_deterministic_and_tier_sensitive() {
        let k = Pubkey::new_unique();
        let a = compute_kyc_hash(&k, ClientTier::TierOne, 100);
        let b = compute_kyc_hash(&k, ClientTier::TierOne, 100);
        let c = compute_kyc_hash(&k, ClientTier::TierTwo, 100);
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn merkle_proof_verifies() {
        let a = Pubkey::new_unique();
        let b = Pubkey::new_unique();
        let la = compute_kyc_hash(&a, ClientTier::TierOne, 100);
        let lb = compute_kyc_hash(&b, ClientTier::TierOne, 100);
        let mut h = Keccak256::new();
        let (l, r) = if la <= lb { (&la, &lb) } else { (&lb, &la) };
        h.update(l);
        h.update(r);
        let root: [u8; 32] = h.finalize().into();
        assert!(verify_merkle_proof(&la, &[lb], &root));
        assert!(!verify_merkle_proof(&la, &[[0u8; 32]], &root));
    }

    #[test]
    fn purchase_ix_encodes_args_and_accounts() {
        let operator = Pubkey::new_unique();
        let ata = Pubkey::new_unique();
        let proof = vec![[7u8; 32]];
        let ix = purchase_capacity_default(operator, ata, 1_000_000, 1_700_000_000, proof.clone());
        assert_eq!(ix.program_id, CAPACITY_PROGRAM_ID);
        assert_eq!(ix.accounts.len(), 8);
        let body = &ix.data[8..];
        // capacity u64 + expiry i64 (LE) + vec len u32 + 32-byte leaf
        assert_eq!(body.len(), 8 + 8 + 4 + 32);
        assert_eq!(
            &ix.data[8..16],
            &1_000_000u64.to_le_bytes(),
            "capacity encoded first"
        );
        assert_eq!(ix.accounts[0].pubkey, operator);
        assert!(ix.accounts[0].is_signer);
    }

    #[test]
    fn pda_derivations_are_stable() {
        let program = CAPACITY_PROGRAM_ID;
        let op = Pubkey::new_unique();
        assert_ne!(client_pda(&program, &op), ledger_pda(&program, &op));
        assert_ne!(treasury_pda(&program), treasury_auth_pda(&program));
    }
}