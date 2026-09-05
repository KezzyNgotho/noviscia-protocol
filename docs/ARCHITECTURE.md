# Noviscia Protocol — Complete System Architecture

> **Status:** Living architecture document. **Last updated:** September 5, 2026.

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           USER INTERFACE LAYER                              │
│                                                                             │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│   │  /trade   │  │  /earn   │  │ /manage  │  │  /token  │  │  /more   │   │
│   │  perps    │  │  vault   │  │ portfolio│  │  NVSC    │  │  docs    │   │
│   │  swap     │  │  stake   │  │ positions│  │          │  │  blog    │   │
│   │ triggers  │  │ rewards  │  │ orders   │  │          │  │ community│   │
│   │ collateral│  │ insurance│  │          │  │          │  │ legal    │   │
│   │ liq       │  │ loans    │  │          │  │          │  │          │   │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                                             │
│   Next.js 14 App Router  ·  React 18  ·  Tailwind  ·  @solana/connector/react   │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    │   CLIENT LIBRARY LAYER │
                    │                        │
                    │  client.ts (1781 LOC)  │
                    │  jitOracle.ts (492 LOC)│
                    │  altCache.ts  (319 LOC)│
                    └───────────┬────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                  │
     ┌────────┴──────┐ ┌───────┴────────┐ ┌──────┴──────────┐
     │  PYTH HERMES  │ │  SOLANA RPC    │ │  INDEXER API    │
     │  REST API     │ │  (devnet)      │ │  (port 8092)    │
     │  JIT pricing  │ │  TX submit     │ │  Orders, fills  │
     │  VAA + merkle │ │  Acct fetch    │ │  Activity, API  │
     └───────────────┘ └────────┬───────┘ └─────────────────┘
                                │
┌───────────────────────────────┴─────────────────────────────────────────────┐
│                         ON-CHAIN PROGRAM LAYER                              │
│                                                                             │
│  (CCP CORE — novation, netting, risk)                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  POSITION     │  │  NOVISCIA    │  │  NETTING     │  │  CLEARING    │   │
│  │  TRACKER      │  │  CLEARING    │  │  ENGINE      │  │  REGISTRY    │   │
│  │  (perps)      │  │  (events)    │  │  (multilat.) │  │  (tenants)   │   │
│  │  6uvr2...1ws  │  │  GtTJW...fe  │  │  68s4v...s56 │  │  Hg5Qv...7mo  │   │
│  └───────┬──────┘  └──────┬───────┘  └──────────────┘  └──────────────┘   │
│          │                │             │               │                 │
│  (REVENUE ENGINES — all feed omni-pool NAV)                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                     │
│  │  SOVEREIGN   │  │  GATEWAY-    │  │  JIT-RISK    │                     │
│  │  NETTING     │  │  AUCTION     │  │  (TVV)       │                     │
│  │  rent        │  │  premium tips│  │  slice premia│                     │
│  │  9YxL2...Dyk │  │  HQ26V...9xR │  │  3w9Gr...Xwh │                     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                     │
│         └─────────────────┼─────────────────┘                             │
│                           ▼                                                │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │   nv-usdc-vault — ONE OMNI-POOL (nvscUSDC shares · fee_index NAV)    │   │
│  │   accumulate_protocol_fees · insurance reserve · default fund        │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│  ┌────────────────────────── SUPPORTING PROGRAMS ──────────────────────┐   │
│  │  staking-manager · ve-nvs · token-nvsc · yield-distributor          │   │
│  │  yield-router (atomic recall) · liquidation-vault                   │   │
│  │  noviscia-credit-line · sovereign-netting (also rents)              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                │
┌───────────────────────────────┴─────────────────────────────────────────────┐
│                          OFF-CHAIN SERVICES                                 │
│                                                                             │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐               │
│  │  INDEXER        │  │  WEBSOCKET     │  │  AI LAYER      │               │
│  │  (Express + PG) │  │  (ws :8080)    │  │  (ai-orch.)    │               │
│  │  Slot polling   │  │  Prices        │  │  Trading agent  │               │
│  │  Event parsing  │  │  Positions     │  │  Netting       │               │
│  │  Fills/Activity │  │  Yields        │  │  relayer       │               │
│  └────────────────┘  └────────────────┘  └────────────────┘               │
│                                                                             │
│  ┌────────────────┐  ┌────────────────┐                                    │
│  │  EXECUTOR BOT   │  │  PRICE FEED   │                                    │
│  │  (tsx daemon)    │  │  SERVICE       │                                    │
│  │  Limit orders   │  │  Pyth (JIT    │                                    │
│  │  TWAP slices    │  │  pull-oracle) │                                    │
│  │  TP/SL triggers │  │  100%         │                                    │
│  │  Liquidations   │  │                │                                    │
│  └────────────────┘  └────────────────┘                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Token Architecture

### 2a. Token Mints

| Token | Mint Address | Decimals | Supply | Purpose |
|-------|-------------|----------|--------|---------|
| **USDC** | `Cx2bf...hS5` | 6 | External | Collateral base currency (devnet) |
| **nvscUSDC** | `2TmaU...eVk` | 6 | Minted on deposit | Yield-bearing vault share |
| **NVSC** | `4BXiD...gJkg` | 9 | 1,000,000,000 | Governance + staking + burn target |
| **WSOL** | `So111...1112` | 9 | Wrapped SOL | Multi-collateral support |

### 2b. Token Flow Diagram

```
                          ┌──────────────────┐
                          │   USER WALLET    │
                          │                  │
                          │  USDC ◄───────┐ │
                  ┌──────►│  nvscUSDC ◄─┐ │ │
                  │       │  NVSC       │ │ │
                  │       └──────────────┘ │
                  │                        │
           ┌──────┴────────┐        ┌──────┴─────────┐
            │  ESCROW       │        │  OPEN POSITION  │
            │  (deferred —  │        │  (JIT direct)   │
            │  not live)    │        │                 │
           │               │        │                 │
           │  deposit()    │        │  USDC ──► NV-   │
           │  approve_     │        │  USDC-VAULT     │
           │  trader()     │        │  ┌──────────┐   │
           └──────┬────────┘        │  │mint_usdc()│  │
                  │                 │  │1:1 USDC → │  │
                  ▼                 │  │nvscUSDC   │  │
           ┌──────────────┐        │  └─────┬────┘   │
           │  NV-USDC-    │◄───────┘        │        │
           │  VAULT       │          nvUSDC shares   │
           │              │          become the      │
           │  ┌────────┐  │          position's      │
           │  │ USDC   │  │          collateral      │
           │  │ token  │  │                         │
           │  │ acct   │  │    ┌──────────────┐     │
           │  └────────┘  │    │  CLOSE /      │     │
           │  ┌────────┐  │    │  LIQUIDATE    │     │
           │  │nvUSDC  │  │    │              │     │
           │  │ mint   │  │    │  shares ──►  │     │
           │  └────────┘  │    │  burn_usdc() │     │
           │              │    │  1:1 → USDC  │     │
           │  fee_index   │    └──────┬───────┘     │
           │  total_assets│           │              │
           └──────┬───────┘           ▼              │
                  │                USDC returned     │
                  │                to user           │
                  │                                  │
           ┌──────┴───────┐    ┌──────────────┐     │
           │  REVENUE     │    │  TRADING FEE  │    │
           │  SPLIT       │◄───│  (on open/    │    │
           │              │    │   close)      │    │
           └──────────────┘    └──────────────┘     │
```

### 2c. nvscUSDC Vault Share Mechanics

nvscUSDC is a **yield-bearing vault share** (similar to ERC-4626):

1. **Deposit (mint):** `mint_usdc()` burns user's USDC 1:1 and mints nvscUSDC shares. The share price = `total_usdc / total_shares`. Early depositors get more shares per USDC.
2. **Withdraw (burn):** `burn_usdc()` burns nvscUSDC shares and returns USDC at the current share price. The USDC returned > the original deposit as the vault accumulates yield.
3. **Yield sources:** All revenue engines (sovereign-netting rent, gateway-auction tips, jit-risk slice premia) + perp trading fees + liquidation surplus accrue into NAV. **No external lending integrations** — yield is self-contained from protocol activity.
4. **Locked margin:** When a position is open, the trader's nvUSDC shares are "locked" (`locked_margin += shares`). They continue accruing yield even while locked.
5. **Simultaneous Double-Yield:** Positions earn trading yield on their margin while simultaneously trading — the vault's `fee_index` keeps compounding even on locked shares.

