# Noviscia: One Balance Sheet, Two Engines — CCP Core + TVV Yield

**Date:** 2026-09-01
**Status:** Canonical product narrative. Reconciles the CCP identity
(`CCP_CURRENT_STATE.md`) with the TVV financial engineering (`TVV_FINANCIAL_ENGINEERING.md`)
into a single, truthful story. Supersedes the implicit marketing posture that the two
were separate.

---

## 1. The one-sentence story

> **Noviscia is a central counterparty (CCP) whose idle, pooled capital is continuously
> reused as slot-scoped contingent capacity — Total Value Velocity (TVV) — so the same
> balance sheet that clears and nets risk also earns 15–35% APY by being used, 2.5× per
> second, without a cent of it ever moving.**

The "CCP" is what Noviscia **is**. TVV is what Noviscia **does** with the money it
cannot afford to let sit idle. They are not competing identities — CCP is the engine,
TVV is the fuel-efficiency of that engine.

---

## 2. Why both words are accurate, and why the gap felt real

### 2.1 It genuinely is a CCP (risk / counterparty / netting)

- **Novation & netting:** `position-tracker` (perps book) and `noviscia-clearing`
  (event/outcome markets) interpose on both sides of every trade. The position returned
  to a user is the *netted* exposure per wallet/market.
- **Single omni-pool margin:** all margin, fees, and PnL settle into the `nv-usdc-vault`
  omni-pool (`nvscUSDC` shares, `fee_index` NAV accrual).
- **Default absorption:** the 5-layer waterfall — trader margin → cross-margin →
  insurance reserve → default fund → CCP equity — before LPs are touched.
- This is the machinery of a central counterparty, and it is built, deployed, and
  audited. The word "CCP" is earned by the plumbing.

### 2.2 It genuinely is a TVV engine (capital velocity / yield)

- `jit-risk` writes slot-scoped (400ms) contingent-capital contracts: the pool stands
  behind a single slot of a market maker's execution room, collects a micro-premium,
  the risk dissolves at block close, and the premium compounds into native yield.
- The market measures itself in **velocity**, not stack: TVV (premium flow), κ (capital
  turnover/sec), CUR (capacity utilization), WBR, ψ, SSE, LR — a metric suite that has
  no meaningful analog for a "pure" CCP that holds capital idle.
- Target: 15–35%+ APY on a *fixed* base of idle capital. The headline the whole product
  markets toward.

### 2.3 Why it felt like a mismatch (the real gap)

1. **Move-measure marketing.** The TVV doc says "Noviscia stops measuring (and
   marketing) its business as TVL and moves to TVV." That reads as *replacing the
   identity*, when in truth it replaces only the **headline metric**, not the clearing
   machinery underneath. The UI reinforces the split — the page says "Powered by
   Noviscia CCP" and a stat block says "CCP equity", while the header metric was
   switched to TVV.
2. **Fee-type conflation.** `sweep_premiums` pushes the pool's premium through
   `FEE_TYPE_TRADING` rather than a dedicated `FEE_TYPE_CAPACITY`, so the *same* vault
   event stream cannot distinguish "capacity premium" from "trading fee" revenue.
3. **The floor is asserted, not wired.** `ji-risk`'s safety floor is an operator
   setting; it mirrors the perps insurance reserve only in the doc, not in a live
   account read.

These three are `⚠️` fixes — small, concrete, and enumerated in §5. Nothing about them
requires re-litigating the metaphor: the fix is to make the code match the story, not
to pick one story.

---

## 3. The unified mental model

```
                  ONE BALANCE SHEET  (nv-usdc-vault omni-pool)
        ┌──────────── the CCP core (risk engine) ────────────┐
        │  perps book · event markets · netting · 5-layer    │
        │  waterfall · funding · liquidation · gateway tolls │
        │            ALL revenue sweeps to NAV               │
        └───────────────────┬────────────────────────────────┘
                            │  same idle pooled capital
                            ▼
        ┌──────────── the TVV engine (velocity engine) ──────┐
        │  jit-risk time-slices: W_t = pool − floor − locked │
        │  85% premium → LP NAV · 15% → backstop reserve     │
        │  floor F   ← CCP insurance reserve (to be wired)   │
        │  waterfalls junior to perp liquidation claims      │
        └───────────────────┬────────────────────────────────┘
                            ▼
         CCP equity / LP NAV  ←  both engines feed THE SAME number
         Headline metric: TVV (premium velocity), not TVL
```

