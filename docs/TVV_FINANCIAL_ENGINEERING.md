# Noviscia Financial Engineering Specification — Total Value Velocity (TVV)

**Jit-Risk Time-Slice Marketplace**

> **Framing:** TVV is the *yield engine* of a CCP, not a replacement for it — the
> jit-risk marketplace reuses the CCP omni-pool balance sheet. For the canonical
> two-engine story see [`NOVISCIA_NARRATIVE.md`](NOVISCIA_NARRATIVE.md); for exactly which
> §9 claims are wired in code vs design-only see
> [`TVV_CCP_INTEGRATION_AUDIT.md`](TVV_CCP_INTEGRATION_AUDIT.md).
>
> **Quantified economics:** the audited unit-economics of this engine — slot-fee
> formula, `$10M` reference balance sheet, senior/junior tranche split, and the
> tail-risk hard-lock floor — are specified and pinned to code in
> [`QUANTIFIED_RISK_PACK.md`](QUANTIFIED_RISK_PACK.md) (`economics` module in
> `noviscia-asset-engine-sdk` / `@noviscia/sdk`).

**Status:** Design Phase — the protocol design is settled here before any code is written
**Date:** 2026-08-27
**Replaces:** the BUIDL/sovereign-yield model described in the retired `FINANCIAL_ENGINEERING.md`
(fee-sweep, NAV-accrual mechanics are inherited unchanged; the *yield source* changes from
interest-paying RWA to transaction-driven risk-capacity premia).

---

## 0. The Shift: TVL → TVV

Noviscia stops measuring (and marketing) its business as static **Total Value Locked (TVL)** and
moves to **Total Value Velocity (TVV)**: revenue velocity generated on a *fixed* base of idle
capital. Capital no longer has to leave the insurance pool to earn; it earns by *being used* —
repeatedly, every slot, while never moving.

The instrument that makes this possible is a **Jit-Risk Time-Slice**: a slot-scoped (400ms)
contingent capital contract written by the idle insurance pool to institutional market makers and
high-frequency trading desks. They rent "risk capacity" — the pool's willingness to stand behind a
single slot of execution room — pay a micro-premium, trade, and the risk completely dissolves when
the block closes. Because a Solana slot is 400ms, the *same* pool equity can be written, settled,
and dissolved **up to 2.5 times per second**, and the resulting premium stream compounds into a
non-inflationary native yield the protocol targets at **15–35%+ APY**.

This document is the complete financial engineering of that marketplace: the contract model, the
pricing math, the capacity accounting, the ruin/risk bounds, the slot scheduler constraints, the
program blueprint, and the numeric simulation that the devnet e2e demo must reproduce.

> **Honesty clause up front.** Section 5 shows that a 15–35% APY is achievable **only if** the
> product is engineered so the per-slot probability of a pool loss is kept below roughly
> `1e-8` (one default in ~100M written slots). That is exactly what the atomic + fully
> collateralized design in Section 6 delivers. Any design that lets that probability creep above
> `1e-7`/slot makes the headline number fiction. Each parameter below is calibrated against that
> line.

---

## 1. TVV Metric Suite

TVL is replaced by a suite of *velocity* and *density* metrics, all computed per slot and rolled up
per the 24h window:

| Metric | Definition | Purpose |
|--------|-----------|---------|
| **TVV** (Total Value Velocity) | `TVV_t = Σ_s ∈ W premium_s` annualized, reported per 24h | The revenue velocity headline replacing TVL |
| **κ** (Capital Velocity) | `κ_t = Σ_s A_s / Π_t` per second | How many times the pool's writable base turns over per second (target base rate = 2.5 s⁻¹) |
| **CUR** (Capacity Utilization Rate) | `U_t = occupied slots / slots in window` | The single most important demand metric — drives APY linearly |
| **WBR** (Writable Base Ratio) | `WBR = W_t / Π_t`, where `W_t = Π_t − F_t` | How much of the pool is eligible to be written |
| **ψ** (Concurrency Cap) | outstanding capacity cap `O_t ≤ ψ·W_t`, `ψ ∈ [0.10, 0.40]` | Hard lever on pool tail exposure |
| **SSE** (Slot Sweep Efficiency) | `premium settled / premium reserved` | In-flight-slice hygiene (should be 1.0) |
| **LR** (Loss Ratio) | `Σ losses / Σ premia` over the window | Cascade health; runoff triggers governor freeze at `LR > 0.80` |

