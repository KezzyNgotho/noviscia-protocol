// SPDX-License-Identifier: Apache-2.0
// Noviscia C++ SDK — instruction construction.
//
// Anchor instruction data layout: 8-byte discriminator
// `sha256("global:<name>")[0..8]`, followed by the borsh-serialized arguments
// (u64/i64 little-endian, fixed [u8;32] as raw bytes, Vec slices prefixed with
// a u32 little-endian length). Account order matches the on-chain `#[derive(Accounts)]`
// contexts exactly (the same order the Rust twin emits).

#pragma once

#include "noviscia/addresses.hpp"
#include "noviscia/hash.hpp"
#include "noviscia/ids.hpp"
#include "noviscia/merkle.hpp"
#include "noviscia/pubkey.hpp"
#include "noviscia/types.hpp"

#include <algorithm>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

namespace noviscia {

struct AccountMeta {
    Pubkey pubkey;
    bool is_signer = false;
    bool is_writable = false;

    bool operator==(const AccountMeta& o) const noexcept {
        return pubkey == o.pubkey && is_signer == o.is_signer && is_writable == o.is_writable;
    }
};

struct Instruction {
    Pubkey program_id;
    std::vector<AccountMeta> accounts;
    std::vector<std::uint8_t> data;
};

// Anchor discriminator: first 8 bytes of sha256("global:" + name).
inline std::array<std::uint8_t, 8> anchor_discriminator(const char* name) {
    const std::string pre = std::string("global:") + name;
    const auto digest = sha256(std::span<const std::uint8_t>(
        reinterpret_cast<const std::uint8_t*>(pre.data()), pre.size()));
    std::array<std::uint8_t, 8> out{};
    std::copy_n(digest.begin(), 8, out.begin());
    return out;
}

namespace detail {

inline void put_le(std::vector<std::uint8_t>& out, std::uint64_t v, int nbytes) {
    for (int i = 0; i < nbytes; ++i) out.push_back(static_cast<std::uint8_t>(v >> (8ull * i)));
}
inline void put_u8(std::vector<std::uint8_t>& out, std::uint8_t v) { out.push_back(v); }
inline void put_u16(std::vector<std::uint8_t>& out, std::uint16_t v) { put_le(out, v, 2); }
inline void put_u32(std::vector<std::uint8_t>& out, std::uint32_t v) { put_le(out, v, 4); }
inline void put_u64(std::vector<std::uint8_t>& out, std::uint64_t v) { put_le(out, v, 8); }
inline void put_i64(std::vector<std::uint8_t>& out, std::int64_t v) {
    put_le(out, static_cast<std::uint64_t>(v), 8);
}
inline void put_bool(std::vector<std::uint8_t>& out, bool v) { out.push_back(v ? 0x01 : 0x00); }
inline void put_pubkey(std::vector<std::uint8_t>& out, const Pubkey& k) {
    out.insert(out.end(), k.bytes.begin(), k.bytes.end());
}
template <std::size_t N>
void put_digest(std::vector<std::uint8_t>& out, const std::array<std::uint8_t, N>& d) {
    out.insert(out.end(), d.begin(), d.end());
}
template <std::size_t N>
void put_array32(std::vector<std::uint8_t>& out, const std::array<std::uint8_t, N>& d) {
    static_assert(N == 32, "fixed [u8;32] only");
    out.insert(out.end(), d.begin(), d.end());
}
inline void put_string(std::vector<std::uint8_t>& out, const std::string& s) {
    put_u32(out, static_cast<std::uint32_t>(s.size()));
    out.insert(out.end(), s.begin(), s.end());
}
inline void put_proof_vec(std::vector<std::uint8_t>& out, std::span<const Digest> proof) {
    put_u32(out, static_cast<std::uint32_t>(proof.size()));
    for (const auto& p : proof) put_digest(out, p);
}
// Borsh Option<T>: 0x00 (None) / 0x01 + payload (Some).
template <typename F>
void put_option(std::vector<std::uint8_t>& out, bool some, F&& encoder) {
    out.push_back(some ? 0x01 : 0x00);
    if (some) encoder(out);
}

inline AccountMeta writable(const Pubkey& k, bool signer = false) {
    return AccountMeta{k, signer, true};
}
inline AccountMeta readonly(const Pubkey& k, bool signer = false) {
    return AccountMeta{k, signer, false};
}

}  // namespace detail

// ── capacity: purchase_capacity ───────────────────────────────────────────

// Account order mirrors the on-chain `PurchaseCapacity`:
// operator(signer) · client · ledger · config · congestion · client_usdc_ata ·
// treasury · token_program.
inline Instruction purchase_capacity(const Pubkey& program_id, const Pubkey& operator_,
                                     const Pubkey& client_usdc_ata, const Pubkey& treasury,
                                     std::uint64_t desired_capacity, std::uint64_t expiry,
                                     std::span<const Digest> merkle_proof) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(operator_, true),
        writable(addresses::client(operator_, program_id).key),
        writable(addresses::slot_ledger(operator_, program_id).key),
        readonly(addresses::config(program_id).key),
        readonly(addresses::congestion(program_id).key),
        writable(client_usdc_ata),
        writable(treasury),
        readonly(ids::TOKEN_PROGRAM),
    };
    auto disc = anchor_discriminator("purchase_capacity");
    ix.data.assign(disc.begin(), disc.end());
    put_u64(ix.data, desired_capacity);
    put_u64(ix.data, expiry);
    put_proof_vec(ix.data, merkle_proof);
    return ix;
}

