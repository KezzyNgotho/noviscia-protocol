//! # Noviscia Types
//!
//! Shared types, PDA seed constants, and program IDs used across all Noviscia
//! SDK crates. Mirrors the on-chain account layouts from the active programs.

use anchor_lang::prelude::*;

// ── PDA Seed Constants ──────────────────────────────────────────────────────

/// Pool config PDA seed (`noviscia-permissioned-pool`).
pub const POOL_SEED: &[u8] = b"pool";
/// Pool vault PDA seed (token custody).
pub const POOL_VAULT_SEED: &[u8] = b"pool-vault";
/// LP entry PDA seed.
pub const LP_ENTRY_SEED: &[u8] = b"lp-entry";
/// LP mint PDA seed.
pub const LP_MINT_SEED: &[u8] = b"lp-mint";
/// Insurance reserve PDA seed.
pub const INSURANCE_SEED: &[u8] = b"insurance";

/// Credit line ledger PDA seed (`noviscia-credit-line`).
pub const CREDIT_LINE_SEED: &[u8] = b"credit-line";
/// Alpha-sleeve USDC vault PDA seed.
pub const CREDIT_VAULT_SEED: &[u8] = b"credit-vault";
/// Toll staging vault PDA seed (90% before omni-pool sweep).
pub const TOLL_VAULT_SEED: &[u8] = b"toll-vault";
/// Per-borrower registry PDA seed.
pub const BORROWER_SEED: &[u8] = b"borrower";

/// Position PDA seed (`position-tracker`).
pub const POSITION_SEED: &[u8] = b"position";
/// Collateral vault PDA seed.
pub const COLLATERAL_VAULT_SEED: &[u8] = b"collateral-vault";
/// Pt-config PDA seed.
pub const PT_CONFIG_SEED: &[u8] = b"pt-config";

// ── Program IDs (Devnet) ───────────────────────────────────────────────────

/// Position tracker program (devnet).
pub const POSITION_TRACKER_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws");
/// Escrow program (devnet).
pub const ESCROW_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("2WPb3wsyp4G6zFPx8sTYf3bTDyySxwpo1Ja8H6RCHXCZ");
/// Credit line program (devnet).
pub const CREDIT_LINE_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("8usJu6agjifCXYwSsRVoMWqm22h2HUSfebw1zEEHAMYg");
/// nv-usdc-vault omni-pool program (devnet).
pub const NV_USDC_VAULT_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC");
/// Burn engine program (devnet).
pub const BURN_ENGINE_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id");
/// Staking manager program (devnet).
pub const STAKING_MANAGER_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("HjxcKV51A7jxE2iqMCDY7EvWFL9XsheuM43DamWGabqb");
/// Netting engine program (devnet).
pub const NETTING_ENGINE_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56");
/// Liquidation vault program (devnet).
pub const LIQUIDATION_VAULT_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("Cwma3FfMKhoLkgfrGYgErVPoFWEtHpx7DNc4wArpRHBz");
/// JIT risk marketplace program (devnet).
pub const JIT_RISK_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("3w9GrHBXpMNSc3P3kBWmHwkhEr1u5FBQrTiD4k3NAXwh");
/// Gateway auction program (devnet).
pub const GATEWAY_AUCTION_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("HQ26VTfoBVmGFY1JsFp5HmMT3rjLNoLJH6zurm8TL9xR");
/// Sovereign netting program (devnet).
pub const SOVEREIGN_NETTING_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("9YxL2Gk3cphCjxeKgfj2cnY4wCBDzej3L83jLGJ52Dyk");

/// USDC devnet mint.
pub const USDC_MINT: Pubkey =
    solana_program::pubkey!("Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5");
/// NVSC devnet governance token mint.
pub const NVSC_MINT: Pubkey =
    solana_program::pubkey!("4BXiDT5o9J6aQdJNd36QE1L2YvQqedEKSP1wuQdSgJkg");
/// nvscUSDC devnet yield-bearing share token mint.
pub const NVSCUSDC_MINT: Pubkey =
    solana_program::pubkey!("2TmaUey4Hh2om1kFR77Vw1RDh8H69qcW6UAACVidJeVk");

