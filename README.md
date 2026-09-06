# Noviscia Protocol

A **central counterparty (CCP) clearing house for Solana** — a single on-chain omni-pool that nets offsetting risk across tenants, runs all margin as one yield-bearing vault (nvscUSDC), and absorbs defaults through a funded 5-layer waterfall before LPs are ever touched.

**Status:** Devnet operational · 19 active on-chain programs · revenue spine live (TVV velocity APY 15–35%) · mainnet target Q1 2027 (post-audit)

> This is a monorepo. It contains the on-chain programs (Rust/Anchor), the universal integrator SDK (`@noviscia/sdk`), the operational services, the revenue indexer, and the web application (`app/web`).

---

## Top-level layout

```
Anchor.toml / Cargo.toml     Solana workspace config (programs + archive)
programs/
  cluster-1-clearing-core/   CCP core: netting-engine, position-tracker, noviscia-clearing, clearing-registry (+ absorbed sovereign-netting, credit-line)
  cluster-2-tvv-gate/        TVV gate: noviscia-capacity (+ absorbed jit-risk, asset-engine), yield-router, gateway-auction
  cluster-3-vault-registry/  Omni-pool vault: nv-usdc-vault (+ absorbed tranche-vault, permissioned-pool)
  cluster-4-governance/      Locked tokenomics (token-nvsc, ve-nvs, staking-manager, yield-distributor, liquidation-vault) + deferred/archive programs (escrow, burn-engine, spot-dex, bug-bounty, protocol-lp-vault)
  _idl_stage/                Symlinks to host clusters for the IDL staging step
services/                    Operational services (indexer, relayers, oracles, AI…)
sdk/                         @noviscia/sdk — universal integrator gateway
app/web/                     Next.js frontend (dApp + investor relations)
scripts/                     Deploy, IDL upload, docs, tooling
docs/                        Whitepaper, tokenomics, architecture, security, legal…
vendor/                      Third-party / vendored crates
target/idl/                  Compiled Anchor IDLs (synced to app + sdk)
```

---

## On-chain programs (19 active)

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
| **noviscia-permissioned-pool** | On-chain KYC/AML ring: verifier-gated, provider-agnostic permissioned liquidity |
| **noviscia-capacity** | Single-slot clearing & risk engine: Merkle KYC tiers, dynamic premium, capacity ledger, credit freeze |
| **noviscia-tranche-vault** | Dual-tranche (protected / institutional) yield structuring |
| **noviscia-asset-engine** | Multi-asset token register & pool layout (SOL/wSOL, USDC, NVSC): per-mint AssetPools with atomic JIT allocation, 24h floating-window taxi-meter premiums, daily Clearing House settlement |
| **liquidation-vault** | Auto-deleveraging, insurance funding |
| **yield-router** | Yield deployment & atomic recall for margin calls |
| **yield-distributor** | Yield distribution & claiming |
| **staking-manager** | NVSC staking tiers, governance, fee distribution |
| **token-nvsc** | NVSC governance token (1B supply, 9 decimals) |
| **ve-nvs** | Vote-escrowed NVSC for governance weighting |

Deferred programs (bug-bounty, burn-engine, escrow, protocol-lp-vault, spot-dex) live
under `programs/cluster-4-governance/` and are kept for reference only — they are **not** part of the active
clearing + yield path.

---

## Revenue spine (the current on-chain reality)

All protocol revenue flows through the `nv-usdc-vault` fee spine. The architecture is
**one balance sheet, two engines** — the CCP core (clearing/netting/risk) and the TVV
yield engine (idle pooled capital reused as slot-scoped contingent capacity):

- **Revenue engines** feed the omni-pool NAV:
  - `sovereign-netting` — netting rent (`NettingRentPaid`)
  - `gateway-auction` — auctioned execution-slot premium tips (`AuctionSettled`)
  - `jit-risk` — slot-scoped JIT premiums (`SliceRented` / `PremiumSwept`, 400ms contingent capacity)

The **institutional asset lifecycle** layers the newer windows on top of that spine:

- `noviscia-capacity` — desks pre-buy single-slot capacity; the micro-premium leg is
  sealed into the same Jito bundle (paid or executed — both or neither).
