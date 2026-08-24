# Noviscia Protocol — Complete System Architecture

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
│   Next.js 15 App Router  ·  React 19  ·  Tailwind  ·  Solana wallet-std   │
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
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  POSITION     │  │  NV-USDC     │  │  ESCROW      │  │  PREDICTION  │   │
│  │  TRACKER      │  │  VAULT       │  │              │  │  MARKET      │   │
│  │               │  │              │  │  (legacy)    │  │              │   │
│  │  32 ix fn's   │  │  mint/burn   │  │              │  │  32-bit      │   │
│  │  3zGRW...QgY  │  │  CN92h...AWC │  │  CTmCry...D  │  │  3BTcA...pv  │   │
│  └───────┬──────┘  └──────┬───────┘  └──────────────┘  └──────────────┘   │
│          │    CPI          │                                                │
│  ┌───────┴─────────────────┴───────────────────────────────────────────┐   │
│  │                      SUPPORTING PROGRAMS                            │   │
│  │                                                                     │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌─────────────┐  │   │
│  │  │ BURN       │  │ STAKING    │  │ LIQUIDATION │  │ PROTOCOL-LP │  │   │
│  │  │ ENGINE     │  │ MANAGER    │  │ VAULT       │  │ VAULT       │  │   │
│  │  │            │  │            │  │             │  │             │  │   │
│  │  │ nvUSDC→    │  │ Stake/     │  │ Insurance   │  │ LP shares   │  │   │
│  │  │ NVSC swap  │  │ Unstake    │  │ fund        │  │ deposit/    │  │   │
│  │  │            │  │            │  │             │  │ withdraw    │  │   │
│  │  │ nFgJE...id │  │ 4VDQj...75 │  │ C5mvu...f1  │  │ BJVr4...gT  │  │   │
│  │  └────────────┘  └────────────┘  └─────────────┘  └─────────────┘  │   │
│  │                                                                     │   │
│  │  ┌────────────┐  ┌────────────┐                                    │   │
│  │  │ TOKEN-NVSC │  │ YIELD      │                                    │   │
│  │  │            │  │ DISTRIB.   │                                    │   │
│  │  │ 1B NVSC    │  │ Lend yield │                                    │   │
│  │  │ mint       │  │ split      │                                    │   │
│  │  │            │  │            │                                    │   │
│  │  │ HSaBJ...YT │  │ CrN1o...tw │                                    │   │
│  │  └────────────┘  └────────────┘                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                │
┌───────────────────────────────┴─────────────────────────────────────────────┐
│                          OFF-CHAIN SERVICES                                 │
│                                                                             │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐               │
│  │  INDEXER        │  │  WEBSOCKET     │  │  AI LAYER      │               │
│  │  (Express + PG) │  │  (ws :8080)    │  │  (Ollama)      │               │
│  │  Slot polling   │  │  Prices        │  │  Trading agent  │               │
│  │  Event parsing  │  │  Positions     │  │  Rebalancer     │               │
│  │  Fills/Activity │  │  Yields        │  │                 │               │
│  └────────────────┘  └────────────────┘  └────────────────┘               │
│                                                                             │
│  ┌────────────────┐  ┌────────────────┐                                    │
│  │  EXECUTOR BOT   │  │  PRICE FEED   │                                    │
│  │  (tsx daemon)    │  │  SERVICE       │                                    │
│  │  Limit orders   │  │  Pyth 60% +    │                                    │
│  │  TWAP slices    │  │  Switchboard   │                                    │
│  │  TP/SL triggers │  │  40%           │                                    │
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
| **NVSC** | `HSaBJ...zYT` | 9 | 1,000,000,000 | Governance + staking + burn target |
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
           │  (legacy)     │        │  (JIT direct)   │
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
3. **Yield sources:** Trading fees (60% vault NAV share) + liquidation surplus (70% vault NAV share) + buyback & burn deflation. **No external lending integrations** — yield is self-contained from protocol activity.
4. **Locked margin:** When a position is open, the trader's nvUSDC shares are "locked" (`locked_margin += shares`). They continue accruing yield even while locked.
5. **Simultaneous Double-Yield:** Positions earn trading yield on their margin while simultaneously trading — the vault's `fee_index` keeps compounding even on locked shares.

---

## 3. On-Chain Programs (16 programs)

### 3a. Position Tracker (Core Engine)
**Program ID:** `3zGRWKZq4V3npHbH9Lati46BwgmstTjynWZFFMxarQgY`
**Lines of Code:** ~5,300 (lib.rs) + ~760 (state.rs)
**Role:** The central perpetual futures engine. Manages positions, orders, funding, liquidation, and oracle verification.

