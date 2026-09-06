# Noviscia Consolidation Blueprint — 19 → 4 Clusters

> **Status:** BLUEPRINT (stage-1 deliverable). **No code has been moved.**
> This document is the decision artifact for collapsing the 19 active programs into
> 4 hardening clusters. It records the redundancy verdicts, the every-program-tells-what
> placement, the blast-radius map, and the staged, test-green execution order.
> Review this, ratify the decisions flagged in **§9 Decision Register**, then Stage 0
> executes as the first commit.

---

## 1. Ground truth inventory

24 declared programs — 19 active + 5 parked.

| Program | LOC | Cluster (target) | Verdict |
|---|---|---|---|
| position-tracker | 9,658 | CCP core | KEEP (venue engine) |
| nv-usdc-vault | 6,212 | Vault & tranches | KEEP (single NAV spine) |
| noviscia-clearing | 3,722 | CCP core | KEEP (event venues) |
| staking-manager | 2,842 | Ecosystem & governance | LOCK |
| noviscia-asset-engine | 2,381 | TVV gate | ABSORB |
| netting-engine | 1,689 | CCP core | KEEP (netting ledger) |
| liquidation-vault | 1,546 | Ecosystem & governance | LOCK |
| noviscia-capacity | 1,297 | TVV gate | ABSORB |
| noviscia-permissioned-pool | 1,125 | Vault & tranches | ABSORB |
| noviscia-tranche-vault | 961 | Vault & tranches | ABSORB |
| sovereign-netting | 820 | CCP core | ABSORB (into netting) |
| noviscia-credit-line | 749 | CCP core | ABSORB (ledger) |
| yield-distributor | 765 | Ecosystem & governance | LOCK |
| yield-router | 487 | TVV gate | KEEP |
| clearing-registry | 462 | CCP core | KEEP (venue registry) |
| gateway-auction | 406 | TVV gate | KEEP |
| token-nvsc | 352 | Ecosystem & governance | LOCK |
| ve-nvs | 330 | Ecosystem & governance | LOCK |
| jit-risk | 94 | TVV gate | ABSORB |
| burn-engine / escrow / protocol-lp-vault / spot-dex / bug-bounty | parked | — | already PARKED |

---

## 2. The actual CPI graph (ground truth, not assumption)

Edges derived from `Cargo.toml` `features = ["cpi"]` + `cpi::accounts` call sites:

```
                        ┌────────────────────────────────────────────────────────┐
                        │                  100% of fill path                     │
                        │                                                     ▼   │
   position-tracker ────┼──▶ nv-usdc-vault   (RedeemNvusdc, DrawDefaultFund,   │
   noviscia-clearing ────┼──▶  DepositUsdc, UpdateLockedMargin,                │
   jit-risk ──────────────┼──▶  UpdateAggregateMaintenanceMargin,               │
   gateway-auction ───────┼──▶  Accumulate(Fees)WithCcp, AllocateToDefaultFund) │
   sovereign-netting ─────┼──▶                                                 │
   noviscia-credit-line ───┘                                                   ▼
        │                                                                 ┌─────────────┐
   position-tracker ──▶ netting-engine ──▶ sovereign-netting               │ nv-usdc-    │
   noviscia-clearing ──▶ netting-engine       (ReporterOp)                 │ vault       │
   clearing-registry ──▶ netting-engine (RegisterVenue)                    └─────────────┘
   netting-engine     ──▶ sovereign-netting (metrics/rent pricing)            ▲  ▲
   position-tracker ──▶ staking-manager ──▶ ve-nvs                         yield-router
   position-tracker ──▶ yield-router (RecallForMargin)                    (allocate/recall)
```

