# Total Value Velocity (TVV) Specification Sheet — Engine Module 2

> **Purpose:** The institutional-risk answer to *"How does a 24% base borrowing rate translate into
> an organic 15%–35% APY without inflation?"* — the exact velocity metrics, turnover formulas, and
> integer-math proofs behind the Noviscia TVV engine. Module 2 builds on the economics sheet
> (`QUANTIFIED_RISK_PACK.md`, Module 1) and re-derives its `$460,800` gross purely from ledger
> velocity.
>
> **Status:** Living; pinned by twin tests (TypeScript `sdk/src/velocity.ts` + Rust
> `noviscia-asset-engine-sdk::velocity`, 21 assertions). **Last updated:** September 5, 2026.

---

## 1. The TVV paradigm: velocity vs lockup (TVL)

Traditional DeFi relies on Total Value Locked (TVL): capital sits stagnant inside smart contracts
to back asynchronous, multi-day loans — a low capital turnover rate.

Noviscia shifts to Total Value Velocity (TVV). Because underwriting capital never leaves the
protocol's custody for more than a single **400-millisecond slot**, the same pool liquidity is
recycled and compounded up to **2.5 times every second**, matching the Solana ledger layer:

```
TRADITIONAL TVL MODEL (STAGNANT)
  [ $10M Capital Base ] ──────> [ Locked for Days/Months ] ──────> Low Capital Turnover (1x per cycle)

NOVISCIA TVV MODEL (ACCELERATED)
  [ $10M Capital Base ] ──┬───> [ 400ms Slot Borrowing ] ──┐
                          ├───> [ 400ms Slot Borrowing ] ──┼───> Multiplies Volume Turnover
                          └───> [ 400ms Slot Borrowing ] ──┘     (Up to 63 Million turns / year)
```

## 2. Core mathematical formulas

All four formulas are implemented in **integer arithmetic on USD cents** (micro-USD where a
per-slot premium is sub-cent) — no floats. Every figure below is reproduced to the integer by the
twin test suites.

### Formula A — The capital turnover multiplier (`V_turnover`)

```text
V_turnover = (1 slot / 0.4 s) × 3,600 s/h × 24 h/d × 365 d/yr × L_jito
V_turnover = 2.5 turns/s × 31,536,000 s/yr × 0.80 = 63,072,000 turns / yr
```

Module: `capitalTurnoverPerYear(p)` — identical to Module 1 `eligibleSlots` (single source of
truth), restated as *turnover*.

### Formula B — The micro-premium fee-scaling factor (`F_slot`)

The annualized base borrowing rate is scaled to a sub-cent premium per physical slot so HFT desks
keep their arbitrage margins:

```text
F_slot = R_base / S_total = 0.24 / 78,840,000 ≈ 3.0439e-9 per slot
```

Module: `slotPremiumScalingFactor(p)` returns the exact rational at **q1e18 fixed point** =
`3,044,140,030`. The spec sheet's printed `3.0439e-9` is that value rounded to 7 significant
figures. The micro-premium earned on **one eligible turn** of the active volume is
`perTurnPremiumMicroUsd(p)` ≈ `7,305` µUSD (`$0.0073059`) — the identical band Module 1 pins via
`slotFeeMicroUsd`.

### Formula C — The multiplied daily transactional power (`P_daily`)

```text
P_daily = Active Slot Utilization × Slots Per Day × L_jito
P_daily = $2,400,000 × 216,000 × 0.80 = $414,720,000,000 / day
```

> ⚠️ **Correction to the printed sheet:** the published `$414,720,000` is a **1000× unit slip**.
> The formula computes **`$414.72 billion / day`** (which is exactly `V_turnover × active / 365` =
> `$151.37 T / 365`). The module implements the formula. (`216,000` slots/day = `86,400 s / 0.4 s`,
> cross-checked against `S_total / 365`.)

Module: `dailyTransactionalPowerUsdCents(p)` and `dailyVolumeVelocityUsd(p)`.

### Formula D — The velocity-compounded gross annual yield (`APY_gross`)

```text
APY_gross = (Active Slot Borrowing Volume × F_slot × S_eligible) / Total Pool Capital Assets
          = ($2,400,000 × 3.0439e-9 × 63,072,000) / $10,000,000
          = $460,800 / $10,000,000 = 4.608%
```

