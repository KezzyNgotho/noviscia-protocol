# Noviscia Protocol Whitepaper

**Version:** 4.0
**Last updated:** August 24, 2026
**Status:** Devnet operational · 16 programs on-chain · 22 perp markets live · Mainnet target Q1 2027 (post-audit)

> **Disclaimer:** This document describes the Noviscia protocol design and current devnet implementation. It is not financial advice, an offer of securities, or a commitment to future features. Mainnet parameters may change after audit and community review.

---

## Abstract

Noviscia is a **central counterparty (CCP) clearing house** on Solana. It interposes on both sides of every trade (novation), nets offsetting risk across tenants, runs all margin as a single yield-bearing omni-pool, and absorbs default losses through a funded 5-layer waterfall before LPs are ever touched.

The protocol supports multiple product verticals through a shared clearing infrastructure:

- **Perpetual futures** — up to 50× leverage, 22 markets, JIT Pyth oracle, peer-to-peer funding
- **Event / outcome markets** — parimutuel clearing engine for binary and multi-outcome events
- **Spot DEX** — constant-product AMM for base-pair trading
- **Cross-border settlement** — stablecoin settlement rails (research phase)
- **Tenant settlement web** — DEX/GameFi/RWA frontends route settlement into the CCP

Traders post **nvscUSDC** — a share of the protocol's USDC vault — as margin. Opening a position locks those shares; it never redeems them. Since a share's value is `total_assets / total_shares`, and `total_assets` grows continuously from real trading-fee and liquidation revenue across all tenants, locked margin keeps compounding at the same rate as an un-locked deposit, for the entire time it's backing leverage. We call this **Simultaneous Double-Yield**.

The protocol separates **yield-bearing margin** (nvscUSDC) from **governance** (NVSC). Trading fees and protocol yield feed a deflationary flywheel: NVSC is bought and burned, and stakers receive fee share plus governance over protocol parameters.

---

## 1. Problem

| Approach | Limitation |
|----------|------------|
| Fragmented per-product liquidity | Each market operates its own margin pool — capital inefficient |
| USDC sitting as margin | Zero yield on collateral the whole time it's locked |
| External lending for idle margin | Manual recall, third-party risk, can't earn *and* back leverage simultaneously |
| Off-chain keeper-run oracle feeds | Trusted operator = single point of failure and censorship vector |
| Single-product DEXes | No shared risk infrastructure, no cross-margin, no novation |

---

## 2. Solution — The CCP Model

**One clearing house, multiple products, shared margin, novated risk.**

```
                    TENANTS / USERS
   ┌────────┬──────────┬──────────┬──────────┬────────────┐
   │ Perps  │ Event    │ DEX/RWA  │ GameFi   │ LP / Stake │   ← frontends
   │ (UI)   │ markets  │ (plug-in)│ (plug-in)│ / Vault    │
   └───┬────┴────┬─────┴────┬─────┴────┬─────┴─────┬──────┘
       │         │          │          │           │
       ▼         ▼          ▼          ▼           ▼
   ┌─────────────── THE CLEARING LAYER (novation + netting) ───────────────┐
   │ position-tracker (perps, JIT oracle, funding, liquidation)            │
   │ noviscia-clearing (event/outcome markets — parimutuel engine)         │
   └───────────────┬──────────────────────────────────────────────────────┘
                   │  margins / fees / PnL
                   ▼
   ┌─────────────── nv-usdc-vault ── OMNI-POOL + GUARANTEE FUND ──────────┐
   │  nvscUSDC shares · NAV accrual · insurance reserve · default fund     │
   │  Loss waterfall:  trader margin → cross-margin → insurance →          │
   │                   default fund → CCP equity                           │
   └───────────────┬──────────────────────────────────────────────────────┘
                   ▼
   ┌─────────────── YIELD + TOKENOMICS LAYER ──────────────────────────────┐
   │ protocol-lp-vault  yield-distributor  staking-manager  burn-engine    │
   │ token-nvsc (NVSC)  escrow (collateral pods)                           │
   └───────────────┬──────────────────────────────────────────────────────┘
                   ▼
   ┌─────────────── SUPPORT ───────────────────────────────────────────────┐
   │ liquidation-vault (auto-deleveraging) · bug-bounty (security reports) │
   │ netting-engine (cross-tenant risk) · yield-router (atomic recall)     │
   │ clearing-registry (tenant onboarding) · cross-border (settlement)     │
   │ spot-dex (constant-product AMM)                                       │
   └───────────────────────────────────────────────────────────────────────┘
```

