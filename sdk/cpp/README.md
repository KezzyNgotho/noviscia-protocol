# Noviscia C++ SDK

> **Status:** Live — byte-verified vs the Rust twin · **Last updated:** 2026-09-07

C++ twin of the Noviscia institutional API surface, mirroring the npm SDK
(`sdk/`) and the Rust SDKs (`sdk/rust/noviscia-*-sdk`). All three twins stay in
lockstep with the on-chain seed layouts in `asset_engine.rs`, `jit_risk.rs` and
`lib.rs`.

## Build

Requires a C++20 compiler (uses `std::span`). No external dependencies.

```sh
make test        # compiles and runs the self-verifying test binary
make clean
```

A `CMakeLists.txt` is also provided for consumers:

```sh
cmake -S . -B build && cmake --build build && ctest --test-dir build
```

## Layout

- `include/noviscia/…` — public headers: `ids`, `hash`, `curve25519`,
  `pubkey`, `addresses`, `merkle`, `types`, `compute`, `instruction`, umbrella
  `noviscia.hpp`.
- `src/…` — self-contained implementations (no allocations in hot paths).
- `test/noviscia_test.cpp` — cross-verified reference vectors against the Rust
  and npm twins: keccak-256 leaves/merkle proofs, ed25519 on-curve checks,
  every PDA (key + bump) for the host seeds, base58, instruction
  serialization, Anchor discriminator derivation, capacity/asset-engine math
  helpers.

## Parity notes

- **Keccak-256** uses the original Keccak padding (`0x01`), matching
  `keccak256` in the on-chain programs — *not* SHA3-256 (`0x06`).
- **PDA derivation** implements the modern Solana scheme (runtime + web3.js):
  `sha256(seeds… ‖ [bump] ‖ program_id ‖ "ProgramDerivedAddress")`, scanning
  bump 255 → 0 for the first off-curve address.
- **Vec lengths** are `u32 LE`, matching borsh on-chain.
- **Instruction parity** is proven against the Rust twin byte-for-byte: every
  builder renders the exact same account order + signer/writable flags and
  borsh payload for the same inputs (30/30 builders verified, including
  capacity `initialize`…`withdraw_treasury` and asset-engine
  `asset_initialize`…`asset_withdraw_fees`).
- **U128 arithmetic** mirrors the Rust `u128` formulas (floor division, `as
  u64` truncation, overflow → 0) without `__int128`, keeping `-Wpedantic`
  clean.
- Numeric constants live at `noviscia::` scope (e.g. `noviscia::BPS`,
  `noviscia::WINDOW_SLOTS`), matching the Rust twin; the `noviscia::ids`
  namespace holds program IDs and seeds only.
- **Known npm-twin divergence**: the npm `asset_initialize` builder hashes the
  string `"asset_initialize"` for its discriminator and `asset_register`
  swaps `asset_lp_mint`/`asset_authority` in its account order. The C++ and
  Rust twins follow the on-chain layout (`"initialize"` disc; authority before
  lp_mint). Do not copy the npm encodings into new tooling.
- **`asset_allocate_capacity`** folds the desk/institution onto the trader
  (single operator desk), matching the Rust desktop-tool path; the Rust
  builder additionally accepts a distinct `institution` when a separate
  credit line is required.

## Verification

`make test` runs 199 checks (compiled with `-Wall -Wextra -Wpedantic`, zero
warnings). Expected values are regenerated from the Rust/npm twins and must
remain green whenever seed layouts change.