---

## 3. On-Chain Programs

**Program layout (15 active on devnet):** CCP core (position-tracker, noviscia-clearing,
netting-engine, clearing-registry) · revenue engines (sovereign-netting, gateway-auction,
jit-risk) · supporting (nv-usdc-vault, liquidation-vault, yield-router, yield-distributor,
staking-manager, ve-nvs, token-nvsc, noviscia-credit-line). Programs under `programs/later/`
(bug-bounty, burn-engine, escrow, protocol-lp-vault, spot-dex) are **deferred / not yet live**
and are preserved for reference only.

### 3a. Position Tracker (Core Engine)
**Program ID:** `6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws`
**Lines of Code:** ~5,300 (lib.rs) + ~760 (state.rs)
**Role:** The central perpetual futures engine. Manages positions, orders, funding, liquidation, and oracle verification.

#### Key Instructions

| Category | Instruction | Description |
|----------|-------------|-------------|
| **Setup** | `initialize_protocol` | Creates PtConfig PDA (admin, USDC mint) |
| | `initialize_market` | Registers a perp market (feed ID, leverage, maintenance margin) |
| | `resize_market` | Grows market account to V3 layout (adds trading fee, recorded price) |
| | `set_market_fee_bps` | Admin sets trading fee (max 500 bps = 5%) |
| | `set_market_params` | Admin adjusts leverage/maintenance margin |
| | `set_portfolio_risk_config` | Admin configures correlation matrix for portfolio margin |
| **Position Entry** | `open_position_jit` | Open position with JIT oracle price (immediate execution) |
| | `open_position_delegate` | Delegate opens position on behalf of owner (session key) |
| | `close_position` | Close position with JIT oracle pricing |
| | `partial_close_position` | Close part of a position (by share count) |
| | `add_margin` | Add collateral to existing position |
| | `remove_margin` | Remove collateral from position |
| **Limit Orders** | `place_limit_order` | Place a limit/stop order (escrowed collateral) |
| | `cancel_limit_order` | Cancel order, return escrowed collateral |
| | `execute_limit_order` | Permissionless: fill a triggered limit order |
| | `commit_order` | Commit-reveal: commit phase (hash of order) |
| | `reveal_and_place_limit_order` | Commit-reveal: reveal + place |
| **TWAP Orders** | `create_twap_order` | Create a TWAP order (N slices over T time) |
| | `cancel_twap_order` | Cancel TWAP, refund remaining collateral |
| | `execute_twap_slice` | Permissionless: execute one TWAP slice |
| **TP/SL** | `set_tp_sl` | Set take-profit / stop-loss prices on position |
| | `execute_tp_sl` | Permissionless: execute triggered TP/SL |
| **Risk** | `execute_adl` | Auto-Deleveraging: close insolvent position, transfer to healthy counterparty |
| | `liquidate` | Liquidate an undercollateralized position |
| | `settle_funding` | Update funding index (once/hour rate limit) |
| **Delegation** | `register_session_delegate` | Create session delegate PDA (hot wallet) |
| | `revoke_session` | Revoke session delegation |
| **Referrals** | `register_referral` | Create referral PDA |
| **Portfolio Margin** | `set_portfolio_risk_config` | Set max 8-market correlation matrix |

#### Key On-Chain Structs

**MarketAccount (269 bytes)**
```
authority          Pubkey   (32)   Admin wallet
feed_id            [u8;32]  (32)   Pyth feed identifier
max_leverage_bps   u32      (4)    Max leverage in bps (e.g. 500000 = 50x)
maintenance_margin_bps u16  (2)    Maint. margin in bps (e.g. 100 = 1%)
is_active          bool     (1)    Market enabled flag
bump               u8       (1)    PDA bump
funding_index      i64      (8)    Cumulative funding rate (1e6 scale)
long_oi_usdc       u64      (8)    Long open interest
short_oi_usdc      u64      (8)    Short open interest
last_funding_settle_ts i64  (8)    Last settlement timestamp
insurance_fund_usdc u64     (8)    Per-market insurance fund
referral_bps       u16      (2)    Referral bonus bps
trading_fee_bps    u16      (2)    Trading fee in bps
last_recorded_price u64     (8)    Last oracle price (1e6)
last_recorded_slot  u64     (8)    Last slot price was recorded
oracle_twap        u64      (8)    Oracle TWAP protection
twap_last_update_ts i64     (8)    Last TWAP update timestamp
max_position_size_usdc u64  (8)    Per-user position cap (0 = none)
max_oi_usdc        u64      (8)    Per-market OI cap
base_spread_bps    u16      (2)    Dynamic spread
taker_fee_bps      u16      (2)    Taker fee
maker_rebate_bps   u16      (2)    Maker rebate
borrow_base_bps    u16      (2)    Borrow kink curve base
borrow_kink_bps    u16      (2)    Borrow kink threshold
borrow_max_bps     u16      (2)    Borrow max rate
borrow_kink_util_bps u16    (2)    Borrow kink utilization
volatility_bps     u32      (4)    Volatility multiplier
vol_tier1_threshold_bps u16 (2)    Vol tier 1 threshold
vol_tier2_threshold_bps u16 (2)    Vol tier 2 threshold
vol_tier3_threshold_bps u16 (2)    Vol tier 3 threshold
vol_tier1_multiplier_bps u16 (2)   Vol tier 1 multiplier
vol_tier2_multiplier_bps u16 (2)   Vol tier 2 multiplier
vol_tier3_multiplier_bps u16 (2)   Vol tier 3 multiplier
soft_max_oi_usdc   u64      (8)    Soft OI cap
house_net_position_usdc i64 (8)    CCP house net position
house_funding_pnl_usdc i64  (8)    CCP house funding PnL
margin_tier1_threshold_usdc u64 (8) Size tier 1 threshold
margin_tier2_threshold_usdc u64 (8) Size tier 2 threshold
margin_tier3_threshold_usdc u64 (8) Size tier 3 threshold
margin_tier1_leverage_bps u16 (2)  Size tier 1 leverage
margin_tier2_leverage_bps u16 (2)  Size tier 2 leverage
margin_tier3_leverage_bps u16 (2)  Size tier 3 leverage
insurance_fund_floor_usdc u64 (8)  Insurance fund floor
max_positions_per_trader u8  (1)    Max positions per trader
active_position_count u32   (4)    Active position count
```

**PositionAccount (227 bytes)**
```
owner              Pubkey   (32)   Position owner
market             Pubkey   (32)   Market address
is_long            bool     (1)    Direction
size_usdc          u64      (8)    Notional size in USDC
entry_price        u64      (8)    Entry price (1e6 scale)
collateral_shares  u64      (8)    nvscUSDC vault shares locked as margin
locked_margin_snapshot u64  (8)    Snapshot of locked margin at open
open_slot          u64      (8)    Slot when opened
bump               u8       (1)    PDA bump
collateral_vault_bump u8    (1)    Collateral vault PDA bump
sub_id             u8       (1)    Sub-account index (0-255)
tp_price           Option<u64> (9)  Take-profit price (None = unset)
sl_price           Option<u64> (9)  Stop-loss price (None = unset)
entry_funding_index i64     (8)    Funding index snapshot at open
state_hash         [u8;32]  (32)   SHA-256 audit trail hash
```

**LimitOrder (118 bytes)**
```
owner, market, sub_id, order_id, is_long, size_usdc, collateral_shares,
trigger_price, expiry_ts, bump, vault_bump, order_type (0=limit_entry, 1=stop_market, 2=stop_limit), reduce_only
```

**TwapOrder**
```
owner, market, sub_id_base, slices_total, slices_done, is_long,
slice_size_usdc, slice_collateral_shares, interval_secs, last_slice_ts
```

#### PDA Seed Map

