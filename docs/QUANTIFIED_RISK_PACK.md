# Quantified Risk Pack & Economics Sheet — TVV Engine Module 1

> **Version 1.0.** The audited unit-economics model that a risk committee can
> sign off on. Every formula runs in **integer arithmetic on USD cents** in two
> synchronized implementations, pinned by tests against every reference figure
> below:
>
> - **Rust:** `noviscia-asset-engine-sdk::economics` (published 0.3.0)
> - **TypeScript:** `@noviscia/sdk` → `economics.ts` (published 0.5.0)
>
> The reference scenario is the **$10,000,000 pool**. Both implementations
> scale to any pool size through `TvvParams` (`referenceTvvParams()` /
> `TvvParams::reference_10m()`).

---

## 1. Core Variable Framework

| Variable | Value | In code (`economics.rs` / `economics.ts`) |
|---|---|---|
| Total pool size (`P`) | $10,000,000 | `pool_usd_cents = 1_000_000_000` |
| Senior LP tranche (`P_sr`) | $7,000,000 (70%) | `senior_bps = 7_000` |
| Junior LP tranche (`P_jr`) | $3,000,000 (30%, first-loss) | `junior_bps = 3_000` |
| Systemic concentration cap (`C_sys`) | 60% of `P` = $6,000,000 | `systemic_cap_bps = 6_000` |
| Single-desk cap (`C_desk`) | 15% of `P` = $1,500,000 | `desk_cap_bps = 1_500` |
| Avg active slot utilization (`μ`) | 40% of `C_sys` = $2,400,000 | `avg_utilization_bps = 4_000` |
| Eligible Jito landing rate (`L_jito`) | 80% | `jito_landing_bps = 8_000` |
| Implied base annualized rate (`R_base`) | 24% | `base_rate_bps = 2_400` |
| Jito MEV bundle tip (`T_jito`) | 1.5% of gross | `jito_tip_bps = 150` |
| DIF reserve cut (`R_dif`) | 20% of net | `dif_bps = 2_000` |
| Bare-metal infra cost (`I_infra`) | $50,000 / year | `infra_usd_cents = 5_000_000` |
| Senior fixed hurdle | 4.50% | `senior_hurdle_bps = 450` |
| Hard circuit-breaker floor | 50% of junior layer | `circuit_breaker_drain_bps = 5_000` |

All bps are over `BPS = 10_000`; all money is integer USD cents
(`u64` in Rust, `bigint` in TypeScript — no floats anywhere).

## 2. Operational Yield Formulas

### Step A — Total slots per year
```text
S_total  = (60·60·24·365 s) / 0.4 s   = 78,840,000 slots/yr
```

### Step B — Eligible (Jito-landing) trading slots
```text
S_eligible = S_total × L_jito          = 78,840,000 × 0.80 = 63,072,000
```

### Step C — Micro-premium fee per slot
```text
F_slot = (μ × R_base) / S_total        = (2,400,000 × 0.24) / 78,840,000 ≈ $0.0073059/slot
```
Exact form in code is `slot_fee_micro_usd` (integer µUSD, floored). The sheet
never charges this fractionally: revenue is computed by the **closed form**
`μ × R_base × L_jito`, so the whole chain reconciles to the cent.

### Step D — Gross annualized revenue
```text
G_rev = F_slot × S_eligible ≡ μ × R_base × L_jito = $460,800.00
```

### Step E — Net revenue deductions
```text
N_rev = (G_rev × (1 − T_jito)) − I_infra = ($460,800 × 0.985) − $50,000 = $403,888.00
```

### Step F — Insurance buffer (DIF) allocation
```text
D_allocation = N_rev × R_dif = $403,888 × 0.20 = $80,777.60
```

### Step G — Total residual yield to LPs
```text
Y_total = N_rev − D_allocation = $323,110.40
```

## 3. Tranche Distribution & Senior Insulation

```text
Y_sr = P_sr × 4.50%          = $7,000,000 × 0.045 = $315,000.00   (contractual hurdle)
Y_jr = Y_total − Y_sr        = $323,110.40 − $315,000 = $8,110.40 (residual + ecosystem utility tokens)
```

## 4. Tail-Risk Structural Breakpoint

The $3,000,000 Junior First-Loss Layer sits entirely ahead of senior capital.
For senior principal to take even a single dollar of impairment, an event must
fully consume, in order:

1. the defaulting desk's **Escrowed Loss Reserves** inside the DIF;
2. the accumulated **Protocol Fee Reserves**;
3. the **entire $3,000,000 Junior Tranche**.

