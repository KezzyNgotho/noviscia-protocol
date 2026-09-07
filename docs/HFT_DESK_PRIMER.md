# HFT Desk Primer — The Execution-Velocity Primitive (Not a Loan)

> **Purpose:** the framing document an HFT/quant desk reads before touching the SDK. It exists to kill
> the most damaging misread of Noviscia — *"this is a corporate loan or a passive cash facility."*
> It is neither. It is a **single-slot execution-velocity primitive**: the desk borrows balance
> size for 400 ms inside an atomic Jito bundle, pays a micro-toll, and the desk's alpha extraction is
> what funds LP yield. Every number below is integer-pinned by the twin SDKs (TS + Rust) and
> replayable with one command.
>
> **Status:** Living; pinned by `sdk/src/feasibility.ts` + Rust `feasibility.rs` (Module 3),
> `economics.rs/.ts` (Module 1), `velocity.rs/.ts` (Module 2) and the independent Python ledger
> `scripts/financial-model/verify-real-yield.py` (17 checks). **Last updated:** September 7, 2026.

---

## 1. The framing

To a quant trading desk, **capital is useless if it sits idle or moves too slowly.** They do not
want money — they want *synchronized execution velocity*. Noviscia sells exactly that, on the
Solana ledger clock:

```
OLD CONSTRAINED PIPELINE (OWN CAPITAL ONLY)
  [ Desk's proprietary cash ] ──> split across 10 DEXs/pools ──> small sizing per pool ──> low extraction yield

NOVISCIA ACCELERATED PIPELINE (TVV ENGINE)
  [ Unified treasury ] + [ JIT desk capacity ] ──> max sizing per slot (≤ $1.5M) ──> hyper-multiplied alpha extraction
```

Three properties do the work for the desk:

| Lever | What it does | Pinned number | Module |
|---|---|---|---|
| **Sizing multiplier** | Borrow per-slot balance up to the single-desk cap, not your wallet cash | **15×** vs a `$100k` fluid wallet | 3 (`deskSizingMultiplierUsd`) |
| **Capital consolidation** | Park cash in a unified treasury; credit slots are the deployed balance | `63,072,000` lending turns / yr | 2 (Formula A) |
| **Atomic risk shield** | Borrow + trade in one bundle; any leg failing invalidates the whole bundle | **$0.00 capital at risk on a failed bundle** | 3 (`borrowerNetUsdCents` floor) |

## 2. Lever 1 — maximize per-slot extraction size (the multiplier)

If a bot spots a structural mispricing between a Raydium pool and an order book (e.g. Phoenix),
the profit it can capture is capped by the size of the balance it can place **in that slot
profitably**. A desk keeping `$100,000` fluid in a wallet extracts only the fraction of the
mismatch that size clears. With Noviscia the same desk boots per-slot lending power to the
single-desk cap.

```text
multiplier = C_desk / wallet_cash = $1,500,000 / $100,000 = 15×
```

The modeled single-slot P&L for that desk (reference route, 15 bps mismatch, aggressive 60% Jito tip):

```text
gross spread  = $1,500,000 × 15 bps = $2,250.00
Jito tip      = $2,250 × 60%         = $1,350.00
Noviscia toll = $0.004566            (floors to $0.00 at cent precision)
desk net      = $900.00
```

The toll is **2,029 ppb of the spread and ≈ 5 ppm of the desk's net** — an order of magnitude below
Solana's own priority-fee noise. `borrowerNetUsdCents` *floors at zero*: no route can go negative
because of the toll.

### 2.1 The shared-pool bound — you do not size the whole pool

Cap accounting matters to a desk sizing model. The engine caps borrowing at **15% of the pool per
desk** and **60% in aggregate** (`C_desk`, `C_sys`):

```text
max concurrent max-sized desks = C_sys / C_desk = $6,000,000 / $1,500,000 = 4
```

On the reference pool the desk shares the engine with **at most 3 other desks its size**
(`maxConcurrentMaxDesks`). The multiplier is per-desk by construction — competition for slots is
bounded and deterministic, not an auction.