| PDA | Seeds |
|-----|-------|
| `PtConfig` | `["pt-config"]` |
| `Market` | `["market", feed_id]` |
| `Position` | `["position", owner, market, [sub_id]]` |
| `CollateralVault` | `["collateral-vault", position]` |
| `SettlementVault` | `["settlement-vault"]` |
| `LimitOrder` | `["limit-order", owner, market, [sub_id], order_id_le64]` |
| `LimitOrderVault` | `["limit-order-vault", limit_order]` |
| `TwapOrder` | `["twap-order", owner, market]` |
| `TwapVault` | `["twap-vault", twap_order]` |
| `SessionDelegate` | `["session-delegate", owner]` |
| `Referral` | `["referral", trader]` |
| `PortfolioRiskConfig` | `["portfolio-risk-config"]` |
| `OrderCommitment` | `["order-commitment", owner, market]` |

---

### 3b. NV-USDC Vault (Yield Engine)
**Program ID:** `CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC`
**Lines:** ~1,111

**Role:** The yield-bearing vault that powers the entire collateral system. All USDC deposited becomes the backing for nvscUSDC shares.

#### Instructions
| Instruction | Description |
|-------------|-------------|
| `initialize_vault` | Create vault config PDA |
| `mint_usdc` | Deposit USDC → receive nvscUSDC shares (1:1 backing) |
| `burn_usdc` | Burn nvscUSDC shares → receive USDC (with yield) |
| `deposit_sol` | Deposit native SOL via escrow → receive nvscUSDC |
| `withdraw_sol` | Withdraw native SOL via escrow |
| `accumulate_protocol_fees` | Admin: accumulate protocol fees into vault NAV |
| `accumulate_lp_fees` | Admin: accumulate LP fees into vault NAV |
| `sweep_fees` | Admin: sweep accumulated fees to recipient |
| `adjust_locked_margin` | Admin: adjust locked margin for positions |
| `pay_trader_profit` | Admin: pay out realized trader profits |

#### Key Mechanic
- `vault_config` PDA tracks: `total_assets` (USDC backing), `total_shares` (nvUSDC supply), `fee_index` (yield accumulator), `locked_margin` (shares locked by positions)
- Share price formula: `price = total_assets / total_shares`
- Every `accumulate_protocol_fees()` call increases `total_assets`, which increases share price, which benefits all nvUSDC holders (including those with locked margin)

---

### 3c. Escrow (Deferred — Not Live)
**Program ID:** `2WPb3wsyp4G6zFPx8sTYf3bTDyySxwpo1Ja8H6RCHXCZ`

**Role:** Formerly held trader deposits (USDC, WSOL, nvUSDC) with per-trader approvals. **Deferred / not yet live** — margin now flows directly through the omni-pool's `nv-usdc-vault` mint/burn (`deposit_sol`/`withdraw_sol` retained in the vault). Preserved under `programs/later/` for reference.

---

### 3d. Burn Engine (Deferred — Not Live)
**Program ID:** `nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id`
**Lines:** ~687

**Role:** Designed to convert trading fees (nvUSDC) into NVSC tokens via AMM, then burn the NVSC — creating deflationary pressure. **Deferred / not yet live** — the NVSC buyback/burn flywheel is handled through the omni-pool's fee spine (`accumulate_protocol_fees`) rather than a dedicated burn program. Preserved under `programs/later/` for reference.

#### Flow (as designed)
1. Receives a share of trading fees (in nvUSDC shares)
2. `accumulate_funds()` — receives nvUSDC shares
3. `swap_nvusdc_to_nvsc()` — CPI into NVSC AMM to convert nvUSDC → NVSC
4. NVSC is sent to a burn address (permanently removed from supply)

---

### 3e. Staking Manager (NVSC Yield)
**Program ID:** `HjxcKV51A7jxE2iqMCDY7EvWFL9XsheuM43DamWGabqb`
**Lines:** ~1,054

**Role:** Accepts NVSC stakes and distributes 25% of trading fees as staker rewards.

#### Flow
1. Users stake NVSC → receive staked position
2. 25% of every trading fee (in nvUSDC shares) flows to `staking_fee_pool`
3. `record_trading_fee_usdc()` — receives nvUSDC shares from position-tracker
4. Stakers can claim their proportional share of accumulated fees

#### Key PDAs
| PDA | Seeds |
|-----|-------|
| `staking_fee_pool` | `["staking-fee-pool"]` |
| `staking_fee_vault` | `["staking-fee-pool", "vault"]` |
| `stake_account` | `["stake", owner]` |

---

### 3f. Liquidation Vault (Insurance Fund)
**Program ID:** `Cwma3FfMKhoLkgfrGYgErVPoFWEtHpx7DNc4wArpRHBz`
**Lines:** ~1,221

**Role:** Receives the insurance fund slice from liquidations and accumulates reserves.

---

### 3g. Protocol LP Vault (Deferred — Not Live)
**Program ID:** `2WUt24rRNWsdi8sE56y74b7rJGgKbxSBsu7ntDkGAJkd`

**Role:** Designed to accept LP deposits into the protocol's trading pool. **Deferred / not yet live** — LP yield now flows through the omni-pool (`nvscUSDC` shares + `fee_index` NAV accrual) rather than a dedicated LP vault. Preserved under `programs/later/` for reference.

---

### 3h. Token NVSC
**Program ID:** `HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT`

**Role:** The NVSC SPL token mint. 1 billion supply, 9 decimals. Used for governance and staking.

---

### 3i. Yield Distributor
**Program ID:** `CrN1o75FGwcSo6ted7eKxw2kYgkaXDVeWmUaTZCTsLtw`

**Role:** Emergency Committee (EC) draw mechanism. The `ec_draw` instruction allows the Emergency Committee to allocate yield from the vault to stakers. No external lending integrations — yield originates from trading fees and liquidation penalties flowing into vault NAV.

---

### 3j. Noviscia Clearing (Broad/Event Markets)
**Program ID:** `GtTJWLa6MXjZoNucGHWVnE9LpZTw6Dsr5K1gxpM1Q4fe`

**Role:** Broad / event-outcome market clearing (parimutuel engine) on Solana — part of the CCP core. Separate from the perps engine.

---

### 3k. Revenue Engines (all feed the omni-pool NAV)

| Engine | Program ID | Revenue event | Description |
|--------|-----------|---------------|-------------|
| **sovereign-netting** | `9YxL2Gk3cphCjxeKgfj2cnY4wCBDzej3L83jLGJ52Dyk` | `NettingRentPaid` | State-A netting rent accured from cross-tenant netting |
| **gateway-auction** | `HQ26VTfoBVmGFY1JsFp5HmMT3rjLNoLJH6zurm8TL9xR` | `AuctionSettled` | State-B gateway auction + premium tips |
| **jit-risk** | `3w9GrHBXpMNSc3P3kBWmHwkhEr1u5FBQrTiD4k3NAXwh` | `SliceRented` / `PremiumSwept` | State-C slot-scoped JIT premiums (400ms contingent capacity) |

All three accrue into the `nv-usdc-vault` 5-authority `accumulate_protocol_fees` spine and grow `fee_index`/NAV. The indexer tracks all three engines.

---

### 3l. Multi-Asset Engine — Institutional Asset Lifecycle

**Program ID:** `5qpohgfMvV89oRJqcV7MrBxJJ95i7TgZ9VvUNdyZrMKb`

**Role:** Per-mint token register (SOL/wSOL, USDC, NVSC) with segregated vaults, aggregate institutional credit lines, provider-agnostic Keccak-Merkle KYC, and the **daily Clearing House** settlement for HFT desks that borrow and return capital inside single 400ms blocks.

**Phase 1 — single-slot borrow (inside the 400ms block).** `allocate_asset_capacity` verifies the desk's Merkle KYC proof against `credit_line.kyc_merkle_root`, checks pool liquidity (USDC: 1,000,000; SOL: 5,000; NVSC profile ceiling), enforces per-asset ceiling + aggregate credit ceiling, then atomically CPIs the principal from the segregated pool vault out to the desk's trading ATA — all in one Jito bundle. Any failure reverts the entire block. The window opens (`window_start_slot`) on the first borrow and `peak_active_utilization` is rolled.

