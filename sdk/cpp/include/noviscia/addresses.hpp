// SPDX-License-Identifier: Apache-2.0
// Noviscia C++ SDK — PDA derivations for the consolidated host.
//
// Mirrors the Rust twin (`noviscia-capacity-sdk` / `noviscia-asset-engine-sdk`),
// which in turn mirror the on-chain seed layouts in asset_engine.rs,
// jit_risk.rs and lib.rs.

#pragma once

#include "noviscia/ids.hpp"
#include "noviscia/pubkey.hpp"

#include <string_view>
#include <utility>
#include <vector>

namespace noviscia {
namespace addresses {

// Derived program address + the bump used (for signer `bump` anchors).
struct Pda {
    Pubkey key;
    std::uint8_t bump;
    bool ok;  // false only if no bump 0..=255 produced an off-curve address
};

// Generic derivation from seed components (each string or Pubkey).
template <typename... S>
Pda derive(const Pubkey& program_id, S&&... components) {
    std::vector<std::vector<std::uint8_t>> seeds;
    (seeds.emplace_back([](auto&& c) {
         using T = std::decay_t<decltype(c)>;
         if constexpr (std::is_same_v<T, std::string_view>) {
             return std::vector<std::uint8_t>(c.begin(), c.end());
         } else {
             return std::vector<std::uint8_t>(c.bytes.begin(), c.bytes.end());
         }
     }(std::forward<S>(components))),
     ...);
    auto found = find_program_address(program_id, seeds);
    if (!found) return Pda{{}, 0, false};
    return Pda{found->first, found->second, true};
}

// ── capacity engine (lib.rs) ───────────────────────────────────────────────
Pda config(const Pubkey& program_id = ids::HOST);
Pda congestion(const Pubkey& program_id = ids::HOST);
Pda client(const Pubkey& operator_, const Pubkey& program_id = ids::HOST);
Pda slot_ledger(const Pubkey& operator_, const Pubkey& program_id = ids::HOST);
Pda treasury(const Pubkey& program_id = ids::HOST);
Pda treasury_auth(const Pubkey& program_id = ids::HOST);

// ── jit-risk marketplace (jit_risk.rs) ────────────────────────────────────
Pda marketplace(const Pubkey& program_id = ids::HOST);
Pda mm_registration(const Pubkey& mm, const Pubkey& program_id = ids::HOST);

// ── asset engine (asset_engine.rs) ────────────────────────────────────────
Pda asset_registry(const Pubkey& program_id = ids::HOST);
Pda asset_pool(const Pubkey& mint, const Pubkey& program_id = ids::HOST);
Pda asset_vault(const Pubkey& mint, const Pubkey& program_id = ids::HOST);
Pda asset_fee_vault(const Pubkey& mint, const Pubkey& program_id = ids::HOST);
Pda asset_authority(const Pubkey& mint, const Pubkey& program_id = ids::HOST);
Pda credit_line(const Pubkey& institution, const Pubkey& program_id = ids::HOST);
Pda desk_position(const Pubkey& institution, const Pubkey& mint,
                  const Pubkey& program_id = ids::HOST);
Pda asset_lp_mint(const Pubkey& mint, const Pubkey& program_id = ids::HOST);
Pda asset_lp_position(const Pubkey& mint, const Pubkey& lp,
                      const Pubkey& program_id = ids::HOST);

}  // namespace addresses
}  // namespace noviscia