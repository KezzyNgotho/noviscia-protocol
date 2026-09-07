# Noviscia Institutional Rollout — Three-Tier Frontend + System Checklist

> **Purpose:** Press-tested evidence kit for the institutional rollout. Two halves:
> **(Part A)** the three-tier frontend architecture that decouples the LP, developer
> (HFT/quant), and investor experiences; **(Part B)** the Comprehensive Institutional
> System Checklist — every item mapped to its enforcing code, its verification
> evidence, and its current status ahead of the Broady strategic review sessions.
>
> **Status:** Live · **Last updated:** September 2026 · **Verification basis:** commit
> `d7ee9e7` + `b618431` (C++/Rust byte-parity) + the checklist-closure work in this pass.

---

## Part A — The Three-Tier Institutional Frontend Architecture

One dApp, **three deliberately segregated surfaces**. The routing contract already
exists in `app/web/app/`; each surface is gated by the onboarding + role tier so a
retail LP never sees HFT tooling and a quant desk never sees yield-farming chrome.

```
                                ┌────────────────────────────────────────┐
                                │       THE NOVISCIA FRONTEND NODE       │
                                └───────────────────┬────────────────────┘
                                                    │
         ┌──────────────────────────────────────────┼──────────────────────────────────────────┐
         ▼                                          ▼                                          ▼
┌──────────────────────────┐               ┌──────────────────────────┐               ┌──────────────────────────┐
│ 1. THE LP DASHBOARD      │               │ 2. THE DEVELOPER SANDBOX │               │ 3. THE INVESTOR PORTAL   │
│   /liquidity-hub         │               │   /developers            │               │   /investors             │
│   /institutional/*       │               │   + sandbox-hub          │               │   + TVV risk feeds       │
└──────────────────────────┘               └──────────────────────────┘               └──────────────────────────┘
```

### Tier 1 — LP Dashboard (Liquidity Providers)

| Requirement | Where | Status |
|---|---|---|
| Enterprise custody (Fireblocks / Anchorage) connect screen | `app/web/app/institutional/*`, `docs/PARTICIPANT_ACCESS.md` (§2) | scaffolded |
| Sumsub corporate KYB gate before pool metrics | gate order in `PARTICIPANT_ACCESS.md`; on-chain KYC root via `noviscia-permissioned-pool` `set_kyc_root` + asset-engine Merkle KYC | partial (integration, see IV.1) |
| nToken vault view (nUSDC / nSOL / nNVSC) | `liquidity-hub` client + asset-engine `lp_mint` per-pool share ledger | present |
| Risk-isolated tranches vs. yield farming UI | Senior hurdle vs. Junior first-loss rendered in `institutional/` screens; economics pinned in `sdk/src/economics.ts` | present |
| Real-time appreciation ledger (micro-premium compounding) | settlement premium auto-compounds into pool vault (asset-engine `settle_splits_premium_between_lp_yield_*` test) | present |

### Tier 2 — Developer Sandbox (HFT / Quant Desks)

| Requirement | Where | Status |
|---|---|---|
| Headless API documentation + simulation console | the official headless spec implemented in `services/sandbox-hub` (gRPC `:10000`, bundles `:10001`, control plane `:10002` — see `SANDBOX_HUB.md` §6) | implemented |
| Token registration + `X-Noviscia-App-Token` credentials | developer shell `app/web/app/developer/api-tokens` — issue scoped (`read`/`write`/`admin`) tokens, revoke, one-time display; indexer enforces token-scoped authz (`INDEXER_AUTHZ=strict`) | **implemented** |
| Rust/C++ open-source SDK crates | `sdk/` (TS) + `sdk/rust/` (Rust twin) + `sdk/cpp/` (C++ twin) | present (all three); C++ twin byte-parity vs Rust 30/30 builders + 199 checks (`b618431`) |
| Latency logs (<2ms stream proof) | `scripts/sandbox/e2e-sandbox-verification.ts` Test 2 (median < 2ms) | verified |
| Jito Bundle Emulator metrics (zero capital leakage) | `emulator.rs` spec surface + 50,000-bundle test | verified |
| Non-Jito leader safety switch | `sdk/src/ability.ts` `guardNonJitoLeaderSlot` / `NonJitoLeaderError` | **new** |