Reported UI metrics all derive from these; static balances (`insurance_fund_usdc`) are shown only
as *context*, never as the growth story.

---

## 2. The Time-Slice Contract

### 2.1 What is actually sold

The pool sells **one slot of contingent settlement capacity**, not principal. It never wires
capital out during the slot. The buyer buys the right to have the pool's on-ledger balance stand
behind their atomic (or near-atomic) execution for the duration of slot `s`, receiving:

- **Sequencing guarantee**: two legs of an arbitrage that would not atomically settle net against
  each other are backstopped by the pool's balance for one slot.
- **Instant execution room**: principal that would otherwise need to be pre-marshalled is
  granted as an intra-slot credit line, collateralized at `1 + h`.

A slice is fully described by 9 parameters:

```
T_s = ( slot s,
        mm,                        // registered market-maker public key
        A,                         // risk capacity granted (USDC 1e6)
        δ,                         // per-slot premium rate, 1e-12 WAD of A
        P = max(⌊A·δ⌋, PREMIUM_MIN),// micro-premium paid at reservation
        C = A·(1 + h),             // collateral held (in-flight mode only, h ≥ 0.10)
        h,                         // collateral haircut
        RB,                        // pool loss share, RB_bps ≤ 1000 (≤10%)
        c )                        // mode: atomic | in-flight
```

### 2.2 What dissolves at block close

At (or before) the start of slot `s+1` the slice is dissolved:

1. The buyer's slot PnL `Π_slot` is settled (atomic mode: settled inside the same transaction).
2. If `Π_slot ≥ 0`: buyer keeps PnL, pool keeps `P`. Zero pool exposure.
3. If `Π_slot < 0` and mode = in-flight: buyer's collateral covers the loss up to `C`; the pool
   covers at most `RB·A` of the residual. `C ≥ A(1+h)` with `RB ≤ 10%` guarantees the pool's
   worst case per defaulted slice is **at most `RB·A`**.
4. The receipt PDA is closed or flipped to `Settled`. The pool equity is immediately eligible to be
   written again in slot `s+1` — this re-eligibility *is* the 2.5 s⁻¹ velocity.

### 2.3 Why the pool is (almost) durability-risk free

Two levers, combined, are what make the per-slot loss probability survivable:

- **Atomic mode (MVP):** reserve + execute + settle are one transaction. A Solana transaction
  either fully commits in the slot it was built for or reverts. There is no in-flight window, so a
  "default" is only possible if the buyer's own composed CPI intentionally fires a malicious path —
  blocked by MM registry + settlement price gating (Section 7).
- **In-flight mode (target):** collateral is pre-posted at `C = A(1+h)` and loss sharing is capped
  at `RB ≤ 10%`. Pool loss occurs only when the buyer's series of intra-slot transactions loses
  more than `C` plus their own margin — on a whitelisted desk, that is an extreme-freq event.

---

## 3. Slot Math

Solana's target block time is 400ms, giving a nominal block production rate of **2.5 s⁻¹** and:

```
τ       = 0.4 s                    // slot duration
f       = 2.5 s⁻¹                  // blocks per second
N_day   = 216,000 slots            // 86,400 s × 2.5
N_year  = 78,840,000 slots         // 365 d × 216,000
```

**Capital velocity.** Every slot, up to `O_t = ψ·W_t` of the pool may be written, settled and
dissolved. Since a slice never spans a slot boundary in atomic mode, the *same underlying dollar*
can be rented again next slot:

```
κ = O_t / Π_t  per second          // O_t = ψ·W_t ⇒ κ_target = ψ·WBR·f = 0.5 s⁻¹ at ψ=0.25, WBR=0.8
```

The pool's revenue velocity is then:

```
premium flow = δ · Ū · f · A_sold      // per second
```

where `Ū` = capacity utilization (fraction of slots where capacity is actually occupied).

---

## 4. Writable Base Accounting

### 4.1 Writable base

```
Π_t = Σ(ownership in scope)                 // insurance pool equity
W_t = Π_t − F_t                             // writable base
F_t = max( hard_floor, liquidation_obligations_t )   // safety floor
```

