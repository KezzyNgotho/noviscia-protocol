# Devnet Deployment Findings — Verified 2026-09-06

Real ground truth measured against `https://api.devnet.solana.com`
(solana-core `4.3.0-beta.3`, feature-set `2409014235`, slot `494198156`).
Not simulation, not assumption — probe output from `scripts/devnet/run-all-probes.ts`.
Re-verified after the 2026-09-06 capacity redeploy (see `docs/DEVNET.md`).

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
| netting-engine | `68s4vuWU…` | ✅ | loader-stub |
| nv-usdc-vault | `CN92hAtn…` | ✅ | loader-stub |
| gateway-auction | `HQ26VTfo…` | ✅ | loader-stub |
| clearing-registry | `Hg5QvSsn…` | ✅ | loader-stub |
| yield-router | `FKaAPPid…` | ✅ | loader-stub |
| burn-engine | `nFgJEQSr…` | ✅ | loader-stub |
| escrow | `2WPb3wsy…` | ✅ | loader-stub |
| bug-bounty | `A8Uk9WuH…` | ✅ | loader-stub |
| protocol-lp-vault | `2WUt24rR…` | ✅ | loader-stub |
| spot-dex | `8C4try8m…` | ✅ | loader-stub |
| **noviscia-capacity** | `EDBr2VFW…` | ✅ **live** | 892,416 B program data |

**Findings:**
1. **11/11 documented devnet IDs are live.** QED from
   `devnet-measurement-report.{json,md}`.
2. **`noviscia-capacity` is deployed at `EDBr2VFW…`.** The original deploy keypair
   for `JDsM18uS…` was lost (AccountNotFound, not present in git/config), so the
   host was redeployed at `EDBr2VFW…` and *every* client/PDA derivation migrated
   (`Anchor.toml`, `sdk/src/*.ts`, `app/web/lib/*`, `services/indexer`). The
   deployed ELF is byte-identical to `target/deploy/noviscia_capacity.so`
   (.so hash `011f6882…e9`, verified against ProgramData at the 45-byte header).
3. **Known quirks to remember:** (a) the credit line account at
   `AifRX9…cw5` still stores `bump = 0` (canonical = 254) from its creation — the
   deployed program no longer reads the stored bump (`bump = credit_line.bump` →
   plain `bump`, 6 sites in `asset_engine.rs`), so it is inert; do **not**
   re-initialize the credit line. (b) `nv-usdc-vault`'s deployed binary still
   embeds the pre-redeploy `CAPACITY_PROGRAM_ID` constant (inert until a vault
   upgrade; source carries a NOTE).

**Consequence for the claims table:** the "atomic reversion / capacity /
circuit-breaker" program hosts are all live, so the on-paper claims are
executable; capacity enforcement **is** observable on devnet now — a real 24h
window was opened via `asset_allocate_capacity` (slot 494190470, posture
`Open`; see `devnet-window-observation.json`). The remaining un-flipped probes
are ones that by definition need either an integration run (atomicity byte-level
assertion), a service (Geyser), a counterparty (Jito landing / desks), or time
(24h → Breached observer).

## 3 · How to re-verify (reproducible)

```bash
RPC_URL=https://api.devnet.solana.com \
  npx tsx scripts/devnet/run-all-probes.ts        # → devnet-measurement-report.{json,md}
npx tsx scripts/devnet/update-claims-table.ts devnet-measurement-report.json   # → updated-claims-table.{md,json}
# live window posture (writes devnet-window-observation.json)
npx tsx scripts/devnet/observe-capacity-window-devnet.ts
```

When the observer reports `Overdue`/`Breached`, re-running
`run-all-probes.ts` flips the timeout-locks claim to `testnet-measured`.

## 4 · Honest labels applied

- Compiled .so inventory → `real` (local build artifact).
- 11/11 devnet live IDs → `testnet-measured`.
- Capacity enforcement → **live on devnet** (window open @ 494190470; breach ≈ 494424470).
- Atomicity byte-assertion, Geyser latency, Jito landing, circuit-breaker live
  drain, non-Jito pause → `pending`/`not-yet-measured` (see report).
- All waterfall economics → `simulated` (unchanged).