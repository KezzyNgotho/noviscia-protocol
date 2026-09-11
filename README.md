# Noviscia Protocol — Public Verification Surface

A **central counterparty (CCP) clearing house for Solana** — one on-chain omni-pool nets
offsetting risk across tenants, runs all margin as a single yield-bearing vault
(`nvscUSDC`), and absorbs defaults through a funded 5-layer waterfall before LPs are touched.

This repository is the **public, open-source layer** of Noviscia: the on-chain programs, the
verification corpus (formal invariant proof, adversarial parity fuzzer, docs), the client
SDKs, and the sandbox harness. It exists so that any auditor, regulator, or institutional
LP can independently verify the claims in `docs/INSTITUTIONAL_PROOF_PACKAGE.md`.

> **Status:** devnet operational (mainnet target Q1 2027, post-audit) · **License:** Apache-2.0

---

## Two-tier topology

| Tier | Repository | Contents |
|---|---|---|
| 🟢 Public (this repo) | `KezzyNgotho/noviscia-protocol` | Programs + invariants, sandbox emulators, SDKs, verification docs, parity fuzz suite, client harness |
| 🟡 Private | `KezzyNgotho/Noviscia-protocal` | Full monorepo including the off-chain **alpha strategy engine** (searcher, keeper, execution venues, bot configs) and operator tooling |

The private alpha repo builds against this public repo, pinned by tag — so the programs and
invariants here remain the single audited source of truth the strategy executes against.
Only operational secrets (signing keys, credentials) are excluded from both, per
`docs/CODE_ACCESSIBILITY_MATRIX.md`.

---

## Layout

```
programs/noviscia-tvv-gate/    TVV gate: slot-scoped contingent capacity, post-swap invariant
programs/noviscia-omni-pool/   nvscUSDC omni-vault: deposits, NAV accrual, DIF reserve
sdk/                           @noviscia/sdk — npm + Rust + C++ twins
scripts/chaos/                 adversarial invariant parity fuzzer
scripts/e2e/                   devnet e2e proofs
scripts/financial-model/       twin-pinned economics
sandbox-launcher/              local-ledger sandbox harness
services/grpc-pipeline/        on-chain event stream
services/indexer/              revenue indexer + REST surface
tests/chaos/                   committed fuzz evidence
docs/                          verification corpus (start at INDEX.md)
```

> Historical note: the consolidated program set is **`noviscia-tvv-gate`** +
> **`noviscia-omni-pool`** (post-consolidation). Older cluster references in the doc corpus
> describe the pre-consolidation topology and are flagged as such in
> `docs/CCP_CURRENT_STATE.md`.

---

## Verify it yourself (5 minutes)

```bash
# 1. Invariant algebra — Rust unit tests
cargo test -p noviscia-tvv-gate

# 2. Adversarial parity fuzz — 50,000 injections, zero leakage
npm run chaos:invariant:baseline
# asserts: leakage $0.00 on the post-swap carry invariant (docs/FORMAL_VERIFICATION.md)

# 3. SDK byte-parity twins
(cd sdk && npm test)
```

Read `docs/FORMAL_VERIFICATION.md` (the proof), `docs/CODE_ACCESSIBILITY_MATRIX.md`
(what a skeptic can re-run), and `docs/INSTITUTIONAL_PROOF_PACKAGE.md` (conviction
checklist). Full navigation: `docs/INDEX.md`.

---

## Repro / audit pointers

- **Unit tests:** `cargo test -p noviscia-tvv-gate` — `invariant_arithmetic_credits_positive_spread`,
  `settle_splits_twenty_percent_to_dif`, `breaker_trips_at_fifty_percent_jlf_drawdown`, …
- **Chaos suite:** `npm run chaos:invariant` (any seed) / `npm run chaos:invariant:baseline`
  (pinned seed `20260912`, byte-reproducible; evidence committed at `tests/chaos/`).
- **CI:** lint, fmt, clippy `-D warnings`, SBF builds, cargo test, SDK tests, chaos gate,
  cargo-audit, CodeQL, gitleaks — see `.github/workflows/ci.yml`.

---

## License & contributing

Apache-2.0 (see `LICENSE`). The private alpha engine is not part of this repository.
Security disclosures: see `docs/SECURITY.md`.