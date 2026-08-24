# API Documentation

**Last updated:** August 24, 2026

> **⚠️ Illustrative/aspirational.** This document describes the target API surface for mainnet. The current architecture routes all trading through wallet-signed Solana transactions — there is no authenticated REST order-matching backend. The endpoints below represent the planned mainnet API; verify against `app/web/app/api/` for what exists today.

## Base URL

**Production:** `https://noviscia.com/api` (Next.js route handlers)
**Development:** `http://localhost:3000/api`

## Authentication

There is no JWT/session-token layer. On-chain actions (open/close/deposit/withdraw) are signed transactions sent directly from the wallet to Solana — the frontend talks to `position-tracker`/`nv-usdc-vault` via RPC, not through an authenticated backend API. The Next.js API routes under `app/web/app/api/` are largely read-only/proxy endpoints (price relay, activity feed, etc.) — check each route's own source for whether it expects any request signing.

## Rate Limits

- Public endpoints: 100 requests/minute
- Authenticated endpoints: 1000 requests/minute
- WebSocket: 100 messages/minute

## Market Data Endpoints

### Get Market Data

```http
GET /api/markets/{symbol}
```

**Parameters:**
- `symbol` (string, required): Trading pair (e.g., "SOL/PERP", "ETH/PERP", "BTC/PERP")

**Response:**
```json
{
  "symbol": "SOL/PERP",
  "price": 142.50,
  "volume24h": 2500000000,
  "openInterest": 850000000,
  "high24h": 145.30,
  "low24h": 139.20,
  "change24h": 2.35,
  "change24hPercent": 1.67,
  "timestamp": 1716864000000,
  "funding_rate": 0.0001,
  "next_funding_time": 1716950400000
}
```

### Get Order Book

```http
GET /api/markets/{symbol}/orderbook?depth=20
```

**Parameters:**
- `symbol` (string, required): Trading pair
- `depth` (integer, optional): Number of bids/asks to return (default: 20, max: 100)

**Response:**
```json
{
  "symbol": "SOL/PERP",
  "bids": [
    [142.45, 150.5],
    [142.40, 200.0],
    [142.35, 175.25]
  ],
  "asks": [
    [142.55, 125.75],
    [142.60, 180.0],
    [142.65, 210.5]
  ],
  "timestamp": 1716864000000,
  "sequence": 12345
}
```

### Get Recent Trades

```http
GET /api/markets/{symbol}/trades?limit=50
```

**Response:**
```json
{
  "symbol": "SOL/PERP",
  "trades": [
    {
      "id": "trade_123",
      "price": 142.50,
      "size": 25.5,
      "side": "buy",
      "timestamp": 1716864000000,
      "trader": "user_123"
    }
  ]
}
```

## User Endpoints

### Get User Positions

```http
GET /api/user/{wallet}/positions
```

**Parameters:**
- `wallet` (string, required): User's Solana wallet address

**Response:**
```json
{
  "wallet": "9B5X7...",
  "positions": [
    {
      "id": "pos_456",
      "symbol": "SOL/PERP",
      "side": "long",
      "size": 100.0,
      "entryPrice": 140.25,
      "markPrice": 142.50,
      "leverage": 10,
      "collateral": 1422.50,
      "pnl": 225.00,
      "pnlPercent": 15.83,
      "liquidationPrice": 125.00,
      "liquidationRisk": 0.12,
      "fundingRate": 0.0001,
      "openedAt": 1716864000000,
      "estimatedLiquidationTime": 1716950400000
    }
  ],
  "totalPnl": 225.00,
  "totalMargin": 1422.50,
  "totalCollateral": 14225.00,
  "totalLeverage": 10
}
```

### Get User Yield

```http
GET /api/user/{wallet}/yield
```

**Response:**
```json
{
  "wallet": "9B5X7...",
  "yieldEarned": 125.50,
  "yieldEarned24h": 5.21,
  "yieldRate": 0.08,
  "yieldApy": 29.2,
  "lendingProtocol": "none",
  "lendingAmount": 5000.00,
  "lastUpdate": 1716864000000,
  "breakdownByProtocol": {
    "inHouse": {
      "amount": 5000.00,
      "yield": 125.50,
      "apy": 29.2
    }
  }
}
```

### Get Trade History

```http
GET /api/user/{wallet}/trades?limit=100&offset=0
```

**Response:**
```json
{
  "trades": [
    {
      "id": "trade_789",
      "symbol": "SOL/PERP",
      "side": "buy",
      "size": 100.0,
      "price": 140.25,
      "fee": 14.025,
      "feeDiscount": 4.2075,
      "finalFee": 9.8175,
      "leverage": 10,
      "executedAt": 1716864000000,
      "status": "filled"
    }
  ],
  "total": 150,
  "limit": 100,
  "offset": 0
}
```

## Trading Endpoints

### Place Order

```http
POST /api/trade
```

**Request Body:**
```json
{
  "wallet": "9B5X7...",
  "symbol": "SOL/PERP",
  "side": "buy",
  "orderType": "limit",
  "size": 100.0,
  "price": 140.00,
  "leverage": 10,
  "takeProfit": {
    "price": 150.00,
    "size": 50.0
  },
  "stopLoss": {
    "price": 130.00,
    "size": 100.0
  },
  "slippageTolerance": 0.5,
  "signature": "..."
}
```

