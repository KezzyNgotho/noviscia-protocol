# Noviscia — Documentation Gap Analysis

> **Purpose:** Identify, rank, and track documentation gaps across the Noviscia corpus. This is the
> companion to `AUDIT_GAP_ANALYSIS.md` (which tracks *functional/audit* gaps). Here we track
> *documentation* gaps.
>
> **Method:** Computed 2026-09 by (a) inventoring all 29 pre-existing `docs/` files + `README.md` +
> `sdk/README.md`, (b) scanning for incompleteness signals (`TODO`/`TBD`/`not yet`/`placeholder`
> /missing headings), (c) checking the entrypoint navigation, and (d) checking cross-doc link health.
>
> **Status:** Living · **Last updated:** September 2026

---

## TL;DR

The corpus is unusually strong for a pre-mainnet protocol (~5,700 lines across 29 docs, zero dangling
links, 83% of docs have status/date headers). The five critical gaps are **structural**, not
content-quality: no navigation hub, no technical extraction references (account map / error codes),
no threat model, no operationalized emergency response, and a thin mainnet/keys story. All five are
addressed by the documents marked **NEW** below.

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
| D8 | **Medium** | No disaster-recovery / extended-halt / state-reseed document | `MAINNET_READINESS.md` rollback = 5 steps | Rollback + degradation tiers exist; **IR/DR drill doc** remains open | 🔴 Open |
| D9 | **Low** | No Jito bundle developer integration doc (bundle construction, tip accounts, error handling) | only `PARTICIPANT_ACCESS.md` mention + SDK `jito.ts` | SDK README quickstart does not surface the Jito path | 🔴 Open |
| D10 | **Low** | No SLOs / SLIs defined; `MONITORING.md` says on-chain stack "needs setup" and logging is centralized-but-absent | `MONITORING.md` | Track on mainnet-readiness checklist | 🔴 Open |
| D11 | **Low** | `SYSTEM_DIAGRAMS.md` missing 5 flows (liquidation, netting, credit-line, staking, TVV slice lifecycle) | `SYSTEM_DIAGRAMS.md` §notes | Open; welcome contribution | 🔴 Open |
| D12 | **Low** | 5 docs lack status/date headers (`ARCHITECTURE.md`, `AUDIT_GAP_ANALYSIS.md`, `DOMAIN.md`, `LIGHT_MODE_DESIGN.md`, `MONITORING.md`); `CCP_CURRENT_STATE.md` is stale (2026-08-24) | header scan | Staleness sweep tracked below | 🔴 Open |

## 3. Quality signals

| Signal | Result |
|---|---|
| Inter-doc relative links checked | 34 |
| Dangling links | **0** |
| Docs with date/status header | 24 / 29 (83%) |
| Docs with `TODO`/`TBD`/`placeholder`/`not yet` signals | 7 / 29 |
| Corpus size | ~5,709 lines |

Known content inconsistencies to fix during review:

- `WHITEPAPER.md` says "15 active programs"; `README.md` says 19 (definitive count: 19, see
  `ARCHITECTURE.md` + `ACCOUNT_MAP.md`).
- `CODE_OF_CONDUCT.md` (Q1 2026) and `PRIVACY_POLICY.md` (2026-07) are older than the September
  update cadence — review for staleness before mainnet.

## 4. Remaining documentation work (suggested backlog)

1. **IR/DR drill document** (D8) — one-page runbook tying `ONCALL_RUNBOOK.md` steps to
   `MAINNET_READINESS.md` §rollback + degradation tiers, plus a quarterly-drill procedure.
2. **Integrator fix** (D9) — add a "Jito bundle" section to `sdk/README.md` with
   `getTipAccounts` / `getBundleTipLimits` and bundle-vs-error handling.
3. **SLO page** (D10) — define availability-targets and SLIs for indexer, RPC fallback, cranks;
   reference on mainnet readiness.
4. **Flow diagrams** (D11) — add mermaid sequence diagrams for the five missing flows.
5. **Staleness sweep** (D12) — add headers to the 5 unfixed docs; refresh `CCP_CURRENT_STATE.md`.

## 5. Maintenance rules (also in `INDEX.md`)

- **Program change → update** `ACCOUNT_MAP.md` + `ERROR_REFERENCE.md` in the same PR.
- **Operational change → update** `ONCALL_RUNBOOK.md` + `MONITORING.md`.
- **New doc → index it here and in `INDEX.md`**, with a status header.

---

## Cross-references

- Functional/audit gaps: [`AUDIT_GAP_ANALYSIS.md`](AUDIT_GAP_ANALYSIS.md)
- Navigation hub: [`INDEX.md`](INDEX.md)
- Repo entrypoint: [`README.md`](../README.md)