// ── Numeric Constants ──────────────────────────────────────────────────────

/// BPS denominator (10_000 = 100%).
pub const BPS: u64 = 10_000;
/// BPS denominator as u128 for intermediate math.
pub const BPS_U128: u128 = 10_000;
/// WAD (1e12) — per-slot premium rate for jit-risk.
pub const WAD: u128 = 1_000_000_000_000;
/// Share of each credit-line toll routed to the omni-pool (LP NAV). 9000 = 90%.
pub const LP_NAV_SPLIT_BPS: u64 = 9_000;
/// Share of each credit-line toll routed to the system treasury. 1000 = 10%.
pub const TREASURY_SPLIT_BPS: u64 = 1_000;

// ── Enums ──────────────────────────────────────────────────────────────────

/// KYC tier for an LP in the permissioned pool.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
#[repr(u8)]
pub enum LpTier {
    /// Standard retail (limited allocation, 5% of pool).
    #[default]
    Retail = 0,
    /// Accredited investor (higher allocation, 20% of pool).
    Accredited = 1,
    /// Full institutional (unlimited allocation, 100% of pool).
    Institutional = 2,
}

impl LpTier {
    /// Maximum deposit allocation in bps of total pool shares.
    pub fn max_deposit_bps(self) -> u64 {
        match self {
            LpTier::Retail => 500,
            LpTier::Accredited => 2_000,
            LpTier::Institutional => 10_000,
        }
    }
}

/// Position side — long or short.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
#[repr(u8)]
pub enum Side {
    #[default]
    Long = 0,
    Short = 1,
}

// ── On-Chain Account Layouts ───────────────────────────────────────────────

/// The credit line ledger. One per program — the shared alpha sleeve.
///
/// Mirrors `noviscia-credit-line` `CreditLine` account layout.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct CreditLine {
    pub authority: Pubkey,
    pub toll_recipient: Pubkey,
    pub usdc_mint: Pubkey,
    /// Dynamic toll floor (bps). Applied at zero utilization.
    pub base_toll_bps: u64,
    /// Dynamic toll ceiling (bps). Applied at 100% utilization.
    pub max_toll_bps: u64,
    /// Upper bound on a single borrower's outstanding draw (USDC base-6).
    pub borrower_cap: u64,
    /// Upper bound on the whole line's total outstanding (USDC base-6).
    pub global_outstanding_cap: u64,
    /// Protocol-wide amount currently drawn but not yet settled.
    pub total_outstanding: u64,
    pub bump: u8,
    pub credit_vault_bump: u8,
    pub toll_vault_bump: u8,
}

impl CreditLine {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 1;
}

/// A whitelisted borrower's registry entry.
///
/// Mirrors `noviscia-credit-line` `Borrower` account layout.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct Borrower {
    pub owner: Pubkey,
    /// Whether the desk is permitted to draw credit.
    pub authorized: bool,
    /// Per-borrower hard ceiling (USDC base-6).
    pub credit_limit: u64,
    /// Amount currently drawn but not yet settled (USDC base-6).
    pub outstanding: u64,
    pub bump: u8,
}

impl Borrower {
    pub const SPACE: usize = 8 + 32 + 1 + 8 + 8 + 1;
}

/// Permissioned pool configuration.
///
/// Mirrors `noviscia-permissioned-pool` `PoolConfig` account layout.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct PoolConfig {
    pub authority: Pubkey,
    /// Human-readable pool label (e.g. "SOL-USDC Institutional").
    pub label: [u8; 32],
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    /// When true, only KYC-verified LPs can deposit/withdraw.
    pub kyc_required: bool,
    /// keccak256 merkle root of the LP whitelist.
    pub kyc_merkle_root: [u8; 32],
    /// Trading fee in bps (0-100).
    pub fee_bps: u64,
    /// Portion of fees routed to insurance reserve (bps of fee).
    pub insurance_cut_bps: u64,
    /// Total LP shares outstanding.
    pub total_shares: u64,
    /// Total base token reserves.
    pub base_reserve: u64,
    /// Total quote token reserves.
    pub quote_reserve: u64,
    /// Number of active LPs.
    pub lp_count: u64,
    /// When true, deposits are paused.
    pub is_paused: bool,
    pub bump: u8,
    pub vault_bump: u8,
    pub lp_mint_bump: u8,
    pub insurance_bump: u8,
}