// ── asset engine: asset_set_kyc_root ──────────────────────────────────────

// registry · risk_committee_authority(signer,writable) · credit_line ·
// institution.
inline Instruction asset_set_kyc_root(const Pubkey& program_id, const Pubkey& risk_committee,
                                      const Pubkey& institution, const Digest& root) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        readonly(addresses::asset_registry(program_id).key),
        writable(risk_committee, true),
        writable(addresses::credit_line(institution, program_id).key),
        readonly(institution),
    };
    auto disc = anchor_discriminator("asset_set_kyc_root");
    ix.data.assign(disc.begin(), disc.end());
    put_array32(ix.data, root);
    return ix;
}

// ── asset engine: asset_allocate_capacity ────────────────────────────────

// pool · pool_vault · vault_authority · credit_line · desk_position ·
// trader(signer) · trader_token_account · fee_vault · token_program ·
// system_program.
inline Instruction asset_allocate_capacity(
    const Pubkey& program_id, const Pubkey& trader, const Pubkey& trader_token_account,
    const Pubkey& mint, std::uint64_t requested_amount, std::uint64_t target_slot,
    std::uint64_t expected_premium, std::uint64_t expiry, std::span<const Digest> merkle_proof) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    const auto cl = addresses::credit_line(trader, program_id).key;
    ix.accounts = {
        writable(addresses::asset_pool(mint, program_id).key),
        writable(addresses::asset_vault(mint, program_id).key),
        readonly(addresses::asset_authority(mint, program_id).key),
        writable(cl),
        writable(addresses::desk_position(trader, mint, program_id).key),
        writable(trader, true),
        writable(trader_token_account),
        writable(addresses::asset_fee_vault(mint, program_id).key),
        readonly(ids::TOKEN_PROGRAM),
        readonly(ids::SYSTEM_PROGRAM),
    };
    auto disc = anchor_discriminator("asset_allocate_capacity");
    ix.data.assign(disc.begin(), disc.end());
    put_u64(ix.data, requested_amount);
    put_u64(ix.data, target_slot);
    put_u64(ix.data, expected_premium);
    put_u64(ix.data, expiry);
    put_proof_vec(ix.data, merkle_proof);
    return ix;
}

// ── jit-risk: risk_register_mm ────────────────────────────────────────────

