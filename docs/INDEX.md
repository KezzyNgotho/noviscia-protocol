# Noviscia Documentation Index

> **Purpose:** The single navigation hub for the entire Noviscia documentation corpus. Start here.
>
> **Status:** Canonical guide · **Last updated:** September 2026
>
> Every document in `docs/` is grouped below by audience-and-purpose. Statuses are annotated so
> readers immediately know what is final, what is aspirational, and what requires attention before
> mainnet.

---

## Reading order

| If you are… | Start with |
|---|---|
| New engineer / contributor | `README.md` → `ARCHITECTURE.md` → `DOMAIN.md` (repo layout) → this index |
| Auditor (on-chain) | `DOC_GAPS.md` → `ACCOUNT_MAP.md` → `ERROR_REFERENCE.md` → `THREAT_MODEL.md` → `AUDIT_PREP.md` |
| Operator / on-call | `ONCALL_RUNBOOK.md` → `MONITORING.md` → `MAINNET_READINESS.md` → `DEPLOYMENT.md` → `DEVNET.md` |
| Integrator (SDK / API) | `sdk/README.md` → `API.md` → `PARTICIPANT_ACCESS.md` |
| Governance / legal | `KEY_MANAGEMENT_GOVERNANCE.md` → `MASTER_LOAN_AGREEMENT.md` → `INSOLVENCY_POLICY.md` → `LEGAL.md` |
| Product / investor | `NOVISCIA_NARRATIVE.md` → `WHITEPAPER.md` → `TOKENOMICS.md` → `QUANTIFIED_RISK_PACK.md` → `USER_GUIDE.md` |

---

## 1. Entry points & repo overview

| Doc | Lines | Status | Purpose |
|---|---|---|---|
| [`README.md`](../README.md) | 200 | Live | Repo layout, program roster, docs navigation, development quick start |
| [`DOMAIN.md`](DOMAIN.md) | 48 | Live | Custom-domain / Vercel / email / staging configuration |
| [`CCP_CURRENT_STATE.md`](CCP_CURRENT_STATE.md) | 261 | live snapshot (2026-08-24) | What is actually on-chain on devnet today; loss waterfall; topology gaps |

## 2. Protocol & architecture

| Doc | Lines | Status | Purpose |
|---|---|---|---|
| [`WHITEPAPER.md`](WHITEPAPER.md) | 264 | v4.1 | Protocol whitepaper: problem, solution, architecture, tokenomics, roadmap |
| [`NOVISCIA_NARRATIVE.md`](NOVISCIA_NARRATIVE.md) | 146 | Canonical narrative | "One balance sheet, two engines" — CCP clearing + TVV yield reconciliation |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 1,173 | Live (no date header) | Full system architecture: token design, all 19 programs, revenue model, oracles, risk, funding, off-chain infra, security |
| [`SYSTEM_DIAGRAMS.md`](SYSTEM_DIAGRAMS.md) | 120 | Live | Mermaid diagrams: system structure, trade flow, yield flow, deployment, AI layer |
| [`TVV_FINANCIAL_ENGINEERING.md`](TVV_FINANCIAL_ENGINEERING.md) | 637 | Design Phase | Financial engineering spec for the JIT time-slice marketplace (slot math, premium pricing, risk register) |
| [`TVV_CCP_INTEGRATION_AUDIT.md`](TVV_CCP_INTEGRATION_AUDIT.md) | 154 | Closed 2026-09-02 | Code-level truth table: which TVV–CCP integration claims are wired on-chain |

## 3. Audit-grade technical references

| Doc | Lines | Status | Purpose |
|---|---|---|---|
| [`ACCOUNT_MAP.md`](ACCOUNT_MAP.md) | — | Generated from source | **Global PDA seed + account registry** across all programs (auditors start here) |
| [`ERROR_REFERENCE.md`](ERROR_REFERENCE.md) | — | Generated from source | **Cross-program Anchor error codes** and the deterministic conversion rule |
| [`AUDIT_GAP_ANALYSIS.md`](AUDIT_GAP_ANALYSIS.md) | 150 | Living | Open/closed functional & audit gaps with remediation priorities |
| [`DOC_GAPS.md`](DOC_GAPS.md) | — | Living | **Documentation** gap analysis: coverage, quality signals, remaining work |
| [`AUDIT_PREP.md`](AUDIT_PREP.md) | 61 | Current | Third-party auditor engagement package: scope, known design choices, test artifacts |
| [`AUDIT_REPORT.md`](AUDIT_REPORT.md) | 100 | Pre-audit (placeholder) | Post-audit report shell; current 7-item self-assessment |
| [`THREAT_MODEL.md`](THREAT_MODEL.md) | — | Working | Formal security threat model: assets, trust boundaries, actors, attack paths, mitigations |

## 4. Security & operations

