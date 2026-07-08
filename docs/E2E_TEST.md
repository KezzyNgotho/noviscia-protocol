# End-to-end testing (devnet)

**Last updated:** July 7, 2026 — rewritten around the current JIT-oracle perps flow (no escrow/auto-lend step; margin is nvscUSDC directly).

## Scripted e2e proof (preferred)

The most reliable way to verify the perps engine is the `scripts/e2e-*-devnet.ts` scripts — each exercises a real on-chain instruction path against the live devnet deployment with real (small) devnet funds, and prints exact before/after numbers rather than relying on eyeballing the UI:

```bash
npx tsx scripts/e2e-jit-open-close-devnet.ts     # open/close + trading-fee NAV proof
npx tsx scripts/e2e-tp-sl-devnet.ts               # take-profit / stop-loss
npx tsx scripts/e2e-limit-order-devnet.ts         # resting limit order placement + fill
npx tsx scripts/e2e-funding-devnet.ts             # peer-to-peer funding settlement
npx tsx scripts/e2e-liquidation-devnet.ts         # liquidation split + insurance fund (waits on a real price move)
npx tsx scripts/e2e-liquidation-eth-devnet.ts     # same, using a market config that's liquidatable at open (faster)
```

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
