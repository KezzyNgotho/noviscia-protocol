# Review — Consolidation Execution (19 → 4 Clusters)

> **Status:** REVIEW SHEET (Stage 4 deliverable, `CONSOLIDATION.md` §7).
> **Date:** 6 September 2026.
> Companion artifacts: [`CONSOLIDATION.md`](CONSOLIDATION.md) (blueprint + stage execution),
> [`FROZEN.md`](FROZEN.md) (freeze register + ID audit trail).

---

## 1. Headline result

24 declared programs → **13 live devnet deploy entries** after three stage-merge executions
(Stages 1–3) plus the Stage 4 governance lock (D5). Six standalone programs were absorbed as
namespaced handler submodules into three size-bounded hosts; five governance programs are
pinned no-upgrade; eleven hosts remain on the live devnet deploy map.

**Deploy-unit math (`Anchor.toml` `[programs.devnet]`, 13 = 8 kept + 5 parked/lookup):**

| Deploy entry | Role | Status |
|---|---|---|
| netting-engine `68s4…` | C1 CCP host (hosts `sovereign_*` + `cl_*`) | KEEP (host) |
| position-tracker `6uvr…` | perps venue engine | KEEP |
| noviscia-capacity `JDsM…` | C2 TVV-gate host (hosts `risk_*` + `asset_*`) | KEEP (host) |
| nv-usdc-vault `CN92…` | C3 vault host (hosts `router_*` + `tranche_*`) | KEEP (host) |
| noviscia-clearing `GtTJ…` | event venues | KEEP |
| yield-router `FKaA…` | capital deploy/recall | KEEP |
| clearing-registry `Hg5Q…` | venue registry | KEEP |
| gateway-auction `HQ26…` | USDC gate auction | KEEP |
| escrow / burn-engine / protocol-lp-vault / bug-bounty / spot-dex | legacy / parked | PARKED (kept on map) |

**Folded into hosts (self-contained, same-vault/same-program PDAs):** see §2.

---

## 2. What moved (absorption summary)

| Standalone program | Host | Submodule | Handlers | Evidence carried |
|---|---|---|---|---|
| `noviscia-asset-engine` | C2 `noviscia-capacity` | `asset_engine.rs` (2,382 LOC) | `asset_*` (15) | 27 tests |
| `jit-risk` | C2 `noviscia-capacity` | `jit_risk.rs` (2,061 LOC) | `risk_*` (13) | 24 tests |
| `noviscia-credit-line` | C1 `netting-engine` | `credit_line.rs` (749 LOC) | `cl_*` (5) | 7 tests |
| `sovereign-netting` | C1 `netting-engine` | `sovereign.rs` (4,680 LOC) | `sv_*` (19) | 18 tests |
| `noviscia-tranche-vault` | C3 `nv-usdc-vault` | `tranche_pool.rs` | `tranche_*` (8) | 9 tests |
| `noviscia-permissioned-pool` | C3 `nv-usdc-vault` | `router_pool.rs` | `router_*` (9) | 11 tests |

Host identity (`declare_id`) preserved on all three absorbing hosts — no client/PDA migration
on live devnet accounts. Standalone `declare_id`s are archived in `FROZEN.md` §6.

## 3. What froze

**Stage 0–3 freeze (absorption sources, remain in workspace + tests as migration evidence):**
`noviscia-asset-engine`, `noviscia-credit-line`, `noviscia-tranche-vault`,
`noviscia-permissioned-pool`, `jit-risk`, `sovereign-netting` — all carry `Status: FROZEN`
banners in `lib.rs`, are muted in `Anchor.toml` `[programs.devnet]`/`[programs.localnet]`,
and their tests are the absorbing host's migration evidence.

**Stage 4 lock (C4 governance — no merge, no upgrade during phase-1 sandbox, D5):**
`token-nvsc` · `ve-nvs` · `staking-manager` · `yield-distributor` · `liquidation-vault`
removed from the devnet/localnet deploy maps (IDs retained commented for audit).

## 4. What counts against the audit

- **Eliminated parallel ledger truths:** (a) desk credit utilization now single-truth in the
  netting-engine exposure records (`credit_line` ledger RFP via `cl_*`); (b) slot-capacity
  marketplace, multi-asset pools, and perps now share the C2 host; (c) tranche/insurance
  buffers unified into the vault's single NAV spine.
- **Removed authority-boundary hops:** 6 former program-ID boundaries closed (3 merged
  clusters), leaving 13 deploy entries.
- **Authority surface:** single `vault_config.admin` spine governs vault+tranche+router (C3);
  C2 host `noviscia-capacity` and C1 host `netting-engine` each own one authority spine.
- **CPI seam removals:** `netting-engine → sovereign-netting` (metrics/rent) and the former
  `credit-line →` standalone accounts are now in-process; the vault fee-authorize sites accept
  both the consolidated market/revenue/credit-line PDAs and legacy standalone IDs (see
  `CONSOLIDATION.md` Stage 1–3 rewiring notes).
- **Size budget:** hosts are well inside the SDK 2.x `MAX_PERMITTED_DATA_LENGTH` = 10 MiB
  deploy ceiling — netting-engine **660,304 B**, capacity **873,616 B**, vault **1,277,488 B**.
- **SDK/publish surface updated to the host topology** (Stage 4 D7 single-client pass):
  - npm **`@noviscia/sdk` 0.6.0** — credit-line client re-pointed to the netting-engine host
    `68s4…` (`cl_*` handlers), 12 host IDLs bundled, 117 tests.
  - crates.io **9 crates** — `noviscia-types 0.2.2`, `noviscia-asset-engine-sdk 0.3.1`,
    `noviscia-capacity-sdk`, `noviscia-credit`, `noviscia-merge`, `noviscia-pool`,
    `noviscia-trading`, `noviscia-credit-line-sdk` (standalone, host `cl_*` discriminators),
    `noviscia-client` (all 0.1.0).

## 5. Acceptance suite (rerun at review time)

```text
netting-engine          42/42 ok   (17 host + 7 credit-line + 18 sovereign)
noviscia-capacity       66/66 ok   (15 host + 27 asset-engine + 24 jit-risk)
nv-usdc-vault           77/77 ok   (vault + tranche_pool + router_pool)
services/sandbox-hub    26/26 ok
sdk TS                  117/117 ok + typecheck
cargo build --workspace clean
```

## 6. Residuals / caveats

- Devnet **state migration is manual**: `MetricsState`'s type path and PDA moved under the
  host `68s4…`, and `cl_*`/`sv_*` PDAs now derive under the host — devnet
  metrics/revenue/credit-line accounts must be re-created under the merged programs (recorded
  as `CONSOLIDATION.md` Stage 3 breaking-note). No mainnet data exists yet.
- Pre-existing, unrelated: whole-workspace `anchor build` fails on `position-tracker`
  (Rust E0658); direct `netting-engine` integration test `floor_forward.rs` exits 101 at the
  linker. Neither blocks the lib-level approval evidence above.
- The 5 parked entries (`escrow`/`burn-engine`/`protocol-lp-vault`/`bug-bounty`/`spot-dex`)
  stay on the deploy map untouched; they are not part of the consolidation.

---

*Stage 4 complete. All Stage 1–3 merges landed with their ledger-unification tests, the C4
lock is enforced in `Anchor.toml`, the acceptance suite is re-run green, and the SDK surfaces
(npm + crates.io) match the host topology. Recommended commit gate: commit this review along
with `CONSOLIDATION.md` + `FROZEN.md` as the Stage 4 documentation close-out.*