**Critical finding the blueprint must correct:** the four "older core" programs the
original brief wanted to keep separate are in fact already wired together as the CCP
backbone (`clearing-registry`→`netting-engine`, `netting-engine`→`sovereign-netting`,
`position-tracker`+`noviscia-clearing`→`netting-engine`). They are NOT redundant — they
are **size-constrained layers** (see §3). The genuinely parallel ledger truths live in
the **newer institutional stack**, which has **zero CPI edges into the old core**:
`capacity`, `asset-engine`, `credit-line`, `tranche-vault`, `permissioned-pool`.

---

## 3. Solana hard constraint that re-shapes the target

**A single on-chain program cannot hold the entire CCP.** Solana program accounts are
capped (~1 MB freshly-deployable binary; upgradeable programs share that ceiling).
`position-tracker` alone is ~9,700 lines; merging it with `noviscia-clearing` (3.7k),
`netting-engine` (1.7k), `clearing-registry`, `sovereign-netting` and `credit-line`
into **one** crate will exceed the platform limit.

**Therefore:** "19 → 4" must be read as **"19 → 4 clusters (deployment groups) of
size-bounded deploy units"**, NOT "4 program IDs." The architectural wins we actually
secure are:
- eliminate **parallel ledger truths** (the real bug),
- remove **authority-boundary hops** only where cheap to do so (leaf absorbs),
- reduce the effective **authority/trust surface** from 19 programs to 4 clusters,
- keep the size-required separation of the heavy venue engines.

---

## 4. Redundancy verdicts (the four claimed overlaps)

### 4.1 `jit-risk` vs `noviscia-capacity` vs `noviscia-asset-engine` → **REAL OVERLAP**
All three price/tokenize/allocate the 400ms slot:
- `jit-risk` (94 LOC): insurance-pool capacity rental, premium sweep 85/15 to NAV/backstop via `AccumulateProtocolFees`.
- `capacity` (1,297 LOC): per-slot `SlotLedger`, Merkle-KYC, micro-premium; no CPI consumers besides its own SDK (`noviscia-capacity-sdk`).
- `asset-engine` (2,381 LOC): multi-asset pools, credit lines, daily single-tx clearing, ERC-4626 LP shares, ceilings. Consumed only by `noviscia-asset-engine-sdk`.

**Action:** fuse into ONE TVV/capacity program (design name `vault-gate` / `tvv-gate`).
This is the highest-value merge — it removes parallel credit/pool accounting and the
cheapest authority hop in the system.

### 4.2 `netting-engine`+`clearing-registry` vs `noviscia-credit-line` → **PARTIAL OVERLAP (functionally distinct)**
- `netting-engine` is a **settlement ledger** (signed net positions, non-custodial, no SPL movement).
- `credit-line` is a **funding primitive** (single-block collateralized credit) that already CPIs `nv-usdc-vault`.

The real risk is **state duplication** (credit utilization recorded in both), not
instruction duplication. **Action:** keep the funding instruction live but **absorb its
utilization ledger into `netting-engine`'s exposure records** so the 24h desk limit is a
single on-chain truth; freeze the standalone `credit-line` program. This is a **ledger
unification**, not a blind merge of two different concerns.

### 4.3 `nv-usdc-vault` vs `noviscia-tranche-vault` → **REAL OVERLAP (strongest merge case)**
`nv-usdc-vault` already owns: omni-pool NAV, `nvscUSDC` shares, **insurance buffer,
default fund, guarantee fund**, 5-authority fee spine, `AccumulateFeesWithCcp` —
i.e. the senior/junior structure the vault still *claims* it needs tranche-vault for.
`tranche-vault` (961 LOC: protected retail tranche hard loss cap + institutional
absorb-first + time-based yield) **re-implements buffers the vault already ships.**

**Action:** absorb tranche accounting into `nv-usdc-vault` (protected = insurance
buffer/guarantee fund; institutional = default fund), freeze standalone `tranche-vault`.
This removes the riskiest class of cross-vault balancing CPI during volatility.

