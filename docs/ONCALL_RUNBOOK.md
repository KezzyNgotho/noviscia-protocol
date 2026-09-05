# Noviscia — On-Call & Incident Response Runbook

> **Purpose:** Operationalize detection, severity, containment, the three-tier breaker playbook, and
> post-incident review for the Noviscia CCP. Read after `THREAT_MODEL.md`; complements
> `MONITORING.md` (telemetry) and `KEY_MANAGEMENT_GOVERNANCE.md` (who holds what key).
>
> **Status:** Working document. **Last updated:** September 2026
>
> > ⚠️ **Devnet-vs-mainnet disclaimer:** On devnet, a single deployer key (`pm2tUw…`)
> > acts as both Tier-1/2/3. Until council-Squads key-splitting is live (see
> > `KEY_MANAGEMENT_GOVERNANCE.md`), treat every step here as *person-centric*, not key-centric.

---

## 1. Severity definitions

| Sev | Definition | Examples | Response window |
|---|---|---|---|
| **SEV-1** | User funds at immediate risk; active exploit in-flight; vault draining | T-1 seed bug live; upgrade-key compromise | < 10 min containment |
| **SEV-2** | Structural risk to funds (not yet stolen); protocol error trending | Oracle skew cascade, redemption capex breach, insolvency underestimation alarm | < 60 min |
| **SEV-3** | Usability/degradation; no funds at risk | Crank backlog, indexer lag, RPC fallback flaps | < 24 h |
| **SEV-4** | Watch items / hardening | Doc staleness, low-severity audit findings | next sprint |

## 2. Detection sources (wire these before mainnet)

| Source | What it catches | Doc |
|---|---|---|
| Sentry (TS/UI) | frontend RPC failures, error-code surface 6000+/500 | `MONITORING.md` |
| On-chain watcher (yet to build) | swap/withdraw spikes, `EmergencyPaused` / `paused` flags, insurance floor hits | `MONITORING.md` ⚠️ "needs setup" |
| Bundle validator (Jito) | bundle drop-rate, tip-price anomalies, insolvency rejection counts | `PARTICIPANT_ACCESS.md` |
| Indexer lag gauge | clearing sweep stale, positions not margined | `API.md` |
| Manual alarms | committee canaries, `ERROR_REFERENCE.md` §3 signatures | — |

> **Severity triggers on-chain:** watch `paused`/`EnginePaused` flags and these error codes as
> SEV alarms: 6002 `Paused`, 6064/6097 `EmergencyPaused`/`EmergencyPauseActive`,
> 6016 `InsuranceBufferFloorBreached`, 6009 `CreditLineFrozen`, 6022 `LossRatioFreeze`,
> 2006 `ConstraintSeeds` (fresh `seeds::program` regression).

## 3. Incident lifecycle

```
DETECT → TRIAGE → CONTAIN → STABILIZE → COMMUNICATE → POST-MORTEM
```

### 3.1 Detect & triage (0–5 min)
1. Acknowledge alert; record timestamp, epoch, affected program + account with
   `solana ledger`/RPC trace.
2. Classify SEV (table above). Nonshared = replay unaffected — escalate if funds-adjacent.
3. Open a status page line (`MASTER_LOAN_AGREEMENT.md` comms templates; draft a cheat)
   regardless of severity to stop scattered chatter.

### 3.2 Contain — three-tier breaker playbook

Order of operations: **freeze the widest surface first, then narrow.**

| Tier | Authority | Atomic move | When | Effect |
|---|---|---|---|---|
| **1 — Breaker (fast)** | `breaker_authority` (asset-engine registry), or program `paused` fixtures | `set_paused(true)` on asset-engine; `EmergencyShutdown`/`EmergencyPaused` paths in capacity/position/staking; freeze N credit lines (`CreditLineFrozen` 6009) | Any SEV-1/2 | Halts new draws/trades/withdraws **instantly**; existing positions intact; sweep/settlements may continue if unaffected |
| **2 — Risk committee (parameter)** | committee multisig | Tighten pre-pay windows, leverage config (max-LeverageConfig), exposure ceilings, insurance cuts | Persistent T-3/T-5/T-6 pattern | Reduces flow without hard stop; reversible |
| **3 — Council (upgrade / timelock)** | council Squads + timelock | Halt program upgrades, freeze via deploy of emergency patch, or full pause | SEV-1 involving upgrade-key compromise; any CA-bearing code path | Highest inertia (~timelock delay) — **unavailable for instant containment**; combine with Tier-1/2 |

Escalation matrix (who holds which key): see `KEY_MANAGEMENT_GOVERNANCE.md` §3.

### 3.3 Stabilize
- If exploit in-flight: **bank the exploiter** — monitor addresses, alert exchanges per policy,
  and correlate with `THREAT_MODEL.md` section 5 kill-chains.
- If systemic (insolvency): trigger `INSOLVENCY_POLICY.md` waterfall — do **not** silently inject
  insurance; socialize only per policy.
- If oracle-related: dual-feed ±35 bps check (`CrossOracleSkew` 507); freeze the affected market
  with Tier-1 before price fixing.

## 4. Communication matrix

| Audience | Channel | Content |
|---|---|---|
| On-call / committee | internal (DM → war room) | verified facts, assignment, SEV |
| LPs / institutions | status page + MLA notices (per-offtake windows) | English-language "what broke, what's frozen, next update" — cite breaker tier used |
| Team/developers | incident channel | logs, repro, test outcomes |
| Exchange/venu validators | on-call bridge | for SEV-1 bundling/tip anomalies only |

Post-incident: every SEV-1/2 gets a written post-mortem within 5 business days with: timeline,
root cause (code path + error code), fix PR refs, monotonic follow-up items, and a **yes/no** read
on whether the threat-model register (`THREAT_MODEL.md` §4) needs a new row.

## 5. Holding the line (preventive discipline on-call)

- Reject deploys that touch `seeds::program` without a `ConstraintSeeds` regression e2e.
- Reject new authority roles that collapse Tier-1/2/3.
- Monitor `MONITORING.md` "needs setup" items against the readiness gate in
  `MAINNET_READINESS.md`.
- Quarterly breaker drill: freeze→unfreeze round-trip on devnet using this runbook's Tier-1 steps
  and time the failure mode (`docs/E2E_TEST.md` harness).

## 6. Fridge: key SEV-1 one-liners

- **"CreativeAccountDeserialize crash"** → freeze program (Tier-1), collect trace, hand the
  `.so`/layout to dev for struct-split (known fix pattern from sweep work).
- **"CrossOracleSkew alarms across 3+ markets"** → Switchboard/Pyth incident; hold liquidation,
  Tier-1.
- **"2006 ConstraintSeeds on sweep paths"** → fresh `seeds::program` mismatch; never patch live;
  test on devnet validator copy first.
- **"Vault redemptions spike > redemption-cap spread"** → Tier-1; expect a run; invoke insurance
  floor + cooldown narrative in comms.