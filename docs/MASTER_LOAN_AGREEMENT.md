# Noviscia Master Loan Agreement (MLA)

> Version 1.0 — Institutional Unsecured Credit Facility Layer
> Supersedes: — | Effective upon counterparty signature of the Loan Application Schedule and acceptance by the Noviscia Risk Committee.
> Governing Law: State of New York, United States of America.

This Master Loan Agreement ("MLA") is the binding legal contract underlying the Noviscia credit
scoring infrastructure. It is the instrument that converts an on-chain smart-contract parameter —
the credit limit held in each desk's `InstitutionalCreditLine` — into an enforceable, real-world
corporate obligation, so that multi-billion-dollar high-frequency trading (HFT) desks may trade on
underwritten credit lines drawn against the Solana, USDC and NVSC liquidity backing the pool.

The MLA expressly recognizes that the Noviscia Asset Engine executes on Solana's
400-millisecond slot architecture. Its drafting principle is therefore a negotiated split of
authority between code and law: **code governs execution speed; corporate law governs financial
finality.**

---

## Parties

1. **Lender**: The Noviscia Liquidity Pools, constituted collectively by the holders of nUSDC,
   nSOL and nNVSC LP share positions in the Noviscia Asset Engine, acting through the Noviscia
   Core Ecosystem Council ("Noviscia") as administrator and agent of the pools (the "Lender").
2. **Borrower**: Each institutional counterparty authorized to draw under the Facility pursuant
   to an executed Loan Application Schedule and accepted by the Noviscia Risk Committee (the
   "Borrower").

References to "the Protocol" mean the deployed `noviscia-asset-engine` program together with its
risk-monitoring oracle layer (the "Risk Sentinel") and its governance multi-sigs.

---

## Recitals

- **(A)** The Lender maintains revolving liquidity in wSOL, USDC and NVSC, allocated to
  underwritten credit lines and actively intermediated by HFT trading desks.
- **(B)** The Borrower operates an automated trading system that programmatically borrows and repays
  under the Facility across Solana's 400ms slots.
- **(C)** The parties intend the daily clearing mechanics, premium computations, and default
  triggers described herein to be deterministically executed by the Protocol, and to have legal
  force as contractual obligations, not merely as software behavior.
- **(D)** The parties therefore agree that software behavior on the chain reflects, and is
  evidence of, the contractual state defined by this MLA.

---

## Clause 1 — Facility Scope & Asset Definitions

### 1.1 Nature of the Facility

The Facility is a **non-committed, revolving, intraday and overnight credit facility**. Noviscia
is under no obligation to fund any particular draw; each draw is accepted by the Protocol at its
sole discretion and subject to available idle pool liquidity. The Facility is denominated in
access units ("risk capacity") rather than a single currency.

### 1.2 Borrowing Base

The Facility permits the Borrower to draw risk capacity in up to three settlement assets, each
backed by a dedicated on-chain pool:

| Asset | Pool | Settlement decimals | LP Share |
|---|---|---|---|
| Wrapped Solana (wSOL) | nSOL network liquidity pool | 9 | nSOL |
| USD Coin (USDC) | nUSDC stables cash pool | 6 | nUSDC |
| Noviscia Token (NVSC) | nNVSC native equity pool | 9 | nNVSC |

All draws, recredits, premium accrual and repayments occur atomically within a single slot; the
parties agree that no partial or in-flight borrow may exist across slot boundaries.

### 1.3 Underwriting & the Borrowing Limit

The maximum aggregate outstanding principal of the Borrower at any time shall not exceed the
**Borrowing Limit** encoded on-chain in the Borrower's `InstitutionalCreditLine`. The Borrowing
Limit is set to an amount derived from the Borrower's **Noviscia Risk Score (NRS)** — a score
maintained off-chain by the Risk Sentinel from trading history, loss experience, governance
standing and submitted financials — and is approved and varied only by the Tier-2 Risk Committee
of the three-tier governance structure (see Clause 7).

### 1.4 Haircut Acknowledgement

The Borrower acknowledges and unconditionally accepts that:

- (a) any pool balances it contributes, or that are attributed to it, to support credit headroom
  are liability-constrained and subject to **immediate, automated algorithmic haircuts** applied by
  the Protocol based on real-time oracle feeds; and
