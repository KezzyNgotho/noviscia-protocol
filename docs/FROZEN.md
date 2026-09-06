# Noviscia Frozen Programs Register

> **Purpose:** Single source of truth for the consolidation freeze policy
> (see [`CONSOLIDATION.md`](CONSOLIDATION.md) §7 — Stages 0–4).
> **Status:** Stages 0–4 executed · **Date:** September 2026
>
> **Policy:** FROZEN programs are **no longer deployed or evolved as standalone
> deployable units**. They remain in the Cargo workspace and keep compiling (their
> tests are the migration evidence for the absorbing programs), but they are muted
> in `Anchor.toml` `[programs.*]` and carry a `Status: FROZEN` banner in `lib.rs`.

---

## 1. Frozen at Stage 0 (absorption sources — newer institutional stack)

| Program | LOC | Absorbing host (cluster) | Evidence tests to carry forward |
|---|---|---|---|
| `noviscia-asset-engine` | 2,381 | C2 `noviscia-capacity` (tvv-gate) | ✅ **ABSORBED (Stage 2)** — `asset_engine.rs` submodule (2,382 LOC, 27 tests carried): `kyc_hash_and_merkle_proof_roundtrip`, `rejects_systemic_concentration_cap_breach`, `enforces_per_asset_capacity_ceiling`, `wsol_mint_matches_native_interop_profile`, premium + LP-share suites |
| `noviscia-capacity` | 1,297 | **host retained** (C2 — its `declare_id` survives as the tvv-gate ID) | `purchase_capacity` / `SlotLedger` / Merkle-KYC suites — host now **66/66** green (15 host + 27 asset + 24 jit); .so **873,616 B** ✓ |
| `noviscia-credit-line` | 749 | C1 `netting-engine` (ledger unification; funding instruction survives) | ✅ **ABSORBED (Stage 3)** — `credit_line.rs` submodule (7 tests carried): `pull_credit`/`repay_and_settle` atomicity + toll-splice suites |
| `noviscia-tranche-vault` | 961 | C3 `nv-usdc-vault` (buffer/tranche accounting) | ✅ **ABSORBED (Stage 1)** — `tranche_pool` module in the vault; 9 suites carried + 5 unification tests |
| `noviscia-permissioned-pool` | 1,125 | C3 `nv-usdc-vault` (whitelisted routing beside its liquidity) | ✅ **ABSORBED (Stage 1)** — `router_pool` module in the vault. A D4 fallback first redirected this to C2 against a stale 1.1 MiB deploy premise; SDK 2.x's real budget is 10 MiB (`MAX_PERMITTED_DATA_LENGTH`), so the router returned to the vault — vault 77/77 green, .so 1,277,488 B ✓ |

## 2. Frozen at Stage 2

| Program | LOC | Absorbing host (cluster) | Evidence tests to carry forward |
|---|---|---|---|
| `jit-risk` | 94 | C2 `noviscia-capacity` (fee-spine sweep 85/15) | ✅ **ABSORBED (Stage 2)** — `jit_risk.rs` submodule (2,061 LOC, 24 tests carried): `sweep_premiums` premium split suite. Vault `accumulate_protocol_fees` was re-pointed to also authorize the consolidated marketplace PDA (`[b"marketplace"]` under `JDsM18...` via new `CAPACITY_PROGRAM_ID` const) |

## 3. Frozen at Stage 3

| Program | LOC | Absorbing host (cluster) | Evidence tests to carry forward |
|---|---|---|---|
| `sovereign-netting` | 820 | C1 `netting-engine` (metrics/rent pricing) | ✅ **ABSORBED (Stage 3)** — `sovereign.rs` submodule (18 tests carried): `ReporterOp` metrics + rent-pricing + per-slot auction suite. CPI seam replaced by in-process `MetricsState` mutation on the host-owned `[b"metrics"]` PDA |

## 4. Phase-1-operational lock (Cluster 4 — no merge, no upgrade)

`token-nvsc` · `ve-nvs` · `staking-manager` · `yield-distributor` · `liquidation-vault`
— remain deployable but pinned as "locked" for the phase-1 sandbox trial (D5).

---

## 5. Freeze mechanics

1. **`Anchor.toml`** — remove the frozen programs from `[programs.devnet]` /
   `[programs.localnet]` / `[programs.mainnet]` maps (IDs retained below for deploy audits).
2. **`lib.rs`** — add the `Status: FROZEN` banner above `declare_id!`.
3. **Workspace** — kept as members (compile + tests must stay green for migration evidence).
4. **`docs/CONSOLIDATION.md`** — the migration plan is the only place frozen features may
   be reworked (into their absorbing host).

## 6. Frozen `declare_id` audit trail

```
noviscia-capacity         JDsM18uSZ1UJEP49XdKSjumdftpuZ8cJbpb8CkBaBiMc   (host — ID survives)
noviscia-asset-engine     5qpohgfMvV89oRJqcV7MrBxJJ95i7TgZ9VvUNdyZrMKb
noviscia-credit-line      8usJu6agjifCXYwSsRVoMWqm22h2HUSfebw1zEEHAMYg
noviscia-tranche-vault    9Sk1zLo7uprmtrskoZQS6zf1KFSNv4uTCxMsbqGVMCMb
noviscia-permissioned-pool BNLwfHfWyuPoDVs7LeX6vAep33k7fzhiTiYzW9Th5u2v
jit-risk                  3w9GrHBXpMNSc3P3kBWmHwkhEr1u5FBQrTiD4k3NAXwh   (Stage 2)
sovereign-netting         9YxL2Gk3cphCjxeKgfj2cnY4wCBDzej3L83jLGJ52Dyk   (Stage 3)
```