**What this says out loud:**
- The CCP is the *counterparty* — the entity traders contract with. That is the trust
  story (institutional, regulatory).
- TVV is the *treasury/asset-liability* may — and the growth story (the 15–35% APY,
  the velocity metrics).
- One balance sheet. One NAV. Two engines. That is the whole product.

---

## 4. How to talk about it (talking points)

- **When asked "what is Noviscia?"** → "A central counterparty on Solana — we clear and
  net risk across perps, events, gateways, and credit lines — and the same pooled
  capital is continuously rented out as 400ms risk capacity to generators, which is the
  yield you see. The clearing core earns your trust; the velocity engine earns your
  yield."
- **When asked "why 'CCP' if the point is yield?"** → "Because the yield is *produced
  by the CCP balance sheet*. The omni-pool is a CCP asset pool; jit-risk is how that
  pool velocity-sells its own capacity. If we didn't clear risk we wouldn't have the
  pool that earns. Calling it a CCP is not a legacy label — it's the root of the yield."
- **Metric framing:** keep **TVV** as the headline (as the frontend does). Show
  `kepp`, `CUR`, `WBR` as the supporting velocity story. Show `insurance_fund_usdc`
  and `ccp_equity` as *context* (the base that produces the velocity), never as the
  headline. This is already the frontend policy; the reconciled narrative just makes it
  explicit *why*.

---

## 5. Gap-closure checklist (code, not narrative)

**Status 2026-09-01:** items 1–2 implemented in code; IDLs regenerated (`anchor build -p
jit-risk` / `-p nv-usdc-vault`) and synced to `app/web/app/idl/`; SDK updated
(`syncInsuranceFloor`, corrected `sweepPremiums` accounts) — 52/52 sdk tests,
49/49 web core tests, both programs compile. A devnet redeploy remains pending
(needs deployed keypairs + cluster access).

| # | Fix | Status |
|---|-----|--------|
| 1 | Add `FEE_TYPE_CAPACITY = 4` to `nv-usdc-vault`; route jit `sweep_premiums` through it | ✅ Done. Routes via `fee_to_yield_bps` partition path (LP yield, correct sink) |
| 2 | Wire `insurance_fund_floor_usdc` to position-tracker's real insurance reserve | ✅ Done. New authority-gated `jit-risk::sync_insurance_floor` reads `position-tracker::Market.insurance_fund_usdc` (owner-checked, stable byte offset) and reconciles the floor; `update_params` keeps an emergency override |
| 3 | On-chain synthetic-volume flag (`flag_desk`) + `slots_occupied` tracking | ✅ Done. Authority-gated `flag_desk` emits `SyntheticDeskFlagged` with heuristic metrics (win rate, slot concentration, outstanding ratio); `rent_slice` tracks distinct slots per MM; governance calls `suspend_mm` based on evidence |
| 4 | Frontend: reconciled tagline + TVV header metric | ✅ Done 2026-09-01 ("Clearing core · Velocity yield"; "Velocity yield APY" stat) |
| 5 | Point `CCP_CURRENT_STATE.md` and the TVV doc §0/§9 at this document as the canonical framing | ✅ Done 2026-09-01 |

---

## 6. Related docs

- `TVV_CCP_INTEGRATION_AUDIT.md` — the code-level truth table behind §3/§5.
- `CCP_CURRENT_STATE.md` — operational/program state of the clearing core ("as it is today").
- `TVV_FINANCIAL_ENGINEERING.md` — the full financial engineering of the t-slice marketplace.
- `TOKENOMICS.md`, `TVV_FINANCIAL_ENGINEERING.md` §11 — numeric yield simulation.

**Framing rule of thumb for every future doc/UI:** *the CCP is the architecture, TVV is
the yield, the omni-pool is the shared balance sheet, and TVV is always the headline
metric.*