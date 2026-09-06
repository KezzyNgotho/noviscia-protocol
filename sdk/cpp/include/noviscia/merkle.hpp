// SPDX-License-Identifier: Apache-2.0
// Noviscia C++ SDK — Merkle KYC helpers.
//
// Mirrors the on-chain verification in asset_engine.rs (`asset_compute_kyc_hash`,
// `asset_keccak256_pair`, `asset_verify_merkle_proof`) and capacity lib.rs
// (`compute_kyc_hash`, `verify_merkle_proof`).
//
// The credit-line leaf is `keccak256(institution ‖ expiry_BE)` — NO tier byte —
// which deliberately differs from the capacity host's
// `keccak256(operator ‖ tier ‖ expiry)`. Expiry is committed into the leaf:
// expiration is enforced by root rotation, not a wall-clock on-chain check.

#pragma once

#include "noviscia/hash.hpp"
#include "noviscia/pubkey.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <span>
#include <vector>

namespace noviscia {

constexpr std::size_t LEAF_LEN = 32;
using Digest = std::array<std::uint8_t, 32>;

// Encode a 64-bit value big-endian (for expiry in leaves).
inline std::array<std::uint8_t, 8> be64_bytes(std::uint64_t v) noexcept {
    std::array<std::uint8_t, 8> out{};
    for (int i = 0; i < 8; ++i) {
        out[7 - i] = static_cast<std::uint8_t>(v >> (8ull * i));
    }
    return out;
}

// keccak256(institution ‖ expiry_BE) — asset-engine credit-line leaf.
inline Digest asset_kyc_hash(const Pubkey& institution, std::uint64_t expiry) noexcept {
    std::array<std::uint8_t, PUBKEY_LEN + 8> input{};
    std::copy(institution.bytes.begin(), institution.bytes.end(), input.begin());
    const auto exp = be64_bytes(expiry);
    std::copy(exp.begin(), exp.end(), input.begin() + PUBKEY_LEN);
    Digest out;
    const auto h = keccak256(input);
    std::copy(h.begin(), h.end(), out.begin());
    return out;
}

// keccak256(operator ‖ [tier] ‖ expiry_BE) — capacity host client leaf.
inline Digest capacity_kyc_hash(const Pubkey& operator_, std::uint8_t tier,
                                std::uint64_t expiry) noexcept {
    std::array<std::uint8_t, PUBKEY_LEN + 1 + 8> input{};
    std::copy(operator_.bytes.begin(), operator_.bytes.end(), input.begin());
    input[PUBKEY_LEN] = tier;
    const auto exp = be64_bytes(expiry);
    std::copy(exp.begin(), exp.end(), input.begin() + PUBKEY_LEN + 1);
    Digest out;
    const auto h = keccak256(input);
    std::copy(h.begin(), h.end(), out.begin());
    return out;
}

// Sorted-pair keccak: keccak256(min(a,b) ‖ max(a,b)) — matches
// `asset_keccak256_pair` / capacity `keccak256_pair` (sort BEFORE hashing).
inline Digest keccak_pair(const Digest& a, const Digest& b) noexcept {
    const bool a_le_b = std::lexicographical_compare(a.begin(), a.end(), b.begin(), b.end());
    std::array<std::uint8_t, 64> input{};
    auto& first = a_le_b ? a : b;
    auto& second = a_le_b ? b : a;
    std::copy(first.begin(), first.end(), input.begin());
    std::copy(second.begin(), second.end(), input.begin() + 32);
    Digest out;
    const auto h = keccak256(input);
    std::copy(h.begin(), h.end(), out.begin());
    return out;
}

// Verify a sorted-pair merkle proof against `root`; returns false when the
// root is all zeros (unset) — mirrors `asset_verify_merkle_proof`.
inline bool verify_merkle_proof(const Digest& leaf, std::span<const Digest> proof,
                                const Digest& root) noexcept {
    const bool unset = std::all_of(root.begin(), root.end(), [](std::uint8_t b) { return b == 0; });
    if (unset) return false;
    Digest digest = leaf;
    for (const auto& sibling : proof) {
        digest = keccak_pair(digest, sibling);
    }
    return digest == root;
}

// Build a deterministic sorted-pair merkle root (duplicates the last leaf for
// odd counts). Matches `assetBuildKycMerkleTree` / `asset_build_merkle_tree`.
inline Digest merkle_root(std::span<const Digest> leaves) noexcept {
    std::vector<Digest> level(leaves.begin(), leaves.end());
    while (level.size() > 1) {
        std::vector<Digest> next;
        next.reserve((level.size() + 1) / 2);
        for (std::size_t i = 0; i < level.size(); i += 2) {
            const auto& right = (i + 1 < level.size()) ? level[i + 1] : level[i];
            next.push_back(keccak_pair(level[i], right));
        }
        level = std::move(next);
    }
    return level.empty() ? Digest{} : level[0];
}

}  // namespace noviscia