**Design principles:**

1. **Central counterparty** — Noviscia interposes on every trade (novation), becoming the buyer to every seller and the seller to every buyer. This eliminates counterparty risk between traders.
2. **Shared omni-pool** — All margin across all products flows into a single yield-bearing vault. Capital is never idle.
3. **Simultaneous Double-Yield** — Locked margin never stops compounding vault NAV.
4. **Multilateral netting** — The netting engine offsets positions across tenants, reducing settlement volume and capital requirements.
5. **5-layer safety waterfall** — Default losses are absorbed by trader margin → cross-margin → insurance → default fund → CCP equity, before LPs are touched.
6. **JIT oracle verification** — Every price-sensitive instruction proves its own fresh price on-chain.
7. **Permissionless cranks** — Funding, liquidation, TP/SL, limit orders need no trusted operator.
8. **Multi-tenant** — Any product (perps, events, DEX, GameFi, RWA) can plug into the clearing layer.

---

## 3. Architecture

### 3.1 On-chain programs (16 total)

| # | Program | Role |
|---|---------|------|
| 1 | **position-tracker** | JIT-oracle perp engine: open/close/liquidate, peer-to-peer funding, insurance fund, trading fees, TP/SL, limit/TWAP orders, atomic recall |
| 2 | **noviscia-clearing** | Event/outcome markets: parimutuel clearing, create_market, place bet, resolve, claim |
| 3 | **nv-usdc-vault** | Omni-pool: deposit/withdraw nvscUSDC shares, NAV accrue, insurance carve-out, default-fund + CCP-equity reserve routing |
| 4 | **netting-engine** | Multilateral netting & novation ledger: venue registration, novated-fill reporting, correlation-matrix cross-margin, house book |
| 5 | **clearing-registry** | Multi-tenant clearing registry: tenant onboarding, venue management |
| 6 | **protocol-lp-vault** | Protocol LP layer: fee accumulation, LP NAV, profit share |
| 7 | **yield-distributor** | Yield distribution: claim_yield, compensate_yield, earned-cap |
| 8 | **staking-manager** | NVSC staking: tiers, rewards, cooldown, governance |
| 9 | **burn-engine** | Buyback & burn: accumulates trading fees, trigger_burn |
| 10 | **token-nvsc** | NVSC governance token (1B supply, 9 decimals) |
| 11 | **escrow** | Collateral pods (legacy — not in perps margin path) |
| 12 | **liquidation-vault** | Auto-deleveraging, withdraw requests, insurance funding |
| 13 | **yield-router** | Yield deployment & atomic recall for margin calls |
| 14 | **spot-dex** | Constant-product AMM DEX |
| 15 | **cross-border** | Cross-border stablecoin settlement (research phase) |
| 16 | **bug-bounty** | On-chain security-report ledger |

### 3.2 Product verticals

| Vertical | Program | Status | Description |
|----------|---------|--------|-------------|
| **Perpetual futures** | position-tracker | Live (22 markets) | Up to 50× leverage, JIT Pyth oracle, funding, liquidation |
| **Event markets** | noviscia-clearing | Compiled (stubbed) | Parimutuel binary/multi-outcome clearing |
| **Spot DEX** | spot-dex | Deployed | Constant-product AMM |
| **Cross-border** | cross-border | Research | Stablecoin settlement rails |
| **Tenant settlement** | clearing-registry | Deployed | Multi-tenant onboarding hooks |

### 3.3 CCP netting model

The netting engine (`68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56`) provides:

- **Venue registration** — Each product vertical registers as a venue (venue 0 = perps, venue 1 = events)
- **Novated fill reporting** — Every trade is reported to the engine for cross-tenant netting
- **Correlation-matrix cross-margin** — Portfolio margin across correlated positions
- **House book** — CCP default fund sizing and capital adequacy tracking
- **Atomic recall** — Yield-router composed into liquidation for margin shortfall coverage

### 3.4 Loss waterfall (5 layers)

```
L1  Trader initial margin (locked nvscUSDC shares)
L2  Trader cross-margin (other product collateral)
L3  Per-market insurance fund      (10% of liquidation penalties)
L4  Global default fund            (cross-market reserve)
L5  CCP equity                     (house book — skin in the game)
    ─ LP yield / stakers touched only if every prior layer is exhausted ─
```

---

## 4. Token economics

