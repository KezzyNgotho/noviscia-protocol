# Noviscia User Guide

**Audience:** Traders and liquidity users  
**Network:** Solana devnet (mainnet guide will ship with TGE)  

---

## What is Noviscia?

Noviscia is a perpetual futures exchange where your **margin can earn yield while you are not trading**. Deposit once, trade SOL/BTC/ETH perps, and let idle USDC work across lending venues—with **automatic recall** when you open a position.

**You need:** Phantom (or any Solana wallet) on **devnet**, plus devnet SOL for fees.

---

## Quick start (5 minutes)

### 1. Connect wallet

1. Open the app (local: `http://localhost:3000` or your deployed URL).
2. Switch wallet to **Solana Devnet**.
3. Click **Connect Wallet**.

### 2. Get devnet USDC

Use the in-app faucet or devnet USDC mint configured for the deployment (`NEXT_PUBLIC_USDC_MINT` in env). You need USDC before depositing.

### 3. Mint NVSCUSDC (recommended path)

1. Go to **Earn → Vault** (`/earn/vault`).
2. **Deposit USDC** → receive **NVSCUSDC** shares at current NAV.
3. Open the **Margin** tab → **Deposit NVSCUSDC** into your escrow.

NVSCUSDC is yield-bearing vault shares used as perp margin.

### 4. Trade a perp

1. Go to **Trade → Perps** (`/trade/perps`).
2. Pick a **live** market: **SOL**, **BTC**, or **ETH** (badge: **Live**).
3. Choose margin: **NVSCUSDC** (default) or **USDC**.
4. Set collateral, leverage, long/short → confirm in wallet.

### 5. Close and claim

1. Close from the **Open Positions** panel on the perps page.
2. Go to **Earn → Rewards** to **claim** accumulated lend yield (if you used USDC auto-lend).

---

## Understanding markets vs margin

These are **different** choices:

| You choose | Meaning | Examples |
|------------|---------|----------|
| **Market** | What price you bet on | SOL-PERP, BTC-PERP, ETH-PERP |
| **Margin** | What you post as collateral | NVSCUSDC or USDC in escrow |

- **NVSCUSDC** = vault shares (earn NAV yield; primary margin).
- **USDC** = plain stable in escrow (can enable **auto-lend** on idle slice).
- **NVSC token** = governance & staking—not a perp market and not margin by default.

**Preview markets** (BONK, WIF, JUP, etc.) show **charts only** until marked **Live** in the catalog.

---

## Product flows

### Vault (`/earn/vault`)

| Tab | Action |
|-----|--------|
| **NVSCUSDC** | Deposit USDC → mint shares; redeem shares → USDC |
| **Margin** | Deposit / withdraw NVSCUSDC or USDC to escrow |
| **Markets** | View venue APYs and on-chain allocator weights |

### Perps (`/trade/perps`)

- Market selector with **Live** / **Soon** badges.
- Long / short, market or limit entry.
- TP/SL fields (UI; full on-chain binding = roadmap).
- Account summary: idle margin, lent amount, open positions.

### Stake (`/earn/stake`)

- Stake **NVSC** for governance and documented fee tiers.
- Vote on venue weight proposals.
- Unstake: partial = 7-day cooldown; full = instant.

### Rewards (`/earn/rewards`)

- Claim escrow lend yield.
- View burn pool and staking fee pool stats.

### Token (`/token`)

- NVSC supply, distribution, and utility overview.

---

## NVSCUSDC vs USDC margin

| | NVSCUSDC | USDC |
|--|----------|------|
| Yield | Vault NAV accrual | Optional idle lend (keeper) |
| Best for | Default perp margin | Users who want plain stable + lend toggle |
| Recall | Shares reserved on open | Keeper recalls lent USDC before open |

**Tip:** If you see a recall error, disable lending temporarily or wait for keeper recall, then retry open.

---

## Live perp markets (devnet)

| Market | Max leverage | Status |
|--------|--------------|--------|
| SOL-PERP | 50× | Live |
| BTC-PERP | 50× | Live |
| ETH-PERP | 50× | Live |
| Others in dropdown | Varies | Preview (charts only) |

---

## Fees (what you pay / earn)

| Event | What happens |
|-------|----------------|
| Open / close perp | Trading fee (split: burn + stakers) |
| Idle USDC lent | ~85% of yield to you; 15% to protocol burn pool |
| NVSCUSDC in vault | NAV grows from vault yield (85% retained in NAV) |

Exact bps are on-chain in `pt-config` and vault config.

---

## FAQ

**Can I trade without NVSCUSDC?**  
Yes—deposit USDC directly to escrow and select **USDC** margin on perps.

**Why is the trade button disabled on BONK?**  
That market is preview-only until oracle + keeper support is enabled.

**Do I need NVSC to trade?**  
No. NVSC is for staking and governance.

**Is this mainnet?**  
No—current deployment targets **devnet**. Mainnet is planned after audit (~Q3 2026).

**Where are my funds?**  
In your **escrow PDA** (non-custodial)—not in a centralized wallet.

**What if escrow shows “incompatible”?**  
Your escrow may be from an older program version. Use a fresh devnet wallet or ask ops to close the old escrow with admin key.

---

## Troubleshooting

| Issue | Try |
|-------|-----|
| Simulation failed / 2006 | See `DEVNET.md` — escrow upgrade or position-tracker deploy |
| Insufficient margin | Deposit more NVSCUSDC/USDC; recall lent funds |
| Oracle / mark stale | Ensure keeper is running (`npm run keeper:dev`) |
| BTC/ETH won’t open | Run `npm run init:perp-oracles` with deploy wallet |

---

## Learn more

- [Whitepaper](./WHITEPAPER.md)
- [Tokenomics](./TOKENOMICS.md)
- [Launch roadmap](./LAUNCH_ROADMAP.md)
- In-app: `/more/docs`

---

*Noviscia — Make idle capital work every second.*