When a cascading liquidation drain reaches **50% of the junior layer
($1,500,000)**, the on-chain circuit breaker hard-locks: every credit facility
freezes to protect senior principal in place.

```rust
// noviscia-asset-engine-sdk::economics
assert!(!hard_lock_triggered(&p, 149_999_999)); // $1,499,999.99 → not tripped
assert!(hard_lock_triggered(&p, 150_000_000));  // $1,500,000.00 → HARD LOCK
```

## 5. Summary Account Specification Matrix

| Metric dimension | Baseline parameter | Verification status | Operational purpose |
|---|---|---|---|
| System aggregate cap | $6,000,000 (60%) | On-chain ceiling administered by Tier-2 (`total_credit_limit`) | Prevents multi-desk correlated defaults |
| Single-desk cap | $1,500,000 (15%) | On-chain per-asset `max_capacity` / limits | Caps maximum single-counterparty exposure |
| Junior first-loss layer | $3,000,000 (30%) | On-chain vault isolation (`junior_tranche_usd_cents`) | Insulates senior LPs from tail events |
| Jito landing-rate gate | 80% minimum | Off-chain epoch tracking (`jito_landing_bps`) | Halts borrowing on non-bundle blocks |
| LoC bank haircut | 25% flat | Risk-committee applied (governance) | Accounts for legal/operational draw times |

> **On-chain parity note:** the matrix cells are *reference* targets for the
> $10M pool. On-chain, these are **administrable ceilings** — Tier-2 Risk
> Committee sets `total_credit_limit` / `max_capacity`; the economics module
> derives the exact USD figures (`systemic_cap_usd_cents`, `desk_cap_usd_cents`)
> a committee should configure for a given pool size.
>
> **Provisioning:** `scripts/e2e/e2e-asset-engine-capwire-devnet.ts` derives the
> `$6M` / `$1.5M` caps from this module and provisions them into the devnet
> asset-engine registry (cold-start `initialize`/`register_asset`, then Tier-2
> `update_credit_limit` / per-asset `max_capacity`) — dry-run by default, `--apply`
> to send. On-chain apply is gated on the engine being deployed at
> `4FP4vWmTxnRHPkZGu5q74EVhk792PMVhpEVRBo3BwUQ5` (tracked in
> `docs/AUDIT_GAP_ANALYSIS.md`). The institutional web page also surfaces the
> derived caps on `/institutional/asset-lifecycle`.

## 6. Code ↔ Doc Mapping

| Doc symbol | Rust (`noviscia-asset-engine-sdk::economics`) | TS (`@noviscia/sdk` → `economics.ts`) |
|---|---|---|
| `S_total` | `total_slots_per_year()` | `totalSlotsPerYear()` |
| `S_eligible` | `eligible_slots(p)` | `eligibleSlots(p)` |
| `C_sys` | `systemic_cap_usd_cents(p)` | `systemicCapUsdCents(p)` |
| `C_desk` | `desk_cap_usd_cents(p)` | `deskCapUsdCents(p)` |
| `μ` | `active_utilization_usd_cents(p)` | `activeUtilizationUsdCents(p)` |
| `F_slot` | `slot_fee_micro_usd(p)` | `slotFeeMicroUsd(p)` |
| `G_rev` | `gross_revenue_usd_cents(p)` | `grossRevenueUsdCents(p)` |
| `N_rev` | `net_revenue_usd_cents(p)` | `netRevenueUsdCents(p)` |
| `D_allocation` | `dif_allocation_usd_cents(p)` | `difAllocationUsdCents(p)` |
| `Y_total` | `total_lp_yield_usd_cents(p)` | `totalLpYieldUsdCents(p)` |
| `Y_sr` | `senior_yield_usd_cents(p)` | `seniorYieldUsdCents(p)` |
| `Y_jr` | `junior_yield_usd_cents(p)` | `juniorYieldUsdCents(p)` |
| breaker floor | `circuit_breaker_drain_usd_cents(p)` / `hard_lock_triggered(p, drain)` | `circuitBreakerDrainUsdCents(p)` / `hardLockTriggered(p, drain)` |

## 7. Verification

```bash
# Rust twin (in the mono-repo root):
cargo test -p noviscia-asset-engine-sdk

# TypeScript twin (in sdk/):
npm test            # economics suite pins every reference figure above
```

Both suites assert the exact values: `78,840,000` slots, `63,072,000` eligible,
`$6,000,000 / $1,500,000` caps, `$460,800.00 / $403,888.00 / $80,777.60 /
$323,110.40 / $315,000.00 / $8,110.40`, and the `$1,500,000` hard-lock floor.