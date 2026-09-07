# Velocity-Driven Yield (VDY) — the engine's yield mechanism, pinned

> **Purpose:** a fact-sheet that locks the VDY pitch — "we do not receive a monthly
> interest payment; we capture a high-frequency micro-premium fee toll inside every
> successful 400ms block slot" — to the twin-verified engine (`economics.ts`,
> `velocity.ts`, `feasibility.ts`, `ledger.ts` and the rust twins). Every number
> below is integer-pinned by the TS + Rust test suites and replayed independently
> by `scripts/financial-model/verify-real-yield.py` and
> `verify-settlement-ledger.py`.
>
> **Status:** pinned · **Last updated:** September 7, 2026

---

## 1. Why it is not interest

A desk borrows liquidity for the duration of **one Solana slot (400 ms)**, clears it the
same slot, and pays a micro-fee. There is no central-counterparty term loan, no monthly
billing, no compounding principal balance. The fee is a **programmatic per-slot toll** —
the annual facility rate scaled down to the sub-second level:

```
R_base (24% annualized)  ÷  S_total (78,840,000 slots/yr)  =  3.044140030 × 10⁻⁹ per slot
```

That fraction is the Module-2 velocity premium factor `F_slot` (`3,044,140,030` in
q1e18) and, applied to a borrowed principal, it **is** the per-slot toll:

| Item | Pinned value | Where pinned |
|---|---|---|
| Slots per year | **78,840,000** | `totalSlotsPerYear()` (economics) |
| Eligible (Jito) slots per year | **63,072,000** | `eligibleSlots(p)` (economics) |
| Implied annual facility rate | **24%** (2,400 bps) | `BASE_RATE_BPS` (assumptions) |
| Per-slot premium factor `F_slot` | **3.044140030 × 10⁻⁹** | `slotPremiumScalingFactor(p)` (velocity) |
| Toll on the max $1.5M desk per slot | **$0.004566** (4,566 µUSD) | `maxDeskSlotTollMicroUsd(p)` (feasibility) |
| Same toll as fraction of principal | **3.0440 × 10⁻⁹** (±0.01% of F_slot) | `feasibility.test.ts` "VDY equivalence" |
| Desk's share of spread (on the ref route) | **2,029 ppb** (≈ 0.0002%) | `tollShareOfGrossPpb` |
| Toll share of the desk's net per trade | **≈ 5 ppm** | `tollShareOfNetPpm` |
| Max-desk toll per year at full landing | **$287,986.75** (~62% of gross) | `deskAnnualTollUsdCentsAtFullLanding` |

**Precision notes for the pitch (three corrections):**

1. The toll is **`$0.004566`**, not `$0.004565`. The micro-USD integer floor lands
   exactly on 4,566 µUSD for the $1.5M desk; `$0.004565` is the deck's display rounding.
2. The per-slot fee is a **fraction of 3.044140030 × 10⁻⁹** of borrowed volume —
   i.e. **0.0000003044%** when written as a percentage. The deck's
   `"0.0000000030439%"` misplaces the decimal point by two orders of magnitude.
3. "~63 million eligible slots" is **exactly 63,072,000**.

## 2. What a single trade collects

A desk (e.g. Wintermute) drawing its full `$1.5M` cap for a cross-venue arbitrage in one
slot: Noviscia collects **$0.004566** on that slot, atomically, inside the successful
bundle. From the desk's perspective the toll is imperceptible next to the trade it is
already capturing (reference route: $2,250 gross spread, $1,350 aggressive Jito tip,
$900 net — the toll is millionths of the net). The value is in **frequency ×
concurrent desks**: many loops across 63,072,000 eligible slots per year turn those
micro-tolls over continuously — revenue is non-inflationary because it is a
pass-through of real transactional flow, not a token emission.

## 3. The 24h settlement + fee-routing matrix

