# TVT ↔ CCP Integration Audit — Truthful Current State

**Date:** 2026-09-01
**Audit scope:** how far the `jit-risk` (TVV) engine is actually integrated with the
CCP core (`nv-usdc-vault`, `position-tracker`) *in code today*, versus what the
`TVV_FINANCIAL_ENGINEERING.md` spec claims. This is the evidence base for the
reconciled narrative.

---

## 1. TL;DR

The TVV engine is **a real, running program** with the full spec math enforced on-chain
(writable base, concurrency cap, concentration caps, premium split, loss-ledger freeze).
It is **genuinely wired into the CCP's vault for the NAV share** — the marketplace PDA is
an *authorized fee authority* of `nv-usdc-vault::accumulate_protocol_fees`, and
`sweep_premiums` CPI-pushes premium into the omni-pool.

But two spec claims were **not** wired as written — **both are now closed** (2026-09-01):

| Spec claim (§9) | Reality in code | Status |
|---|---|---|
| New `FEE_TYPE_CAPACITY = 4` enum entry | Vault had only `TRADING=0, LIQUIDATION=1, FUNDING=2, PREDICTION=3`; `sweep_premiums` called with `FEE_TYPE_TRADING` | ✅ **Fixed** — `FEE_TYPE_CAPACITY = 4` added (`nv-usdc-vault`), `sweep_premiums` now routes through it (uses the `fee_to_yield_bps` partition path, correct for LP yield) |
| `insurance_fund_floor_usdc` "mirrors position-tracker" | Synchronized at init/`update_params` admin-update only; no live read | ⚠️ **Wired** — new authority-gated `jit-risk::sync_insurance_floor` reads `position-tracker::Market.insurance_fund_usdc` (stable byte offset) and writes the marketplace floor, so W excludes the real perps insurance carve-out |

Everything else in §9-§10 that touches money-movement is implemented.

---

## 2. What is real and enforced on-chain

### 2.1 The time-slice contract (`programs/active/jit-risk`)

- **State** (`constants.rs`): `MarketplaceState` carries the full spec surface —
  `insurance_fund_floor_usdc`, `writable_bps` (ψ), `risk_budget_bps` (RB),
  `max_slice_usdc`, `max_slot_age`, `delta_min/max_wad`, `premium_min`,
  `outstanding_usdc` (O_t), `collateral_held_usdc`, `premium_ledger_total`,
  `loss_ledger_reserve`, `backstop_reserve`, `frozen`.
- **Capacity math** (`math.rs`): `writable_base(W_t = vault − collateral − floor −
  losses − backstop)`, `capacity_cap(O_t ≤ ψ·W_t)`, `collateral_required(C=A(1+h))`,
  `settle_waterfall`, `loss_ratio_bps`, `check_delta_bounds`. All unit-tested.
- **Enforcement** (`capacity.rs`): shared gate for atomic/in-flight slices; also a
  post-write invariant (`assert_capacity_preserved`) that recomputes the cap from the
  mutated ledger so any drift aborts the tx.
- **Instructions**: `initialize_marketplace`, `register_mm`, `rent_slice` (atomic),
  `reserve_slice` (in-flight), `settle_slice`, `reap_expired_slice`, `sweep_premiums`,
  `update_params`, `freeze`, `suspend_mm`.
- **Default handling** (`settle_waterfall` + `settle_slice`/`reap`): losses are absorbed
  first from the slice's collateral (forfeiture), residual within `RB·A` hits
  `loss_ledger_reserve`; when `loss/premium ≥ 80%` the marketplace auto-freezes.
  Loss impairs the *writable base* — it does **not** draw the perps insurance reserve,
  which is exactly the ordering the spec wants (slice losses junior to perp claims).

### 2.2 The NAV sweep into the CCP omni-pool

- `sweep_premiums` computes the 85/15 split (`NAV_SPLIT_BPS=8500` / `BACKSTOP_SPLIT_BPS=1500`),
  CPI-calls `nv-usdc-vault::accumulate_protocol_fees` for the **NAV share (85%)**, and keeps
  the **backstop share (15%)** locked in `backstop_reserve`.
- The vault's `accumulate_protocol_fees` **authorizes the jit-risk marketplace PDA**
  as a first-class fee authority (via `expected_jit_marketplace =
  find_program_address(["marketplace"], JIT_RISK_PROGRAM_ID)`), alongside the perps
  pt-config, clearing clr-config, sovereign revenue, gateway, and credit-line ledgers.
- So the premium actually **lands in the omni-pool**, grows `fee_index`/NAV, and the
  insurance reserve gets its dynamic carve-out. The TVV yield *is* CCP-LP yield.

---

## 3. What is still NOT wired as the spec claims

### 3.1 ✅ Closed — `FEE_TYPE_CAPACITY = 4` (2026-09-01)

- Vault now defines `FEE_TYPE_CAPACITY: u8 = 4` alongside `TRADING=0, LIQUIDATION=1,
  FUNDING=2, PREDICTION=3`.
- `sweep_premiums.rs` now passes `nv_usdc_vault::FEE_TYPE_CAPACITY` (was
  `FEE_TYPE_TRADING`). With a `PrincipalPartition` configured it routes through
  `fee_to_yield_bps` (capacity premium is LP yield, like trading/funding fees — the
  correct sink); legacy no-partition path uses the dynamic insurance carve-out as
  before. Other programs' `FEE_TYPE_TRADING` sweeps (gateway, position-tracker fees,
  credit-line, sovereign-netting) are genuinely trading fees and are unchanged.

### 3.2 ✅ Closed — safety floor now live-synced (2026-09-01)

