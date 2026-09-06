// SPDX-License-Identifier: Apache-2.0
// Noviscia C++ SDK — hash primitives.
//
// Self-contained SHA-256 and Keccak-256. Both match the digest algorithms the
// on-chain programs depend on:
//   - SHA-256  → Anchor instruction discriminators + Solana PDA derivation.
//   - Keccak-256 (original padding, NOT SHA3-256) → credit-line Merkle KYC
//     leaves / sorted-pair proof nodes (`keccak256(institution ‖ expiry_BE)`),
//     and the capacity host's operator/tier/expiry leaf.
//
// No allocations, no exceptions: fixed stack buffers throughout.

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <span>

namespace noviscia {

// ── SHA-256 ────────────────────────────────────────────────────────────────

constexpr std::size_t SHA256_DIGEST_LEN = 32;

// Compute SHA-256 over `data`, returning the 32-byte digest.
std::array<std::uint8_t, SHA256_DIGEST_LEN> sha256(std::span<const std::uint8_t> data) noexcept;

// ── Keccak-256 ─────────────────────────────────────────────────────────────

constexpr std::size_t KECCAK256_DIGEST_LEN = 32;

// Compute Keccak-256 over `data`, returning the 32-byte digest. Uses the
// original Keccak padding byte 0x01 (not SHA3's 0x06) — matches the
// `keccak256` used by asset_engine.rs / capacity lib.rs.
std::array<std::uint8_t, KECCAK256_DIGEST_LEN> keccak256(std::span<const std::uint8_t> data) noexcept;

}  // namespace noviscia