**Phase 2 — 24h floating credit stacking.** Bounded by `WINDOW_SLOTS` (216,000 ≈ 24h @ 400ms). Thousands of slot trades accrue onto a single credit line. The micro-premium is **accrued, not paid per entry**: `accumulated_premiums` ticks like a taxi meter on both the credit line and the per-mint `DeskPosition` mirror. No per-entry fee transfers. `peak_active_utilization` is streamed to the off-chain Risk Sentinel via the gRPC `GetDeskStatus` RPC.

**Phase 3 — Daily Clearing House process.** When the window matures, the Auto-Clearer invoices `Total Capital Utilized + Accumulated Micro-Premiums`. The desk's custody treasury (Fireblocks/Anchorage) returns the exact native asset — USDC settles USDC, SOL settles SOL, NVSC settles NVSC. `settle_daily` verifies `principal_payment == active_principal` and `premium_payment == accumulated_premiums`, transfers principal back into the pool vault and premiums into the per-asset fee vault, re-credits `total_idle_capital`, resets the position + taxi meter + window + peak to zero, increments `settled_invoices`, and stamps `last_settlement_timestamp`.

**Zero-default safeguards (on-chain, deterministic — never slaved to Sentinel timing).**

- **Phase 2 soft lock (window maturity).** Once `current_slot >= window_start_slot + WINDOW_SLOTS`, the running 24h window is frozen: `apply_allocation` refuses every new borrow with `WindowOverdue`, so outstanding debt is capped at its printed value and the pool can no longer be drained. The Risk Sentinel *observes* this posture via gRPC — it never has to fire a defensive transaction.
- **Phase 3 hard escalation wall (2h grace).** `GRACE_SLOTS` (18,000 ≈ 2h) of grace follow maturity. The per-block default-interest meter — `compute_late_fee(principal, overdue_blocks)` at `LATE_FEE_RATE_BPS` (50 micro-bps/slot, ~90 bps ≈ 0.9% over the full grace) — ticks deterministically and must be remitted alongside principal + premiums or `settle_daily` refuses with `LateFeeMismatch`. Throughout grace, `DeskPosture` in the gRPC envelope reports `OPEN / OVERDUE / BREACHED` at each observed slot. Once `current_slot >= mature + GRACE_SLOTS` the desk is **Breached**: the on-chain layer stands down, refuses settlement (`WindowBreached`) and hands off to corporate risk / off-chain Master Loan Agreement covenants.

**Ledger accounts.** `AssetRegistry` (global config) → `AssetPool` (per-mint params + vault pair) → `InstitutionalCreditLine` (aggregate ceiling + window + meter) → `DeskPosition` (per institution × mint mirror). Liquidity providers seed pools via `deposit_asset_liquidity` (minting ERC-4626 share tokens); LPs redeem proportional value via `withdraw_asset_liquidity` (subject to the desk-solvency floor); fees are swept per-mint via `withdraw_asset_fees`.

### 3m. LP Share Vaults — ERC-4626 Accounting Layer

The multi-asset engine's borrow side is paired with an ERC-4626-style **share layer** so external liquidity co-exists with the desk's windowed credit. Accounting is a pure on-chain ledger — no external pool contract, no re-staking, no manual claim.

**Share tokens.** Each registered asset mints its own internal share (nUSDC, nSOL, nNVSC) from PDA `[asset-lp-mint, mint]` at the asset's own decimals. A per-(pool, LP) ledger `[asset-lp-position, mint, lp]` tracks `shares` + `deposited_assets`.

**Deposit → mint (proportional).** `deposit_asset_liquidity` transfers the native asset into the pool vault first (donation-proof — yields inflate the whole book), then mints `shares = deposit × total_shares / total_assets` (1:1 on the first seed) to the LP's share ATA.

**Auto-compounding.** At `settle_daily`, each desk payment splits into `principal → vault`, and premium splits by `lp_yield_split_bps` (default profile 9,000 bps = 90%): the 90% `lp_credit` lands in the pool vault alongside principal while 10% + late fee goes to the fee spine. Raw vault assets rise at constant total shares → **share price rises block-by-block with no manual action**; LP claims grow silently.

**Withdraw → burn (with desk-solvency floor).** `withdraw_asset_liquidity` burns share tokens and pays `shares × total_assets / total_shares` from the vault. The redemption is refused (`InsufficientIdleReserve`) if it would drop idle liquidity below the pool's active credit utilization — an LP can never starve an open desk window, even under co-ordinated exit.

**Structural system map (off-chain ↔ on-chain latencies).**

| Sub-System | Primary Role | Placement | Latency Profile |
|---|---|---|---|
| Sumsub / SAS Matrix | Issues cryptographic compliance stamps (KYC/AML proof) | Hybrid — Off-chain webhook → on-chain PDA root | Asynchronous |
| Leader Schedule Tracker | Pre-routes transaction bundles to the winning node set | Pure Off-Chain (RAM memory map) | Sub-Millisecond (<1ms) |
| Jito Bundle Sequencer | Packages allocation + arbitrage atomically per slot | Pure Off-Chain Engine | Real-Time Execution |
| Risk Sentinel Engine | Monitors 24h timelines, triggers Overdue locks / breach flags | Pure Off-Chain (Automated Ref) | Per-Minute Evaluation |
| Clearinghouse Module | Atomic balance resets + premium splits at window close | Pure On-Chain Smart Contract | Single-Slot Finality |
| LP Share Vaults | Deposit / withdraw / auto-compounding share accounting | Pure On-Chain Ledger Accounts | Real-Time Accounting |

**Accounting units.** USDC (6 decimals) → nUSDC stables cash pool; wSOL (9 decimals) → nSOL network liquidity pool; NVSC (9 decimals) → nNVSC native equity capital under strict haircut reserves.

### 3n. Layered Governance Multi-Sig (Three-Tier RBAC)

A multi-million asset pool cannot hang off a retail developer wallet. The engine's authority surface is split into three independent cryptographic control structures (Squads-style multisigs on Solana), each optimized for a different axis: **speed** of emergency response, **regulatory custody** of risk parameters, and **deliberation** for structural protocol change.

```
                          Noviscia Governance Engine
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        ▼                            ▼                            ▼
┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│  Tier 1: Emergency  │   │  Tier 2: Risk        │   │  Tier 3: Core        │
│  Risk Guard         │   │  Committee           │   │  Ecosystem Council   │
│  "The Breaker"      │   │  (Parameter Vault)   │   │  (The Council)       │
│  1-of-3 Squads      │   │  3-of-5 Squads       │   │  5-of-7 Squads       │
│  Instant freeze     │   │  Limits · Tiers ·    │   │  Program upgrades ·  │
│  of credit lines /  │   │  Premium rates · KYC │   │  Treasury allocations│
│  JIT loop pause     │   │  roots               │   │  (72h timelock)      │
└──────────────────────┘   └──────────────────────┘   └──────────────────────┘
```

**On-chain RBAC (enforced before business logic).** `AssetRegistry` stores exactly three authority keys — `breaker_authority`, `risk_committee_authority`, `upgrade_authority` — each expected to be a Squads multisig PDA. Every authority-bearing instruction pins its signer to the matching key via Anchor `has_one`/constraint checks at the account-validation phase. A compromised Tier-1 Breaker key asking to raise a credit ceiling is rejected by the runtime *before* any handler runs. The surface:

| Instruction | Tier | Key checked |
|---|---|---|
| `set_paused` (engine-wide pause) | 1 — Breaker (1-of-3) | `breaker_authority` |
| `set_credit_frozen` (desk freeze) | 1 — Breaker (1-of-3) | `breaker_authority` |
| `initialize_credit_line` (desk onboarding) | 2 — Risk Committee (3-of-5) | `risk_committee_authority` |
| `update_credit_limit` | 2 — Risk Committee (3-of-5) | `risk_committee_authority` |
| `set_kyc_root` (KYB proof root) | 2 — Risk Committee (3-of-5) | `risk_committee_authority` |
| `update_asset_params` (premium / capacity) | 2 — Risk Committee (3-of-5) | `risk_committee_authority` |
| `set_asset_support` (asset tier toggle) | 2 — Risk Committee (3-of-5) | `risk_committee_authority` |
| `initialize` (bootstrap) | 3 — Council (5-of-7) | `upgrade_authority` |
| `register_asset` (new asset class) | 3 — Council (5-of-7) | `upgrade_authority` |
| `withdraw_asset_fees` (treasury allocation) | 3 — Council (5-of-7) | `upgrade_authority` |
| Program upgrades (BPF loader) | 3 — Council (5-of-7) | `upgrade_authority` |

