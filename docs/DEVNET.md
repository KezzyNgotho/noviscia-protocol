# Devnet Runbook — Noviscia Protocol

**Last updated:** September 6, 2026
**Network:** Solana devnet
**Deployer wallet:** `pm2tUw22SDofzdfmyJv3jRDhLagwiqYRmCG2BWN23NA`
**Keypair path:** `~/.config/solana/new-id.json`

---

## Program IDs (devnet, current)

| Program | ID |
|---------|----|
| `position_tracker` | `6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws` |
| `nv_usdc_vault` | `CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC` |
| `staking_manager` | `HjxcKV51A7jxE2iqMCDY7EvWFL9XsheuM43DamWGabqb` |
| `yield_distributor` | `CrN1o75FGwcSo6ted7eKxw2kYgkaXDVeWmUaTZCTsLtw` |
| `liquidation_vault` | `Cwma3FfMKhoLkgfrGYgErVPoFWEtHpx7DNc4wArpRHBz` |
| `token_nvsc` | `HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT` |
| `netting_engine` | `68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56` |
| `yield_router` | `FKaAPPid8B6hUme4w8bFCDzmvE6DpekXpeiR1sgyLwB4` |
| `clearing_registry` | `Hg5QvSsnb22gHexUTnvvfff3EJZxWnsFKRM8bZ8n7Jmo` |
| `jit_risk` | `3w9GrHBXpMNSc3P3kBWmHwkhEr1u5FBQrTiD4k3NAXwh` |
| `sovereign_netting` | `9YxL2Gk3cphCjxeKgfj2cnY4wCBDzej3L83jLGJ52Dyk` |
| `ve_nvs` | `ACJRBrD3h7RHP9UWWffv7Hw8SLFeeJHAH5P31eHnwj5j` |
| `gateway_auction` | `HQ26VTfoBVmGFY1JsFp5HmMT3rjLNoLJH6zurm8TL9xR` |
| `noviscia_credit_line` | `8usJu6agjifCXYwSsRVoMWqm22h2HUSfebw1zEEHAMYg` |
| `noviscia_clearing` | `GtTJWLa6MXjZoNucGHWVnE9LpZTw6Dsr5K1gxpM1Q4fe` |
| `noviscia_permissioned_pool` | `BNLwfHfWyuPoDVs7LeX6vAep33k7fzhiTiYzW9Th5u2v` |
| `noviscia_capacity` | `EDBr2VFWweFDzKR4cTT5j3TPGvPd9imoP8F76YK1o9oe` |
| `noviscia_tranche_vault` | `9Sk1zLo7uprmtrskoZQS6zf1KFSNv4uTCxMsbqGVMCMb` |
| `noviscia_asset_engine` | `5qpohgfMvV89oRJqcV7MrBxJJ95i7TgZ9VvUNdyZrMKb` |

> **Parked / not live** (in `programs/cluster-4-governance/` — deferred, not deployed as live): `bug-bounty`, `burn-engine`, `escrow`, `protocol-lp-vault`, `spot-dex`. The deleted programs `cross-border` and `tbill-fund` (and the deleted services `liquidation-keeper`, `risk-engine`, `ai-rebalancer`, `mock-pyth-receiver`) are gone from the codebase and are **not** part of the current state.

**Key devnet mints:**
| Token | Mint |
|-------|------|
| USDC (devnet) | `Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5` |
| nvscUSDC | `2TmaUey4Hh2om1kFR77Vw1RDh8H69qcW6UAACVidJeVk` |
| NVSC | `4BXiDT5o9J6aQdJNd36QE1L2YvQqedEKSP1wuQdSgJkg` |

---

## What is live on devnet

