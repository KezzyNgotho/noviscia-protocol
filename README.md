# Noviscia Protocol

A **central counterparty (CCP) clearing house for Solana** — a single on-chain omni-pool that nets offsetting risk across tenants, runs all margin as one yield-bearing vault (nvscUSDC), and absorbs defaults through a funded 5-layer waterfall before LPs are ever touched.

**Status:** Devnet operational · 15 active on-chain programs · revenue spine live (TVV velocity APY 15–35%) · mainnet target Q1 2027 (post-audit)

> This is a monorepo. It contains the on-chain programs (Rust/Anchor), the universal integrator SDK (`@noviscia/sdk`), the operational services, the revenue indexer, and the web application (`app/web`).

---

## Top-level layout

```
Anchor.toml / Cargo.toml     Solana workspace config (programs + archive)
programs/
  active/                    The 15 live on-chain programs (Anchor)
  later/                     Archived / "for-later" programs (kept for reference, not built)
services/                    Operational services (indexer, relayers, oracles, AI…)
sdk/                         @noviscia/sdk — universal integrator gateway
app/web/                     Next.js frontend (dApp + investor relations)
scripts/                     Deploy, IDL upload, docs, tooling
docs/                        Whitepaper, tokenomics, architecture, security, legal…
vendor/                      Third-party / vendored crates
target/idl/                  Compiled Anchor IDLs (synced to app + sdk)
```

---

## On-chain programs (15 active)

| Program | Role |
|---------|------|
| **nv-usdc-vault** | Omni-pool: deposit/withdraw nvscUSDC shares, NAV accrual, **accumulate_protocol_fees** fee spine, target-APY keeper |
| **position-tracker** | JIT-oracle perp engine: positions, funding, liquidation, TP/SL, orders |
| **noviscia-clearing** | Broad market clearing (event/outcome markets) |
| **netting-engine** | Multilateral netting & novation ledger, house book |
| **clearing-registry** | Multi-tenant onboarding & venue management |
| **sovereign-netting** | Sovereign/cross-tenant netting + netting-rent revenue |
| **gateway-auction** | Gateway-auction revenue (premium tips) |
| **jit-risk** | JIT risk-slot marketplace with `sweepPremiums` (slot-scoped premium accrual) |
| **noviscia-credit-line** | On-chain credit lines |
| **liquidation-vault** | Auto-deleveraging, insurance funding |
| **yield-router** | Yield deployment & atomic recall for margin calls |
| **yield-distributor** | Yield distribution & claiming |
| **staking-manager** | NVSC staking tiers, governance, fee distribution |
| **token-nvsc** | NVSC governance token (1B supply, 9 decimals) |
| **ve-nvs** | Vote-escrowed NVSC for governance weighting |

Deferred programs (bug-bounty, burn-engine, escrow, protocol-lp-vault, spot-dex) live
under `programs/later/` and are kept for reference only — they are **not** part of the active
clearing + yield path.

---

## Revenue spine (the current on-chain reality)

All protocol revenue flows through the `nv-usdc-vault` fee spine. The architecture is
**one balance sheet, two engines** — the CCP core (clearing/netting/risk) and the TVV
yield engine (idle pooled capital reused as slot-scoped contingent capacity):

- **3 revenue engines** feed the omni-pool NAV:
  - `sovereign-netting` — netting rent (`NettingRentPaid`)
  - `gateway-auction` — auctioned execution-slot premium tips (`AuctionSettled`)
  - `jit-risk` — slot-scoped JIT premiums (`SliceRented` / `PremiumSwept`, 400ms contingent capacity)

The funder (`EWPXT9DdijkWEzmNgmXbcwwTBnWLzaYFomhAsp3MyDv5`) is fed by auto-mint from the
USDC mint authority. NVSC remains governance utility; staking tiers and the buyback/burn
flywheel govern supply.

---

## `@noviscia/sdk` — the universal integrator gateway

Anyone can integrate with Noviscia regardless of product via the SDK. It surfaces the
revenue/clearing primitives the CCP shares across tenants:

- `CollateralGateway` — deposit/withdraw collateral into the omni-pool
- `JitRiskClient` — incl. `sweepPremiums` (TVV premium sweep)
- `TenantOnboarding` — register a DEX/GameFi/RWA frontend to route settlement into the CCP
- `NovisciaClient` + `loadCliWallet` — loads the default CLI wallet (`~/.config/solana/new-id.json`)

```bash
npm install @noviscia/sdk
```

---

## Services

| Service | Role |
|---------|------|
| `indexer` | On-chain indexer (revenue + tick/candle snapshots) on `:8092` |
| `netting-relayer` | Netting relay for multi-tenant venues |
| `price-feed` | Oracle ingestion / JIT oracle feeds |
| `websocket` | Live streaming updates |
| `ai-orchestrator` | Local LLM (Ollama qwen2.5:7b) advisory agents |
| `web` | Next.js frontend container |
| `postgres` / `redis` | Persistence + fast caching for the indexer/services |

---

## Web application (`app/web`)

Next.js dApp covering `/earn`, `/analytics`, `/investors`, `/liquidity-hub`, `/manage/portfolio`, `/token`, `/developer`, `/more`, `/ecosystem`. The **Investor Relations** page (`/investors`) plots **real on-chain revenue** from durable vault snapshots (all 12 months, year selector, and month/year/range export) instead of a modelled curve.

```bash
cd app/web
npm install
npm run dev          # http://localhost:3000
```

---

## Development

```bash
# Build all active programs
anchor build          # or: cargo build --workspace

# Test
cargo test --workspace

# Deploy / IDL upload
bash scripts/deploy/upload-one-idl-devnet.sh

# Frontend checks
cd app/web && npm run type-check && npm run lint
```

---

## Documentation

- [`docs/WHITEPAPER.md`](./docs/WHITEPAPER.md) — protocol design & current state
- [`docs/TOKENOMICS.md`](./docs/TOKENOMICS.md) — nvscUSDC vs NVSC
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — complete system architecture
- [`docs/DEVNET.md`](./docs/DEVNET.md), [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md), [`docs/MONITORING.md`](./docs/MONITORING.md)
- [`docs/API.md`](./docs/API.md), [`sdk/README.md`](./sdk/README.md)
- Security & legal: [`docs/SECURITY.md`](./docs/SECURITY.md), [`docs/LEGAL.md`](./docs/LEGAL.md), [`docs/COMPLIANCE.md`](./docs/COMPLIANCE.md)

---

## Security

All programs are non-custodial and open-source. **An independent security audit has not yet been completed** — mainnet requires audit sign-off. Devnet is for testing only; do not use mainnet funds. See [`docs/SECURITY.md`](./docs/SECURITY.md) for full disclosures.
