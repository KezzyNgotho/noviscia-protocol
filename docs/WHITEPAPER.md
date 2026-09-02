# Noviscia Protocol Whitepaper

**Version:** 4.1
**Last updated:** August 31, 2026
**Status:** Devnet operational · 15 active on-chain programs · revenue spine live (TVV velocity APY 15–35%) · Mainnet target Q1 2027 (post-audit)

> **Disclaimer:** This document describes the Noviscia protocol design and current devnet implementation. It is not financial advice, an offer of securities, or a commitment to future features. Mainnet parameters may change after audit and community review.

---

## Abstract

Noviscia is a **central counterparty (CCP) clearing house** on Solana. It interposes on both sides of every trade (novation), nets offsetting risk across tenants, runs all margin as a single yield-bearing omni-pool, and absorbs default losses through a funded 5-layer waterfall before LPs are ever touched.

The protocol routes all revenue through a shared clearing infrastructure and a unified **fee spine**:

- **CCP clearing core** — netting, omni-pool margin, novation, loss waterfall
- **Revenue engines** — `gateway-auction` (premium tips), `sovereign-netting` (netting rent), `jit-risk` (slot-scoped premiums) accrue into the vault's 5-authority `accumulate_protocol_fees` spine via CPI, feeding the TVV velocity APY (15–35%)
- **Revenue indexer** — `services/indexer` (`:8092`) decodes on-chain revenue events and powers the Investor Relations dashboard
- **Universal SDK** — any DEX/GameFi/RWA frontend (the "tenant settlement web") routes settlement into the CCP through `@noviscia/sdk`

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
   │ (UI)   │ markets  │ (plug-in)│ (plug-in)│ / Vault    │   (via SDK)
   └───┬────┴────┬─────┴────┬─────┴────┬─────┴─────┬──────┘
       │         │          │          │           │
       ▼         ▼          ▼          ▼           ▼
   ┌─────────────── THE CLEARING LAYER (novation + netting) ───────────────┐
   │ clearing-registry (tenant onboarding) · netting-engine                │
   │ sovereign-netting (netting rent) · position-tracker (perps)           │
   └───────────────┬──────────────────────────────────────────────────────┘
                   │  margins / fees / PnL
                   ▼
   ┌─────────────── nv-usdc-vault ── OMNI-POOL + FEE SPINE ───────────────┐
   │  nvscUSDC shares · NAV accrual · accumulate_protocol_fees             │
   │  Insurance reserve · default fund · TVV velocity APY (15–35%)    │
   │  Loss waterfall: trader margin → cross-margin → insurance →           │
   │                   default fund → CCP equity                           │
   └───────────────┬──────────────────────────────────────────────────────┘
                   ▼
   ┌─────────────── REVENUE + YIELD LAYER ─────────────────────────────────┐
   │ gateway-auction (premium tips) · jit-risk (slot premiums) · sovereign-netting (rent) │
   │ yield-distributor · yield-router · staking-manager · token-nvsc (NVSC) · ve-nvs      │
   └───────────────┬──────────────────────────────────────────────────────┘
                   ▼
   ┌─────────────── SUPPORT ───────────────────────────────────────────────┐
   │ liquidation-vault (auto-deleveraging)                                 │
   └───────────────────────────────────────────────────────────────────────┘
