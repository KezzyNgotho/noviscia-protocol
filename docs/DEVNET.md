# Devnet operations (Noviscia)

Stay on **devnet** until mainnet. This doc maps to the canonical diagrams in [SYSTEM_DIAGRAMS.md](./SYSTEM_DIAGRAMS.md).

## Diagram alignment

### §1 System structure

| Diagram node | Devnet today |
|--------------|--------------|
| `U → W` Web App | Live — perps, vault toggle, recall-before-open |
| `P → O1/O2` Pyth + Switchboard | Live — keeper `oracle.ts` + on-chain `PerpOracleState` |
| `Y → K` Kamino / Solend / Marginfi | **Logical venues** — AI reads live APY; keeper `lend_idle_venue` → 3 venue PDAs |
| `O → KEEPER` | Live — lend, dual oracle push, marks, liquidate |
| `C → E`, `C → LI`, `C → PT` | Live — Escrow, Lending Integrator, Position Tracker |
| `C → YD` Yield Distributor | Live — `distribute_yield` 85% user / 15% burn-engine CPI |
| `C → NV` NVSCUSDC vault | Live — mint/redeem, NAV, cash buffer, `accrue_vault_yield` |
| `C → SM` Governance | Live — NVSC proposals, vote, `execute_proposal` → venue weights |

### §2 Trade flow

| Diagram step | Devnet today |
|--------------|--------------|
| Connect wallet / submit trade | Live |
| Validate price, margin, risk | Live — dual oracle + session policy on open |
| **Recall funds / execute CPI** | Live — `ensureRecallBeforePerpOpen` → `recall_for_trade` / keeper recall |
| Persist + WS broadcast | Partial — on-chain state yes; full API/WS stack optional |

### §3 Yield flow

```text
[Diagram]  Idle Margin → Escrow → Lending Integrator → Kamino|Solend|Marginfi → Yield → Distributor → Users/Burn

[Devnet]   Idle Margin → Escrow → Lending Integrator → venue-pool (0|1|2) → reservoir yield
           Names match diagram; custody is internal until mainnet LEND_MODE_EXTERNAL.
```

| Diagram box | Devnet implementation |
|-------------|------------------------|
| Idle → Escrow | `deposit_usdc`, `deposit_nvusdc`, `reserve_margin` / `reserve_nvusdc_margin` |
| Escrow → Lending Integrator | CPI `deposit_from_escrow` via `lend_idle_venue` |
| → Kamino / Solend / Marginfi | Three `venue-pool` PDAs (not external program CPI) |
| Accrued yield | `supply_apy` + `fund_reservoir` per venue |
| Yield Distributor → 85/15 / burn | Live — `distribute_yield` + vault `accrue_vault_yield`; perp fees → burn/staking |

### §4 Deployment flow

Follow diagram: `anchor build` → deploy programs → update IDs → services → web → health. Use `TMPDIR`/`CARGO_TARGET_DIR` under repo if `/tmp` is full.

### NVSCUSDC margin deposit fails (`vault_config` / simulation)

If Phantom shows **simulation failed** / `AccountOwnedByWrongProgram` on `vault_config`, devnet **escrow** was upgraded before **nv-usdc-vault** and still expects the old vault program id (`GThUX…`) while your vault lives on `CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC`.

Fix (deploy wallet `~/.config/solana/new-id.json`):

```bash
./scripts/upgrade-escrow-devnet.sh
```

Then hard-refresh the web app and retry **Earn → Vault → Margin → NVSCUSDC**.

### Perps: “Account not found / ensure escrow is initialised” (Anchor 2006)

Often **not** a missing escrow — usually:

1. **Open with NVSCUSDC** while position-tracker on devnet is stale → upgrade PT:
   ```bash
   ./scripts/upgrade-position-tracker-devnet.sh
   ```
2. **Close position** fails on fee routing (wrong staking fee vault mint) → web app now uses the pool’s **USDC ATA**; first close may create it (one small SOL tx). Ensure `NEXT_PUBLIC_BURN_VAULT_USDC` points at a real USDC account or leave unset to use the burn-state ATA.

### On-chain IDL (`anchor idl init` / `Failed to initialize IDL`)

