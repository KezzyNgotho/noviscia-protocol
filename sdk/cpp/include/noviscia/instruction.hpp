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

inline void put_u64(std::vector<std::uint8_t>& out, std::uint64_t v) {
    for (int i = 0; i < 8; ++i) out.push_back(static_cast<std::uint8_t>(v >> (8ull * i)));
}
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
inline void put_proof_vec(std::vector<std::uint8_t>& out, std::span<const Digest> proof) {
    const auto n = static_cast<std::uint32_t>(proof.size());
    for (int i = 0; i < 4; ++i) out.push_back(static_cast<std::uint8_t>(n >> (8ull * i)));
    for (const auto& p : proof) put_digest(out, p);
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
        readonly(addresses::client(operator_, program_id).key),
        readonly(addresses::slot_ledger(operator_, program_id).key),
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

}  // namespace noviscia