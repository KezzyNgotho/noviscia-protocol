# Noviscia Protocol

**Perpetuals on Solana where margin never sits idle** — the same nvscUSDC shares that back your leveraged position keep earning protocol yield the entire time they're locked as collateral.

| | |
|---|---|
| **Status** | Devnet beta live · Mainnet target Q3 2026 (post-audit) |
| **App** | [noviscia.com](https://noviscia.com) |
| **Docs** | [`docs/`](noviscia-protocal/docs/) |
| **Contact** | [Discord](https://discord.gg/Noviscia-protocol) · ngothokezz18@gmail.com |

> **Disclaimer:** Devnet software for testing only. Not financial advice, not an offer of securities, not a commitment to future features. Parameters may change before mainnet.

---

## Executive summary

Noviscia is a non-custodial perpetual DEX on Solana. Margin is posted as **nvscUSDC** — a share of a single protocol-owned vault (`nv-usdc-vault`) whose NAV-per-share compounds continuously from trading fees and liquidation penalties. Opening a position **locks those shares, it never redeems them** — so the same capital is simultaneously backing your leverage and earning yield ("Simultaneous Double-Yield"), for as long as the position stays open.

Prices are verified on-chain per-instruction via a **JIT (just-in-time) Pyth pull-oracle**: every open/close/liquidate/TP-SL call carries a fresh guardian-signed Hermes price update, verified against a strict 3-second freshness ceiling in the same transaction — there is no continuously-updated on-chain price feed or off-chain keeper network to trust.

**Dual-token model:**
- **nvscUSDC** — yield-bearing vault share; earns NAV from real trading-fee and liquidation revenue; used directly as perp margin.
- **NVSC** — fixed 1B governance token; fee tiers, fee share, staking.

---

## What's live on devnet (July 2026)

| Feature | Status |
|---------|--------|
| JIT Pyth pull-oracle perps (open / close / liquidate / TP-SL, all price-verified per-instruction) | **Live** |
| Live-NAV margin — collateral is nvscUSDC shares, valued against the vault's real-time NAV, never redeemed while a position is open | **Live** |
| Closed-loop liquidation — permissionless, no keeper network; 20% caller bounty / 80% protocol-retained, entirely within Noviscia's own programs | **Live** |
| Insurance-fund backstop — 10% of every liquidation's protocol-retained share funds a real, physically-held per-market reserve | **Live** |
| Peer-to-peer funding settlement — OI-skew-driven funding index, settled into realized PnL at close/liquidate/TP-SL | **Live** |
| Trading fees on open + close, swept into vault NAV as a second real yield source | **Live** |
| Take-profit / stop-loss at open, or set later; permissionless execution | **Live** |
| Resting limit orders + Triggers board (`/trade/triggers`) | **Live** |
| Any-collateral trading — deposit or open directly with SOL / any SPL token, swapped via Jupiter into margin in one flow | **Wired; mainnet-only** (devnet has no Jupiter liquidity to route through) |
| nvscUSDC vault deposit / withdraw | **Live** |
| Collateral Console UI (`/trade/collateral`) | **Live** |
| Analytics dashboard UI (`/analytics`) | **Live** |
| NVSC staking tiers + governance | **Live** |
| Prediction markets | **Beta** |
| NVSC TGE, mainnet launch | **Q3 2026** |

---

## Architecture overview

```
Trader's wallet (USDC, or any SPL asset)
  → [non-USDC only] Jupiter swap → USDC
  → nv-usdc-vault: deposit_usdc → mints nvscUSDC shares (NAV = total_assets / total_shares)
  → position-tracker: open_position_jit
        - verifies a fresh Pyth Hermes price update on-chain (JIT, ≤3s old)
        - locks nvscUSDC shares as collateral (shares stay live — never redeemed)
        - charges a trading fee, swept into nv-usdc-vault (yield source #1)
  → position open. Locked shares keep compounding NAV like any other holder's.
  → close_position / liquidate / execute_tp_sl:
        - re-verifies a fresh JIT price
        - folds peer-to-peer funding (OI-skew-driven) into realized PnL
        - on liquidation: 20% bounty to caller, 80% retained —
          10% of that into a per-market insurance fund, the rest into vault NAV (yield source #2)
```

No AMM, no order-matching engine, no off-chain keeper, no external lending venue sits in this loop — every step above is a direct instruction on `position-tracker` or a CPI into `nv-usdc-vault`.

### Programs & devnet IDs

| Program | Devnet ID |
|---------|-----------|
| `position_tracker` | `3zGRWKZq4V3npHbH9Lati46BwgmstTjynWZFFMxarQgY` |
| `nv_usdc_vault` | `CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC` |
| `protocol_lp_vault` | `BJVr4bWdNkaUNff3Se6Wob2edPoc64dAaW3Gkgtf4AgT` |
| `escrow` | `CTmCryJca9cFyMRaGdzrhyZeEnjdGLD8ZkEqNcNbvh2D` (legacy lending/yield surface — not part of the perps margin path above) |
| `burn_engine` | `nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id` |
| `staking_manager` | `4VDQjH73DiE3zYt66ukyWY7KMMJrxHUZfjkxRHTPDG75` |
| `yield_distributor` | `CrN1o75FGwcSo6ted7eKxw2kYgkaXDVeWmUaTZCTsLtw` |
| `liquidation_vault` | `C5mvuPTN7KHQ1NsXSUcD2tEae9fL1pLrNkZD67jRRuf1` |
| `prediction_market` | `3BTcArdsxKhzF2Msjm3JLy343v6ZvQjPusq3V2zRNbpv` |
| `token_nvsc` | `HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT` |

> `lending_integrator` has been removed from the codebase entirely (deleted, not just deprecated).

**Devnet markets registered on `position_tracker`:** SOL, BTC, ETH (each 50x max leverage, 1% maintenance margin — corrected on ETH 2026-07-06, see [`docs/DEVNET.md`](noviscia-protocal/docs/DEVNET.md)). 13 additional catalog markets exist in the frontend's market list as previews, not yet registered on-chain.

**Devnet mints:** USDC `Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5` · nvscUSDC `2TmaUey4Hh2om1kFR77Vw1RDh8H69qcW6UAACVidJeVk` · NVSC `HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT`

**Deployer:** `pm2tUw22SDofzdfmyJv3jRDhLagwiqYRmCG2BWN23NA` · keypair at `~/.config/solana/new-id.json`

---

## Key mechanisms

### Simultaneous Double-Yield

`Position.collateral_shares` are nvscUSDC shares transferred into a per-position `collateral_vault` token account at open time — they are **never redeemed** while the position is open. Since a share's redeemable value is `shares × (vault.total_assets / vault.total_shares)`, and `total_assets` grows continuously from every trader's fees and every liquidation's retained penalty, locked margin appreciates at exactly the same rate as an un-locked vault depositor's — the whole time it's backing your leverage.

### JIT Pyth pull-oracle

There is no on-chain price account that updates itself. Every price-sensitive instruction (`open_position_jit`, `close_position`, `liquidate`, `execute_tp_sl`) takes a guardian-signed Wormhole VAA wrapping a Pyth Hermes price update, verifies it via the Pyth Receiver program's `post_update_atomic` in the same transaction, and enforces a strict ≤3-second freshness ceiling before trusting it. A retry (fresh price + a new wallet approval) is a normal occurrence when that window races real network latency, not a bug.

### Peer-to-peer funding

`Market.funding_index` is a per-notional-dollar cumulative rate that moves only via the permissionless `settle_funding` instruction, as a pure function of `long_oi_usdc` vs `short_oi_usdc` — never dependent on an external price. Each position snapshots the index at entry (`entry_funding_index`) and settles the delta against it at close/liquidate/TP-SL time, folded directly into the same realized-PnL number that flows through `settlement_vault`. No separate funding pool, no keeper.

### Closed-loop liquidation + insurance fund

Liquidation is permissionless — any signer (including the position's own owner) can call it once equity drops below the maintenance margin threshold. The entire remaining collateral is forfeit: 20% goes to whoever called it, paid directly in live nvscUSDC shares (no redemption, no slippage); of the remaining 80%, 10% is retained as a real, physically-held per-market insurance reserve (`Market.insurance_fund_usdc`) and the rest boosts vault NAV for every remaining holder.

### Any-collateral trading

Depositing or opening a position with SOL, another market's base asset, or any pasted SPL mint runs a Jupiter swap into USDC, mints nvscUSDC shares, and (when opening) feeds the real swap output straight into `open_position_jit` as margin — chained behind a single UI action. This needs live Jupiter routing, so it only settles on mainnet; devnet testing is limited to USDC/nvscUSDC margin.

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

### Devnet e2e proof scripts

Every perps mechanic above has a corresponding live-devnet proof script under `scripts/` — each runs against the real deployed program with real (small) devnet funds, not a mock:

- `e2e-jit-open-close-devnet.ts` — open/close + trading-fee NAV proof
- `e2e-tp-sl-devnet.ts` — take-profit / stop-loss execution
- `e2e-limit-order-devnet.ts` — resting limit order placement + fill
- `e2e-funding-devnet.ts` — peer-to-peer funding settlement, verified exact against a hand-computed expectation
- `e2e-liquidation-devnet.ts` / `e2e-liquidation-eth-devnet.ts` — liquidation split + insurance-fund carve-out

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

### Fee & yield flows (perps)

| Source | Split |
|--------|-------|
| Perp trading fees (open + close) | 100% → nv-usdc-vault NAV |
| Liquidation penalty (100% of remaining collateral) | 20% liquidator bounty · 80% retained (10% of that → insurance fund, rest → vault NAV) |
| Peer-to-peer funding | 100% redistributed between longs/shorts — not protocol revenue |

See [`docs/TOKENOMICS.md`](noviscia-protocal/docs/TOKENOMICS.md) for the broader NVSC/burn-engine flow (not re-verified this cycle — perps-specific flows above are current as of 2026-07-06).

---

## Roadmap

| Phase | Milestones | Target |
|-------|------------|--------|
| **Now (devnet beta)** | JIT-oracle perps engine, live-NAV margin, funding + insurance fund, any-collateral trading, Collateral Console + Analytics UI | Live |
| **Q2–Q3 2026** | Security audit, mainnet program IDs locked, NVSC TGE, deposit caps | In progress |
| **Q3 2026** | Mainnet soft launch, SOL/BTC/ETH perps, production Pyth feeds, Jupiter-routed any-collateral trading | Planned |
| **Q4 2026+** | Expanded market catalog (16 markets), mobile PWA | Planned |

---

## Security

- Non-custodial PDAs — no pooled custodial wallet; users sign every action.
- JIT Pyth pull-oracle with a strict on-chain freshness ceiling — no stale-price attack surface from a lazily-updated feed.
- Three-tier safety: user collateral → per-market insurance fund → vault NAV absorbs any remainder.
- Permissionless liquidation and funding settlement — no trusted keeper required for core perps operation.
- Market risk parameters (`max_leverage_bps`, `maintenance_margin_bps`) are validated on-chain against a hard invariant (initial margin at max leverage must exceed maintenance margin) as of 2026-07-06, after a live misconfiguration on the ETH market was found and fixed.
- **Pre-mainnet audit required — not yet completed.**

See [`docs/SECURITY.md`](noviscia-protocal/docs/SECURITY.md) and [`docs/LEGAL.md`](noviscia-protocal/docs/LEGAL.md).

---

## Repository layout

```
noviscia-protocal/
├── programs/
│   ├── position-tracker/     Perp engine — JIT oracle, live-NAV margin, funding, liquidation
│   ├── nv-usdc-vault/        Single share-based USDC vault (nvscUSDC), NAV accrual
│   ├── protocol-lp-vault/    Trading-fee-backed LP vault
│   ├── escrow/                Legacy lending/yield surface (not part of the perps margin path)
│   ├── staking-manager/      NVSC tiers, governance
│   ├── burn-engine/          Fee accumulation, NVSC buyback & burn
│   ├── yield-distributor/    Lend yield split
│   ├── liquidation-vault/    Per-asset insurance funds (legacy — perps now uses its own per-market fund)
│   ├── token-nvsc/           Fixed-supply NVSC mint
│   └── prediction_market/    On-chain prediction markets
├── app/web/                  Next.js 14 PWA frontend
│   └── app/
│       ├── trade/perps/      Perps trading terminal
│       ├── trade/triggers/   Limit-order Triggers board
│       ├── trade/collateral/ Collateral Console
│       ├── analytics/        Protocol Analytics dashboard
│       ├── earn/vault/       nvscUSDC vault UI
│       └── earn/stake/       NVSC staking UI
├── scripts/                  Devnet migration, admin, and e2e proof scripts
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
