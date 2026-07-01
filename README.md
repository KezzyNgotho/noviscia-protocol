# Noviscia Protocol

**Zero-waste perpetuals on Solana** — multi-asset cross-collateral margin, idle yield on every dollar between trades, atomic recall when you open a position.

| | |
|---|---|
| **Status** | Devnet beta live · Mainnet target Q3 2026 (post-audit) |
| **App** | [noviscia.com](https://noviscia.com) |
| **Docs** | [`docs/`](noviscia-protocal/docs/) |
| **Contact** | [Discord](https://discord.gg/Noviscia-protocol) · ngothokezz18@gmail.com |

> **Disclaimer:** Devnet software for testing only. Not financial advice, not an offer of securities, not a commitment to future features. Parameters may change before mainnet.

---

## Executive summary

Noviscia is a non-custodial perpetual DEX on Solana built around one insight: **traders leave billions in margin idle** while perp venues capture none of the yield that money could earn. Noviscia deploys idle USDC into its **Sovereign Omni-Pool**, accrues yield per-user via a compounding `fee_index` ledger, and **recalls margin atomically** when a trade opens — no manual steps, no external dependency.

The protocol is built around **multi-asset cross-collateral margin**: traders can post USDC (100% LTV), SOL (80% LTV), mSOL / jitoSOL (82% LTV, coming) as collateral, weighted and summed at position open and liquidation via a `remaining_accounts` pattern that scales to every catalog market without growing instruction size.

**Dual-token model:**
- **nvscUSDC** — yield-bearing vault share; earns NAV from the Sovereign Omni-Pool; used as perp margin.
- **NVSC** — fixed 1B governance token; fee tiers, fee share, pool-parameter votes.

Trading fees and protocol yield feed a **deflationary flywheel**: 40% of perp fees fund NVSC buyback & burn; 60% flow to stakers.

---

## What's live on devnet (July 2026)

| Feature | Status |
|---------|--------|
| USDC-settled perps (SOL, BTC, ETH + 13 preview markets) | **Live** |
| Dual-oracle consensus (Pyth + Switchboard) | **Live** |
| Multi-asset collateral (USDC + SOL; mSOL/jitoSOL wired, mainnet mints) | **Live** |
| Sovereign Omni-Pool (sweep → protocol pool → recall round-trip) | **Live** |
| Idle margin yield (`fee_index` ledger, `claim_idle_yield`) | **Live** |
| Sub-accounts (sub_id 1–255; isolated escrow + positions per sub-account) | **Live** |
| Permissionless liquidation crank | **Live** |
| Limit orders + TWAP | **Live** |
| AMM depth / JIT matching / asset-weight tiering | **Live** |
| Collateral Console UI (`/trade/collateral`) | **Live** |
| Analytics dashboard UI (`/analytics`) | **Live** |
| nvscUSDC vault deposit / redeem | **Live** |
| NVSC staking tiers + governance | **Live** |
| Per-asset insurance funds (per-mint liquidation-vault pools) | **Live (USDC pool)** |
| Prediction markets | **Beta** |
| NVSC TGE, mainnet launch | **Q3 2026** |

---

## Architecture overview

```
USDC
  → nv-usdc-vault (Sovereign Omni-Pool, protocol-native, NAV accrual)
  → Escrow PDA [seeds: b"escrow", user]          ← idle margin earns fee_index yield
  → CollateralPosition PDA [seeds: b"collateral", user, mint]   ← SOL / other assets
  → Sub-account escrow [seeds: b"escrow", user, sub_id]         ← isolated sub-accounts
  → position-tracker (dual oracle, liquidation, fee routing)
  → Lending Integrator (venue weights, AI router optional)
  → Burn Engine + Staking Manager (flywheel)
```

### Programs & devnet IDs

| Program | Devnet ID |
|---------|-----------|
| `escrow` | `CTmCryJca9cFyMRaGdzrhyZeEnjdGLD8ZkEqNcNbvh2D` |
| `position_tracker` | `3zGRWKZq4V3npHbH9Lati46BwgmstTjynWZFFMxarQgY` |
| `nv_usdc_vault` | `CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC` |
| `lending_integrator` | `Ea5TXHxsVcnKwMAcAsQkpPN88xr8ndBRpNGDkREWrbSZ` |
| `burn_engine` | `nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id` |
| `staking_manager` | `4VDQjH73DiE3zYt66ukyWY7KMMJrxHUZfjkxRHTPDG75` |
| `yield_distributor` | `CrN1o75FGwcSo6ted7eKxw2kYgkaXDVeWmUaTZCTsLtw` |
| `liquidation_vault` | `C5mvuPTN7KHQ1NsXSUcD2tEae9fL1pLrNkZD67jRRuf1` |
| `prediction_market` | `3BTcArdsxKhzF2Msjm3JLy343v6ZvQjPusq3V2zRNbpv` |

**Devnet mints:** USDC `Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5` · nvscUSDC `2TmaUey4Hh2om1kFR77Vw1RDh8H69qcW6UAACVidJeVk` · NVSC `HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT`

**Deployer:** `pm2tUw22SDofzdfmyJv3jRDhLagwiqYRmCG2BWN23NA` · keypair at `~/.config/solana/new-id.json`

---

## Key mechanisms

### Idle margin yield

Every escrow account stores a `fee_index_snapshot` (u128). The vault accumulates a global `fee_index` as trading fees accrue. When a user calls `claim_idle_yield`, the escrow program computes:

```
delta = current_fee_index - snapshot
yield = idle_usdc * delta / FEE_INDEX_SCALE  (FEE_INDEX_SCALE = 1e18)
```

This CPIs to `pay_trader_profit` on the vault and credits the user's escrow balance. The yield tracker in the UI shows live pending yield ticking in real time.

### Multi-asset collateral

Each (user, mint) pair has a `CollateralPosition` PDA (`seeds = [b"collateral", user, mint]`). `Liquidate` and `AdjustMargin` accept `remaining_accounts` as `[oracle, collateral_position]` pairs. The handler loops and sums:

```
effective_margin += raw_balance * oracle_price * weight_bps / 10_000
```

Only assets with a `CollateralWeightConfig` PDA contribute. Adding new assets to governance requires no instruction-schema change.

### Sub-accounts

Sub-accounts are isolated trading contexts with their own `UserState`, `Position`, and `Escrow` PDAs using a third `sub_id: u8` seed component. Sub-account 0 is implicit (existing PDAs). Sub-accounts 1–255 are created via `create_sub_account(sub_id, label)`. Margin and positions in one sub-account cannot be touched by another's liquidation.

### Sovereign Omni-Pool

`nv_usdc_vault` manages all idle USDC natively in the Sovereign Omni-Pool. A permissionless crank calls `sweep_to_pool` to deploy idle USDC. On trade open, `recall_for_trade(amount)` atomically pulls the required amount back — no external protocol involved. Full round-trip proven on devnet.

---

## Quick developer start

```bash
cd noviscia-protocal
npm install
cd app/web && npm install && cd ../..

# Build all programs
anchor build

# Deploy to devnet (requires ~/.config/solana/new-id.json with SOL)
anchor deploy --provider.cluster devnet --provider.wallet ~/.config/solana/new-id.json

# Upload IDLs
npm run idl:upload-devnet

# Start web app
cd app/web && npm run dev
```

> **Deploy note:** If the new binary exceeds allocated space, extend first: `solana program extend <PROGRAM_ID> 10240 --keypair ~/.config/solana/new-id.json`

### Migration scripts

After redeploying escrow, run the permissionless account migration to expand on-chain EscrowAccounts to the latest SPACE:

```bash
npx tsx scripts/migrate-escrow-account-v5-devnet.ts
```

Other scripts in `scripts/`:
- `migrate-vault-config-omnipool-devnet.ts` — migrate vault config to omnipool layout
- `migrate-vault-config-utilization-devnet.ts` — migrate vault config utilization fields
- `migrate-user-state-clearing-cascade-devnet.ts` — migrate user state for clearing cascade

---

## Token economics

### NVSC — governance & utility

| Property | Value |
|----------|-------|
| Supply | 1,000,000,000 fixed |
| Utility | Governance, fee tiers, staking fee share |
| Staking tiers | Bronze 100 · Silver 1K · Gold 10K · Platinum 100K NVSC |

**Planned distribution** (subject to change pre-TGE):

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
| Perp trading fees | 40% burn engine · 60% staking pool |
| Escrow lend yield | 85% user · 15% burn engine |
| Vault NAV yield (Omni-Pool) | Accrues 100% to nvscUSDC NAV |
| Idle margin yield (fee_index) | 100% user via `claim_idle_yield` |

---

## Roadmap

| Phase | Milestones | Target |
|-------|------------|--------|
| **Now (devnet beta)** | All programs live, Sovereign Omni-Pool, multi-asset collateral, sub-accounts, idle yield, Collateral Console + Analytics UI | Live |
| **Q2–Q3 2026** | Security audit, mainnet program IDs locked, NVSC TGE, deposit caps | In progress |
| **Q3 2026** | Mainnet soft launch, SOL/BTC/ETH perps, production Pyth feeds | Planned |
| **Q4 2026+** | Expanded market catalog (18 markets), mSOL/jitoSOL collateral (mainnet mints), mobile PWA, session trading agents | Planned |

---

## Security

- Non-custodial PDAs — no pooled custodial wallet; users sign every action.
- Dual-oracle consensus — Pyth + Switchboard; on-chain deviation checks; permissionless liquidation.
- Three-tier safety: user collateral → insurance fund (per-asset pools) → socialized LP haircut.
- Permissionless cranks — oracle marks, lending, liquidations, burns need no trusted operator.
- **Pre-mainnet audit required — not yet completed.**

See [`docs/SECURITY.md`](noviscia-protocal/docs/SECURITY.md) and [`docs/LEGAL.md`](noviscia-protocal/docs/LEGAL.md).

---

## Repository layout

```
noviscia-protocal/
├── programs/
│   ├── escrow/               USDC margin, idle yield, multi-asset collateral, sub-accounts
│   ├── nv-usdc-vault/        Sovereign Omni-Pool, fee_index accrual
│   ├── position-tracker/     Perp engine, oracle, liquidation, AMM/JIT
│   ├── lending-integrator/   Multi-venue pools
│   ├── staking-manager/      NVSC tiers, governance
│   ├── burn-engine/          Fee accumulation, NVSC buyback & burn
│   ├── yield-distributor/    Lend yield 85/15 split
│   ├── liquidation-vault/    Per-asset insurance funds
│   ├── token-nvsc/           Fixed-supply NVSC mint
│   └── prediction-market/    On-chain prediction markets
├── app/web/                  Next.js 14 PWA frontend
│   └── app/
│       ├── trade/perps/      Perps trading terminal
│       ├── trade/collateral/ Collateral Console (multi-asset capital management)
│       ├── analytics/        Protocol Analytics dashboard
│       ├── earn/vault/       nvscUSDC vault UI
│       └── earn/stake/       NVSC staking UI
├── scripts/                  Devnet migration + admin scripts
└── docs/                     Protocol documentation
```

---

## Links

| Resource | URL |
|----------|-----|
| Live app | https://noviscia.com |
| Whitepaper | [`docs/WHITEPAPER.md`](noviscia-protocal/docs/WHITEPAPER.md) |
| Architecture | [`docs/ARCHITECTURE_V2.md`](noviscia-protocal/docs/ARCHITECTURE_V2.md) |
| Devnet runbook | [`docs/DEVNET.md`](noviscia-protocal/docs/DEVNET.md) |
| User guide | [`docs/USER_GUIDE.md`](noviscia-protocal/docs/USER_GUIDE.md) |
| Discord | https://discord.gg/Noviscia-protocol |
| Twitter | https://twitter.com/noviscia |

---

© 2026 Noviscia Protocol. Devnet beta — not for production use.
