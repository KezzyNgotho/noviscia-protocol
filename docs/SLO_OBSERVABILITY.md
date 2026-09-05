# Noviscia — SLOs, SLIs & Observability

> **Purpose:** Define the availability targets and indicators that gate mainnet-readiness
> (`MAINNET_READINESS.md`), and tie every alert from `MONITORING.md` to a measurable SLO.
> This page is the single source of truth for "what has to hold"; `MONITORING.md` lists the tooling
> and `ONCALL_RUNBOOK.md` covers response.
>
> **Status:** Working document. **Last updated:** September 5, 2026
> **Owner:** SRE/on-call rotation; approved at readiness checkpoint.

---

## 1. Service SLOs (off-chain)

| Service | SLI | SLO (rolling 30d) | Error budget | Notes |
|---|---|---|---|---|
| indexer (:8092) | availability % + ingest lag | **99.9%**, lag ≤ 5 min @ p99 | 43 min/mo | lag gauge = latest indexed slot vs `getSlot` |
| RPC (primary) | availability / healthy responses | **99.5%** | 3.6 h/mo | primary is a commercial endpoint; see §3 fallback |
| RPC (fallback pool) | healthy fallback % | **100%** on a warm standby, failover < 60s | — | flip on `DEGRADED` per degradation tiers |
| price-feed | p99 end-to-end publish-to-slot latency | **≥ 99% within 5s** | — | feeds VAA freshness window (≤ 30s hard cap) |
| websocket | delivery of position/vault updates | **99.9%** p99 UI event | 43 min/mo | drift ≤ 1 slot from indexer |
| netting-relayer | margin/setting refresh success | **99.9%**, no > 30-min gap | 43 min/mo | keeps `NettingSet.margin_required_usdc` live |
| ai-orchestrator | `/health` availability | **99.5%** (advisory, non-critical) | 3.6 h/mo | rules-engine validation never bypassed |

SLI measurement: Prometheus `up` + service-level heartbeat targets added to the polling service in
`MONITORING.md` §On-Chain Monitoring before mainnet gate.

## 2. On-chain (protocol) SLOs

Permissionless cranks have no "service uptime" — monitor *settlement cadence* instead:

| Indicator | SLI | SLO |
|---|---|---|
| Liquidation latency | max age of highest-risk position's liquidation | **p99 < 3 slots** under NORMAL; escalated targets under `CRITICAL` (see `MAINNET_READINESS.md` tiers) |
| Funding/oracle settle | last settle tx per slot window | **no > 30s gap** in any market |
| Revenue sweep residue | gateway tip-vault, netting rent-vault, JIT premium ledger | **≈ 0**; non-zero refill > 1 h = SEV-3 |
| Oracle freshness | Pyth `publish_slot` age at order verification | **≤ 30s** (hard reject at > 30s per `verify_jit_price`); alert at 15s |
| Solvency | `total_assets − total_liabilities` | **always ≥ 0**; crossing 0 = SEV-1 (`MONITORING.md`) |
| Jito bundle drop rate | bundles submitted vs landed | **drop ≤ 5%** excludes tip-band shakes; deviation → review `PARTICIPANT_ACCESS.md` |

## 3. Failure management & error budgets

- **RPC fallback:** primary → fallback pool flip must complete < 60s with no frontend stall;
  repeatable via the `DEGRADED` drill in `IR_DR_DRILL.md` §3.
- **Error-budget consumption:** each error-budget breach triggers a written
  SEV-2/3 post-mortem within 5 business days, folded into the on-call agenda
  (`ONCALL_RUNBOOK.md` §4, post-incident rule).
- **Monitoring gaps:** anything marked "needs setup" in `MONITORING.md` does **not** count as
  covered by an SLO — it opens a readiness gate, not an SLO.

## 4. Observability prerequisites

Copied from the readiness checklist; all must be true before mainnet:

- [ ] Prometheus + Grafana exporting the §1 SLIs (400ms slot-poll cadence)
- [ ] Uptime checks on RPC, indexer (:8092), websocket, price-feed, netting-relayer, web frontend @ 60s
- [ ] Alerts wired to PagerDuty/Opsgenie with the severity mapping in §1/§2
- [ ] Centralized structured logs (service, level, tx_signature, slot, timestamp) per `MONITORING.md` §Log Aggregation
- [ ] SLO-attached alert rules (burn rate + long-window) so no single dashboard is hand-watched

---

## Cross-references

- Target listing / thresholds: [`MONITORING.md`](MONITORING.md)
- Response when an SLO is at risk: [`ONCALL_RUNBOOK.md`](ONCALL_RUNBOOK.md)
- Network degradation tiers + default fund sizing: [`MAINNET_READINESS.md`](MAINNET_READINESS.md)
- Recovery drills that exercise these SLOs: [`IR_DR_DRILL.md`](IR_DR_DRILL.md)