| Feature | Status | Notes |
|---------|--------|-------|
| One balance sheet (`nv-usdc-vault` omni-pool, mints `nvscUSDC`) | **Live** | Single pooled collateral — the sole balance sheet for both engines |
| CCP core (clearing/netting/risk) | **Live** | `noviscia-clearing`, `netting-engine` (sovereign-netting), `jit-risk`, `clearing-registry` |
| JIT Pyth pull-oracle perps | **Live** | 22 registered markets (BTC, ETH, SOL, DOGE, LINK, AVAX, RENDER, WIF, JUP, RAY, TRUMP, PNUT, BONK, PEPE, OP, ARB, PYTH, JTO, ORCA, POPCAT, MEW, HNT) |
| Live-NAV margin (collateral = locked nvscUSDC shares, never redeemed while open) | **Live** | "Simultaneous Double-Yield" — see root `README.md` |
| Peer-to-peer funding settlement | **Live** | Verified exact against a hand-computed expectation, 2026-07-06 |
| Trading fees (open + close → vault NAV) | **Live** | Verified via NAV-per-share delta, 2026-07-06 |
| Closed-loop liquidation (20%/80% split) | **Live** | Permissionless — no keeper network |
| Insurance-fund backstop (10% of the 80%) | **Live** | Verified live via a real liquidation, 2026-07-06 |
| Take-profit / stop-loss, resting limit orders | **Live** | `/trade/triggers` |
| Any-collateral trading (Jupiter swap → margin) | **Wired, mainnet-only** | Devnet has no Jupiter liquidity to route through |
| nvscUSDC vault deposit / withdraw | **Live** | |
| NVSC staking tiers + veNVSC | **Live** | `staking-manager`, `ve-nvs` |
| TVV yield engine (idle pooled capital → slot-scoped contingent capacity, 15–35% APY) | **Live** | `yield-router`, `yield-distributor`, `nv-usdc-vault` |
| Revenue engines 1–3 (feed omni-pool NAV) | **Live** | `sovereign-netting` (`NettingRentPaid`), `gateway-auction` (`AuctionSettled` premium tips), `jit-risk` (`SliceRented`/`PremiumSwept`) — indexer tracks all |
| Protocol analytics | **Live** | `/analytics`, `/api/protocol/metrics`, `/api/protocol/solvency` |
| Institutional capacity credit line (asset engine, folded into `noviscia-capacity` host) | **Live** — window open | $6M `C_sys` credit line at `AifRX9…cw5`; 24h floating window opened 2026-09-06 at slot 494190470 via a real `asset_allocate_capacity` onto the wSOL pool (real token flow, premium accrued). Posture `Open`; freeze being proven by observer at ≈ 24h/26h (see `scripts/devnet/observe-capacity-window-devnet.ts`) |
| NVSC TGE / mainnet | **Q1 2027** | |

---

## Standard deploy flow

```bash
cd noviscia-protocal

# 1. Build (builds every program in the workspace)
anchor build

# 2. Check deployer balance
solana balance pm2tUw22SDofzdfmyJv3jRDhLagwiqYRmCG2BWN23NA --url devnet

# 3. Extend program space if the binary grew (safe to run even if unsure —
#    a no-op if the account is already large enough)
solana program extend 6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws 10240 \
  --keypair ~/.config/solana/new-id.json --url devnet

# 4. Deploy (upgrade in place — same program ID)
solana program deploy target/deploy/position_tracker.so \
  --program-id target/deploy/position_tracker-keypair.json --url devnet

# 5. Copy the fresh IDL to the web app
cp target/idl/position_tracker.json app/web/app/idl/position_tracker.json
```

Repeat steps 3–5 per-program (substitute `nv_usdc_vault`, `netting_engine`, etc.) — only redeploy what actually changed; program IDs stay fixed across upgrades.

> **Migration note:** `position-tracker`'s `Market` account has grown across several migrations (`SPACE_V1` → `SPACE_V2` → current, appending `funding_index`/OI/insurance/`trading_fee_bps`). A market registered under an older layout needs `resize_market` run once before any instruction that does typed deserialization against the current struct will work. See `scripts/resize-markets-devnet.ts`.

---

## Recovering SOL from stranded buffers

Failed deploys leave upload buffers open. Reclaim the SOL:

```bash
solana program show --buffers --keypair ~/.config/solana/new-id.json --url devnet
solana program close <BUFFER_ADDRESS> --keypair ~/.config/solana/new-id.json --url devnet
```

---

## RPC requirements