- (b) haircut parameters (including their magnitude and the ranking of the assets against which
  they apply) may be adjusted by the Risk Committee without notice, and such adjustments bind the
  Borrower from the slot at which they are written onto the chain.

### 1.5 Multi-Asset Allocation

Subject to the Borrowing Limit and to per-asset sub-limits, the Borrower may allocate its risk
capacity among wSOL, USDC and NVSC in any proportion, including within a single settlement window.
Each allocation reduces the Borrower's available headroom pro rata across the pools' idle capital.

---

## Clause 2 — Atomic Return & Daily Clearing Covenants

### 2.1 The Continuous Window

The parties agree that each borrowing episode constitutes one **Clearing Cycle** as follows:

- (a) the Cycle's clock **commences natively on-chain at the first slot** in which the Borrower's
  draw transaction is included (the `window_start_slot`); and
- (b) the Cycle **matures exactly 86,400 seconds (24 hours)** later, i.e. 216,000 Solana slots at
  400ms slot time, at which point the window is closed on-chain.

### 2.2 Settlement Obligation

The Borrower must settle each outstanding draw no earlier than the slot of borrowing and no later
than the 86,400-second maturity point of the Cycle. Settlement comprises, in aggregate and at the
same slot:

- (a) the outstanding **principal**;
- (b) all **micro-premiums** that accrued during the Cycle, computed by the Protocol as a function
  of the utilization, the desk's tier, and the risk-adjusted premium basis points set by the Risk
  Committee; and
- (c) any **late fee** accrued under Clause 3.

### 2.3 The Fee Toll — Exact-Asset Settlement

To maintain absolute accounting finality across three native settlement assets, the Borrower
covenants that **premiums and principal must be settled in the exact asset borrowed**. A draw of
wSOL is repaid in wSOL, a draw of USDC in USDC, and a draw of NVSC in NVSC. No substitution,
netting across assets, or in-kind credit is permitted without the prior written consent of the
Risk Committee.

### 2.4 Settlement Mechanics

Settlement is performed by the Protocol's `settle_daily` instruction, which verifies the Borrower's
payments satisfy the debt, credits the originating pool's idle capital, releases utilization for
the subsequent Cycle, and records the settlement timestamp on-chain. The parties agree that the
Protocol's on-chain records are conclusive evidence of the amount, time and asset of settlement.

### 2.5 Revolving Re-Use

Upon settlement, all released risk capacity returns to the Facility for the Borrower's further use
in subsequent Cycles, subject always to the Borrowing Limit and pool liquidity.

---

## Clause 3 — Programmatic vs. Legal Events of Default

### 3.1 Programmatic Soft-Lock

The Borrower consents to the automated actions of the Risk Sentinel and the Protocol. If the
Borrower crosses the 86,400-second maturity point without settling, the Protocol shall
automatically:

- (a) flip the Borrower's status on-chain to **Overdue**;
- (b) reject **all new single-slot borrow requests** until the overdue amount is settled (the
  `WindowOverdue` / frozen state); and
- (c) begin running the **late-fee meter** described in Clause 3.2.

This soft-lock is a technical, automatic consequence of the expiry and requires no manual or
human action. Its operation does not constitute a waiver of any right under this MLA.

### 3.2 The 2-Hour Operational Grace Period

The parties agree to a single, non-renewable **operational grace period of exactly 2 hours** —
18,000 slots at 400ms slot time — following the 86,400-second maturity point. During this period:

- (a) the soft-lock in Clause 3.1 remains in force;
- (b) the Borrower may settle the overdue principal and all accrued premiums; and
- (c) a **deterministic linear late fee** accrues on the outstanding principal on a per-slot basis,
  the meter being calibrated at `LATE_FEE_BASE = 10,000` units at `LATE_FEE_RATE_BPS = 50`,
  i.e. 0.50% cumulative if the full grace period is consumed.

### 3.3 Formal Event of Default

If the grace period expires without full settlement, the Borrower is in **Formal Event of Default**
under this MLA. From that moment, in addition to the continuing late-fee accrual, the Protocol and
Noviscia are legally authorized, acting together, to enforce the following remedies **in full and
without limitation or requirement of further notice**:

