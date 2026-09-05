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

6. **crates.io + npm publishing (sdk delivery path)**
   - `noviscia-types` 0.2.0 and `noviscia-asset-engine-sdk` 0.2.0 published to crates.io
     (dependency order: types → asset-engine-sdk); `@noviscia/sdk` 0.4.0 published to npm
     with the new `jito` module. Prep commits `41a012f`, `808a1ac`, `3185102`, `2d01e16`;
     publish itself is registry-side (no commit).

7. **Jito Block Engine tip submission (borrower flow)**
   - `sdk/src/jito.ts` closes the previously-open lander gap: `assembleVersionedTransactions`
     compiles the atomic pull → venue trade → repay sequence into one-blockhash
     `VersionedTransaction`s with the conditional leader tip (`SystemProgram.transfer` to a
     rotated tip account) appended to transaction 0; `JitoBundleClient` submits base64 bundles
     via the Block Engine JSON-RPC (`sendBundle`, `getTipAccounts`, `getBundleTipLimits`,
     `getBundleStatuses`) with `JitoRpcError` handling. Verified by 14 mocked-network tests
     (src/jito.test.ts). Remaining: devnet field-test of bundle landing (open item).
     See the SDK palette commit (`sdk/src/jito.ts`).

8. **Quantified Risk Pack & economics model (unit-economics sheet)**
   - The slot-fee model, $10M reference balance sheet (`$460,800 / $403,888 / $80,777.60 /
     $323,110.40 / $315,000 / $8,110.40`), tranche split and the 50%-of-junior hard-lock
     floor are implemented as deterministic integer-cents math in
     `noviscia-asset-engine-sdk::economics` (Rust, 0.3.0 published) and mirrored in
     `@noviscia/sdk` → `economics.ts` (0.5.0 published). Spec: `docs/QUANTIFIED_RISK_PACK.md`.
     Cap wiring delivered via `scripts/e2e/e2e-asset-engine-capwire-devnet.ts` (on-chain apply
     gated on deployment, see current-state gap 1).

9. **Vault reserve math + atomic recall proofs**
   - `sync_total_assets`/`update_total_assets` NAV and every redeem/withdraw guard subtract
     `non_lp_reserves(cfg)` (insurance backstop + default fund + CCP equity). The NAV formula was
     extracted to a pure, unit-tested helper `compute_lp_nav` (vault balance + yield receivables −
     reserves − unrealized trader PnL), both instructions now delegate to it, and the previously
     **orphaned `src/tests.rs` was wired in** (`mod tests`) and rewritten to cover the real
     helpers (`compute_mint_shares`, `compute_redeem_usdc`, `compute_ccp_alloc`,
     `compute_fee_insurance_split`, `non_lp_reserves`, `lp_owned_assets`, `compute_lp_nav`,
     `accrue_slot_yield`) — `nv-usdc-vault` now runs 50 tests, all green. Atomic recall proofs
     remain in `position-tracker/tests/atomic_recall_e2e.rs`.

10. **Netting-floor forward integration test**
    - A `cargo test-sbf` integration test (`netting_engine::tests::floor_forward`) now boots the
      netting engine, registers two perps venues, runs a fully offsetting long/short (2 USDC × 2
      legs, net 0 / gross 4 USDC), and consolidates the 2-leg netting set. The test proves
      end-to-end that: (a) the raw correlation-netted margin (12,000) is below the D-3 floor
      (48,000); (b) `cross_margin_requirement` returns the floor (floor BINDS, netting is a boost,
      never a substitute); (c) `consolidate` mirrors `margin_required_usdc` into
      `house_book.default_fund_target_usdc` (CPMI-IOSCO: default fund sized off the largest
      netting-set requirement); (d) a superseding larger netting set re-sizes the default-fund
      target upward. The netting relayer itself (`services/netting-relayer`) was already wired into
      `docker-compose.yml` and verified as a permissionless crank.

11. **CCP lifecycle expiry & residual sweep**
    - `sweep_residuals` already routed dust to the vault NAV. The missing piece —
    `sweep_expired_claims` — is now implemented in `noviscia-clearing`: a permissionless batch
    sweep (`remaining_accounts`) of expired, unclaimed *winning* positions past the 30-day
    `CLAIM_EXPIRY_SECS` window. Each batch account is seed-validated + owner-checked and
    deduplicated, the summed `potential_return` moves market_vault → fee-staging → vault NAV via
    `accumulate_protocol_fees` (market PDA + clr-config PDA sign, `expire_claim` alone had only
    flipped the claimed flag, leaving payouts frozen), then each position is marked claimed with a
    chained state hash. Expiry predicate extracted as unit-tested `claim_expiry_reached`
    (4 new tests; `noviscia-clearing` now 48 green). Instruction-level batch CPI remains covered
    only at the unit level; an end-to-end program test of the sweep is a follow-up nice-to-have.

