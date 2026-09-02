# Noviscia System Diagram

**Last updated:** September 3, 2026 — diagrams reflect live devnet architecture (15 active programs, 7 services).

## 1) System Structure

```mermaid
graph TD
  U[User / Wallet] --> W[Web App\nNext.js — Vercel]
  W -->|RPC, wallet-signed txs| C[Solana Programs]

  C --> PT[position-tracker\nJIT oracle, funding, liquidation]
  C --> NV[nv-usdc-vault\nshare-based NAV, omni-pool]
  C --> SM[staking-manager]
  C --> TN[token-nvsc]
  C --> SN[sovereign-netting\ntenant netting rent]
  C --> GA[gateway-auction\npremium tips]
  C --> JR[jit-risk\nslot-scoped capacity]
  C --> NC[noviscia-clearing\nevent/outcome markets]
  C --> NE[netting-engine\nmultilateral netting]
  C --> CR[clearing-registry\ntenant onboarding]
  C --> YR[yield-router\natomic recall]
  C --> YD[yield-distributor]
  C --> CL[noviscia-credit-line]
  C --> LV[liquidation-vault\nADL]
  C --> VN[ve-nvs\ngovernance]

  PT -->|verify_jit_price, per-instruction| PYTH[Pyth Hermes\nguardian-signed VAA]
  PT -->|CPI: redeem/accumulate_fees/lock_margin| NV

  W -.->|off-chain services| SVC[services/\nindexer :8092, price-feed, websocket,\nai-orchestrator, netting-relayer]
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
  PT->>PT: verify_jit_price — reject if VAA >30s old
  PT->>NV: CPI redeem_nvusdc (trading fee) + lock margin
  PT-->>W: Position opened (on-chain confirmation)
  W-->>U: Show filled position
```

A retry (fresh VAA + new signature) happens automatically if the 30-second freshness window races network latency — this is expected, not an error.

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
- **Programs:** own all custody, margin, oracle verification, funding, liquidation, staking, netting, gateway auction, and JIT risk logic (15 active programs)
- **Services:** indexer (:8092), price-feed, websocket, ai-orchestrator, netting-relayer — each dockerized, off the critical trading path
- **No database:** on-chain accounts are the only persistence layer for perps state

## 5) AI Orchestration Layer

```mermaid
graph TD
  AO[ai-orchestrator\n:11435 · Ollama qwen2.5:7b]

  AO --> RSK[Risk predictor\nreal-time · mark crank]
  AO --> TA[AI Trading Agent\non-demand · NL parse + trade-hint]

  RSK --> Web[Web App · advise/UI alerts]
  TA --> Web

  AO --> RG[Rules engine\nvalidates all AI JSON before action]
```

| Agent | Cadence | Endpoint |
|-------|---------|----------|
| Risk predictor | Real-time (mark crank) | `POST /decide` (orchestrator) |
| Trading agent (NL parse) | On-demand | `POST /api/ai/parse-trade`, `/decide` |
| Trading agent (trade hint) | On-demand | `POST /api/ai/trade-hint`, `/decide` |

Live status: `GET /api/ai/health` · `GET /api/ai/orchestration` (web) · `GET /health` (orchestrator).

The `ai-orchestrator` service is a local (Ollama + `qwen2.5:7b`) LLM proxy — no cloud
APIs. Every AI response is validated by the rules engine before any action is taken.

## Notes

- Keep the **web app** as the only user-facing entry point.
- Keep **Solana programs** as the source of truth for funds.
- Keep **off-chain services** stateless where possible.
- Broadcast live updates through **WebSocket**, not polling.
- Architecture-flow and roadmap-timeline diagrams: source `.mmd` files are in `docs/assets/`. Regenerate SVGs from them (`mmdc -i *.mmd -o *.svg`). Do not hand-edit SVGs.