```

**Design principles:**

1. **Central counterparty** — Noviscia interposes on every trade (novation), becoming the buyer to every seller and the seller to every buyer. This eliminates counterparty risk between traders.
2. **Shared omni-pool** — All margin across all products flows into a single yield-bearing vault. Capital is never idle.
3. **Simultaneous Double-Yield** — Locked margin never stops compounding vault NAV.
4. **Multilateral netting** — The netting engine offsets positions across tenants, reducing settlement volume and capital requirements.
5. **5-layer safety waterfall** — Default losses are absorbed by trader margin → cross-margin → insurance → default fund → CCP equity, before LPs are touched.
6. **JIT oracle verification** — Every price-sensitive instruction proves its own fresh price on-chain.
7. **Permissionless cranks** — Funding, liquidation, sweeps and fee release need no trusted operator.
8. **Multi-tenant via SDK** — Any product (perps, events, DEX, GameFi, RWA) plugs into the clearing layer through `@noviscia/sdk`.

---

## 3. Architecture

### 3.1 On-chain programs (15 active)

| # | Program | Role |
|---|---------|------|
| 1 | **nv-usdc-vault** | Omni-pool + fee spine: deposit/withdraw nvscUSDC, NAV accrual, `accumulate_protocol_fees` (5 authority), TVV velocity APY, insurance carve-out, default-fund + CCP-equity reserve routing |
| 2 | **clearing-registry** | Multi-tenant clearing registry: tenant onboarding, venue management |
| 3 | **netting-engine** | Multilateral netting & novation ledger: venue registration, novated-fill reporting, correlation-matrix cross-margin, house book |
| 4 | **sovereign-netting** | Sovereign/cross-tenant netting ledger; State-A netting-rent revenue |
| 5 | **gateway-auction** | State-B gateway auction — the largest fee source; auction batches into the fee spine |
| 6 | **jit-risk** | State-C JIT risk marketplace: premium accrual, `sweepPremiums`, `Marketplace.premium_ledger_total` |
| 7 | **position-tracker** | JIT-oracle perp engine: positions, funding, insurance fund, trading fees, TP/SL, limit/TWAP orders, atomic recall |
| 8 | **noviscia-clearing** | Broad market clearing (event/outcome markets) |
| 9 | **liquidation-vault** | Auto-deleveraging, withdraw requests, insurance funding |
| 10 | **yield-router** | Yield deployment & atomic recall for margin calls |
| 11 | **yield-distributor** | Yield distribution: claim_yield, compensate_yield, earned-cap |
| 12 | **staking-manager** | NVSC staking: tiers, rewards, cooldown, governance |
| 13 | **token-nvsc** | NVSC governance token (1B supply, 9 decimals) |
| 14 | **ve-nvs** | Vote-escrowed NVSC: time-weighted governance weight |
| 15 | **noviscia-credit-line** | Institutional credit line (active-pull commits, priority-bid monetization) |

> Deferred programs (burn-engine, escrow, spot-dex, protocol-lp-vault, bug-bounty) are preserved under `programs/later/` for reference and are **not** part of the live clearing path. The `cross-border` and `tbill-fund` programs (and the `liquidation-keeper`, `risk-engine`, `ai-rebalancer`, `mock-pyth-receiver` services) have been removed from the codebase.

### 3.2 Product verticals

| Vertical / mechanism | Program | Status | Description |
|----------|---------|--------|-------------|
| **CCP clearing core** | netting-engine, clearing-registry | Live | Novation, cross-tenant netting, house book |
| **State-B gateway auction** | gateway-auction | Live (largest revenue) | Fee batches auctioned into the fee spine |
| **State-A netting rent** | sovereign-netting | Live | Netting-rent revenue accrual |
| **State-C JIT risk** | jit-risk | Live | JIT risk premium marketplace + `sweepPremiums` |
| **Perpetual futures** | position-tracker | Live | JIT oracle, funding, liquidation, order types |
| **Broad markets** | noviscia-clearing | Deployed | Event/outcome market clearing |
| **Yield + governance** | yield-distributor, yield-router, staking-manager, ve-nvs | Live | Yield, atomic recall, staking, vote-escrow |
| **Tenant settlement** | @noviscia/sdk | Published | Any DEX/GameFi/RWA frontend routes in via SDK |

> Spot DEX, protocol LP vault, and burn-engine are deferred (`programs/later/`) as of v4.1 — the revenue spine now runs off gateway-auction / netting-rent / JIT premiums rather than per-product fee streams. Cross-border settlement and tbill-fund have been removed from the codebase.

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

### 4.3 Fee flows — the revenue spine

All revenue converges on the `nv-usdc-vault` fee spine via the 5-authority `accumulate_protocol_fees` path:

| Source | Split |
|--------|-------|
| State-B gateway auction | 100% → fee spine (`accumulate_protocol_fees`) |
| State-A netting rent | 100% → fee spine |
| State-C JIT risk premiums | 100% → fee spine (`sweepPremiums`) |
| Perp trading fees | 100% → vault NAV |
| Liquidation penalty | 20% liquidator bounty · 80% retained (10% → insurance fund, 90% → vault NAV) |
| Peer-to-peer funding | 100% redistributed longs ↔ shorts — not protocol revenue |

**Revenue release:** Each revenue engine sweeps directly into the vault via CPI —
`jit-risk::sweep_premiums`, `gateway-auction::settle`, and
`sovereign-netting::sweep_netting_rent` all route through
`nv-usdc-vault::accumulate_protocol_fees`, which sends the cut through
`fee_to_yield_bps` into LP NAV (with an insurance carve-out). No external keeper service
is required; release is on-chain and surfaced by the revenue indexer
(`services/indexer`, `:8092`).

**Burn flywheel:** Protocol fee surplus and buyback accumulate in the spine; NVSC is bought and burned, with stakers receiving fee share plus governance.

---

## 5. Simultaneous Double-Yield

`Position.collateral_shares` are nvscUSDC shares locked per-position. They are **never redeemed** while open:

```
share value = shares * (vault.total_assets / vault.total_shares)
```

`total_assets` grows from **all protocol revenue** — gateway-auction (State B), netting rent (State A), JIT premiums (State C), perp fees, liquidation penalties. A position open for a week has margin worth strictly more (in USDC terms) than at entry, from vault-wide yield alone — on top of price PnL and funding.

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
| **Now** | CCP clearing house + TVV revenue spine live (devnet): gateway-auction tips / netting-rent / JIT slot premiums, SDK published, real on-chain IR | Live (devnet) |
| **Q4 2026** | Security audit, NVSC TGE prep, mainnet program ID lock, multisig admin | In progress |
| **Q1 2027** | Mainnet soft launch: full clearing + revenue spine, production oracle feeds, keeper infrastructure | Planned |
| **Q2 2027+** | Expanded market catalog, broader tenant onboarding, mobile PWA | Planned |

---

## 10. Security & risk disclosures

- All programs are non-custodial and open-source.
- **Independent security audit has not yet been completed.** Mainnet requires audit sign-off.
- Devnet is for testing only; do not use mainnet funds.
- DeFi is experimental software; use only funds you can afford to lose.

See [`SECURITY.md`](./SECURITY.md) and [`LEGAL.md`](./LEGAL.md) for full disclosures.
