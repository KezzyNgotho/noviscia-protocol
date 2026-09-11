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
/// Credit line program (devnet) — now aliases the consolidated `netting-engine`
/// host (19→4 consolidation: the standalone `noviscia-credit-line` was absorbed
/// at Stage 3; see `docs/FROZEN.md` + `docs/CONSOLIDATION.md` §7). PDAs derive
/// under the host ID.
pub const CREDIT_LINE_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56");
/// nv-usdc-vault omni-pool program (devnet).
pub const NV_USDC_VAULT_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("5fmZJ4XsMfQpnM1wMH6DW5KNBAgCQF88762xtDEb94ST");
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
/// JIT risk marketplace program (devnet) — now aliases the consolidated
/// `noviscia-capacity` host (19→4 consolidation: the standalone `jit-risk` was
/// absorbed at Stage 2; see `docs/FROZEN.md` + `docs/CONSOLIDATION.md` §7).
/// PDAs derive under the host ID.
pub const JIT_RISK_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("EDBr2VFWweFDzKR4cTT5j3TPGvPd9imoP8F76YK1o9oe");
/// Gateway auction program (devnet).
pub const GATEWAY_AUCTION_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("HQ26VTfoBVmGFY1JsFp5HmMT3rjLNoLJH6zurm8TL9xR");
/// Sovereign netting program (devnet) — now aliases the consolidated
/// `netting-engine` host (19→4 consolidation: the standalone `sovereign-netting`
/// was absorbed at Stage 3; see `docs/FROZEN.md` + `docs/CONSOLIDATION.md` §7).
/// PDAs derive under the host ID.
pub const SOVEREIGN_NETTING_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56");

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

// ── Capacity Engine (noviscia-capacity) ────────────────────────────────────

/// Capacity engine config PDA seed.
pub const CAPACITY_SEED: &[u8] = b"capacity";
/// Congestion oracle PDA seed.
pub const CONGESTION_SEED: &[u8] = b"congestion";
/// Client account PDA seed.
pub const CLIENT_SEED: &[u8] = b"client";
/// Per-slot ledger PDA seed.
pub const SLOT_LEDGER_SEED: &[u8] = b"slot-ledger";
/// Treasury token account PDA seed.
pub const TREASURY_SEED: &[u8] = b"treasury";
/// Treasury authority PDA seed (owner of the token account).
pub const TREASURY_AUTH_SEED: &[u8] = b"treasury-auth";

/// On-chain program ID for `noviscia-capacity` (devnet).
pub const CAPACITY_PROGRAM_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("EDBr2VFWweFDzKR4cTT5j3TPGvPd9imoP8F76YK1o9oe");

/// Institutional client tier.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
#[repr(u8)]
pub enum ClientTier {
    #[default]
    TierOne = 0,
    TierTwo = 1,
}

/// Global capacity engine configuration.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct CapacityConfig {
    pub authority: Pubkey,
    pub guard_authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub kyc_merkle_root: [u8; 32],
    pub base_premium_bps: u64,
    pub premium_cap_bps: u64,
    pub congestion_multiplier_bps: u64,
    pub min_premium_lamports: u64,
    pub paused: bool,
    pub bump: u8,
}

impl CapacityConfig {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 1;
}

/// Network congestion oracle feeding the dynamic premium model.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct CongestionOracle {
    pub load_ratio_bps: u64,
    pub cu_consumed: u64,
    pub cu_capacity: u64,
    pub updated_slot: u64,
    pub bump: u8,
}

impl CongestionOracle {
    pub const SPACE: usize = 8 + 8 + 8 + 8 + 8 + 1;
}

/// Registered institutional client.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct ClientAccount {
    pub operator: Pubkey,
    pub authority: Pubkey,
    pub tier: ClientTier,
    pub premium_multiplier_bps: u64,
    pub credit_limit: u64,
    pub active_utilization: u64,
    pub available_balance: u64,
    pub margin_posted: u64,
    pub frozen: bool,
    pub bump: u8,
}

impl ClientAccount {
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 8 + 8 + 8 + 8 + 8 + 1 + 1;

    pub fn capacity_budget(&self) -> u64 {
        self.credit_limit
            .saturating_add(self.margin_posted)
            .saturating_sub(self.active_utilization)
    }
}