Optional for the web UI (it uses `app/web/app/idl/*.json`). If deploy prints this after a **successful** program upgrade, ignore it.

- **`idl init` fails** — an IDL metadata account already exists for the program (`AJ6L6…` on devnet). Use **`anchor idl upgrade`**, not `init`.
- **`idl upgrade` / `idl close` still fail** — devnet has a **stale** metadata account (`AJ6L6…`) that Anchor 1.x / `@solana-program/program-metadata@0.5.1` cannot read or update (`fetch` → “Account not found”). The **program bytecode upgrade is still valid**; only optional explorer/CLI IDL is affected.
- **Web app** — uses `app/web/app/idl/escrow.json`; no on-chain IDL required.
- **Optional (new canonical IDL slot):** `anchor idl init --non-canonical --filepath .cache/cargo-target/idl/escrow.json CTmCryJca9cFyMRaGdzrhyZeEnjdGLD8ZkEqNcNbvh2D` (separate metadata; does not fix `AJ6L6…`).

---

Lending venues on devnet use the **internal yield engine** — real custody and recall, APY from on-chain pools + reservoirs (not Kamino/Solend/Marginfi CPI until mainnet).

## What is “solid” on devnet

| Layer | Status |
|-------|--------|
| Escrow deposit / perp margin | Live |
| `lend_idle_venue` → venue pool vault | Live (3 venues) |
| `recall_funds` / `recall_for_trade` | Live (venue-aware) |
| Yield on recall | Requires `fund_reservoir` per venue |
| AI venue weights | Keeper + optional `SYNC_VENUE_WEIGHTS=true` |
| Perp markets (UI catalog) | `app/web/app/lib/perps/perps-catalog.json` — **3 live** (SOL, BTC, ETH), rest preview |
| Dual oracle + marks | `npm run init:perp-oracles` then keeper cranks **all tradeable** markets |
| Kamino/Solend/Marginfi CPI | **Mainnet later** (`lend_mode = external`) |

## One-time setup

```bash
cd noviscia-protocal
TMPDIR="$PWD/.tmp-build" CARGO_TARGET_DIR="$PWD/target" anchor build --ignore-keys
./scripts/sync-idls.sh
anchor deploy --provider.cluster devnet
npx tsx scripts/init-rewire-devnet.ts   # venues + fund reservoirs
npm run init:perp-oracles               # oracle PDAs for SOL/BTC/ETH — uses Solana CLI wallet if set
# Or explicitly: ADMIN_KEYPAIR_PATH=$HOME/.config/solana/new-id.json npm run init:perp-oracles
# (.keys/admin.json does not exist; keeper.json is usually NOT pt-config admin)
```

**Perps trading (devnet):**

| You choose | Options |
|------------|---------|
| **Market** (what you long/short) | SOL, BTC, ETH — on-chain. Others — charts only until `tradeable: true` in catalog. |
| **Margin** (collateral) | **NVSCUSDC** (vault shares) or **USDC** in escrow — not a separate “NVSC perp”. |

Env (`.env` / keeper):

```
SOLANA_RPC_DEVNET=https://api.devnet.solana.com
USDC_MINT_DEVNET=Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5
ADMIN_KEYPAIR_PATH=.keys/keeper.json
KEEPER_KEYPAIR_PATH=.keys/keeper.json
DEVNET_RESERVOIR_FUND_USDC=500000000
SYNC_VENUE_WEIGHTS=true
SYNC_VENUE_APY=true
```

## Verification

```bash
npm run verify:phase1   # legacy single pool lend/recall
npm run verify:phase2   # perps + oracle
npm run verify:phase3   # liquidation
npm run verify:phase4   # fee split
npm run verify:phase5   # Kamino + Solend + Marginfi venue pools
```

Start keeper:

```bash
npm run keeper:dev
```

## Internal vs external (later)

- `LendingPool.lend_mode = 0` (`LEND_MODE_INTERNAL`) — **devnet default**
- `lend_mode = 1` — mainnet CPI into real protocols (same venue PDAs, different deposit path)

AI router still uses live **mainnet APY feeds** for decisions; devnet pools simulate those rates via `update_pool_apy` when `SYNC_VENUE_APY=true`.
