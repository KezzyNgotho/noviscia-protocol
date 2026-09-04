# Audit Gap Analysis — Current vs Architecture Graph

This audit-gap note lists missing pieces or partial areas relative to the architecture graph
and recommended priorities. It is refreshed after each protocol delivery. Items are tracked to
the commit that closed them where applicable.

## Closed since the previous revision

1. **Netting feedback enforcement (partial)**
   - `open_position_jit` applies `netting_venue_margin_floor`. Remaining: forward-test
     coverage and a permissionless `consolidate` relayer (see open items).

2. **Institutional asset lifecycle — the full engine**
   - Multi-asset token register + segregated pools/vaults (`register_asset`, per-mint PDAs),
     JIT allocation with Merkle-KYC + rolling 24h window, daily clearing (`settle_daily`),
     recredit, ERC-4626 LP share vaults (`deposit/withdraw_asset_liquidity`) with the
     desk-solvency redemption floor, and zero-default safeguards (late-fee meter, breach
     handover). Commits `db58c52`, `e7bc4df`.

3. **Layered Governance Multi-Sig (three-tier RBAC)**
   - Three independent Squads keys (`breaker_authority` / `risk_committee_authority` /
     `upgrade_authority`) recorded in `AssetRegistry` and enforced at Anchor account
     validation: Tier 1 Breaker (1-of-3) → pause/freeze; Tier 2 Risk Committee (3-of-5) →
     limits/KYC/haircuts/support; Tier 3 Council (5-of-7, 72h timelock) → register/treasury/
     upgrades/initialize. Commit `f8888d6`.

4. **Master Loan Agreement (legal layer)**
   - Institutional MLA binding each legal clause to its on-chain enforcement point via the
     in-contract Schedule B bridge; governed by New York law; exposed on the frontend at
     `/more/docs/master-loan-agreement` with a canonical PDF. Commits `0c83206`, `b94fa14`,
     `fae2c6d`.

5. **Documentation ↔ code mapping**
   - `docs/ARCHITECTURE.md` now carries sections for the asset lifecycle (§3l), LP vaults
     (§3m), governance (§3n), and the MLA legal bridge (§3o). Gap-closure pointers tracked
     here.

## Open gaps (unchanged from the legacy CCP suite)

1. **Vault reserve math + atomic recall proofs** — ensure `sync_total_assets` and every
   redeem/withdraw guard in `nv-usdc-vault` subtract `non_lp_reserves(cfg)`; add reserve-aware
   unit tests and helpers (`non_lp_reserves`, `lp_owned_assets`).
2. **Netting floor enforcement** — add forward tests in `position-tracker/tests` and a relayer
   (cron) to run `consolidate` permissionlessly.
3. **CCP lifecycle expiry & residual sweep** — `claimed_at` timestamp exists; implement
   `sweep_expired_claims` / `sweep_residuals` instructions + tests.
4. **Gateway production auth** — `sdk/gateway` supports WalletAdapter signing + sandbox, but
   tenant authentication, server-side auth middleware, and HSM/remote-signer adapters are not
   implemented.

## Current-state gaps in the institutional stack

1. **Asset engine on live devnet** — the program (ID `4FP4vWmTxnRHPkZGu5q74EVhk792PMVhpEVRBo3BwUQ5`)
   is fully unit-tested (27) but rollout/verification against devnet and configuration of the
   deployed three-tier Squads keys is open; see `docs/DEVNET.md` for the deploy runbook.
2. **TS SDK parity verification against the on-chain program** — `@noviscia/sdk` 0.3.0 exposes
   the asset-engine builders + PDA derivations + LP-share math (64 tests), but no devnet-facing
   integration test proves the TS builders interact with a deployed program byte-for-byte.
3. **Cross-tier evidence tooling** — a single script/test that proves RBAC tier mapping
   (breaker/committee/upgrade) purely from the on-chain registry without trusting the SDK.
4. **Gateway bridge for the asset engine** — the Unified Collateral Gateway does not yet route
   institutional asset-engine intents; the engine is reachable via SDK builders only.

## Recommended priorities

1. Vault reserve math + atomic recall proofs (high risk)
2. Asset-engine devnet rollout + Squads key standing-up (institutional readiness)
3. Netting floor enforcement + consolidate relayer (medium-high)
4. CCP lifecycle expiry & sweep (medium)
5. Gateway production auth + asset-engine intent bridge (medium)