/// Per-slot capacity ledger.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct SlotLedger {
    pub client: Pubkey,
    pub slot: u64,
    pub capacity_granted: u64,
    pub utilized: u64,
    pub premium_paid: u64,
    pub settled: bool,
    pub bump: u8,
}

impl SlotLedger {
    pub const SPACE: usize = 8 + 32 + 8 + 8 + 8 + 8 + 1 + 1;
}

// ── Asset Engine (noviscia-asset-engine) ───────────────────────────────────

/// Global engine registry PDA seed.
pub const ASSET_REGISTRY_SEED: &[u8] = b"asset-registry";
/// Per-asset pool PDA seed.
pub const ASSET_POOL_SEED: &[u8] = b"asset-pool";
/// Per-asset principal vault token-account PDA seed.
pub const ASSET_VAULT_SEED: &[u8] = b"asset-vault";
/// Per-asset premium fee vault token-account PDA seed.
pub const ASSET_FEE_VAULT_SEED: &[u8] = b"asset-fees";
/// PDA authorizing per-asset vault transfers.
pub const ASSET_AUTHORITY_SEED: &[u8] = b"asset-authority";
/// Institutional credit line PDA seed.
pub const ASSET_CREDIT_LINE_SEED: &[u8] = b"credit-line";
/// Per-desk per-mint borrow mirror PDA seed.
pub const DESK_POSITION_SEED: &[u8] = b"desk-position";
/// Per-pool ERC-4626 share-mint (nUSDC / nSOL / nNVSC) PDA seed.
pub const ASSET_LP_MINT_SEED: &[u8] = b"asset-lp-mint";
/// Per-(pool, LP) share-position ledger seed.
pub const ASSET_LP_POSITION_SEED: &[u8] = b"asset-lp-position";
/// Floating KYC/allocation window length (~24h @ 400ms blocks).
pub const WINDOW_SLOTS: u64 = 216_000;
/// Hard-escalation grace window (~2h @ 400ms blocks) before a desk "Breaches".
pub const GRACE_SLOTS: u64 = 18_000;
/// Micro-bps per overdue slot for the per-block late-fee taxi meter.
pub const LATE_FEE_RATE_BPS: u64 = 50;
pub const LATE_FEE_BASE: u64 = 10_000;

/// On-chain program ID for `noviscia-asset-engine` (devnet) — now aliases the
/// consolidated `noviscia-capacity` host (19→4 consolidation: the standalone
/// `noviscia-asset-engine` was absorbed at Stage 2; see `docs/FROZEN.md` +
/// `docs/CONSOLIDATION.md` §7). PDAs derive under the host ID.
pub const ASSET_ENGINE_PROGRAM_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("EDBr2VFWweFDzKR4cTT5j3TPGvPd9imoP8F76YK1o9oe");

/// Wrap-SOL mint (native-interop profile for SOL exposure).
pub const WSOL_MINT: Pubkey =
    anchor_lang::solana_program::pubkey!("So11111111111111111111111111111111111111112");

/// Global asset engine configuration — stores the three-tier Layered
/// Governance multi-sig keys (Squads PDAs) that gate every authority path.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct AssetEngineRegistry {
    /// Tier 1 — Emergency Risk Guard ("The Breaker"), 1-of-3 Squads:
    /// freeze credit lines / pause the allocation loop, and nothing else.
    pub breaker_authority: Pubkey,
    /// Tier 2 — Risk Committee ("Parameter Vault"), 3-of-5 Squads:
    /// credit limits, KYC roots, asset parameters, support tiers.
    pub risk_committee_authority: Pubkey,
    /// Tier 3 — Core Ecosystem Council, 5-of-7 Squads (72h timelock):
    /// register assets, treasury withdrawals, program upgrades.
    pub upgrade_authority: Pubkey,
    pub wsol_mint: Pubkey,
    pub usdc_mint: Pubkey,
    pub nvsc_mint: Pubkey,
    pub supported_count: u8,
    pub paused: bool,
    pub bump: u8,
}

impl AssetEngineRegistry {
    pub const SPACE: usize = 8 + 32 * 3 + 32 * 3 + 3;
}

