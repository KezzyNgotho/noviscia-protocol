# Noviscia Protocol Whitepaper

**Version:** 2.0  
**Last updated:** July 2026  
**Status:** Devnet operational · Mainnet target Q3 2026  

> **Disclaimer:** This document describes the Noviscia protocol design and current devnet implementation. It is not financial advice, an offer of securities, or a commitment to future features. Mainnet parameters may change after audit and community review.

---

## Abstract

Noviscia is a **zero-waste perpetual DEX** on Solana. Traders deposit once, trade USDC-settled perps across 16 markets, and **earn yield on capital that would otherwise sit idle** between trades. Idle margin is held in the protocol's **Sovereign Omni-Pool** — a non-custodial, protocol-native capital pool; when a trader opens a position, funds are **recalled atomically** so margin is always available. Every dollar of idle margin also accrues a share of protocol trading fees via an on-chain `fee_index` ledger.

The protocol supports **multi-asset cross-collateral margin**: USDC (100% LTV), SOL (80% LTV), mSOL and jitoSOL (82% LTV). Collateral weights are governed on-chain; adding a new asset requires no instruction-schema changes.

**Sub-accounts** (sub_id 1–255) provide isolated trading contexts — separate margin, positions, and escrow per sub-account — enabling strategy segregation and institutional position management.

The protocol separates **yield-bearing margin** (nvscUSDC vault shares) from **governance** (NVSC token). Trading fees and protocol yield feed a **deflationary flywheel**: USDC fees accumulate, NVSC is bought and burned, and stakers receive fee share plus governance over venue allocation.

---

## 1. Problem

| Approach | Limitation |
|----------|------------|
| USDC sitting in a perp wallet | Zero yield on idle margin |
| External lending protocols | Manual recall before every trade; third-party risk; friction |
| Single collateral type | Capital inefficiency for holders of SOL / LSTs |
| Shared margin across strategies | One bad trade liquidates everything |

---

## 2. Solution

**One deposit → trade → earn → recall atomically → claim yield.**

```
USDC
  → nv-usdc-vault (ERC-4626 style, Sovereign Omni-Pool, NAV compounds)
  → Escrow PDA (non-custodial, user-owned)
       ↳ idle slice earns fee_index yield (claim any time)
       ↳ CollateralPosition PDAs for SOL / LSTs
       ↳ Sub-account Escrow PDAs for isolated strategies
  → Recall (atomic, amount-scoped, <400ms target)
  → position-tracker (dual oracle, perp engine, AMM/JIT)
  → Close & settle → PnL + fees routed on-chain
  → claim_idle_yield → USDC credited to escrow
```

**Design principles**

1. **Non-custodial** — Funds live in program-derived accounts; users sign every action.
2. **Atomic recall** — Opening a perp recalls lent margin in the same flow; no manual steps.
3. **Multi-asset collateral** — USDC + SOL + LSTs, weighted at position open and liquidation.
4. **Sub-account isolation** — Independent risk environments per sub_id; one liquidation can't cascade to another.
5. **On-chain yield ledger** — `fee_index` accrues per unit of idle margin; claim at any time, no lock-up.
6. **Permissionless cranks** — Oracle marks, lending, liquidations, and burns need no trusted operator.
7. **Dual-token clarity** — nvscUSDC earns and margins; NVSC governs and captures fee share.

---

## 3. Architecture

### 3.1 Programs

| Program | Role |
|---------|------|
| **escrow** | USDC margin, multi-asset CollateralPosition PDAs, sub-account escrows, idle yield (fee_index_snapshot), V5 migration |
| **nv-usdc-vault** | USDC ↔ nvscUSDC at NAV; Sovereign Omni-Pool (sweep + recall); fee_index accrual |
| **position-tracker** | Perp positions, dual oracle, AMM/JIT matching, liquidation, CollateralWeightConfig |
| **lending-integrator** | Multi-venue pools; governed weights; deposit/withdraw CPI |
| **yield-distributor** | Escrow lend yield: 85% user / 15% burn-engine |
| **staking-manager** | NVSC stake tiers (Bronze/Silver/Gold/Platinum); governance proposals; trading fee pool |
| **burn-engine** | USDC fee accumulation; NVSC buyback & burn (permissionless trigger) |
| **token-nvsc** | Fixed-supply NVSC SPL token |
| **liquidation-vault** | Per-asset insurance fund pools; USDC pool seeded; SOL pool wired |
| **prediction_market** | On-chain prediction markets (adjacent product) |

### 3.2 Off-chain services

| Service | Role |
|---------|------|
| **Permissionless cranks** | Oracle marks, lend crank, liquidations, vault sweep, burn trigger — anyone can run |
| **Indexer** | Limit orders, fills, trade history |

### 3.3 Frontend

| Page | Route |
|------|-------|
| Perps terminal | `/trade/perps` |
| Collateral Console | `/trade/collateral` |
| Analytics dashboard | `/analytics` |
| nvscUSDC vault | `/earn/vault` |
| NVSC staking | `/earn/stake` |
| Prediction markets | `/trade/prediction` |

---

## 4. Token economics

### 4.1 nvscUSDC — yield-bearing margin

- ERC-4626-style vault shares minted at NAV.
- NAV accrues from protocol yield via the Sovereign Omni-Pool.
- Used as perp margin; earns while not trading.
- Not a governance token; no voting rights.