The desk-facing traffic path (`allocate_asset_capacity`, `recredit_asset_capacity`, `settle_daily`) is uninstrumented — it is signed by the desk/trader/treasury directly for 400ms-slot latency and never touches the governance tier.

**72-hour timelock bound.** Tier 3 is hard-bound to a 72h on-chain timelock delay: program upgrades and fee-treasury allocations are queued through the Squads timelock vault, giving institutional LPs a full window to redeem their nUSDC/nSOL/nNVSC shares before any protocol mutation applies. Tier-1 and Tier-2 execute immediately within their *narrowed* scopes so operational risk controls stay fast.

**Multi-sig lifecycle (illustrated).** Proposal → draft in the Tier-2 Squads interface → 3-of-5 hardware wallets sign the payload (Ledger / Fireblocks co-signing) → final signer broadcasts → `update_credit_limit` writes the new ceiling to the `InstitutionalCreditLine` PDA natively on-chain.

### 3o. Master Loan Agreement — The Legal-to-Code Bridge

The Institutional Master Loan Agreement (`docs/MASTER_LOAN_AGREEMENT.md`) is the contract that
turns the engine's on-chain credit-limit parameter into an enforceable corporate obligation, so
institutional HFT desks can trade on underwritten credit lines. Its drafting principle is a
**negotiated split of authority between code and law**: *code governs execution speed (the 400ms
slot); corporate law governs financial finality (the 24-hour settlement)*. A desk that behaves
perfectly only ever touches the low-latency SDK; a desk whose clearing systems crash meets a
binding corporate agreement — not raw code coercion.

The MLA is a three-pillar structure, each pillar binding to a mechanism this engine already
enforces:

| Pillar | Legal content | On-chain enforcement (already live) |
|---|---|---|
| **Clause 1 — Facility Scope & Asset Definitions** | Non-committed revolving facility; draws in wSOL/USDC/NVSC up to the NRS-derived Borrowing Limit; explicit sign-off on real-time oracle **haircuts** | `initialize_credit_line` / `update_credit_limit` (Risk Committee); per-mint `allocate_asset_capacity` against idle pool liquidity; NRS maintained off-chain by the Risk Sentinel |
| **Clause 2 — Atomic Return & Daily Clearing Covenants** | 86,400-second rolling window from the first slot; principal + micro-premiums due at maturity; **exact-asset settlement** for accounting finality | `WINDOW_SLOTS = 216,000` (× 400ms = 24h); `window_start_slot` stamped at draw; `settle_daily` verifies and zeroes; per-mint vault settlement with no cross-asset netting |
| **Clause 3 — Programmatic vs. Legal Events of Default** | Soft-lock at 24h (Overdue, no new draws); 2-hour operational grace; Formal Event of Default → freeze DIF / Escrowed Loss Reserves, cross-collateralization seizure, corporate recovery | `WindowOverdue` guard at maturity; `GRACE_SLOTS = 18,000` (× 400ms = 2h) linear late-fee meter `LATE_FEE_BASE = 10,000` × `LATE_FEE_RATE_BPS = 50`; Council-authorized recovery path |

The contract's **Schedule B — Protocol Integration Schedule** is the engineering bridge itself: a
clause-by-clause table mapping each contractual obligation to its executing instruction and
exact constant (issue authority, PDA, slot window, fee formula), so counsel and protocol engineers
read one artifact. Legal meaning wins on conflict; the smart contract is the deterministic
executor, and on-chain records are adduced as conclusive evidence of the recorded facts.

Governed by New York law, enforced through Tier-2 (credit parameters) and Tier-3 (amendment and
remedy) governance, the MLA is the compliance wrapper that lets the pools accept real institutional
capital while keeping the arbitrage-scale trade path purely programmatic.

---

## 4. Revenue Model

### 4a. Fee Collection Points

```
                    ┌─────────────────────────────────────────────┐
                    │           REVENUE ENTRY POINTS              │
                    ├─────────────────────────────────────────────┤
                    │                                             │
                    │  1. REVENUE ENGINE — SOVEREIGN NETTING      │
                    │     State-A netting rent (NettingRentPaid)   │
                    │     → 100% → fee spine → vault NAV           │
                    │                                             │
                    │  2. REVENUE ENGINE — GATEWAY AUCTION         │
                    │     State-B auction + premium tips           │
                    │     (AuctionSettled) → fee spine → vault NAV │
                    │                                             │
                    │  3. REVENUE ENGINE — JIT-RISK (TVV)          │
                    │     State-C slot-scoped slice premia         │
                    │     (SliceRented / PremiumSwept)             │
                    │     → 85% NAV / 15% backstop                 │
                    │                                             │
                    │  4. PERP TRADING FEE (trading_fee_bps)       │
                    │     Charged on: open_position_jit            │
                    │                 close_position               │
                    │                 execute_limit_order          │
                    │                 execute_twap_slice           │
                    │     Current: 5–50 bps (0.05%–0.50%) by tier  │
                    │     → 100% → vault NAV                       │
                    │                                             │
                    │  5. LIQUIDATION PENALTY                     │
                    │     Triggered on: liquidate                  │
                    │     Split: 2000 bps (20%) of position value │
                    │     20% liquidator · 80% retained           │
                    │     (10% insurance fund · 90% vault NAV)    │
                    │                                             │
                    │  6. FUNDING RATE                            │
                    │     Peer-to-peer, settled hourly            │
                    │     No pool — paid directly long↔short      │
                    │                                             │
                    └─────────────────────────────────────────────┘
```

### 4b. Perp Trading Fee (Vault NAV)

Every `trading_fee_bps` charge (on open AND close) accrues into the omni-pool NAV
(via `accumulate_protocol_fees`), lifting `fee_index` for **all** nvscUSDC holders —
including those with locked margin:

```
                    size_usdc × trading_fee_bps / 10,000
                                    │
                                    ▼
                       ┌──────────────────────────┐
                       │         100% VAULT NAV   │
                       │  Swept into total_assets │
                       │  → share price increases │
                       │  for ALL nvUSDC holders  │
                       └──────────────────────────┘
```

NVSC buyback/burn and staker fee-share are handled through the fee spine and
`staking-manager`; the dedicated burn program is **deferred** (`programs/later/`).

### 4c. Liquidation Penalty Split

```
              Position Notional × LIQUIDATION_CALLER_BOUNTY_BPS / 10,000
              (2000 bps = 20% of size_usdc)
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
           ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
           │  20% CALLER  │ │  10%         │ │  70%         │
           │  BOUNTY      │ │  INSURANCE   │ │  VAULT NAV   │
           │              │ │  FUND        │ │              │
           │  Paid to the │ │  Added to   │ │  Swept into  │
           │  wallet that │ │  market's   │ │  total_assets│
           │  called      │ │  insurance_ │ │  → share price│
           │  liquidate() │ │  fund_usdc  │ │  increases   │
           └──────────────┘ └──────────────┘ └──────────────┘
```

**Constants:**
```rust
LIQUIDATION_CALLER_BOUNTY_BPS = 2_000   // 20% → liquidation caller
INSURANCE_FUND_BPS            = 1_000   // 10% → insurance fund
// Vault NAV gets: 10_000 - 2_000 - 1_000 = 7_000 (70%)
```

### 4d. Permissionless Executor Bounties

| Action | Bounty (bps) | Source | Description |
|--------|-------------|--------|-------------|
| `execute_limit_order` | 20 | From escrowed collateral | Service fee for filling triggered order |
| `execute_twap_slice` | 20 | From escrowed collateral | Service fee for executing TWAP slice |
| `execute_tp_sl` | 20 | From returned shares | Service fee for triggered close |
| `execute_adl` | 100 | From position shares | Bounty for auto-deleveraging |
| `liquidate` | 2000 | 20% of position notional | Full liquidation penalty bounty |

### 4e. Referral System

