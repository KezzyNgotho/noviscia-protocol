# Noviscia: Zero-Waste Perpetual DEX on Solana

## 🚀 Overview

Noviscia is a decentralized perpetual futures exchange on Solana where traders can:
- Deposit USDC and trade perpetual futures with up to 20x leverage
- Earn yield on idle margin automatically through lending protocols (Kamino, Solend, Marginfi)
- Recall funds atomically in <400ms for instant trading
- Stake NVSC tokens for fee discounts (10%-100%)
- Participate in protocol governance through token burns and rewards

**Tagline:** "The New Science of Capital Efficiency"

## 🎨 Branding

- **Primary Color:** Deep Quantum Emerald (#00A86B)
- **Background:** Matte Black (#0A0A0A)
- **Secondary:** Dark Graphite (#1A1A1A)
- **Typography:** Inter (sans-serif)
- **Design:** Glassmorphism, Minimal, Architectural

## 📋 System Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                │
│  ├─ Trading Terminal (/trade)                       │
│  ├─ Staking Dashboard (/stake)                      │
│  ├─ Yield Tracker (/yield)                          │
│  ├─ Portfolio Dashboard (/dashboard)                │
│  └─ Burn Statistics (/burn)                         │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│           Backend API (Express.js)                  │
│  ├─ Market Data Endpoints                           │
│  ├─ Position Management                             │
│  ├─ User Analytics                                  │
│  └─ WebSocket Real-time Updates                     │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│          Off-Chain Services (Node.js)               │
│  ├─ Indexer (Parse on-chain events)                 │
│  ├─ Keeper Bot (Auto-trigger burns)                 │
│  ├─ Price Feed (Aggregate oracles)                  │
│  └─ WebSocket Server (Real-time updates)            │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│      Solana Programs (Anchor Rust)                  │
│  ├─ Escrow (User funds custody)                     │
│  ├─ Lending Integrator (Yield farming)              │
│  ├─ Staking Manager (Governance staking)            │
│  ├─ Burn Engine (Token buyback)                     │
│  ├─ Token NVSC (Governance token)                   │
│  └─ Yield Distributor (Reward distribution)         │
└─────────────────────────────────────────────────────┘
```

## 🏗️ Project Structure

```
noviscia-protocal/
├── programs/
│   ├── escrow/                 # Non-custodial user fund management
│   ├── lending-integrator/     # Yield farming integration
│   ├── staking-manager/        # Governance token staking
│   ├── burn-engine/            # Protocol token buyback
│   ├── token-nvsc/             # Native governance token
│   └── yield-distributor/      # Yield and rewards distribution
├── app/
│   ├── web/                    # Next.js 14 trading frontend
│   ├── mobile/                 # React Native mobile app
│   └── api/                    # Express.js backend
├── services/
│   ├── indexer/                # Solana event indexer
│   ├── keeper/                 # Automation bot
│   ├── price-feed/             # Oracle aggregator
│   └── websocket/              # Real-time updates
├── scripts/
│   ├── deploy/                 # Deployment automation
│   ├── monitor/                # Health monitoring
│   └── test/                   # Testing utilities
├── tests/
│   ├── e2e/                    # End-to-end tests
│   └── integration/            # Integration tests
└── docs/                       # Documentation
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Rust 1.70+
- Solana CLI
- Anchor Framework
- Docker (optional)

### Installation

```bash
# Clone repository
git clone https://github.com/noviscia/noviscia-protocal.git
cd noviscia-protocal

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Install Solana programs
cd programs/escrow && cargo install --path .
cd ../lending-integrator && cargo install --path .
# ... repeat for other programs

# Install web app dependencies
cd app/web && npm install

# Install API dependencies
cd app/api && npm install
```

### Development

```bash
# Start local Solana validator
solana-test-validator

# Build programs
npm run build

# Deploy to devnet
npm run deploy:devnet

# Start web app (localhost:3000)
cd app/web && npm run dev

# Start API server (localhost:3001)
cd app/api && npm run dev

# Start services
cd services/indexer && npm run dev
cd services/keeper && npm run dev
cd services/websocket && npm run dev
cd services/price-feed && npm run dev
```

## 📚 Key Features

### 1. **Zero-Waste Margin** 💚
- Idle margin automatically lent to yield protocols
- Recall triggered atomically on trade (<400ms)
- 85% of yield returns to user, 15% platform fee

### 2. **Perpetual Trading** 📈
- Up to 20x leverage
- Limit, Market, Stop Loss, Take Profit orders
- Real-time liquidation protection
- Cross-margin collateral

### 3. **Fee Discount Staking** 🔒
- Bronze: 100 NVSC → 10% discount
- Silver: 1,000 NVSC → 25% discount
- Gold: 10,000 NVSC → 50% discount
- Platinum: 100,000 NVSC → 100% discount + priority

### 4. **Protocol Token Economics** 🪙
- 40% of trading fees: Protocol buyback → burn
- 60% of trading fees: Distributed to stakers
- Deflationary mechanics via continuous burn

### 5. **Multi-Protocol Yield** 🌾
- Kamino Finance (default)
- Solend (fallback)
- Marginfi (fallback)
- Circuit breaker at 95% utilization

## 🔐 Security Considerations

### Non-Custodial Design
- User funds in PDAs controlled only by user
- Escrow = Pubkey Derived Address
- Seeds: `["escrow", user_pubkey]`
- Only user can withdraw

### Liquidation Protection
- Real-time mark price from Pyth
- 5% maintenance margin buffer
- Auto-liquidation at 5% remaining equity
- Liquidation fee: 1% to keeper

### Oracle Security
- Dual oracle (Pyth + Switchboard)
- Median price with 5% deviation threshold
- Circuit breaker on extreme moves
- 30-minute stale price detection

## 📊 API Endpoints

### Markets
```
GET /api/markets/{symbol}
GET /api/markets/depth/{symbol}
GET /api/markets/trades/{symbol}
```

### User
```
GET /api/user/{wallet}/positions
GET /api/user/{wallet}/yield
GET /api/user/{wallet}/history
POST /api/user/{wallet}/trade
```

### Staking
```
GET /api/staking/total
GET /api/staking/{wallet}
POST /api/staking/{wallet}/stake
POST /api/staking/{wallet}/unstake
```

### Protocol
```
GET /api/burn/stats
GET /api/analytics/tvl
GET /api/analytics/volume
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run integration tests
npm run test:integration

# Run E2E tests
npm run test:e2e
```

## 📦 Deployment

### Devnet
```bash
npm run deploy:devnet
npm run verify:devnet
```

### Mainnet
```bash
npm run deploy:mainnet
npm run verify:mainnet
```

## 🛠️ Development Commands

```bash
# Build smart contracts
npm run build

# Deploy programs
npm run deploy

# Run tests
npm run test

# Check health
npm run monitor:health

# Setup localnet
npm run setup:localnet
```

## 📝 License

MIT License - See LICENSE file for details

## 🤝 Contributing

Contributions welcome! Please follow our [CONTRIBUTING.md](./docs/CONTRIBUTING.md)

## 📞 Support

- Documentation: https://docs.noviscia.io
- Discord: https://discord.gg/noviscia
- Twitter: @NovisCAFinance
