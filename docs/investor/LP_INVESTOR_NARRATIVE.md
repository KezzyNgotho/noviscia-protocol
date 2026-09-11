# Noviscia — LP Investor Narrative (honest version)

**Status:** 2026-09-07. **Supersedes** the marketing posture in
`NOVISCIA_NARRATIVE.md` §1 and §2.2 ("Target: 15–35%+ APY", "risk dissolves at
block close", "un-integrated"), which this team verified the model cannot
produce and the market does not buy. Every figure below is the executable
engine's output (`investor/v0.md` freshness rule).

## 1. The one-paragraph story investors get

> Noviscia is a central counterparty on Solana that clears and nets market-maker
> risk *within a single 400ms slot*, then finances that activity intraday against
> margin — the same pooled balance sheet does both. Because every draw is an
> atomic Jito bundle, principal returns every block; because every draw pays a
> micro-premium, the pool earns continuously. The result for depositors is
> **money-market-grade yield with a structurally bounded, tranched tail risk** —
> produced by the clearing engine Noviscia actually is, not by leverage loops or
> third-party lenders.

Worth naming twice: the yield is native (premiums flow to NAV, auto-compounding),
bounded (atomic reversal + margining), and **tranched** (senior protected by a
funded first-loss layer).

## 2. The yield, stated honestly

At the $10M reference parameter set (`simulated`, pinned by tests):

| | Value |
|---|---|
| Gross revenue / yr | $460,800 |
| Net LP yield / yr | $323,110 |
| **Blended APY** | **3.23%** |
| Senior tranche | 70% · **4.50%** (this is the modeled *hurdle* — 450bps) |
| Junior first-loss | 30% · 0.27% + risk premium + buybacks |

This is the honest base. The **path-up story** is the one LPs should see:
- APY scales with **realized utilization** (40% avg is the reference; the systemic
  cap allows 60%). Utilization of 60% at the same rate ⇒ ~5% blended / ~6.7% senior —
  still no "15–35%," and that restraint is the credibility.
- Yield after the junior layer + DIF is paid; first-loss is *earned* by desks, not
  forgone LP carry.

> **Rule for every deck:** show the computed number and the path; never write a
> number the engine cannot print. One exaggerated figure costs the whole table.

## 3. Why the downside is different from every other yield product

| Product you're compared to | Tail-risk shape | Noviscia |
|---|---|---|
| Kamino/Solend stables | Smart-contract + lender-exposure, unsecured | Principal keyed to **every block**; failure of a bundle reverts the whole block — the vault cannot lose principal *intraday* |
| Drift/Hyperliquid-style ins. yield | Protocol-owned, server-side insurance fund | Your senior layer is protected by an on-chain waterfall you can re-run yourself (`generate-investor-report.ts` + `npm test`) |
| Traditional money-market | Regulatory + duration risk | No lockup; NAV cashes out anytime; only cross-slot jump risk is the open window, and that window is what the funded first-loss layer absorbs |

The stress table headline (v0 §4, all `simulated`): **senior LPs are untouched in
all 11 modeled scenarios** (single default, correlation, reserve shortfall, LoC
failure, liquidity shock, congestion, stale oracle, etc.); the junior layer plus a
hard 50%-junior lock breaker is the designed absorber.

**Honest caveat to say out loud:** those tables are model output — they become
trust only after the first supervised default on devnet is observed and the
transfers are verified. The 90-day gate (`PROOF_GATE_90D.md`) is designed to make
that observation an actual event, and the demo publicly re-runnable.

## 4. Where the fee money comes from (the desk side)

Desks rent **sub-slot risk capacity** from the pool for one slot and pay a
micro-premium through a 24h taxi-meter window. They can afford it because:
- the credit arrives inside the block (alternatives settle in hours/days);
- it is pay-per-use (no idle pre-positioned margin across venues);
- it is margined and atomic (their loss is their margin, not the pool's).

The desks who want this are **edge-rich, balance-sheet-poor**: mid-size on-chain
makers who lose float to incumbents every slot. Inventory-rich prop AMMs do not
need us — and we do not pretend they do.

## 5. Talking points (use verbatim)

- **"What is Noviscia?"** → "A central counterparty on Solana. We clear and net
  market-maker risk inside each block, and the same pooled balance sheet finances
  that activity intraday against margin. The clearing core earns the trust; the
  velocity earns the yield."
- **"What yield, and why not 15–35%?"** → "3.23% blended and 4.50% senior at our
  reference assumptions — the number the model actually produces, with a defined
  path as utilization climbs. We'd rather show you a real 4.5% than a fake 20%."
- **"Why isn't this just another vault?"** → "Because the pool cannot lose
  principal within a block (atomic reversal), the open risk window is only
  cross-slot jump risk, and that window is absorbed by a tranched, funded
  first-loss layer — before senior LPs are ever touched."
- **"Who backs the loss?"** → "Desk margin → committed LoC (25% haircut) →
  protocol DIF → junior first-loss (30%) → senior (70%), with a hard lock
  breaker at half the junior layer. Re-runnable yourself."
- **"Is this real or a simulation?"** → "11/11 programs live on devnet today; a
  real 24h window is on-chain; the model is `simulated` and labeled as such. Our
  gate converts these rows to measured evidence within 90 days — or we stop."
- **"Why now?"** → "Solana is >$45B in stable-value flows, institutionally
  entering, and the maker-financing layer doesn't exist yet: 128 products scanned,
  zero on-chain clearing/netting for desks. The slot itself is owned by Jito/BAM;
  the *credit within the slot* is the open space."
- **"What do you need from me?"** → "LPs: a first-loss commitment now ($X), which
  is what makes the senior claim bankable. Desk-side: signed LOIs. Show the gate."

## 6. What this file changes in the repo

- Points every LP-facing deck at `investor/v0.md` (numbers) + this file (story).
- Flags `NOVISCIA_NARRATIVE.md` §1/§2.2 for rewrite so the inflated frame stops
  shipping as canonical.
- The "un-integrated/native" marketing claim is dropped; the embedded-integration
  with a qualified-custody rail (v0 §6) is the forward posture.

## 7. Related docs

- `investor/v0.md` — the executable package behind every table above.
- `investor/VIABILITY_AND_UNIQUENESS.md` — why the wedge is real and what is noise.
- `investor/PROOF_GATE_90D.md` — the evidence this narrative promises.