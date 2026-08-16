import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { Gateway } from '../src/index';
import { TenantSandbox } from '../src/tenantSandbox';

class DummyAdapter {
  name = 'perps';
  requiredAccounts() { return []; }
  async buildActionTx() { return {} as any; }
}

test('gateway enforces tenant sandbox adapter access and records execution', async () => {
  const gw = new Gateway({} as any);
  gw.registerAdapter(new DummyAdapter());

  const sbDenied = new TenantSandbox('tenant-deny', []);
  (gw as any).sandboxes.set(sbDenied.id, sbDenied);

  const signer = Keypair.generate();
  const r1 = await gw.executeAdapterAction('perps', { market: 'SOL' }, signer, sbDenied.id);
  assert.equal(r1.success, false);
  assert.equal(r1.note, 'adapter-not-allowed');

  const sbAllow = new TenantSandbox('tenant-allow', ['perps']);
  (gw as any).sandboxes.set(sbAllow.id, sbAllow);

  const r2 = await gw.executeAdapterAction('perps', { market: 'SOL' }, signer, sbAllow.id);
  assert.equal(r2.success, true);
  assert.equal(r2.note, 'sandbox-dryrun');

  const executions = sbAllow.read('executions');
  assert.equal(Array.isArray(executions), true);
  assert.equal(executions.length >= 1, true);
  assert.equal(executions[0].adapter, 'perps');
});
