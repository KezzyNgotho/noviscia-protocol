/**
 * Borrower Feasibility Proof — Module 3 of the TVV risk engine.
 *
 * Answers the institutional question: *"why would a searcher pay the
 * micro-premium at all?"* Module 1 (`economics.ts`) proves the pool-level
 * waterfall ($10M → $460,800 → $323,110.40); Module 2 (`velocity.ts`) proves
 * the turnover that generates it. This module proves the **desk-level**
 * economics: the toll is a structural credit util (a micro-toll on real
 * velocity), not an emission — its cost is near-zero relative to the spread
 * the borrower is already capturing.
 *
 * All numbers are integer arithmetic on USD cents / micro-USD, twin-locked to
 * `noviscia-asset-engine-sdk::feasibility` (both are pinned by the same tests).
 *
 * Reference scenario (the audited `$10,000,000` pool, max desk):
 *
 * | Item | Formula | Result |
 * |---|---|---|
 * | Single-desk cap (`C_desk`) | 15% of `$10M` | `$1,500,000` |
 * | Total slots/yr | `31,536,000 × 2.5` | `78,840,000` |
 * | Per-slot toll on a max desk | `C_desk × R_base / S_total` | **`≈ $0.004566`** (4,566 µUSD) |
 * | Cross-DEX spread @ 15 bps | `C_desk × 0.15%` | `$2,250.00` |
 * | Aggressive Jito MEV tip (60%) | `60% × spread` | `$1,350.00` |
 * | Borrower net (ex-ante toll) | spread − tip | `$900.00` |
 * | Toll share of gross spread | toll / spread | `2,029 ppb` (≈ 0.0002%) |
 * | Toll share of borrower net | toll / net | `≈ 5 ppm` |
 * | Max-desk annual toll @ full landing | toll × `S_elig` | `$287,986.75` |
 *
 * Precision notes for reviewers:
 * - Exact integer floors give the max-desk toll `$0.004566` (4,566 µUSD) — the
 *   `$0.004565` printed in marketing material rounds down.
 * - The borrower net on the reference example is an exact `$900.00`
 *   (`$2,250 − $1,350`); the `$895` figure floating around a deck is an
 *   approximation, not the pinned value.
 */

import {
  ECONOMICS_BPS,
  MICRO_DOLLARS_PER_CENT,
  mulDiv,
  totalSlotsPerYear,
  eligibleSlots,
  deskCapUsdCents,
  systemicCapUsdCents,
  type TvvParams,
} from './economics';

/** The reference cross-DEX mismatch used by the borrower example (15 bps). */
export const REF_MISMATCH_BPS = 15n;

/** The aggressive Jito bundle tip share used by the borrower example (60%). */
export const REF_TIP_SHARE_BPS = 6_000n;

const PARTS_PER_BILLION = 1_000_000_000n;
const PARTS_PER_MILLION = 1_000_000n;

/**
 * The single-slot toll on a specific desk, in micro-USD ($1e-6).
 * `floor(desk × R_base / S_total)` — the desk's share of the annual facility
 * rate spread across every 400ms slot. Reference max desk: 4,566 µUSD
 * (`$0.004566`).
 */
export function deskSlotTollMicroUsd(p: TvvParams, deskUsdCents: bigint): bigint {
  const annual = mulDiv(deskUsdCents, p.baseRateBps, ECONOMICS_BPS);
  return mulDiv(annual, MICRO_DOLLARS_PER_CENT, totalSlotsPerYear());
}

/** The toll on a max-sized desk (`C_desk`). Reference: 4,566 µUSD / slot. */
export function maxDeskSlotTollMicroUsd(p: TvvParams): bigint {
  return deskSlotTollMicroUsd(p, deskCapUsdCents(p));
}

/**
 * The execution-sizing lever the HFT pitch rests on: how many times the desk's
 * own fluid wallet cash the single-desk cap lets it borrow per slot.
 * Reference: a desk with `$100,000` fluid on its wallet borrows **15×** that
 * at the `$1.5M` cap. Zero/negative wallet cash → 0× (no multiplier).
 */
export function deskSizingMultiplierUsd(p: TvvParams, walletUsdCents: bigint): bigint {
  if (walletUsdCents <= 0n) return 0n;
  return deskCapUsdCents(p) / walletUsdCents;
}

