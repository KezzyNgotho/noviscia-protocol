import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gateway } from '../src/index';
import { TenantSandbox } from '../src/tenantSandbox';
import { NettingLedger } from '../src/nettingLedger';
import { ExecutionEngine } from '../src/executionEngine';

class DummyAdapter {
  name = 'perps';
  requiredAccounts() { return []; }
  async buildActionTx(params: any, signer: any) { return new (require('@solana/web3.js').Transaction)(); }
}

test('execution engine records trades and calls gateway', async () => {
  const gw = new Gateway(new (require('@solana/web3.js').Connection)('https://api.devnet.solana.com'));
  gw.registerAdapter(new DummyAdapter());
  const ledger = new NettingLedger();
  const engine = new ExecutionEngine(gw, ledger);

  const sb = new TenantSandbox('t1', ['perps']);
  // register the tenant sandbox with the gateway so dry-run lookup succeeds
  (gw as any).sandboxes.set(sb.id, sb);
  const signer = { publicKey: 'dummy' };

  const r = await engine.execute({ tenant: 't1', adapter: 'perps', market: 'SOL', side: 'long', notionalUsdc: 5000 }, signer, sb);
  assert.ok(r.success, r.note);

  const report = ledger.computeNettingReport('SOL');
  assert.equal(report.grossLongUsdc, 5000);
});
