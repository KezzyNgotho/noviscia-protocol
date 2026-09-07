// SPDX-License-Identifier: Apache-2.0
// Noviscia C++ SDK — domain types mirroring `sdk/rust/noviscia-types` and the
// npm twin (`sdk/src/assetEngine.ts`, `sdk/src/jitRisk.ts`).
//
// Plain value types + the `SPACE` byte-layout constants the Rust twin exposes.
// Field order matches the exact `#[derive(Accounts)]` layouts for parity.

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace noviscia {

// ── Institutional client tier (Capacity Engine) ───────────────────────────

enum class ClientTier : std::uint8_t {
    TierOne = 0,
    TierTwo = 1,
};

// ── Asset parameters + standardized profiles (Asset Engine) ────────────────

// Per-asset plan used by `asset_register` / `asset_update_params`.
struct AssetParams {
    std::uint8_t decimals = 0;
    std::uint16_t base_premium_rate_bps = 0;
    std::uint16_t premium_cap_bps = 0;
    std::uint64_t max_capacity = 0;
    std::uint64_t min_premium_lamports = 0;
    // BPS of paid premium credited to LPs (compounds their share value).
    std::uint16_t lp_yield_split_bps = 0;
};

// Standard NVSC project-token profile (9 decimals, VAULT-scale tokens, no min premium).
inline constexpr AssetParams NVSC_PROFILE{9, 30, 500, 100'000'000'000'000, 0, 9'000};
// Standard USDC profile (6 decimals, fast-cash pool, tighter ceiling).
inline constexpr AssetParams USDC_PROFILE{6, 8, 250, 5'000'000'000'000, 0, 9'000};
// Standard wSOL profile (9 decimals, native-interop).
inline constexpr AssetParams WSOL_PROFILE{9, 12, 300, 100'000'000'000, 0, 9'000};

// ── Window posture (Asset Engine credit line) ──────────────────────────────

// Deterministic posture of a desk's 24h floating window at some clock slot.
enum class WindowPosture {
    NoWindow,
    Open,
    Overdue,
    Breached,
};

// ── Account-shape domain types (mirror noviscia-types `SPACE` layouts) ─────

// Global asset engine configuration — stores the three-tier Layered
// Governance multi-sig keys (Squads PDAs) that gate every authority path.
struct AssetEngineRegistry {
    std::array<std::uint8_t, 32> breaker_authority{};
    std::array<std::uint8_t, 32> risk_committee_authority{};
    std::array<std::uint8_t, 32> upgrade_authority{};
    std::array<std::uint8_t, 32> wsol_mint{};
    std::array<std::uint8_t, 32> usdc_mint{};
    std::array<std::uint8_t, 32> nvsc_mint{};
    std::uint8_t supported_count = 0;
    bool paused = false;
    std::uint8_t bump = 0;

    static constexpr std::size_t SPACE = 8 + 32 * 3 + 32 * 3 + 3;
};

// Per-mint pool profile: liquidity, premium params, and capacity ceiling.
struct AssetPool {
    std::array<std::uint8_t, 32> mint{};
    std::uint8_t pool_bump = 0;
    std::array<std::uint8_t, 32> vault{};
    std::array<std::uint8_t, 32> fee_vault{};
    std::array<std::uint8_t, 32> vault_authority{};
    std::uint8_t decimals = 0;
    bool supported = false;
    std::uint64_t total_idle_capital = 0;
    std::uint64_t active_credit_utilization = 0;
    std::uint16_t base_premium_rate_bps = 0;
    std::uint16_t premium_cap_bps = 0;
    std::uint64_t min_premium_lamports = 0;
    std::uint64_t max_capacity = 0;
    // ERC-4626 share-mint for this pool (nUSDC / nSOL / nNVSC).
    std::array<std::uint8_t, 32> lp_mint{};
    std::uint64_t total_lp_shares = 0;
    std::uint16_t lp_yield_split_bps = 0;

    static constexpr std::size_t SPACE =
        8 + 32 + 1 + 32 + 32 + 32 + 1 + 1 + 8 + 8 + 2 + 2 + 8 + 8 + 32 + 8 + 2;
};

// Aggregate institutional multi-asset credit ceiling + 24h floating window.
struct InstitutionalCreditLine {
    std::array<std::uint8_t, 32> institution{};
    std::array<std::uint8_t, 32> authority{};
    std::uint64_t total_credit_limit = 0;
    std::uint64_t active_utilization = 0;
    // Provider-agnostic Merkle KYC root for this desk (keccak leaves).
    std::array<std::uint8_t, 32> kyc_merkle_root{};
    // Slot that opened the current 24h floating window (0 = none open).
    std::uint64_t window_start_slot = 0;
    // Highest active_utilization reached during the current window.
    std::uint64_t peak_active_utilization = 0;
    // Running micro-premium taxi meter (accrued, settled at window close).
    std::uint64_t accumulated_premiums = 0;
    // Unix timestamp of the last daily settlement (ledger reset).
    std::int64_t last_settlement_timestamp = 0;
    bool frozen = false;
    std::uint8_t bump = 0;

    static constexpr std::size_t SPACE = 8 + 32 + 32 + 8 + 8 + 32 + 8 + 8 + 8 + 8 + 1 + 1;
};

// Per-desk borrow mirror for one mint — principal out + settled premiums.
struct DeskPosition {
    std::array<std::uint8_t, 32> institution{};
    std::array<std::uint8_t, 32> mint{};
    // Principal currently checked out of this mint's pool vault.
    std::uint64_t active_principal = 0;
    // Premium accrued this window in this mint (native-asset settlement).
    std::uint64_t accumulated_premiums = 0;
    // Daily invoices settled to date.
    std::uint64_t settled_invoices = 0;
    std::uint8_t bump = 0;

    static constexpr std::size_t SPACE = 8 + 32 + 32 + 8 + 8 + 8 + 1;
};

}  // namespace noviscia