Use a premium devnet RPC (Helius/Ankr/Alchemy), not the public `api.devnet.solana.com`, for the web app — the public endpoint rate-limits aggressively and its `signatureSubscribe` WS support is unreliable, which can surface as a false "stale oracle" error in the UI even when the oracle payload is genuinely fresh.

```
NEXT_PUBLIC_SOLANA_RPC=<your premium devnet RPC URL>
NEXT_PUBLIC_SOLANA_RPC_URL=<same value — code checks both names>
```

Separately: Node's `fetch` (undici) has been observed to intermittently fail with `ETIMEDOUT` against Hermes/RPC endpoints in some sandboxed environments via IPv6 Happy Eyeballs, even when `curl` to the same host succeeds instantly. This is a local networking quirk, not a real outage — devnet e2e scripts wrap external fetches in a small retry helper (`fetchRetry`) for exactly this reason; do the same in any new script that hits an external HTTP endpoint in a loop.

---

## Troubleshooting

### "Error: invalid program argument" on deploy

New binary exceeds allocated account space. Fix:

```bash
solana program extend <PROGRAM_ID> 10240 --keypair ~/.config/solana/new-id.json --url devnet
```

Then retry deploy.

### "Program's authority does not match authority provided"

Wrong keypair. Always pass `--keypair ~/.config/solana/new-id.json` (or `--provider.wallet` for `anchor deploy`) explicitly. The deployer/upgrade authority is `pm2tUw22SDofzdfmyJv3jRDhLagwiqYRmCG2BWN23NA`, not the default `~/.config/solana/id.json`.

### `InstructionError` with a `Custom` code you don't recognize

Anchor custom errors are `6000 + <enum index>` in `PositionError`'s declaration order (`state.rs`). E.g. `Custom(6005)` = the 6th declared variant = `InsufficientMargin`. Don't guess from the number alone — count the enum, or check `app/web/app/lib/position-tracker/jitOracle.ts`'s `POSITION_ERROR_MESSAGES` map, which mirrors it.

### "Allocate: account ... already in use" on `open_position_jit`

Not a bug — a position PDA is `[b"position", trader, market, sub_id]` and there is no increase-position instruction. This fires when a position is already open on that exact (trader, market, sub_id) tuple. The frontend guards against this client-side (`hasOpenPosition` in `TradeFormPanel`); devnet scripts should check `connection.getAccountInfo(position)` before attempting to open.

### Oracle / price-update transaction fails silently or with `OracleStale` (6006)

The on-chain freshness ceiling is a strict ≤30 seconds between the Hermes VAA's timestamp and execution. A retry with a freshly-fetched price is the correct, expected recovery — not a sign of a broken oracle. `sendJitInstructionWithRetry` (frontend) and every `e2e-*-devnet.ts` script already retry on this specific condition; don't retry on other error codes, they're deterministic (see the error-code note above).

### "Account not found" on IDL operations

The on-chain IDL metadata account is stale/absent. The web app reads local `app/web/app/idl/*.json` files — not the on-chain IDL account. Ignore this error unless debugging the anchor CLI directly.

### Bulk write transactions failing (rate limiting)

Public devnet RPC rate-limits bulk writes. Add a delay between transactions in scripts, or switch to a premium RPC (see RPC requirements above).

---

## Permissionless cranks

No trusted operator is required for core perps operation:

| Crank | Instruction |
|-------|-------------|
| Funding settlement | `settle_funding` on `position-tracker` (rate-limited — see `FundingSettleTooSoon`) |
| Liquidation | `liquidate` on `position-tracker` — any signer, including the position owner |
| Limit-order fill | `execute_limit_order` on `position-tracker` |
| TP/SL execution | `execute_tp_sl` on `position-tracker` |
| Yield distribution | `distribute_yield` on `yield-distributor` |
| Revenue sweeps | `sweep_netting_rent` (sovereign-netting), `settle`/premium sweeps (gateway-auction, jit-risk) — feed omni-pool NAV |

---

## Environment variables (web app)

