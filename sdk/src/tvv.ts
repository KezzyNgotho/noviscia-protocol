/**
 * TVV — Jit-Risk Time-Slice Marketplace math twin.
 *
 * Byte-parity reference for the on-chain `tvv` module in `nv-usdc-vault`
 * (Program ID 5fmZJ4XsMfQpnM1wMH6DW5KNBAgCQF88762xtDEb94ST). Mirrors the
 * integer arithmetic only — the contract's transfer/marking legs are exercised
 * by the instruction e2e, not here.
 *
 * Two sleeves:
 *  - S1 (atomic): per-slot reserved capacity, lossless-by-construction.
 *  - S2 (credit): 24h-netting facility with margin + 6-step default waterfall.
 *
 * All values are USDC base-6 integers; no floats.
 */

export const BPS = 10_000;
export const S1_TOLL_MAX_BPS = 500;
export const DEFAULT_S2_MARGIN_BPS = 3_000; // 30%
export const S2_MARGIN_FLOOR_BPS = 5_000; // 50%
export const S2_WINDOW_SLOTS = 216_000; // 24h @ 400ms

export interface S1Capacity {
  vaultConfig: string;
  active: boolean;
  slotCeilingUsd: number;
  jitoWindowSlots: number;
  strictBundle: boolean;
  tollBps: number;
  drawsThisSlot: number;
  slotKey: number;
}

export interface S2DeskCredit {
  desk: string;
  vaultConfig: string;
  totalLimit: number;
  drawn: number;
  marginPosted: number;
  marginBps: number;
  frozen: boolean;
  dayOpenSlot: number;
}

/** Capacity check: draw allowed only within the live slot window + ceiling. */
export function s1DrawAllowed(
  state: S1Capacity,
  currentSlot: number,
  amount: number,
): boolean {
  if (!state.active || amount <= 0) return false;
  if (state.slotKey !== currentSlot) return false;
  return state.drawsThisSlot + amount <= state.slotCeilingUsd;
}

/** S1 per-slot toll in USDC base-6: `principal × tollBps / 10_000` (floor). */
export function s1Toll(principal: number, tollBps: number): number {
  return Math.floor((principal * tollBps) / BPS);
}

/** 90/10 toll split → (navBoost, treasuryCut). */
export function tollSplit(toll: number): [number, number] {
  const nav = Math.floor((toll * 9_000) / BPS);
  return [nav, toll - nav];
}

/** Draw headroom a desk still has: `limit - drawn` (saturating). */
export function s2Available(credit: S2DeskCredit): number {
  return Math.max(0, credit.totalLimit - credit.drawn);
}

/** Margin haircut floor: `margin × floorBps / 10_000`. */
export function marginHaircutFloor(margin: number, floorBps: number): number {
  return Math.floor((margin * floorBps) / BPS);
}

/** Health gate: posted margin must cover `floorBps %` of the post-draw usage. */
export function s2DrawHealthy(
  margin: number,
  floorBps: number,
  drawnAfter: number,
): boolean {
  const floorNeeded = Math.floor((drawnAfter * floorBps) / BPS);
  return margin >= floorNeeded;
}

/** End-of-day: elapsed slots since window open >= window length. */
export function s2WindowElapsed(
  dayOpenSlot: number,
  currentSlot: number,
  windowSlots: number = S2_WINDOW_SLOTS,
): boolean {
  return currentSlot - dayOpenSlot >= windowSlots;
}

/** Loss remaining after applying the desk's posted margin (saturating). */
export function waterfallAfterMargin(loss: number, margin: number): number {
  return Math.max(0, loss - margin);
}

/**
 * Simulate the full default waterfall in strict order:
 * protected → institutional → insurance → default fund.
 * Returns [uncovered, protectedEaten, instiEaten, insuranceEaten, defaultEaten].
 */
export function simulateWaterfall(
  uncovered: number,
  protectedCap: number,
  instiRemaining: number,
  insuranceRemaining: number,
  defaultFund: number,
): [number, number, number, number, number] {
  let rest = uncovered;

  const protectedEaten = Math.min(protectedCap, rest);
  rest -= protectedEaten;

  const instiEaten = Math.min(instiRemaining, rest);
  rest -= instiEaten;

  const insuranceEaten = Math.min(insuranceRemaining, rest);
  rest -= insuranceEaten;

  const defaultEaten = Math.min(defaultFund, rest);
  rest -= defaultEaten;

  return [rest, protectedEaten, instiEaten, insuranceEaten, defaultEaten];
}

export const TVV_SEEDS = {
  s1Capacity: 's1-capacity',
  s1Receipt: 's1-receipt',
  s2Desk: 's2-desk',
  s2Ledger: 's2-ledger',
  s2Margin: 's2-margin',
  s2Waterfall: 's2-waterfall',
} as const;
