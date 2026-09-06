# Noviscia C++ SDK

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
  `pubkey`, `addresses`, `merkle`, `instruction`, umbrella `noviscia.hpp`.
- `src/…` — self-contained implementations (no allocations in hot paths).
- `test/noviscia_test.cpp` — cross-verified reference vectors against the npm
  twin: keccak-256 leaves/merkle proofs, ed25519 on-curve checks, every PDA
  (key + bump) for the host seeds, base58, instruction serialization, Anchor
  discriminator derivation.

## Parity notes

- **Keccak-256** uses the original Keccak padding (`0x01`), matching
  `keccak256` in the on-chain programs — *not* SHA3-256 (`0x06`).
- **PDA derivation** implements the modern Solana scheme (runtime + web3.js):
  `sha256(seeds… ‖ [bump] ‖ program_id ‖ "ProgramDerivedAddress")`, scanning
  bump 255 → 0 for the first off-curve address.
- **Vec lengths** are `u32 LE`, matching borsh on-chain.

## Verification

`make test` runs 70 checks. The expected-value table is regenerated from the
npm twin (`PublicKey.findProgramAddressSync` / keccak / Anchor `discriminator`)
and must remain green whenever seed layouts change.