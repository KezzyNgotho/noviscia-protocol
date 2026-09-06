# Noviscia Verification Claims Table

**Last updated:** 2026-09-06T14:53:36.836Z
**Measurement RPC:** https://api.devnet.solana.com
**Cluster version:** {"feature-set":2409014235,"solana-core":"4.3.0-beta.3"}

| # | Functional System Attribute | Current Verification Status | Target Metric | Source of Truth | Measurement / Notes |
|---|---|---|---|---|---|
| 1 | Reconciled slot-level economics | 🟢 Proven On Paper / Math | 24% Implied Base Facility Rate | sdk/src/economics.ts + sdk/src/spreadsheet.ts | N/A — paper-first; reconciled in economics.ts |
| 2 | One source of truth for every assumption | 🟢 Proven On Paper / Code | All constants labeled assumed/simulated/pending | sdk/src/assumptions.ts | Verified — 10 assumptions with 5-label provenance |
| 3 | Executable simulation code + tests + replay | 🟢 Proven On Paper / Code | 146/146 tests pass, replay digest pinned | sdk/src/waterfall.ts + replay.ts | Verified — 146/146, SHA-256 replay digest pinned |
| 4 | Atomic Reversion Control | 🟢 testnet-measured | $0 Capital Leakage on failed transactions | scripts/devnet/measure-atomicity.ts | All three core programs live on devnet: netting-engine, nv-usdc-vault, noviscia-capacity (EDBr2VFW). Atomicity probe ran: real token flow, no leakage. |
| 5 | Geyser Data Processing Speed | 🟡 Simulated / Sandbox | < 2ms local RAM cache updates | — | Requires grpc-pipeline service connected to a Yellowstone endpoint. Run: `GRPC_PORT=50051 YELLOWSTONE_ENDPOINT=<endpoint> cargo run -p grpc-pipeline` then re-run this probe with YELLOWSTONE_ENDPOINT set. The probe measures p50/p95/p99 slot-to-event latency over 1000 slots. |
| 6 | Jito Engine Landing Rates | 🟡 Simulated / Sandbox | 80% Target Block Coverage | scripts/e2e/e2e-jito-devnet-probe.ts | Existing probe at scripts/e2e/e2e-jito-devnet-probe.ts tests transport + tip accounts. Full landing-rate measurement requires sending test bundles to mainnet (devnet block engine is decommissioned — NXDOMAIN). Run: `npx tsx scripts/e2e/e2e-jito-devnet-probe.ts` for transport check. Landing rate requires mainnet bundle submissions over multiple slots. |
| 7 | Time-Accelerated Timeout Locks | 🟡 Simulated / Sandbox | 60s Expiry Execution (1440x scale) | devnet-window-observation.json + scripts/devnet/observe-capacity-window-devnet.ts | Window opened on devnet at slot 494190470 (2026-09-06). Open posture confirmed; mature at slot 494406470 (+216,000 ≈ 24h), breach at 494424470 (+234,000 ≈ 26h). OverdueSlots/Breached observation pending 26h observer. |
| 8 | Senior Tranche Circuit Breakers | 🟡 Simulated / Sandbox | Hard Freeze at 50% Junior Pool Drain | — | Waterfall.ts S3 scenario demonstrates this triggers at 50% junior drain. Live measurement: simulate correlated defaults on devnet, observe vault program rejecting further draws after 50% junior threshold. The circuit breaker logic is in nv-usdc-vault (committed in code). |
| 9 | Non-Jito Slot Detection + Allocation Pause | 🟡 Simulated / Sandbox | Proof that allocation pauses before risk is written | sdk/src/ability.ts | ability.ts implements leaderIsJito() + guardNonJitoLeaderSlot(). Live measurement: on devnet, observe that credit-line allocation is rejected during non-Jito leader slots. Requires Geyser stream + leader-schedule parsing. |
| 10 | 2–3 credible searchers/MMs test the SDK | 🔴 Pending Live Validation | Active institutional trading desks | — | Pending counterparty outreach |
| 11 | Pilot results and user commitments | 🔴 Pending Live Validation | Written post-pilot assessment | — | Pending pilot execution |
| 12 | MLA enforceability (NY + jurisdictions) | 🔴 Pending Live Validation | New York Jurisdiction Activation | External Corporate Legal Counsel Review | Pending legal counsel engagement |

---

**Summary:** 1/6 probe targets flipped to testnet-measured. Counterparty and legal claims remain pending.

---

*A simulated result is not live performance. A legal design is not legal protection.*