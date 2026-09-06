/**
 * Noviscia Institutional Sandbox Hub — Phase 4: accelerated clearing + credit
 * freeze model (1,440× time acceleration).
 *
 * The institutional desk books against the on-chain asset-engine, whose
 * clearing window is expressed in REAL slots:
 *
 *   WINDOW_SLOTS = 216,000   (one Solana day at ~400ms blocks)
 *   GRACE_SLOTS  =  18,000   (grace before the position is deemed breached)
 *
 * A real day of clearing is unusable in a demo/CI environment, so the sandbox
 * collapses time by 1,440× (86,400 s → 60 s). The engine's slot domain maps
 * 1:1 onto the sandbox's virtual slots:
 *
 *   sandbox WINDOW = 216,000 / 1,440 =  150 sandbox slots  (= 60 s @ 400 ms)
 *   sandbox GRACE  =  18,000 / 1,440 = 12.5 sandbox slots  (=  5 s @ 400 ms)
 *
 * This module is a pure, deterministic twin of the on-chain posture derivation
 * (programs/cluster-2-tvv-gate/noviscia-asset-engine/src/lib.rs) plus the freeze predicate
 * used by the institutional verification checklist (Test 3 and Test 4).
 *
 * @module sandboxAccelerator
 */
import { 
  realToSandboxSlots,
  sandboxToRealSlots,
  postureAt,
  Posture,
  WINDOW_SANDBOX_SLOTS,
  GRACE_SANDBOX_SLOTS,
  ACCELERATION,
  REAL_SLOTS_PER_DAY,
  REAL_GRACE_SLOTS,
} from './sandboxClock';

export type {
  Posture as SandboxPosture,
};

/**
 * Interpret a desk posture as a human-readable state (mirrors the engine's
 * Risk Sentinel view).
 */
export function describePosture(p: Posture): string {
  switch (p) {
    case Posture.NoWindow: return 'no-window (nothing outstanding)';
    case Posture.Open: return 'open (inside clearing window)';
    case Posture.Overdue: return 'overdue (in grace — toll accrues)';
    case Posture.Breached: return 'breached (window + grace elapsed — reverting / credit frozen)';
  }
}

export interface FrozenDesk {
  institution: string;
  mint: string;
  posture: Posture;
  slotNow: number;
  windowStart: number; // sandbox slots (0 = never opened)
  principalUsdCents: number;
}

/** Filter the desks with a frozen (breached) posture — Test 3 predicate. */
export function frozenDesks(
  desks: { institution: string; mint: string; posture: Posture }[]
): { institution: string; mint: string }[] {
  return desks.filter((d) => d.posture === Posture.Breached).map(({ institution, mint }) => ({ institution, mint }));
}

/** Whether ANY desk has breached (aggregate circuit breaker view). */
export function anyFrozen(desks: { posture: Posture }[]): boolean {
  return desks.some((d) => d.posture === Posture.Breached);
}

/** Wall-clock ms of a given sandbox-slot span at the stream cadence. */
export function sandboxSlotsToWallMs(slots: number, cadenceMs = 400): number {
  return Math.round(slots * cadenceMs);
}

export { 
  realToSandboxSlots,
  sandboxToRealSlots,
  postureAt,
  WINDOW_SANDBOX_SLOTS,
  GRACE_SANDBOX_SLOTS,
  ACCELERATION,
  REAL_SLOTS_PER_DAY,
  REAL_GRACE_SLOTS,
};