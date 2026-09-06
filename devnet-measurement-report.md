# Noviscia Devnet Measurement Report

**Generated:** 2026-09-06T14:53:36.836Z
**RPC:** https://api.devnet.solana.com
**Cluster version:** {"feature-set":2409014235,"solana-core":"4.3.0-beta.3"}

## Program Deployment

| Program | Program ID | Deployed | Size |
|---|---|---|---|
| netting-engine | `68s4vuWUXAaE...` | 🟢 | 36 bytes |
| nv-usdc-vault | `CN92hAtnZxbM...` | 🟢 | 36 bytes |
| noviscia-capacity | `JDsM18uSZ1UJ...` | 🔴 | — |
| gateway-auction | `HQ26VTfoBVmG...` | 🟢 | 36 bytes |
| clearing-registry | `Hg5QvSsnb22g...` | 🟢 | 36 bytes |
| yield-router | `FKaAPPid8B6h...` | 🟢 | 36 bytes |
| burn-engine | `nFgJEQSrKEi7...` | 🟢 | 36 bytes |
| escrow | `2WPb3wsyp4G6...` | 🟢 | 36 bytes |
| bug-bounty | `A8Uk9WuHumfi...` | 🟢 | 36 bytes |
| protocol-lp-vault | `2WUt24rRNWsd...` | 🟢 | 36 bytes |
| spot-dex | `8C4try8mEHuk...` | 🟢 | 36 bytes |

## Claims Measurements

### Atomic Reversion Control
- **Current status:** 🟢 Proven On Paper / Code
- **Target:** $0 Capital Leakage on failed transactions
- **Measured:** Programs not deployed
- **Measurement status:** 🔴 probe-failed
- **Notes:** Deploy netting-engine, nv-usdc-vault, noviscia-capacity first.
### Geyser Data Processing Speed
- **Current status:** 🟡 Simulated / Sandbox
- **Target:** < 2ms local RAM cache updates
- **Measured:** —
- **Measurement status:** 🟡 not-yet-measured
- **Notes:** Requires grpc-pipeline service connected to a Yellowstone endpoint. Run: `GRPC_PORT=50051 YELLOWSTONE_ENDPOINT=<endpoint> cargo run -p grpc-pipeline` then re-run this probe with YELLOWSTONE_ENDPOINT set. The probe measures p50/p95/p99 slot-to-event latency over 1000 slots.
### Jito Engine Landing Rates
- **Current status:** 🟡 Simulated / Sandbox
- **Target:** 80% Target Block Coverage
- **Measured:** —
- **Measurement status:** 🟡 not-yet-measured
- **Evidence artifact:** `scripts/e2e/e2e-jito-devnet-probe.ts`
- **Notes:** Existing probe at scripts/e2e/e2e-jito-devnet-probe.ts tests transport + tip accounts. Full landing-rate measurement requires sending test bundles to mainnet (devnet block engine is decommissioned — NXDOMAIN). Run: `npx tsx scripts/e2e/e2e-jito-devnet-probe.ts` for transport check. Landing rate requires mainnet bundle submissions over multiple slots.
### Time-Accelerated Timeout Locks
- **Current status:** 🟡 Simulated / Sandbox
- **Target:** 60s Expiry Execution (1440x scale)
- **Measured:** —
- **Measurement status:** 🟡 not-yet-measured
- **Notes:** Requires on-chain desk creation + time-advance to observe 24h/2h window behavior. The sandboxAccelerator.ts models this at 1440x acceleration. Live measurement: create desk on devnet, advance clock via warp-slot, observe when the facility freezes.
### Senior Tranche Circuit Breakers
- **Current status:** 🟡 Simulated / Sandbox
- **Target:** Hard Freeze at 50% Junior Pool Drain
- **Measured:** —
- **Measurement status:** 🟡 not-yet-measured
- **Notes:** Waterfall.ts S3 scenario demonstrates this triggers at 50% junior drain. Live measurement: simulate correlated defaults on devnet, observe vault program rejecting further draws after 50% junior threshold. The circuit breaker logic is in nv-usdc-vault (committed in code).
### Non-Jito Slot Detection + Allocation Pause
- **Current status:** 🟡 Simulated / Sandbox
- **Target:** Proof that allocation pauses before risk is written
- **Measured:** —
- **Measurement status:** 🟡 not-yet-measured
- **Evidence artifact:** `sdk/src/ability.ts`
- **Notes:** ability.ts implements leaderIsJito() + guardNonJitoLeaderSlot(). Live measurement: on devnet, observe that credit-line allocation is rejected during non-Jito leader slots. Requires Geyser stream + leader-schedule parsing.
## Summary

- Total claims: 6
- Proven on paper: 1
- Simulated / sandbox: 5
- Pending: 0
- Flipped to testnet-measured: 0