/// Per-mint pool profile: liquidity, premium params, and capacity ceiling.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct AssetPool {
    pub mint: Pubkey,
    pub pool_bump: u8,
    pub vault: Pubkey,
    pub fee_vault: Pubkey,
    pub vault_authority: Pubkey,
    pub decimals: u8,
    pub supported: bool,
    pub total_idle_capital: u64,
    pub active_credit_utilization: u64,
    pub base_premium_rate_bps: u16,
    pub premium_cap_bps: u16,
    pub min_premium_lamports: u64,
    pub max_capacity: u64,
    /// ERC-4626 share-mint for this pool (nUSDC / nSOL / nNVSC).
    pub lp_mint: Pubkey,
    pub total_lp_shares: u64,
    pub lp_yield_split_bps: u16,
}

impl AssetPool {
    pub const SPACE: usize =
        8 + 32 + 1 + 32 + 32 + 32 + 1 + 1 + 8 + 8 + 2 + 2 + 8 + 8 + 32 + 8 + 2;
}

/// Aggregate institutional multi-asset credit ceiling + 24h floating window.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct InstitutionalCreditLine {
    pub institution: Pubkey,
    pub authority: Pubkey,
    pub total_credit_limit: u64,
    pub active_utilization: u64,
    /// Provider-agnostic Merkle KYC root for this desk (keccak leaves).
    pub kyc_merkle_root: [u8; 32],
    /// Slot that opened the current 24h floating window (0 = none open).
    pub window_start_slot: u64,
    /// Highest active_utilization reached during the current window.
    pub peak_active_utilization: u64,
    /// Running micro-premium taxi meter (accrued, settled at window close).
    pub accumulated_premiums: u64,
    /// Unix timestamp of the last daily settlement (ledger reset).
    pub last_settlement_timestamp: i64,
    pub frozen: bool,
    pub bump: u8,
}

impl InstitutionalCreditLine {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 32 + 8 + 8 + 8 + 8 + 1 + 1;
}

/// Per-desk borrow mirror for one mint — principal out + settled premiums.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct DeskPosition {
    pub institution: Pubkey,
    pub mint: Pubkey,
    /// Principal currently checked out of this mint's pool vault.
    pub active_principal: u64,
    /// Premium accrued this window in this mint (native-asset settlement).
    pub accumulated_premiums: u64,
    /// Daily invoices settled to date.
    pub settled_invoices: u64,
    pub bump: u8,
}

impl DeskPosition {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 1;
}

// ── Tranche Vault (noviscia-tranche-vault) ─────────────────────────────────

/// Dual-tranche vault config PDA seed.
pub const TRANCHES_SEED: &[u8] = b"tranches";
/// Protected tranche ledger/vault seeds.
pub const PROTECTED_VAULT_SEED: &[u8] = b"protected-vault";
/// Institutional tranche ledger/vault seeds.
pub const INSTI_VAULT_SEED: &[u8] = b"insti-vault";
/// Tranche position PDA seed.
pub const TRANCHE_POSITION_SEED: &[u8] = b"position";

/// On-chain program ID for `noviscia-tranche-vault` (devnet).
pub const TRANCHE_VAULT_PROGRAM_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("9Sk1zLo7uprmtrskoZQS6zf1KFSNv4uTCxMsbqGVMCMb");

/// Tranche discriminator.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
#[repr(u8)]
pub enum Tranche {
    #[default]
    Protected = 0,
    Institutional = 1,
}

/// Per-tranche NAV ledger.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct TrancheVault {
    pub tranche: Tranche,
    pub nav_usdc: u64,
    pub total_shares: u64,
    pub last_accrual_ts: i64,
    pub bump: u8,
}

impl TrancheVault {
    pub const SPACE: usize = 8 + 1 + 8 + 8 + 8 + 1;
}

/// LP position inside a tranche.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct TranchePosition {
    pub owner: Pubkey,
    pub tranche: Tranche,
    pub shares: u64,
    pub bump: u8,
}

impl TranchePosition {
    pub const SPACE: usize = 8 + 32 + 1 + 8 + 1;
}

#[cfg(test)]
mod capacity_tests {
    use super::*;

    #[test]
    fn capacity_client_space_matches_constant() {
        assert_eq!(ClientAccount::SPACE, 8 + 32 + 32 + 1 + 8 + 8 + 8 + 8 + 8 + 1 + 1);
    }

    #[test]
    fn capacity_budget_accounts_margin() {
        let c = ClientAccount {
            credit_limit: 500_000_000,
            margin_posted: 100_000_000,
            active_utilization: 200_000_000,
            ..ClientAccount::default()
        };
        assert_eq!(c.capacity_budget(), 400_000_000);
    }
}