### Tier 3 — Investor Portal (Venture / Risk Reviewers)

| Requirement | Where | Status |
|---|---|---|
| TVV macro data stream (Daily Capital Turnover) | `sdk/src/velocity.ts` — `$10M` base → `$414M`/day turnover math | present |
| Waterfall ledger caps (Senior/Junior/DIF) | `sdk/src/economics.ts`; waterfall rendered in `app/web/app/investors` | present |
| Risk Waterfall Health Board (DIF, fee reserves, junior headroom) | economics + `institutional/credit` screens; live drill via sandbox control plane §3 | partial (live board pane TBD) |
| Dynamic stress-tests | control-plane `time_compression_multiplier` + sentinel drill (proven live) | verified |

---

## Part B — The Comprehensive Institutional System Checklist

Legend: **PASS** = enforced + test-verified · **PARTIAL** = enforced, integration/owner
gap · **GAP** = external or not yet built. Evidence refs are file:line.

### I. Security & Execution Architecture

| # | Item | Status | Evidence |
|---|---|---|---|
| **I.1** | **Syscall asset verification** — Merkle KYC runs on the native `solana_program::keccak::hashv` SIMD syscall, ~150 CU per iteration | **PASS** | `programs/cluster-2-tvv-gate/noviscia-asset-engine/src/lib.rs:773` (`compute_kyc_hash`), `:792` (`keccak256_pair`) now route through the `hashv` syscall; order-folding proof depth bounded per iteration; `kyc_hash_and_merkle_proof_roundtrip` (asset-engine tests) |
| **I.2** | **wSOL parity compliance** — all native SOL traffic flows through wrapped-SOL interfaces for code symmetry across SOL/USDC/NVSC | **PASS** | Asset engine treats SOL as wSOL profile (`lib.rs` pool comment + `wsol_mint_matches_native_interop_profile` test); all three assets share identical SPL token methods — no native-rent/system-program path on the vault legs |
| **I.3** | **Zero capital leakage** — 50,000 consecutive failing arbitrage bundles revert atomically, pool principal untouched | **PASS** | `services/sandbox-hub/src/emulator.rs` `zero_capital_leakage_across_fifty_thousand_failing_rest_bundles` (50k × NOV_042, `landed==pending==0`, `rejected==50_000`) |

### II. Low-Latency Infrastructure & Ingestion

| # | Item | Status | Evidence |
|---|---|---|---|
| **II.1** | **gRPC ingestion threshold** — raw account changes decoded + pushed to SDK cache in < 2 ms | **PASS** | `e2e-sandbox-verification.ts` Test 2 (500 envelopes, `median < 2ms` budget, µs measured); spec `MarketVelocityStream` live-proven |
| **II.2** | **Non-Jito safety switch** — epoch shift to a non-Jito leader returns `NonJitoLeaderSlot` and blocks capacity allocation instantly | **PASS** | **new** `sdk/src/ability.ts` (`guardNonJitoLeaderSlot` / `assertJitoLeader` / `NonJitoLeaderError`, sync throw) + `ability.test.ts` (epoch-shift case) |
| **II.3** | **Hardware buffer redundancy** — lock-free ring (crossbeam-channel / disruptor loop) drains slot states asynchronously with no dropped connections or accumulating lag | **PASS** | **new** `services/sandbox-hub/src/ring.rs` (bounded crossbeam ring, `2^20`) + `run_ingestion_pump` drain thread wired into the subscriber (main.rs); `million_frames_no_drops_bounded_lag` (1M frames, order preserved, lag bounded) |

