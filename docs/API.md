# API Documentation

**Last updated:** September 3, 2026

> **⚠️ Devnet, read-only/proxy surface.** Last updated to reflect the current Next.js route handlers. All trading is executed by wallet-signed Solana transactions directly against the on-chain programs (`position-tracker`, `nv-usdc-vault`, `netting-engine`, etc.) — the `/api/*` routes are read-only/proxy endpoints (price relay, perps read models, indexer/activity, protocol metrics, TradingView feed, Pyth Hermes proxy, integrations). There is no authenticated REST order-matching backend. `app/web/app/api/` is the authoritative list of what exists today.

## Base URL

**Development:** `http://localhost:3000/api`
**Production (planned):** `https://noviscia.com/api` (Next.js route handlers, Vercel)

## Authentication

There is no JWT/session-token layer. On-chain actions (open/close/deposit/withdraw) are signed transactions sent directly from the wallet to Solana; the frontend talks to `position-tracker`/`nv-usdc-vault` via RPC, not through an authenticated backend API. The Next.js API routes under `app/web/app/api/` are largely read-only/proxy endpoints. Pro-trader API-key management (`/api/v1/keys`, `/api/v1/copy`) is proxied to the indexer service and requires its own credentials.

**Institutional API tokens (`X-Noviscia-App-Token`).** The indexer mints `nvk_…` tokens bound to a wallet with a `read`/`write`/`admin` scope. Secrets are hashed (SHA-256) at rest and shown once. A presented token scopes every private read to its bound wallet — a disagreeing `?wallet=` is rejected 403 — and `read` tokens cannot place/cancel orders or modify copy settings. In `INDEXER_AUTHZ=strict` mode private routes require a token outright. Self-service management: `/developer/api`.

## Rate Limits

- Public endpoints: 100 requests/minute
- Pro API (v1, proxied): 1000 requests/minute
- WebSocket: 100 messages/minute

## Route Index

The live routes are grouped by purpose under `app/web/app/api/`:

| Group | Paths | Purpose |
|-------|-------|---------|
| Perps | `/api/perps/*` | Positions, orders, history, funding, oracle, ws |
| Market | `/api/market/*` | Market stats + 24h data (CoinGecko + tick store) |
| Candles | `/api/candles/*` | OHLCV candles per asset |
| Indexer | `/api/indexer/*` | Recent fills, tick/status, sync |
| Protocol | `/api/protocol/*` | Protocol metrics + solvency (investor dashboard) |
| Vault | `/api/vault/yield` | Vault/per-user pending yield + NAV |
| Investors | `/api/investors/history` | On-chain snapshot history (year buckets) |
| Pipeline | `/api/pipeline/*` | Revenue tracking + monthly buckets |
| Allocator | `/api/allocator/recommendation` | Venue allocation recommendation (rules + optional AI) |
| Revenue/AI | `/api/ai/*`, `/api/agents/*` | AI orchestration status, alerts, trade hints |
| Activity | `/api/activity` | Per-wallet on-chain activity (proxied to indexer) |
| Integrations | `/api/integrations/status` | Provider readiness (Helius/Jupiter/Pyth) |
| Pyth | `/api/pyth/hermes` | Hermes price-update proxy (CORS + rate-limit) |
| TradingView | `/api/tv/*` | UDF-compatible chart feed (config/history/live/search/symbols/time) |
| Phoenix | `/api/phoenix/orderbook` | Phoenix SOL/USDC orderbook (mainnet) |
| v1 | `/api/v1/*` | API catalog, pro keys, copy-trading, portfolio |

## Perps Endpoints

### Get Positions

```http
GET /api/perps/positions?wallet={wallet}
```

Returns the user's open positions (read from the indexer / on-chain). Geo-block enforced.

**Query:**
- `wallet` (string, required): Solana wallet address

### Get Orders

```http
GET /api/perps/orders?wallet={wallet}&status={status}
```

Returns resting orders for a wallet. Proxied to the indexer (`PERPS_INDEXER_URL`, default `http://localhost:8092`).

### Get History

```http
GET /api/perps/history?wallet={wallet}
```

Trade/fill history for a wallet.

### Get Funding

```http
GET /api/perps/funding/{market}
GET /api/perps/funding-history/{market}
```

Current and historical funding for a perp market.

### Get Oracle

```http
GET /api/perps/oracle/{market}
```