**(a) Freeze of Escrowed Loss Reserves & the Default Insurance Fund (DIF).** The Protocol shall
freeze any static escrowed loss reserves attributable to the Borrower and any contributions the
Borrower has made to the protocol's cross-market Default Insurance Fund, and apply the same toward
the outstanding obligations of the Borrower in the order the Protocol determines.

**(b) Cross-Collateralization.** If the Borrower defaults on obligations denominated in one asset
(e.g. USDC) but holds a surplus of another asset (e.g. wSOL or NVSC) standing to its credit in the
Engine or an affiliated vault, Noviscia retains the right to seize and liquidate those assets to
make the affected pool(s) whole, applying the proceeds in the order required by the liquidation
waterfall of the Protocol.

**(c) Acceleration.** All outstanding obligations of the Borrower under the Facility, howsoever
denominated, become immediately due and payable.

**(d) Corporate Recovery.** Noviscia may initiate immediate corporate asset recovery against the
Borrower through its traditional banking relationships or prime brokerage guarantees, and may
disclose the Event of Default to credit registries, auditors and regulators as permitted by law.

### 3.4 Default Pricing

From the commencement of the Formal Event of Default until full payment, obligations continue to
accrue (i) the per-slot late fee under Clause 3.2 and (ii) the Risk Committee's then-applicable
default surcharge, if any, compounded on settlement.

---

## Clause 4 — Representations & Warranties of the Borrower

The Borrower represents and warrants that:

- (a) it is a validly existing entity with contractual capacity to enter this MLA;
- (b) the signatories to this MLA and to any Loan Application Schedule are duly authorized;
- (c) its automated trading systems are configured to honor the Facility's settlement and no-reborrow
  covenants, and failures of such systems do not excuse performance;
- (d) its on-chain signatures are corporate signatures binding upon it;
- (e) it will not claim that Protocol state cannot constitute evidence of an obligation owed by it.

---

## Clause 5 — Affirmative & Negative Covenants

### 5.1 Affirmative

- Maintain KYB and KYC credentials as recorded by the Risk Committee's merkle-root registry.
- Settle every Cycle before the maturity point.
- Maintain a valid corporate address and authorized signatory list with Noviscia.

### 5.2 Negative

- No draw may exceed headroom or the Borrowing Limit.
- No netting or cross-asset substitution is permitted absent Risk Committee consent.
- No hedging of default risk may be asserted against the Lender's remedy rights.

---

## Clause 6 — Security and Cross-Collateralization

The parties agree that:

- (a) any pool balances, vault positions, or surplus risk capacity standing to the Borrower's credit
  constitute **security** for all Borrower obligations under this MLA (a floating, cross-collateral
  charge over such positions);
- (b) this security is enforced automatically and atomically by the Protocol upon a Formal Event of
  Default; and
- (c) the security's custody remains with the Protocol's program-owned vaults, and the Borrower
  irrevocably appoints Noviscia its attorney-in-fact to execute any instruction required to
  liquidate such positions.

---

## Clause 7 — Governance, Administration & Amendments

- **Tier 1 — Emergency Risk Guard (1-of-3).** May freeze borrowing or pause the JIT allocation loop
  in an emergency. Cannot alter loan economics or remedy rights.
- **Tier 2 — Risk Committee (3-of-5).** Approves the Borrower under Clause 1.3, sets Borrowing
  Limits and premium basis points, updates KYC roots and haircut parameters, and interprets the
  Facility's operating parameters.
- **Tier 3 — Core Ecosystem Council (5-of-7).** Administers lender interests, allocates treasury
  economic proceeds, authorizes enforcement under Clause 3.3 and approves amendments to this MLA.
  Structural changes are subject to the Protocol's 72-hour on-chain timelock.

All on-chain acts under this MLA are authorized only if signed by the tier whose key is recorded in
the `AssetEngineRegistry` for that act, as required by the Protocol's account validation.

---

## Clause 8 — Governing Law, Jurisdiction & Disputes

- (a) This MLA is governed by and construed in accordance with the laws of the **State of New York**,
  United States of America, without regard to conflict-of-laws principles.