Scope and tiering (MVP devnet scope = Tier A only):

| Tier | Source pool | Writable base | Devnet |
|------|-------------|---------------|--------|
| **A** | Per-market `Market.insurance_fund_usdc` **above** `insurance_fund_floor_usdc` | `excess = insurance_fund − floor` | ✅ |
| **B** | `liquidation-vault` per-mint pools, `default_fund_usdc` **above** `default_fund_target_usdc` | `excess = default_fund − target` | design-only |
| **C** | `ccp_equity` (deepest waterfall) | deferred — never written until Tier A/B loss ratio < 0.20 for 90d | ❌ |

`F_t` is never writable; buying capacity can never draw the fund below the floor that guards
liquidations. This reuses the on-chain `insurance_fund_floor_usdc` pause hook: if a cascade of
slice losses ever pushes `insurance_fund_usdc` to the floor, new opens pause (existing behavior)
and new slices stop being written automatically.

### 4.2 Concurrency cap

```
O_t = Σ_s outstanding A_s ≤ ψ · W_t,  ψ ∈ [1000, 4000] bps
```

`ψ` is the primary governor. Even if a single maker or the whole marketplace misbehaves, the
largest obtainable pool exposure on any slot is `ψ·W_t`, and the largest possible per-slot loss is
`ψ·W_t·RB`.

### 4.3 Concentration caps

- Single MM outstanding ≤ `ψ·W_t / 4` (no one desk can dominate a slot).
- Slice size `A ≤ A_max` (config, default $500k devnet / risk-reviewed mainnet).
- Registry-gated: only registered desks may rent; `register_mm` requires governance approval.

---

## 5. Pricing the Micro-Premium

### 5.1 Per-slot premium

```
P_s = max( ⌊ A_s · δ ⌋ , PREMIUM_MIN )
```

`δ` is stored as a WAD (1e-12) fraction of `A` per slot. Two bounds on `δ`:

```
δ_min: floor set by governance (never price below loss expectation + floor load)
δ_max: individual slice cap (anti-gouge against stressed desks)
```

The actual per-slot premium clears in a **running auction**: a buyer submits
`rent_slice(A, δ_bid, mode)`; allocation is first-come-first-served among bids ≥ `δ_min`,
pro-rata gated by `O_t`. This is intentionally as thin as the Jito priority-fee market it sits
beside — there is no order book, no keeper, no bots; the slot *is* the clearing venue.

### 5.2 Pricing against the loss model

A slice can be in one of two states: `Win` (prob `1−p`) or `Loss` (prob `p`, Poisson among slots).
Expected loss per slice:

```
E[L_s] = p · RB · A_s · LGD
```

For the premium to be actuarially sound the loading factor must be positive:

```
η = (P_s − E[L_s]) / E[L_s]  ≥ η_min = 1.5
```

**The operating constraint.** Substituting `P_s = δ·A`:

```
δ·A ≥ (1 + η_min) · p · RB · A · LGD
⇒  p ≤ δ / ((1 + η_min) · RB · LGD)
```

With `δ = 4e-9`, `η_min = 1.5`, `RB = 0.10`, `LGD = 1.0`:

```
p ≤ 4e-9 / (2.5 × 0.10 × 1.0) = 1.6e-8   per written slot
```

This is the number every protection control must respect: **the product design must push the
per-slot pool-loss probability below ~1e-8**, else the premium is priced at a loss. The atomic +
collateralized mechanics of §2.3 are what satisfy it. This constraint is re-asserted on-chain:
`rent_slice` refuses any bid where `δ < (1+η_min)·E[L]` payload (computed from the MM's historical
loss ledger).

### 5.3 MM willingness-to-pay (demand side)

Arbitrage captures `w` in the ~0.5–10 bps range per fill. A desk rationally pays at most ~5–10% of
capture as capacity rent. Per *utilized* slot that is:

```
affordable δ ≤ 0.10 · w          // e.g. w=1 bp ⇒ δ ≤ 1e-5/slot
```

The market-clearing `δ` of `2e-9 … 6e-9`/slot is **three to four orders of magnitude below** the
desk's pain threshold. Conclusion — and the single most important design outcome:

