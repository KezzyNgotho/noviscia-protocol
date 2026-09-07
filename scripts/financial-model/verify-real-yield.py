#!/usr/bin/env python3
"""
Noviscia Real-Yield Ledger — independent verification (Module 1 ≠ 2 ≠ 3).

This is a deliberately *zero-dependency*, integer-only recomputation of the
Noviscia TVV economics. It shares NO code with the TypeScript twin
(`sdk/src/economics.ts`, `velocity.ts`, `feasibility.ts`) or the Rust twin
(`noviscia-asset-engine-sdk::economics/velocity/feasibility`): a reviewer can
run `python3 verify-real-yield.py` and replay the entire ledger — the
desk-level toll, the borrower P&L, and the full pool waterfall — from first
principles, to prove the yield is real, non-inflationary, and driven by
transactional slot velocity.

Every assertion is integer floor division — no floats, no hidden rounding.

  python3 verify-real-yield.py        # exit 0 on a fully-closing ledger
"""

# ── Ledger clock (Solana 400ms slots) ───────────────────────────────────────
SECONDS_PER_YEAR   = 60 * 60 * 24 * 365          # 31,536,000
SLOTS_PER_SECOND_N = 5                            # 400ms slot ⇒ 2.5 slots/s
SLOTS_PER_SECOND_D = 2
TOTAL_SLOTS        = SECONDS_PER_YEAR * SLOTS_PER_SECOND_N // SLOTS_PER_SECOND_D  # 78,840,000

# ── Reference parameters (the audited $10,000,000 pool) ─────────────────────
POOL_CENTS          = 1_000_000_000               # $10,000,000.00
SENIOR_BPS          = 7_000                        # 70% senior tranche
JUNIOR_BPS          = 3_000                        # 30% junior first-loss
SYSTEMIC_CAP_BPS    = 6_000                        # 60% aggregate cap
DESK_CAP_BPS        = 1_500                        # 15% single-desk cap
AVG_UTIL_BPS        = 4_000                        # 40% of the systemic cap
JITO_LANDING_BPS    = 8_000                        # 80% eligible landing
BASE_RATE_BPS       = 2_400                        # 24% implied facility rate
JITO_TIP_BPS        = 150                           # 1.5% of gross → bundle tips (pool level)
DIF_BPS             = 2_000                        # 20% of net → Default Insurance Fund
INFRA_CENTS         = 5_000_000                    # $50,000 bare-metal infra/yr
SENIOR_HURDLE_BPS   = 450                          # 4.50% contractual senior yield
MICRO_PER_CENT      = 10_000                       # µUSD per USD cent
Q1E18               = 10**18

# Reference answers (pinned by the TS + Rust twin test suites).
REF_TOTAL_SLOTS     = 78_840_000
REF_ELIGIBLE_SLOTS  = 63_072_000
REF_F_SLOT_Q1E18    = 3_044_140_030


def mul_div(n: int, m: int, d: int) -> int:
    """Floor `n × m / d` in exact integers (mirrors the twin `mulDiv`)."""
    return (n * m) // d


def usd(cents: int) -> str:
    """Render USD cents as `$1,234.56`."""
    return f"${cents // 100:,}.{cents % 100:02d}"