### 4.4 `spot-dex` (parked) vs `noviscia-permissioned-pool` → **NO LIVE DUP (spot-dex already parked)**
`spot-dex` is parked under `programs/cluster-4-governance/`. The only active AMM-like is `permissioned-pool`
(KYC/AML-gated constant-product pools with `LpEntry`). Its roles (routing + LP entry)
map onto the vault cluster's "whitelisted market-making routing." **Action:** absorb
`permissioned-pool`'s routing/LP-entry into Cluster 3 (vault) so the whitelisted routing
truth lives with the liquidity it routes. Freeze `permissioned-pool`. `spot-dex` stays parked.

---

## 5. Target architecture (4 clusters)

```
                        THE NOVISCIA PROTOCOL (4 clusters)

┌───────────────────────────┐ ┌───────────────────────────┐ ┌───────────────────────┐ ┌──────────────────────┐
│ C1 · CLEARING-CORE (CCP)  │ │ C2 · TVV GATE             │ │ C3 · VAULT & TRANCHES │ │ C4 · ECOSYSTEM & GOV │
│  DEPLOY GROUP             │ │  DEPLOY GROUP             │ │  DEPLOY GROUP         │ │  DEPLOY GROUP        │
├───────────────────────────┤ ├───────────────────────────┤ ├───────────────────────┤ ├──────────────────────┤
│ netting-engine (ledger)   │ │ tvv-gate  (capacity+     │ │ nv-usdc-vault          │ │ token-nvsc            │
│    + sovereign-netting    │ │   jit-risk+asset-engine) │ │    + tranches +        │ │ ve-nvs                │
│ position-tracker (perps)  │ │   ═ single authority hop │ │    permissioned-pool   │ │ staking-manager        │
│ noviscia-clearing (eve)   │ │ gateway-auction          │ │   (routing)            │ │ yield-distributor      │
│ clearing-registry (ten)   │ │ yield-router             │ │                        │ │ liquidation-vault      │
│    + credit-line ledger   │ │                          │ │                        │ │   (LOCKED, phase 1)   │
├───────────────────────────┤ ├───────────────────────────┤ ├───────────────────────┤ ├──────────────────────┤
│ ▸ trade + exposure truth  │ │ ▸ 400ms slot truth        │ │ ▸ single NAV truth     │ │ ▸ governance truth    │
└───────────────────────────┘ └───────────────────────────┘ └───────────────────────┘ └──────────────────────┘
```

**Cluster design principle:** the **heavy venue engines stay size-separate**
(position-tracker, noviscia-clearing, nv-usdc-vault, netting-engine) — merging them
would hit the ~1 MB program-size ceiling. What we merge is the **parallel-stack leaves**
(capacity/jit-risk/asset-engine → C2, credit-line ledger → C1, tranche-vault &
permissioned-pool → C3) that today double-record state with zero CPI grounding into the
backbone.

---

## 6. Breakage & blast-radius map (what each merge breaks)

**Crate-level dependencies (Rust SDK path-deps on the newer stack):**
- `sdk/rust/noviscia-credit-line-sdk` → **`programs/cluster-1-clearing-core/noviscia-credit-line`** (`features=["cpi"]`)
- `sdk/rust/noviscia-client` → **`sdk/rust/noviscia-capacity-sdk`**
- `sdk/rust/noviscia-capacity-sdk` → `noviscia-types` (safe)
- `sdk/rust/noviscia-asset-engine-sdk` → `solana-sdk`/`noviscia-types` (safe — no path-dep on the program crate itself)

**Anchor.toml** (`[programs.devnet/localnet/mainnet]`) + root `Cargo.toml` workspace
members: freezing any program removes its `declare_id`, its Anchor deploy mapping, and
its workspace membership — all three must be edited in lockstep with SDK path-deps or CI breaks.

**Everything else rides on the newer stack only via its SDKs + own tests**: no existing
CPI edge *calls into* `capacity`/`asset-engine`/`tranche-vault`/`credit-line`/`permissioned-pool`
except `credit-line`→`nv-usdc-vault` (which remains a vault edge in C3 anyway). The old
core has no in-repo external consumers at crate level. **This is why the merge is safe
to stage.**

