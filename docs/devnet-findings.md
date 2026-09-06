# Devnet Deployment Findings — Verified 2026-09-06

Real ground truth measured against `https://api.devnet.solana.com`
(solana-core `4.3.0-beta.3`, feature-set `2409014235`, slot `494114654`).
Not simulation, not assumption — probe output from `scripts/devnet/run-all-probes.ts`.

## 1 · Compiled programs (local, real)

`target/deploy/*.so` built with `cargo build-sbf` from a clean source tree:

| Program | .so bytes | Note |
|---|---:|---|
| nv_usdc_vault | 1,278,856 | vault/tranche |
| netting_engine | 677,520 | clearing/netting host |
| noviscia_capacity | 892,416 | cap/gate host |
| escrow | 861,960 | C4 |
| noviscia_permissioned_pool | 391,232 | folded → vault |
| spot_dex | 383,416 | C4 |
| noviscia_tranche_vault | 358,824 | folded → vault |
| burn_engine | 313,376 | C4 |
| yield_router | 298,416 | C2 |
| protocol_lp_vault | 295,104 | C4 |
| gateway_auction | 288,840 | C2 (Jito bundles) |
| bug_bounty | 296,440 | C4 |
| clearing_registry | 271,104 | C1 |

**Fail to compile (pre-existing, not fixed by this pass):**
- `position-tracker` — `E0658: only a single ident or integer is stable as the field in offset_of` (`src/x_oracle.rs:119,122,124,126`), 5 errors.
- `noviscia-clearing` — same `offset_of!` nested-field error.

These are Rust `offset_of!` multi-field (`.field1.field2`) usages that the
nightly BPF toolchain does not accept. 13/15 programs compile clean; the two
C1 stragglers need `offset_of` refactoring to single-field access.

## 2 · Devnet deployment state (measured)

Program IDs *documented* in `Anchor.toml [programs.devnet]` vs *actually live*:

| Program | Documented ID | Actually deployed | Account data |
|---|---|---:|---|
| netting-engine | `68s4vuWU…` | ✅ | 36 B loader stub |
| nv-usdc-vault | `CN92hAtn…` | ✅ | 36 B loader stub |
| gateway-auction | `HQ26VTfo…` | ✅ | 36 B |
| clearing-registry | `Hg5QvSsn…` | ✅ | 36 B |
| yield-router | `FKaAPPid…` | ✅ | 36 B |
| burn-engine | `nFgJEQSr…` | ✅ | 36 B |
| escrow | `2WPb3wsy…` | ✅ | 36 B |
| bug-bounty | `A8Uk9WuH…` | ✅ | 36 B |
| protocol-lp-vault | `2WUt24rR…` | ✅ | 36 B |
| spot-dex | `8C4try8m…` | ✅ | 36 B |
| **noviscia-capacity** | `JDsM18uS…` | ❌ **AccountNotFound** | — |

**Findings:**
1. **10/11 documented devnet IDs are live.** QED from
   `devnet-measurement-report.md`.
2. **`noviscia-capacity` is NOT deployed** — `AccountNotFound` on the
   documented `JDsM18uS…`. Its documented ID is provably absent.
3. **Local keypair mismatch:** every `.so`'s `target/deploy/*-keypair.json`
   pubkey differs from the documented devnet ID (e.g. netting-engine local
   keypair `BgpBUpc…` ≠ documented `68s4vuWU…`). So a fresh `anchor deploy`
   would land at *new* addresses, not the documented ones. The original
   deploy keypairs are not in this tree — recover them before any redeploy,
   or accept new IDs and update `Anchor.toml` + client maps.

**Consequence for the claims table:** the "atomic reversion / capacity /
circuit-breaker" code-review claims are proven *on paper*, and most program
artifacts are deployed live, but **capacity enforcement cannot be exercised
on devnet yet** because `noviscia-capacity` is absent. Any claim that capacity
gating was observed on-chain is a false claim today.

## 3 · How to re-verify (reproducible)

```bash
RPC_URL=https://api.devnet.solana.com \
  npx tsx scripts/devnet/run-all-probes.ts        # → devnet-measurement-report.{json,md}
npx tsx scripts/devnet/update-claims-table.ts devnet-measurement-report.json   # → updated-claims-table.{md,json}
```

Regenerating after a capacity deploy should flip row 4 (atomicity) and the
capacity-dependent claims to testnet-measured.

## 4 · Honest labels applied

- Compiled .so inventory → `real` (local build artifact).
- 10/11 devnet live IDs → `testnet-measured`.
- Capacity gate enforcement → `pending` (absent program).
- All waterfall economics → `simulated` (unchanged).