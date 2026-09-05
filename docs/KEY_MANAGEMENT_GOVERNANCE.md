# Noviscia — Key Management & Governance Operations

> **Purpose:** Who/what holds every key, the devnet→mainnet key-splitting plan, rotation & upgrade
> SOPs, and the compromise protocol. Necessary companion to `THREAT_MODEL.md` (T-2/T-13) and
> `ONCALL_RUNBOOK.md` (breaker tiers).
>
> **Status:** Working document. **Last updated:** September 2026

---

## 1. The three-tier governance model (recap)

| Tier | Role | Key form | Authorizes | Inertia |
|---|---|---|---|---|
| **1 — Breaker** | pause/freeze | single fast key (rotation-capable) | `set_paused`, freeze credit lines, Emergency paths | seconds |
| **2 — Risk committee** | parameter authority | multisig (M-of-N) | margin model, exposure ceilings, pre-pay windows, insurance cuts | minutes |
| **3 — Council** | upgrade authority | Squads multisig + timelock | program upgrades, migration, treasury moves | timelock-delayed |

Existing per-program authority roles map onto this: e.g. `AssetRegistry` carries
`breaker_authority`, `risk_committee_authority`, `upgrade_authority` (see
`ACCOUNT_MAP.md` and the RBAC evidence script `scripts/e2e/e2e-rbac-tier-evidence-devnet.ts`);
`nv-usdc-vault` enforces an admin-migration ceremony (`AdminMigrationPending` 6023 →
`MigrationNotEffective` 6025 → `NotCurrentAdmin` 6026).

## 2. Current devnet state (migrate before mainnet)

| Key | Current | Risk | Target |
|---|---|---|---|
| All 19 programs' upgrade authority | single deployer key `pm2tUw…` (`cap-wire` keypair) | **T-2 single point** | council Squads multisig (§3) |
| `AssetRegistry` authorities | bootstrap set as Registry (breaker/committee) | single-set bootstrap | rotate to Tier-1/2 keys |
| Treasury / insurance keys | bootstrap roll | bootstrap on devnet | council custody + minimal balance |
| Indexer / settlement service | local node creds | operator-visible secrets | env-managed, read-only RPC |

Do **not** carry the deployer key to mainnet. Mainnet instance must derive from a fresh ceremony
(§3), never from devnet artifacts.

## 3. Mainnet key-splitting ceremony (Squads)

1. Generate council keys air-gapped; derive M-of-N (recommend 3-of-5 for council, 2-of-3 for
   committee) using `solana-keygen` + Shamir shares for cold storage.
2. Deploy Squads multisig + create the program-upgrade authority account; `set_authority` for
   *every* program's `upgrade_authority` to the Squads PDA in one ceremony batch.
3. Assert on-chain RBAC: run the trust-free proof first, then switch final
   `council` membership (see `E2E_TEST.md`, `docs/DEVNET.md` cap-wire flow).
4. Configure timelock delay; record the human + tech procedures in
   `MAINNET_READINESS.md` checklist; store hashes of the ceremony script & keys in the
   KMS/ledger log.

Rotation SOP (any tier): rotate-breaker monthly; committee quarterly; council on any
signer change/compromise — rerun ceremony §3 step 3 after each rotation.

## 4. Upgrade runbook (mainnet via Squads, devnet direct)

### Devnet
1. Build with tools `v1.52` (see `AUDIT_GAP_ANALYSIS.md` / `DEVNET.md` — current platform-tools
   in the bundled toolchain cannot build `offset_of!`).
2. `solana program deploy <program>.so` with the deployer key; verify `program id` unchanged
   (upgrade, not redeploy).
3. Copy fresh `.so` from `target/sbf-solana-solana/release/` → `target/deploy/` if you re-build.

### Mainnet
1. Council proposes a `squads:execute` TX carrying the `.so` + `SetProgramAuthority` as needed.
2. Timelock holds per config; committee signs parameter TXs separately (never merged into the
   upgrade TX).
3. Post-migration: run sweep/e2e *against the deployed instance* before re-enabling Tier-1 (all
   pdas must match `ACCOUNT_MAP.md` — any drift = `ConstraintSeeds` 2006).

## 5. Compromise protocol (key-level)

| Event | Action | Post |
|---|---|---|
| Breaker key leak | rotate Tier-1; sweep on-chain `breaker_authority` | post-mortem; verify no TX signed after rotation |
| Committee (N-of-M) key leak | revoke signer; rotate committee; re-sign pending params | hold window (params frozen in flight) |
| Council / upgrade-key compromise | **T-3 only casualty** → Tier-1 freeze first (per `ONCALL_RUNBOOK.md` §3.2); transfer assets to fresh vault under new ceremony; then forensic audit | full SEV-1 post-mortem + threat-register review |
| Deployer key (devnet) compromise | treat as SEV-1 if it also targets mainnet artifacts | destroy & regen key; rotate all authorities |

Every compromise drill on devnet must exercise the freeze→rotate→unfreeze loop from the
`ONCALL_RUNBOOK.md` quarterly drill.

## 6. Inventory to keep current

- Authority matrix (who is signer per program/account); update on every rotation.
- Secret inventory (KMS, cold shares, envelopes) with access log.
- Cap-wire / CLI keypair locations and their **cluster scoping** (never reuse across clusters).
- Contract-facing keys (oracle permissions, Squads) — bind to `MAINNET_READINESS.md`.

---

| Related | Doc |
|---|---|
| Threat model (T-2, T-13) | `THREAT_MODEL.md` |
| Breaker execution steps | `ONCALL_RUNBOOK.md` §3.2 |
| Deployment + rollback on mainnet | `MAINNET_READINESS.md`, `DEPLOYMENT.md` |
| Evidence script asserting the RBAC authorities | `scripts/e2e/e2e-rbac-tier-evidence-devnet.ts` |