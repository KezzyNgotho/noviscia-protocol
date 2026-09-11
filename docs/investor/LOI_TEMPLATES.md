# Noviscia — Deskside & LP Side LOI Templates (2026-09-07)

**Status:** Instruments for `PROOF_GATE_90D.md` P2 (desk demand) and P5 (funded
first-loss). Warm-intro letters, not legal drafts — use with counsel before
signature. **Design rule:** each letter asks for a number an investor can
verify, and says what Noviscia will publish back.

---

## Template A — Desk-side Letter of Intent (P2 / demand side)

> **Subject: Noviscia × {Desk name} — JIT intraday capacity pilot**
>
> To {Desk contact},
>
> Noviscia is building an on-chain clearing and intraday-margined-credit layer for
> Solana market makers: sub-slot (within-block) draws of pool capital against
> margin, atomic Jito bundles, a 24h "taxi-meter" premium window, and a funded
> first-loss fund. The full mechanics and honest economics are attached
> (`investor/v0.md` + `investor/VIABILITY_AND_UNIQUENESS.md`).
>
> We are signing design partners before building the pilot queue, and we believe
> {Desk} is a strong fit because:
> - you run {venue pairs / strategies}, which matches our {SCHEDULED / decomposition
>   covering the most slots} windows;
> - your model is edge-rich and balance-sheet-thin, which is exactly the desk Noviscia
>   is built to serve — capital you currently pre-position idle on venues or miss
>   entirely is capital you'd rent intraday instead.
>
> This letter is non-binding and costs nothing to return. It asks {Desk} to
> indicate, at its best current understanding:
> - Markets you'd trade against capacity: __________
> - Target sizes: up to ______ per slot / ______ window utilization (USD)
> - Desired frequency: ______ draws/day; target utilization % of a $1.5M desk cap: ______%
> - Our ask: under what conditions would you commit to a **60-day private pilot**
>   (margined, capped, supervised) if the mechanics above are live on devnet by
>   {date}? (Conditions: ______)
>
> In return we commit to publish, per pilot, a time-stamped evidence pack:
> landed bundle rate, settled premium ledger, and execution-vs-capital-efficiency
> impact — your data, your name (or pseudonym) in control.
>
> We'd be glad to walk the model together this week. Warmly,
> {Founder}, Noviscia

**What a returned letter must give you (demand truth):** a utilization %, a size,
and the "conditions under which I'd pilot." A letter with no number is a no.
Score: signed-with-numbers (2 required) vs. no-numbers (0) is the P2 gate.

---

## Template B — LP-side first-loss commitment (P5 / supply side)

> **Subject: Noviscia senior-protection / first-loss participation — {amount}?**
>
> To {LP / fund contact},
>
> Noviscia runs a CCP that finances Solana market makers intraday (400ms-slotted,
> atomic, margined) and returns depositors money-market-grade yield with bounded
> tail risk. Our honest economics are one attachment (`investor/v0.md`): at the
> $10M reference, $323,110/yr LP yield (3.23% blended / 4.50% senior) from defined
> utilization assumptions — and the stress tables show **senior LPs untouched in all
> 11 modeled scenarios**, with losses absorbed through desk margin → LoC → DIF →
> junior (first-loss) → senior, plus a hard 50%-junior lock breaker.
>
> Before we market to senior LPs, we are anchoring the **first-loss layer** — the
> piece that determines whether the bounded-tail-risk claim is bankable.
>
> We are inviting {Fund} to consider a first-loss participation of **{amount}** (of a
> $3M junior target at reference) under:
> - a documented, modeled loss-waterfall you can re-run yourself
>   (`npm test` + `generate-investor-report.ts` from a clean checkout);
> - bankruptcy-remote structure + the custody-integration rail from
>   `COMPLIANCE.md` (counsel-led, per v0 §7 m3);
> - published desk LOIs and the first funded desk's premium history before your
>   commitment converts from non-binding intent.
>
> Non-binding at this stage. We are asking for: **senior protection conviction
> (amount + tenor + the conditions under which the commitment converts).**
>
> Would a 30-minute model walkthrough with the devnet pilot running live be a good
> next step? Warmly, {Founder}

**What a returned letter must give you (supply truth):** an amount, a tenor, and
conversion conditions. This is the P5 gate — *funded before any senior pitching*.

---

## Scoring rule (shared, applies to both)

| Result | Score | Meaning |
|---|---|---|
| Signed, with numbers | +1 each | Real demand/supply signal |
| Signed, no numbers ("sounds great") | 0 | Noise — do not count |
| Conditions met then signed | 0 until met | Convert after the condition is met |

Gate needs: **2 desk LOIs (numbered)** + **1 funded first-loss commitment** within
90 days — else Variant C (license the engine to a venue / Maple / custodian) per
`PROOF_GATE_90D.md` §4.