**Response:**
```json
{
  "orderId": "order_999",
  "status": "pending",
  "symbol": "SOL/PERP",
  "side": "buy",
  "executedAt": 1716864000000,
  "transactionHash": "4x5d6f..."
}
```

### Cancel Order

```http
DELETE /api/trade/{orderId}
```

**Response:**
```json
{
  "orderId": "order_999",
  "status": "cancelled",
  "cancelledAt": 1716864000000
}
```

## Staking Endpoints

### Get Staking Info

```http
GET /api/staking/total
```

**Response:**
```json
{
  "totalStaked": 50000000.00,
  "totalStakers": 1250,
  "apy": 45.5,
  "rewardPool": 2500000.00,
  "nextDistribution": 1716950400000,
  "tiers": {
    "bronze": {
      "requirement": 100,
      "discount": 10,
      "stakerCount": 500,
      "totalStaked": 100000
    },
    "silver": {
      "requirement": 1000,
      "discount": 25,
      "stakerCount": 400,
      "totalStaked": 800000
    },
    "gold": {
      "requirement": 10000,
      "discount": 50,
      "stakerCount": 300,
      "totalStaked": 5000000
    },
    "platinum": {
      "requirement": 100000,
      "discount": 100,
      "stakerCount": 50,
      "totalStaked": 10000000
    }
  }
}
```

### Get User Stake

```http
GET /api/staking/{wallet}
```

**Response:**
```json
{
  "wallet": "9B5X7...",
  "stakedAmount": 5000.00,
  "tier": "silver",
  "feeDiscount": 25,
  "pendingRewards": 125.50,
  "claimedRewards": 1250.00,
  "apy": 45.5,
  "unstakeAvailableAt": 1717000000000
}
```

### Stake Tokens

```http
POST /api/staking/{wallet}/stake
```

**Request:**
```json
{
  "amount": 5000.00,
  "signature": "..."
}
```

## Burn Endpoints

### Get Burn Statistics

```http
GET /api/burn/stats
```

**Response:**
```json
{
  "totalBurned": 15000000.00,
  "burnsCount": 45,
  "averageBurnAmount": 333333.33,
  "supplyReduction": 1.5,
  "burnRate": 5000000.00,
  "nextBurnTime": 1716950400000,
  "accumulatedFees": 45000.00,
  "protocolFeesCollected": 500000.00,
  "deflationary_impact": {
    "originalSupply": 1000000000,
    "currentSupply": 985000000,
    "percentBurned": 1.5
  }
}
```

## Analytics Endpoints

### Get Protocol Analytics

```http
GET /api/analytics/tvl
```

**Response:**
```json
{
  "tvl": 250000000.00,
  "volume24h": 1250000000.00,
  "volume7d": 8750000000.00,
  "users": 5250,
  "activeUsers24h": 1250,
  "trades24h": 45000,
  "trades7d": 315000,
  "averageLeverage": 8.5,
  "maxLeverage": 20,
  "liquidations24h": 125,
  "liquidationsValue": 2500000.00,
  "topTradingPairs": [
    {
      "symbol": "SOL/PERP",
      "volume24h": 500000000.00,
      "openInterest": 125000000.00
    }
  ]
}
```

## WebSocket Endpoints

### Connect to WebSocket

```
wss://noviscia.com (Phoenix WS via app routes where configured)
ws://localhost:8080 (development)
```

### Subscribe to Price Updates

```json
{
  "action": "subscribe",
  "channel": "price",
  "symbols": ["SOL/PERP", "ETH/PERP", "BTC/PERP"]
}
```

**Message Format:**
```json
{
  "type": "price_update",
  "symbol": "SOL/PERP",
  "price": 142.50,
  "timestamp": 1716864000000
}
```

### Subscribe to Order Book

```json
{
  "action": "subscribe",
  "channel": "orderbook",
  "symbol": "SOL/PERP",
  "depth": 20
}
```

### Subscribe to Position Updates

```json
{
  "action": "subscribe",
  "channel": "positions",
  "wallet": "9B5X7..."
}
```

**Message Format:**
```json
{
  "type": "position_update",
  "positionId": "pos_456",
  "markPrice": 142.50,
  "pnl": 225.00,
  "pnlPercent": 15.83,
  "timestamp": 1716864000000
}
```

## Error Handling

All errors return standard format:

```json
{
  "error": {
    "code": "INSUFFICIENT_COLLATERAL",
    "message": "Insufficient collateral for this trade",
    "statusCode": 400,
    "details": {
      "required": 1422.50,
      "available": 1000.00
    }
  }
}
```

## Common Error Codes

| Code | Status | Meaning |
|------|--------|---------|
| `INVALID_WALLET` | 400 | Invalid wallet address |
| `INSUFFICIENT_BALANCE` | 400 | Insufficient balance |
| `INSUFFICIENT_COLLATERAL` | 400 | Not enough collateral |
| `POSITION_NOT_FOUND` | 404 | Position doesn't exist |
| `EXPIRED_SIGNATURE` | 401 | Signature expired |
| `UNAUTHORIZED` | 401 | Not authenticated |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |
