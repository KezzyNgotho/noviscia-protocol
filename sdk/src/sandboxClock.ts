/**
 * Sandbox clock — the deterministic 1,440× projection of the on-chain
 * asset-engine clearing window (Module 3, Phase 4).
 *
 * The engine (programs/active/noviscia-asset-engine/src/lib.rs) derives a
 * desk's posture from REAL slots:
 *
 *   no window until a first borrow opens it at slot `w`;
 *   OPEN      while `t <  w + WINDOW_SLOTS  (216,000)`    — inside the window;
 *   OVERDUE   while `t <  w + WINDOW + GRACE (18,000)`    — grace, toll accrues;
 *   BREACHED  once  `t >= w + WINDOW + GRACE`             — revert/credit-frozen.
 *
 * The sandbox projects the slot domain at 1,440× so one real day collapses to
 * 60 s (150 sandbox slots @ 400 ms). Every function here is deterministic —
 * the same `(windowStart, t)` pair always yields the same posture, exactly
 * like the on-chain derivation. Keep this file in lockstep with
 * services/sandbox-hub/src/posture.rs (they must agree to the slot).
 *
 * @module sandboxClock
 */

/** 1440× acceleration — one real day (86,400 s) collapses to 60 s. */
export const ACCELERATION = 1_440;

/** On-chain clearing window (real slots per Solana day). */
export const REAL_SLOTS_PER_DAY = 216_000;

/** On-chain grace period before a position is deemed breached (real slots). */
export const REAL_GRACE_SLOTS = 18_000;

/** Sandbox-slot projection of the clearing window (216,000 / 1,440). */
export const WINDOW_SANDBOX_SLOTS = REAL_SLOTS_PER_DAY / ACCELERATION;

/** Sandbox-slot projection of the grace period (18,000 / 1,440). */
export const GRACE_SANDBOX_SLOTS = REAL_GRACE_SLOTS / ACCELERATION;

/** Wall-clock cadence of one sandbox slot (matches the Tier-2 stream). */
export const SANDBOX_CADENCE_MS = 400;

/** Posture, i32-byte-compatible with the proto DeskStatusResponse enum. */
export enum Posture {
  NoWindow = 0,
  Open = 1,
  Overdue = 2,
  Breached = 3,
}

/** Real slots → sandbox slots (the 1,440× projection). */
export function realToSandboxSlots(realSlots: number): number {
  return realSlots / ACCELERATION;
}

/** Sandbox slots → real slots (inverse projection). */
export function sandboxToRealSlots(sandboxSlots: number): number {
  return sandboxSlots * ACCELERATION;
}

/**
 * Deterministic window posture (mirrors the engine's derivation in lockstep
 * with services/sandbox-hub/src/posture.rs).
 *
 * @param windowStartSlot slot the desk window opened (sandbox slots; 0 = never)
 * @param currentSlot     slot the observer is reporting (sandbox slots)
 * @param outstanding     true if active_principal > 0
 */
export function postureAt(windowStartSlot: number, currentSlot: number, outstanding: boolean): Posture {
  if (!outstanding || windowStartSlot === 0) return Posture.NoWindow;
  const mature = windowStartSlot + WINDOW_SANDBOX_SLOTS;
  if (currentSlot < mature) return Posture.Open;
  if (currentSlot < mature + GRACE_SANDBOX_SLOTS) return Posture.Overdue;
  return Posture.Breached;
}

/** Wall-clock seconds a sandbox clearing window spans (150 slots → 60 s). */
export function windowWallClockSeconds(cadenceMs = SANDBOX_CADENCE_MS): number {
  return (WINDOW_SANDBOX_SLOTS * cadenceMs) / 1000;
}