```rust
REFERRAL_SHARE_BPS = 500   // 5% of liquidation protocol share → referrer
```

### 4f. Complete Revenue Waterfall

```
REVENUE ENGINES → omni-pool NAV (all tracked by the indexer)
│
sovereign-netting (State-A rent)      → 100% → fee spine → vault NAV
gateway-auction (State-B tips)        → 100% → fee spine → vault NAV
jit-risk (State-C slice premia)       → 85% → NAV · 15% → backstop reserve
│
PERP TRADING FEE (open + close)       → 100% → vault NAV
│
LIQUIDATION PENALTY
│   ├── 20% (2000 bps) → liquidator caller
│   └── 80% protocol-retained
│       ├── 10% → per-market insurance fund
│       └── 90% → vault NAV
│
FUNDING RATE (peer-to-peer)           → redistributed long↔short (not revenue)
│
ALL ENGINE REVENUE GROWS fee_index / NAV for every nvscUSDC holder
```

The indexer (`:8092`) tracks all three revenue engines plus perp/liquidation flows to keep
the omni-pool NAV and the frontend home metrics (Velocity APY 15–35%, AUM, κ) current.

---

## 5. Oracle Architecture

### 5a. JIT (Just-In-Time) Oracle Pull

The primary oracle mechanism. Every price-sensitive instruction pulls a fresh price from Pyth Hermes REST API, submits it in the same transaction.

```
┌──────────────┐     GET /v2/updates/price/latest      ┌──────────────┐
│  CLIENT      │ ───────────────────────────────────────► │ PYTH HERMES  │
│              │ ◄─────────────────────────────────────── │ REST API     │
│  1. fetch    │    signedPricePayload (VAA binary)       │              │
│  2. sign TX  │    merklePriceUpdateBytes (proof)        └──────────────┘
│  3. submit   │
│              │     ┌──────────────────────────┐
│              │     │   SOLANA VALIDATOR       │
│              │────►│                          │
│              │     │  pyth-solana-receiver     │
│              │     │  verifies VAA signatures  │
│              │     │  (5+ guardians required)  │
│              │     │                          │
│              │     │  position-tracker         │
│              │     │  enforces:                │
│              │     │  • price age ≤ 30s        │
│              │     │  • feed_id matches market │
│              │     │  • deviation ≤ 5%         │
│              │     └──────────────────────────┘
└──────────────┘
```

**Key Constants:**
```rust
JIT_MAX_PRICE_AGE_SECS    = 30     // Max age of oracle price
JIT_MIN_GUARDIAN_SIGNATURES = 5     // Min Wormhole guardian sigs
MAX_PRICE_DEVIATION_BPS   = 500    // 5% max deviation between reads
MAX_PRICE_AGE_SLOTS       = 10     // ~4 seconds at 400ms/slot
CLIENT_PRICE_FRESHNESS_GRACE_SECS = 20  // Client-side grace window
```

### 5b. Price Normalization

All prices are normalized to 1e6 scale (6 decimal places):

```rust
fn scale_pyth_price_to_1e6(raw_price: i128, expo: i32) -> u64 {
    let delta = expo + PRICE_SCALE_EXPO;  // expo + 6
    if delta >= 0 { raw_price * 10^delta }
    else          { raw_price / 10^(-delta) }
}
// BTC/USD (expo=-8): delta=-2, so divide raw by 100
// ETH/USD (expo=-8): same
// SOL/USD (expo=-8): same
```

---

## 6. Risk Engine

### 6a. Single-Position Margin Model

```
Required Initial Margin = size_usdc × 10,000 / max_leverage_bps
Maintenance Margin     = size_usdc × maintenance_margin_bps / 10,000

Example (BTC 50x, 100 bps maintenance):
  Position: $10,000 notional, 50x leverage
  Initial Margin:   $10,000 × 10,000 / 5,000 = $20,000 ... no wait
  max_leverage_bps = 5000 means 50x
  Initial Margin = $10,000 / 50 = $200
  Maintenance Margin = $10,000 × 100 / 10,000 = $100

Liquidation Condition:
  equity < maintenance_margin
  where equity = size_usdc + pnl_usdc
  and pnl_usdc = (live_price - entry_price) × size / entry_price (long)
```

### 6b. Portfolio Margin (Risk Matrix Model)

Up to 8 markets with a correlation matrix:

```
portfolio_risk:  H = W' × Σ × W

Where:
  W = vector of position notional values
  Σ = correlation matrix (stored as i16 bps, diagonal = variance)
  H = portfolio heat (variance-covariance hedged exposure)

If portfolio_margin_enabled:
  margin_required = √(H) instead of Σ individual margins
  → hedged positions need less margin
```

### 6c. State Hash Chain (Audit Trail)

Every position mutation creates a SHA-256 hash linking to the previous:

```
state_hash = SHA-256(
  STATE_HASH_DOMAIN ||     // "noviscia-pos-state-v1"
  owner ||
  market ||
  is_long ||
  size_usdc ||
  entry_price ||
  collateral_shares ||
  open_slot ||
  entry_funding_index ||
  previous_state_hash     // creates the chain
)
```

Any tampering with position fields breaks the hash chain — auditable by anyone.

---

## 7. Funding Rate Mechanism

```
Settlement Frequency: once per hour (FUNDING_SETTLE_MIN_INTERVAL_SECS = 3600)
Rate: 1 bps per settlement for a fully one-sided market (FUNDING_RATE_BPS_PER_SETTLE = 1)

Actual rate = base_rate × skew_ratio
where skew_ratio = |long_oi - short_oi| / total_oi

If longs > shorts: longs pay shorts
If shorts > longs: shorts pay longs

Payment is settled into the position's PnL via funding_index delta:
  payment = size_usdc × (current_funding_index - entry_funding_index) / FUNDING_INDEX_SCALE
```

---

## 8. Off-Chain Infrastructure

**Live services (`docker-compose.yml`):** postgres, redis, websocket, price-feed,
indexer (port 8092 — revenue/tick indexer), ai-orchestrator, web, netting-relayer.
The `indexer` is the revenue/tick indexer tracking all three revenue engines. The
removed services `liquidation-keeper`, `risk-engine`, `ai-rebalancer`, and
`mock-pyth-receiver` are no longer part of the live set.

### 8a. Executor Bot

**File:** `scripts/executor/execute-limit-twap-devnet.ts` (790 lines)
**Role:** Permissionless daemon that earns bounties by executing triggered orders.

```
┌─────────────────────────────────────────────────────────────────┐
│                       EXECUTOR BOT LOOP                         │
│                                                                 │
│  Every 15s (configurable):                                     │
│                                                                 │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │  SCAN LIMIT      │  │  SCAN TWAP       │  │  SCAN POSITIONS│ │
│  │  ORDERS          │  │  ORDERS          │  │  (TP/SL + LIQ) │ │
│  │                  │  │                  │  │                │ │
│  │  getProgramAccts │  │  getProgramAccts │  │  getProgramAccts│ │
│  │  discriminators  │  │  discriminators  │  │  dataSize=227  │ │
│  │  Check triggers  │  │  Check intervals │  │  Manual decode │ │
│  └────────┬─────────┘  └────────┬─────────┘  └───────┬───────┘ │
│           │                     │                     │          │
│           └──────────┬──────────┴─────────────────────┘          │
│                      │                                           │
│              ┌───────▼─────────┐                                │
│              │  BATCH JIT      │                                │
│              │  ORACLE FETCH   │                                │
│              │                 │                                │
│              │  Single Hermes  │                                │
│              │  call for ALL   │                                │
│              │  market feeds   │                                │
│              └───────┬─────────┘                                │
│                      │                                           │
│              ┌───────▼─────────┐                                │
│              │  BUILD & SEND   │                                │
│              │  TRANSACTIONS   │                                │
│              │                 │                                │
│              │  • Dynamic CU   │                                │
│              │  • Priority fees│                                │
│              │  • ALT fallback │                                │
│              │  • Smart retry  │                                │
│              └─────────────────┘                                │
└─────────────────────────────────────────────────────────────────┘
```