See [`app/web/.env.example`](../app/web/.env.example) — it's the maintained source of truth, with inline comments on what's required vs. optional and what's Vercel-server-only vs. browser-public. Highlights:

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_SOLANA_RPC` / `NEXT_PUBLIC_SOLANA_RPC_URL` | Yes | Code checks both names; falls back to public devnet RPC if unset (not recommended — see RPC requirements) |
| `NEXT_PUBLIC_JUPITER_API_KEY` | Recommended | Any-collateral swap routing (mainnet-only functionally, but required for the code path to initialize) |
| `HELIUS_API_KEY` / `HELIUS_RPC_URL` | Recommended | Premium RPC endpoint + integrations |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | Recommended | Without it, WalletConnect wallets can't connect |
| `NEXT_PUBLIC_POSITION_TRACKER_PROGRAM_ID` etc. | No | Hardcoded fallbacks in `app/lib/programs.ts` already match current devnet deployment |

`.env`/`.env.local` are gitignored by design — real values only exist locally or in Vercel's dashboard, never in git history.

---

## Asset engine cap-wiring

The `noviscia_asset_engine` handlers were folded into the `noviscia_capacity` host
(`EDBr2VFWweFDzKR4cTT5j3TPGvPd9imoP8F76YK1o9oe`) — the institutional asset-lifecycle engine
(per-asset `AssetPool` vaults, aggregate credit lines, three-tier RBAC). **Host is deployed and
cap-wired on devnet** (Sep 6 2026 — original keypair `JDsM18…` lost, host redeployed at
`EDBr2VFW…`; .so hash `011f6882…e9`, 892,416 B): owner
`BPFLoaderUpgradeab1e11111111111111111111111`, upgrade authority = deployer
(`pm2tUw22SDofzdfmyJv3jRDhLagwiqYRmCG2BWN23NA`). The program keypair that must match the
canonical ID lives at `target/deploy/noviscia_capacity-keypair.json` (gitignored, never
committed) — the binary's `declare_id!` anchors every PDA it creates to `EDBr2VFW…`. The
credential/upgrade keypair is backed up at `~/.config/solana/program-ids/noviscia-capacity-program.json`.

Re-deploy / upgrade after a source change (fees paid by `~/.config/solana/new-id.json`):

```bash
cargo build-sbf --manifest-path programs/cluster-2-tvv-gate/noviscia-capacity/Cargo.toml
cp target/sbf-solana-solana/release/noviscia_capacity.so target/deploy/
anchor deploy --program-name noviscia_capacity
```

The derived caps from the Quantified Risk Pack & Economics module (reference `$10,000,000` pool)
are provisioned with a single idempotent script (re-runs fill only real gaps — registry, credit
line, and pools all re-read from chain):

```bash
npx tsx scripts/e2e/e2e-asset-engine-capwire-devnet.ts             # dry-run (prints plan, sends nothing)
npx tsx scripts/e2e/e2e-asset-engine-capwire-devnet.ts --apply      # cold-start provision + wire caps
```

What it does, in order (every step re-reads on-chain state so a re-run only fills real gaps):

| Step | Instruction | Tier | Value |
|------|-------------|------|-------|
| A | `initialize` (pins wSOL/USDC/NVSC + three-tier keys; cold-start = deployer) | Tier 3 | registry |
| B | `register_asset` wSOL/USDC/NVSC with `max_capacity` = raw desk cap | Tier 3 | per-asset |
| C | `set_asset_support` × 3 | Tier 2 | true |
| D | `initialize_credit_line` + `update_credit_limit` = `C_sys` | Tier 2 | `$6,000,000` |
| E | `update_asset_params` per-mint `max_capacity` = `C_desk` | Tier 2 | `$1,500,000` |

Derived cap table (60% systemic / 15% desk of the `$10M` reference pool — see
`docs/QUANTIFIED_RISK_PACK.md`): `C_sys` = `$6,000,000.00` (`systemicCapUsdCents`), `C_desk` =
`$1,500,000.00` (`deskCapUsdCents`). Caps are stored on-chain in **raw token units**, so the desk
cap converts at a documented price basis (defaults: USDC `$1.00`, wSOL `$150.00`, NVSC `$1.00`)
→ `max_capacity` = `1,500,000` USDC / `10,000` wSOL / `1,500,000` NVSC, and the aggregate credit
line = `6,000,000,000,000` raw USDC (6-dec).

**Live window status:** the credit line at
`AifRX9brGfJmJpDcBDtpf4bbkNM65pCBYXHkrVAWPcw5` holds `total` = `6,000,000,000,000` raw, and a
real 24h floating window was opened 2026-09-06 via `asset_allocate_capacity` (slot 494190463,
premium 240,000 raw; `window_start_slot` = 494190470) onto the wSOL pool (`9v12r3KZbFpN6gdC3n482MkWEzYGwfGYjK1v7aCAPxdh`,
desk_position `HevKzcRDfiCnheXhzHFsZ4ktHB5HjwGvohvayydNivxD`). Posture confirmed `Open` on
devnet; the deterministic `OverdueSlots`/`Breached` freeze (~+216k/+234k slots, ≈ 24h/26h) is
proven by the observer at `scripts/devnet/observe-capacity-window-devnet.ts` (writes
`devnet-window-observation.json`). Do not re-initialize the credit line — an init would recreate
the seed/bump issue documented in the code (`bump = credit_line.bump` → plain `bump` fix).

Signer resolution and overrides:

- Deployer/admin keypair: `ADMIN_KEYPAIR_PATH` → `ANCHOR_WALLET` → `~/.config/solana/new-id.json`
  (`pm2tUw22SDofzdfmyJv3jRDhLagwiqYRmCG2BWN23NA`).
- Desk institution (defaults to the deployer in cold start; set `AE_INSTITUTION_KEYPAIR_PATH` to
  provision a distinct desk as the credit-line holder).
- `SOLANA_RPC_DEVNET` to point at a premium RPC (see RPC requirements above).
- Price basis is a committee assumption and is printed loudly before any send — audit it before
  `--apply` against a live pool.

---

## Verifying a deployment

```bash
# 1. Check the program deployed correctly
solana program show 6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws --url devnet

