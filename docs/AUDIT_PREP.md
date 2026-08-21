# Security Audit Preparation Package

**Last updated:** July 7, 2026

Use this checklist when engaging a third-party auditor (target: pre-mainnet Q3 2026).

## Programs in scope

| Program | Path | Priority |
|---------|------|----------|
| position-tracker | `programs/position-tracker/src/lib.rs`, `state.rs` | P0 |
| nv-usdc-vault | `programs/nv-usdc-vault/src/lib.rs` | P0 |
| protocol-lp-vault | `programs/protocol-lp-vault/src/lib.rs` | P1 |
| staking-manager | `programs/staking-manager/src/lib.rs` | P1 |
| burn-engine | `programs/burn-engine/src/lib.rs` | P1 |

`escrow`, `lending-integrator`, `liquidation-vault` are **out of scope for the perps engine specifically** — `lending-integrator` has been deleted from the codebase entirely; `escrow` and `liquidation-vault` are legacy surfaces not in the current perps margin/liquidation path (see root `README.md`). Include them only if auditing the non-perps yield/lending product surfaces separately.

## Known design choices (not bugs)

- JIT (just-in-time) Pyth pull-oracle: every price-sensitive instruction verifies its own fresh guardian-signed VAA in-transaction, ≤3s freshness ceiling — not a continuously-updated price account, not CLOB-matched
- Margin is nvscUSDC shares only, locked (not redeemed) per position — no multi-asset weighted collateral in the current design
- One `Position` per (trader, market, sub_id); no increase/add-to-position instruction by design — a second open on an already-open tuple fails on-chain
- Liquidation is permissionless and self-liquidation-eligible (trader may liquidate their own position) — this is intentional, not a bypass
- External lending-venue CPI has been fully retired from `nv-usdc-vault` — `lend_mode` is hardcoded to 0

## Test artifacts

```bash
cargo test
npx tsx scripts/e2e-jit-open-close-devnet.ts
npx tsx scripts/e2e-tp-sl-devnet.ts
npx tsx scripts/e2e-limit-order-devnet.ts
npx tsx scripts/e2e-funding-devnet.ts
npx tsx scripts/e2e-liquidation-devnet.ts
```

Each `e2e-*-devnet.ts` script is a live proof against real devnet state, not a mock — auditors should be able to run these directly and cross-check the printed before/after numbers against the on-chain program logic.

## Off-chain scope

- Frontend transaction-building logic (`app/web/app/lib/position-tracker/`) — particularly the JIT-oracle retry logic (`jitOracle.ts`), which distinguishes retryable (oracle-staleness) from deterministic errors
- Optional `services/*` (indexer, price-feed, websocket) if in scope — each is independently dockerized; review their own auth/injection surface separately
- Crank automation is permissionless on-chain — no privileged off-chain key custody to review for `settle_funding`, `liquidate`, `execute_limit_order`, `execute_tp_sl`

## Deliverables requested from auditor

- Executive summary + severity-rated findings
- Remediation verification window
- Public summary for `docs/SECURITY.md` (optional)
