# Noviscia Protocol — Security Audit Report

**Status:** Pre-audit — independent review not yet completed  
**Last updated:** July 2026

---

## Current status

No independent third-party security audit has been completed as of this writing. **Do not use mainnet funds or real assets until the audit is complete and findings are published.**

This document will be updated with the full audit report upon completion.

---

## Audit scope (planned)

The following programs are in-scope for the planned pre-mainnet audit:

| Program | Description |
|---------|-------------|
| `position_tracker` | JIT Pyth pull-oracle perp engine — open/close/liquidate, peer-to-peer funding, insurance fund, trading fees, TP/SL, limit/TWAP orders |
| `nv_usdc_vault` | Single share-based USDC vault — NAV accrual, fee/liquidation-revenue sweep |
| `protocol_lp_vault` | Trading-fee LP vault, share-based NAV |
| `staking_manager` | NVSC staking, governance proposals, fee-tier discounts |
| `burn_engine` | Protocol fee accumulation, permissionless burn trigger |

Out of scope for v1 audit: `token_nvsc`, `yield_distributor`, `prediction_market`, `escrow` (legacy — not part of the perps margin path; see root `README.md`).

---

## Known risk areas (pre-audit self-assessment)

These areas have been identified internally as warranting close scrutiny — updated 2026-07-06 to reflect `position-tracker`'s JIT-oracle rewrite. Not an exhaustive list.

### 1. JIT oracle freshness enforcement
Every price-sensitive instruction (`open_position_jit`, `close_position`, `liquidate`, `execute_tp_sl`) calls `verify_jit_price`, which checks the Pyth Hermes VAA's embedded publish time against a strict ≤3-second ceiling before trusting it. Verify: (a) the ceiling is enforced identically across all four call sites, (b) the check cannot be satisfied by a VAA that's valid-but-stale relative to wall-clock time due to a slow `post_update_atomic` CPI, (c) `merkle_price_update_bytes`' hand-rolled Borsh encoding (`encodeMerklePriceUpdate`) can't be crafted to pass verification against a different price than the one actually used downstream.

### 2. Liquidation fee split and insurance-fund carve-out
`liquidate` splits the forfeited collateral 20% caller / 80% protocol-retained, then splits that 80% again — 10% to `Market.insurance_fund_usdc`, 90% to vault NAV via `accumulate_protocol_fees`. Verify: the double-split arithmetic is safe against overflow/rounding at both small (sub-cent) and large notional sizes; `caller_bounty_shares`/`protocol_shares` can't be manipulated to exceed the position's actual `collateral_shares`; a self-liquidation (trader == liquidator, permitted by design) can't be exploited to extract more than the intended 20% bounty.

### 3. Peer-to-peer funding settlement
`settle_funding` moves `Market.funding_index` as `skew * FUNDING_RATE_BPS_PER_SETTLE * FUNDING_INDEX_SCALE / BPS_DENOMINATOR / total_oi`. Verify: this cannot be called fast enough (bypassing `FundingSettleTooSoon`) to compound an outsized rate; the index calculation is symmetric (a long-heavy market charges longs and pays shorts by the same magnitude, and vice versa); `entry_funding_index` snapshotting at open and the delta computation at close/liquidate/TP-SL can't be gamed by opening/closing across a `settle_funding` call to extract funding without corresponding risk exposure.

### 4. Market risk-parameter validation
A live misconfiguration was found and fixed 2026-07-06: ETH's `max_leverage_bps`/`maintenance_margin_bps` combination made positions liquidatable at open with zero price movement. `register_market` and the new `set_market_risk_params` now both enforce `maintenance_margin_bps * max_leverage_bps < 10_000²`. Verify this invariant is sufficient (not just necessary) for safety across the full range of valid inputs, and that no other instruction can set these fields without going through the same check.

### 5. Admin-gated instructions
`set_market_fee_bps`, `set_market_risk_params`, `register_market`, `resize_market` are admin-gated via `pt_config.admin`. Verify the admin key's operational security (multisig recommended before mainnet) and that no instruction allows privilege escalation to admin-equivalent capability from a non-admin signer.

### 6. `nv-usdc-vault` CPI trust boundary
`position-tracker` CPIs into `nv_usdc_vault` for `redeem_nvusdc`, `accumulate_protocol_fees`, and `adjust_locked_margin`, signing with the `pt_config` PDA. Verify `nv-usdc-vault`'s own account constraints don't allow a different caller program to reach these same CPI entry points and mutate vault state outside the intended flow.

### 7. Position PDA uniqueness / no increase-position path
`Position` is `init`-only per `(trader, market, sub_id)` with no increase/add-to-position instruction. This is a product-completeness question for auditors to flag, not a security bug per se: confirm the deliberate one-position-per-tuple design doesn't create an unexpected way to bypass the maintenance-margin check by never being able to "top up" an underwater position instead of closing and reopening.

---

## Pre-audit checklist

- [x] All programs compile cleanly (`cargo build-sbf`)
- [x] Rust workspace dependency graph clean (no lending-integrator or external venue CPI — `lending_integrator` deleted, external lending retired from `nv-usdc-vault`)
- [x] TypeScript SDK compiles cleanly (`tsc --noEmit`)
- [x] Key e2e flows proven live on devnet, 2026-07-06: open/close + trading-fee NAV increase; peer-to-peer funding settled exact against a hand-computed expectation; liquidation 20/80 split + insurance-fund carve-out (both NAV and `insurance_fund_usdc` deltas verified exact)
- [x] Live misconfiguration found and fixed (ETH market risk parameters) — see Known risk area #4
- [ ] Independent audit firm engaged
- [ ] Audit fieldwork complete
- [ ] Findings remediated or accepted with documented mitigations
- [ ] Public audit report published
- [ ] Mainnet deploy authorised

---

## Audit timeline

| Milestone | Target |
|-----------|--------|
| Firm engaged | Q2–Q3 2026 |
| Fieldwork | Q3 2026 |
| Report published | Q3 2026 (pre-mainnet launch) |

---

## Bug bounty

A responsible disclosure process is in place during devnet. See [`BUG_BOUNTY.md`](BUG_BOUNTY.md) for scope and reward structure. Critical findings during devnet beta should be reported privately before public disclosure.

---

*This document will be replaced with the full auditor report upon completion. Until then, treat the protocol as unaudited software.*