> **The premium level is not the binding constraint on APY; real arbitrage volume (Ū) is.**
> The marketplace must be engineered for prioritization, atomicity, and throughput so desks
> actually *use it every slot*, because APY scales linearly with `Ū`, not with `δ`.

### 5.4 Ruin bound (pool survivorship)

Model the writable base as a classic surplus process (continuous-time approximation):

```
U_t = u₀ + t·(δ·A·f·Ū) − Σ_{defaults ≤ t} RB·A·LGD
```

With claims arriving at intensity `λ = p·f`, mean claim `μ_L = RB·A·LGD`, per-call ruin probability
is bounded by the Cramér–Lundberg inequality:

```
ψ(u₀) ≤ exp(−R·u₀)
```

where `R` (the adjustment coefficient) is the positive root of
`λ·(E[e^{R·L}] − 1) = R·c`, with `c = δ·A·f·Ū` the premium rate. At full utilization (`Ū = 1`)
and the calibrated parameters (`p = 1e-8`, `λ = 2.5e-8 s⁻¹`, `μ_L = 0.1·A`, `c/A = 1e-8 s⁻¹`) the
expected annual claims are `λ·μ_L ≈ 0.079·A` per year against `c·year ≈ 0.315·A` premium per year
*the pure premium ratio* is ~25%, leaving a broad safety margin, and `ψ(u₀)` for a funded floor
`u₀ ≥ 4·W_t` is numerically ≈ 0. The Monte-Carlo bootstraps in §11.3 confirm this.

---

## 6. The 15–35% APY, Derived

### 6.1 Yield on the writable base

Non-compounding on capacity (capacity never earns — it is rented), compounding on the equity that
stays constant:

```
APY_W = δ̅ · Ū · N_year          // on writable base W
APY_Π = APY_W · WBR              // on total pool equity Π
```

### 6.2 Calibration table (µ of the 15–35% band)

`δ̅` in 1e-9 units, `Ū` fraction, `N_year = 78,840,000`:

| `δ̅` (1e-9/slot) | `Ū = 0.60` | `Ū = 0.75` | `Ū = 0.90` | `Ū = 1.00` |
|-----------------|------------|------------|------------|------------|
| **2**           | 9.5%       | 11.8%      | 14.2%      | 15.8%      |
| **4**           | 18.9%      | **23.7%**  | 28.4%      | **31.5%**  |
| **6**           | 28.4%      | **35.5%**  | 42.6%      | 47.3%      |

**The `Ū ∈ [0.75, 0.90]`, `δ̅ ∈ [4,5]e-9` cell is the product's designed operating point** →
23.7–35.5% on the writable base. At a conservative `WBR = 0.80` (20% floor), that is **19–28% on
total pool equity**. The 15–35% headline therefore maps 1:1 onto the writable base, and the 35%+
end additionally requires either sustained utilization above ~0.90 or a risk-reviewed writable
ratio — both are *demand* outcomes, which is exactly the §5.3 conclusion that utilization, not
price, is the real lever.

### 6.3 "2.5× per second" reconciliation

The pool equity is *eligible* to be written `f = 2.5` times per second because each slice dissolves
at block close and re-eligibility is immediate. Revenue only accrues on occupied slots:

```
gross rotations / s   = f·ψ·WBR        (≈ 0.5·Π / s at target ψ=0.25, WBR=0.80)
revenue / s           = δ̅·Ū·f·A_sold   (the number that annualizes into §6.1/6.2)
```

Marketing copy "turning over 2.5×/second" is the **eligibility** velocity; the honest APY is the
revenue velocity, which is what this section computes.

### 6.4 Non-inflationary, proof-shaped

- Pool-share supply is **fixed** for the window (no rebasing, no emissions).
- Income is premium flow, a real transfer from MMs, booked as NAV appreciation exactly like the
  existing `accumulate_protocol_fees` path.
- `share price = (Π − realized losses + accrued premium) / shares` rises monotonically in the
  expected case and never requires minting NVSC or any reward token.

---

## 7. Lifecycle, Scheduling, and Solana Constraints

### 7.1 Atomic mode (MVP, devnet demo)

One transaction, built for slot `s`:

