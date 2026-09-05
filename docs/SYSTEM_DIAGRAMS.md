# Noviscia System Diagram

**Last updated:** September 5, 2026 — diagrams reflect live devnet architecture (19 active programs, 7 services).

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
- **Programs:** own all custody, margin, oracle verification, funding, liquidation, staking, netting, gateway auction, and JIT risk logic (19 active programs)
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

## 6) Liquidation Flow (liquidation-vault ADL)

```mermaid
sequenceDiagram
  participant PT as position-tracker
  participant LV as liquidation-vault
  participant NV as nv-usdc-vault
  participant M as Market

  PT->>M: Breach / liquidatability detected
  LV->>LV: liquidate_position — transfer margin, claw collateral
  LV->>NV: Insurance split on realized loss
  alt Insured loss
    LV->>M: insurance_payout — 80% insurance fund / 10% ADL
  else Bad debt (> insurance)
    LV->>LV: cover_bad_debt — socialized via vault NAV
  end
  LV->>LV: auto_deleveraging(position_id) — force-reduce residual risk
  LV->>LV: distribute_profits — vault USS surplus to LPs
```
Institution/trade positions that breach the desk's margin are force-closed here; the 80/10 split follows the Yield Flow (§3) convention on retained vs insurance-fund share.

## 7) Netting Flow (sovereign-netting → netting-engine)

```mermaid
sequenceDiagram
  participant R as Tenant reporters
  participant SN as sovereign-netting
  participant NE as netting-engine
  participant V as nv-usdc-vault

  R->>SN: commit_credit(amount_base)
  R->>SN: observe_traffic(volume_base) / observe_netting
  SN->>SN: set_base_rate / set_ur_cap / set_nei_alpha (admin-tuned)
  SN->>NE: exposures → aggregate(grid) — cross-tenant net
  NE->>NE: margin_requirement + house_residual_within_bps + netting_score
  NE->>NE: consolidate — post-netting settlements
  SN->>V: sweep_netting_rent / pay_netting_rent (rent = f(C_net, UR, BaseRate))
  SN->>SN: capture_priority_bid — auction surplus to NEI alpha
```
Netting rent is charged on observed cross-tenant volumes; the engine applies venue haircuts and correlation-based cross-margining before `consolidate` lands settlements.

## 8) Credit-Line Flow (noviscia-credit-line)

```mermaid
sequenceDiagram
  participant C as noviscia-credit-line
  participant B as Borrower (institution/desk)
  participant E as nv-usdc-vault

  B->>C: register_borrower(credit_limit)
  C->>C: set_config — global borrow cap / interest parameters
  B->>C: pull_credit(amount) — draw against limit
  C->>E: CPI transfer of drawn funds
  B->>C: repay_and_settle(principal) — settle outstanding
  C->>C: toll_and_utilization — utilization-sensitive pricing
```
Draws are capped at the registered `credit_limit`; utilization shapes the marginal toll. The aggregate institutional credit line in the asset-engine mirrors this flow with the three-tier committee signer (see `ACCOUNT_MAP.md`).

## 9) Staking Flow (staking-manager)

```mermaid
sequenceDiagram
  participant U as Voter
  participant SM as staking-manager
  participant M as nv-usdc-vault
  participant G as ve-nvs governance

  U->>SM: stake_tokens(amount)
  SM->>M: lock tokens into vault
  SM->>SM: derive_ve_pda — voting-power proportional carve-out
  U->>SM: claim_rewards / compound_rewards
  SM->>SM: distribute_rewards(total_rewards) — pro-rata by ve-weight
  U->>G: create_proposal / create_param_proposal
  G->>G: vote_proposal(support) — ve-weighted
  G->>G: execute_proposal — governed treasury actions
  M->>SM: record_trading_fee_usdc → claim_staking_fees (fee pool)
```
Discount rates (`get_discount_rate` / `get_liquid_discount_rate`) tier fee/borrow pricing by staked depth; `ve-nvs` ties governance influence to locked stake.

## 10) TVV Slice Lifecycle (jit-risk)

```mermaid
flowchart TD
  R[register_mm] --> U[update_params\nslice params / caps]
  U --> RNT[rent_slice amount + delta_wad\nmarket-maker rents capacity]
  RNT --> RS[reserve_slice\nslot-scoped committed capacity]
  RS --> SS{settle_slice}
  SS -->|within params| CF[capacity freed + premiums]
  SS -->|breach| FD[flag_desk / suspend_mm]
  FD --> FF[force_freeze — halt desk during breach]
  RNT -. expiry .-> RE[reap_expired_slice\nunused capacity returned]
  SS --> SP[sweep_premiums → insurance floor]
```

## Notes

- Keep the **web app** as the only user-facing entry point.
- Keep **Solana programs** as the source of truth for funds.
- Keep **off-chain services** stateless where possible.
- Broadcast live updates through **WebSocket**, not polling.
- Architecture-flow and roadmap-timeline diagrams: source `.mmd` files are in `docs/assets/`. Regenerate SVGs from them (`mmdc -i *.mmd -o *.svg`). Do not hand-edit SVGs.
