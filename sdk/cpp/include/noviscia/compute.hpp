// SPDX-License-Identifier: Apache-2.0
// Noviscia C++ SDK — compute / validation helpers mirroring the Rust twin's
// free functions (`noviscia-capacity-sdk`, `noviscia-asset-engine-sdk`,
// `noviscia-types`).
//
// u128 intermediate math is provided by the small `U128` type below (no
// compiler extensions), so every formula truncates identically to the Rust
// `u128` implementation: floor division, `max`/`min` floors, and `as u64`
// truncation.

#pragma once

#include "noviscia/ids.hpp"
#include "noviscia/types.hpp"

#include <cstdint>
#include <stdexcept>

namespace noviscia {

// ── U128 (64x64 → 128 multiply, 128/64 floor divide) ────────────────────────

struct U128 {
    std::uint64_t hi = 0;
    std::uint64_t lo = 0;

    static constexpr U128 from_u64(std::uint64_t v) noexcept { return U128{0, v}; }
    static constexpr U128 add(const U128& a, const U128& b) noexcept {
        const std::uint64_t lo = a.lo + b.lo;
        return U128{a.hi + b.hi + (lo < a.lo ? 1u : 0u), lo};
    }
    static constexpr U128 sub(const U128& a, const U128& b) noexcept {
        const std::uint64_t lo = a.lo - b.lo;
        return U128{a.hi - b.hi - (a.lo < b.lo ? 1u : 0u), lo};
    }
    static constexpr U128 add_one(const U128& a) noexcept {
        return U128{a.hi + (a.lo == 0xffff'ffff'ffff'ffff ? 1u : 0u), a.lo + 1u};
    }
    static constexpr U128 sub_one(const U128& a) noexcept {
        return U128{a.hi - (a.lo == 0 ? 1u : 0u), a.lo - 1u};
    }
    constexpr U128 halve() const noexcept { return U128{hi >> 1, (lo >> 1) | ((hi & 1) << 63)}; }

    // 64x64 → 128 multiplication (Rust `a as u128 * b as u128`).
    static U128 mul(std::uint64_t a, std::uint64_t b) noexcept {
        const std::uint64_t a0 = a & 0xffff'ffff, a1 = a >> 32;
        const std::uint64_t b0 = b & 0xffff'ffff, b1 = b >> 32;
        const std::uint64_t p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0, p11 = a1 * b1;
        const std::uint64_t d0 = p00 & 0xffff'ffff;
        const std::uint64_t d1 = (p00 >> 32) + (p01 & 0xffff'ffff) + (p10 & 0xffff'ffff);
        const std::uint64_t d2 = (p01 >> 32) + (p10 >> 32) + (p11 & 0xffff'ffff) + (d1 >> 32);
        const std::uint64_t d3 = (p11 >> 32) + (d2 >> 32);
        return U128{(d3 << 32) | (d2 & 0xffff'ffff), (d1 << 32) | d0};
    }

    // Self × u64, exact. Returns false when the product overflows u128
    // (mirrors Rust `checked_mul(...) == None`).
    bool try_mul_u64(std::uint64_t rhs, U128& out) const noexcept {
        const U128 lo_m = mul(lo, rhs);
        const U128 hi_m = mul(hi, rhs);
        const std::uint64_t rhi = lo_m.hi + hi_m.lo;
        const std::uint64_t carry = rhi < lo_m.hi ? 1u : 0u;
        if (hi_m.hi != 0 || carry != 0) return false;
        out = U128{rhi, lo_m.lo};
        return true;
    }

    // Self × u64 → u128; an overflowing product collapses to {0,0}, mirroring
    // Rust's `checked_mul(...).unwrap_or(0) == 0`.
    U128 mul_u64(std::uint64_t rhs) const noexcept {
        U128 out;
        return try_mul_u64(rhs, out) ? out : U128{0, 0};
    }

    // Floor divide by `rhs` (nonzero), returning the full u128 quotient.
    // Binary search over the solution space; exact under all inputs that fit
    // u128 (the caller's dividends always do).
    U128 div_u64_full(std::uint64_t rhs) const noexcept {
        if (rhs == 0) return U128{0, 0};
        if (hi == 0) return from_u64(lo / rhs);
        U128 best{0, 0};
        U128 lo{0, 0};
        U128 hi = *this;
        while (lo <= hi) {
            const U128 mid = add(lo, add_one(sub(hi, lo)).halve());
            U128 prod{};
            const bool ok = mid.try_mul_u64(rhs, prod) && prod <= *this;
            if (ok) {
                best = mid;
                lo = add_one(mid);
            } else {
                hi = sub_one(mid);
            }
        }
        return best;
    }

    // Low 64 bits of the quotient (Rust `foo as u64` truncation).
    std::uint64_t div_u64(std::uint64_t rhs) const noexcept { return div_u64_full(rhs).lo; }

    constexpr bool operator==(const U128& o) const noexcept { return hi == o.hi && lo == o.lo; }
    constexpr bool operator!=(const U128& o) const noexcept { return !(*this == o); }
    constexpr bool operator<=(const U128& o) const noexcept {
        return hi < o.hi || (hi == o.hi && lo <= o.lo);
    }
};

// ── Admission contract (mirrors `assert_valid_mm_ceiling_usdc`) ─────────────

// Mirrors on-chain `validate_mm_ceiling`: ceiling > 0 and ≤ C_desk.
// Throws std::domain_error on violation (the C++ twin's exception style).
inline void assert_valid_mm_ceiling_usdc(std::uint64_t credit_ceiling_usdc) {
    if (credit_ceiling_usdc == 0) {
        throw std::domain_error("Desk admission rejected: ceiling must be greater than zero");
    }
    if (credit_ceiling_usdc > MAX_MM_CEILING_USDC) {
        throw std::domain_error(
            "Desk admission rejected: ceiling exceeds the single-desk cap C_desk ($1.5M)");
    }
}

// ── Capacity host: dynamic micro-premium (mirrors `compute_premium_bps`) ────

inline std::uint64_t compute_premium_bps(std::uint64_t base_premium_bps,
                                         std::uint64_t premium_cap_bps,
                                         std::uint64_t congestion_multiplier_bps,
                                         std::uint64_t load_ratio_bps,
                                         std::uint64_t tier_multiplier_bps) {
    const std::uint64_t congestion_charge =
        U128::mul(congestion_multiplier_bps, load_ratio_bps).div_u64(BPS);
    const std::uint64_t raw =
        U128::mul(base_premium_bps + congestion_charge, tier_multiplier_bps).div_u64(BPS);
    return raw < premium_cap_bps ? raw : premium_cap_bps;
}

// ── Asset engine: principal micro-premium (mirrors `compute_premium`) ───────

inline std::uint64_t compute_premium(std::uint64_t principal, std::uint16_t base_premium_rate_bps,
                                     std::uint64_t min_premium_lamports) {
    const std::uint64_t bps_premium =
        U128::mul(principal, base_premium_rate_bps).div_u64(BPS);
    return bps_premium < min_premium_lamports ? min_premium_lamports : bps_premium;
}

// ── Asset engine: per-block late-fee meter (mirrors `compute_late_fee`) ─────

inline std::uint64_t compute_late_fee(std::uint64_t principal, std::uint64_t overdue_blocks) {
    if (overdue_blocks == 0) return 0;
    const U128 accrued = U128::mul(principal, LATE_FEE_RATE_BPS).mul_u64(overdue_blocks);
    return accrued.div_u64(BPS * LATE_FEE_BASE);
}

// ── Asset engine: 24h floating-window posture (mirrors `window_posture`) ────

inline WindowPosture window_posture(std::uint64_t window_start_slot, std::uint64_t current_slot) {
    if (window_start_slot == 0) return WindowPosture::NoWindow;
    const std::uint64_t mature = window_start_slot + WINDOW_SLOTS;
    if (current_slot < mature) return WindowPosture::Open;
    if (current_slot < mature + GRACE_SLOTS) return WindowPosture::Overdue;
    return WindowPosture::Breached;
}

// ── Asset engine: ERC-4626 LP share math (mirrors on-chain ledger) ──────────

// Shares minted for `deposit` at the current share price; 1:1 on first deposit.
inline std::uint64_t compute_deposit_shares(std::uint64_t deposit, std::uint64_t total_shares,
                                            std::uint64_t total_assets) {
    if (deposit == 0) return 0;
    if (total_shares == 0 || total_assets == 0) return deposit;
    return U128::mul(deposit, total_shares).div_u64(total_assets);
}

// Native assets returned for `shares` at the current price (caps at assets).
inline std::uint64_t compute_lp_withdraw_value(std::uint64_t shares, std::uint64_t total_shares,
                                               std::uint64_t total_assets) {
    if (shares == 0 || total_shares == 0) return 0;
    const std::uint64_t value = U128::mul(shares, total_assets).div_u64(total_shares);
    return value < total_assets ? value : total_assets;
}

// Scaled per-share price (×1_000_000) — the auto-compounding readout (u128).
inline U128 compute_lp_share_price(std::uint64_t total_shares, std::uint64_t total_assets) {
    if (total_shares == 0) return U128::from_u64(LP_PRICE_SCALE);
    return U128::mul(total_assets, LP_PRICE_SCALE).div_u64_full(total_shares);
}

}  // namespace noviscia