Latest oracle state for a market.

### WebSocket

```http
GET /api/perps/ws
```

Perps WebSocket bridge.

## Market Endpoints

### Get Market Data

```http
GET /api/market/{id}
```

**Response:**
```json
{
  "id": "SOLUSDT",
  "symbol": "SOL/USDT",
  "price": 142.50,
  "volume24h": 2500000000,
  "openInterest": 850000000,
  "high24h": 145.30,
  "low24h": 139.20,
  "change24h": 2.35,
  "change24hPercent": 1.67,
  "timestamp": 1716864000000
}
```

### Get Sol Market

```http
GET /api/market/sol
```

SOL market snapshot.

## Candles Endpoints

```http
GET /api/candles/{id}?days={days}
GET /api/candles/sol?days={days}
GET /api/candles/token?days={days}
```

OHLCV candle series for an asset. `days` is clamped to 1–365 (server-side cache TTL ~1 min).

## Protocol Endpoints

### Get Protocol Metrics

```http
GET /api/protocol/metrics
```

Live devnet protocol metrics for the investor dashboard (vault NAV, revenue, TVL). Uses devnet RPC fallbacks + short cache.

### Get Solvency

```http
GET /api/protocol/solvency
```

```json
{
  "healthy": true,
  "health": "healthy"
}
```

Wallet/CCP solvency snapshot. Returns `healthy: false` when the health state is `critical`.

## Vault Endpoint

### Get Vault Yield

```http
GET /api/vault/yield?wallet={wallet}
```

Per-user pending yield plus vault NAV-per-share for the `nv-usdc-vault` omni-pool (USDC vault / `nvscUSDC`).

## Indexer Endpoints

```http
GET /api/indexer/fills?market={market}&limit={limit}
GET /api/indexer/status
GET /api/indexer/sync
```

Recent fills (per `market`, `limit` max 100), tick/status per market, and manual sync. Proxied as needed to the indexer service on port `8092`.

## TradingView (UDF) Endpoints

```http
GET /api/tv/config
GET /api/tv/time
GET /api/tv/search?query={q}
GET /api/tv/symbols?symbol={sym}
GET /api/tv/history?symbol={sym}&resolution={r}&from={..}&to={..}
GET /api/tv/live?symbol={sym}&resolution={r}   # SSE live chart feed
```

TradingView-compatible UDF chart data feed backed by `PERP_MARKETS`, candle re-aggregation, and Pyth TV shims.

## Pyth Proxy

```http
GET /api/pyth/hermes?ids[]={HEX}[&encoding=base64][&parsed=true]
```

Server-side proxy for Pyth Hermes price updates — removes CORS + rate-limits from browser calls. `encoding=base64` responses (JIT VAAs) are never cached.

## Other Endpoints

- `GET /api/activity?wallet={wallet}&limit={n}&program={p}&type={t}` — per-wallet on-chain activity (proxied to indexer)
- `GET /api/investors/history?year=2026` — monthly on-chain snapshot buckets
- `GET /api/pipeline/revenue` / `GET /api/pipeline/revenue/months` — revenue tracking (tracks all three revenue engines: sovereign-netting rent, gateway-auction tips, jit-risk premiums)
- `GET /api/allocator/recommendation?ai=1` — venue allocation recommendation (rules engine + optional local AI explanation)
- `GET /api/ai/health`, `GET /api/ai/alerts`, `GET /api/ai/orchestration`, `GET /api/ai/parse-trade`, `GET /api/ai/trade-hint` — AI layer status/assist
- `GET|POST|DELETE /api/agents/session` — agent session policy
- `GET /api/integrations/status` — provider readiness (Helius / Jupiter / Pyth)
- `GET /api/phoenix/orderbook` — Phoenix SOL/USDC orderbook (mainnet)
- `GET /api/v1` (catalog), `GET /api/v1/portfolio/{wallet}`, `POST /api/v1/keys`, `POST|DELETE /api/v1/copy` — pro API surface (proxied to indexer)

## Error Handling

All errors return a standard format:

```json
{
  "error": {
    "code": "INSUFFICIENT_COLLATERAL",
    "message": "Insufficient collateral for this trade",
    "statusCode": 400
  }
}
```

## Common Error Codes

| Code | Status | Meaning |
|------|--------|---------|
| `wallet required` | 400 | Missing `wallet` query param |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |
