# Noviscia Protocol Whitepaper

**Version:** 3.0
**Last updated:** July 6, 2026
**Status:** Devnet operational · Mainnet target Q1 2027 (post-audit)

> **Disclaimer:** This document describes the Noviscia protocol design and current devnet implementation. It is not financial advice, an offer of securities, or a commitment to future features. Mainnet parameters may change after audit and community review.

---

## Abstract

Noviscia is a perpetual DEX on Solana built around one idea: **margin shouldn't have to choose between backing a trade and earning yield.** Traders post **nvscUSDC** — a share of a single protocol-owned USDC vault — as margin. Opening a position locks those shares; it never redeems them. Since a share's value is `total_assets / total_shares`, and `total_assets` grows continuously from real trading-fee and liquidation revenue, locked margin keeps compounding at the same rate as an un-locked deposit, for the entire time it's backing leverage. We call this **Simultaneous Double-Yield**.

Every price-sensitive instruction — open, close, liquidate, take-profit/stop-loss — verifies a fresh, guardian-signed Pyth price update on-chain in the same transaction (a **JIT pull-oracle**), rather than trusting a continuously-updated price account. Funding between longs and shorts settles peer-to-peer, permissionlessly, as a pure function of open-interest skew. Liquidation is closed-loop: the entire penalty is split between the caller (20%) and the protocol (80%), with a slice of the protocol's share funding a real, physically-held per-market insurance reserve.

The protocol separates **yield-bearing margin** (nvscUSDC) from **governance** (NVSC). Trading fees and protocol yield feed a deflationary flywheel: NVSC is bought and burned, and stakers receive fee share plus governance over protocol parameters.

---

## 1. Problem

| Approach | Limitation |
|----------|------------|
| USDC sitting as margin in a perp wallet | Zero yield on collateral the whole time it's locked |
| External lending protocols for idle margin | Manual recall before every trade, third-party risk, and margin can't earn *and* back leverage at the same instant |
| Off-chain keeper-run oracle feeds | A trusted operator becomes a single point of failure and a censorship vector |
| Continuously-updated on-chain price accounts | Stale-price attack surface if the update crank stops running |

---

## 2. Solution

**Deposit → margin backs leverage AND keeps earning → close settles funding/fees back into the same yield.**

```
Trader's USDC (or any SPL asset, swapped via Jupiter)
  → nv-usdc-vault.deposit_usdc → mints nvscUSDC shares at live NAV
  → position-tracker.open_position_jit
       - verifies a fresh Pyth Hermes VAA on-chain (≤3s old)
       - locks nvscUSDC shares as collateral — never redeemed while open
       - charges a trading fee, swept into vault NAV
  → position open — locked shares compound NAV exactly like any other holder's
  → close_position / liquidate / execute_tp_sl
       - re-verifies a fresh JIT price
       - settles peer-to-peer funding into realized PnL
       - on liquidation: 20% bounty / 80% retained (10% of that → insurance fund)
```

**Design principles**

1. **Non-custodial** — funds live in program-derived accounts; users sign every action.
2. **Simultaneous Double-Yield** — locked margin never stops compounding vault NAV.
3. **JIT oracle verification** — every price-sensitive instruction proves its own fresh price on-chain; no ambient price account to go stale.
4. **Peer-to-peer funding** — funding is a transfer between longs and shorts, not protocol revenue, settled directly into PnL.
5. **Closed-loop liquidation** — the entire penalty resolves inside Noviscia's own programs; no external DEX routing, no slippage.
6. **Permissionless cranks** — funding settlement, liquidation, TP/SL and limit-order execution need no trusted operator.
7. **Dual-token clarity** — nvscUSDC earns and margins; NVSC governs and captures fee share.

---

## 3. Architecture

### 3.1 Programs

