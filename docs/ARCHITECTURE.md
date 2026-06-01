# Novisca Architecture

## System Overview

Novisca is a modular, microservices-based perpetual DEX composed of:

1. **Smart Contracts** - Rust/Anchor programs handling on-chain logic
2. **Web Frontend** - Next.js 14 SPA with real-time updates
3. **Backend API** - Express.js REST API with WebSocket support
4. **Off-chain Services** - Node.js services for indexing, oracles, and automation

## Smart Contract Architecture

### 1. Escrow Program (`escrow`)

**Purpose:** Non-custodial user fund management

**Key Components:**
- `EscrowAccount` PDA: Stores user USDC/NVSC balances
- Seeds: `["escrow", user_pubkey]`
- Authority: Only user can withdraw

**Instructions:**
- `initialize_escrow()` - Create user escrow account
- `deposit_usdc(amount)` - Add USDC to escrow
- `withdraw_usdc(amount)` - Withdraw USDC (no active positions required)
- `toggle_lending(enabled)` - Enable/disable yield farming
- `get_balance()` - Query account balances

**Security:**
- Requires active position = false for withdrawals
- PDA ensures only user has authority
- All balance updates checked for overflow/underflow

### 2. Lending Integrator (`lending-integrator`)

**Purpose:** Yield farming integration with multiple protocols

**Supported Protocols:**
- 0: Kamino Finance (primary)
- 1: Solend (fallback)
- 2: Marginfi (fallback)

**Key Components:**
- `LendingAccount` PDA: Tracks lent amounts and accrued yield
- `LendingPool`: Stores protocol utilization rates
- Circuit breaker: Halts lending at 95% utilization

**Instructions:**
- `lend_idle_funds(amount, protocol)` - Lend USDC to protocol
- `recall_for_trade(amount)` - Withdraw for trading
- `recall_all()` - Emergency withdrawal
- `harvest_yield()` - Collect accrued yield
- `relend_remaining(protocol)` - Switch lending protocols

**Atomic Recall:**
```
Recall Trigger (Trade initiated)
  └─> Withdraw from lending pool
      └─> Update user balance
          └─> Execute trade
              └─> Re-lend remaining idle balance
```

Max latency: <400ms

### 3. Staking Manager (`staking-manager`)

**Purpose:** Governance token staking with fee discounts

**Tier Structure:**
| Tier | NVSC Required | Fee Discount | Priority |
|------|--------------|-------------|----------|
| Bronze | 100 | 10% | ❌ |
| Silver | 1,000 | 25% | ❌ |
| Gold | 10,000 | 50% | ❌ |
| Platinum | 100,000 | 100% | ✅ |

**Instructions:**
- `stake_tokens(amount)` - Lock tokens
- `unstake_tokens(amount)` - Unlock (7-day cooldown)
- `claim_rewards()` - Claim staking rewards
- `compound_rewards()` - Auto-stake rewards

**Reward Distribution:**
- 60% of trading fees distributed to stakers
- Weekly distribution snapshots
- Proportional to stake amount and tier bonus

### 4. Burn Engine (`burn-engine`)

**Purpose:** Automated token buyback and burn

**Mechanics:**
```
Trading Fees Accumulated
  └─> 40% routed to Burn Engine
      └─> Accumulates USDC
          └─> Threshold check ($10,000)
              └─> Off-chain keeper swaps USDC → NVSC
                  └─> Deposit NVSC into burn vault
                      └─> Burn engine sends to dead address (11111...)
                      └─> Emit burn event
```

**Instructions:**
- `accumulate_funds(amount)` - Add to burn pool
- `trigger_burn()` - Execute burn if threshold met
- `schedule_burn(hours_from_now)` - Schedule future burn

**Economic Impact:**
- Deflationary: Reduces NVSC supply
- Supports price floor: Market sees reduced supply
- Transparency: All burns are on-chain events

### 5. Token NVSC (`token-nvsc`)

**Purpose:** Governance token creation and management

**Token Specs:**
- Supply: 1,000,000,000 (1 billion fixed)
- Decimals: 9
- Mint Authority: Renounced after TGE
- Metadata: Name, symbol, URI with logo

**Instructions:**
- `initialize_token(name, symbol, uri)` - Create token
- `mint_tokens(amount)` - Mint new supply (only before renounce)
- `burn_tokens(amount)` - Burn from circulation

### 6. Yield Distributor (`yield-distributor`)

**Purpose:** Track and distribute yield to users

**Fee Structure:**
- 15% Performance Fee: Auto-buys NVSC tokens
- 85% User Share: Returned to escrow

**Auto-Compounding:**
- Yield earned → NVSC purchased → Burned
- Supports deflationary mechanics

**Instructions:**
- `distribute_yield(amount)` - Allocate yield
- `claim_yield()` - Withdraw accumulated yield
- `compensate_yield(amount)` - Compensate for missed yield
- `collect_platform_fee(amount)` - Collect performance fees

## Frontend Architecture

### Pages Structure

```
app/web/src/app/
├── layout.tsx          # Root layout, wallet provider
├── page.tsx            # Landing page
├── trade/
│   ├── page.tsx        # Trading terminal
│   ├── chart.tsx       # TradingView integration
│   ├── orderbook.tsx   # Phoenix DEX data
│   └── positions.tsx   # Open positions table
├── stake/
│   ├── page.tsx        # Staking dashboard
│   └── tiers.tsx       # Tier information
├── yield/
│   ├── page.tsx        # Yield tracker
│   └── counter.tsx     # Live yield counter
├── dashboard/
│   └── page.tsx        # Portfolio overview
└── burn/
    └── page.tsx        # Burn statistics
```