**Key Optimizations:**
- **Batch JIT Oracle:** Single HTTP call fetches ALL market prices + VAA data
- **Manual Position Decode:** Zero Anchor overhead — raw byte offsets
- **Parallel Execution:** limit + TWAP + TP/SL/liquidation run concurrently
- **Dynamic Compute Budget:** Starts at 300K CU, doubles on failure up to 1.4M
- **Smart Error Classification:** transient → retry, permanent → skip, compute → escalate
- **ALT Compress:** Address Lookup Tables compress V0 transactions to fit 1232-byte limit

### 8b. Indexer Service

**File:** `services/indexer/` (Express + PostgreSQL)
**Port:** 8092

**Architecture:**
```
┌──────────────┐    getSlot('confirmed')    ┌──────────────────┐
│  INDEXER      │ ◄───────────────────────── │  SOLANA RPC     │
│  (poll 30s)   │                            │                  │
│               │    Fetch blocks, parse     └──────────────────┘
│  Parse events │    Anchor EventParser
│  from 10+     │         │
│  programs     │         ▼
│               │    ┌──────────────────┐
│               │───►│  POSTGRESQL      │
│               │    │                  │
│               │    │  perps_fills     │
│               │    │  perps_orders    │
│               │    │  oracle_ticks    │
│               │    │  copy_followers  │
│               │    │  api_keys        │
│               │    │  user_activity   │
└───────┬───────┘    └──────────────────┘
        │
        ▼
┌──────────────────┐
│  EXPRESS API     │
│                  │
│  GET /orders     │
│  POST /orders    │
│  GET /history    │
│  GET /activity   │
│  POST /api-keys  │
│  POST /copy/*    │
└──────────────────┘
```

### 8c. WebSocket Service

**Port:** 8080

| Channel | Data |
|---------|------|
| `prices:{symbol}` | Real-time price updates |
| `orderbook:{symbol}` | Order book depth |
| `positions:{wallet}` | User position updates |
| `yields:{wallet}` | Yield earnings |
| `trades` | Recent trades broadcast |
| `alerts:{wallet}` | Liquidation alerts |

### 8d. Frontend Client Library

**Files:** `client.ts` (1781 LOC) + `jitOracle.ts` (492 LOC) + `altCache.ts` (319 LOC)

**Two-Tier ALT System:**
- **Global JIT ALT:** 19 constant accounts + all market PDAs. Cached in localStorage.
- **Per-Position ALT:** Position + collateral vault + caller ATAs. Cached per wallet.

**Key Exported Functions:**
| Category | Functions |
|----------|-----------|
| **Read** | `fetchAllPositions`, `fetchMarket`, `fetchAllLimitOrders`, `fetchTwapOrder` |
| **Decode** | `decodePosition`, `decodeMarket`, `decodeLimitOrder`, `decodeTwapOrder` |
| **Trade** | `openPositionJit`, `closePosition`, `partialClosePosition` |
| **Delegate** | `openPositionDelegate`, `createSessionDelegation`, `revokeSession` |
| **Margin** | `addMargin`, `removeMargin` |
| **Orders** | `placeLimitOrder`, `cancelLimitOrder`, `executeLimitOrder` |
| **TWAP** | `createTwapOrder`, `cancelTwapOrder`, `executeTwapSlice` |
| **TP/SL** | `setTpSl`, `executeTpSl` |
| **Risk** | `liquidatePosition`, `executeAdl` |
| **Referral** | `registerReferral` |

---

## 9. Devnet Deployment State

### Program IDs (15 active programs, deployed and verified on devnet)

| # | Program | Devnet ID |
|---|---------|-----------|
| 1 | Position Tracker | `6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws` |
| 2 | nv-usdc-vault | `CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC` |
| 3 | netting-engine | `68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56` |
| 4 | clearing-registry | `Hg5QvSsnb22gHexUTnvvfff3EJZxWnsFKRM8bZ8n7Jmo` |
| 5 | noviscia-clearing | `GtTJWLa6MXjZoNucGHWVnE9LpZTw6Dsr5K1gxpM1Q4fe` |
| 6 | sovereign-netting | `9YxL2Gk3cphCjxeKgfj2cnY4wCBDzej3L83jLGJ52Dyk` |
| 7 | gateway-auction | `HQ26VTfoBVmGFY1JsFp5HmMT3rjLNoLJH6zurm8TL9xR` |
| 8 | jit-risk | `3w9GrHBXpMNSc3P3kBWmHwkhEr1u5FBQrTiD4k3NAXwh` |
| 9 | noviscia-credit-line | `8usJu6agjifCXYwSsRVoMWqm22h2HUSfebw1zEEHAMYg` |
| 10 | liquidation-vault | `Cwma3FfMKhoLkgfrGYgErVPoFWEtHpx7DNc4wArpRHBz` |
| 11 | yield-router | `FKaAPPid8B6hUme4w8bFCDzmvE6DpekXpeiR1sgyLwB4` |
| 12 | yield-distributor | `CrN1o75FGwcSo6ted7eKxw2kYgkaXDVeWmUaTZCTsLtw` |
| 13 | staking-manager | `HjxcKV51A7jxE2iqMCDY7EvWFL9XsheuM43DamWGabqb` |
| 14 | ve-nvs | (veNVSC vote-escrow) |
| 15 | token-nvsc | `HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT` |

**Deferred / not live** (`programs/later/`): burn-engine `nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id` · escrow `2WPb3wsyp4G6zFPx8sTYf3bTDyySxwpo1Ja8H6RCHXCZ` · protocol-lp-vault `2WUt24rRNWsdi8sE56y74b7rJGgKbxSBsu7ntDkGAJkd` · spot-dex `8C4try8mEHukT4Z99Dpi3x1rNaBYhXms81uoU47JwLiN` · bug-bounty `A8Uk9WuHumfiuuZAHt4y3t3sXmT3cpXVXaFMhpDinjSK`.

**Removed / no longer in the codebase:** cross-border (`C3uoiE3GZ47nuGwUckQPsZF8JBqgMk54nmfJYKqAEMbv`) and tbill-fund programs; liquidation-keeper, risk-engine, ai-rebalancer, mock-pyth-receiver services.

### Current Devnet Market State (22 markets)

| Market | Tier | Max Leverage | Maint Margin | Trading Fee |
|--------|------|-------------|--------------|-------------|
| BTC/USD | Blue-chip | 50x | 1% | 0.05% |
| ETH/USD | Blue-chip | 50x | 1% | 0.05% |
| SOL/USD | Blue-chip | 50x | 2% | 0.05% |
| DOGE/USD | Large-cap | 20x | 2% | 0.10% |
| LINK/USD | Large-cap | 20x | 2% | 0.10% |
| AVAX/USD | Large-cap | 20x | 2% | 0.10% |
| RENDER/USD | Large-cap | 20x | 2% | 0.10% |
| WIF/USD | Mid-cap | 10x | 5% | 0.25% |
| JUP/USD | Mid-cap | 10x | 5% | 0.25% |
| RAY/USD | Mid-cap | 10x | 5% | 0.25% |
| TRUMP/USD | Mid-cap | 10x | 5% | 0.25% |
| PNUT/USD | Mid-cap | 10x | 5% | 0.25% |
| BONK/USD | Meme | 5x | 10% | 0.50% |
| PEPE/USD | Meme | 5x | 10% | 0.50% |
| OP/USD | Meme | 5x | 10% | 0.50% |
| ARB/USD | Meme | 5x | 10% | 0.50% |
| PYTH/USD | Catalog | 25x | 2% | 0.25% |
| JTO/USD | Catalog | 25x | 2% | 0.25% |
| ORCA/USD | Catalog | 20x | 2% | 0.25% |
| POPCAT/USD | Catalog | 15x | 5% | 0.50% |
| MEW/USD | Catalog | 15x | 5% | 0.50% |
| HNT/USD | Catalog | 20x | 2% | 0.25% |

### Pyth Feed IDs