| Program | Role |
|---------|------|
| **position-tracker** | JIT-oracle perp engine: open/close/liquidate, peer-to-peer funding, insurance fund, trading fees, TP/SL, limit/TWAP orders |
| **nv-usdc-vault** | Single share-based USDC vault — USDC ↔ nvscUSDC at live NAV; receives all perp trading-fee and liquidation revenue |
| **protocol-lp-vault** | Additive trading-fee-backed LP vault |
| **staking-manager** | NVSC stake tiers (Bronze/Silver/Gold/Platinum); governance proposals |
| **burn-engine** | USDC fee accumulation; NVSC buyback & burn (permissionless trigger) |
| **token-nvsc** | Fixed-supply NVSC SPL token |
| **yield-distributor** | Non-perps yield split (legacy lending surface) |
| **prediction_market** | On-chain prediction markets (adjacent product, beta) |
| **escrow** | Legacy USDC/collateral/lending surface — **not** part of the perps margin path described in §2 |

### 3.2 Off-chain services

| Service | Role |
|---------|------|
| **Permissionless cranks** | `settle_funding`, `liquidate`, `execute_limit_order`, `execute_tp_sl`, `execute_twap_slice` — anyone can call these; none require a trusted operator |
| **Indexer** | Limit orders, fills, trade history |

### 3.3 Frontend

| Page | Route |
|------|-------|
| Perps terminal | `/trade/perps` |
| Triggers (limit orders) | `/trade/triggers` |
| Collateral Console | `/trade/collateral` |
| Analytics dashboard | `/analytics` |
| nvscUSDC vault | `/earn/vault` |
| NVSC staking | `/earn/stake` |
| Prediction markets | `/trade/prediction` |

---

## 4. Token economics

### 4.1 nvscUSDC — yield-bearing margin

- Share-based vault token, minted/burned at live NAV (`total_assets / total_shares`).
- NAV accrues from real perp trading fees and liquidation revenue — not an external yield source.
- Used directly as perp margin; **locking it as margin does not stop it from earning.**
- Not a governance token; no voting rights.

### 4.2 NVSC — governance and utility

| Property | Value |
|----------|-------|
| Supply | 1,000,000,000 fixed |
| Utility | Governance, fee tiers, staking fee share |
| Staking tiers | Bronze 100 · Silver 1K · Gold 10K · Platinum 100K NVSC |

**Planned distribution** (subject to change pre-TGE):

| Allocation | % | Vesting |
|------------|---|---------|
| Ecosystem | 35% | Various |
| Public sale | 25% | TGE unlock |
| Liquidity | 15% | TGE |
| Team | 15% | 4yr linear vest, 1yr cliff |
| Partners | 10% | 2yr vest |

### 4.3 Fee flows (perps)

| Source | Split |
|--------|-------|
| Perp trading fees (open + close) | 100% → nv-usdc-vault NAV |
| Liquidation penalty (100% of remaining collateral) | 20% liquidator bounty · 80% retained (10% of that → insurance fund, rest → vault NAV) |
| Peer-to-peer funding | 100% redistributed longs ↔ shorts — not protocol revenue |

Broader NVSC/burn-engine flows (bounty triggers, staking distribution) are documented in [`TOKENOMICS.md`](./TOKENOMICS.md).

**Burn flywheel:** USDC accumulates in the burn-engine PDA → a permissionless caller triggers a USDC→NVSC swap → on-chain `burn` destroys supply permanently.

---

## 5. Simultaneous Double-Yield

`Position.collateral_shares` are nvscUSDC shares moved into a per-position `collateral_vault` token account at open time. They are **never redeemed** while the position is open — the trader still owns them as shares, just locked.

```
share value = shares * (vault.total_assets / vault.total_shares)
```

`total_assets` increases from every trader's trading fees and every liquidation's retained penalty. A position that's been open for a week has margin worth strictly more (in USDC terms) than it was at entry, purely from vault-wide yield — on top of whatever price PnL and funding it's accrued. This was verified live on 2026-07-06: a real open→close cycle measurably increased NAV-per-share from the trading fee alone.

---

## 6. JIT Pyth pull-oracle

