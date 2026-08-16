import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Connection } from '@solana/web3.js';

const RPC_URL = process.env.SOLANA_RPC_URL || process.env.SOLANA_URL;

test('e2e: local validator smoke (skipped if no RPC)', async (t) => {
  if (!RPC_URL) {
    console.log('Skipping E2E: no SOLANA_RPC_URL provided');
    return;
  }

  const conn = new Connection(RPC_URL, 'confirmed');
  const v = await conn.getVersion();
  assert.ok(v['solana-core'] || v['feature-set']);
});