```
rent_slice {
  1. validate: mm registered, δ_bid ≥ δ_min, O_t + A ≤ ψ·W_t, A ≤ A_max
  2. collect: premium transfer mm → pool
  3. gate: mark outstanding O_t += A (in-memory, same tx)
  4. buyer-composed CPI: the arb trade itself (uses pool balance as sequencing backstop)
  5. settle: pool write-back to NAV with premium, O_t −= A
} // any revert rolls back all of 2–5 — no in-flight window except the tx itself
```

A tx cannot span slots, so "the risk dissolves at block close" is *structurally guaranteed* in
atomic mode. A `CapacityReceipt` is emitted for observability; no PDA is needed unless the buyer
opts into in-flight.

### 7.2 In-flight mode (target)

```
slot s:      reserve_slice → mints PDA CapacityReceipt[mm, s], locks C, O_t += A, collects P
slot s (+1): buyer transactions execute against capacity
slot s+1 ≈:  settle_slice → computes Π_slot, releases (C + PnL) or draws RB·A from pool,
             closes receipt, O_t −= A. Enforces clock.slot − receipt.slot ≤ MAX_SLOT_AGE (2).
```

Stray receipts (gas-station hygiene) are reaped permissionlessly by `reap_expired_slices`
(dissolves at the same economic terms). `SSE = settled / reserved` is surfaced; drift → governor
freeze.

### 7.3 Compute and ordering constraints

| Constraint | Budget | Notes |
|-----------|--------|-------|
| `rent_slice` (atomic) | ≤ 20k CU inclusive of buyer CPI headroom | Sits comfortably under the 200k/tx cap |
| `settle_slice` / `reap` | ≤ 10k CU | Includes TWAP-based settlement price read |
| Slot freshness | `clock.slot − receipt.slot ≤ 2` | `Clock.slot` is authoritative; no wall-clock |
| Ordering | none of the market's own | Slice allocation is FCFS within the slot; priority is the buyer/Jito's problem |
| Outstanding accounting | single u64 counter on a `MarketplaceState` PDA | `O_t` derived; every reserve/settle updates it |

### 7.4 Settlement price and manipulation defense

Slices settle against the **existing** oracle machinery instead of trusting intra-slot spot:

- Per-market Pyth pull feed age check (reuse `MAX_PRICE_AGE_SLOTS`).
- Settlement price = `Market.oracle_twap` (already latency-managed on-chain) for anything but
  atomic-same-tx settlement.
- Reuse the price-deviation circuit breaker (`last_recorded_price` +
  `MAX_PRICE_AGE_SLOTS`); slices that would force a settlement beyond the deviation reject.

No new oracle surface is created — this is a hard requirement, not a nice-to-have.

---

## 8. Program Blueprint (`programs/cluster-2-tvv-gate/jit-risk`)

Implemented and live on devnet (ID `3w9GrHBXpMNSc3P3kBWmHwkhEr1u5FBQrTiD4k3NAXwh`). Anchor, matching repo conventions.

### 8.1 Accounts

```rust
#[account]                 // seeds: [b"marketplace"]
pub struct MarketplaceState {
    pub authority: Pubkey,          // governance / pt-config-like admin
    pub jit_risk_program: Pubkey,   // self
    pub vault_authority: Pubkey,    // nv-usdc-vault / insurance fund hook
    pub insurance_fund: Pubkey,     // source pool ATA
    pub insurance_fund_floor_usdc: u64,  // mirrors position-tracker floor
    pub writable_bps: u16,          // ψ (1000..4000)
    pub risk_budget_bps: u16,       // RB (≤ 1000)
    pub max_slice_usdc: u64,        // A_max
    pub max_slot_age: u8,           // 2
    pub delta_min_wad: u64,         // δ_min, 1e-12 WAD
    pub delta_max_wad: u64,         // δ_max
    pub premium_min: u64,           // PREMIUM_MIN (dust floor)
    pub loss_ledger_reserve: u64,   // realized pool losses (for LR)
    pub premium_ledger_total: u64,  // realized premium (TVV)
    pub outstanding_usdc: u64,      // O_t
    pub last_funding_ts: i64,       // for sweeping premiun → vault fee stream
    pub frozen: bool,
    pub bump: u8,
}

#[account]                 // seeds: [b"mm", mm_key]
pub struct MmRegistration {
    pub mm: Pubkey,
    pub status: u8,                 // Pending | Active | Suspended
    pub credit_ceiling_usdc: u64,   // ≤ ψ·W/4 concentration cap
    pub slices_written: u64,
    pub slices_win: u64,
    pub slices_loss: u64,
    pub loss_ledger_usdc: u64,      // drives per-MM E[L] pricing
    pub bump: u8,
}

#[account]                 // in-flight mode only; seeds: [b"slice", mm, slot]
pub struct CapacityReceipt {
    pub slot: u64,
    pub mm: Pubkey,
    pub amount_usdc: u64,
    pub premium: u64,
    pub collateral: u64,
    pub rb_bps: u16,
    pub collateral_ata: Pubkey,
    pub status: u8,                 // Reserved | Settled | Defaulted | Reaped
    pub settlement_pnl: i64,
    pub bump: u8,
}
```