### III. Credit Clearinghouse & Financial Operations

| # | Item | Status | Evidence |
|---|---|---|---|
| **III.1** | **Concentration limit validation** — coordinated multi-desk borrow > 60% of pool (`$6,000,000`) is rejected on-chain | **PASS** | asset-engine `apply_allocation` enforces the aggregate ceiling (`CreditLimitExceeded`, `lib.rs:852`) across draws sharing the facility, plus per-asset pool ceiling (`AssetCapacityCeilingExceeded`, `:843`); **new** test `rejects_systemic_concentration_cap_breach` (draw to exactly `$6M`, overflow rejected, ledger untouched) + existing `enforces_per_asset_capacity_ceiling` |
| **III.2** | **Time-accelerated timeout check** — 1,440×; window breach → Risk Sentinel priority-flips to **Overdue** and freezes borrowing | **PASS (verified live)** | control-plane §3 (`control.rs` effective durations) + subscriber sentinel drill: arm → `OVERDUE` event → desk freeze; live smoke observed `posture=3 BREACHED`; asset-engine deterministic soft-lock `WindowOverdue` (`lib.rs:828`) |
| **III.3** | **Senior tranche circuit breaker** — 50% junior drain (`$1,500,000`) → global breaker freezes credit facilities | **PASS (model) / PARTIAL (auto-trip actor)** | `sdk/src/economics.ts` `hardLockTriggered` + `circuitBreakerDrainUsdCents` (50% → `$1.5M`) pinned by test; on-chain `breaker_authority` + `frozen` latch executable by the Emergency Risk Guard (1-of-3). Auto-dispatch of `freeze_credit_line` by a keeper when the model trips = owner wiring. |

### IV. Legal & Onboarding Compliance

| # | Item | Status | Evidence |
|---|---|---|---|
| **IV.1** | **SAS attestation mapping** — Sumsub webhook → on-chain SAS tx writing the approved corporate-identity PDA | **PARTIAL** | Provider-agnostic Merkle KYC root (`set_kyc_root` on asset-engine + `noviscia-permissioned-pool` de-Sumsub LP gate) implemented; **no SAS attester/relayer service exists in `services/` yet** — off-chain webhook → PDA-pointer relayer is the build + Sumsub contract |
| **IV.2** | **MLA cross-collateralization binding** — counsel sign-off on §8, NY commercial law jurisdiction | **GAP (external)** | Clause 6 “Security and Cross-Collateralization” + §3.4(b) remedies drafted in `docs/MASTER_LOAN_AGREEMENT.md`; **legal counsel sign-off + governing-law review is an external owner transfer**, not a build task |

---

## Rollout gate summary

| Tier | PASS | PARTIAL | GAP | Owner for closure |
|---|---|---|---|---|
| I — Security & Execution | 3/3 | — | — | — |
| II — Low-Latency | 3/3 | — | — | — |
| III — Credit Clearinghouse | 2 + model | auto-trip keeper wiring | — | keeper orchestration (breach→`freeze_credit_line`) |
| IV — Legal & Onboarding | — | SAS relayer build + Sumsub contract | counsel sign-off (§8 / NY law) | integrations team / external counsel |

**Acceptance commands (rerun before any review session):**
```bash
# sandbox-hub: 26 tests — 50k leak proof, ring stress, spec REST, control plane
cd services/sandbox-hub && cargo test
# asset-engine: 28 tests — hashv merkle, systemic cap, per-asset ceiling
cd programs/cluster-2-tvv-gate/noviscia-asset-engine && cargo test
# SDK: 117 tests — NonJitoLeaderSlot guard, economics breaker model, TVV
cd sdk && node --import tsx --test src/*.test.ts && npx tsc --noEmit
# live spec smoke (sentinels the hub; expect posture≥OVERDUE)
cd services/sandbox-hub && cargo run --example spec_smoke
```