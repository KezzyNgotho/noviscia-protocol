# Noviscia: Yield-Native Central Counterparty Clearing Network

**The settlement layer for every market — trading, payments, and yield, unified on Solana.**

Noviscia is the on-chain central counterparty (CCP) that novates both sides of every trade, nets offsetting obligations, runs margin as a single yield-bearing omni-pool, and settles every transaction atomically. Non-custodial, permissionless, auditable, and always solvent.

| | |
|---|---|
| **Status** | Devnet beta live · Mainnet target Q4 2026 |
| **App** | [noviscia.com](https://noviscia.com) |
| **Docs** | [`docs/`](./docs/) |
| **SDK** | [`sdk/`](./sdk/) |
| **Contact** | [Discord](https://discord.gg/Noviscia-protocol) · ngothokezz18@gmail.com |

> **Disclaimer:** Devnet software for testing only. Not financial advice, not an offer of securities, not a commitment to future features. Parameters may change before mainnet.

---

## What Noviscia is

Noviscia is a clearing house — not a single dapp. An **Exchange Layer** of trading products (perps, event markets, spot AMM) and settlement rails (cross-border payments) sits on top of a **Clearing Infrastructure** — one yield-bearing vault, one settlement engine, one liquidation backstop. Every market routes into the same CCP.

The three architectural pillars:

1. **Central counterparty, not a DEX.** Noviscia novates both sides of every trade — you face the clearing house, never another trader. The house book is the only concentrated risk, continuously netted and margin-backed.
2. **Yield-bearing omni-pool.** One pool clears perps, event markets, spot swaps, and cross-border settlements. Idle margin earns yield — vault shares accrue strategy returns and protocol fee distribution simultaneously.
3. **Atomic settlement, sub-400ms recall.** Settlement, margin recall, and loss absorption happen atomically on Solana. When a position breaches maintenance margin, the waterfall absorbs the loss in pre-funded layers — LPs are touched last, if ever.

---

## How it works

```
Trader deposits USDC (or any SPL asset → Jupiter swaps to USDC)
  → nv-usdc-vault mints nvscUSDC shares at live NAV          [Clearing Infrastructure]
  → position-tracker.open_position_jit                        [Exchange Layer: perps]
        · verifies a fresh Pyth Hermes VAA on-chain (JIT, ≤3s old)
        · locks nvscUSDC shares as collateral (never redeemed)
        · charges trading fee → swept into vault NAV
  → position open. Locked shares keep compounding NAV.
  → close / liquidate / execute_tp_sl
        · re-verifies a fresh JIT price
        · settles peer-to-peer funding into realized PnL
        · on liquidation: 20% caller bounty, 80% retained
          (10% → per-market insurance fund, rest → vault NAV)

Event markets route through the same spine:
  → noviscia-clearing.place_bet                              [Exchange Layer: event markets]
        · locks USDC, JIT-verified Pyth oracle on resolution
        · fees swept into vault NAV via accumulate_protocol_fees CPI
        · winner claims via permissionless payout from market PDA vault

Spot swaps route through the same spine:
  → spot-dex: initialize_pool / add_liquidity / swap          [Exchange Layer: spot AMM]
        · constant-product x·y=k with LP tokens
        · swap netting routes through CCP netting engine
        · LPs earn trading fees proportionally

Cross-border payments route through the same spine:
  → cross-border: initiate_settlement                        [Settlement Layer: cross-border]
        · FX rate verified on-chain (Pyth)
        · funds locked atomically, FX executed, released atomically
        · compliance hooks: partner approval, required signers
```

No off-chain keeper. No external lending venue. Every path settles through the same clearing house.

---

## Core architecture proofs

| Proof | What it demonstrates |
|-------|---------------------|
| **Multilateral Netting & Novation** | Consolidates cross-product exposures across perps, AMMs, and cross-border rails into a single global net position. Tiered haircuts (stable 0%, blue-chip 15%, alt 60%) applied per collateral class. |
| **Sub-400ms Atomic Recall** | Deploys resting margin into yield strategies via the omni-pool vault. Block-level atomic callbacks via non-custodial PDAs preserve instant solvency. |
| **5-Layer Loss Waterfall** | Trader margin → insurance fund → default fund (2.5% of OI) → CCP equity (15%) → surplus. Every layer is public, on-chain, and continuously marked. Fees refill the layers. |
| **Portfolio Margin** | Cross-asset collateral weights, tiered haircuts, and continuous marking in real-time. Positions denominated in different assets netted against a unified margin account. |

---

## 16 on-chain programs

| Program | Devnet ID | Layer |
|---------|-----------|-------|
| `position-tracker` | `6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws` | Exchange: perps engine — JIT oracle, margin, funding, liquidation |
| `noviscia-clearing` | `GtTJWLa6MXjZoNucGHWVnE9LpZTw6Dsr5K1gxpM1Q4fe` | Exchange: settlement engine + event/outcome contracts |
| `spot-dex` | `8C4try8mEHukT4Z99Dpi3x1rNaBYhXms81uoU47JwLiN` | Exchange: constant-product AMM with LP tokens |
| `cross-border` | `C3uoiE3GZ47nuGwUckQPsZF8JBqgMk54nmfJYKqAEMbv` | Settlement: cross-border payments & FX |
| `nv-usdc-vault` | `CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC` | Infrastructure: share-based USDC vault (nvscUSDC), NAV accrual |
| `netting-engine` | `68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56` | Infrastructure: multilateral netting & novation ledger (CCP book) |
| `liquidation-vault` | `Cwma3FfMKhoLkgfrGYgErVPoFWEtHpx7DNc4wArpRHBz` | Infrastructure: per-market insurance & auto-deleveraging |
| `protocol-lp-vault` | `2WUt24rRNWsdi8sE56y74b7rJGgKbxSBsu7ntDkGAJkd` | Infrastructure: trading-fee-backed LP vault |
| `yield-router` | `FKaAPPid8B6hUme4w8bFCDzmvE6DpekXpeiR1sgyLwB4` | Infrastructure: yield strategy routing |
| `yield-distributor` | `CrN1o75FGwcSo6ted7eKxw2kYgkaXDVeWmUaTZCTsLtw` | Infrastructure: yield distribution |
| `clearing-registry` | `Hg5QvSsnb22gHexUTnvvfff3EJZxWnsFKRM8bZ8n7Jmo` | Infrastructure: tenant registration & metadata |
| `burn-engine` | `nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id` | Tokenomics: fee accumulation, NVSC buyback & burn |
| `staking-manager` | `HjxcKV51A7jxE2iqMCDY7EvWFL9XsheuM43DamWGabqb` | Tokenomics: NVSC staking tiers, governance |
| `token-nvsc` | `HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT` | Tokenomics: fixed-supply NVSC mint |
| `escrow` | `2WPb3wsyp4G6zFPx8sTYf3bTDyySxwpo1Ja8H6RCHXCZ` | Support: collateral escrow, idle yield hooks |
| `bug-bounty` | `A8Uk9WuHumfiuuZAHt4y3t3sXmT3cpXVXaFMhpDinjSK` | Support: on-chain bug bounty vault |

**Devnet mints:** USDC `Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5` · nvscUSDC `2TmaUey4Hh2om1kFR77Vw1RDh8H69qcW6UAACVidJeVk` · NVSC `HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT`

**Deployer:** `pm2tUw22SDofzdfmyJv3jRDhLagwiqYRmCG2BWN23NA`

---

## Repository layout

```
noviscia-protocal/
├── programs/                         # 16 Solana Anchor programs
│   ├── position-tracker/             # Perps engine — JIT oracle, margin, funding, liquidation
│   ├── noviscia-clearing/            # Settlement engine + event/outcome contracts
│   ├── spot-dex/                     # Constant-product AMM (x·y=k) with LP tokens
│   ├── cross-border/                 # Cross-border payments & FX settlement
│   ├── nv-usdc-vault/                # Share-based USDC vault (nvscUSDC), NAV accrual
│   ├── netting-engine/               # Multilateral netting & novation ledger
│   ├── liquidation-vault/            # Per-market insurance & auto-deleveraging
│   ├── protocol-lp-vault/            # Trading-fee-backed LP vault
│   ├── yield-router/                 # Yield strategy routing
│   ├── yield-distributor/            # Yield distribution
│   ├── clearing-registry/            # Tenant registration & metadata
│   ├── burn-engine/                  # Fee accumulation, NVSC buyback & burn
│   ├── staking-manager/              # NVSC staking tiers, governance
│   ├── token-nvsc/                   # Fixed-supply NVSC mint
│   ├── escrow/                       # Collateral escrow, idle yield hooks
│   └── bug-bounty/                   # On-chain bug bounty vault
│
├── sdk/                              # TypeScript SDK
│   ├── src/                          # Core: ids, client, collateral, crossBorder, tenantOnboarding
│   └── gateway/                      # Adapters: perpsAdapter, spotAdapter
│
├── app/web/                          # Next.js 14 App Router
│   ├── app/                          # Pages
│   │   ├── trade/                    #   perps, amm, cross-border, collateral, triggers
│   │   ├── earn/                     #   vault, AI yield router
│   │   ├── developer/                #   SDK docs, API docs, integrations docs
│   │   ├── manage/                   #   portfolio management
│   │   ├── analytics/                #   protocol analytics
│   │   └── api/                      #   REST API routes
│   ├── components/                   # React components
│   └── lib/                          # Client libraries (programs, product-flow, i18n)
│
├── services/                         # Off-chain services
│   ├── indexer/                      # Blockchain indexer
│   ├── ai-orchestrator/              # LLM trade analysis
│   └── price-feed/                   # Pyth price aggregation
│
├── scripts/                          # Devnet operations
│   ├── deploy/                       # Program deployment & IDL upload
│   ├── init/                         # Market registration, oracle setup
│   ├── e2e/                          # End-to-end proof scripts
│   ├── monitor/                      # Health checks, verification
│   └── utils/                        # Devnet utilities
│
├── docs/                             # Protocol documentation (30+ documents)
├── Anchor.toml                       # Anchor workspace config (source of truth for program IDs)
├── Cargo.toml                        # Rust workspace
└── docker-compose.yml                # Local dev (postgres, redis, services)
```

---

## Quick start

```bash
# Clone
git clone https://github.com/noviscia-protocol/noviscia-protocal.git
cd noviscia-protocal

# Install dependencies
npm install
cd app/web && npm install && cd ../..

# Build all 16 Anchor programs
anchor build

# Deploy to devnet (requires ~/.config/solana/new-id.json with SOL)
anchor deploy --provider.cluster devnet

# Upload IDLs
npm run idl:upload-devnet

# Start web app
cd app/web && npm run dev
```

> **Deploy note:** If the binary exceeds allocated space: `solana program extend <PROGRAM_ID> 10240 --keypair ~/.config/solana/new-id.json`

### Key commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build all Anchor programs |
| `npm run deploy:devnet` | Deploy to devnet |
| `npm run sync:idls` | Sync IDLs from target/ to web app |
| `npm run indexer:dev` | Start the blockchain indexer |
| `npm run check:ai-layer` | Verify AI orchestrator health |

---

## TypeScript SDK

The SDK provides typed instruction builders for every program, wallet adapters, a sandbox simulator, and tenant onboarding helpers.

```typescript
import { PROGRAM_IDS, USDC_MINT } from '@noviscia/sdk';
import { getAssociatedTokenAddress } from '@solana/spl-token';

// All program IDs, env-overridable
const spotDex = PROGRAM_IDS.spotDex;       // 8C4try8mEHukT4Z99Dpi3x1rNaBYhXms81uoU47JwLiN
const crossBorder = PROGRAM_IDS.crossBorder; // C3uoiE3GZ47nuGwUckQPsZF8JBqgMk54nmfJYKqAEMbv
const positionTracker = PROGRAM_IDS.positionTracker; // BGayb5EC13gKPbq1QVeUHUFdUM7trynXXCPtVbBUoCGd

// SDK exports 25+ typed builders:
//   buildOpenPositionIx, buildClosePositionIx    — perps
//   buildSwapIx, buildAddLiquidityIx             — spot AMM
//   buildInitiateSettlementIx                    — cross-border
//   buildRegisterTenantIx, buildUpdateTenantIx   — tenant onboarding
//   buildDepositIx, buildWithdrawIx              — vault
//   buildStakeIx, buildUnstakeIx                 — staking
//   ... and more
```

### SDK modules

| Module | Purpose |
|--------|---------|
| `sdk/src/ids.ts` | All 16 program IDs + mints, env-overridable |
| `sdk/src/client.ts` | Main SDK client with connection management |
| `sdk/src/collateral.ts` | Collateral deposit, withdrawal, NAV queries |
| `sdk/src/crossBorder.ts` | Cross-border settlement instructions |
| `sdk/src/tenantOnboarding.ts` | Third-party tenant registration |
| `sdk/src/payloads.ts` | Instruction payload builders |
| `sdk/src/sandbox.ts` | Local simulation sandbox |
| `sdk/gateway/src/perpsAdapter.ts` | Perps instruction adapter |
| `sdk/gateway/src/spotAdapter.ts` | Spot AMM instruction adapter |

---

## Web app

Next.js 14 App Router with Tailwind CSS, Solana wallet adapter, and devnet-pinned configuration.

### Pages

| Route | Description |
|-------|-------------|
| `/` | Homepage — architecture, use cases, token model, FAQ |
| `/trade/perps` | Perpetual futures — up to 50× leverage, JIT oracle |
| `/trade/amm` | Spot AMM — constant-product x·y=k pools, swap/add/remove liquidity |
| `/trade/cross-border` | Cross-border settlement — FX rates, multi-rail, compliance hooks |
| `/trade/collateral` | Collateral console — deposit, withdraw, portfolio view |
| `/earn/vault` | Omni-pool vault — deposit USDC, earn yield as nvscUSDC |
| `/developer/sdk` | SDK documentation — 16 program IDs, instruction builders, examples |
| `/developer/api` | API documentation — REST endpoints, AMM pool data, settlement status |
| `/developer/integrations` | Integration guide — Rust CPI, TypeScript frontend, AMM architecture |
| `/token` | NVSC token — governance, staking tiers, fee cascade |
| `/manage/portfolio` | Portfolio management — positions, margin, PnL |

---

## Devnet proof scripts

Every mechanic has a corresponding live-devnet proof script under `scripts/e2e/`:

| Script | What it proves |
|--------|---------------|
| `e2e-jit-open-close-devnet.ts` | Open/close + trading-fee NAV accrual |
| `e2e-pain-points-devnet.ts` | Edge cases and pain-point validation |
| `bootstrap-devnet.ts` | Full devnet state bootstrap |
| `e2e-open-close-devnet.ts` | Extended open/close lifecycle |

---

## Key mechanics

**Simultaneous Double-Yield** — Locked collateral is never redeemed. Shares appreciate at the same rate as unlocked vault holdings because `total_assets` grows from trading fees and liquidation penalties.

**JIT Pyth pull-oracle** — Every price-sensitive instruction carries a fresh guardian-signed Hermes VAA, verified via Pyth Receiver's `post_update_atomic` in the same transaction. No on-chain price account, no keeper network.

**Peer-to-peer funding** — `Market.funding_index` moves via permissionless `settle_funding` as a pure function of OI skew. Settled directly into realized PnL at close.

**Closed-loop liquidation** — Permissionless. 20% caller bounty (paid in live nvscUSDC shares), 80% protocol-retained (10% → insurance fund, rest → vault NAV).

**Tiered collateral haircuts** — Stablecoins at 0%, blue-chip assets at 15%, altcoins at 60%. Applied via `resolve_haircut()` in the netting engine.

---

## Token economics

### NVSC

| Property | Value |
|----------|-------|
| Supply | 100,000,000 fixed |
| Utility | Governance, fee tiers, staking fee share |
| Staking tiers | Bronze 100 · Silver 1K · Gold 10K · Platinum 100K NVSC |

| Allocation | % |
|------------|---|
| Ecosystem | 60% |
| Team (4yr vest) | 20% |
| Treasury | 15% |
| Public sale | 5% |

### Fee & yield flows

| Source | Split |
|--------|-------|
| Trading fees (open + close) | 100% → vault NAV |
| Liquidation penalty | 20% bounty · 10% insurance · 70% vault NAV |
| Protocol fee cascade | 85% → nvscUSDC holders · 15% → NVSC stakers |
| Surplus (over-capacity) | 15% → NVSC buyback & burn |

---

## Security

- **Non-custodial PDAs** — users sign every action, no multisig, no admin key
- **JIT Pyth pull-oracle** — strict on-chain freshness ceiling, no stale-price attack surface
- **5-layer loss waterfall** — trader margin → insurance fund → default fund (2.5% OI) → CCP equity (15%) → surplus
- **Permissionless liquidation** — no trusted keeper, 20% caller bounty
- **Portfolio margin** — cross-asset haircuts, tiered collateral weights, continuous marking
- **Atomic settlement** — funds locked, FX executed, released atomically — no partial fills
- **IDL-first development** — every program publishes its Anchor IDL, no black boxes
- **On-chain bug bounty** — active bounty vault for responsible disclosure
- **Pre-mainnet audit required** — not yet completed

---

## Roadmap

| Phase | Milestones | Target |
|-------|------------|--------|
| **Devnet beta** | JIT-oracle perps, live-NAV margin, funding, insurance, any-collateral, Collateral Console + Analytics | Live |
| **Q3 2026** | Spot AMM, cross-border payments, 16 programs, SDK v1, developer docs | In progress |
| **Q4 2026** | Security audit, mainnet IDs locked, NVSC TGE, mainnet soft launch | Planned |
| **2027+** | Expanded markets, options, RWA, mobile PWA, third-party tenant onboarding | Planned |

---

## Documentation

| Document | Path |
|----------|------|
| Clearing house vision | [`docs/CLEARING_HOUSE_VISION.md`](./docs/CLEARING_HOUSE_VISION.md) |
| CCP architecture | [`docs/CCP_ARCHITECTURE.md`](./docs/CCP_ARCHITECTURE.md) |
| Architecture v2 | [`docs/ARCHITECTURE_V2.md`](./docs/ARCHITECTURE_V2.md) |
| Whitepaper | [`docs/WHITEPAPER.md`](./docs/WHITEPAPER.md) |
| Tokenomics | [`docs/TOKENOMICS.md`](./docs/TOKENOMICS.md) |
| Security | [`docs/SECURITY.md`](./docs/SECURITY.md) |
| Audit prep | [`docs/AUDIT_PREP.md`](./docs/AUDIT_PREP.md) |
| Deployment | [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) |
| API reference | [`docs/API.md`](./docs/API.md) |
| Legal | [`docs/LEGAL.md`](./docs/LEGAL.md) |

---

## Links

| Resource | URL |
|----------|-----|
| Live app | https://noviscia.com |
| Discord | https://discord.gg/Noviscia-protocol |
| Twitter | https://twitter.com/noviscia |
| GitHub | https://github.com/noviscia-protocol/noviscia-protocal |

---

© 2026 Noviscia Protocol. Devnet beta — not for production use.