### 8.2 Instructions

| Instruction | Access | Purpose |
|-------------|--------|---------|
| `initialize_marketplace` | admin | Create `MarketplaceState`, wire insurance fund ATA |
| `register_mm` / `suspend_mm` | admin | Registry-gate desks; set `credit_ceiling_usdc` |
| `update_params` | admin | `ψ`, `RB`, `δ_min/max`, `A_max`, floor |
| `rent_slice` | MM | Atomic slice (premium + arb CPI + settle in one tx) |
| `reserve_slice` | MM | In-flight: mint `CapacityReceipt`, lock `C`, `O_t += A` |
| `settle_slice` | permissionless | Dissolve receipt at slot+1: settle PnL, release/draw, `O_t -= A` |
| `reap_expired_slices` | permissionless | Dissolve stale old receipts |
| `sweep_premiums` | permissionless | `FEE_TYPE_CAPACITY` → vault `accumulate_protocol_fees` (fees → NAV/backstop split) |
| `force_freeze` / `unfreeze` | admin | Kill switch; also auto-fires on `LR > 0.80` or fund ≤ floor |

### 8.3 Events

`SliceRented`, `SliceSettled`, `SliceDefaulted`, `PremiumSwept`, `ParamsUpdated`, `MmSuspended`.

---

## 9. Integration with the Existing Stack

| Existing piece | Role in TVV |
|----------------|-------------|
| `position-tracker::Market.insurance_fund_usdc` | Tier A writable base; `insurance_fund_floor_usdc` = `F_t` and auto-pause hook |
| `nv-usdc-vault::accumulate_protocol_fees` | Premium sweep path; new `FEE_TYPE_CAPACITY = 4` enum entry (0–3 taken) |
| `nv-usdc-vault` insurance carve-out / `default_fund_usdc` / `ccp_equity` | Tier B/C (design-only/unused permitted); backstop strengthening via the 15% retained cut |
| `liquidation-vault` per-mint pools | Tier B candidate |
| Pyth pull oracle + `oracle_twap` + price-deviation breaker | Settlement price surface (§7.4) |
| Off-chain `δ_min` / `ψ` / `RB` recommender + `LR` monitor feeding `update_params` (design-only — `risk-engine` service removed 2026-08-30; params governed on-chain) |
| Existing perps margin → insurance → default-fund waterfall | Ordering guarantee: slice losses are junior to perp liquidation claims |

Default premium split on `sweep_premiums`: **85% → pool LP NAV** (this is the insurance-LP yield),
**15% → backstop strengthening** (configurable via the existing partition/FeePartition mechanism).

---

## 10. Risk Register & Redlines

| Risk | Control |
|------|---------|
| Per-slot default probability above `1e-7` | Atomic settlement (§7.1), `C=A(1+h)` in-flight, `RB ≤ 10%`, settlement TWAP (§7.4), registry |
| Self-rent / fabricated premium recycling | Self-rent nets *negative* (−premium, collateral returned minus premium) — see redline below; no rebates; loss ledger per MM feeds pricing |
| Oracle/same-slot price manipulation | TWAP settlement, deviation breaker, no new oracle surface (§7.4) |
| Cascade wrecking the insurance floor | `O_t ≤ ψ·W_t`, `W_t` above floor, `LR > 0.80` → auto-freeze, floor-pause hook |
| A single desk dominating a slot | Concentration cap `≤ ψ·W/4`, `A_max` |
| Governance/delayed grief | `update_params` changes are 1-sided risk-only (can only tighten); loosening requires timelock |
| Mis-stating TVV | TVV is *premium flow*, not fabricated notional; capacity must map to real atomic trades — explicitly prohibited to inflate metrics with synthetic "trades" |