| Doc | Lines | Status | Purpose |
|---|---|---|---|
| [`SECURITY.md`](SECURITY.md) | 154 | Devnet, unaudited | Security best practices, CCP model, admin gates, permissionless cranks, audit status |
| [`ONCALL_RUNBOOK.md`](ONCALL_RUNBOOK.md) | — | Working | Incident response + emergency breaker playbook operationalizing the three-tier governance |
| [`MONITORING.md`](MONITORING.md) | 82 | Live (on-chain stack "needs setup") | Sentry, on-chain metrics, incident response outline, log aggregation |
| [`KEY_MANAGEMENT_GOVERNANCE.md`](KEY_MANAGEMENT_GOVERNANCE.md) | — | Working | Key custody, rotation, multi-sig ceremony, and the tiered upgrade/timelock operating model |
| [`MAINNET_READINESS.md`](MAINNET_READINESS.md) | 142 | Pre-mainnet | Pre-deployment checklist, migration steps, rollback plan, network-degradation architecture |

## 5. Deployment & environment runbooks

| Doc | Lines | Status | Purpose |
|---|---|---|---|
| [`DEVNET.md`](DEVNET.md) | 322 | Live | Devnet runbook: program IDs, deploy flow, troubleshooting, RPC, e2e verification, cap-wiring |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | 96 | Live (mainnet = placeholder) | Deploy & maintenance: frontend, programs, services, troubleshooting |
| [`E2E_TEST.md`](E2E_TEST.md) | 55 | Live | Scripted e2e proofs (`scripts/e2e/*`) + UI flow checklist |

## 6. Integration surfaces

| Doc | Lines | Status | Purpose |
|---|---|---|---|
| [`API.md`](API.md) | 239 | Live | REST / WS / TradingView API reference for the proxy + indexer surface |
| [`PARTICIPANT_ACCESS.md`](PARTICIPANT_ACCESS.md) | 165 | v1.0 | Institutional access flows: HFT borrower (headless) vs LP (dashboard) |

## 7. Economics, risk & token model

| Doc | Lines | Status | Purpose |
|---|---|---|---|
| [`TOKENOMICS.md`](TOKENOMICS.md) | 181 | Devnet | nvscUSDC (vault shares) vs NVSC (governance) + staking/burn |
| [`QUANTIFIED_RISK_PACK.md`](QUANTIFIED_RISK_PACK.md) | 159 | v1.0 | Audited unit-economics: $10M pool, slot math, tranche split, circuit breakers (Rust + TS pinned) |
| [`INSOLVENCY_POLICY.md`](INSOLVENCY_POLICY.md) | 80 | On-chain enforcement | Terminal-layer 5-tier loss waterfall; socialized loss; emergency powers |
| [`MASTER_LOAN_AGREEMENT.md`](MASTER_LOAN_AGREEMENT.md) | 331 | v1.0 | Binding institutional MLA (NY law) — clause ↔ on-chain instruction bridge table |

## 8. Legal, compliance & community

| Doc | Lines | Status | Purpose |
|---|---|---|---|
| [`LEGAL.md`](LEGAL.md) | 55 | Devnet beta | Terms of use & risk disclosure |
| [`COMPLIANCE.md`](COMPLIANCE.md) | 88 | Devnet beta | Regulatory posture: non-custodial, KYC/AML, sanctions, data privacy |
| [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md) | 95 | 2026-07 | Data collection, wallet reads, on-chain data, analytics |
| [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) | 51 | Q1 2026 | Community standards & governance etiquette |

## 9. Product & frontend

| Doc | Lines | Status | Purpose |
|---|---|---|---|
| [`USER_GUIDE.md`](USER_GUIDE.md) | 197 | Live | End-user guide: verticals, yield, liquidation, order types, fees |
| [`LIGHT_MODE_DESIGN.md`](LIGHT_MODE_DESIGN.md) | 103 | Artifact | Frontend light-mode palette & CSS custom properties |

---

## Status legend

| Status | Meaning |
|---|---|
| Live | Reflects current devnet reality; actively maintained |
| Generated from source | Machine-extracted from program source; keep in sync when programs change |
| Working | Authoritative working document; reviewed at mainnet as part of readiness |
| Living | Frequently updated; treat latest content as truth |
| Pre-mainnet / Pre-audit / Placeholder | Explicitly aspirational; do not rely on in production |
| Closed | Gap/item resolved on the date shown |

---

## Cross-cutting maintenance rules

1. **Every program change** (new seed, new account, new error variant, new instruction) must update
   `ACCOUNT_MAP.md` and `ERROR_REFERENCE.md` in the same PR.
2. **Every operational change** (new alert, new runbook step, new governance path) must update
   `ONCALL_RUNBOOK.md` and `MONITORING.md`.
3. Every doc should carry a `Status` / `Last updated` header; the five stale files are tracked in
   `DOC_GAPS.md` §5.
4. Relative links between docs must never dangle — the index above and the corpus are link-checked
   in `DOC_GAPS.md` §3.