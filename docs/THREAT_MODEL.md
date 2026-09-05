# Noviscia — Threat Model

> **Purpose:** Formal adversary-and-asset model for the Noviscia CCP/TVV system. Grounding for
> `SECURITY.md` (defenses), `ONCALL_RUNBOOK.md` (response), and the mainnet readiness audit.
>
> **Status:** Working document — review at mainnet exit. **Last updated:** September 2026
>
> Companion docs: [`SECURITY.md`](SECURITY.md), [`ACCOUNT_MAP.md`](ACCOUNT_MAP.md),
> [`ERROR_REFERENCE.md`](ERROR_REFERENCE.md), [`INSOLVENCY_POLICY.md`](INSOLVENCY_POLICY.md),
> [`KEY_MANAGEMENT_GOVERNANCE.md`](KEY_MANAGEMENT_GOVERNANCE.md).

---

## 1. In-scope assets (what an adversary can take or alter)

| # | Asset | Custody / location |
|---|---|---|
| A1 | User principal USDC (LP pool) | `nv-usdc-vault` vault USDC ATA (vault-authority PDA) + `asset-pool`/`desk-position` accounts |
| A2 | Clearing settlement funds (market outcomes) | `noviscia-clearing` `ClearingConfig` warehouse + per-`UserPosition` |
| A3 | Institutional credit-line principal | `noviscia-asset-engine` `asset-vault` (asset-authority PDA) per mint |
| A4 | Position-tracker collateral & premiums | `collateral-vault`/`settlement-vault` (PtConfig PDA) + `margin-vault` |
| A5 | JIT toilet/tip funds + gateway-auction tips | `jit-risk` `usdc_vault`; `gateway-auction` `tip-vault` |
| A6 | Insurance / default-fund capital | `InsuranceBuffer`, `InsuranceFundState`, `insurance-vault` |
| A7 | NVSC supply & staked value | `token-nvsc` mint, `staking-manager` `staking-vault` |
| A8 | Governance state & votes | `ve-nvs` registry, `VoterRecord`/`Proposal` accounts |
| A9 | Oracle price state (Pyth + Switchboard) | External oracles (trust boundary T-o) |
| A10 | Off-chain operator keys, indexer, settlement/withdrawal engine | Operator custody (trust boundary T-o) |

## 2. Trust boundaries

| Boundary | What it separates |
|---|---|
| T-chain | Solana runtime ↔ Noviscia programs. Assumes runtime/BPF safety, no rent griefing of owned PDAs. |
| T-prog | Between programs (CPI). **Most exploited boundary in this codebase** — the `seeds::program` CPI-confusion class (real bugs, fixed; see `ACCOUNT_MAP.md` §3). |
| T-admin | Program upgrade authority ↔ users. Targeted *single-key upgrade authority* is the current devnet reality; mainnet requires Tier-3 (council Squads). |
| T-oracle | External price providers. Assumes Pyth + Switchboard on-time updates; dual-feed ±35 bps covenant (507 `CrossOracleSkew`). |
| T-op | Institutional operators (credit lines, venues, cranks). Assumes malicious-operator resistance = on-chain constraining instruction, not trust. |
| T-ui | Frontend/indexer → user wallets. Read-harvesting, phishing, fake RPC endpoints. |

## 3. Actors

| Actor | Capability | Trust |
|---|---|---|
| Retail LP | deposit/withdraw nvscUSDC | none (permissionless) |
| HFT borrower (headless) | JIT risk slots, perp margin | none |
| Institution | credit-line draw/repay via asset-engine | constrained by on-chain parameters (credit ceiling, windows, frozen flag) |
| JIT MM / venue operator | auctions, gateways, capacity | constrained by registry states |
| Crank operator (clearing) | permissionless sweep | none |
| Oracle (Pyth/Switchboard) | price updates | time-to-live (stale windows) + skew covenant |
| Tier-1 breaker | fast pause authority | high (fast, single-party, auditable) |
| Tier-2 risk committee | parameter authority (cash prepay, margin model, exposure) | high |
| Tier-3 council | upgrade / multisig authority via Squads + timelock | highest, highest-inertia |
| Deployer dev key | devnet upgrade authority (`pm2tUw…`) | **single point on devnet; must not proxy to mainnet** |

## 4. Threat register (STRIDE-lite, severity-ranked)

