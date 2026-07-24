# Noviscia Protocol

**Perpetuals on Solana where margin never sits idle.**

The same nvscUSDC shares backing your leveraged position earn protocol yield the entire time they're locked as collateral.

| | |
|---|---|
| **Status** | Devnet beta live · Mainnet target Q3 2026 |
| **App** | [noviscia.com](https://noviscia.com) |
| **Docs** | [`docs/`](./docs/) |
| **Contact** | [Discord](https://discord.gg/Noviscia-protocol) · ngothokezz18@gmail.com |

> **Disclaimer:** Devnet software for testing only. Not financial advice, not an offer of securities, not a commitment to future features. Parameters may change before mainnet.

---

## How it works

```
Trader deposits USDC (or any SPL asset → Jupiter swaps to USDC)
  → nv-usdc-vault mints nvscUSDC shares at live NAV
  → position-tracker.open_position_jit
        · verifies a fresh Pyth Hermes VAA on-chain (JIT, ≤3s old)
        · locks nvscUSDC shares as collateral (never redeemed)
        · charges trading fee → swept into vault NAV
  → position open. Locked shares keep compounding NAV.
  → close / liquidate / execute_tp_sl
        · re-verifies a fresh JIT price
        · settles peer-to-peer funding into realized PnL
        · on liquidation: 20% caller bounty, 80% retained
          (10% → per-market insurance fund, rest → vault NAV)
```

No AMM. No order-matching engine. No off-chain keeper. No external lending venue.

---

## Key mechanics

**Simultaneous Double-Yield** — Locked collateral is never redeemed. Shares appreciate at the same rate as unlocked vault holdings because `total_assets` grows from trading fees and liquidation penalties.

**JIT Pyth pull-oracle** — Every price-sensitive instruction carries a fresh guardian-signed Hermes VAA, verified via Pyth Receiver's `post_update_atomic` in the same transaction. No on-chain price account, no keeper network.

**Peer-to-peer funding** — `Market.funding_index` moves via permissionless `settle_funding` as a pure function of OI skew. Settled directly into realized PnL at close.

**Closed-loop liquidation** — Permissionless. 20% caller bounty (paid in live nvscUSDC shares), 80% protocol-retained (10% → insurance fund, rest → vault NAV).

---

## Repository layout

```
noviscia-protocal/
├── programs/                    # Solana Anchor programs
│   ├── position-tracker/        # Core perps engine — JIT oracle, margin, funding, liquidation
│   ├── nv-usdc-vault/           # Share-based USDC vault (nvscUSDC), NAV accrual
│   ├── burn-engine/             # Fee accumulation, NVSC buyback & burn
│   ├── escrow/                  # Legacy lending/yield (not in perps path)
│   ├── staking-manager/         # NVSC staking tiers, governance
│   ├── yield-distributor/       # Lend yield distribution
│   ├── token-nvsc/              # Fixed-supply NVSC mint
│   ├── prediction-market/       # On-chain prediction markets
│   ├── liquidation-vault/       # Legacy per-asset insurance (perps uses its own per-market fund)
│   └── protocol-lp-vault/       # Trading-fee-backed LP vault
│
├── app/web/                     # Next.js 14 PWA
│   ├── app/                     # Pages — trade, earn, analytics, API routes
│   ├── lib/                     # Client libraries (@/lib/*)
│   ├── components/              # React components (@/components/*)
│   └── tsconfig.json            # Path aliases: @/lib/*, @/components/*
│
├── services/                    # Off-chain services
│   ├── indexer/                 # Blockchain indexer → PostgreSQL
│   ├── websocket/               # Real-time push server
│   ├── price-feed/              # Pyth price aggregation
│   ├── ai-orchestrator/         # LLM trade analysis (Ollama)
│   ├── ai-rebalancer/           # AI-driven rebalancing
│   └── squid/                   # SubQuery squid
│
├── scripts/                     # Devnet operations
│   ├── deploy/                  # Program deployment & IDL upload
│   ├── init/                    # Market registration, oracle setup
│   ├── migrate/                 # Account/state migrations
│   ├── e2e/                     # End-to-end proof scripts
│   ├── monitor/                 # Health checks, verification
│   ├── setup/                   # Local dev environment
│   ├── executor/                # Limit/TWAP order executor
│   ├── indexer/                 # Indexer deployment
│   └── utils/                   # One-off utilities
│
├── docs/                        # Protocol documentation
├── Anchor.toml                  # Anchor workspace config
├── Cargo.toml                   # Rust workspace
└── docker-compose.yml           # Local dev (postgres, redis, services)
```

---

## Quick start

```bash
# Install dependencies
npm install
cd app/web && npm install && cd ../..

# Build all programs
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

## Devnet proof scripts

Every perps mechanic has a corresponding live-devnet proof script under `scripts/e2e/`:

| Script | What it proves |
|--------|---------------|
| `e2e-jit-open-close-devnet.ts` | Open/close + trading-fee NAV accrual |
| `e2e-tp-sl-devnet.ts` | Take-profit / stop-loss execution |
| `e2e-limit-order-devnet.ts` | Resting limit order placement + fill |
| `e2e-funding-devnet.ts` | Peer-to-peer funding settlement (exact match against hand-computed expectation) |
| `e2e-liquidation-devnet.ts` | Liquidation split + insurance-fund carve-out |

---

## Programs

| Program | Devnet ID |
|---------|-----------|
| `position-tracker` | `3zGRWKZq4V3npHbH9Lati46BwgmstTjynWZFFMxarQgY` |
| `nv-usdc-vault` | `CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC` |
| `protocol-lp-vault` | `BJVr4bWdNkaUNff3Se6Wob2edPoc64dAaW3Gkgtf4AgT` |
| `escrow` | `CTmCryJca9cFyMRaGdzrhyZeEnjdGLD8ZkEqNcNbvh2D` |
| `burn-engine` | `nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id` |
| `staking-manager` | `4VDQjH73DiE3zYt66ukyWY7KMMJrxHUZfjkxRHTPDG75` |
| `yield-distributor` | `CrN1o75FGwcSo6ted7eKxw2kYgkaXDVeWmUaTZCTsLtw` |
| `liquidation-vault` | `C5mvuPTN7KHQ1NsXSUcD2tEae9fL1pLrNkZD67jRRuf1` |
| `prediction-market` | `3BTcArdsxKhzF2Msjm3JLy343v6ZvQjPusq3V2zRNbpv` |
| `token-nvsc` | `HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT` |

**Devnet markets:** SOL, BTC, ETH (50x max, 1% maintenance margin). 13 additional catalog markets in frontend as previews.

**Devnet mints:** USDC `Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5` · nvscUSDC `2TmaUey4Hh2om1kFR77Vw1RDh8H69qcW6UAACVidJeVk` · NVSC `HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT`

**Deployer:** `pm2tUw22SDofzdfmyJv3jRDhLagwiqYRmCG2BWN23NA`

---

## Token economics

### NVSC

| Property | Value |
|----------|-------|
| Supply | 1,000,000,000 fixed |
| Utility | Governance, fee tiers, staking fee share |
| Staking tiers | Bronze 100 · Silver 1K · Gold 10K · Platinum 100K NVSC |

| Allocation | % |
|------------|---|
| Ecosystem | 35% |
| Public sale | 25% |
| Liquidity | 15% |
| Team (4yr vest) | 15% |
| Partners | 10% |

### Fee & yield flows

| Source | Split |
|--------|-------|
| Trading fees (open + close) | 100% → vault NAV |
| Liquidation penalty | 20% bounty · 10% insurance · 70% vault NAV |
| Peer-to-peer funding | 100% redistributed — not protocol revenue |

---

## Security

- Non-custodial PDAs — users sign every action
- JIT Pyth pull-oracle with strict on-chain freshness ceiling — no stale-price attack surface
- Three-tier safety: user collateral → insurance fund → vault NAV
- Permissionless liquidation and funding settlement — no trusted keeper
- Market risk parameters validated on-chain (initial margin at max leverage must exceed maintenance margin)
- **Pre-mainnet audit required — not yet completed**

---

## Roadmap

| Phase | Milestones | Target |
|-------|------------|--------|
| **Devnet beta** | JIT-oracle perps, live-NAV margin, funding, insurance, any-collateral, Collateral Console + Analytics | Live |
| **Q2–Q3 2026** | Security audit, mainnet IDs locked, NVSC TGE | In progress |
| **Q3 2026** | Mainnet soft launch, SOL/BTC/ETH, production Pyth feeds | Planned |
| **Q4 2026+** | Expanded markets (16), mobile PWA | Planned |

---

## Documentation

| Document | Path |
|----------|------|
| Architecture | [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) |
| Devnet runbook | [`docs/DEVNET.md`](./docs/DEVNET.md) |
| Tokenomics | [`docs/TOKENOMICS.md`](./docs/TOKENOMICS.md) |
| Whitepaper | [`docs/WHITEPAPER.md`](./docs/WHITEPAPER.md) |
| Security | [`docs/SECURITY.md`](./docs/SECURITY.md) |
| Legal | [`docs/LEGAL.md`](./docs/LEGAL.md) |
| User guide | [`docs/USER_GUIDE.md`](./docs/USER_GUIDE.md) |

---

## Links

| Resource | URL |
|----------|-----|
| Live app | https://noviscia.com |
| Discord | https://discord.gg/Noviscia-protocol |
| Twitter | https://twitter.com/noviscia |

---

© 2026 Noviscia Protocol. Devnet beta — not for production use.
