# Noviscia — 90-Day Proof Gate (go/no-go)

**Status:** Operational plan (2026-09-07). Converts `investor/v0.md` §5/§6 into a
time-boxed decision gate. **Purpose:** produce the evidence an investor actually
filters on, and force a decision between *Variant B* (run the marketplace) and
*Variant C* (license the clearing engine) before more money spends.

**Rule of the gate:** nothing is upgraded from `simulated`/`pending` to trust by
intent — only by evidence (v0 freshness rule).

---

## 1. The blank sheet

At Day 0, an external reviewer sees:

| Investor filter | Current state | This gate changes it to |
|---|---|---|
| "Run the demo" | Blocked (private validator) | 5-min reproducible public path |
| "Show the yield math" | Honest but low (3.23% / 4.50%) | Honest + a utilization path chart |
| "Who buys this?" | Zero desks contacted | ≥2 signed desk LOIs with utilization numbers |
| "Who backs the loss?" | DIF unfunded | Anchored first-loss layer ($X) |
| "Is it unique?" | Asserted in a doc | Grid/press dossier + named wedge |

## 2. Five proof items + owners + exit criteria

Each flips a `pending → testnet-measured` / `signed` row in `investor/v0.md` §2.

| # | Proof | Action | Exit criterion | Owner |
|---|---|---|---|---|
| P1 | **Reproducible demo** | Ship the JIT/bundle path on public devnet infra; publish a runbook + a 3-metric report (atomicity, speed, settled premiums) with timestamps | An outside engineer re-runs it in ≤5 min and the 3 metrics print | Eng |
| P2 | **Demand (desk)** | Contact 6–8 mid-size on-chain makers (edge-rich, balance-sheet-poor — ICP from desk analysis); use `LOI_TEMPLATES.md` | ≥2 LOIs naming markets, size, frequency, and a utilization % they'd draw | BD |
| P3 | **Atomicity + capacity evidence** | Devnet scripts from v0 §5 #2–4: failing-bundle revert, N simultaneous draws, withdraw run, freezes, CB timing | S9 → `testnet-observed`; Breached freeze documented | Eng/QA |
| P4 | **One funded desk** | After P2: run the first internal-scale desk, settle real micro-premiums, publish fee history + default-free window | ≥30 days settled premiums, 0 defaults | Eng + BD |
| P5 | **Funded DIF + anchor LP** | Convert one LP interest into a funded junior/first-loss commitment ($X); publish its size | First-loss funded before any senior LP pitch | BD + Legal |

## 3. Cold-start sequence (the order matters)

1. **P1 first** (reproducibility) — it removes the standing "let me run it" objection
   from every subsequent conversation, and it is the cheapest item.
2. **P2 parallel** (desk demand) — the two-sided market bootstraps from the *desk*
   side, which is the side that is scarce. Utilization LOIs make the 3.23%→path
   story real.
3. **P4 before P5** — a funded desk with real premium history *is* the LP proof;
   asking for LP money before that history fails every filter in §1.
4. **P5 completes P3's credibility** — the DIF being funded is what converts the
   stress tables (S1–S11, v0 §4) from model to bankable claim.

## 4. Decision gate — at Day 90

```
IF P1 done AND P2 ≥2 LOIs AND P4 ≥30 real premium days AND P5 funded
   → VARIANT B (continue): pilot with those desks, $1M pilot cap,
     wallet-pilot as the 3-stats deck, move to m3/m4 in v0 §7.
ELSE
   → VARIANT C (pivot): do NOT keep spending on marketplace ops.
     License the clearing/netting + margined-intraday-credit engine.
     Targets (in order): a venue (Archer/Phoenix), a senior-credit
     partner (Maple), a custodian (BitGo Go Network pattern).
     Revenue = license + fee-slice. Risk profile drops sharply.
     The engine keeps shipping; the two-sided market problem transfers
     to a partner who already has desks or capital.
ELSE-IF the blocker is only P3 (infra) and P1/P2/P4/P5 are on track
   → extend the gate by 30 days for P3 alone; everything else must ship.
```

**The gate must be binary.** A "partial Variant B" (pilot without LOIs or without
a funded DIF) is the failure mode to refuse — it is exactly the shape that spends
the next $250k on nobody.

## 5. Weekly cadence

- W1: P1 runbook + desk target list (12 names).
- W2–3: P1 public demo live; first 4 desk conversations.
- W4: P2 first LOI signed; P3 failing-bundle test run.
- W6: P2 second LOI; P3 N-draw drill.
- W8: P4 first funded desk live; P3 freeze/CB evidence.
- W10: P4 premium history ≥14d; P5 first LP conversation.
- W12: gate review.

## 6. What success looks like as a deck

One page: honest economics (table from `VIABILITY_AND_UNIQUENESS.md` §2.1) → the
whitespace (§3.2) → P1–P5 evidence rows → Variant B pilot params → the gate itself.
Showing the gate *as the plan* is the strongest credibility move available: it
tells capital you will stop when the evidence stops.

## 7. Related docs

- `investor/v0.md` — claims table this gate flips; stress tables S1–S11; milestones m1–m6.
- `investor/LOI_TEMPLATES.md` — instruments for P2 and P5.
- `investor/LP_INVESTOR_NARRATIVE.md` — the honest story to tell after the gate is met.