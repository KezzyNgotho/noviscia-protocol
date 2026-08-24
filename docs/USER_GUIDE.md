# Noviscia User Guide

**Audience:** Traders, LPs, tenants
**Network:** Solana devnet (mainnet guide ships with TGE — Q1 2027)
**Last updated:** August 24, 2026

---

## What is Noviscia?

Noviscia is a **central counterparty (CCP) clearing house** on Solana. It interposes on both sides of every trade (novation), nets offsetting risk, and runs all margin as a single yield-bearing omni-pool. When you use nvscUSDC as margin, those shares **never stop earning** — they compound from fees across all protocol products, not just your trade.

**You need:** Any Solana wallet (Phantom recommended) on **devnet**, plus devnet SOL for fees.

---

## Quick start

### Step 1 — Connect your wallet

1. Open the app at [noviscia.com](https://noviscia.com) (or `localhost:3000` locally).
2. Switch your wallet to **Solana Devnet**.
3. Click **Connect Wallet**.

### Step 2 — Get devnet tokens

- **SOL:** `solana airdrop 2 <YOUR_WALLET> --url devnet`
- **USDC:** The devnet USDC mint (`Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5`).

### Step 3 — Fund your margin

Go to **Trade → Perps** (`/trade/perps`). In the account panel below the order form:

1. Make sure **Deposit** is selected.
2. Pick an asset: **USDC** (straight deposit), or **SOL** / the current market's base asset / **Other** (any SPL mint — swapped to USDC via Jupiter, then minted into nvscUSDC).
3. Enter an amount, click **Deposit**, approve in your wallet.

> Non-USDC deposits require Jupiter routing — works on mainnet, limited on devnet.

### Step 4 — Open a position

1. Select a tradeable market (22 live: BTC, ETH, SOL, DOGE, LINK, AVAX, RENDER, WIF, JUP, RAY, TRUMP, PNUT, BONK, PEPE, OP, ARB, PYTH, JTO, ORCA, POPCAT, MEW, HNT).
2. Choose **Long** or **Short**, and **Market** or **Limit**.
3. Set leverage with the slider or preset buttons.
4. Optionally expand **TP / SL** for take-profit/stop-loss.
5. Click submit — the app verifies a fresh on-chain price (≤30s) and retries automatically if needed.

### Step 5 — Manage or close

- The **Positions** tab shows open positions, live PnL, and a Close button.
- Set or change TP/SL from the same tab.

---

## Product verticals

Noviscia is a multi-product clearing house. Here's what's live:

### Perpetual futures (`/trade/perps`)

| Feature | Status |
|---------|--------|
| 22 markets (BTC, ETH, SOL + 19 more) | Live |
| Up to 50× leverage | Live |
| JIT Pyth oracle (≤30s freshness) | Live |
| Market & limit orders | Live |
| TP/SL triggers | Live |
| TWAP orders | Live |
| Peer-to-peer funding | Live |
| Permissionless liquidation | Live |
| Portfolio margin (correlation matrix) | Live |
| Session delegates (hot wallet) | Live |

**Market tiers:**

| Tier | Markets | Max Leverage | Maint Margin | Fee |
|------|---------|-------------|-------------|-----|
| Blue-chip | BTC, ETH, SOL | 50× | 1% | 5 bps |
| Large-cap | DOGE, LINK, AVAX, RENDER | 20× | 2% | 10 bps |
| Mid-cap | WIF, JUP, RAY, TRUMP, PNUT, OP, ARB, PYTH, JTO, ORCA | 10× | 5% | 25 bps |
| Meme | BONK, PEPE, POPCAT, MEW | 5× | 10% | 50 bps |
| Catalog | HNT | 15× | 5% | 25 bps |

### Event / outcome markets (`/trade/prediction`)

Parimutuel clearing engine for binary and multi-outcome events. Compiled on-chain (`noviscia-clearing`) but not yet wired to the frontend — coming in Phase 2.

### Spot DEX

Constant-product AMM for base-pair trading. Deployed on-chain (`spot-dex`) — frontend integration planned.

### Cross-border settlement

Stablecoin settlement rails for cross-border transactions. Research phase — contract surface deployed (`cross-border`).

---

## Yield products

### nvscUSDC vault (`/earn/vault`)

Deposit USDC → mint nvscUSDC shares at current NAV. NAV compounds from **all protocol revenue** — perps fees, event fees, liquidation penalties. You can deposit here and use the resulting nvscUSDC as margin, or deposit/withdraw directly from the perps page.

**Yield is auto-compounding.** Every fee/liquidation event increases `total_assets`, which increases share value. No reinvest step needed.

### NVSC staking (`/earn/stake`)

| Tier | Minimum NVSC | Fee Discount |
|------|-------------|--------------|
| Bronze | 100 | 10% |
| Silver | 1,000 | 25% |
| Gold | 10,000 | 50% |
| Platinum | 100,00 | 100% (free trading) |

### Protocol LP (`/earn/lp`)

LP vault share of fee revenue. Deposit into the protocol's trading pool and earn a share beyond the vault yield.

---

## How margin compounding works ("Simultaneous Double-Yield")

Your nvscUSDC shares are locked per-position but never redeemed. A share's value is `total_assets / total_shares`, and `total_assets` grows from **every trader's fees across all products**. Your locked margin earns at the same rate as an un-locked deposit, for as long as your position stays open.

---

## Understanding liquidation

A position is liquidatable when equity drops below the maintenance margin:

```
equity < size_usdc * maintenance_margin_bps / 10_000
```

On liquidation: 20% to the liquidator, 80% retained (10% → insurance fund, 90% → vault NAV).

**Five-layer safety waterfall:**
1. Your locked collateral
2. Cross-margin from other products
3. Per-market insurance fund
4. Global default fund
5. CCP equity (house book)

**To avoid it:** monitor the Positions tab's health display and add margin or close before price approaches your liquidation level.

---

## Order types

| Type | Description |
|------|-------------|
| **Market** | Verifies fresh on-chain price, fills immediately |
| **Limit** | Rests on-chain until triggered — cancel anytime |
| **TWAP** | Time-weighted average price — N slices over T time |
| **TP/SL** | Take-profit / stop-loss — auto-closes at target price |

---

## Fees

| Fee type | Rate |
|----------|------|
| Trading (perps) | 5-50 bps depending on market tier |
| Funding | Variable, peer-to-peer — not a protocol fee |
| Liquidation | 20% of forfeited collateral to liquidator |

---

## CCP clearing model

Noviscia interposes on every trade — it is the buyer to every seller and the seller to every buyer (novation). This eliminates counterparty risk between traders and enables:

- **Cross-product margin** — Margin from one product can back positions in another
- **Multilateral netting** — Offsetting positions across tenants reduce settlement volume
- **Shared insurance** — A single default fund protects all products
- **Atomic recall** — Yield is recalled for margin calls in the same transaction as liquidation

---

## Common issues

**"Position already open"** — Each (wallet, market) pair supports one open position. Close the existing one first.

**"Insufficient collateral"** — Increase margin or lower leverage. Deterministic check, not a price-timing issue.

**"Verifying live price…" retries** — Only for oracle-staleness races (≤30s window). Normal behavior.

**Non-USDC deposit fails** — Expected on devnet; use USDC directly.

---

## Supported wallets

Phantom, Solflare, Backpack, Ledger (via Phantom). Any Solana wallet-adapter compatible wallet.

---

## Links

| Resource | |
|----------|-|
| App | https://noviscia.com |
| Discord | https://discord.gg/Noviscia-protocol |
| Twitter | https://twitter.com/noviscia |
| GitHub | https://github.com/noviscia/protocol |