#### All 32 Instructions

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
| **Oracle** | `update_oracle_consensus` | Dual-oracle consensus update (Pyth + Switchboard) |
| | `verify_price_deviation` | Circuit breaker: reject if price moved >5% in 4 slots |
| **Delegation** | `register_session_delegate` | Create session delegate PDA (hot wallet) |
| | `revoke_session` | Revoke session delegation |
| **Referrals** | `register_referral` | Create referral PDA |
| **Portfolio Margin** | `set_portfolio_risk_config` | Set max 8-market correlation matrix |

#### Key On-Chain Structs

**MarketAccount (140 bytes)**
```
authority          Pubkey   (32)   Admin wallet
feed_id            [u8;32]  (32)   Pyth feed identifier
max_leverage_bps   u32      (4)    Max leverage in bps (e.g. 5000 = 50x)
maintenance_margin_bps u16  (2)    Maint. margin in bps (e.g. 100 = 1%)
is_active          bool     (1)    Market enabled flag
funding_index      i128     (16)   Cumulative funding rate (1e6 scale)
long_oi_usdc       u64      (8)    Long open interest
short_oi_usdc      u64      (8)    Short open interest
last_funding_settle_ts i64  (8)    Last settlement timestamp
insurance_fund_usdc u64     (8)    Per-market insurance fund
referral_bps       u16      (2)    Referral bonus bps
trading_fee_bps    u16      (2)    Trading fee in bps
last_recorded_price u64     (8)    Last oracle price (1e6)
last_recorded_slot  u64      (8)    Last slot price was recorded
bump               u8       (1)    PDA bump
```

**PositionAccount (174 bytes)**
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
| `OracleConsensus` | `["oracle-consensus", market]` |

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

### 3c. Escrow (Legacy Multi-Collateral)
**Program ID:** `CTmCryJca9cFyMRaGdzrhyZeEnjdGLD8ZkEqNcNbvh2D`

**Role:** Holds trader deposits (USDC, WSOL, nvUSDC) with per-trader approvals. Being phased out in favor of direct vault mint/burn for USDC positions.

---

### 3d. Burn Engine (Deflationary NVSC Sink)
**Program ID:** `nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id`
**Lines:** ~687

**Role:** Converts trading fees (nvUSDC) into NVSC tokens via AMM, then burns the NVSC — creating deflationary pressure.

#### Flow
1. Receives 15% of every trading fee (in nvUSDC shares)
2. `accumulate_funds()` — receives nvUSDC shares from position-tracker
3. `swap_nvusdc_to_nvsc()` — CPI into NVSC AMM to convert nvUSDC → NVSC
4. NVSC is sent to a burn address (permanently removed from supply)

#### Key PDAs
| PDA | Seeds |
|-----|-------|
| `burn_state` | `["burn_state"]` |
| `burn_vault_usdc` | ATA of `burn_state` for USDC |

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

### 3g. Protocol LP Vault
**Program ID:** `2WUt24rRNWsdi8sE56y74b7rJGgKbxSBsu7ntDkGAJkd`

**Role:** Accepts LP deposits into the protocol's trading pool. LPs earn a share of the trading fees beyond the vault share.

---

### 3h. Token NVSC
**Program ID:** `HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT`

**Role:** The NVSC SPL token mint. 1 billion supply, 9 decimals. Used for governance and staking.

---

### 3i. Yield Distributor
**Program ID:** `CrN1o75FGwcSo6ted7eKxw2kYgkaXDVeWmUaTZCTsLtw`

**Role:** Emergency Committee (EC) draw mechanism. The `ec_draw` instruction allows the Emergency Committee to allocate yield from the vault to stakers. No external lending integrations — yield originates from trading fees and liquidation penalties flowing into vault NAV.

---

### 3j. Prediction Market
**Program ID:** `GtTJWLa6MXjZoNucGHWVnE9LpZTw6Dsr5K1gxpM1Q4fe`

**Role:** Binary prediction markets on Solana. Separate from the perps engine.

---

## 4. Revenue Model

### 4a. Fee Collection Points

