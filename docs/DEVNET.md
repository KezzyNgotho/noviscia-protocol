# Devnet Runbook — Noviscia Protocol

**Last updated:** July 6, 2026
**Network:** Solana devnet
**Deployer wallet:** `pm2tUw22SDofzdfmyJv3jRDhLagwiqYRmCG2BWN23NA`
**Keypair path:** `~/.config/solana/new-id.json`

---

## Program IDs (devnet, current)

| Program | ID |
|---------|----|
| `position_tracker` | `3zGRWKZq4V3npHbH9Lati46BwgmstTjynWZFFMxarQgY` |
| `nv_usdc_vault` | `CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC` |
| `protocol_lp_vault` | `2WUt24rRNWsdi8sE56y74b7rJGgKbxSBsu7ntDkGAJkd` |
| `escrow` | `CTmCryJca9cFyMRaGdzrhyZeEnjdGLD8ZkEqNcNbvh2D` (legacy — not part of the perps margin path) |
| `burn_engine` | `nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id` |
| `staking_manager` | `HjxcKV51A7jxE2iqMCDY7EvWFL9XsheuM43DamWGabqb` |
| `yield_distributor` | `CrN1o75FGwcSo6ted7eKxw2kYgkaXDVeWmUaTZCTsLtw` |
| `liquidation_vault` | `Cwma3FfMKhoLkgfrGYgErVPoFWEtHpx7DNc4wArpRHBz` |
| `prediction_market` | `GtTJWLa6MXjZoNucGHWVnE9LpZTw6Dsr5K1gxpM1Q4fe` |

`lending_integrator` has been deleted from the codebase entirely — do not redeploy or reference it.

**Key devnet mints:**
| Token | Mint |
|-------|------|
| USDC (devnet) | `Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5` |
| nvscUSDC | `2TmaUey4Hh2om1kFR77Vw1RDh8H69qcW6UAACVidJeVk` |
| NVSC | `HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT` |

---

## What is live on devnet

| Feature | Status | Notes |
|---------|--------|-------|
| JIT Pyth pull-oracle perps (SOL/BTC/ETH) | **Live** | 3 registered markets, 50x/1% each; 13 more in the frontend catalog as unregistered previews |
| Live-NAV margin (collateral = locked nvscUSDC shares, never redeemed while open) | **Live** | "Simultaneous Double-Yield" — see root `README.md` |
| Peer-to-peer funding settlement | **Live** | Verified exact against a hand-computed expectation, 2026-07-06 |
| Trading fees (open + close → vault NAV) | **Live** | Verified via NAV-per-share delta, 2026-07-06 |
| Closed-loop liquidation (20%/80% split) | **Live** | Permissionless — no keeper network |
| Insurance-fund backstop (10% of the 80%) | **Live** | Verified live via a real liquidation, 2026-07-06 |
| Take-profit / stop-loss, resting limit orders | **Live** | `/trade/triggers` |
| Any-collateral trading (Jupiter swap → margin) | **Wired, mainnet-only** | Devnet has no Jupiter liquidity to route through |
| nvscUSDC vault deposit / withdraw | **Live** | |
| NVSC staking tiers | **Live** | |
| Collateral Console UI | **Live** | `/trade/collateral` |
| Analytics dashboard | **Live** | `/analytics` |
| Prediction markets | **Beta** | |
| NVSC TGE / mainnet | **Q3 2026** | |

Dual-oracle (Pyth + Switchboard), AMM/JIT order matching, and the old escrow-based multi-asset `remaining_accounts` collateral weighting have all been **removed** — `position-tracker` was fully rewritten around the JIT Pyth pull-oracle design above (2026-07-05/06). Switchboard has zero references left in `position-tracker`'s source.

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
solana program extend 3zGRWKZq4V3npHbH9Lati46BwgmstTjynWZFFMxarQgY 10240 \
  --keypair ~/.config/solana/new-id.json --url devnet

# 4. Deploy (upgrade in place — same program ID)
solana program deploy target/deploy/position_tracker.so \
  --program-id target/deploy/position_tracker-keypair.json --url devnet

# 5. Copy the fresh IDL to the web app
cp target/idl/position_tracker.json app/web/app/idl/position_tracker.json
```

Repeat steps 3–5 per-program (substitute `nv_usdc_vault`, `protocol_lp_vault`, etc.) — only redeploy what actually changed; program IDs stay fixed across upgrades.

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

The on-chain freshness ceiling is a strict ≤3 seconds between the Hermes VAA's timestamp and execution. A retry with a freshly-fetched price is the correct, expected recovery — not a sign of a broken oracle. `sendJitInstructionWithRetry` (frontend) and every `e2e-*-devnet.ts` script already retry on this specific condition; don't retry on other error codes, they're deterministic (see the error-code note above).

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
| Burn trigger | `trigger_burn` on `burn-engine` |
| Yield distribution | `distribute_yield` on `yield-distributor` |

---

## Environment variables (web app)

See [`app/web/.env.example`](../app/web/.env.example) — it's the maintained source of truth, with inline comments on what's required vs. optional and what's Vercel-server-only vs. browser-public. Highlights:

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_SOLANA_RPC` / `NEXT_PUBLIC_SOLANA_RPC_URL` | Yes | Code checks both names; falls back to public devnet RPC if unset (not recommended — see RPC requirements) |
| `NEXT_PUBLIC_JUPITER_API_KEY` | Recommended | Any-collateral swap routing (mainnet-only functionally, but required for the code path to initialize) |
| `HELIUS_API_KEY` / `HELIUS_RPC_URL` | Recommended | Phoenix orderbook route + integrations |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | Recommended | Without it, WalletConnect wallets can't connect |
| `NEXT_PUBLIC_POSITION_TRACKER_PROGRAM_ID` etc. | No | Hardcoded fallbacks in `app/lib/programs.ts` already match current devnet deployment |

`.env`/`.env.local` are gitignored by design — real values only exist locally or in Vercel's dashboard, never in git history.

---

## Verifying a deployment

```bash
# 1. Check the program deployed correctly
solana program show 3zGRWKZq4V3npHbH9Lati46BwgmstTjynWZFFMxarQgY --url devnet

# 2. Check a market account decodes at the expected size (124 bytes as of the
#    trading_fee_bps migration — bump this note if Market grows again)
solana account $(npx tsx -e "
  const { PublicKey } = require('@solana/web3.js');
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), Buffer.from('ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d', 'hex')],
    new PublicKey('3zGRWKZq4V3npHbH9Lati46BwgmstTjynWZFFMxarQgY')
  );
  console.log(pda.toBase58());
") --url devnet

# 3. Run an e2e proof script rather than testing through the UI first —
#    each one in scripts/e2e-*-devnet.ts exercises the real on-chain
#    instruction path end-to-end and reports exact before/after numbers.
npx tsx scripts/e2e-jit-open-close-devnet.ts
```