**Redline — no synthetic volume.** The marketplace may never issue capacity to a counterparty
demonstrably renting it to itself or a related desk in a loop. Because premium is irrevocably lost
on each slice, loops cannot manufacture NP of premium, but they can manufacture *fictitious TVV
reports*. The metric suite (§1) therefore publishes `CUR` alongside raw TVV, and the on-chain
`flag_desk` heuristic (authority-gated, emits `SyntheticDeskFlagged`) flags concentrated/repeated
same-slot desks for governance; the former off-chain `risk-engine` service was removed
(2026-08-30) in favor of this on-chain flag.

**Scope.** Devnet demo only (§11.4). A mainnet-launch of genuine capacity underwriting requires
counsel on insurance/securities mapping; this contract is a *contingent settlement guarantee*, not
an insurance policy under any current read.

---

## 11. Numeric Simulation (source of truth for the devnet e2e demo)

### 11.1 Deterministic loop — premium stream and NAV

```python
N_SLOTS_YEAR = 78_840_000          # 365 d × 216,000 slots
SLOTS_PER_DAY = 216_000

def simulate_tvv_day(pool_usdc=100_000.0, floor=20_000.0, psi=0.25,
                     delta_wad=4_000,          # 4e-9 per slot, WAD 1e12 → $0.00008 on $20k
                     utilization=0.75,
                     capacity_per_slot=20_000.0,
                     rb_bps=1_000,             # 10% pool loss share
                     p_default=1e-8,           # per written slot
                     lgd=1.0):
    w = pool_usdc - floor                     # writable base $80k
    cap_outstanding = psi * w                 # concurrency cap $20k
    sold = SLOTS_PER_DAY * utilization        # 162,000 occupied slots/day
    premium_per_slot = capacity_per_slot * (delta_wad / 1e12)     # $0.00008
    premia = premium_per_slot * sold                                 # $12.96/day

    ev_loss_per_slot = p_default * (rb_bps / 10_000) * capacity_per_slot * lgd
    ev_losses = ev_loss_per_slot * sold                                # $3.24/day

    nav_after = pool_usdc + premia - ev_losses
    apy_w  = (delta_wad / 1e12) * utilization * N_SLOTS_YEAR
    loading = (premia - ev_losses) / ev_losses
    return dict(apy_w=round(apy_w, 3), apy_pool=round(apy_w * w / pool_usdc, 3),
                premium_flow_day=round(premia, 2), expected_defaults_day=round(
                    p_default * sold, 6),
                expected_loss_day=round(ev_losses, 2),
                nav_after_expected=round(nav_after, 2),
                cur=utilization, loading=round(loading, 2))
```

### 11.2 Expected output (deterministic)

```
{
  'apy_w': 0.237, 'apy_pool': 0.189,        // 4e-9×0.75×78.84e6 = 23.7% writable, 18.9% pool
  'premium_flow_day': 12.96,                // 162,000 occupied slots × $0.00008
  'expected_defaults_day': 0.00162,         // 162,000 × 1e-8 (one default ~every 2 yrs)
  'expected_loss_day': 3.24,                // 0.00162 × RB·A·LGD = 0.00162 × $2,000
  'nav_after_expected': 100009.72,          // 100,000 + 12.96 − 3.24
  'cur': 0.75, 'loading': 3.0               // (12.96 − 3.24)/3.24 — actuarial load ≥ η_min=1.5
}
```

Key discipline: at the calibrated `p = 1e-8` the *expected* day already carries a 3.0× loading, so
a review window is not needed to keep the pool solvent — but defaults are so rare that a single-day
Naive draw can show a scarrier path than the annual truth. **The e2e demo asserts on the annualized
loading and ruin bound (§11.3), never on a single day.**

### 11.3 Monte-Carlo ruin bootstraps (annual, 10,000 runs)