```
                    ┌─────────────────────────────────────────────┐
                    │           REVENUE ENTRY POINTS              │
                    ├─────────────────────────────────────────────┤
                    │                                             │
                    │  1. TRADING FEE (trading_fee_bps)          │
                    │     Charged on: open_position_jit           │
                    │                 close_position              │
                    │                 execute_limit_order          │
                    │                 execute_twap_slice           │
                    │     Current: 1000 bps (10%) on BTC devnet   │
                    │     Formula: size_usdc * trading_fee_bps    │
                    │                    / 10_000                  │
                    │                                             │
                    │  2. LIQUIDATION PENALTY                     │
                    │     Triggered on: liquidate                  │
                    │     Split: 2000 bps (20%) of position value │
                    │                                             │
                    │  3. FUNDING RATE                            │
                    │     Peer-to-peer, settled hourly            │
                    │     Rate: 1 bps/settlement of one-sided OI │
                    │     No pool — paid directly long↔short      │
                    │                                             │
                    │  4. BUYBACK & BURN DEFLATION                   │
                    │     15% of fees → nvUSDC → NVSC → burned     │
                    │     Permanently reduces NVSC supply           │
                    │     (no external yield sources)               │
                    │                                             │
                    └─────────────────────────────────────────────┘
```

### 4b. Trading Fee Split (Three-Way)

Every `trading_fee_bps` charge (on open AND close) splits three ways:

```
                         size_usdc × trading_fee_bps / 10,000
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
           ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
           │  60% VAULT   │ │  25% STAKING │ │  15% BURN    │
           │  NAV         │ │  FEE POOL    │ │  ENGINE      │
           │              │ │              │ │              │
           │  Swept into  │ │  Records to  │ │  nvUSDC →    │
           │  total_assets│ │  staking     │ │  NVSC → Burn │
           │  → increases │ │  fee_pool PDA│ │  (deflation) │
           │  share price │ │  → NVSC      │ │              │
           │  for ALL     │ │  stakers     │ │  Removes NVSC│
           │  nvUSDC      │ │  claim       │ │  from supply │
           │  holders     │ │              │ │              │
           └──────────────┘ └──────────────┘ └──────────────┘
```

**Constants (from `state.rs`):**
```rust
TRADING_FEE_VAULT_SHARE_BPS  = 6_000   // 60% → vault NAV
TRADING_FEE_STAKING_SHARE_BPS = 2_500   // 25% → staking fee pool
// Burn engine gets the remainder: 10_000 - 6_000 - 2_500 = 1_500 (15%)
```

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
USER OPENS POSITION ($10,000 long, 50x, trading_fee=1000bps)
│
├── Trading Fee: $10,000 × 1000 / 10,000 = $1,000
│   ├── $600 (60%) → nvUSDC vault NAV → share price increases
│   ├── $250 (25%) → staking fee pool → NVSC stakers claim
│   └── $150 (15%) → burn engine → nvUSDC → NVSC → burned
│
├── Position opens with $9,000 effective margin ($10K - $1K fee)
│
USER CLOSES POSITION (exit at same price)
│
├── Trading Fee: $10,000 × 1000 / 10,000 = $1,000
│   ├── $600 → vault NAV
│   ├── $250 → staking
│   └── $150 → burn
│
├── PnL: $0 (same price)
│
├── Total fees collected: $2,000 round-trip
│
POSITION GOES UNDERCOLLATERALIZED → LIQUIDATION
│
├── Liquidation Penalty: $10,000 × 2000 / 10,000 = $2,000
│   ├── $400 (20%) → liquidator caller
│   ├── $200 (10%) → market insurance fund
│   └── $1,400 (70%) → vault NAV
│
TOTAL ANNUAL REVENUE (if $100M daily volume):
│
├── Trading Fees: $100M × 10% × 365 = $3.65B
│   ├── $2.19B → vault NAV (increases nvUSDC yield)
│   ├── $912.5M → NVSC stakers
│   └── $547.5M → NVSC burned (deflationary)
│
├── Liquidation Penalties: ~$50M (estimated)
│   ├── ~$10M → liquidation callers
│   ├── ~$5M → insurance funds
│   └── ~$35M → vault NAV
│
├── TOTAL: ~$3.70B annually
```

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
│              │     │  • price age ≤ 15s        │
│              │     │  • feed_id matches market │
│              │     │  • deviation ≤ 5%         │
│              │     └──────────────────────────┘
└──────────────┘
```

**Key Constants:**
```rust
JIT_MAX_PRICE_AGE_SECS    = 15     // Max age of oracle price
JIT_MIN_GUARDIAN_SIGNATURES = 5     // Min Wormhole guardian sigs
MAX_PRICE_DEVIATION_BPS   = 500    // 5% max deviation between reads
MAX_PRICE_AGE_SLOTS       = 10     // ~4 seconds at 400ms/slot
ORACLE_DIVERGENCE_LIMIT_BPS = 200  // 2% max Pyth vs Switchboard divergence
```