> **Honest caveats** (state these to the desk's risk team — their model will find them anyway):
> - *"Capture the entire spread"* assumes ≥ `$1.5M` of resting depth across the route. The `$2,250`
>   gross is the modeled reference, not a guarantee; a thinner book yields a smaller spread at a
>   smaller mismatch bps (`borrowerGrossSpreadUsdCents` scales linearly).
> - The multiplier is the *cap/wallet* ratio, not a return multiple. The 15× is a sizing lever;
>   realized alpha still depends on the strategy's hit rate.

## 3. Lever 2 — consolidate capital velocity, kill cash drag

Traditional market-making pre-funds and parks millions across dozens of isolated pools to avoid
missing split-second windows. That is dead capital. With TVV the desk:

1. Pulls proprietary balances back into a **unified treasury** (one balance-sheet, the CCP-style
   single truth described in [`PARTICIPANT_ACCESS.md`](PARTICIPANT_ACCESS.md)).
2. Runs bots at full throttle on **credit slots** of up to `$1.5M` per bundle.
3. Settles through the **24-hour clearing window** — one calm daily batch transfer, instead of
   block-by-block safety buffers.

The 24 h reset also *raises* the desk's implied annual rate on the same tolls: simple `4.608%`
compounds to `4.715%` at daily frequency (`compoundedApyTenthsBps`). Same real volume, higher
effective yield.

## 4. Lever 3 — the atomic risk shield

The desk's worst ordinary-Solana failure modes: a large arb through the public mempool lands
**partially** when the market shifts mid-flight, burns gas, or strands toxic inventory in the
wallet. Under Jito bundling, a Noviscia borrow and the desk's trade are **one atomic unit**:

- If the arb leg fails or is front-run, the **entire bundle is invalid** — the borrowed USDC never
  moves, the desk's position never shifts, and there is **no partial fill and no stranded
  inventory**.
- The desk loses the *slot* at worst — never capital. No liquidation risk, no gas-loss-risk on the
  bundle.

> **Correction to earlier marketing copy:** Noviscia does **not** "force a block rollback." A
> failed bundle is simply **not included** in that slot; nothing forces the network to roll a block
> back. The accurate, defensible claim is: **failure ⇒ atomic invalidation ⇒ zero capital leakage.**
> Also note the shield covers *execution* risk of capital; it does not remove market risk on a
> bundle that lands successfully.

## 5. The symmetric value loop — both halves, quantified

The desk pays a toll that is, at maximum size, **≈ 5 ppm of its net on the reference route** — and
that same toll is the LP yield engine:

| Side | Cash flow | Magnitude (reference, max desk) |
|---|---|---|
| Desk → engine | slot tolls | `$0.004566` per landed slot · **≈ `$789`/day** at continuous full landing (`$287,986.75`/yr) |
| Desk (retained) | net per landed arb | `$900.00` — toll is ~5 ppm of it |
| Engine → DIF → LPs | 20% reserve / 80% payout on all tolls | `$80,777.60` → `$323,110.40` / yr across the pool |

The desk's `$789`/day worst-case toll is the price of renting `$1.5M` of per-slot sizing capacity —
less than a single sub-bps leg of the P&L it enables.

Yield honesty (a quant desk will recompute this in five minutes — get there first):
- Reference pool at 40% utilization: **senior 4.50%, junior ≈ 0.27%** — this is the *audited
  baseline*, not the headline.
- At 100% utilization the same engine yields **junior ≈ 18.43%** (`$552,776 / $3,000,000`, pinned by
  the workbook stress test; the marketing `19.11%` is not reproducible — see
  [`TVV_SPEC_SHEET.md`](TVV_SPEC_SHEET.md)).
- The **15–35%+** band is the *engineered target* reached by combining capacity utilization with the
  credit-tier levers (institution-side, not inflation). A reviewer can verify any number by running:

```bash
python3 scripts/financial-model/verify-real-yield.py   # 17 checks, exit 0 = ledger closes
```

## 6. Desk-model cheat sheet (plug your own params in)

Every value a desk's prop-research desk will want to parameterize — as `@noviscia/sdk` functions
(Rust twins in `noviscia-asset-engine-sdk`):

| Your input | Function | Result |
|---|---|---|
| Desk size `d` | `deskSlotTollMicroUsd(p, d)` | toll per 400 ms slot in µUSD |
| Wallet cash `w` | `deskSizingMultiplierUsd(p, w)` | max sizing multiple (`15×` @ `$100k`) |
| Mismatch `m` (bps) | `borrowerGrossSpreadUsdCents(d, m)` | your gross on one route |
| Tip share `t` | `borrowerTipUsdCents(gross, t)` | bundle-tip cost |
| Everything above | `borrowerNetUsdCents(p, d, m, t)` | realized net, floored at `$0` |

## 7. Five objections a desk will raise — honest answers

| Objection | Answer |
|---|---|
| **"Do I risk principal borrowing on-chain?"** | No. Exposure never outlasts the 400 ms slot and failure inverts the bundle atomically — the solo borrow neither lands nor leaves your position. Net floors at `$0`, never negative. |
| **"What does the toll cost at full throttle?"** | At full landing ≈ `$789`/day on a max desk — 5 ppm of the modeled `$900`/net per route (see §5). |
| **"Can I grab the whole pool?"** | No — 15% desk cap and 60% systemic cap. At most **4** max-sized desks coexist (`maxConcurrentMaxDesks`). |
| **"Is Noviscia faster than my infra?"** | The engine is a **balance/velocity primitive**, not a relay. It does not add latency; your bundle still flies your own path into Jito. The 400 ms width is Solana's, not ours. |
| **"Is the yield real or emission?"** | Volume-backed: tolls are paid per landed slot, double-counted by nothing, and the ledger closes to the cent in three independent implementations (TS, Rust, Python). The APY *band* is the honest part — see §5. |

## 8. What the desk plugs into

- **SDK entry points:** `deskSlotTollMicroUsd`, `borrowerNetUsdCents` (floors ≥ `$0`),
  `deskSizingMultiplierUsd`, `maxConcurrentMaxDesks` — `@noviscia/sdk` (TS) ·
  `noviscia-asset-engine-sdk` (Rust) · C++ builder parity.
- **The full machine:** [`sdk/README.md`](../sdk/README.md), [`PARTICIPANT_ACCESS.md`](PARTICIPANT_ACCESS.md) (bundle economics & tips).
- **The math that backs this document:** [`TVV_SPEC_SHEET.md`](TVV_SPEC_SHEET.md) (§5b Module 3, §2 velocity), [`QUANTIFIED_RISK_PACK.md`](QUANTIFIED_RISK_PACK.md) (pool waterfall).

---

*Rule of thumb for any Noviscia-facing desk: you are not borrowing money — you are renting
400-ms execution size at ~5 ppm of your net on the reference route, inside an atomic bundle the
network cannot partially fill. Four desks max, `$789`/day worst-case toll, your capital never moves
unless the whole bundle lands. That is the whole pitch.*