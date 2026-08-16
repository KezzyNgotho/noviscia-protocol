import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gateway } from '../src/index';
import { TenantSandbox } from '../src/tenantSandbox';

test('gateway records recall intents in sandbox', () => {
  const gw = new Gateway(new (require('@solana/web3.js').Connection)('https://api.devnet.solana.com'));
  const sb = new TenantSandbox('tenant-X', ['perps']);
  (gw as any).sandboxes.set(sb.id, sb);

  const r = gw.recallForMargin(sb.id, 5000);
  assert.equal(r.success, true);
  const recalls = sb.read('recalls');
  assert.equal(Array.isArray(recalls), true);
  assert.equal(recalls[0].amount, 5000);
});