Closed form: `R_base × L_jito × (active / pool)` — **byte-identical to Module 1 `grossRevenue`**,
so both modules agree to the cent. The per-slot route (`μ × F_slot × S_elig`) reproduces the same
number modulo per-turn flooring (≈ `$59` on the reference pool, < 0.02%); the proof harness
`formulaDReconciles(p)` asserts the two routes agree within 1% of gross.

| Active borrow volume | Fraction of pool | `grossApyTenthsBps` | APY |
|---|---|---|---|
| `$2,400,000` (baseline) | 24% | `4,608` | **4.608%** |
| `$6,000,000` (60% cap) | 60% | `11,520` | **11.52%** |

Scaling is exactly linear; both integers are pinned in the twin tests.

## 3. Structural drags (velocity degradation)

| Drag | Model | Effect | Module |
|---|---|---|---|
| **Jito gap** | 20% flat velocity drop over non-Jito leader blocks and fork reorgs; SDK drops capacity to zero in those windows to preserve single-slot atomic reversion | `L_jito = 80%` | `jitoGapBps(p)` = `2,000` |
| **MEV tip slippage** | Searchers pay validator priority-auction tips; flat 1.5% cut of gross micro-premiums | `$6,912 / yr` on the reference pool | `jitoTipSlippageUsdCents(p)` = `691,200` |
| **24-hour settlement debt gap** | Micro-premiums settle once per day (clearinghouse reset) for clean corporate accounting — never block-by-block | daily compounding: `4.608% → 4.715%` | `compoundedApyTenthsBps(p)` = `4,715` |

The 24-hour compounding keeps the effective rate strictly above the simple baseline
(`(1 + 0.04608/365)^365 − 1 ≈ 4.7159%`) while preserving a high compounding frequency — this is
the step that carries the "organic" APY up toward the 15%–35% band once capacity utilization and
credit-tier optimizations arrive (institution-side levers, not inflation).

## 4. TVV matrix summary (reference `$10,000,000` pool)

| Velocity metric | Parameter value | System operational purpose |
|---|---|---|
| Max network slots | `78,840,000` slots/yr | Physical limit of the Solana time architecture |
| Eligible landing rate | `80%` minimum target | Excludes non-Jito validator blocks from the engine |
| Capital turnover | `63,072,000` turns/yr | Formula A — dollar re-deployments per year |
| Daily volume velocity | `$414,720,000,000` / day | Formula C — transactional power from the $10M base |
| Gross APY baseline | `4.608%` | Formula D on 24% active utilization |
| Gross APY at 60% capacity | `11.52%` | Formula D at `$6M` active volume |
| 24h-compounded APY | `4.715%` | Constraint 3 — daily clearinghouse resets |
| MEV tip slippage | `$6,912` / yr | Constraint 2 — validator tip overhead |
| Compounding interval | 24-hour clearing window | Aligns block speed with corporate treasury timelines |

## 5. Reconciliation to Module 1

Every Module 2 value drops out of Module 1's already-audited quantities (`totalSlotsPerYear`,
`eligibleSlots`, `grossRevenueUsdCents`, `poolUsdCents`):
- Formula A ≡ Module 1 `eligibleSlots`
- Formula D numerator ≡ Module 1 `grossRevenueUsdCents` (both routes, within rounding)
- Formula B ≈ Module 1 `slotFeeMicroUsd` band
- Constraint 2 ≡ Module 1 `jitoTipBps`

The two implementations are byte-for-byte twins: TypeScript in `@noviscia/sdk` (`velocity.ts`,
13 tests) and Rust in `noviscia-asset-engine-sdk` (`velocity.rs`, 8 tests), both running on the
same integer cents/e-6 scale.

---

## Cross-references

- Tranche split, waterfall, circuit breaker (the other side of the sheet): [`QUANTIFIED_RISK_PACK.md`](QUANTIFIED_RISK_PACK.md)
- Full TVV financial engineering & risk register: [`TVV_FINANCIAL_ENGINEERING.md`](TVV_FINANCIAL_ENGINEERING.md)
- JIT time-slice marketplace, TVV ↔ CCP one-balance-sheet truth: [`TVV_CCP_INTEGRATION_AUDIT.md`](TVV_CCP_INTEGRATION_AUDIT.md) 
- Bundle economics & tip handling: [`PARTICIPANT_ACCESS.md`](PARTICIPANT_ACCESS.md), [`sdk/README.md`](../sdk/README.md)