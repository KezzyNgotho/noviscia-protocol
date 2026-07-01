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
| `position_tracker` | Perp positions, dual oracle, liquidation, fees, JIT/AMM |
| `escrow` | Margin custody, Omni-Pool sweep, atomic recall, multi-asset collateral, sub-accounts |
| `nv_usdc_vault` | Sovereign Omni-Pool — USDC ↔ nvscUSDC, NAV accrual, fee_index |
| `liquidation_vault` | Insurance fund, bad-debt coverage |
| `staking_manager` | NVSC staking, governance proposals, fee-tier discounts |
| `burn_engine` | Protocol fee accumulation, permissionless burn trigger |
| `protocol_lp_vault` | Trading-fee LP vault, share-based NAV |

Out of scope for v1 audit: `token_nvsc`, `yield_distributor`, `prediction_market`.

---

## Known risk areas (pre-audit self-assessment)

These areas have been identified internally as warranting close scrutiny. They are documented here to give auditors a starting point, not as an exhaustive list.

### 1. Escrow recall atomicity
`recall_for_trade` in `escrow/src/lib.rs` is CPI-called by `position_tracker` in the same transaction as `open_position`. The check `lent_amount == 0` after recall must hold under concurrent transactions. Verify there is no TOCTOU window.

### 2. Oracle freshness enforcement
`position_tracker` enforces a staleness bound (`MAX_ORACLE_AGE_SLOTS`) on `PerpOracleState.updated_at`. Verify this bound is correctly applied across `open_position`, `close_position`, `liquidate_permissionless`, `liquidate_sub`, and `execute_tp_sl`. Pull-oracle path bundles `update_oracle_from_pyth` in the same tx — verify the slot check cannot be bypassed.

### 3. Liquidation fee split
`liquidate_permissionless` and `liquidate_sub` split the penalty 20% to caller / 80% to protocol. Verify the arithmetic is safe against overflow/rounding and that `pay_liquidator_from_protocol` cannot be called with an arbitrary `liquidator_fee` exceeding the actual penalty.

### 4. Admin-gated instructions
Several instructions are admin-gated (`set_omnipool_params`, `set_collateral_weight`, `set_governance_authority`, migration helpers). Verify admin key is a multisig or at minimum documented. Centralization risk should be noted.

### 5. nv-usdc-vault `vault_authority` PDA
The vault's `accumulate_protocol_fees` is callable by anyone but only advances NAV — it cannot withdraw funds. Verify no other instruction path allows unauthorised withdrawal from `vault_usdc`.

### 6. Sub-account isolation
Sub-account PDAs use `seeds = [b"user_state", user, &[sub_id]]`. Verify that a liquidation targeting sub_id=1 cannot touch sub_id=0's escrow, and that `settle_position_sub` only draws from the correct sub-account escrow.

### 7. `remaining_accounts` collateral loop
`liquidate_permissionless` and `adjust_margin` accept collateral oracle+position pairs via `remaining_accounts`. Verify the loop cannot be supplied with duplicate accounts, fake oracle PDAs, or accounts owned by a different program to inflate collateral value.

---

## Pre-audit checklist

- [x] All programs compile cleanly (`cargo build-sbf`)
- [x] Rust workspace dependency graph clean (no lending-integrator or external venue CPI)
- [x] TypeScript SDK compiles cleanly (`tsc --noEmit`)
- [x] Key e2e flows proven on devnet (deposit → sweep → open → close → re-sweep; liquidation bounty; sub-account isolation)
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