- `noviscia-tranche-vault` — protected/institutional tranching of pooled yield.
- `noviscia-asset-engine` — the multi-asset token register (SOL handled as wSOL, plus
  USDC and NVSC): every mint owns a segregated `AssetPool` with its own capacity
  ceiling, premium baseline, and vault pair. `allocate_asset_capacity` reserves a
  block-slot and atomically CPIs the **principal** out of the pool vault to the desk
  in one transaction (within a Jito bundle). The micro-premium is **accrued, not
  paid per entry** — a 24h floating KYC window (`InstitutionalCreditLine`) ticks up
  `accumulated_premiums` like a taxi meter across thousands of slot trades, and the
  daily Clearing House instruction `settle_daily` verifies the desk treasury's
  native-asset return (USDC→USDC, SOL→SOL, NVSC→NVSC), resets the ledger, and stamps
  `last_settlement_timestamp`. Peak utilization streams to the Risk Sentinel via the
  gRPC `GetDeskStatus` RPC. Default is structurally impossible: a **soft lock** freezes
  all new borrows at 24h maturity (outstanding debt can only shrink), a **2h grace wall**
  meters a deterministic per-block late fee, and past that the desk is **Breached** and
  cleared offline under the Master Loan Agreement. Around the borrow side sits an
  **ERC-4626 share layer** (`deposit_asset_liquidity` → mint nUSDC/nSOL/nNVSC shares,
  `withdraw_asset_liquidity` → burn): premium splits 90/10 LP/engine at `settle_daily` so
  the vault **auto-compounds** the 90% LP credit with no manual claim, and every
  redemption is gated by a solvency floor — an LP can never pull idle liquidity below the
  desk's active credit utilization. Its authority surface is a **three-tier Layered
  Governance multi-sig** (Squads on Solana): a 1-of-3 Emergency Risk **Breaker** that can only
  freeze desks or pause the JIT loop, a 3-of-5 Risk **Committee** that owns limits, premium
  rates and KYC roots via on-chain RBAC, and a 5-of-7 Core Ecosystem **Council** (72h
  timelock) that registers assets, moves treasury fees and upgrades the program.
- `noviscia-permissioned-pool` — provider-agnostic (de-Sumsub) on-chain KYC/AML ring
  gating institutional liquidity.
- `noviscia-mla` — the Master Loan Agreement (New York law) whose three pillars are bound
  directly to the engine's on-chain enforcement: facility scope (wSOL/USDC/NVSC up to an
  NRS-derived limit), 24h atomic-return covenants (86,400s window, exact-asset settlement), and
  programmatic vs. legal defaults (Overdue soft-lock at maturity, 2h grace, DIF freeze +
  cross-collateralization on Formal Event of Default). One in-contract bridge table maps every
  clause to its executing instruction and constant — see
  [`docs/MASTER_LOAN_AGREEMENT.md`](./docs/MASTER_LOAN_AGREEMENT.md).
- Two access flows reach the engine — HFT desks headlessly via the low-latency SDK + Jito
  atomic bundles (<2ms), LPs via the regulated web dashboard + enterprise custody — one
  headless pipelines, one human and high-assurance; see
  [`docs/PARTICIPANT_ACCESS.md`](./docs/PARTICIPANT_ACCESS.md).
- The audited unit-economics of the TVV engine (slot-fee model, $10M reference balance
  sheet, tranche split, tail-risk hard-lock) ship as integer-cents math in
  `noviscia-asset-engine-sdk::economics` and `@noviscia/sdk` → `economics.ts`, pinned by
  tests — see [`docs/QUANTIFIED_RISK_PACK.md`](./docs/QUANTIFIED_RISK_PACK.md).

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

Rust-side builders live in the SDK crates under `sdk/rust/` — notably
`noviscia-capacity-sdk` (capacity purchase, settle, freeze) and the newer
`noviscia-asset-engine-sdk` (multi-asset `register_asset` / `allocate_asset_capacity`
builders + per-asset premium math).

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

- **[`docs/INDEX.md`](./docs/INDEX.md)** — documentation navigation hub (start here)
- [`docs/WHITEPAPER.md`](./docs/WHITEPAPER.md) — protocol design & current state
- [`docs/TOKENOMICS.md`](./docs/TOKENOMICS.md) — nvscUSDC vs NVSC
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — complete system architecture
- Engineering references: [`docs/ACCOUNT_MAP.md`](./docs/ACCOUNT_MAP.md) (PDA/account registry), [`docs/ERROR_REFERENCE.md`](./docs/ERROR_REFERENCE.md) (error codes)
- Security & risk: [`docs/SECURITY.md`](./docs/SECURITY.md), [`docs/THREAT_MODEL.md`](./docs/THREAT_MODEL.md), [`docs/ONCALL_RUNBOOK.md`](./docs/ONCALL_RUNBOOK.md), [`docs/KEY_MANAGEMENT_GOVERNANCE.md`](./docs/KEY_MANAGEMENT_GOVERNANCE.md)
- Audit gap tracking: [`docs/AUDIT_GAP_ANALYSIS.md`](./docs/AUDIT_GAP_ANALYSIS.md), [`docs/DOC_GAPS.md`](./docs/DOC_GAPS.md)
- [`docs/DEVNET.md`](./docs/DEVNET.md), [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md), [`docs/MONITORING.md`](./docs/MONITORING.md)
- [`docs/API.md`](./docs/API.md), [`sdk/README.md`](./sdk/README.md)
- Legal: [`docs/LEGAL.md`](./docs/LEGAL.md), [`docs/COMPLIANCE.md`](./docs/COMPLIANCE.md)

---

## Security

All programs are non-custodial and open-source. **An independent security audit has not yet been completed** — mainnet requires audit sign-off. Devnet is for testing only; do not use mainnet funds. See [`docs/SECURITY.md`](./docs/SECURITY.md) for full disclosures.