impl PoolConfig {
    pub const SPACE: usize = 8
        + 32   // authority
        + 32   // label
        + 32   // base_mint
        + 32   // quote_mint
        + 1    // kyc_required
        + 32   // kyc_merkle_root
        + 8    // fee_bps
        + 8    // insurance_cut_bps
        + 8    // total_shares
        + 8    // base_reserve
        + 8    // quote_reserve
        + 8    // lp_count
        + 1    // is_paused
        + 1    // bump
        + 1    // vault_bump
        + 1    // lp_mint_bump
        + 1;   // insurance_bump
}

/// Per-LP entry in a permissioned pool.
///
/// Mirrors `noviscia-permissioned-pool` `LpEntry` account layout.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct LpEntry {
    pub wallet: Pubkey,
    /// keccak256(wallet || tier || expiry) — verified against pool's merkle root.
    pub kyc_hash: [u8; 32],
    /// When this KYC verification was completed (unix timestamp).
    pub verified_at: i64,
    /// When this KYC verification expires (unix timestamp). 0 = never.
    pub expires_at: i64,
    /// KYC tier determining allocation limits.
    pub tier: LpTier,
    /// Number of LP shares this wallet holds.
    pub shares: u64,
    /// Whether this LP is currently active.
    pub is_active: bool,
    pub bump: u8,
}

impl LpEntry {
    pub const SPACE: usize = 8
        + 32   // wallet
        + 32   // kyc_hash
        + 8    // verified_at
        + 8    // expires_at
        + 1    // tier
        + 8    // shares
        + 1    // is_active
        + 1;   // bump
}

/// Dynamic toll result mirroring the TypeScript `TollResult` and on-chain
/// `toll_and_utilization` output.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TollResult {
    /// The computed toll amount (USDC base-6).
    pub toll_amount: u64,
    /// Effective toll rate in bps.
    pub rate_bps: u64,
    /// Current utilization in bps (0..=10_000).
    pub utilization_bps: u64,
    /// 90% share routed to the omni-pool (LP NAV).
    pub lp_share: u64,
    /// 10% share routed to the system treasury.
    pub treasury_share: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lp_tier_max_deposit_bps() {
        assert_eq!(LpTier::Retail.max_deposit_bps(), 500);
        assert_eq!(LpTier::Accredited.max_deposit_bps(), 2_000);
        assert_eq!(LpTier::Institutional.max_deposit_bps(), 10_000);
    }

    #[test]
    fn credit_line_space_matches_constant() {
        assert_eq!(
            CreditLine::SPACE,
            8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 1
        );
    }

    #[test]
    fn borrower_space_matches_constant() {
        assert_eq!(Borrower::SPACE, 8 + 32 + 1 + 8 + 8 + 1);
    }

        #[test]
    fn pool_config_space_matches_constant() {
        assert_eq!(
            PoolConfig::SPACE,
            8 + 32 + 32 + 32 + 32 + 1 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 1 + 1 + 1
        );
    }

    #[test]
    fn lp_entry_space_matches_constant() {
        assert_eq!(LpEntry::SPACE, 8 + 32 + 32 + 8 + 8 + 1 + 8 + 1 + 1);
    }

    #[test]
    fn actual_serialized_sizes_sans_discriminator() {
        assert_eq!(PoolConfig::default().try_to_vec().unwrap().len(), 214);
        assert_eq!(LpEntry::default().try_to_vec().unwrap().len(), 91);
        assert_eq!(CreditLine::default().try_to_vec().unwrap().len(), 139);
        assert_eq!(Borrower::default().try_to_vec().unwrap().len(), 50);
    }
}