### Key Components

**Contra Margin Matrix** (Unique Feature)
- Live counter showing idle yield earned in real-time
- Animates with each update tick
- Shows projected annual yield at current rate
- Switches between automatic yield ON/OFF

**Position Table**
- Realtime mark price updates via WebSocket
- Liquidation risk indicator
- One-click close/modify position
- PnL calculation: `(markPrice - entryPrice) * size * leverage`

**Order Form**
- Leverage slider (1-20x)
- Order types: Limit, Market, Stop Loss, Take Profit
- Slippage tolerance: 0.1%, 0.5%, 1%
- Confirmation modal for trades >$10k

## Backend Services

### API Architecture

```
Express.js Server
├── HTTP Routes
│   ├── /api/markets/*         - Market data
│   ├─ /api/user/*             - User positions/yield
│   ├─ /api/staking/*          - Staking info
│   └─ /api/burn/*             - Burn statistics
└── WebSocket Server
    ├─ Price updates (1s interval)
    ├─ Order book updates (on change)
    └─ Position PnL updates (5s interval)
```

### Database Schema

```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY,
  wallet_address VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Positions table
CREATE TABLE positions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users,
  symbol VARCHAR(10) NOT NULL,
  side VARCHAR(10),
  size DECIMAL NOT NULL,
  entry_price DECIMAL NOT NULL,
  mark_price DECIMAL NOT NULL,
  leverage INT,
  pnl DECIMAL,
  opened_at TIMESTAMP,
  closed_at TIMESTAMP
);

-- Yield events table
CREATE TABLE yield_events (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users,
  amount DECIMAL NOT NULL,
  user_share DECIMAL NOT NULL,
  protocol_fee DECIMAL NOT NULL,
  created_at TIMESTAMP
);

-- Stake events table
CREATE TABLE stake_events (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users,
  amount DECIMAL NOT NULL,
  tier VARCHAR(20),
  event_type VARCHAR(10),
  created_at TIMESTAMP
);
```

### Caching Strategy

**Redis Keys:**
- `price:{symbol}` - Latest market price (TTL: 1s)
- `user:{wallet}:positions` - Open positions (TTL: 30s)
- `user:{wallet}:yield` - Yield earned (TTL: 60s)
- `staking:total` - Total staked NVSC (TTL: 300s)
- `burn:stats` - Burn metrics (TTL: 3600s)

## Off-Chain Services

### Indexer

Listens to Solana logs via WebSocket, parses events:
- Trade events → Database
- Yield distribution events → Database
- Burn events → Database
- Updates cache on new blocks

### Keeper Bot

Automated tasks:
- **Hourly:** Check burn threshold, trigger if met
- **Daily:** Harvest yield from lending protocols
- **On Trade:** Auto-relend idle funds
- **On Liquidation:** Execute liquidation and distribute fees

### Price Feed

Aggregates prices from:
- Pyth Oracle (primary)
- Switchboard (secondary)
- Calculates median with 5% deviation threshold
- Serves via REST and WebSocket

### WebSocket Server

Maintains client connections, broadcasts:
- `market_update` - Price changes
- `order_book_update` - Order book depth
- `position_update` - PnL changes
- `trade_execution` - Trade fills

## Data Flow

### Trade Execution Flow

```
1. User submits order (web frontend)
   └─> Request to API: POST /api/trade
       └─> Validate order (leverage, collateral, etc.)
           └─> Check oracle price (Pyth + Switchboard)
               └─> Calculate liquidation price
                   └─> Verify collateral requirements
                       └─> RECALL: Withdraw from lending
                           └─> Execute trade
                               └─> Update position DB
                                   └─> RE-LEND: Send idle balance to yield protocol
                                       └─> Emit events
                                           └─> WebSocket broadcast
                                               └─> Response to user
```

### Yield Earning Flow

```
1. User deposits USDC to escrow
   └─> toggle_lending(true)
       └─> Idle USDC sent to Kamino
           └─> Weekly interest accrues
               └─> Keeper bot harvests yield
                   └─> 15% performance fee auto-burns NVSC
                       └─> 85% returned to user escrow
                           └─> User can claim or re-stake
```

## Security Model

### Composability

Programs use CPI (Cross-Program Invocation) safely:
- Only trusted program addresses called
- PDA validation on all accounts
- Signer checks before state mutations

### Non-Custodial Guarantee

```
Only [USER] can call:
- withdraw_usdc() from escrow
- unstake_tokens() from staking

Only [KEEPER BOT] can call:
- trigger_burn()
- harvest_yield()

Only [PROTOCOL] can call:
- distribute_yield()
- compensate_yield()
```

## Scalability

### Transaction Batching
- Combine multiple yield distributions in single tx
- Batch position updates every 5 seconds
- Aggregate burn accumulations hourly

### Database Optimization
- Indexed on user_id, created_at, status
- Partitioned positions table by month
- Archive old trades after 1 year
- Connection pooling: 20 connections

### Cache Strategy
- In-memory price cache (1s TTL)
- Redis for distributed cache
- Database fallback on cache miss