// marketplace · mm_registration · mm · authority(signer) · system_program.
// Returns nullptr-style control via `ok`? No — ceiling violations throw a
// std::domain_error so a bad ceiling never reaches a submit (mirrors the
// on-chain `validate_mm_ceiling` → C_desk).
inline Instruction risk_register_mm(const Pubkey& program_id, const Pubkey& mm,
                                    std::uint64_t credit_ceiling_usdc, const Pubkey& authority) {
    using namespace detail;
    if (credit_ceiling_usdc == 0) {
        throw std::domain_error("Desk admission rejected: ceiling must be greater than zero");
    }
    if (credit_ceiling_usdc > MAX_MM_CEILING_USDC) {
        throw std::domain_error(
            "Desk admission rejected: ceiling exceeds the single-desk cap C_desk ($1.5M)");
    }
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(addresses::marketplace(program_id).key),
        writable(addresses::mm_registration(mm, program_id).key),
        readonly(mm),
        writable(authority, true),
        readonly(ids::SYSTEM_PROGRAM),
    };
    auto disc = anchor_discriminator("risk_register_mm");
    ix.data.assign(disc.begin(), disc.end());
    put_pubkey(ix.data, mm);
    put_u64(ix.data, credit_ceiling_usdc);
    return ix;
}

// marketplace · mm_registration · mm · authority(signer).
inline Instruction risk_suspend_mm(const Pubkey& program_id, const Pubkey& mm,
                                   const Pubkey& authority) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(addresses::marketplace(program_id).key),
        writable(addresses::mm_registration(mm, program_id).key),
        readonly(mm),
        writable(authority, true),
    };
    auto disc = anchor_discriminator("risk_suspend_mm");
    ix.data.assign(disc.begin(), disc.end());
    put_pubkey(ix.data, mm);
    return ix;
}

inline Instruction risk_activate_mm(const Pubkey& program_id, const Pubkey& mm,
                                    const Pubkey& authority) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(addresses::marketplace(program_id).key),
        writable(addresses::mm_registration(mm, program_id).key),
        readonly(mm),
        writable(authority, true),
    };
    auto disc = anchor_discriminator("risk_activate_mm");
    ix.data.assign(disc.begin(), disc.end());
    put_pubkey(ix.data, mm);
    return ix;
}

// ── capacity: initialize ───────────────────────────────────────────────────

// authority(signer) · guard_authority · config · congestion · treasury ·
// treasury_auth · usdc_mint · system_program · token_program · rent.
inline Instruction initialize(const Pubkey& program_id, const Pubkey& authority,
                              const Pubkey& guard_authority, const Pubkey& usdc_mint,
                              const Pubkey& treasury, const Pubkey& treasury_auth,
                              std::uint64_t base_premium_bps, std::uint64_t premium_cap_bps,
                              std::uint64_t congestion_multiplier_bps,
                              std::uint64_t min_premium_lamports) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(authority, true),
        readonly(guard_authority),
        writable(addresses::config(program_id).key),
        writable(addresses::congestion(program_id).key),
        writable(treasury),
        readonly(treasury_auth),
        readonly(usdc_mint),
        readonly(ids::SYSTEM_PROGRAM),
        readonly(ids::TOKEN_PROGRAM),
        readonly(ids::RENT_PROGRAM),
    };
    auto disc = anchor_discriminator("initialize");
    ix.data.assign(disc.begin(), disc.end());
    put_u64(ix.data, base_premium_bps);
    put_u64(ix.data, premium_cap_bps);
    put_u64(ix.data, congestion_multiplier_bps);
    put_u64(ix.data, min_premium_lamports);
    return ix;
}

// ── capacity: set_kyc_merkle_root ─────────────────────────────────────────

// authority(signer) · config.
inline Instruction set_kyc_merkle_root(const Pubkey& program_id, const Pubkey& authority,
                                       const Digest& new_root) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {writable(authority, true), writable(addresses::config(program_id).key)};
    auto disc = anchor_discriminator("set_kyc_merkle_root");
    ix.data.assign(disc.begin(), disc.end());
    put_array32(ix.data, new_root);
    return ix;
}

// ── capacity: set_pricing ─────────────────────────────────────────────────