- New authority-gated instruction `jit-risk::sync_insurance_floor` reads
  `position-tracker::Market.insurance_fund_usdc` (stable byte range 112–120:
  discriminator + fixed prefix fields, offsets confirmed by `position-tracker` `resize`/
  init code) and writes `marketplace.insurance_fund_floor_usdc` to match.
- The source account is owner-checked against `POSITION_TRACKER_PROGRAM_ID` and
  length-guarded (new errors: `InvalidInsuranceSource`, `InsuranceSourceTruncated`).
- **Trust model:** same as `update_params` (`has_one = authority`). The operator calls
  `sync_insurance_floor` (directly or via a keeper) to reconcile the floor with the
  real perps carve-out; `update_params.insurance_fund_floor_usdc` remains as an
  emergency override. If position-tracker's insurance ledger moves (liquidation sweeps
  in, waterfall payouts out), a sync keeps jit-risk's writable base honest.
- **Single-market assumption:** `MarketplaceState` is one global account; the sync
  takes one `Market`. For a devnet demo (one perps market) this is exact. If multiple
  perps markets are ever configured, the operator must pass the market the marketplace
  protects (or evolve to summing across markets).

### 3.3 ✅ On-chain synthetic-volume flag (§3.3 redline)

- Self-rent *is* structurally bad for the perp (premium is irrevocably lost), and the
  loss ledger + CUR are tracked. The full arb-flow-correlation check (comparing on-chain
  slice activity against independent price/feed data) requires off-chain data and was
  originally the role of the removed `risk-engine` service (§9). The on-chain implementation
  is a **heuristic flag**: `flag_desk` (authority-gated) reads per-MM metrics (slices_written,
  slots_occupied, win/loss ratio, outstanding ratio) and emits a `SyntheticDeskFlagged` event
  with all heuristics for governance to act on. `slots_occupied` (distinct slots where an MM
  rented) is tracked in `MmRegistration` during `rent_slice` to detect concentrated/repeated
  same-slot renting. Governance calls `suspend_mm` separately based on the flagged evidence.

**Deployment status (2026-09-02):** IDLs for `jit-risk` and `nv-usdc-vault` regenerated
(via `anchor build -p <name>`) and synced to `app/web/app/idl/`; the SDK client gained
`flagDesk`, `syncInsuranceFloor` and the corrected `sweepPremiums` account set.
**Redeployed to devnet live (2026-09-02):** `jit-risk` and `nv-usdc-vault` both upgraded
in place via `solana program deploy --program-id` at their existing program IDs
(jit-risk slot 492046059, nv-usdc-vault slot 492046357).

---

## 4. Reconciliation implications (what this means for the name/gap)

- **The CCP core is the balance sheet.** `nv-usdc-vault` is the single omni-pool; the
  perps/clearing/gateway/credit-line/sov-net revenue all sweep into it and grow one
  `fee_index`. Jit-risk premium now joins that same pool. This makes TVV **the CCP's
  yield engine**, not a tenant — the napkin math of §2.2 is the strongest evidence.
- **The gap the naming exposes is narrow and — as of 2026-09-02 — fully closed:**
  1. ✅ `FEE_TYPE_CAPACITY=4` added; jit premia route through it (honest fee accounting).
  2. ✅ `insurance_fund_floor_usdc` live-synced from the real perps
     `position-tracker::Market.insurance_fund_usdc` via `sync_insurance_floor`
     (operator-triggered; `update_params` retains the emergency override).
  3. ✅ On-chain synthetic-volume flag (`flag_desk`) + `slots_occupied` tracking
     (heuristic §3.3 redline; governance calls `suspend_mm` based on evidence).
- **The correct summary sentence:**
  > Noviscia is a CCP whose idle, pooled capital is reused as slot-scoped contingent
  > capacity (TVV). The CCP is the risk/counterparty core; TVV is its capital-velocity
  > revenue engine. Both already share one balance sheet.

---

## 5. Files & lines referenced

| Item | Location |
|---|---|
| Fee-type constants (0–3) | `programs/active/nv-usdc-vault/src/lib.rs:135-140` (now incl. `FEE_TYPE_CAPACITY = 4`) |
| Vault `accumulate_protocol_fees` auth (incl. jit marketplace) + legacy routing | `programs/active/nv-usdc-vault/src/lib.rs:1369-1470` |
| Jit `sweep_premiums` (85/15 split, CPI with `FEE_TYPE_CAPACITY`) | `programs/active/jit-risk/src/instructions/sweep_premiums.rs` |
| Floor live-sync instruction (owner-checked read of `position-tracker::Market.insurance_fund_usdc`) | `programs/active/jit-risk/src/instructions/sync_insurance_floor.rs` |
| Position-market floor byte offset + program id consts | `programs/active/jit-risk/src/constants.rs` (`POSITION_MARKET_INSURANCE_FUND_START/END`, `POSITION_TRACKER_PROGRAM_ID`) |
| `MarketplaceState` (floor, ψ, RB, O_t, ledgers) | `programs/active/jit-risk/src/constants.rs:60-107` |
| Writable-base + concurrency-cap math (unit-tested) | `programs/active/jit-risk/src/math.rs:11-41` |
| `validate_capacity` + `assert_capacity_preserved` | `programs/active/jit-risk/src/instructions/capacity.rs` |
| Manual floor set / tunable | `programs/active/jit-risk/src/instructions/initialize_marketplace.rs:90`, `update_params.rs:79` |
| Settle/reap loss ledger + auto-freeze | `programs/active/jit-risk/src/instructions/settle_slice.rs:138-186`, `reap_expired_slice.rs:98-116` |

**Status legend:** ✅ implemented & enforced · ⚠️ implemented but spec-mismatched · 🚧 design-only/off-chain