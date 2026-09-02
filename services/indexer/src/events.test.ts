import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { struct, u64, publicKey } from '@coral-xyz/borsh';
import { parseActivityFromLogs } from './events';

const IDL_DIR = path.resolve(__dirname, '../../../target/idl');

function loadIdl(name: string) {
  return JSON.parse(fs.readFileSync(path.join(IDL_DIR, `${name}.json`), 'utf8'));
}

function fieldLayout(ty: string) {
  if (ty === 'u64' || ty === 'i64') return u64();
  if (ty === 'pubkey') return publicKey();
  throw new Error(`unsupported field type ${ty}`);
}

// Build a `Program data:` log for an emitted event: encode its struct fields
// with borsh (in IDL field order) and prepend the event discriminator.
function eventLog(idlName: string, eventName: string, fields: Record<string, bigint | string>) {
  const idl = loadIdl(idlName);
  const ev = idl.events.find((e: { name: string }) => e.name === eventName);
  assert.ok(ev, `event ${eventName} present in ${idlName}`);
  const typeDef = idl.types.find((t: { name: string }) => t.name === eventName);
  assert.ok(typeDef, `type ${eventName} present in ${idlName}`);

  const fdefs = typeDef.type.fields as { name: string; type: string }[];
  const layout = struct(fdefs.map((f) => fieldLayout(f.type).replicate(f.name)));

  const values: Record<string, unknown> = {};
  for (const f of fdefs) {
    const raw = fields[f.name];
    if (f.type === 'pubkey') values[f.name] = new PublicKey(Buffer.from(raw as string, 'hex'));
    else values[f.name] = new BN(raw as bigint);
  }

  const buf = Buffer.alloc(layout.span);
  layout.encode(values, buf, 0);
  const disc = Buffer.from(ev.discriminator as number[]);
  return `Program data: ${Buffer.concat([disc, buf]).toString('base64')}`;
}

function fullLogs(programId: string, eventLines: string[]) {
  return [
    `Program ${programId} invoke [1]`,
    ...eventLines,
    `Program ${programId} success`,
  ];
}

const mm = Buffer.alloc(32, 7).toString('hex');
const winner = Buffer.alloc(32, 9).toString('hex');
const payer = Buffer.alloc(32, 3).toString('hex');

test('jit-risk SliceRented decodes program/event/revenue', () => {
  const pid = loadIdl('jit_risk').address as string;
  const log = eventLog('jit_risk', 'SliceRented', {
    mm, amount_usdc: 1_000_000_00n, delta_wad: 1_000_000n, premium: 250_000n, slot: 12345n,
  });
  const ev = parseActivityFromLogs(fullLogs(pid, [log])).find((e) => e.eventType === 'SliceRented');
  assert.ok(ev, 'SliceRented parsed');
  assert.equal(ev.program, 'jit-risk');
  // Revenue field (premium) preferred over capacity (amount_usdc).
  assert.equal(ev.amountUsdc, 250_000n);
});

test('gateway-auction registered; AuctionSettled decodes tip', () => {
  const pid = loadIdl('gateway_auction').address as string;
  const log = eventLog('gateway_auction', 'AuctionSettled', {
    slot: 42n, winner, premium_tips: 500_000n,
  });
  const ev = parseActivityFromLogs(fullLogs(pid, [log])).find((e) => e.eventType === 'AuctionSettled');
  assert.ok(ev, 'AuctionSettled parsed');
  assert.equal(ev.program, 'gateway-auction');
  assert.equal(ev.amountUsdc, 500_000n);
});

test('sovereign-netting registered; NettingRentPaid decodes rent', () => {
  const pid = loadIdl('sovereign_netting').address as string;
  const log = eventLog('sovereign_netting', 'NettingRentPaid', {
    payer, amount_base: 100_000n, rent_revenue_total_base: 1_000_000n,
  });
  const ev = parseActivityFromLogs(fullLogs(pid, [log])).find((e) => e.eventType === 'NettingRentPaid');
  assert.ok(ev, 'NettingRentPaid parsed');
  assert.equal(ev.program, 'sovereign-netting');
  assert.equal(ev.amountUsdc, 100_000n);
});