- (b) Any dispute arising out of or relating to this MLA shall be resolved by binding arbitration
  administered in New York, New York, in accordance with the rules then in force, with one
  commercial arbitrator. Each party irrevocably submits to the exclusive jurisdiction of such
  arbitration for the permitted purposes.
- (c) The parties agree that the Protocol's on-chain records (settlement slots, premium
  computations, late-fee meters, freeze and breach events) are admissible and persuasive evidence
  of the contractual facts they record.

---

## Clause 9 — Definitions

- **Borrowing Limit** — the ceiling on outstanding principal in the `InstitutionalCreditLine` PDA.
- **Clearing Cycle** — the 86,400-second borrowing episode defined in Clause 2.1.
- **DIF** — the cross-market Default Insurance Fund maintained by the protocol.
- **Facility** — the non-committed revolving credit facility of Clauses 1–2.
- **Formal Event of Default** — the state defined in Clause 3.3.
- **NRS** — the Borrower's Noviscia Risk Score, maintained off-chain by the Risk Sentinel.
- **Risk Sentinel** — the off-chain monitoring/oracle layer that scores desks and observes slots.
- **Solana slot** — the ~400ms atomic execution unit on which the Protocol's timers are calibrated.

---

## Schedule A — Loan Application Schedule (per Borrower)

| Field | Value |
|---|---|
| Borrower legal name | ____________________ |
| Authorized signatories | ____________________ |
| Requested Borrowing Limit | ____________________ |
| Approved Borrowing Limit (Risk Committee) | ____________________ |
| NRS band at approval | ____________________ |
| Applicable premium basis points | ____________________ |
| Approved asset sub-limits (wSOL / USDC / NVSC) | ____________________ |
| Principal office / notices address | ____________________ |

---

## Schedule B — Protocol Integration Schedule (legal-to-code bridge)

This Schedule records, for each contractual obligation above, the on-chain artifact that
deterministically performs or evidences it. Law governs the meaning of the obligation; the listed
contract performs the execution. Differences between the performance and the obligation are to be
resolved in favor of the obligation as this Schedule is interpreted.

| Clause | Contractual obligation | On-chain artifact | Calibration |
|---|---|---|---|
| 1.2 | Borrowing base (wSOL/USDC/NVSC) | `register_asset` pool + vault + LP-share book | per-mint PDAs `asset_pool` / `asset_vault` / `asset_lp_mint` |
| 1.3 | Borrowing Limit by NRS | `initialize_credit_line` / `update_credit_limit` (Risk Committee) | `InstitutionalCreditLine.total_credit_limit` |
| 1.4 | Automated oracle haircuts | Risk Sentinel discount feed consumed by allocation | algorithmic, real-time |
| 1.5 | Multi-asset allocation | `allocate_asset_capacity` | per-mint headroom checks |
| 2.1(a) | Cycle clock starts at first slot | `window_start_slot` stamped at draw | first borrowing slot |
| 2.1(b) | 86,400-second maturity | `WINDOW_SLOTS = 216,000` slots | 216,000 × 400ms |
| 2.2 | Principal + premium settlement | `settle_daily` | same-slot verification |
| 2.3 | Exact-asset fee toll | per-mint vault settlement | no cross-asset netting |
| 3.1 | Overdue soft-lock / draw rejection | `WindowOverdue` guard + frozen flag | automatic at maturity |
| 3.2 | 2-hour grace + linear late fee | `GRACE_SLOTS = 18,000`; `LATE_FEE_BASE = 10,000`; `LATE_FEE_RATE_BPS = 50` | 18,000 × 400ms = 7,200s |
| 3.3(a) | Freeze of Escrowed Loss Reserves / DIF | Risk Committee + Council freeze rights; default-fund reserve accounts | upon Formal Event of Default |
| 3.3(b) | Cross-collateralization seizure | Council-authorized recovery via treasury/vault authority | after 3.3(a) |
| 3.3(d) | Corporate recovery | off-chain (banks / prime brokerage) | commenced by Noviscia |

---

*This document is a legal-architecture specification of the Noviscia Protocol's institutional
credit operations and is intended for counsel review before counterparty execution.*