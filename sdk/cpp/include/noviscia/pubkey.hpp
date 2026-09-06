// SPDX-License-Identifier: Apache-2.0
// Noviscia C++ SDK — Pubkey, base58, and Solana PDA derivation.
//
// `find_program_address` reproduces the runtime's bump search: iterate bump
// 255 → 0, hash `seeds ‖ program_id ‖ [bump]` with SHA-256, and accept the
// first digest that is NOT a valid ed25519 point (off-curve → the private key
// cannot exist). Depends only on noviscia::sha256 and noviscia::ed25519_is_on_curve.

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace noviscia {

constexpr std::size_t PUBKEY_LEN = 32;

// A 32-byte Solana public key.
struct Pubkey {
    std::array<std::uint8_t, PUBKEY_LEN> bytes{};

    static constexpr std::size_t SIZE = PUBKEY_LEN;

    bool operator==(const Pubkey& o) const noexcept { return bytes == o.bytes; }
    bool operator!=(const Pubkey& o) const noexcept { return !(*this == o); }
    // Lexicographic byte order (matches Solana's default ordering).
    bool operator<(const Pubkey& o) const noexcept { return bytes < o.bytes; }

    std::span<const std::uint8_t, PUBKEY_LEN> data() const noexcept { return bytes; }
    std::span<std::uint8_t, PUBKEY_LEN> data() noexcept { return bytes; }
};

// Base58 encode/decode. The decode path is constant-length (targets a
// 32-byte Pubkey); encode returns a heap string for display convenience.
std::string base58_encode(std::span<const std::uint8_t> data);
bool base58_decode(std::string_view text, Pubkey& out);

inline std::string to_base58(const Pubkey& key) { return base58_encode(key.bytes); }
// Returns false on malformed input; leaves `out` untouched.
inline bool from_base58(std::string_view s, Pubkey& out) { return base58_decode(s, out); }

// SHA-256 of seed components + bump + program id + the "ProgramDerivedAddress"
// salt tag (modern PDA scheme, matching the Solana runtime and web3.js):
//   sha256(seeds[0] ‖ … ‖ seeds[n] ‖ [bump] ‖ program_id ‖ "ProgramDerivedAddress")
// Returns the program address and its bump, or std::nullopt if no bump
// (0..=255) yields an off-curve address (vanishingly rare in practice).
std::optional<std::pair<Pubkey, std::uint8_t>> find_program_address(
    const Pubkey& program_id, std::span<const std::vector<std::uint8_t>> seeds);

}  // namespace noviscia