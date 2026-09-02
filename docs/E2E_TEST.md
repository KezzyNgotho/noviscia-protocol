# End-to-end testing (devnet)

**Last updated:** September 3, 2026 — rewritten around the current `scripts/e2e/` set and the JIT-oracle perps flow (no escrow/auto-lend step; margin is nvscUSDC directly).

## Scripted e2e proof (preferred)

The most reliable way to verify the on-chain engines is the `scripts/e2e/e2e-*-devnet.ts` scripts — each exercises a real on-chain instruction path against the live devnet deployment with real (small) devnet funds, and prints exact before/after numbers rather than relying on eyeballing the UI:

```bash
npx tsx scripts/e2e/e2e-jit-open-close-devnet.ts     # open/close + trading-fee NAV proof
npx tsx scripts/e2e/e2e-tp-sl-devnet.ts               # take-profit / stop-loss
npx tsx scripts/e2e/e2e-limit-order-devnet.ts         # resting limit order placement + fill
npx tsx scripts/e2e/e2e-funding-devnet.ts             # peer-to-peer funding settlement
```

The full verified script suite in `scripts/e2e/` covers the rest of the engine surface:

- `e2e-clearing-devnet.ts` — CCP clearing/close flow
- `e2e-core-trading-loop-devnet.ts` — end-to-end perps trading loop
- `e2e-mint-vault-devnet.ts` — nvscUSDC mint / vault setup
- `e2e-sol-collateral-devnet.ts`, `e2e-native-collateral-devnet.ts`, `e2e-multi-asset-collateral-devnet.ts` — collateral modes
- `e2e-netting-venue-devnet.ts` — venue registration + netting
- `e2e-jit-risk-devnet.ts` — JIT risk engine / premium sweeps
- `e2e-pyth-open-close-devnet.ts` — Pyth pull-oracle open/close
- `e2e-sub-accounts-devnet.ts` — sub-account lifecycle
- `e2e-nvsc-fee-split-devnet.ts`, `e2e-set-fee-split-devnet.ts` — fee-split configuration
- `e2e-reinit-staking-fee-pool-devnet.ts` — staking fee-pool reinit
- `e2e-phase3-8-smoke-devnet.ts` — phase 3–8 smoke coverage
- `e2e-verify-gap-fixes-devnet.ts` — verifies previously-flagged gap fixes
- `stress-tests-devnet.ts` — integration stress (`npm run test:integration`)
- `test-ix-devnet.js` — instruction builder sanity

Liquidations are executed **permissionlessly** on-chain (any wallet can crank them); the liquidation-vault split is covered by `cargo test` unit proofs and the on-chain insurance-book tests.

Each script logs its own pass/fail condition explicitly — read the final printed diff (NAV-per-share, `insurance_fund_usdc`, realized PnL) rather than just checking exit code.

## UI flow (wallet connected)

Run `cd app/web && npm run dev`, then walk the perps flow:

| # | Route | What to verify |
|---|--------|----------------|
| 1 | `/trade/perps` | Connect wallet · deposit USDC (or SOL/other via Jupiter — mainnet only) into margin |
| 2 | `/trade/perps` | Open a small Long or Short · position appears in Positions tab |
| 3 | `/trade/perps` | Set TP/SL on the open position · confirm it's stored (second approval) |
| 4 | `/trade/triggers` | Place a limit order · confirm it appears and can be cancelled |
| 5 | `/trade/perps` | Close the position · margin (plus/minus PnL) returns to wallet balance |
| 6 | `/trade/perps` | Withdraw from the margin panel · USDC lands back in wallet |
| 7 | `/earn/stake` | Stake panel · governance loads |

There is no escrow-initialization or auto-lend-toggle step in the current flow — margin is nvscUSDC/USDC directly, deposited from the perps page's own account panel.

## Common failure: deterministic vs. retryable errors

If a transaction fails, check the error code before assuming it's a price-timing issue — only `OracleStale` (Anchor code 6006) is worth retrying with a fresh price. Everything else (`InsufficientMargin`, position-already-open, etc.) is deterministic and needs an actual input change. See `app/web/app/lib/position-tracker/jitOracle.ts`'s `POSITION_ERROR_MESSAGES` map for the full list, or `docs/DEVNET.md`'s troubleshooting section.