/**
 * How many max-sized desks the systemic cap can host at once on the reference
 * pool: `floor(C_sys / C_desk)`, floored at 1 (a pool always hosts at least one
 * desk). Reference: 60% / 15% = **4** max desks — a desk must share the engine
 * with at most 3 others its size.
 */
export function maxConcurrentMaxDesks(p: TvvParams): bigint {
  const sys = systemicCapUsdCents(p);
  const desk = deskCapUsdCents(p);
  return desk <= 0n ? 0n : sys / desk < 1n ? 1n : sys / desk;
}

/** Gross spread a desk captures on one route: `desk × mismatch_bps / BPS`. */
export function borrowerGrossSpreadUsdCents(deskUsdCents: bigint, mismatchBps: bigint): bigint {
  return mulDiv(deskUsdCents, mismatchBps, ECONOMICS_BPS);
}

/** The Jito MEV tip the desk pays to win the bundle auction. */
export function borrowerTipUsdCents(grossUsdCents: bigint, tipShareBps: bigint): bigint {
  return mulDiv(grossUsdCents, tipShareBps, ECONOMICS_BPS);
}

/**
 * Borrower net after the tip and the Noviscia toll, floored at zero cents.
 * The toll is sub-cent per trade (4,566 µUSD < 1 cent) so it floors away at
 * cent precision — the concrete "imperceptible toll" claim.
 */
export function borrowerNetUsdCents(
  p: TvvParams,
  deskUsdCents: bigint,
  mismatchBps: bigint,
  tipShareBps: bigint,
): bigint {
  const gross = borrowerGrossSpreadUsdCents(deskUsdCents, mismatchBps);
  const tip = borrowerTipUsdCents(gross, tipShareBps);
  const tollCents = mulDiv(deskSlotTollMicroUsd(p, deskUsdCents), 1n, MICRO_DOLLARS_PER_CENT);
  const net = gross - tip - tollCents;
  return net < 0n ? 0n : net;
}

/** The toll as parts-per-billion of the gross spread (reference: 2,029 ppb). */
export function tollShareOfGrossPpb(
  p: TvvParams,
  deskUsdCents: bigint,
  mismatchBps: bigint,
): bigint {
  const toll = deskSlotTollMicroUsd(p, deskUsdCents);
  const gross = borrowerGrossSpreadUsdCents(deskUsdCents, mismatchBps);
  return mulDiv(toll, PARTS_PER_BILLION, gross * MICRO_DOLLARS_PER_CENT);
}

/** The toll as parts-per-million of the borrower's net profit (≈ 5 ppm). */
export function tollShareOfNetPpm(
  p: TvvParams,
  deskUsdCents: bigint,
  mismatchBps: bigint,
  tipShareBps: bigint,
): bigint {
  const toll = deskSlotTollMicroUsd(p, deskUsdCents);
  const net = borrowerNetUsdCents(p, deskUsdCents, mismatchBps, tipShareBps);
  return mulDiv(toll, PARTS_PER_MILLION, net * MICRO_DOLLARS_PER_CENT);
}

/**
 * What a single desk at `desk` pays per year if it borrows continuously on
 * every eligible (landing) slot: `toll × S_elig`. Reference max desk:
 * `$287,986.75`. This is the concentration ceiling — a single max desk at full
 * utilization could generate ~62% of the reference `$460,800` gross.
 */
export function deskAnnualTollUsdCentsAtFullLanding(p: TvvParams, deskUsdCents: bigint): bigint {
  const annualMicroUsd = mulDiv(deskSlotTollMicroUsd(p, deskUsdCents), eligibleSlots(p), 1n);
  return mulDiv(annualMicroUsd, 1n, MICRO_DOLLARS_PER_CENT);
}

/**
 * Proof harness: the per-slot annual toll reconstructs the closed form
 * `desk × R_base × L_jito` within 1% under integer flooring — mirrors the
 * Module-2 `formulaDReconciles` consistency guarantee at desk level.
 */
export function deskAnnualTollReconciles(p: TvvParams, deskUsdCents: bigint): boolean {
  const priced = mulDiv(deskUsdCents, p.baseRateBps, ECONOMICS_BPS);
  const closed = mulDiv(priced, p.jitoLandingBps, ECONOMICS_BPS);
  const slotted = deskAnnualTollUsdCentsAtFullLanding(p, deskUsdCents);
  const diff = closed > slotted ? closed - slotted : slotted - closed;
  return diff * 100n <= closed;
}