def main() -> int:
    checks = []  # (label, actual, expected)
    add = checks.append

    # ── Clock ────────────────────────────────────────────────────────────────
    s_total = TOTAL_SLOTS
    s_elig = mul_div(s_total, JITO_LANDING_BPS, 10_000)
    f_slot = mul_div(BASE_RATE_BPS * Q1E18, 1, s_total * 10_000)
    add(("Total slots/yr", s_total, REF_TOTAL_SLOTS))
    add(("Eligible (Jito) slots/yr", s_elig, REF_ELIGIBLE_SLOTS))
    add(("Per-slot premium factor F_slot (q1e18)", f_slot, REF_F_SLOT_Q1E18))

    # ── Module 3: desk-level feasibility (the "why searchers pay" proof) ────
    desk_cents = mul_div(POOL_CENTS, DESK_CAP_BPS, 10_000)              # $1,500,000
    toll_micro = mul_div(mul_div(desk_cents, BASE_RATE_BPS, 10_000), MICRO_PER_CENT, s_total)

    spread_cents = mul_div(desk_cents, 15, 10_000)                      # 15 bps mismatch
    tip_cents = mul_div(spread_cents, 6_000, 10_000)                    # 60% aggressive tip
    toll_cents = toll_micro // MICRO_PER_CENT                           # sub-cent → 0
    net_cents = max(spread_cents - tip_cents - toll_cents, 0)

    ppb = toll_micro * 1_000_000_000 // (spread_cents * MICRO_PER_CENT)
    ppm = toll_micro * 1_000_000 // (net_cents * MICRO_PER_CENT)
    annual_toll_full = (toll_micro * s_elig) // MICRO_PER_CENT

    add(("Max-desk slot toll (µUSD, exact)", toll_micro, 4_566))
    add(("Borrower gross spread @ 15 bps (¢)", spread_cents, 225_000))
    add(("Jito MEV tip @ 60% (¢)", tip_cents, 135_000))
    add(("Borrower net above toll (¢)", net_cents, 90_000))
    add(("Toll share of spread (ppb)", ppb, 2_029))
    add(("Toll share of net (ppm)", ppm, 5))
    add(("Max-desk annual toll @ full landing (¢)", annual_toll_full, 28_798_675))

    # ── Module 1: the pool-level waterfall ───────────────────────────────────
    active_cents = mul_div(mul_div(POOL_CENTS, SYSTEMIC_CAP_BPS, 10_000), AVG_UTIL_BPS, 10_000)
    gross = mul_div(mul_div(active_cents, BASE_RATE_BPS, 10_000), JITO_LANDING_BPS, 10_000)
    after_tip = gross - mul_div(gross, JITO_TIP_BPS, 10_000)
    net = max(after_tip - INFRA_CENTS, 0)
    dif = mul_div(net, DIF_BPS, 10_000)
    lp = net - dif
    senior = mul_div(mul_div(POOL_CENTS, SENIOR_BPS, 10_000), SENIOR_HURDLE_BPS, 10_000)
    junior = max(lp - senior, 0)

    add(("Average active borrow volume (¢)", active_cents, 240_000_000))
    add(("Gross annual revenue (¢)", gross, 46_080_000))
    add(("Net revenue after tip + infra (¢)", net, 40_388_800))
    add(("DIF allocation (¢)", dif, 8_077_760))
    add(("Total LP payout pool (¢)", lp, 32_311_040))
    add(("Senior hurdle 4.50% (¢)", senior, 31_500_000))
    add(("Junior residual (¢)", junior, 811_040))

    # ── Emit the ledger ──────────────────────────────────────────────────────
    name_w = max(len(label) for label, _, _ in checks) + 2
    print("NOVISCIA REAL-YIELD LEDGER — INTEGER VERIFICATION (no floats)")
    print(f"{'Metric':<{name_w}}{'Computed':>22}{'Reference':>22}  Status")
    failures = 0
    for label, actual, expected in checks:
        ok = actual == expected
        failures += 0 if ok else 1
        status = "[ok]" if ok else "[FAIL]"
        print(f"{label:<{name_w}}{format(actual, ','):>22}{format(expected, ','):>22}  {status}")

    print("-" * (name_w + 46))
    print(f"  {usd(gross)} gross  →  {usd(net)} net  →  "
          f"DIF {usd(dif)}  →  LP {usd(lp)}")
    print(f"  senior {usd(senior)} (4.50% hurdle) + junior {usd(junior)} = {usd(lp)}")
    print(f"  max-desk toll {toll_micro} µUSD/slot = $0.004566 exact floor "
          f"(the deck prints $0.004565 — that rounds down)")
    if failures:
        print(f"LEDGER FAILED — {failures} check(s) diverged from the reference sheet.")
        return 1
    print("ALL CHECKS PASSED — LEDGER CLOSES TO THE CENT")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())