### 5b. Dual Oracle Consensus (TWAP Orders)

For TWAP orders that execute over time, a separate consensus mechanism keeps an on-chain price reference:

```
┌──────────────┐     update_oracle_consensus()      ┌──────────────┐
│  KEEPER /    │ ──────────────────────────────────► │  ON-CHAIN     │
│  ANY WALLET  │                                     │  ORACLE       │
│              │     Reads both:                     │  CONSENSUS    │
│              │     1. Pyth JIT price               │  PDA          │
│              │     2. Switchboard price            │              │
│              │     Rejects if divergence > 2%      │  Stores:      │
│              │     Stores last_recorded_price      │  - price      │
│              │     Rate-limited: 30s cooldown      │  - slot       │
└──────────────┘                                     │  - feed_id    │
                                                     └──────────────┘
```

### 5c. Price Normalization

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
│  │  discriminators  │  │  discriminators  │  │  dataSize=174  │ │
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
| **Oracle** | `updateOracleConsensus` |
| **Referral** | `registerReferral` |

---

## 9. Devnet Deployment State

### Program IDs (all deployed and verified)

| Program | Devnet ID |
|---------|-----------|
| Position Tracker | `3zGRWKZq4V3npHbH9Lati46BwgmstTjynWZFFMxarQgY` |
| NV-USDC Vault | `CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC` |
| Escrow | `CTmCryJca9cFyMRaGdzrhyZeEnjdGLD8ZkEqNcNbvh2D` |
| Burn Engine | `nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id` |
| Staking Manager | `HjxcKV51A7jxE2iqMCDY7EvWFL9XsheuM43DamWGabqb` |
| Token NVSC | `HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT` |
| Yield Distributor | `CrN1o75FGwcSo6ted7eKxw2kYgkaXDVeWmUaTZCTsLtw` |
| Prediction Market | `GtTJWLa6MXjZoNucGHWVnE9LpZTw6Dsr5K1gxpM1Q4fe` |
| Liquidation Vault | `Cwma3FfMKhoLkgfrGYgErVPoFWEtHpx7DNc4wArpRHBz` |
| Protocol LP Vault | `2WUt24rRNWsdi8sE56y74b7rJGgKbxSBsu7ntDkGAJkd` |

### Current Devnet Market State

| Market | Max Leverage | Maint Margin | Trading Fee | Active |
|--------|-------------|--------------|-------------|--------|
| BTC/USD | 50x (5000 bps) | 1% (100 bps) | 10% (1000 bps) | Yes |
| ETH/USD | Not deployed | — | — | — |
| SOL/USD | Not deployed | — | — | — |

### Pyth Feed IDs

| Asset | Hex Feed ID |
|-------|-------------|
| BTC/USD | `e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` |
| ETH/USD | `ff61491a931112dda8671c00aa47ea1588a3e69438ccb1f29eb20be8a862397d` |
| SOL/USD | `ef0d8b6fda2ceba41116ce183a4a3d5557d4a0cfb1689d6a35f4bf16c087e45c` |

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
   - JIT price freshness ≤15s (prevents stale quote front-running)
   - Dual oracle consensus for TWAP (2% divergence limit)
   - Price deviation circuit breaker (5% in 4 seconds)
   - Wormhole guardian verification (5+ signatures)

2. **Margin Safety:**
   - `maintenance_margin_bps × max_leverage_bps < 10,000²` invariant enforced on-chain
   - Portfolio margin risk matrix (variance-covariance model)
   - Auto-deleveraging (ADL) for cascading liquidations

3. **Audit Trail:**
   - SHA-256 state hash chain on every position mutation
   - All events indexed and stored in PostgreSQL
   - On-chain position data human-readable at 174 bytes per position

---

## 12. Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Rust / Anchor 0.31.1 / Solana 2.x |
| Frontend | Next.js 15 / React 19 / Tailwind CSS |
| Oracle | Pyth Network (JIT pull) + Wormhole (VAA verification) |
| Database | PostgreSQL (indexer) |
| Services | Express.js / WebSocket (ws) / Ollama (AI) |
| DevOps | Anchor CLI / Solana CLI 2.3.13 / Railway |
| Testing | solana-program-test (Rust) / E2E scripts (TypeScript) |
| Token Standard | SPL Token (USDC, nvUSDC, NVSC) / Wrapped SOL |