Every price-sensitive instruction carries a guardian-signed Wormhole VAA wrapping a Pyth Hermes price update, verified via the Pyth Receiver program's `post_update_atomic` inside the same transaction. A strict ≤3-second freshness ceiling is enforced before the price is trusted — old enough, and the instruction reverts (`OracleStale`) rather than executing against a stale number.

There is no continuously-updated on-chain price account to keep fresh, and therefore no off-chain keeper whose downtime could leave the protocol trading on stale data. A retry (fresh price fetch + a new wallet approval) is the normal, expected response when the freshness window races real network latency — not a sign of a broken oracle.

---

## 7. Peer-to-peer funding

`Market.funding_index` is a cumulative per-notional-dollar rate that moves only via the permissionless `settle_funding` instruction, as a pure function of open interest:

```
skew = long_oi_usdc - short_oi_usdc
delta_index = skew * FUNDING_RATE_BPS_PER_SETTLE * FUNDING_INDEX_SCALE / BPS_DENOMINATOR / total_oi
funding_index += delta_index
```

Each `Position` snapshots the index at entry; at close/liquidate/execute_tp_sl, the delta against the current index is computed and folded directly into the same realized-PnL number that flows through `settlement_vault`. Funding is a transfer between the long and short side of a market — never protocol revenue, never a separate pool.

---

## 8. Closed-loop liquidation + insurance fund

Liquidation is permissionless: any signer — including the position's own owner — may call it once equity drops below the market's maintenance-margin threshold. The entire remaining collateral is forfeit, split atomically in a single instruction:

- **20%** to whoever called it, paid directly in live nvscUSDC shares — no redemption, no external swap, no slippage.
- **80%** retained: of that, **10%** funds `Market.insurance_fund_usdc` — a real, physically-held per-market reserve sitting in the same `settlement_vault` that pays winning traders — and the rest boosts vault NAV for every remaining holder.

Nothing in this path touches an external AMM or DEX. This was verified live on 2026-07-06 against a real (if misconfigured) market: a genuine liquidation increased both `insurance_fund_usdc` and vault NAV-per-share by exactly the hand-computed expected amounts.

---

## 9. Three-tier safety

| Tier | Mechanism |
|------|-----------|
| 1 | The trader's own locked collateral absorbs first loss |
| 2 | Per-market `insurance_fund_usdc` — funded purely from that market's own liquidations |
| 3 | Vault NAV absorbs any further remainder |

Market risk parameters (`max_leverage_bps`, `maintenance_margin_bps`) are validated on-chain against a hard invariant as of 2026-07-06 — initial margin at max leverage must exceed the maintenance requirement — after a live misconfiguration on the ETH market (1000x leverage against 0.99% maintenance margin, making positions liquidatable at open with zero price movement) was found and corrected.

---

## 10. Roadmap

| Phase | Milestones | Target |
|-------|------------|--------|
| **Now** | JIT-oracle perps engine, live-NAV margin, funding + insurance fund, closed-loop liquidation, Collateral Console + Analytics UI | Live (devnet) |
| **Q3 2026** | Security audit prep, SDK v0.1.1 published, CCP netting engine + venue registration, 16 programs rebuilt | Complete |
| **Q4 2026** | Security audit, NVSC TGE preparation, mainnet program ID lock, deposit caps | In progress |
| **Q1 2027** | Mainnet soft launch, SOL perps live, production Pyth feeds | Planned |
| **Q2 2027+** | Expanded market catalog (16 markets), mobile PWA, any-collateral Jupiter routing | Planned |

---

## 11. Security & risk disclosures

- All programs are non-custodial and open-source.
- **Independent security audit has not yet been completed.** Mainnet deployment requires audit sign-off.
- Devnet deployment is for testing only; do not use mainnet funds.
- Smart contract bugs could result in loss of deposited funds — one such bug (a market risk-parameter misconfiguration on ETH) was found and fixed on devnet on 2026-07-06; the discovery-and-fix process is exactly what pre-mainnet audit and testing is for.
- DeFi is experimental software; use only funds you can afford to lose.

See [`SECURITY.md`](./SECURITY.md) and [`LEGAL.md`](./LEGAL.md) for full disclosures.
