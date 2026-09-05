# Noviscia — Incident Response & Disaster Recovery Drill

> **Purpose:** One-page operations runbook for *extended-halt, state-reseed, and post-incident
> recovery* on the Noviscia CCP. Ties `ONCALL_RUNBOOK.md` steps to `MAINNET_READINESS.md`
> §Solana Network Degradation Architecture (network health tiers) and §rollback conventions.
> This is the companion for the **quarterly drill cadence** below.
>
> **Status:** Working document. **Last updated:** September 5, 2026
>
> **Applies to:** mainnet root-key material per `KEY_MANAGEMENT_GOVERNANCE.md`; on devnet every
> step is person-centric (single deployer key `pm2tUw…` stands in for Tier-1/2/3).

---

## 1. The four recovery tiers (map to network health tiers)

| DR tier | Trigger | Immediate move | Resume condition |
|---|---|---|---|
| **T-Degraded** | Avg slot ≤ 2s (`DEGRADED`) | `pause_opens` on-chain; 2× priority fees; Jito fallback armed | slot-time back to ≤ 600ms window |
| **T-Critical** | ≤ 5s (`CRITICAL`) | `pause_opens + pause_deposits`; Jito bundle submission; 4× fees; liquidations escalated | health tier improves |
| **T-Halt** | > 5s / chain halt (`HALT`) | emergency-pause all; crank queue preserved; **no manual settlement** | full block-height resume |
| **T-Reseed** | Program/state needs rollback or rebuild | see §2 state-reseed; **never patch live, always round-trip on devnet first** | verified parity + committee sign-off |

The `HALT` case is exactly why the loss waterfall
(Insurance Fund → Default Fund → CCP Equity → Settlement Vault) and the pre-signed fallback queue
exist in `MAINNET_READINESS.md`: liquidations may not execute for up to ~2h and `DF_target` is
sized to cover that (`VaR_99 × 1.25`).

## 2. State-reseed drill (T-Reseed)

Ordering principle from the audit register (`AUDIT_GAP_ANALYSIS.md`): **test on a devnet validator
copy before any live patch; never mutate production accounts in place for `seeds::program`
regressions.**

1. **Freeze** the widest surface first (Tier-1 breaker per `ONCALL_RUNBOOK.md` §3.2), then narrow.
2. **Snapshot** the affected account set (program data, PDAs, vault configs) with
   `solana account` / RPC; record block slot of the divergence.
3. **Replay** the failing instruction on a devnet validator copy (`solana-test-validator --clone`
   the accounts, run the candidate patch e2e from `tests/`).
4. **Rollback or forward-patch**:
   - *Upgrade authority* (council Tier-3, 72h timelock) decides between
     `solana program deploy` of the prior `.so` (rollback) vs an emergency patch — the known
     `ConstraintSeeds` / struct-split pattern for `CreativeAccountDeserialize`-class crashes.
   - If accounts themselves corrupt: rebuild via `initialize`-path (registry/pools) following the
     same idempotent cap-wire used for devnet (`e2e-asset-engine-capwire-devnet.ts`); every re-run
     only fills real gaps.
5. **Parity verify** — recompute account discriminators and struct offsets locally
   (`e2e-rbac-tier-evidence-devnet.ts` prove __pattern__), then re-run the failed e2e until green.
6. **Restore** the narrowest frozen surface last; unpause only after the terminator sees healthy
   windows.

## 3. Quarterly drill procedure (4 steps, one afternoon)

Run this on **devnet** each calendar quarter and record times/findings in the incident channel.

| # | Drill | What you prove | Pass bar |
|---|---|---|---|
| 1 | **Breaker round-trip** | `set_paused(true)` → observe freeze on SDK builders → `set_paused(false)` | freeze+unfreeze < 10 min; existing positions intact |
| 2 | **Degraded-mode ops** | simulate `DEGRADED` (throttle RPC/cluster): `pause_opens`, 2× fees, Jito fallback login | crank still lands (or explicitly queued) |
| 3 | **T-Reseed round-trip** | regression e2e on a devnet validator copy → restore parity | failed instruction green on the copy before touching live |
| 4 | **Comms replay** | run the `MASTER_LOAN_AGREEMENT.md` comms template end-to-end | status page + NLP-friendly updates issued ≤ 15 min aft trigger |

Post-drill: file a **drill report** with the same template as a post-mortem — timeline, what broke,
what was slow, one monotonic improvement, and a pat-backs item into `MAINNET_READINESS.md`
§rollback if the drill reveals a gap.

## 4. Rollback cheat-sheet (from `MAINNET_READINESS.md`)

```
# record current + prior program data
solana program show <PROGRAM_ID>
# rollback = redeploy prior .so under the SAME program id (upgrade authority must approve)
solana program deploy target/deploy/<PROGRAM>.so --program-id <KEYPAIR> --keypair <COUNCIL_KEY>
# verify
solana program show <PROGRAM_ID>        # data length + upgrade authority
solana account <INITIALIZED_PDA>        # discriminator + fields decode to expectations
```

Never roll back *accounts* via program-account re-create while a vault/registry holds balances —
use the `initialize`-path rebuild + parity checks in §2 unless the account is provably empty.

## 5. Ownership of this doc

| Owner | Scope |
|---|---|
| On-call (per rotation) | T-Degraded / T-Critical / T-Halt first moves |
| Council + Risk committee | T-Reseed authority, rollback decisions, drill sign-off (`KEY_MANAGEMENT_GOVERNANCE.md`) |
| Dev (tools) | devnet validator replay harness, parity scripts, drill tooling |

---

## Cross-references

- Severity/containment/communication: [`ONCALL_RUNBOOK.md`](ONCALL_RUNBOOK.md)
- Network health tiers + waterfall + default fund: [`MAINNET_READINESS.md`](MAINNET_READINESS.md)
- Key custody / ceremonies: [`KEY_MANAGEMENT_GOVERNANCE.md`](KEY_MANAGEMENT_GOVERNANCE.md)
- Adversary model that motivates the drills: [`THREAT_MODEL.md`](THREAT_MODEL.md)
- Telemetry gaps to close for drill telemetry: [`MONITORING.md`](MONITORING.md)