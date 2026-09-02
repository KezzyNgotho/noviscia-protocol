# Security Audit Preparation Package

**Last updated:** September 3, 2026

Use this checklist when engaging a third-party auditor (target: pre-mainnet Q1 2027).

## Programs in scope

The scope below reflects the **15 live programs** in `programs/active/`. Parked programs in `programs/later/` (`bug-bounty`, `burn-engine`, `escrow`, `protocol-lp-vault`, `spot-dex`) are **deferred / out of scope** for the live-protocol audit.

| Program | Path | Priority |
|---------|------|----------|
| position-tracker | `programs/active/position-tracker/src/lib.rs`, `state.rs` | P0 |
| nv-usdc-vault | `programs/active/nv-usdc-vault/src/lib.rs` | P0 |
| netting-engine | `programs/active/netting-engine/src` | P0 |
| sovereign-netting | `programs/active/sovereign-netting/src` | P0 |
| jit-risk | `programs/active/jit-risk/src` | P0 |
| gateway-auction | `programs/active/gateway-auction/src` | P0 |
| noviscia-clearing | `programs/active/noviscia-clearing/src` | P1 |
| clearing-registry | `programs/active/clearing-registry/src` | P1 |
| noviscia-credit-line | `programs/active/noviscia-credit-line/src` | P1 |
| staking-manager | `programs/active/staking-manager/src/lib.rs` | P1 |
| ve-nvs | `programs/active/ve-nvs/src` | P1 |
| yield-router | `programs/active/yield-router/src` | P1 |
| yield-distributor | `programs/active/yield-distributor/src` | P1 |
| token-nvsc | `programs/active/token-nvsc/src` | P1 |
| liquidation-vault | `programs/active/liquidation-vault/src` | P1 |

**Out of scope:** `lending-integrator` has been deleted from the codebase entirely. Parked programs (`bug-bounty`, `burn-engine`, `escrow`, `protocol-lp-vault`, `spot-dex`) are deferred — include them only when they move to `programs/active/`. `escrow` and `liquidation-vault` are not part of the current JIT perps margin/liquidation path (see root `README.md`); `liquidation-vault` is included above as it is a live active program.

## Known design choices (not bugs)

- JIT (just-in-time) Pyth pull-oracle: every price-sensitive instruction verifies its own fresh guardian-signed VAA in-transaction, ≤30s freshness ceiling — not a continuously-updated price account, not CLOB-matched
- Margin is nvscUSDC shares only, locked (not redeemed) per position — no multi-asset weighted collateral in the current design
- One `Position` per (trader, market, sub_id); no increase/add-to-position instruction by design — a second open on an already-open tuple fails on-chain
- Liquidation is permissionless and self-liquidation-eligible (trader may liquidate their own position) — this is intentional, not a bypass
- External lending-venue CPI has been fully retired from `nv-usdc-vault` — `lend_mode` is hardcoded to 0

## Test artifacts

```bash
cargo test
npx tsx scripts/e2e/e2e-jit-open-close-devnet.ts
npx tsx scripts/e2e/e2e-tp-sl-devnet.ts
npx tsx scripts/e2e/e2e-limit-order-devnet.ts
npx tsx scripts/e2e/e2e-funding-devnet.ts
```

Each `scripts/e2e/e2e-*-devnet.ts` script is a live proof against real devnet state, not a mock — auditors should be able to run these directly and cross-check the printed before/after numbers against the on-chain program logic.

## Off-chain scope

- Frontend transaction-building logic (`app/web/app/lib/position-tracker/`) — particularly the JIT-oracle retry logic (`jitOracle.ts`), which distinguishes retryable (oracle-staleness) from deterministic errors
- Optional `services/*` (indexer, price-feed, websocket) if in scope — each is independently dockerized; review their own auth/injection surface separately
- Crank automation is permissionless on-chain — no privileged off-chain key custody to review for `settle_funding`, `liquidate`, `execute_limit_order`, `execute_tp_sl`

## Deliverables requested from auditor

- Executive summary + severity-rated findings
- Remediation verification window
- Public summary for `docs/SECURITY.md` (optional)