| ID | Threat | Target | Vector | Mitigations (where) |
|---|---|---|---|---|
| T-1 | **CPI seed confusion** — attacker presents a foreign owned key where a Noviscia PDA expected (`seeds::program` missing) → funds/token mint binding wrong | A1,A2,A4 | crafted IX layouts | `seeds::program = <owner>` enforced; regression e2e (`sweep_expired_claims`); `ACCOUNT_MAP.md` §3 |
| T-2 | **Single-key upgrade capture** — key compromise = instant full asset theft via upgrade | A1–A9 | phishing/leak of upgrade key | Tier-3 council Squads + timelock (mainnet); devnet single key flagged in readiness; `KEY_MANAGEMENT_GOVERNANCE.md` |
| T-3 | **Oracle divergence / staleness** — skew > ±35 bps or stale feed prices a bad liquidation/settlement | A1,A2,A4 | Switchboard reporting issue, downtime | dual-feed cross-check (507), stale-window guards (`OracleStale`, `CollateralOracleStale`), price-deviation limits (6026/6091/6060), circuit breakers |
| T-4 | **Liquidity run / redemption capex** — withdrawal tsunami breaks nv-usdc-vault | A1 | mass redemptions, panic | `WithdrawalRateLimited` (6012), `RedemptionCapExceeded` (6011), cooldowns, `InsuranceBuffer` floor (6016) |
| T-5 | **Insolvency underestimation** — risk model missized (leverage, health bitmap staleness, partial-liq cooldown window) → tail loss exceeds insurance | A1,A4,A6 | extreme-vol shocks | `PositionInsolvent`, `HealthTrackerMismatch`, `EmergencyPaused`, partial-liq cooldown (6066), loss waterfall (`INSOLVENCY_POLICY.md`) |
| T-6 | **Credit-window abuse (asset-engine)** — institution draws during lead-payment/breach windows misaligned to repayment schedule | A3 | timing abuse | `WindowOverdue`/`WindowBreached` (6019/6020), `CreditLineFrozen` (6009), LatePremium checks (6022) |
| T-7 | **JIT tip arbitrage / capacity bypass** — MM wins tip then fails capacity; or insurance-source truncation | A5 | auction gaming | `LossRatioFreeze` (6022), `Receipt*` guards (6017–6020), `InsuranceSourceTruncated` (6025) |
| T-8 | **Governance capture** — ve-nvs bribe / staker dominates votes to mutate upgrades or fee params | A8,A7 | bribery, whale stacking | quorum + timelock (`QuorumNotMet` 6020, `TimelockPending` 6031), proposal actions allowlist (6027) |
| T-9 | **Bundle griefing / partial fill** — MEV holds a required leg of a Jito bundle | A1,A2,A5 | Solana priority-race | bundle atomicity (Jito), ordering in sweep e2e; monitor bundle drop rate |
| T-10 | **Reentrancy / state mutation during CPI** | A1,A4 | crafted CPI chains | `ReentrancyDetected` (6095 position-tracker); anchor CPI guards audited in sweep work |
| T-11 | **Account-deserialize/size bugs** leaking or corrupting cross-IX state | A4 | oversized instruction | `InvalidAccountSize`, `AccountDidNotSerialize` (3004) regression; struct-split remediation (see `AUDIT_GAP_ANALYSIS.md`) |
| T-12 | **KYC/AML ring bypass** (permissioned pool) | A6 | forged merkle proofs / stale KYc | `InvalidMerkleProof` (6009), `KycExpired` (6010, also asset-engine 6018); on-chain provenance of the verifier |
| T-13 | **Insider admin (Tier-1/Tier-2 abuse)** — pause/key to freeze LPs, or parameter dump to drop insurance | A1,A2,A6 | compromised committee | tiering + multisig + audit log; breaker events emitted on-chain; governance doc |
| T-14 | **Flash-loan self-liquidation raids** | A4 | borrowed collateral floods | free-collateral accounting (`CollateralWithdrawalExceedsFree` 6072), price-slippage liquidity guards (6096/6093) |

## 5. Priority attack paths (kill-chain)

1. **Key-first:** compromise Tier-3/deployer key → upgrade program → drain. Mitigated only by
   multilayer keys + timelock + monitoring (highest ROI for any single-actor adversary).
2. **Protocol-sandwich:** find one `seeds::program` vacancy (class T-1) → route PPDA into a
   look-alike owned account → mint/withdraw mismatch. Root-cause class already exercised twice
   (vault/sweep fixes) — treat any *new* cross-program account as suspect.
3. **Oracle sandwich:** manipulate Switchboard round while Pyth flat → push cross-oracle skew or
   lapse staleness windows → force liquidations/settlements at bad prices. Dual-feed ±35 bps +
   stale windows are the control.
4. **Run-on-the-vault:** simultaneously redeem nvscUSDC across pools while triggering
   `CcpEquityInsufficient`. Insurance fund + cooldowns slow the attack; `EmergencyPaused` closes it.
5. **Governance capture via ve-nvs:** accumulate NVSC ~ one lock period, out-vote committees on
   parameter changes. Quorum + timelock deny fast capture.

## 6. Controls mapping (threat → defense → doc)

| Threat | Primary control | Where |
|---|---|---|
| T-1 | `seeds::program` on all foreign-CPI PDAs; e2e regression | `ACCOUNT_MAP.md` §3, `E2E_TEST.md` |
| T-2 | council Squads + timelock; key-splitting | `KEY_MANAGEMENT_GOVERNANCE.md`, `MAINNET_READINESS.md` |
| T-3 | dual-feed skew + stale guards + confidence | `ERROR_REFERENCE.md` §2.20, `MONITORING.md` |
| T-4…T-6 | cooldowns, windows, frozen flag, insurance floors | `SECURITY.md`, `INSOLVENCY_POLICY.md` |
| T-8 | quorum, allowlist actions, timelock | `MASTER_LOAN_AGREEMENT.md` clause↔instruction table |
| T-13 | tier split + multisig + emitted events | `ONCALL_RUNBOOK.md`, `KEY_MANAGEMENT_GOVERNANCE.md` |

## 7. Residual risk to accept at mainnet

- Validator-level compromise (T-chain) and RPC-layer manipulation can only be surfaced, not
  prevented.
- `ClaimUserFunds`/`sweep` paths still derive foreign PDAs against the clearing program id
  (tracked open item) — mitigation is exercised before promotion, not in the code.
- Deployer-key single-custody is devnet-only; mainnet must reach Tier-3 before asset migration
  (`MAINNET_READINESS.md`).

## 8. Re-review triggers

Review this model when: a new program/account crosses an existing trust boundary (new CPI owner),
a new authority role is added, or oracle/withdrawal mechanics change. Record the review in the
header date.