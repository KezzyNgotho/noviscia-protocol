# Noviscia — Documentation Gap Analysis

> **Purpose:** Identify, rank, and track documentation gaps across the Noviscia corpus. This is the
> companion to `AUDIT_GAP_ANALYSIS.md` (which tracks *functional/audit* gaps). Here we track
> *documentation* gaps.
>
> **Method:** Computed 2026-09 by (a) inventoring all 31 pre-existing `docs/` files + `README.md` +
> `sdk/README.md` (29 pre-existing + 9 created under these gaps), (b) scanning for incompleteness
> signals (`TODO`/`TBD`/`not yet`/`placeholder`/missing headings), (c) checking the entrypoint
> navigation, and (d) checking cross-doc link health.
>
> **Status:** Living · **Last updated:** September 2026

---

## TL;DR

The corpus is unusually strong for a pre-mainnet protocol (~6,120 lines across 29 pre-existing docs
plus 9 gap-closing docs, zero dangling links, **100%** of docs carry status/date headers). All eleven
gaps are **closed** (D1–D12, with only D7 🟡 Partial); the backlog below is empty.

---

## 1. Coverage map (what exists)

See [`INDEX.md`](INDEX.md): 29 documents grouped into 9 categories, with statuses. The index is now
the canonical navigation hub and is linked from `README.md` §Documentation.

## 2. Gap register (severity-ranked)

| # | Severity | Gap | Evidence | Resolution | Status |
|---|----------|-----|----------|------------|--------|
| D1 | **High** | No documentation index / navigation hub — `README.md` linked only 13/29 docs; `MAINNET_READINESS.md`, `USER_GUIDE.md`, `INSOLVENCY_POLICY.md` invisible from entrypoint | README §Documentation (6 lines) | **[`INDEX.md`](INDEX.md)** created; README updated to link it | ✅ Closed |
| D2 | **High** | No cross-program PDA seed / account registry — architects only covered `position-tracker` (§3a) and `jit-risk` (TVV §8.1); auditors must reconstruct 19 programs from source | `ARCHITECTURE.md` §3a | **[`ACCOUNT_MAP.md`](ACCOUNT_MAP.md)** generated from all 19 `programs/active/` | ✅ Closed |
| D3 | **High** | No cross-program error-code reference — only the "6000 + index" pattern in `DEVNET.md` | `DEVNET.md`; frontend `jitOracle.ts` map | **[`ERROR_REFERENCE.md`](ERROR_REFERENCE.md)** generated | ✅ Closed |
| D4 | **High** | No threat model — `SECURITY.md` describes defenses but not adversary model / trust boundaries / attack paths | `SECURITY.md` (154 lines) | **[`THREAT_MODEL.md`](THREAT_MODEL.md)** | ✅ Closed |
| D5 | **High** | Emergency breaker & on-call playbook not operationalized — three-tier Squads governance described architecturally only | `ARCHITECTURE.md` §3n | **[`ONCALL_RUNBOOK.md`](ONCALL_RUNBOOK.md)** | ✅ Closed |
| D6 | **Medium** | No key-management / governance-ops doc — deployer single key `pm2tUw…` still upgrade authority on devnet; no rotation/ceremony/compromise procedure | `SECURITY.md`, `MAINNET_READINESS.md` checkboxes | **[`KEY_MANAGEMENT_GOVERNANCE.md`](KEY_MANAGEMENT_GOVERNANCE.md)** | ✅ Closed |
| D7 | **Medium** | No mainnet deployment runbook (Squads + timelock upgrades, multi-party ceremony) | `DEPLOYMENT.md` mainnet = 10-line placeholder | Folded into `KEY_MANAGEMENT_GOVERNANCE.md` §upgrades + `MAINNET_READINESS.md` | 🟡 Partial |
| D8 | **Medium** | No disaster-recovery / extended-halt / state-reseed document | `MAINNET_READINESS.md` rollback = 5 steps | **[`IR_DR_DRILL.md`](IR_DR_DRILL.md)** — recovery tiers, state-reseed drill, quarterly cadence, rollback cheat-sheet | ✅ Closed |
| D9 | **Low** | No Jito bundle developer integration doc (bundle construction, tip accounts, error handling) | only `PARTICIPANT_ACCESS.md` mention + SDK `jito.ts` | `sdk/README.md` §Jito Bundles — assembly + tip rotation + 429/rate-limit handling + devnet-decommission note | ✅ Closed |
| D10 | **Low** | No SLOs / SLIs defined; `MONITORING.md` says on-chain stack "needs setup" and logging is centralized-but-absent | `MONITORING.md` | **[`SLO_OBSERVABILITY.md`](SLO_OBSERVABILITY.md)** — service + on-chain SLOs, error budgets, observance prereqs | ✅ Closed |
| D11 | **Low** | `SYSTEM_DIAGRAMS.md` missing 5 flows (liquidation, netting, credit-line, staking, TVV slice lifecycle) | `SYSTEM_DIAGRAMS.md` §notes | §§6–10 added (grounded in real instruction names); program count 15 → 19 | ✅ Closed |
| D12 | **Low** | 5 docs lack status/date headers (`ARCHITECTURE.md`, `AUDIT_GAP_ANALYSIS.md`, `DOMAIN.md`, `LIGHT_MODE_DESIGN.md`, `MONITORING.md`); `CCP_CURRENT_STATE.md` is stale (2026-08-24) | header scan | Headers added to all 5; `CCP_CURRENT_STATE.md` banner refreshed (2026-09-05, asset-engine + RBAC + Jito field-test) | ✅ Closed |

## 3. Quality signals

| Signal | Result |
|---|---|
| Inter-doc relative links checked | 34 |
| Dangling links | **0** |
| Docs with date/status header | 38 / 38 (100%) |
| Docs with `TODO`/`TBD`/`placeholder`/`not yet` signals | 7 / 38 |
| Corpus size | ~6,120 lines (29 pre-existing + 9 created under D1–D12) |

Known content inconsistencies to fix during review:

- `WHITEPAPER.md` says "15 active programs"; `README.md` says 19 (definitive count: 19, see
  `ARCHITECTURE.md` + `ACCOUNT_MAP.md`). `SYSTEM_DIAGRAMS.md` now also says 19.
- `CODE_OF_CONDUCT.md` (Q1 2026) and `PRIVACY_POLICY.md` (2026-07) are older than the September
  update cadence — review for staleness before mainnet.

## 4. Remaining documentation work (suggested backlog)

All items D1–D12 are closed. Remaining work is *maintenance-only* and covered by the corpus rules
(§5) and the readiness gate in `MAINNET_READINESS.md`:

1. Re-review `CODE_OF_CONDUCT.md` and `PRIVACY_POLICY.md` staleness (flagged §3).
2. Refresh SLOs / error budgets in `SLO_OBSERVABILITY.md` after the first mainnet month.
3. Rerun the header + link checks whenever new docs are added.

## 5. Maintenance rules (also in `INDEX.md`)

- **Program change → update** `ACCOUNT_MAP.md` + `ERROR_REFERENCE.md` in the same PR.
- **Operational change → update** `ONCALL_RUNBOOK.md` + `MONITORING.md`.
- **New doc → index it here and in `INDEX.md`**, with a status header.

---

## Cross-references

- Functional/audit gaps: [`AUDIT_GAP_ANALYSIS.md`](AUDIT_GAP_ANALYSIS.md)
- Navigation hub: [`INDEX.md`](INDEX.md)
- Repo entrypoint: [`README.md`](../README.md)