// authority(signer) · config.
inline Instruction set_pricing(const Pubkey& program_id, const Pubkey& authority,
                               std::uint64_t base_premium_bps, std::uint64_t premium_cap_bps,
                               std::uint64_t congestion_multiplier_bps,
                               std::uint64_t min_premium_lamports) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {writable(authority, true), writable(addresses::config(program_id).key)};
    auto disc = anchor_discriminator("set_pricing");
    ix.data.assign(disc.begin(), disc.end());
    put_u64(ix.data, base_premium_bps);
    put_u64(ix.data, premium_cap_bps);
    put_u64(ix.data, congestion_multiplier_bps);
    put_u64(ix.data, min_premium_lamports);
    return ix;
}

// ── capacity: update_congestion (keeper-fed) ──────────────────────────────

// keeper(signer) · config · congestion.
inline Instruction update_congestion(const Pubkey& program_id, const Pubkey& keeper,
                                     std::uint64_t load_ratio_bps, std::uint64_t cu_consumed) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(keeper, true),
        readonly(addresses::config(program_id).key),
        writable(addresses::congestion(program_id).key),
    };
    auto disc = anchor_discriminator("update_congestion");
    ix.data.assign(disc.begin(), disc.end());
    put_u64(ix.data, load_ratio_bps);
    put_u64(ix.data, cu_consumed);
    return ix;
}

// ── capacity: register_client ─────────────────────────────────────────────

// operator(signer) · client · ledger · system_program.
inline Instruction register_client(const Pubkey& program_id, const Pubkey& operator_,
                                   ClientTier tier, std::uint64_t credit_limit) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(operator_, true),
        writable(addresses::client(operator_, program_id).key),
        writable(addresses::slot_ledger(operator_, program_id).key),
        readonly(ids::SYSTEM_PROGRAM),
    };
    auto disc = anchor_discriminator("register_client");
    ix.data.assign(disc.begin(), disc.end());
    put_u8(ix.data, static_cast<std::uint8_t>(tier));
    put_u64(ix.data, credit_limit);
    return ix;
}

// ── capacity: update_credit ───────────────────────────────────────────────

// signer(signer) · operator · client.
inline Instruction update_credit(const Pubkey& program_id, const Pubkey& signer,
                                 const Pubkey& operator_, std::uint64_t credit_limit) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(signer, true),
        readonly(operator_),
        writable(addresses::client(operator_, program_id).key),
    };
    auto disc = anchor_discriminator("update_credit");
    ix.data.assign(disc.begin(), disc.end());
    put_u64(ix.data, credit_limit);
    return ix;
}

// ── capacity: deposit_margin / withdraw_margin ────────────────────────────

// signer(signer) · client · operator · client_usdc_ata · treasury ·
// treasury_auth · token_program.
inline Instruction deposit_margin(const Pubkey& program_id, const Pubkey& signer,
                                  const Pubkey& operator_, const Pubkey& client_usdc_ata,
                                  std::uint64_t amount) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(signer, true),
        writable(addresses::client(operator_, program_id).key),
        readonly(operator_),
        writable(client_usdc_ata),
        writable(addresses::treasury(program_id).key),
        readonly(addresses::treasury_auth(program_id).key),
        readonly(ids::TOKEN_PROGRAM),
    };
    auto disc = anchor_discriminator("deposit_margin");
    ix.data.assign(disc.begin(), disc.end());
    put_u64(ix.data, amount);
    return ix;
}

inline Instruction withdraw_margin(const Pubkey& program_id, const Pubkey& signer,
                                   const Pubkey& operator_, const Pubkey& client_usdc_ata,
                                   std::uint64_t amount) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(signer, true),
        writable(addresses::client(operator_, program_id).key),
        readonly(operator_),
        writable(client_usdc_ata),
        writable(addresses::treasury(program_id).key),
        readonly(addresses::treasury_auth(program_id).key),
        readonly(ids::TOKEN_PROGRAM),
    };
    auto disc = anchor_discriminator("withdraw_margin");
    ix.data.assign(disc.begin(), disc.end());
    put_u64(ix.data, amount);
    return ix;
}

// ── capacity: report_utilization / settle_slot / freeze / unfreeze ─────────

