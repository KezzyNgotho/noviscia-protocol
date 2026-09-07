// SPDX-License-Identifier: Apache-2.0
// Noviscia C++ SDK — program ids, mints, seeds, and numeric constants.
//
// Values mirror `sdk/rust/noviscia-types` and the live devnet deployment.
// The consolidated host (EDBr…) is the single program that implements the
// capacity engine, the jit-risk marketplace (`risk_*` forwarders) and the
// asset engine; all their PDAs derive under that one id.

#pragma once

#include "noviscia/pubkey.hpp"

#include <cstddef>
#include <cstdint>

namespace noviscia {
namespace ids {

// Consolidated host: capacity engine + jit-risk marketplace + asset engine.
inline const Pubkey HOST = [] { Pubkey k; from_base58("EDBr2VFWweFDzKR4cTT5j3TPGvPd9imoP8F76YK1o9oe", k); return k; }();
inline const Pubkey CAPACITY_PROGRAM_ID = HOST;
inline const Pubkey JIT_RISK_PROGRAM_ID = HOST;
inline const Pubkey ASSET_ENGINE_PROGRAM_ID = HOST;

// Legacy jit-risk marketplace deployment (route + deployed at 3w9Gr, shipment
// of admission forwarders observed there). Instruction names differ from the
// host's `risk_*` surface; this SDK encodes against the host.
inline const Pubkey LEGACY_MARKETPLACE = [] { Pubkey k; from_base58("3w9GrHBXpMNSc3P3kBWmHwkhEr1u5FBQrTiD4k3NAXwh", k); return k; }();

inline const Pubkey USDC_MINT = [] { Pubkey k; from_base58("Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5", k); return k; }();
inline const Pubkey WSOL_MINT = [] { Pubkey k; from_base58("So11111111111111111111111111111111111111112", k); return k; }();
// NVSC devnet governance token mint.
inline const Pubkey NVSC_MINT = [] { Pubkey k; from_base58("4BXiDT5o9J6aQdJNd36QE1L2YvQqedEKSP1wuQdSgJkg", k); return k; }();
// nvscUSDC devnet yield-bearing share token mint.
inline const Pubkey NVSCUSDC_MINT = [] { Pubkey k; from_base58("2TmaUey4Hh2om1kFR77Vw1RDh8H69qcW6UAACVidJeVk", k); return k; }();

// Solana-native programs referenced by instruction builders.
inline const Pubkey SYSTEM_PROGRAM = [] { Pubkey k; from_base58("11111111111111111111111111111111", k); return k; }();
inline const Pubkey TOKEN_PROGRAM = [] { Pubkey k; from_base58("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", k); return k; }();
inline const Pubkey RENT_PROGRAM = [] { Pubkey k; from_base58("SysvarRent111111111111111111111111111111111", k); return k; }();

}  // namespace ids

namespace seeds {
inline constexpr std::string_view CAPACITY = "capacity";
inline constexpr std::string_view CONGESTION = "congestion";
inline constexpr std::string_view CLIENT = "client";
inline constexpr std::string_view SLOT_LEDGER = "slot-ledger";
inline constexpr std::string_view TREASURY = "treasury";
inline constexpr std::string_view TREASURY_AUTH = "treasury-auth";
inline constexpr std::string_view MARKETPLACE = "marketplace";
inline constexpr std::string_view MM = "mm";
inline constexpr std::string_view ASSET_REGISTRY = "asset-registry";
inline constexpr std::string_view ASSET_POOL = "asset-pool";
inline constexpr std::string_view ASSET_VAULT = "asset-vault";
inline constexpr std::string_view ASSET_FEES = "asset-fees";
inline constexpr std::string_view ASSET_AUTHORITY = "asset-authority";
inline constexpr std::string_view CREDIT_LINE = "credit-line";
inline constexpr std::string_view DESK_POSITION = "desk-position";
inline constexpr std::string_view ASSET_LP_MINT = "asset-lp-mint";
inline constexpr std::string_view ASSET_LP_POSITION = "asset-lp-position";
}  // namespace seeds

// Numeric constants mirroring the on-chain programs.
constexpr std::uint64_t BPS = 10'000;
constexpr std::uint64_t BPS_U128 = 10'000;
constexpr std::uint64_t WAD = 1'000'000'000'000;  // per-slot premium rate (jit-risk)
constexpr std::uint64_t WINDOW_SLOTS = 216'000;   // ~24h @ 400ms slots
constexpr std::uint64_t GRACE_SLOTS = 18'000;     // ~2h late-fee grace
constexpr std::uint64_t LATE_FEE_RATE_BPS = 50;   // micro-bps per overdue slot
constexpr std::uint64_t LATE_FEE_BASE = 10'000;   // late-fee meter denominator
constexpr std::uint64_t LP_PRICE_SCALE = 1'000'000;   // LP share-price scaling
// Per-MM credit ceiling cap = C_desk ($1.5M).
constexpr std::uint64_t MAX_MM_CEILING_USDC = 1'500'000'000'000;
// Maximum merkle tree depth (supports up to 2^20 ≈ 1M verified clients).
constexpr std::size_t MAX_MERKLE_DEPTH = 20;

// jit-risk MM lifecycle + slice-receipt status enums.
constexpr std::uint8_t MM_STATUS_ACTIVE = 1;
constexpr std::uint8_t MM_STATUS_SUSPENDED = 2;
constexpr std::uint8_t SLICE_RESERVED = 0;
constexpr std::uint8_t SLICE_SETTLED = 1;
constexpr std::uint8_t SLICE_DEFAULTED = 2;
constexpr std::uint8_t SLICE_REAPED = 3;

}  // namespace noviscia