### 4.2 NVSC — governance and utility

| Property | Value |
|----------|-------|
| Supply | 1,000,000,000 fixed |
| Utility | Governance, fee tiers (10–100% discount by tier), staking fee share |
| Staking tiers | Bronze 100 · Silver 1K · Gold 10K · Platinum 100K NVSC |

**Planned distribution** (subject to change pre-TGE):

| Allocation | % | Vesting |
|------------|---|---------|
| Ecosystem | 35% | Various |
| Public sale | 25% | TGE unlock |
| Liquidity | 15% | TGE |
| Team | 15% | 4yr linear vest, 1yr cliff |
| Partners | 10% | 2yr vest |

### 4.3 Fee flows

| Source | Split |
|--------|-------|
| Perp trading fees | 40% burn engine · 60% staking pool |
| Escrow lend yield | 85% user · 15% burn engine |
| Vault NAV yield (Omni-Pool) | 100% accrues to nvscUSDC NAV |
| Idle margin yield (`fee_index`) | 100% to user via `claim_idle_yield` |

**Burn flywheel:** USDC accumulates in burn-engine PDA → permissionless caller triggers USDC→NVSC swap via Jupiter → on-chain `burn` destroys supply permanently.

---

## 5. Idle margin yield mechanism

The protocol tracks a global `fee_index` (u128) in `VaultConfig` that accrues as trading fees flow through the vault:

```
delta = (fee_amount * FEE_INDEX_SCALE) / total_vault_assets
fee_index += delta
```

Each user's `EscrowAccount` stores `fee_index_snapshot`. Pending yield:

```
pending = idle_usdc * (fee_index - fee_index_snapshot) / FEE_INDEX_SCALE
```

`claim_idle_yield` CPIs to `nv_usdc_vault::pay_trader_profit`, credits the user's escrow, and updates `fee_index_snapshot`. No lock-up, no minimum, claimable at any slot.

---

## 6. Multi-asset collateral

The escrow program stores one `CollateralPosition` PDA per (user, mint). Position-tracker's liquidation and margin instructions accept `remaining_accounts` as `[oracle, collateral_position]` pairs and sum:

```
effective_margin += balance * oracle_price * weight_bps / 10_000
```

`CollateralWeightConfig` PDAs (governance-set) define the LTV per mint. Adding a new asset creates a weight config and requires no instruction schema change. Current weights:

| Asset | LTV |
|-------|-----|
| USDC | 100% |
| SOL | 80% |
| mSOL | 82% |
| jitoSOL | 82% |

---

## 7. Sub-accounts

Sub-accounts (sub_id 1–255) give traders isolated risk environments. Each sub-account has its own `UserState`, `Position` set, and `EscrowAccount` — a different PDA from the implicit sub_id=0 accounts. Margin cannot bleed across sub-account boundaries. TP/SL and limit orders for sub-accounts are a fast-follow roadmap item.

---

## 8. Oracle design

Each market has a `PerpOracleState` PDA storing Pyth price, Switchboard price, and a computed consensus. The consensus is the average of the two feeds, subject to a maximum deviation threshold. If either feed exceeds the threshold, the conservative (less favorable to the trader) feed is used. Staleness guards reject updates older than a configurable slot window.

The dual-feed approach eliminates single-oracle risk. Permissionless liquidation cranks can only execute when the oracle is fresh, preventing MEV from stale prices.

---

## 9. Three-tier safety

| Tier | Mechanism |
|------|-----------|
| 1 | User collateral (USDC + weighted cross-collateral) absorbs first loss |
| 2 | Per-asset insurance fund pools (`liquidation_vault`) |
| 3 | Socialized LP haircut (last resort; never triggered on devnet) |

Bad debt is always USDC-denominated. Insurance pools stake in their native asset but cover USDC shortfalls via equivalent accounting. No MEV is leaked to external liquidation bots — the permissionless crank retains 100% of the liquidation penalty for the protocol.

---

## 10. Roadmap

| Phase | Milestones | Target |
|-------|------------|--------|
| **Now** | All programs live · Sovereign Omni-Pool · multi-asset collateral · sub-accounts · idle yield · Collateral Console + Analytics UI | Live |
| **Q2–Q3 2026** | Security audit · NVSC TGE preparation · mainnet program ID lock · deposit caps | In progress |
| **Q3 2026** | Mainnet soft launch · SOL/BTC/ETH perps live · production Pyth feeds | Planned |
| **Q4 2026+** | 18-market catalog · mSOL/jitoSOL collateral (mainnet mints) · mobile PWA · session trading agents · protocol-owned liquidity | Planned |

---

## 11. Security & risk disclosures

- All programs are non-custodial and open-source.
- **Independent security audit has not yet been completed.** Mainnet deployment requires audit sign-off.
- Devnet deployment is for testing only; do not use mainnet funds.
- Oracle feeds on devnet are less reliable than mainnet — Switchboard feeds are sparsely maintained.
- Smart contract bugs could result in loss of deposited funds.
- DeFi is experimental software; use only funds you can afford to lose.

See [`SECURITY.md`](./SECURITY.md) and [`LEGAL.md`](./LEGAL.md) for full disclosures.
