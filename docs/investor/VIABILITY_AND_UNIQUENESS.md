# Noviscia — Viability & Uniqueness Verdict (2026-09-07)

**Status:** Strategy analysis for the team, produced from the honest economics in
`investor/v0.md` + live market evidence. **No numbers in this file are new
claims** — every figure traces to the executable engine (`economics.ts`,
labeled `assumed/simulated/testnet-measured`) or to cited external data.

---

## 1. Verdict in one line

**The mechanism is viable and defensible; the pitch is not.** Noviscia is a real,
rare piece of infrastructure — an on-chain clearing/netting + intraday-margined
credit layer for Solana market makers. What is **not** viable is selling it as
"15–35%+ native yield from slot tokenization" — that number is unreachable at the
reference parameter set, and the market has already moved away from the
uncollateralized shape that framing implies.

## 2. Viability — gate by gate

### 2.1 Arithmetic gate — FAIL for the marketed yield number

`referenceTvvParams()` + engine, at the team's own defaults:

| Metric | Value | Provenance |
|---|---|---|
| Pool (reference) | $10,000,000 | `assumed` (v0 §3) |
| Systemic cap / desk cap | $6M / $1.5M | `assumed` |
| Avg utilization | $2.4M (40%) | `assumed` |
| Gross revenue | $460,800 / yr | `simulated` — pinned by tests (v0 §2 #1) |
| Net revenue (after $50k infra, 20% DIF) | $323,110 / yr | `simulated` |
| **Blended LP APY** | **3.23%** | `simulated` |
| Senior tranche APY | **4.50%** | `simulated` (= default `seniorHurdleBps=450`) |
| Junior first-loss APY | 0.27% | `simulated` |

Implications:
- The "15–35%+" headline needs ~5× the utilization-rate base the model permits
  (60% systemic cap, 40% avg utilization). It does not exist on any parameter set
  that respects the caps.
- The stated per-slot toll (~3.0439e-9%) annualizes to ≈0.0024%/yr — five orders
  of magnitude off the claim.
- "2.5× per second compounding" is slot cadence (2.5 slots/sec), not yield. APY is
  determined by `revenue = utilization × rate × pool`, not by compounding frequency.

**Decision this implies:** stop marketing a number the engine cannot produce.

### 2.2 Market-shape gate — FAIL for "uncollateralized risk-renting"

2026 institutional credit corpus (see Copilot + web dossiers, 2026-09):
- FalconX × Ethena — $1B facility, overcollateralized (USDe), CFTC-regulated dealer.
- Kraken × Maple — on-chain warehouse facility, superior/SPV structure.
- BitGo — Go Network settlement + Prime financing; Coinbase Prime cross-margin.
- Every counterparty measured operates **collateralized + SPV + qualified custody**.

Meaning: an "un-integrated, fully native" lending posture is the shape institutions
are exiting. That is a marketing liability to be removed, not a moat.

### 2.3 Infrastructure gate — PARTIAL (the honest engine passes; reproduction is blocked)

- **Already true:** 11/11 deploy-map programs live on devnet; `noviscia-capacity`
  live with a real 24h window opened 2026-09-06 (wSOL, slot 494190470); Breached
  freeze being proven by on-chain observer; 141/141 sdk tests pin the engine;
  $460,800/$323,110 figures are reproducible from a clean checkout (v0 freshness rule).
- **Blocked:** independent reproduction + Jito/atomicity/Geyser telemetry (v0 §2 #7–13)
  wait on a **public** Jito path. A private validator is evidence nobody can re-run.

## 3. Uniqueness — what is and is not differentiated

**Verdict: the "on-chain CCP/clearing + sub-slot margined intraday credit for
makers" wedge is genuinely empty space. The slot-tokenization and insurance-fund-yield
claims are not novel and are already owned upstream.**

### 3.1 Not unique (do not lead with these)
| Claim | Why it is not a moat |
|---|---|
| "Tokenizing the 400ms slot" | Jito **BAM** already subdivides slots into 8×50ms batch auctions (MPP live on Archer, 17 programs, >$500M daily spot); **Flowra** opened 200ms block auctions (Aug 2026); **Alpenglow** targeting sub-150ms finality. Slot-time is owned by the network layer on ~90% of stake. |
| "Idle insurance funds → yield" | Hyperliquid/Drift-style funds + existing vaults already monetize idle reserves; the prop-AMM tip pool the yield must live on is **$189K total for Q1 2026** (Jito data) with searchers already paying 50–60% of profit in tips. |
| "TVL → TVV" | A metric story, not a product. Nobody buys a new metric; they buy the cash flow it measures. |

### 3.2 Unique (the actual wedge)
Grid corpus (128 lending/credit/fin-services/derivatives products, 115 order-book
roots, tag-filtered "capital inefficiency" + "accelerator") found **zero on-chain
clearing/netting or intraday-margined-credit products for maker desks**. Project scan
(Lyhva, NovaSettle, Chronia, Solbid, Caden, Archer) shows the adjacent field is:
- maker-intent **exchange** (Archer), not desk *financing*;
- **uncollateralized** SME/vendor lending (Lyhva, zkTLS), which is the riskiest
  shape and not a clearing layer;
- **settlement/networking** (NovaSettle, BitGo Go Network), not credit.

Nothing exists that does **"clear and net maker risk sub-slot AND finance that
activity intraday, margined, on-chain."** That combination — at the intersection of
CCP plumbing (already built + deployed) and intraday credit — is the defensible
uniqueness.

## 4. What this means the product IS

Repositioned, truthful one-liner:

> **Noviscia is the clearing and intraday-margined-credit layer for Solana's market
> makers: it nets and settles maker risk within a slot, finances that activity
> intraday against margin, and returns money-market-grade yield with bounded tail risk
> to depositors — produced by the clearing engine it actually is.**

- LPs: bounded-downside, capital-keyed-to-every-block, no-lockup yield. Honestly
  3.23% blended / 4.50% senior at reference **with a defined path up as utilization
  climbs** and a **funded** DIF — not 15–35% speculative.
- Desks: sub-slot credit and pay-per-use risk capacity on the one axis incumbents
  literally cannot serve (speed: prime brokers settle in hours, not slots).
- Counterparties/institutions: a bankruptcy-remote CCP + custody-integration story,
  i.e. the shape 2026 actually funds.

## 5. Next plan to use this

1. **Flag the narrative docs** (`NOVISCIA_NARRATIVE.md` §1 headline, $\S2.2
   "Target: 15–35%+", "risk dissolves", "un-integrated") as **superseded by
   `LP_INVESTOR_NARRATIVE.md`** so no deck ships the unreachable number again.
2. **Point all investor-facing material** at `investor/v0.md` (already honest) +
   the three files in this folder.
3. **Execute the 90-day gate** (`PROOF_GATE_90D.md`) — the gate, not the roadmap,
   becomes the artifact shown to capital until demand is signed.
4. **Cold-start the demand side first** (desk LOIs) before any LP marketing reaches
   inboxes; LP funds are anchored after one funded desk + funded DIF exist.
5. **Go public-path on Jito** so the "5-minute reproducible demo" is a fact, not a
   claim — it is the single cheapest way to kill the biggest proof objection.

## 6. Related docs

- `investor/v0.md` — honest, executable investor package (source of all numbers).
- `investor/PROOF_GATE_90D.md` — the go/no-go gate and cold-start sequence.
- `investor/LOI_TEMPLATES.md` — desk-side and LP-side demand proofs.
- `investor/LP_INVESTOR_NARRATIVE.md` — the honest LP-facing story, superseding the
  inflated posture in `NOVISCIA_NARRATIVE.md` §1/§2.2.