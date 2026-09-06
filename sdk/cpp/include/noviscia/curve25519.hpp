// SPDX-License-Identifier: Apache-2.0
// Noviscia C++ SDK — ed25519 point decoding (PDA on-curve check).
//
// Solana PDAs must derive to a public key that is NOT a valid ed25519 point
// (so no private key can ever exist for it). `find_program_address` therefore
// needs the same "is this a valid compressed Edwards point?" test the on-chain
// runtime performs (`CompressedEdwardsY::decompress` plus the < p check).
//
// This header implements exactly that check over GF(2^255-19). Field elements
// are 4 x uint64 little-endian limbs (256 bits), normalized to [0, p).

#pragma once

#include <array>
#include <cstdint>
#include <span>

namespace noviscia {

// Returns true when the 32 bytes decode to a valid ed25519 public key
// (a compressed Edwards point on the main subgroup curve). Mirrors
// `CompressedEdwardsY::decompress().is_some()`.
bool ed25519_is_on_curve(std::span<const std::uint8_t, 32> compressed) noexcept;

}  // namespace noviscia