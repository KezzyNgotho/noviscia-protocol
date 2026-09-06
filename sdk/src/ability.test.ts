import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PublicKey } from '@solana/web3.js';
import {
  guardNonJitoLeaderSlot,
  assertJitoLeader,
  leaderIsJito,
  NonJitoLeaderError,
} from './ability';
import { KNOWN_JITO_TIP_ACCOUNTS } from './jito';

test('leaderIsJito recognizes a Jito tip-committee leader', () => {
  assert.equal(leaderIsJito(KNOWN_JITO_TIP_ACCOUNTS[0]), true);
});

test('leaderIsJito rejects a non-Jito validator', () => {
  assert.equal(leaderIsJito(new PublicKey('11111111111111111111111111111111')), false);
});

test('guardNonJitoLeaderSlot allows allocation on a Jito leader', () => {
  const d = guardNonJitoLeaderSlot(48210339, KNOWN_JITO_TIP_ACCOUNTS[2]);
  assert.equal(d.ok, true);
  if (d.ok) assert.equal(d.slot, 48210339);
});

test('guardNonJitoLeaderSlot blocks capacity allocation on a non-Jito leader (checklist II.2)', () => {
  const slot = 48210340;
  const leader = new PublicKey('11111111111111111111111111111111'); // epoch shift → non-Jito
  const d = guardNonJitoLeaderSlot(slot, leader);
  assert.equal(d.ok, false);
  if (!d.ok) {
    assert.ok(d.error instanceof NonJitoLeaderError);
    assert.match(d.error.message, /NonJitoLeaderSlot/);
    assert.equal(d.error.slot, slot);
    assert.equal(d.error.leader.equals(leader), true);
  }
});

test('assertJitoLeader throws the NonJitoLeaderSlot error synchronously', () => {
  const leader = new PublicKey('11111111111111111111111111111111');
  assert.throws(() => assertJitoLeader(7, leader), NonJitoLeaderError);
});

test('assertJitoLeader passes on a Jito leader', () => {
  assert.doesNotThrow(() => assertJitoLeader(9, KNOWN_JITO_TIP_ACCOUNTS[4]));
});
