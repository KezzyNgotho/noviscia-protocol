# Noviscia User Guide

**Audience:** Traders and liquidity users  
**Network:** Solana devnet (mainnet guide ships with TGE — Q3 2026)  
**Last updated:** July 2026

---

## What is Noviscia?

Noviscia is a perpetual futures exchange where your **margin earns yield while you are not trading**. You post collateral once, trade SOL/BTC/ETH perps, and let idle USDC compound in the **Sovereign Omni-Pool** — recalled atomically when you open a position. Every dollar of idle margin also earns a share of protocol trading fees, claimable anytime.

**You need:** Any Solana wallet (Phantom recommended) on **devnet**, plus devnet SOL for fees.

---

## Quick start (10 minutes)

### Step 1 — Connect your wallet

1. Open the app at [noviscia.com](https://noviscia.com) (or `localhost:3000` locally).
2. Switch your wallet to **Solana Devnet**.
3. Click **Connect Wallet**.

### Step 2 — Get devnet tokens

- **SOL:** Use `solana airdrop 2 <YOUR_WALLET> --url devnet` in terminal, or the Solana faucet.
- **USDC:** The in-app faucet or the devnet USDC mint (`Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5`).

### Step 3 — Deposit USDC to your escrow

1. Go to **Trade → Perps** (`/trade/perps`).
2. In the right account panel, enter a deposit amount and click **Deposit USDC**.
3. Approve the transaction. Your balance appears under **Balance**.

> Alternatively, go to **Earn → Vault** → **Deposit USDC** to mint nvscUSDC shares (yield-bearing). You can then use those shares as perp margin.

### Step 4 — Open a position

1. Select a **Live** market (SOL, BTC, or ETH — badge: Live).
2. Choose **Long** or **Short**.
3. Set your collateral amount and leverage using the radial slider.
4. Optionally set TP/SL prices.
5. Click the **Intent-Settle** button — the UI shows "Routing Intent → Atomically Settled ✅".
6. Your position appears in the **Positions** tab below.

### Step 5 — Claim yield

- Pending yield from your idle margin appears in the account panel under **Yield available**.
- Click **Claim** to receive USDC directly into your escrow.
- Or open the **Yield Tracker** tab at the bottom for detailed yield history.

---

## Product overview

### `/trade/perps` — Perps Terminal

The main trading interface, organized in four zones:

| Zone | Description |
|------|-------------|
| **Chart** | TradingView-style candles/bars/line/area · 1m–1d timeframes · entry & liquidation price lines |
| **Order book / Depth** | Live book · recent trades · funding rate chart · liquidity depth chart |
| **Order panel** | Long/Short tabs · Market/Limit/TWAP · radial leverage slider · TP/SL · intent-settle button |
| **Account panel** | USDC & SOL balance · Collateral Basket (multi-asset weights, margin power gauge) · auto-lend toggle |

**Bottom panel tabs:**

| Tab | Description |
|-----|-------------|
| Positions | Open positions with grace-window countdown, inline margin adjust, TP/SL, partial close |
| Open Orders | Active limit orders and TWAP slices |
| Trade History | Settled fills and closed positions |
| Pending Intents | TWAP and limit orders being routed |
| Yield Tracker | Idle capital, live yield odometer, claimable amount |

---

### `/trade/collateral` — Collateral Console

Dedicated capital management dashboard. Use this to:

- **Monitor your global risk** — NAV, effective margin power (after haircuts), utilization gauge, available to withdraw.
- **Manage all asset types** — USDC and SOL shown live with oracle prices, haircut factors, effective collateral values, and Deposit/Withdraw inline actions.
- **Stress-test your portfolio** — drag the volatility slider to simulate a SOL price crash and see exactly how your utilization gauge changes before it happens.
- **Check pool capacity** — circular cap rings show how much of the protocol's SOL and USDC pool limits are used.
- **Track idle yield** — live yield odometer, claimable counter, all-time earned, 7/30/90d sparkline.

**Collateral asset LTV table:**

| Asset | LTV (haircut) | Devnet |
|-------|---------------|--------|
| USDC | 100% | Live |
| SOL | 80% | Live |
| mSOL | 82% | Coming (mainnet mint) |
| jitoSOL | 82% | Coming (mainnet mint) |

**Depositing SOL as collateral:**
1. Go to `/trade/collateral`.
2. Select **SOL** in the asset selector.
3. Enter amount → **Deposit SOL**.
4. SOL is wrapped and stored in your `CollateralPosition` PDA.
5. When you next open a position, SOL is counted at 80% LTV alongside your USDC margin.

---

### `/analytics` — Analytics Dashboard

Protocol transparency engine with four zones:

| Zone | Data |
|------|------|
| **Macro Activity** | 24h / cumulative volume area charts, revenue donut (fees / liq. penalties / funding), per-market OI table (live from oracle PDAs) |
| **Solvency Terminal** | Insurance fund balance, bad debt counter ($0.00), MEV leaked ($0.00), three-tier safety status |
| **Oracle Matrix** | Pyth vs Switchboard live divergence chart, per-market confidence bps, settlement lag |
| **Inventory Matrix** | Vault TVL composition wheel, asset safety cap progress bars, global yield index compounding curve |

---

### `/earn/vault` — nvscUSDC Vault

Deposit USDC → mint nvscUSDC shares at current NAV. The vault deploys idle USDC into the Sovereign Omni-Pool. NAV compounds as the pool accrues protocol yield.

**To use as perp margin:** After minting nvscUSDC, deposit into your escrow from the **Margin** tab, or deposit USDC directly to escrow and enable **Auto-lend** (which automatically deploys idle USDC into the Omni-Pool).

---

### `/earn/stake` — NVSC Staking

Stake NVSC tokens to earn trading fee share and governance rights.

| Tier | Minimum NVSC | Fee Discount |
|------|-------------|--------------|
| Bronze | 100 | 10% |
| Silver | 1,000 | 25% |
| Gold | 10,000 | 50% |
| Platinum | 100,000 | 100% (free trading) |

---

## Sub-accounts

Sub-accounts let you run isolated strategies under the same wallet — different margin, positions, and risk for each.

**Creating a sub-account:**
1. In the perps terminal, use the sub-account switcher (top of account panel).
2. Click **New Sub-account** → enter a label (e.g. "Scalping", "Swing").
3. Deposit margin into the sub-account's dedicated escrow.
4. Positions opened in sub-account N are completely isolated from sub-account 0.

> One sub-account being liquidated cannot touch margin in another sub-account.

---

## Auto-lend (idle yield)

With **Auto-lend** enabled (default ON), idle USDC in your escrow is automatically deployed to the Sovereign Omni-Pool. Yield accrues continuously via the protocol's `fee_index` mechanism.

- **Idle USDC** = `escrow.usdc_balance - reserved_margin` (the slice not backing active positions).
- Yield appears as **pending** in the UI and the Yield Tracker tab.
- Click **Claim** to collect pending yield into your escrow balance.
- No lock-up: you can claim at any time, even with open positions.

The **Collateral Console** (`/trade/collateral`) shows a live yield odometer ticking up in real time.

---

## Understanding liquidation

A position is eligible for liquidation when:

```
effective_collateral < maintenance_margin_requirement
```

where `effective_collateral` = USDC balance + Σ (asset_balance × oracle_price × weight_bps / 10_000).

**Grace window:** On breach, the position enters a ~150-slot (~60 second) grace window before permissionless liquidation is unlocked. The **Grace** column in the Positions tab shows a countdown. Use this time to add margin or close the position.

**Three-tier safety:**
1. Your collateral absorbs the loss first.
2. If there's residual bad debt, the per-asset insurance fund absorbs it.
3. If the insurance fund is depleted (never happened on devnet), a socialized haircut on LPs is the last resort.

---

## Order types

| Type | Description |
|------|-------------|
| **Market** | Executes immediately at oracle consensus price |
| **Limit** | Queued on-chain; fills when market crosses limit price |
| **TWAP** | Splits order into N slices at T-second intervals; minimizes price impact |

Limit and TWAP orders appear in the **Open Orders** and **Pending Intents** tabs.

---

## Fees

| Fee type | Rate |
|----------|------|
| Open / close (market) | 0.08% of notional |
| Limit order fill | 0.04% maker / 0.08% taker |
| Funding rate | Variable; displayed in toolbar; settles 8-hourly |
| NVSC Gold tier | 50% discount on all fees |
| NVSC Platinum tier | 100% — free trading |

---

## Common issues

**"Escrow not initialized"** — First deposit triggers escrow creation. Approve the initialization transaction.

**"Insufficient margin"** — Your effective collateral (including SOL haircut) is below the required maintenance margin. Add USDC or SOL, or reduce position size.

**"Stale oracle"** — The oracle hasn't been updated within the staleness window. Usually resolves within a few seconds as the permissionless crank refreshes it.

**Position won't close** — If the oracle is stale, closing is blocked. Wait for the oracle to refresh, then retry.

**"Auto-lend recall failed"** — Rare: the Sovereign Omni-Pool's cash buffer is temporarily fully utilised. Retry after a few seconds; the pool rebalances automatically.

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
