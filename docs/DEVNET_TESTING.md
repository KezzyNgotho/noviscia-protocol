# Devnet Real-Yield Testing Runbook

**Purpose:** Validate TVV yield mechanics, Jito bundle auctions, and institutional
capacity lifecycle on Solana Devnet before mainnet, using a private Jito-Solana
validator and $5M mock pool.

---

## Architecture

```
                    ┌─────────────────────────────┐
                    │  NOVISCIA PRIVATE DEVNET NODE │
                    └──────────┬──────────────────┘
                 ┌─────────────┴─────────────┐
                 ▼                           ▼
     ┌───────────────────┐     ┌──────────────────────────┐
     │ Public Devnet      │     │ Private Jito Block Engine │
     │ Cluster            │     │                           │
     │ • Syncs ledger     │     │ • Listens for bundles     │
     │ • Faucet airdrops  │     │ • Enforces 400ms atomicity│
     │ • Program deploy   │     │ • Tip auction             │
     └───────────────────┘     └──────────────────────────┘
```

The public Solana Devnet does **not** run Jito-Solana validator clients and has
no native Jito MEV Block Engine (`devnet.block-engine.jito.wtf` is NXDOMAIN).
Noviscia deploys a private, dedicated Jito-Solana validator that syncs with the
public Devnet cluster and exposes a custom Block Engine endpoint.

---

## Quick Start

```bash
# 1. Check relay health
npx tsx scripts/devnet/devnet-relay-config.ts --probe

# 2. Provision the $5M Devnet pool
npx tsx scripts/devnet/provision-devnet-pools.ts --apply

# 3. Run the 3-metric test suite
npx tsx scripts/devnet/test-concurrency-landing.ts
npx tsx scripts/devnet/test-loss-waterfall.ts
npx tsx scripts/devnet/test-ntoken-appreciation.ts

# 4. Generate the executive dashboard
npx tsx scripts/devnet/devnet-dashboard.ts
```

---

## Pool Parameters

| Parameter | Value | Derivation |
|-----------|-------|------------|
| Pool size | $5,000,000 | Devnet trial scale |
| C_sys (aggregate credit line) | $3,000,000 | 60% of pool |
| C_desk (per-asset max_capacity) | $750,000 | 15% of pool |
| Senior tranche | $3,500,000 | 70% of pool |
| Junior first-loss layer | $1,500,000 | 30% of pool |
| Base rate | 24% APY | Borrowing rate |
| Jito landing rate | 80% | Eligible slots |
| Avg utilization | 40% of C_sys | Active capital |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SOLANA_RPC_DEVNET` | `https://api.devnet.solana.com` | Solana RPC endpoint |
| `DEVNET_JITO_BLOCK_ENGINE_URL` | `http://127.0.0.1:9000` | Private Jito relay |
| `DEVNET_YELLOWSTONE_ENDPOINT` | `http://127.0.0.1:10000` | gRPC TVV feed |
| `ADMIN_KEYPAIR_PATH` | `~/.config/solana/new-id.json` | Deployer wallet |
| `DEVNET_DESK_KEYPAIR_PATH` | (deployer) | Desk institution keypair |

---

## Metric A: Multi-Desk Concurrency & Landing Rate

**Script:** `scripts/devnet/test-concurrency-landing.ts`

**What it tests:** Multiple automated desk bots simultaneously locking capital
across consecutive Devnet slots without state blockages or deadlocks.

**Target:** ≥ 80% successful bundle landing rate.

```bash
npx tsx scripts/devnet/test-concurrency-landing.ts --desks=5 --slots=500
```

**Output:** `devnet-metric-a-concurrency.json`

---

## Metric B: Loss Waterfall & Settlement Loop

**Script:** `scripts/devnet/test-loss-waterfall.ts`

**What it tests:** The full algorithmic policing cycle when a desk defaults:

1. Desk allocates capital from USDC pool
2. 24h window expires (Open → Overdue → Breached)
3. Risk Sentinel flags timeout
4. Credit line frozen (desk cannot allocate)
5. Settlement triggered (premium + principal returned)
6. Verification: zero capital leakage

**States:**
```
Open → Overdue → Breached → Settled
```

```bash
# Observe current state
npx tsx scripts/devnet/test-loss-waterfall.ts

# Simulate lifecycle
npx tsx scripts/devnet/test-loss-waterfall.ts --simulate

# Trigger settlement
npx tsx scripts/devnet/test-loss-waterfall.ts --settle
```

**Output:** `devnet-metric-b-waterfall.json`

---

## Metric C: nToken Appreciation Math

**Script:** `scripts/devnet/test-ntoken-appreciation.ts`

**What it tests:** That the LP share price (nToken) appreciates ONLY from fees
paid by HFT desks — no token emissions, no inflation, no external subsidies.

**Key invariant:** `share_price = totalIdleCapital × 10^6 / totalShares`

```bash
# Observe current state
npx tsx scripts/devnet/test-ntoken-appreciation.ts

# Project 14-day yield
npx tsx scripts/devnet/test-ntoken-appreciation.ts --project

# Compare with reference pool
npx tsx scripts/devnet/test-ntoken-appreciation.ts --compare
```

**Output:** `devnet-metric-c-appreciation.json`

---

## Dashboard

Aggregates all three metric reports into a unified executive summary.

```bash
npx tsx scripts/devnet/devnet-dashboard.ts
```

**Output:** `devnet-dashboard.json`

---

## 14-Day Trial Protocol

| Day | Action | Metric |
|-----|--------|--------|
| 0 | Provision pool, open window | Setup |
| 0–1 | Run concurrency test | A |
| 1–13 | Continuous yield generation | C (daily snapshot) |
| 7 | Mid-trial dashboard | All |
| 13 | Trigger intentional default | B |
| 14 | Final dashboard + settlement | All |

---

## Troubleshooting

### Relay unreachable

```
✗ Cannot reach Solana Devnet RPC
```

Check that your private Jito validator is running and synced with Devnet.
Verify: `curl http://127.0.0.1:9000/api/v1/bundles -d '{"jsonrpc":"2.0","id":1,"method":"getTipAccounts","params":[]}'

### Pool not found

```
✗ USDC pool not found
```

Run the provisioning script first: `npx tsx scripts/devnet/provision-devnet-pools.ts --apply`

### Low landing rate

If Metric A shows < 80% landing rate, check:
1. Network congestion on Devnet
2. Jito tip amount (increase `DEFAULT_TIP_LAMPORTS`)
3. Block engine processing capacity
4. Concurrent request volume

### Window stuck in Open

If Metric B shows window stuck in Open past 24h, the observer may need to
re-check: `npx tsx scripts/devnet/observe-capacity-window-devnet.ts`