| Asset | Hex Feed ID |
|-------|-------------|
| SOL/USD | `ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` |
| BTC/USD | `e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` |
| ETH/USD | `ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` |
| DOGE/USD | `dcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c` |
| LINK/USD | `8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221` |
| AVAX/USD | `93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7` |
| RENDER/USD | `3d4a2bd9535be6ce8059d75eadeba507b043257321aa544717c56fa19b49e35d` |
| WIF/USD | `4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc` |
| JUP/USD | `0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996` |
| RAY/USD | `91568baa8beb53db23eb3fb7f22c6e8bd303d103919e19733f2bb642d3e7987a` |
| TRUMP/USD | `879551021853eec7a7dc827578e8e69da7e4fa8148339aa0d3d5296405be4b1a` |
| PNUT/USD | `116da895807f81f6b5c5f01b109376e7f6834dc8b51365ab7cdfa66634340e54` |
| BONK/USD | `72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419` |
| PEPE/USD | `d69731a2e74ac1ce884fc3890f7ee324b6deb66147055249568869ed700882e4` |
| OP/USD | `385f64d993f7b77d8182ed5003d97c60aa3361f3cecfe711544d2d59165e9bdf` |
| ARB/USD | `3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5` |
| PYTH/USD | `0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff` |
| JTO/USD | `b43660a5f790c69354b0729a5ef9d50d68f1df92107540210b9cccba1f947cc2` |
| ORCA/USD | `37505261e557e251290b8c8899453064e8d760ed5c65a779726f2490980da74c` |
| POPCAT/USD | `b9312a7ee50e189ef045aa3c7842e099b061bd9bdc99ac645956c3b660dc8cce` |
| MEW/USD | `514aed52ca5294177f20187ae883cec4a018619772ddce41efcc36a6448f5d5d` |
| HNT/USD | `649fdd7ec08e8e2a20f425729854e90293dcbe2376abc47197a14da6ff339756` |

---

## 10. Frontend Page Map

```
/                           Homepage (hero, stats, tokenomics, FAQ)
├── /trade/
│   ├── /perps              Perpetual futures trading UI
│   ├── /swap               Token swap
│   ├── /collateral         Multi-collateral management
│   ├── /triggers           TP/SL trigger management
│   ├── /liquidations       Liquidation opportunity finder
│   ├── /stocks             Stocks (coming soon)
│   └── /prediction         Prediction markets
├── /earn/
│   ├── /vault              nvUSDC vault deposit/withdraw
│   ├── /stake              NVSC staking
│   ├── /rewards            Reward claiming
│   ├── /insurance          Insurance fund LP
│   ├── /loans              Lending/borrowing
│   ├── /ai                 AI trading strategies
│   ├── /pol                Protocol-Owned Liquidity
│   ├── /stake-sol          SOL staking
│   └── /trade              Trade-to-earn
├── /manage/
│   ├── /portfolio          Portfolio overview
│   ├── /positions          Position management
│   └── /orders             Order management
├── /more/
│   ├── /docs               Documentation
│   ├── /blog               Blog
│   ├── /community          Community
│   ├── /support            Support
│   ├── /legal              Legal
│   └── /bug-bounty         Bug bounty program
├── /analytics              Analytics dashboard
├── /token                  NVSC token page
└── /faq/portfolio-math     Portfolio margin math explainer
```

---

## 11. Security Model

### Three-Tier Safety

1. **Oracle Security:**
   - JIT price freshness ≤30s (prevents stale quote front-running)
   - Client-side freshness grace of 20s
   - Price deviation circuit breaker (5% in 4 seconds)
   - Wormhole guardian verification (5+ signatures)

2. **Margin Safety:**
   - `maintenance_margin_bps × max_leverage_bps < 10,000²` invariant enforced on-chain
   - Portfolio margin risk matrix (variance-covariance model)
   - Auto-deleveraging (ADL) for cascading liquidations

3. **Audit Trail:**
   - SHA-256 state hash chain on every position mutation
   - All events indexed and stored in PostgreSQL
   - On-chain position data human-readable at 227 bytes per position

---

## 12. Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Rust / Anchor 0.31.1 / Solana 2.x |
| Frontend | Next.js 14 / React 18 / Tailwind CSS |
| Oracle | Pyth Network (JIT pull) + Wormhole (VAA verification) |
| Database | PostgreSQL (indexer) |
| Services | Express.js / WebSocket (ws) / Ollama (AI) |
| DevOps | Anchor CLI / Solana CLI 2.3.13 / Railway |
| Testing | solana-program-test (Rust) / E2E scripts (TypeScript) |
| Token Standard | SPL Token (USDC, nvUSDC, NVSC) / Wrapped SOL |

---

## 13. CCP Design & Risk Framework

Noviscia is a **true central counterparty (CCP)** — it interposes itself as counterparty to both sides of every trade (novation), bears default risk, nets obligations, and runs its collateral as a yield engine.

### 13a. True CCP vs Custodial Clearing House

| | Custodial clearing house | **True CCP (Noviscia)** |
|---|---|---|
| Counterparty | Buyers/sellers remain counterparties | **Noviscia interposes on both sides** (novation) |
| Default loss | Defaulter's margin; no further claims | **CCP absorbs** via a loss waterfall |
| Offsetting obligations | Carried bilaterally | **Collapsed instantly** (netting) |
| Vault role | Passive backstop | **Guarantee fund + omni-pool** |
| Collateral | Idle reserve | **Yield engine with atomic recall** |
| Tenants | Isolated pools | **Share one guarantee fund** (moral hazard pooled) |

### 13b. Loss Waterfall (6-Layer, Enforced On-Chain)

```
 1  Trader initial margin (locked nvscUSDC shares)
 2  Trader cross-margin (other product collateral)
 3  Per-market insurance fund      (10% of liquidation penalties)
 4  Global default fund            (15% of fees → 2.5% of OI target)
 5  CCP equity                     (15% of default fund — skin in the game)
 6  Proportional tenant assessment (third-party pool, contractual)
    ─ LP yield / stakers touched only if every prior layer is exhausted ─
```

### 13c. Default Fund Design

- **Target:** 2.5% of aggregate open interest (floor: largest single net house exposure)
- **Funding:** 15% of trading fees diverted until target reached; over-capacity flows back to NAV/burn
- **Insurance:** 10% of liquidation penalties → per-market `insurance_fund_usdc`
- **CCP equity:** 15% of default fund — dedicated reserve, not LP capital

### 13d. Risk Parameters (v1)

| # | Decision | Default | Rationale |
|---|---|---|---|
| D-1 | Mark-to-market cadence | Continuous liquidation marking · hourly funding epochs · PnL realized at close · forced settlement of underwater positions | CPMI-IOSCO continuous marking |
| D-2 | Default-fund target | 2.5% of aggregate OI · 15% of trading fees until target | Covers ~99.9% of expected shortfall |
| D-3 | Cross-margin haircut matrix | Same asset 1.00 · BTC↔ETH 0.85 · ETH↔SOL 0.70 · SOL↔alts 0.50 · floor: 40% of uncrossed requirement | Deribit-style with safety floor |
| D-4 | CCP skin-in-the-game | 15% of default fund; funded by TGE + 2.5% fee slice | Industry standard 10–25% |
| D-5 | Tenant default-fund sharing | Shared fund with risk-based per-tenant tranches; defaulter's own tranche first, then pro-rata with cap | CME/LCH member model |

### 13e. Phased Build Order

1. **P0 — Spec freeze:** margin model, waterfall, default-fund sizing, haircut matrix, fee re-bucket
2. **P1 — CCP book in perps:** `house_net_position_usdc`, residual funding booking, waterfall on liquidation
3. **P2 — Default fund:** vault ledger, fee allocation, target sizing
4. **P3 — Netting engine:** `TraderNetPosition`, cross-margin, cross-tenant
5. **P4 — Event markets formalize CCP:** house book + waterfall on outcomes
6. **P5 — Tenant registry + SDK:** third-party DEX / RWA / GameFi plug in
7. **P6 — Yield router:** external venues + atomic recall

### 13f. Design Rules

1. Every tenant settles into the clearing spine — `accumulate_protocol_fees`-style CPIs, not new silos
2. Collateral is always yield-bearing — never idle capital
3. Atomic risk — price-verification + liquidation + recall in a single transaction (JIT pattern)
4. Unified brand, composable programs — separable Anchor programs with upgrade isolation
5. Novation is the commitment — vault is the guarantee fund, backed by default fund + CCP equity
6. Tenants integrate, they don't fork — permissioned registration + SDK + fee contract
