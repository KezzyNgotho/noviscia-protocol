# Audit Gap Analysis — Current vs Architecture Graph

This short audit-gap note lists missing pieces or partial areas relative to the architecture graph and recommended priorities.

1. Netting feedback enforcement
- Status: partially implemented. `open_position_jit` applies `netting_venue_margin_floor` in some paths; audit all open paths and add unit tests.
- Risk: un-enforced floor permits under-margined opens.
- Action: add tests in `position-tracker/tests` verifying floor application and a relayer (cron) to run `consolidate` permissionlessly.

2. Atomic recall / vault reserve accounting
- Status: tests for recall exist (`atomic_recall_e2e`, `liquidate_recalls_when_pool_is_short`). `nv-usdc-vault::non_lp_reserves` helper referenced.
- Gap: ensure `sync_total_assets` and all redeem/withdraw guards subtract `non_lp_reserves(cfg)`; add unit tests in `nv-usdc-vault` covering reserve-aware math.
- Action: audit `nv-usdc-vault` checks, add `non_lp_reserves` + `lp_owned_assets` helpers where missing.

3. CCP lifecycle — claim expiry & residual sweep
- Status: claim flow exists (`claim_winnings`, `claim_refund`) and fee sweep exists (`withdraw_fees`).
- Gap: no claim expiry enforcement or automated residual sweep for stale unclaimed positions.
- Action: add `claimed_at` timestamp to `UserPosition` (done), add `sweep_expired_claims`/`sweep_residuals` instruction and tests.

4. Gateway auth + signed submission
- Status: `sdk/gateway` supports WalletAdapter signing and sandbox enforcement.
- Gap: tenant authentication + production-signer integrations (HSM/remote signer) not implemented.
- Action: implement tenant PDAs/session tokens, server-side auth middleware, and HSM signer adapters in gateway.

5. Audit & docs
- Status: many docs exist (ARCHITECTURE, CCP_CURRENT_STATE, AUDIT_REPORT), but a concise code-to-architecture trace is missing.
- Action: produce a mapping doc that points to specific code locations for each architectural component (done: this file; follow-up: detailed pointers per module).

Priorities (recommended):
1. Vault reserve math + atomic recall proofs (high risk)
2. Netting floor enforcement + consolidate relayer (medium-high)
3. CCP lifecycle expiry & sweep (medium)
4. Gateway production auth (medium)
5. Full audit write-up with line-level pointers (low-medium)