### 4.1 nvscUSDC — yield-bearing margin

- Share-based vault token, minted/burned at live NAV (`total_assets / total_shares`).
- NAV accrues from trading fees and liquidation revenue **across all tenants** — not just perps.
- Used directly as perp margin; **locking it as margin does not stop it from earning.**
- Not a governance token; no voting rights.

### 4.2 NVSC — governance and utility

| Property | Value |
|----------|-------|
| Total supply | 1,000,000,000 NVSC (fixed, 9 decimals) |
| Utility | Governance, fee tiers, staking fee share |
| Staking tiers | Bronze 100 · Silver 1K · Gold 10K · Platinum 100K NVSC |

**Token distribution:**

| Allocation | % | Tokens | Vesting |
|------------|---|--------|---------|
| Ecosystem | 35% | 350,000,000 | Various |
| Public sale | 25% | 250,000,000 | TGE unlock |
| Liquidity | 15% | 150,000,000 | TGE |
| Team | 15% | 150,000,000 | 4yr linear vest, 1yr cliff |
| Partners | 10% | 100,000,000 | 2yr vest |

### 4.3 Fee flows

| Source | Split |
|--------|-------|
| Trading fees (open + close) | 100% → nv-usdc-vault NAV |
| Liquidation penalty | 20% liquidator bounty · 80% retained (10% → insurance fund, 90% → vault NAV) |
| Peer-to-peer funding | 100% redistributed longs ↔ shorts — not protocol revenue |

**Burn flywheel:** USDC accumulates in burn-engine → permissionless trigger swaps USDC → NVSC → burn (supply permanently reduced).

---

## 5. Simultaneous Double-Yield

`Position.collateral_shares` are nvscUSDC shares locked per-position. They are **never redeemed** while open:

```
share value = shares * (vault.total_assets / vault.total_shares)
```

`total_assets` grows from **all protocol revenue** — perps fees, event market fees, DEX fees, liquidation penalties. A position open for a week has margin worth strictly more (in USDC terms) than at entry, from vault-wide yield alone — on top of price PnL and funding.

---

## 6. JIT Pyth pull-oracle

Every price-sensitive instruction carries a guardian-signed Wormhole VAA wrapping a Pyth Hermes price update, verified on-chain in the same transaction. A strict ≤30-second freshness ceiling is enforced — old enough, and the instruction reverts (`OracleStale`) rather than executing against a stale number.

No continuously-updated on-chain price account. No off-chain keeper dependency. A retry (fresh price + new wallet approval) is the normal response to freshness races.

---

## 7. Peer-to-peer funding

`Market.funding_index` moves via the permissionless `settle_funding` instruction as a pure function of open interest skew:

```
skew = long_oi_usdc - short_oi_usdc
delta_index = skew * FUNDING_RATE_BPS_PER_SETTLE * FUNDING_INDEX_SCALE / BPS_DENOMINATOR / total_oi
```

Each position snapshots the index at entry; the delta is folded into realized PnL at close/liquidate/TP-SL. Funding is a transfer between longs and shorts — never protocol revenue.

---

## 8. Closed-loop liquidation + insurance

Liquidation is permissionless. The entire remaining collateral is forfeit:

- **20%** to the liquidator (nvscUSDC shares — no redemption, no slippage)
- **80%** retained: **10%** → per-market insurance fund, **90%** → vault NAV

The loss waterfall (§3.4) ensures default losses are absorbed in order before LPs are touched.

---

## 9. Roadmap

| Phase | Milestones | Target |
|-------|------------|--------|
| **Now** | CCP clearing house live: 16 programs, 22 perp markets, netting engine, atomic recall, SDK published, E2E proven | Live (devnet) |
| **Q4 2026** | Security audit, NVSC TGE prep, mainnet program ID lock, multisig admin | In progress |
| **Q1 2027** | Mainnet soft launch: perps + events + spot DEX, production Pyth feeds, keeper infrastructure | Planned |
| **Q2 2027+** | Expanded market catalog, tenant onboarding, cross-border settlement, mobile PWA | Planned |

---

## 10. Security & risk disclosures

- All programs are non-custodial and open-source.
- **Independent security audit has not yet been completed.** Mainnet requires audit sign-off.
- Devnet is for testing only; do not use mainnet funds.
- DeFi is experimental software; use only funds you can afford to lose.

See [`SECURITY.md`](./SECURITY.md) and [`LEGAL.md`](./LEGAL.md) for full disclosures.