---

## 7. Staged execution plan (each stage ends test-green)

All stages keep the workspace compiling and the existing test suites passing at every
commit boundary. Storage/verification is local-devnet; **no mainnet data migration gate**.

### Stage 0 — Freeze policy + manifest true-up (no logic moved) ✅ DONE
- Frozen at Stage 0: `noviscia-asset-engine`, `noviscia-capacity` (host), `noviscia-credit-line`, `noviscia-tranche-vault`, `noviscia-permissioned-pool`.
- `Status: FROZEN` banners in each `lib.rs`; `noviscia_credit_line` removed from `Anchor.toml` `[programs.devnet]` + `[programs.localnet]` (20→19 entries, verified via TOML parse); freeze register in `docs/FROZEN.md`.
- Evidence suites still green: capacity **15** · asset-engine **28** · credit-line **8** · tranche-vault **9** · permissioned-pool **11**. All crates still compile.

### Stage 1 — Cluster 3 (absorption with strongest case): `tranche-vault` + `permissioned-pool` → `nv-usdc-vault` ✅ DONE
- **Ceiling correction (material):** the first pass split this cluster (D4 fallback — router to
  C2) because the merged `.so` was 1,273,784 B against a presumed 1,146,880 B BPF deploy cap.
  The cap is a pre-Solana-2.0 limit; **SDK 2.x enforces only
  `MAX_PERMITTED_DATA_LENGTH = 10 MiB`** (`solana_bpf_loader_program` DeployWithMaxDataLen /
  `solana_system_interface`), and the pipeline already ships a 2.2 MB binary
  (`position-tracker.so`, `.cache/local-validator.sh`). The 1.1 MiB gate and the D4 split were
  retracted. Final: **the whole cluster lives in the vault.**
- **Single binary — `nv-usdc-vault` 1,277,488 B ✓ (tranche + router + default fund):**
  - `tranche_pool` module: dual-tier ledger (protected_nav/insti_nav/shares, apy, loss cap,
    bumps) + `TranchePosition`; USDC in program sub-custody (`b"tranche-usdc"` + vault_config +
    tier); admin = `vault_config.admin` (`has_one`). 8 handlers:
    `tranche_initialize/set_paused/accrue/deposit/withdraw/record_loss/rebalance/migrate`.
  - `router_pool` module: constant-product pool + KYC merkle gate + LP tiers + insurance cut,
    authority = pool-initializer (`has_one` signer). 9 handlers:
    `router_initialize_pool/set_kyc_merkle_root/register_lp/revoke_lp/deposit_liquidity/
    withdraw_liquidity/swap/set_paused/set_fees`.
  - 5 ledger-unification tests prove tranche loss-shortfall ↔ default-fund-draw one-to-one and
    that a covered loss leaves `compute_lp_nav` unchanged — same-binary, no CPI hop.
- Port fixes carried: keccak-256 via `hashv`; all CPI signers corrected to the **pool config
  PDA** seeds `[router-pool, label]` (source used vault/user seeds that could never sign —
  masked because its tests only covered pure math); `router-*`/`tranche-*` seed namespaces.
- Tests: `cargo test -p nv-usdc-vault` → **77/77**; `cargo test -p noviscia-capacity` → **15/15**
  (back to plain tvv-gate); `cargo build --workspace` clean.
- Rewiring note: new entrypoints (`tranche_*`/`router_*` in the vault) get pointed to by the
  SDK/clients at Stage 4 (single client-surface pass) per §9 D7.
- Remaining `nv-usdc-vault` growth headroom (10 MiB budget) is ~8.7 MB — big enough that the
  whole C2 cluster could theoretically be folded in later if desired (not planned; kept separate
  for sub-millisecond slot throughput and deployment hot-spots).