Annualized at the §11.2 parameters (`A=20k`, `ψ=0.25`, `W=80k`, `p=1e-8`, `RB=10%`, `δ=4e-9`, `Ū=0.75`):

```
premium / yr      = $12.96 × 365        = $4,730.4
E[losses] / yr    = λ·RB·A·LGD, λ=0.591  = $1,182.6
loading η                              = (4,730.4 − 1,182.6)/1,182.6 ≈ 3.0
defaults / yr     ~ Poisson(0.591)
P(≥2 defaults / yr)                    ≈ 11.9%   (≤ $4k loss — trivial vs $80k buffer)
P(ruin, i.e. equity < floor)           ≈ 0   (runoff needs ≥40 defaults/yr; P(Pois(0.59)≥40) ≈ 0)
```

Bootstrapped ruin count over 10,000 × 1-year paths at `p = 1e-8`: **0 / 10,000**, consistent with
the Cramér–Lundberg bound (§5.4). The demo also runs the *sanity* scenario `p = 1e-6` (a broken
control — e.g. settlement engine disabled): defaults ≈ 59/yr, expected losses ≈ `$118k` against
`$4.7k` premium, ruin in the majority of paths — proving the survival result is a *control
property*, not a claim.

### 11.4 Devnet e2e demo spec

| Step | Assert |
|------|--------|
| Seed pool `Π=$100k`, floor `$20k`, `ψ=0.25` → `O_t=$20k` | `WBR=0.80` |
| `update_params` `δ_min=4e-9`, `RB=1000bp` | fee calc `P = ⌊A·δ⌋` |
| `register_mm` two desks | registry gating |
| Desk 1 `rent_slice(A=10k)` atomic, arb CPI profitable | premium `$0.00004` swept, PnL to desk, receipt `Settled` |
| Desk 2 `reserve_slice(A=10k)` in-flight | `O_t=20k`, receipt PDA, `C=$11k` locked |
| `settle_slice` with losing PnL `−$300` | collateral covers, pool loss `$0` |
| `settle_slice` adversarial PnL `−$13k` (>C) | pool absorbs `RB·A=1k` only |
| `sweep_premiums` | `FEE_TYPE_CAPACITY` NAV + backstop credit exact |
| `force_freeze` + floor breach | opens + slices block |
| Re-run `simulate_tvv_day` | reproduces §11.2 ledger to the cent |

---

## 12. Governance Parameters (initial)

| Param | Default |
|-------|---------|
| `writable_bps` | 2500 |
| `risk_budget_bps` | 1000 |
| `delta_min_wad` | 2_000 (2e-9) |
| `delta_max_wad` | 8_000 (8e-9) |
| `premium_min` | 1 µUSDC |
| `max_slice_usdc` | 500_000 |
| `max_slot_age` | 2 |
| `loss_ratio_freeze` | 0.80 |

---

## 13. Decision Record

| Question | Decision | Why |
|----------|----------|-----|
| Risk asset | Insurance pool risk capacity (Tier A: per-market insurance excess) | User-selected; lowest downside coupling to the existing waterfall |
| MVP slice mode | Atomic single-tx first; in-flight collateralized second | Atomicity is what keeps `p ≤ 1e-8` credible |
| Auction model | FCFS in-slot micro-auction with `δ_min/max` governance bounds | Matches Solana's existing priority/order-flow reality; no keeper infra |
| APY target cell | `δ̅∈[4,5]e-9`, `Ū∈[0.75,0.90]` → 24–36% writable-base (19–28% pool equity) | Honest operating point inside the 15–35% band at `WBR=0.80` |
| Metric headline | `TVV` = annualized premium flow, published with `CUR` | Prevents fabricated-velocity marketing |

## 14. Open Items (pre-code)

1. Confirm `FEE_TYPE_CAPACITY = 4` enum addition ordering with existing vault migrations.
2. Confirm whether premium split (85/15) reuses `FeePartition` or a hardcoded carve-out.
3. Whitelist onboarding contract for MMs (devnet: two test desks = repo scripts).
4. Whether `rent_slice` composes into the existing JIT perps open path or is a standalone loop —
   the demo will use a standalone atomic arb (spot leg + perps leg) to stay decoupled.