At the end of the 24-hour floating window the desk settles its accumulated daily bill in
**the exact asset it borrowed** (USDC settles USDC, SOL settles SOL, NVSC settles
NVSC). The post-clear ledger routes it through the pre-audited waterfall:

```
  24h daily settlement clears
              │
              ▼
   tip 1.5% of gross  (Jito auction)
              ▼
   net = gross − tip − infra ($50k/yr, per-day)
              │
      ┌───────┴───────┐
      ▼ (80% of net)  ▼ (20% of net)
   LP share        DIF / protocol reserve
      │             │
   senior hurdle 4.50%/365 first → junior residual    backstop + open-market NVSC buybacks
```

**Clarification (pitch vs sheet):** the 80/20 split is on **net revenue** — the figures
"80% of gross" in pitch diagrams won't reconcile. The pinned annual finality:

| Line | Amount | Pinned where |
|---|---|---|
| Gross transactional fees | **$460,800.00** | `grossRevenueUsdCents` |
| − Jito auction tip (1.5%) | −$6,912.00 | `jitoTipBps` |
| − Bare-metal infra | −$50,000.00 | `INFRA_USD_CENTS` |
| Net revenue | **$403,888.00** | `netRevenueUsdCents` |
| → DIF safety reserve (20%) | **$80,777.60** | `difAllocationUsdCents` |
| → LP vaults (80%) | **$323,110.40** | `totalLpYieldUsdCents` |
| → of which senior (4.50% hurdle) / junior | $315,000.00 / $8,110.40 | `seniorYieldUsdCents` / `juniorYieldUsdCents` |

At the reference 40% slot utilization senior LPs earn their 4.50% hurdle and junior the
residual; at 100% utilization (4 max desks, `$6M` active) junior APY reaches ≈ **18.4%**
(`ledger.test.ts` "full utilization").

### How LP capital gains

The 80% LP share is deposited into the primary principal pool vault: the raw asset
balance grows while the **nToken LP-share supply is constant**, so each share's NAV
rises programmatically. Yield is paid in hard, liquid capital — never in dilutive,
inflationary token rewards.

### Where the 20% goes

The DIF allocation is held in an isolated protocol reserve: it builds the pool's
permanent first-loss backstop organically and funds automated open-market **NVSC
buybacks** via the Jupiter Routing API — transaction-driven demand for the utility
asset, not emissions.

## 4. No-drain guarantees (the security story)

- Money leaves Noviscia via exactly three doors: validator tips, the operating bill,
  and a **realized** default loss (C1 conservation is checked every settled day).
- A default absorbs L1 collateral (30%) → LoC at the 25% haircut → DIF → junior → senior;
  the reference $1.5M default leaves **zero uncovered loss** and never touches senior
  principal.
- Four saturating defaults drain > 50% of junior and trip the hard circuit breaker,
  freezing settlement pre-impairment.

## 5. The value proposition, in one line

> Noviscia is a zero-directional-risk **infrastructure tax** on Solana's algorithmic
> trade volume: desks multi-fold their alpha-extraction capacity with the engine's
> liquidity, and in return they fund a predictable, automated yield engine for capital
> providers — while DIF + the circuit breaker keep the pool structurally solvent.

## References

- `sdk/src/feasibility.ts` + `.test.ts` — the toll, the ppm/ppb shares, the 15× desk multiplier
- `sdk/src/velocity.ts` — `F_slot`, `capitalTurnoverPerYear`, APY transforms
- `sdk/src/economics.ts` — the pool waterfall and the annual closed forms
- `sdk/src/ledger.ts` + `sdk/src/ledger.test.ts` — time-stepped settlement, C1/C2/C3
- `scripts/financial-model/verify-real-yield.py`, `verify-settlement-ledger.py` — independent integer replays
- `docs/HFT_DESK_PRIMER.md` — the desk-side sell-side framing
- `docs/TVV_SPEC_SHEET.md` — the audited workbook + B36–B41 feasibility block