## Open gaps (from the legacy CCP suite)

1. **Gateway production auth** — `sdk/gateway` supports WalletAdapter signing + sandbox, but
   tenant authentication, server-side auth middleware, and HSM/remote-signer adapters are not
   implemented.

## Current-state gaps in the institutional stack

1. **Asset engine on live devnet** — the program (ID `4FP4vWmTxnRHPkZGu5q74EVhk792PMVhpEVRBo3BwUQ5`)
   is fully unit-tested (27) but rollout/verification against devnet and configuration of the
   deployed three-tier Squads keys is open; see `docs/DEVNET.md` for the deploy runbook.
2. **TS SDK parity verification against the on-chain program** — `@noviscia/sdk` 0.5.0 exposes
   the asset-engine builders + PDA derivations + LP-share math + the Jito bundle path (82 tests),
   but no devnet-facing integration test proves the TS builders interact with a deployed program
   byte-for-byte.
3. **Cross-tier evidence tooling** — **DELIVERED** (`scripts/e2e/e2e-rbac-tier-evidence-devnet.ts`):
   proves RBAC tier mapping (breaker/committee/upgrade) purely from the on-chain registry without
   trusting the SDK. Trust-free: recomputes `sha256("account:AssetRegistry")[0..8]` locally, raw
   decodes the three keys at struct offsets, checks nonzero/pairwise-distinct, and cross-validates
   every tiered SDK builder's signer against the raw keys. Offline proof green (`--self-test`, exit
   0); the on-chain run is gated on the program actually being deployed at `4FP4…BwUQ5` (gap 1).
4. **Gateway bridge for the asset engine** — the Unified Collateral Gateway does not yet route
   institutional asset-engine intents; the engine is reachable via SDK builders only.
5. **Jito bundle field-test on devnet** — the SDK lander is unit-tested offline (mocked fetch);
   a live submission against `devnet.block-engine.jito.wtf` proving bundle landing + tip auction
   acceptance is not yet demonstrated.
6. **Derived-cap → on-chain wiring** — the quantified economics module derives reference caps
   (`$6M` aggregate / `$1.5M` desk) for a pool size, and
   `scripts/e2e/e2e-asset-engine-capwire-devnet.ts` now provisions them (cold-start `initialize` +
   `register_asset` + Tier-2 `update_credit_limit` / per-asset `update_asset_params` `max_capacity`,
   dry-run by default). The on-chain apply is gated on the program actually being deployed at
   `4FP4vWmTxnRHPkZGu5q74EVhk792PMVhpEVRBo3BwUQ5` (open gap 1 above); see `docs/DEVNET.md` §
   "Asset engine cap-wiring".

## Recommended priorities

1. Asset-engine devnet rollout + Squads key standing-up (institutional readiness; unblocks the cap
   wire's `--apply`)
2. ~~CCP `sweep_expired_claims` end-to-end program test~~ **CLOSED** — forward e2e in
   `tests/sweep_expired_claims.rs` passes (market_vault → fee_staging → vault NAV split via
   `compute_fee_insurance_split`, positions hash-chained to claimed) plus four negative probes
   (mismatched outcome / duplicate-in-batch / already-claimed / empty batch). Fixes landed:
   `seeds::program = nv_usdc_vault::ID` on the three clearing vault_config PDAs and an 8-byte
   discriminator overrun in `save_position_to_info`. Latent follow-up: `ClaimUserFunds` still
   derives `vault_config`/`vault_authority` against the clearing program id (adding
   `seeds::program` currently overflows the SBF stack frame — needs a struct split).
3. Jito bundle field-test on devnet (borrower path E2E)
4. Gateway production auth + asset-engine intent bridge (medium)
5. ~~Cross-tier RBAC evidence script (breaker/committee/upgrade purely from on-chain registry)~~
   **PARTIALLY CLOSED** — `scripts/e2e/e2e-rbac-tier-evidence-devnet.ts` shipped with
   `--self-test` (offline pipeline: discriminator recompute, raw key decode, distinct-authority
   check, all tiered-SDK-builder signer cross-validation, plus anti-drift/oracle-teeth negative
   probes). Remaining: run against the live devnet registry once the engine is deployed
   (priority 1).