### Stage 2 — Cluster 2 (largest merge): `jit-risk` + `capacity` + `asset-engine` → `tvv-gate` ✅ DONE
- **Identity:** `noviscia-capacity` crate (host) preserved `declare_id!("JDsM18uSZ1UJEP49XdKSjumdftpuZ8cJbpb8CkBaBiMc")`; no client/PDA migration on the live devnet account.
- **Merged as namespaced submodules** (`asset_engine.rs` 2,382 LOC / 27 tests; `jit_risk.rs` 2,061 LOC / 24 tests):
  - `asset_engine` — full multi-asset pool/credit engine (15 handlers, ERC-4626 LP shares, daily single-tx clearing, ceilings, hashv-Merkle KYC gate). Renames avoid host collisions: `AssetError→AssetEngineError`, `BPS→ASSET_BPS`, `*_compute_kyc_hash/verify_merkle_proof/keccak256_pair→asset_*`.
  - `jit_risk` — slot-scoped capacity-rental marketplace (13 handlers, insurance floor sync, 85/15 sweep CPI to vault). Renames: `BPS→JIT_BPS`, `WAD→JIT_WAD`.
- **Wiring:** context/account structs + `h_*` handler logic live in the modules; the host `#[program]` mod exposes `asset_*`/`risk_*` forwarding handlers. Context types are glob-re-exported at crate root (`pub(crate) use asset_engine::*; pub(crate) use jit_risk::*;`) because Anchor 0.31's `#[program]` codegen resolves each `Context<T>` (and its generated `__client_accounts_*` module) as a crate-root item — same pattern as `position-tracker`'s `accounts_defs`. Verified at merge time: host/asset_engine/jit_risk public namespaces are disjoint.
- **Fee-spine re-point (vault side):** `nv-usdc-vault` `accumulate_protocol_fees` (lib.rs:1728) authorized fee sources by hardcoded program-ID PDA derivation; it now also accepts the consolidated marketplace PDA — `find_program_address(&[b"marketplace"], &CAPACITY_PROGRAM_ID)` (new const) alongside the legacy standalone `JIT_RISK_PROGRAM_ID`. Same allowlist applied to the second fee-authorize site (lib.rs ~3800). Otherwise the merged `sweep_premiums` CPI would fail `Unauthorized`.
- Tests: `cargo test -p noviscia-capacity` → **66/66** (15 host + 27 asset + 24 jit); `cargo test -p nv-usdc-vault` → **77/77**; `cargo build --workspace` clean.
- Size: merged `noviscia_capacity.so` → **873,616 B** (vs 397,112 B pre-merge; ~8.6 MB headroom to the 10 MiB ceiling).
- Rewiring note: existing `asset-engine`/`jit-risk` entrypoints and the standalone `jit-risk` marketplace/`noviscia-asset-engine-sdk` client surfaces get re-pointed at the merged gate's `asset_*`/`risk_*` instruction names at Stage 4 (§9 D7).