# 2. Check a market account decodes at the expected size (269 bytes — current
#    V10 layout; bump this note if Market grows again)
solana account $(npx tsx -e "
  const { PublicKey } = require('@solana/web3.js');
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), Buffer.from('ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d', 'hex')],
    new PublicKey('6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws')
  );
  console.log(pda.toBase58());
") --url devnet

# 3. Run an e2e proof script rather than testing through the UI first —
#    each one in scripts/e2e/e2e-*-devnet.ts exercises the real on-chain
#    instruction path end-to-end and reports exact before/after numbers.
npx tsx scripts/e2e/e2e-jit-open-close-devnet.ts
```

---

## Local Development Setup

### Prerequisites

**macOS:**
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node@20
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.31.1 && avm use 0.31.1
```

**Ubuntu/Debian:**
```bash
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.31.1 && avm use 0.31.1
```

Anchor version pinned via `Anchor.toml`'s `[toolchain]` section — use `0.31.1` to match exactly.

### Quick Start

```bash
git clone <this repo>
cd noviscia-protocal
npm install
cd app/web && npm install && cd ../..
cp app/web/.env.example app/web/.env.local
# Edit .env.local — set NEXT_PUBLIC_SOLANA_RPC to a premium devnet RPC
cd app/web && npm run dev
```

That's the whole local dev loop — no database, no separate API server, no Docker required.

### Testing

```bash
cargo test                    # Program tests
cd app/web && npx tsc --noEmit  # Frontend type-check
npx tsx scripts/e2e/e2e-jit-open-close-devnet.ts  # E2E on devnet
```

### Optional Services

| Service | Purpose |
|---------|---------|
| `services/indexer` | Persistent fills/positions/order history + revenue/protocol indexer (port 8092) |
| `services/price-feed` | Price feed relay |
| `services/websocket` | Realtime ingest |
| `services/ai-orchestrator` | Optional local AI layer |
| `services/netting-relayer` | Permissionless crank — keeps netting margin floors + default-fund target live |

Each has its own `Dockerfile` and `package.json`. None are required for core perps trading.
