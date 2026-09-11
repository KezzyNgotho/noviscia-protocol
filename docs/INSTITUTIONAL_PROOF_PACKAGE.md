# Institutional Proof Package

> **Purpose:** The single cover document an institutional reviewer (LP allocator, auditor,
> clearing-house counterparty) needs to reach conviction on the TVV machinery. Every row
> maps an *assurance you care about* → *how it is demonstrated* → *where the artifact lives*.
> No claim in this package is unverifiable: each row has a reproducible command or a source
> cite, and the proof corpus is generated from the same repository you are reading.
>
> **Status:** Live · **Last updated:** September 2026

---

## 1. Conviction checklist

| Assurance | How it is demonstrated | Artifact | Status |
|---|---|---|---|
| Settlements never book a loss | Post-swap invariant `final_balance ≥ initial_pool_balance` enforced at `lib.rs:438–441`, atomically (revert, nothing persists) | `docs/FORMAL_VERIFICATION.md` §2, program source | **Live + enforced** |
| The invariant survives adversarial input | 50,000-injection parity fuzzer; all families rejected/landed correctly; leakage `$0.00`, seed pinned | `tests/chaos/chaos-invariant-report.json` · `npm run chaos:invariant:baseline` | **Live + reproducible** |
| The arithmetic matches on-chain reality | Rust unit tests pin the DIF 20% split & positive-spread credit; caps are bps of reserve | `cargo test -p noviscia-tvv-gate` | **Live** |
| You can check the code yourself | Single public repo; source, SDKs (TS/Rust/C++), IDLs, scripts all present | `docs/CODE_ACCESSIBILITY_MATRIX.md` §2 | **Live** |
| Risk & margin math is independently re-derived | Netting / exposure / concentration math is unit-tested and parity-replayed against the gate source | `cargo test -p noviscia-tvv-gate` · `tests/chaos/chaos-invariant-report.json` | **Live** |
| On-chain claims are measured, not simmed | Devnet measurement report marks each claim (atomicity/geyser noted 🟡 not-yet-measured) | `devnet-measurement-report.md` | **Measured repository** |
| Solvency is observable on-chain | Vault-vs-NAV solvency, insurance fund, DIF ledger derived from on-chain state; live product radar in the private repo, invariant documented here | `docs/FORMAL_VERIFICATION.md`, `docs/CCP_CURRENT_STATE.md` | **Live** |
| Adverse scenarios are rehearsed | Threat model, quantified risk pack (circuit breakers), IR/DR drills, sandbox no-drain proofs | `docs/THREAT_MODEL.md`, `docs/QUANTIFIED_RISK_PACK.md`, `docs/SANDBOX_HUB.md`, `docs/IR_DR_DRILL.md` | **Live / working** |
| Governance custody is tiered and documented | 3-tier council, timelocks, key rotation ceremonies, upgrade rules | `docs/KEY_MANAGEMENT_GOVERNANCE.md`, `docs/INSOLVENCY_POLICY.md` | **Working** |
| Legal posture is explicit | Devnet beta terms, non-custodial framing, sanctions/KYC/AML stance, MLA clause bridge | `docs/LEGAL.md`, `docs/COMPLIANCE.md`, `docs/MASTER_LOAN_AGREEMENT.md` | **Devnet beta** |
| Capital-loss path is bounded | 5-layer waterfall (margin → cross-margin → insurance → default fund → CCP equity) | `docs/INSOLVENCY_POLICY.md`, `docs/NOVISCIA_NARRATIVE.md` | **On-chain design** |

---

## 2. The evidence dossier (short reading order)

1. `docs/FORMAL_VERIFICATION.md` — the invariant, proven.
2. `docs/CODE_ACCESSIBILITY_MATRIX.md` — what a skeptic can re-run.
3. `docs/AUDIT_REPORT.md` + `docs/SECURITY.md` — self-assessment and posture.
4. `docs/QUANTIFIED_RISK_PACK.md` + `docs/TVV_SPEC_SHEET.md` — unit economics.
5. `devnet-measurement-report.md` — what is measured on-chain vs not yet.
6. `docs/CCP_CURRENT_STATE.md` — live topology on devnet.
7. `docs/INSTITUTION_ONBOARDING.md` — admission, KYC posture, runbook.

## 3. Reproducible proof commands (run as a checklist)

```bash
# invariant algebra
cargo test -p noviscia-tvv-gate

# adversarial parity fuzz — leakage must print $0.00
npm run chaos:invariant:baseline

# SDK byte-parity twins
(cd sdk && npm test)

# E2E flow against devnet
npm run test:flow
```

## 4. What this package does NOT claim

- **Not-audited:** `docs/AUDIT_REPORT.md` is a pre-audit shell with a 7-item self-assessment; a
  third-party audit is scheduled, not completed.
- **Not mainnet:** everything here is devnet reality (mainnet window Q1 2027, `docs/MAINNET_READINESS.md`).
- **Not zero leakage from every possible exploit:** leakage is *structurally zero against the
  settle path and its state machine* (proven), not a claim that no new attack surface can exist.
- **No hidden code in the verification surface:** the accessibility matrix states exactly
  what is public (this repo), what is deliberately private (the alpha strategy engine in its
  own repo), and which operational secrets never reach any repo — by design.

---

Related: `docs/FORMAL_VERIFICATION.md`, `docs/CODE_ACCESSIBILITY_MATRIX.md`,
`docs/INDEX.md` (navigation), `docs/MAINNET_READINESS.md`.