### Stage 3 — Cluster 1 (ledger unification): credit-line ledger → netting-engine; sovereign-netting fold-in
- Unify desk utilization into `netting-engine` exposure records; keep the funding instruction
  (already vault-CPI'd) functionally intact via the unified ledger.
- Fold `sovereign-netting` metric/rent pricing into `netting-engine` (removes the thin
  `netting-engine`→`sovereign-netting` hop).
- Freeze standalone `credit-line` + `sovereign-netting`.

**EXECUTED** (netting-engine is the C1 host; `declare_id` `68s4...` survives):
- **Merged as namespaced submodules** (`credit_line.rs` 749 LOC / 7 tests; `sovereign.rs` — flat merge of sovereign lib+state+pricing, 4,680 LOC / 18 tests):
  - `credit_line` — 5 `h_*` handlers (`h_initialize`, `h_register_borrower`, `h_pull_credit`, `h_repay_and_settle`, `h_set_config`), 5 contexts, `CreditLine`/`Borrower` ledgers + SPACE consts, 12-variant `CreditLineError`, 4 events, vault CPI intact.
  - `sovereign` — 19 `h_*` handlers (metrics init/config, reporters, NEI/TSV sampling, netting-rent charging, priority auction, read/sweep), `MetricsState` (1550 B layout, ring-buffer TSV, NEI EMA, rent meter, per-slot auction), 12-variant `SovereignError`, 6 events, revenue-sweep CPI to vault intact.
- **CPI seam removed:** the former `feed_state`/`stream_metrics`/`stream_rent` CPIs into `sovereign-netting` are now **in-process** mutations of the host-owned `MetricsState` PDA (`[b"metrics"]` under `68s4...`, owner == ID). The 2-account remaining-accounts tail `[metrics_pda, program_id]` protocol is preserved (caller still passes the metrics PDA + program account); `report_fill`/`consolidate` stream TSV + NEI samples and re-attest `C_Net = gross − |net|` with lazy retro-accrued per-block netting rent + `RentCharged` event — no CPI hop, no config-signer seeds.
- **Wiring:** 24 forwarding handlers `cl_*`/`sv_*` in the host `#[program]` mod; modules glob-reexported at crate root (`pub(crate) use credit_line::*; pub(crate) use sovereign::*;`) per Anchor 0.31's crate-root Context resolution (same pattern as C2). Namespaces verified disjoint; duplicate `h_initialize` across the two globs is fine because every forwarding call is fully-qualified (`credit_line::h_initialize` / `sovereign::h_initialize`).
- **Fee-spine re-point (vault side):** `nv-usdc-vault` both authorize sites now also accept `[b"revenue"]` and `[b"credit-line"]` PDAs derived under new `NETTING_ENGINE_PROGRAM_ID` (`68s4...`) const, alongside the legacy standalone `SOVEREIGN_REVENUE_PROGRAM_ID` / `CREDIT_LINE_PROGRAM_ID`.
- **Cargo:** netting-engine depends on `anchor-spl` + `nv-usdc-vault(cpi)`; `sovereign-netting` dep removed; `idl-build` feature updated.
- Tests: `cargo test -p netting-engine --lib` → **42/42** (17 host + 7 CL + 18 SV); `cargo test -p nv-usdc-vault` → **77/77**; `cargo build --workspace` clean.
- Size: merged `netting_engine.so` → **660,304 B** (vs 389,192 B pre-merge; ~9.8 MB headroom to the 10 MiB ceiling).
- Breaking-note: `MetricsState` auto-discriminator changed (type path `sovereign_netting::state::MetricsState` → `netting_engine::sovereign::MetricsState`) and its PDA now derives under the host `68s4...` ID, so devnet metrics/revenue/credit-line accounts must be re-created under the merged program. `credit_line`/`sovereign` forwarding handlers + the new PDA derivation land at Stage 4 SDK re-point (§9 D7).

### Stage 4 — Cluster 4 lock + review sheet ✅ DONE
- Pin `token-nvsc/ve-nvs/staking-manager/yield-distributor/liquidation-vault` as locked
  (no-upgrade during phase-1 sandbox), leaving their IDLs/deploys stable. **Executed:** the five
  C4 programs are commented out of `Anchor.toml` `[programs.devnet]`/`[programs.localnet]` deploy
  maps (IDs retained for audit; `docs/FROZEN.md` §4).
- Generate `REVIEW_CONSOLIDATION.md` (diffed summary of what moved, what froze, what counts
  against the audit) + rerun the full acceptance suite. **Executed:** [`REVIEW_CONSOLIDATION.md`](REVIEW_CONSOLIDATION.md)
  written; acceptance green — netting-engine 42/42, capacity 66/66, vault 77/77, sandbox hub
  26/26, SDK TS 117/117 + typecheck, workspace build clean. SDK client surface re-pointed at the
  host topology: npm `@noviscia/sdk` 0.6.0 + 9 crates.io crates (incl. standalone
  `noviscia-credit-line-sdk` building host `cl_*` discriminators).

---

## 8. Risks & gates

| Risk | Gate |
|---|---|
| Historically quoted (~1.1 MiB) BPF program-size ceiling — **NOT binding in SDK 2.x** | Deploy gate is `MAX_PERMITTED_DATA_LENGTH` = 10 MiB (`solana_bpf_loader_program` DeployWithMaxDataLen); C3 merged `.so` = 1.28 MB and `position-tracker.so` = 2.2 MB already ship. Re-verify each merge's `.so` via `cargo build-sbf --size`; split only if > 10 MiB |
| Folding a program into another changes its PDA seeds/authorities | Only re-point cross-cluster CPI+config PDAs where a live devnet truth exists; prefer preserving `declare_id` of the absorbing crate |
| SDK/CI breakage on freeze | Every stage edits SDK path-deps + Anchor.toml + workspace members atomically, then runs the SDK + program test suites |
| nv-usdc-vault grows (C3) into a bigger authority surface | One `vault_config.admin` spine governs vault + tranche + router (single authority boundary); growth headroom ~8.7 MB within the 10 MiB budget |
| compute budget (CPI hop savings vs. added logic) | Measure CU deltas on merged paths (esp. allocation + settlement) vs. baseline |
| parallel ledger truth remains if a stage is reverted | Each stage lands the ledger unification test (single source of truth assertion) alongside the merge |

---

## 9. Decision register (ratify before Stage 0)

| # | Question | Recommendation |
|---|---|---|
| D1 | Literal "4 program IDs" vs "4 clusters" | **4 clusters** (size constraint, §3) — 1 merged/1 kept per cluster, total deploy units ~7–8 |
| D2 | `sovereign-netting` home | **Absorb into `netting-engine`** (C1) — it is already CPI-only-consumed by netting |
| D3 | `tvv-gate` identity | **Preserve `noviscia-capacity` `declare_id`**, fold `asset-engine`+`jit-risk` in (no client/PDA migration) — **executed in Stage 2** (`asset_engine.rs`+`jit_risk.rs` submodules, 873,616 B, 66/66 tests) |
| D4 | `permissioned-pool` home | **C3 vault routing** (whitelisted routing beside the liquidity it routes). Fallback C2 was exercised (1.28 MB vs stale 1.1 MiB premise) then retracted once SDK 2.x's real 10 MiB budget was confirmed — **final: absorbed into `nv-usdc-vault`** |
| D5 | Cluster 4 lock semantics | **Legend of "no-upgrade lock"** via Anchor.toml `[programs.*]` deploy-map removal, not code deletion |
| D6 | Keep `position-tracker`/`clearing`/`netting` as separate deploy units | **Yes — they are size-required backbone layers, not redundant programs** |
| D7 | In-tree `shadow` freeze marker | Commit-guard note + `docs/CONSOLIDATION.md` regen step; no CI gate yet |

---

## 10. Acceptance criteria

After each stage (and before the final review sheet):
```bash
# full program test suites (all crates, incl. every absorbing program)
cargo test --workspace
# sandbox hub (26 tests: 50k leak, ring stress, spec REST, control plane)
cd services/sandbox-hub && cargo test
# SDK TS (117 tests) + typecheck
cd sdk && node --import tsx --test src/*.test.ts && npx tsc --noEmit
# size budget for any merged crate
cargo build-sbf --size     # no cluster > ~1 MB program-size ceiling
```
A stage is "done" only when the merged crate lands with **its ledger-unification test**
(the single-source-of-truth assertion) and zero regressions in the above.

---

*Blueprint stage complete. Next action: ratify §9 (D1–D7), then Stage 0 executes as a
commit. No code was moved in this stage.*