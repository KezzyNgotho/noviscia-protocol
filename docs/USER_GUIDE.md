# Noviscia User Guide

**Audience:** Traders
**Network:** Solana devnet (mainnet guide ships with TGE — Q3 2026)
**Last updated:** July 7, 2026

---

## What is Noviscia?

Noviscia is a perpetual futures exchange where **the margin backing your leveraged position never stops earning**. You post nvscUSDC — a share of the protocol's USDC vault — as margin. Opening a position locks those shares, but never redeems them, so they keep compounding the vault's NAV the entire time they're backing your trade.

**You need:** Any Solana wallet (Phantom recommended) on **devnet**, plus devnet SOL for fees.

---

## Quick start

### Step 1 — Connect your wallet

1. Open the app at [noviscia.com](https://noviscia.com) (or `localhost:3000` locally).
2. Switch your wallet to **Solana Devnet**.
3. Click **Connect Wallet**.

### Step 2 — Get devnet tokens

- **SOL:** `solana airdrop 2 <YOUR_WALLET> --url devnet`, or a Solana faucet.
- **USDC:** The devnet USDC mint (`Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5`).

### Step 3 — Fund your margin

Go to **Trade → Perps** (`/trade/perps`). In the account panel below the order form:

1. Make sure **Deposit** is selected (toggle at the top of the panel).
2. Pick an asset: **USDC** (straight deposit), or **SOL** / the current market's base asset / **Other** (any SPL mint — swapped to USDC via Jupiter, then minted into nvscUSDC in one flow).
3. Enter an amount, click **Deposit**, approve in your wallet.

> Non-USDC deposits require live Jupiter routing and currently only settle on mainnet — devnet has no Jupiter liquidity, so test with USDC directly.

### Step 4 — Open a position

1. Select a tradeable market (SOL, BTC, or ETH — others show "Coming soon").
2. Choose **Long** or **Short**, and **Market** or **Limit**.
3. In the **Margin** field, either use your existing nvscUSDC/USDC balance, or pick SOL/another asset directly here too — the same swap-then-deposit flow can chain straight into opening the position behind one submit click.
4. Set leverage with the slider or preset buttons.
5. Optionally expand **TP / SL** to set a take-profit/stop-loss at open — this is a separate wallet approval right after the position opens (bundling it into the same transaction would exceed Solana's size limit).
6. Click the submit button (**Long/Short {asset}**, or **Swap & Long/Short {asset}** if using non-USDC margin). The button shows "Verifying live price…" while it fetches and verifies a fresh on-chain price — if that races the strict 3-second freshness window, it retries automatically with one new approval.
7. Your position appears in the **Positions** tab below.

### Step 5 — Manage or close

- The **Positions** tab shows your open positions, live PnL, and a Close button.
- Set or change TP/SL from the same tab.
- Closing re-verifies a fresh price the same way opening does.

---

## Product overview

### `/trade/perps` — Perps Terminal

| Zone | Description |
|------|-------------|
| **Chart** | TradingView-based candles, your open positions' entry/liquidation lines overlaid |
| **Order form** | Long/Short, Market/Limit, margin asset picker, leverage slider, TP/SL, order summary (size, entry, liquidation price), submit |
| **Account panel** | Wallet nvscUSDC balance, locked-in-positions total, unrealized PnL, Deposit/Withdraw |

**Bottom panel tabs:**

| Tab | Description |
|-----|-------------|
| Positions | Open positions — live PnL, health, close, set TP/SL |
| Open Orders | Resting limit orders — cancel anytime |
| Activity | Recent opens/closes/liquidations this session |
| Portfolio | Aggregate margin, locked amount, average leverage, worst-case liquidation distance, unrealized/realized PnL across all open positions |
| FAQ | In-page help |

---

### `/trade/triggers` — Triggers board

Shows resting limit orders across markets and lets any wallet permissionlessly fill one at its trigger price, or lets the order's owner cancel it.

---

### `/trade/collateral` — Collateral Console

Capital management view — balances, positions, and utilization at a glance. (Not re-verified against current code this cycle; treat specifics as approximate until checked against the live UI.)

---

### `/analytics` — Analytics Dashboard

Protocol transparency dashboard — volume, open interest, and solvency metrics. The oracle section reflects the current single-feed JIT Pyth design, not a Pyth-vs-Switchboard comparison (Switchboard has been fully removed from the perps engine). Full zone-by-zone specifics not re-verified this cycle.

---

### `/earn/vault` — nvscUSDC Vault

Deposit USDC → mint nvscUSDC shares at current NAV. NAV compounds from real protocol trading-fee and liquidation revenue — the same mechanism backing perps margin. You can deposit here and use the resulting nvscUSDC as margin on the perps page, or deposit/withdraw directly from the perps page's own account panel.

**Yield is auto-compounding — no reinvest step exists, and none is needed.** Every fee/liquidation event is booked into the vault's `fee_index` (a 1e18-scaled cumulative yield index) and into `total_assets`. Because a share's value is `total_assets / total_shares`, that yield is already embedded in your shares: your position grows on its own, there is no keeper to run and no "compound" button to press.

- **Claim as USDC:** the vault's `claim_yield` realizes yield accrued since your last snapshot — it burns a few shares worth the claim and sends you real USDC. The *Earn → Vault → Your yield* card shows the claimable amount. Remaining shares keep compounding from where the snapshot advanced.
- **No ledger inflation:** the on-chain `compound` instruction only advances your snapshot for reporting; it does **not** mint shares or add phantom `total_assets`. Earlier versions re-added already-booked yield to `total_assets`, which let one user's compound+redeem sequence leave the vault under-collateralized — that path was removed.

---

### `/earn/stake` — NVSC Staking

Stake NVSC tokens to earn trading fee share and governance rights.

| Tier | Minimum NVSC | Fee Discount |
|------|-------------|--------------|
| Bronze | 100 | 10% |
| Silver | 1,000 | 25% |
| Gold | 10,000 | 50% |
| Platinum | 100,000 | 100% (free trading) |

(Fee-discount percentages not re-verified against current `staking-manager` code this cycle.)

---

## How margin compounding works ("Simultaneous Double-Yield")

Your nvscUSDC shares aren't redeemed when you use them as margin — they're transferred into a per-position vault and held as shares. A share's redeemable value is `total_assets / total_shares` on the vault, and `total_assets` grows continuously from every trader's fees and every liquidation's retained penalty. That means your locked margin keeps earning at exactly the rate an un-locked deposit would, for as long as your position stays open — you don't have to choose between trading and earning.

---

## Understanding liquidation

A position becomes eligible for liquidation the instant its equity (locked margin value + unrealized PnL, including funding) drops below the market's maintenance-margin requirement:

```
equity < size_usdc * maintenance_margin_bps / 10_000
```

There is no grace-window countdown — liquidation is checked directly against current equity whenever someone (anyone) calls it. On liquidation, your entire remaining collateral is forfeit: 20% to whoever called it, 80% retained by the protocol (10% of that funds the market's insurance reserve, the rest boosts vault NAV for everyone else).

**Three-tier safety:**
1. Your own locked collateral absorbs the loss first.
2. The market's own insurance fund (`insurance_fund_usdc`) covers any shortfall.
3. Vault NAV absorbs any further remainder.

**To avoid it:** keep an eye on the Positions tab's health/liquidation-price display, and add margin or close before price gets close to your liquidation price.

---

## Order types

| Type | Description |
|------|-------------|
| **Market** | Verifies a fresh on-chain price and fills immediately |
| **Limit** | Rests on-chain until a keeper (or you, from the Triggers board) fills it at your trigger price — cancel anytime from Open Orders |

---

## Fees

| Fee type | Rate |
|----------|------|
| Open / close (perps) | 0.05% of notional (devnet SOL/BTC/ETH markets — admin-adjustable per market, capped at 5%) |
| Funding | Variable, peer-to-peer between longs and shorts — not a protocol fee |

NVSC staking-tier fee discounts exist but weren't re-verified against current code this cycle — see [`docs/USER_GUIDE.md`](#earnstake--nvsc-staking) staking section above and `staking-manager`'s source for the authoritative numbers.

---

## Common issues

**"Position already open"** — Each (wallet, market) pair can only have one open position at a time; there's no add-to-position instruction yet. Close the existing one first.

**"Live nvscUSDC collateral value is insufficient for the requested position size"** — Your margin doesn't meet the minimum for the size/leverage you entered. Increase margin or lower leverage. This fails immediately (one approval) rather than retrying — it's a deterministic check, not a price-timing issue.

**"Verifying live price…" retries** — Only happens for a genuine oracle-staleness race (the on-chain price must be ≤3 seconds old); every other error surfaces immediately without retrying.

**Non-USDC deposit/open fails with "no swap route"** — Expected on devnet; Jupiter has no devnet liquidity. Use USDC/nvscUSDC directly for devnet testing.

---

## Supported wallets

Phantom, Solflare, Backpack, Ledger (via Phantom). Any wallet supporting Solana's wallet-adapter standard.

---

## Links

| Resource | |
|----------|-|
| App | https://noviscia.com |
| Discord | https://discord.gg/Noviscia-protocol |
| Twitter | https://twitter.com/noviscia |
| Bug reports | https://github.com/noviscia/protocol/issues |
| Whitepaper | [`WHITEPAPER.md`](./WHITEPAPER.md) |
| Architecture | [`ARCHITECTURE_V2.md`](./ARCHITECTURE_V2.md) |
