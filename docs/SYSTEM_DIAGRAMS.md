# Noviscia System Diagram

**Last updated:** July 7, 2026 — diagrams 1–4 rewritten to match the current JIT-oracle architecture (no Express/Postgres/Redis backend, no external lending venues, no Switchboard). Diagram 5 (AI layer) is unchanged/unverified this cycle.

## 1) System Structure

```mermaid
graph TD
  U[User / Wallet] --> W[Web App\nNext.js — Vercel]
  W -->|RPC, wallet-signed txs| C[Solana Programs]

  C --> PT[position-tracker\nJIT oracle, funding, liquidation]
  C --> NV[nv-usdc-vault\nshare-based NAV]
  C --> PLV[protocol-lp-vault]
  C --> SM[staking-manager]
  C --> BE[burn-engine]
  C --> TN[token-nvsc]
  C --> PM[prediction_market]

  PT -->|verify_jit_price, per-instruction| PYTH[Pyth Hermes\nguardian-signed VAA]
  PT -->|CPI: redeem/accumulate_fees/lock_margin| NV

  W -.->|optional, not required to trade| SVC[services/*\nindexer, price-feed, websocket, ai-*]
```

## 2) Trade Flow (open_position_jit)

```mermaid
sequenceDiagram
  participant U as User Wallet
  participant W as Web App
  participant H as Pyth Hermes
  participant PT as position-tracker
  participant NV as nv-usdc-vault

  U->>W: Submit trade (side, size, leverage, margin)
  W->>H: Fetch latest guardian-signed price VAA
  W->>U: Request signature for open_position_jit tx
  U->>PT: Signed tx (VAA + merkle proof bundled)
  PT->>PT: verify_jit_price — reject if VAA >3s old
  PT->>NV: CPI redeem_nvusdc (trading fee) + lock margin
  PT-->>W: Position opened (on-chain confirmation)
  W-->>U: Show filled position
```

A retry (fresh VAA + new signature) happens automatically if the 3-second freshness window races network latency — this is expected, not an error.

## 3) Yield Flow (perps)

```mermaid
flowchart TD
  A[Trading fees: open + close] --> D[nv-usdc-vault.total_assets]
  B[Liquidation: 80% retained share] --> E{10% / 90% split}
  E -->|10%| F[Market.insurance_fund_usdc]
  E -->|90%| D
  D --> G[NAV per share increases]
  G --> H[Every locked position's collateral_shares\nappreciate — Simultaneous Double-Yield]
```

No external lending venue sits in this path — those integrations were fully retired from `nv-usdc-vault`.

## 4) Deployment Flow

```mermaid
flowchart LR
  K[Code] --> B1[anchor build]
  B1 --> B2[solana program deploy\nsame program ID, upgrade in place]
  B2 --> B3[Copy fresh IDL to app/web/app/idl/]
  B3 --> B4[Vercel deploy\ngit-integration, root=app/web]
  B4 --> B5[Run e2e proof script\nscripts/e2e-*-devnet.ts]
```

## Target shape (current)

- **Frontend:** wallet-connected trading UI, deployed to Vercel — no separate API server for core trading
- **Programs:** own all custody, margin, oracle verification, funding, liquidation, staking, and burn logic
- **Optional services:** indexer/price-feed/websocket/AI layer, each dockerized separately, not on the critical trading path
- **No database:** on-chain accounts are the only persistence layer for perps state

## 5) AI Orchestration Layer (devnet — local Ollama)

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         AI ORCHESTRATION LAYER                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌───────────────┐ │
│  │  AI Yield       │  │  AI Risk        │  │  AI Rebalancer  │  │  AI Trading   │ │
│  │  Router         │  │  Predictor      │  │                 │  │  Agent API    │ │
│  │  (30-min)       │  │  (Real-time)    │  │  (Hourly)       │  │  (NL / hint)  │ │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  └───────┬───────┘ │
│           └────────────────────┴────────────────────┴──────────────────┘         │
│                                      │                                              │
│                              ┌───────┴───────┐                                      │
│                              │  Orchestrator │  :11435                              │
│                              │  + Ollama     │  qwen2.5:7b                          │
│                              └───────┬───────┘                                      │
└──────────────────────────────────────┼──────────────────────────────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    │ ai-rebalancer (execute) · Web (advise/UI) │
                    └─────────────────────────────────────┘
```

| Agent | Cadence | Service | Orchestrator path |
|-------|---------|---------|-------------------|
| Yield Router | 30 min | `services/ai-rebalancer` | `POST /agents/yield` |
| Rebalancer | Hourly | `services/ai-rebalancer` | `POST /agents/rebalance` |
| Trading Agent | On-demand | `app/web` perps UI | `POST /agents/parse-trade`, `/agents/trade-hint` |

(Risk Predictor was removed along with the keeper service and has no replacement.)

Live status: `GET /api/ai/orchestration` (web) · `GET /orchestration/status` (orchestrator).

Rules engine validates all AI JSON before it acts. See `docs/AI_INTEGRATION.md`.

## Notes

- Keep the **web app** as the only user-facing entry point.
- Keep **Solana programs** as the source of truth for funds.
- Keep **off-chain services** stateless where possible.
- Broadcast live updates through **WebSocket**, not polling.