// signer(signer) · operator · client · ledger · config.
inline Instruction report_utilization(const Pubkey& program_id, const Pubkey& signer,
                                      const Pubkey& operator_, std::uint64_t cu_used,
                                      std::uint64_t notional) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(signer, true),
        readonly(operator_),
        writable(addresses::client(operator_, program_id).key),
        writable(addresses::slot_ledger(operator_, program_id).key),
        readonly(addresses::config(program_id).key),
    };
    auto disc = anchor_discriminator("report_utilization");
    ix.data.assign(disc.begin(), disc.end());
    put_u64(ix.data, cu_used);
    put_u64(ix.data, notional);
    return ix;
}

inline Instruction settle_slot(const Pubkey& program_id, const Pubkey& signer,
                               const Pubkey& operator_) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(signer, true),
        readonly(operator_),
        writable(addresses::client(operator_, program_id).key),
        writable(addresses::slot_ledger(operator_, program_id).key),
        readonly(addresses::config(program_id).key),
    };
    auto disc = anchor_discriminator("settle_slot");
    ix.data.assign(disc.begin(), disc.end());
    return ix;
}

inline Instruction freeze_client(const Pubkey& program_id, const Pubkey& signer,
                                 const Pubkey& operator_, const std::string& reason) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(signer, true),
        readonly(operator_),
        writable(addresses::client(operator_, program_id).key),
        writable(addresses::slot_ledger(operator_, program_id).key),
        readonly(addresses::config(program_id).key),
    };
    auto disc = anchor_discriminator("freeze_client");
    ix.data.assign(disc.begin(), disc.end());
    put_string(ix.data, reason);
    return ix;
}

inline Instruction unfreeze_client(const Pubkey& program_id, const Pubkey& signer,
                                   const Pubkey& operator_) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(signer, true),
        readonly(operator_),
        writable(addresses::client(operator_, program_id).key),
        writable(addresses::slot_ledger(operator_, program_id).key),
        readonly(addresses::config(program_id).key),
    };
    auto disc = anchor_discriminator("unfreeze_client");
    ix.data.assign(disc.begin(), disc.end());
    return ix;
}

// ── capacity: set_paused / withdraw_treasury ──────────────────────────────

inline Instruction set_paused(const Pubkey& program_id, const Pubkey& authority, bool paused) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {writable(authority, true), writable(addresses::config(program_id).key)};
    auto disc = anchor_discriminator("set_paused");
    ix.data.assign(disc.begin(), disc.end());
    put_bool(ix.data, paused);
    return ix;
}

inline Instruction withdraw_treasury(const Pubkey& program_id, const Pubkey& authority,
                                     const Pubkey& treasury, const Pubkey& treasury_auth,
                                     const Pubkey& destination, std::uint64_t amount) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(authority, true),
        readonly(addresses::config(program_id).key),
        writable(treasury),
        readonly(treasury_auth),
        writable(destination),
        readonly(ids::TOKEN_PROGRAM),
    };
    auto disc = anchor_discriminator("withdraw_treasury");
    ix.data.assign(disc.begin(), disc.end());
    put_u64(ix.data, amount);
    return ix;
}

// ── capacity / asset-engine: default-program conveniences ─────────────────

inline Instruction purchase_capacity_default(const Pubkey& operator_,
                                             const Pubkey& client_usdc_ata,
                                             std::uint64_t desired_capacity,
                                             std::uint64_t expiry,
                                             std::span<const Digest> merkle_proof) {
    return purchase_capacity(ids::HOST, operator_, client_usdc_ata,
                             addresses::treasury(ids::HOST).key, desired_capacity, expiry,
                             merkle_proof);
}

// ── asset engine: asset_initialize ────────────────────────────────────────

// upgrade_authority(signer) · registry · system_program.
// Data: breaker(32) + risk_committee(32) + upgrade(32) + wsol(32) + usdc(32) +
// nvsc(32).
inline Instruction asset_initialize(const Pubkey& program_id, const Pubkey& upgrade_authority,
                                     const Pubkey& breaker_authority,
                                     const Pubkey& risk_committee_authority,
                                     const Pubkey& wsol_mint, const Pubkey& usdc_mint,
                                     const Pubkey& nvsc_mint) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(upgrade_authority, true),
        writable(addresses::asset_registry(program_id).key),
        readonly(ids::SYSTEM_PROGRAM),
    };
    auto disc = anchor_discriminator("initialize");
    ix.data.assign(disc.begin(), disc.end());
    put_pubkey(ix.data, breaker_authority);
    put_pubkey(ix.data, risk_committee_authority);
    put_pubkey(ix.data, upgrade_authority);
    put_pubkey(ix.data, wsol_mint);
    put_pubkey(ix.data, usdc_mint);
    put_pubkey(ix.data, nvsc_mint);
    return ix;
}

// ── asset engine: asset_register ──────────────────────────────────────────

// registry · upgrade_authority(signer) · mint · pool · vault · fee_vault ·
// asset_authority · asset_lp_mint · system_program · token_program · rent.
inline Instruction asset_register(const Pubkey& program_id, const Pubkey& upgrade_authority,
                                  const Pubkey& mint, const AssetParams& params) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(addresses::asset_registry(program_id).key),
        writable(upgrade_authority, true),
        readonly(mint),
        writable(addresses::asset_pool(mint, program_id).key),
        writable(addresses::asset_vault(mint, program_id).key),
        writable(addresses::asset_fee_vault(mint, program_id).key),
        readonly(addresses::asset_authority(mint, program_id).key),
        writable(addresses::asset_lp_mint(mint, program_id).key),
        readonly(ids::SYSTEM_PROGRAM),
        readonly(ids::TOKEN_PROGRAM),
        readonly(ids::RENT_PROGRAM),
    };
    auto disc = anchor_discriminator("asset_register");
    ix.data.assign(disc.begin(), disc.end());
    put_u8(ix.data, params.decimals);
    put_u16(ix.data, params.base_premium_rate_bps);
    put_u16(ix.data, params.premium_cap_bps);
    put_u64(ix.data, params.max_capacity);
    put_u64(ix.data, params.min_premium_lamports);
    put_u16(ix.data, params.lp_yield_split_bps);
    return ix;
}

// ── asset engine: asset_update_params / asset_set_support ─────────────────

// registry · risk_committee_authority(signer) · pool · mint.
inline Instruction asset_update_params(const Pubkey& program_id,
                                       const Pubkey& risk_committee_authority,
                                       const Pubkey& mint, const AssetParams& params) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        readonly(addresses::asset_registry(program_id).key),
        writable(risk_committee_authority, true),
        writable(addresses::asset_pool(mint, program_id).key),
        readonly(mint),
    };
    auto disc = anchor_discriminator("asset_update_params");
    ix.data.assign(disc.begin(), disc.end());
    put_u16(ix.data, params.base_premium_rate_bps);
    put_u16(ix.data, params.premium_cap_bps);
    put_u64(ix.data, params.max_capacity);
    put_u64(ix.data, params.min_premium_lamports);
    put_u16(ix.data, params.lp_yield_split_bps);
    return ix;
}

inline Instruction asset_set_support(const Pubkey& program_id,
                                     const Pubkey& risk_committee_authority, const Pubkey& mint,
                                     bool supported) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        readonly(addresses::asset_registry(program_id).key),
        writable(risk_committee_authority, true),
        writable(addresses::asset_pool(mint, program_id).key),
        readonly(mint),
    };
    auto disc = anchor_discriminator("asset_set_support");
    ix.data.assign(disc.begin(), disc.end());
    put_bool(ix.data, supported);
    return ix;
}

// ── asset engine: asset_initialize_credit_line / asset_update_credit_limit ─

// registry · institution(signer) · risk_committee_authority(signer) ·
// credit_line · system_program.
inline Instruction asset_initialize_credit_line(const Pubkey& program_id,
                                                const Pubkey& institution,
                                                const Pubkey& risk_committee_authority,
                                                std::uint64_t total_credit_limit) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(addresses::asset_registry(program_id).key),
        writable(institution, true),
        writable(risk_committee_authority, true),
        writable(addresses::credit_line(institution, program_id).key),
        readonly(ids::SYSTEM_PROGRAM),
    };
    auto disc = anchor_discriminator("asset_initialize_credit_line");
    ix.data.assign(disc.begin(), disc.end());
    put_u64(ix.data, total_credit_limit);
    return ix;
}

// registry · risk_committee_authority(signer) · credit_line · institution.
inline Instruction asset_update_credit_limit(const Pubkey& program_id,
                                             const Pubkey& risk_committee_authority,
                                             const Pubkey& institution,
                                             std::uint64_t new_limit) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        readonly(addresses::asset_registry(program_id).key),
        writable(risk_committee_authority, true),
        writable(addresses::credit_line(institution, program_id).key),
        readonly(institution),
    };
    auto disc = anchor_discriminator("asset_update_credit_limit");
    ix.data.assign(disc.begin(), disc.end());
    put_u64(ix.data, new_limit);
    return ix;
}

// ── asset engine: asset_set_credit_frozen / asset_set_paused ──────────────

// registry · breaker_authority(signer) · credit_line · institution.
inline Instruction asset_set_credit_frozen(const Pubkey& program_id,
                                           const Pubkey& breaker_authority,
                                           const Pubkey& institution, bool frozen) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        readonly(addresses::asset_registry(program_id).key),
        writable(breaker_authority, true),
        writable(addresses::credit_line(institution, program_id).key),
        readonly(institution),
    };
    auto disc = anchor_discriminator("asset_set_credit_frozen");
    ix.data.assign(disc.begin(), disc.end());
    put_bool(ix.data, frozen);
    return ix;
}

// breaker_authority(signer) · registry.
inline Instruction asset_set_paused(const Pubkey& program_id, const Pubkey& breaker_authority,
                                    bool paused) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {writable(breaker_authority, true),
                   writable(addresses::asset_registry(program_id).key)};
    auto disc = anchor_discriminator("asset_set_paused");
    ix.data.assign(disc.begin(), disc.end());
    put_bool(ix.data, paused);
    return ix;
}

// ── asset engine: asset_recredit_capacity ─────────────────────────────────

// pool · vault · credit_line · desk_position · trader(signer) ·
// trader_token_account · token_program.
inline Instruction asset_recredit_capacity(const Pubkey& program_id, const Pubkey& mint,
                                           const Pubkey& institution, const Pubkey& trader,
                                           const Pubkey& trader_token_account,
                                           std::uint64_t amount) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(addresses::asset_pool(mint, program_id).key),
        writable(addresses::asset_vault(mint, program_id).key),
        writable(addresses::credit_line(institution, program_id).key),
        writable(addresses::desk_position(institution, mint, program_id).key),
        writable(trader, true),
        writable(trader_token_account),
        readonly(ids::TOKEN_PROGRAM),
    };
    auto disc = anchor_discriminator("asset_recredit_capacity");
    ix.data.assign(disc.begin(), disc.end());
    put_u64(ix.data, amount);
    return ix;
}

// ── asset engine: asset_settle_daily ──────────────────────────────────────

// pool · vault · fee_vault · credit_line · desk_position · treasury(signer) ·
// treasury_token_account · token_program.
inline Instruction asset_settle_daily(const Pubkey& program_id, const Pubkey& mint,
                                      const Pubkey& institution, const Pubkey& treasury,
                                      const Pubkey& treasury_token_account,
                                      std::uint64_t principal_payment,
                                      std::uint64_t premium_payment,
                                      std::uint64_t late_fee_payment) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(addresses::asset_pool(mint, program_id).key),
        writable(addresses::asset_vault(mint, program_id).key),
        writable(addresses::asset_fee_vault(mint, program_id).key),
        writable(addresses::credit_line(institution, program_id).key),
        writable(addresses::desk_position(institution, mint, program_id).key),
        writable(treasury, true),
        writable(treasury_token_account),
        readonly(ids::TOKEN_PROGRAM),
    };
    auto disc = anchor_discriminator("asset_settle_daily");
    ix.data.assign(disc.begin(), disc.end());
    put_u64(ix.data, principal_payment);
    put_u64(ix.data, premium_payment);
    put_u64(ix.data, late_fee_payment);
    return ix;
}

// ── asset engine: asset_deposit_liquidity ─────────────────────────────────

// pool · vault · asset_lp_mint · asset_lp_position · asset_authority ·
// provider(signer) · provider_token_account · provider_lp_token_account ·
// token_program · system_program.
inline Instruction asset_deposit_liquidity(const Pubkey& program_id, const Pubkey& mint,
                                           const Pubkey& provider,
                                           const Pubkey& provider_token_account,
                                           const Pubkey& provider_lp_token_account,
                                           std::uint64_t amount) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(addresses::asset_pool(mint, program_id).key),
        writable(addresses::asset_vault(mint, program_id).key),
        writable(addresses::asset_lp_mint(mint, program_id).key),
        writable(addresses::asset_lp_position(mint, provider, program_id).key),
        readonly(addresses::asset_authority(mint, program_id).key),
        writable(provider, true),
        writable(provider_token_account),
        writable(provider_lp_token_account),
        readonly(ids::TOKEN_PROGRAM),
        readonly(ids::SYSTEM_PROGRAM),
    };
    auto disc = anchor_discriminator("asset_deposit_liquidity");
    ix.data.assign(disc.begin(), disc.end());
    put_u64(ix.data, amount);
    return ix;
}

// ── asset engine: asset_withdraw_liquidity ────────────────────────────────

// pool · vault · asset_lp_mint · asset_lp_position · asset_authority ·
// lp(signer) · lp_token_account · destination · token_program.
inline Instruction asset_withdraw_liquidity(const Pubkey& program_id, const Pubkey& mint,
                                            const Pubkey& lp, const Pubkey& lp_token_account,
                                            const Pubkey& destination, std::uint64_t shares) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(addresses::asset_pool(mint, program_id).key),
        writable(addresses::asset_vault(mint, program_id).key),
        readonly(addresses::asset_lp_mint(mint, program_id).key),
        writable(addresses::asset_lp_position(mint, lp, program_id).key),
        readonly(addresses::asset_authority(mint, program_id).key),
        writable(lp, true),
        writable(lp_token_account),
        writable(destination),
        readonly(ids::TOKEN_PROGRAM),
    };
    auto disc = anchor_discriminator("asset_withdraw_liquidity");
    ix.data.assign(disc.begin(), disc.end());
    put_u64(ix.data, shares);
    return ix;
}

// ── asset engine: asset_withdraw_fees ─────────────────────────────────────

// pool · registry · upgrade_authority(signer) · fee_vault · asset_authority ·
// destination · token_program.
inline Instruction asset_withdraw_fees(const Pubkey& program_id,
                                       const Pubkey& upgrade_authority, const Pubkey& mint,
                                       const Pubkey& destination, std::uint64_t amount) {
    using namespace detail;
    Instruction ix{};
    ix.program_id = program_id;
    ix.accounts = {
        writable(addresses::asset_pool(mint, program_id).key),
        readonly(addresses::asset_registry(program_id).key),
        writable(upgrade_authority, true),
        writable(addresses::asset_fee_vault(mint, program_id).key),
        readonly(addresses::asset_authority(mint, program_id).key),
        writable(destination),
        readonly(ids::TOKEN_PROGRAM),
    };
    auto disc = anchor_discriminator("asset_withdraw_fees");
    ix.data.assign(disc.begin(), disc.end());
    put_u64(ix.data, amount);
    return ix;
}

// ── asset engine: default-program conveniences ─────────────────────────────

inline Instruction asset_register_default(const Pubkey& authority, const Pubkey& mint,
                                          const AssetParams& profile) {
    return asset_register(ids::HOST, authority, mint, profile);
}

// One-shot pointer to the wSOL-mint profile (native-interop).
inline Instruction register_wsol_default(const Pubkey& authority, const Pubkey& wsol_mint) {
    return asset_register(ids::HOST, authority, wsol_mint, WSOL_PROFILE);
}

}  // namespace noviscia