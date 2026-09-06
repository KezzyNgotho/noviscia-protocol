/**
 * Jito leader eligibility guard — Institutional checklist II.2 (Non-Jito Safety
 * Switch).
 *
 * In production, bundles only get MEV-tier atomic inclusion when the slot leader
 * is a Jito tip-committee member. If an epoch shift assigns the next block
 * leader to a **non-Jito validator**, the SDK must refuse to route capacity
 * allocation immediately — never silently drop to a slow, non-atomic path.
 *
 * The guard is a pure predicate over the slot index and the current validator
 * set (the caller resolves `is_leader_jito` from the leader schedule):
 *
 *   - `guardNonJitoLeaderSlot(slot, isLeaderJito)` returns a `{ ok }` decision;
 *   - if the leader is **not** Jito it returns `{ ok: false, error:
 *     NonJitoLeaderSlot }` — the capacity allocation is blocked instantly;
 *   - `NonJitoLeaderError` carries `slot` for observability / alerting.
 *
 * The companion `leaderIsJito(leader, jitoTipAccounts)` helper is the canonical
 * on-chain-style check (a leader "is Jito" iff its pubkey is in the current tip
 * account committee — the same set used for `buildTipInstruction`).
 */

import { PublicKey } from '@solana/web3.js';
import { KNOWN_JITO_TIP_ACCOUNTS } from './jito';

export class NonJitoLeaderError extends Error {
  readonly slot: number;
  readonly leader: PublicKey;

  constructor(slot: number, leader: PublicKey) {
    super(
      'NonJitoLeaderSlot: the assigned block leader is not a Jito tip-committee validator; ' +
        'capacity allocation is blocked to prevent a non-atomic fallback',
    );
    this.name = 'NonJitoLeaderError';
    this.slot = slot;
    this.leader = leader;
  }
}

export type LeaderEligibility =
  | { ok: true; slot: number }
  | { ok: false; error: NonJitoLeaderError };

/**
 * Checklist II.2 — whether a block leader is a Jito validator. A leader is Jito
 * iff its pubkey is a member of the current Jito tip account committee.
 */
export function leaderIsJito(
  leader: PublicKey,
  tipAccounts: PublicKey[] = KNOWN_JITO_TIP_ACCOUNTS,
): boolean {
  return tipAccounts.some((tip) => tip.equals(leader));
}

/**
 * Checklist II.2 — the Non-Jito safety switch. Returns a success decision when
 * the leader is Jito; otherwise an immediate `NonJitoLeaderSlot` error that
 * blocks capacity allocation. Callers must gate any JIT allocation on this
 * before assembling/spending a bundle.
 */
export function guardNonJitoLeaderSlot(
  slot: number,
  leader: PublicKey,
  tipAccounts: PublicKey[] = KNOWN_JITO_TIP_ACCOUNTS,
): LeaderEligibility {
  if (leaderIsJito(leader, tipAccounts)) {
    return { ok: true, slot };
  }
  return { ok: false, error: new NonJitoLeaderError(slot, leader) };
}

/**
 * Convenience wrapper: `assertJitoLeader` throws on a non-Jito leader so a
 * caller can gate a JIT path with a single synchronous call.
 */
export function assertJitoLeader(
  slot: number,
  leader: PublicKey,
  tipAccounts: PublicKey[] = KNOWN_JITO_TIP_ACCOUNTS,
): void {
  const decision = guardNonJitoLeaderSlot(slot, leader, tipAccounts);
  if (!decision.ok) {
    throw decision.error;
  }
}
