import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NettingLedger } from '../src/nettingLedger';
import { TenantSandbox } from '../src/tenantSandbox';

test('netting ledger reduces matched opposing exposure', () => {
  const ledger = new NettingLedger();

  ledger.recordTrade({ tenant: 'alice', market: 'SOL', side: 'long', notionalUsdc: 12000 });
  ledger.recordTrade({ tenant: 'bob', market: 'SOL', side: 'short', notionalUsdc: 9000 });
  ledger.recordTrade({ tenant: 'charlie', market: 'SOL', side: 'short', notionalUsdc: 5000 });

  const report = ledger.computeNettingReport('SOL');
  assert.equal(report.grossLongUsdc, 12000);
  assert.equal(report.grossShortUsdc, 14000);
  assert.equal(report.nettedExposureUsdc, 2000);
  assert.ok(report.nettingBenefitUsdc > 0, 'opposing positions should reduce exposure');
});

test('tenant sandbox isolates product access and execution state', () => {
  const sandbox = new TenantSandbox('tenant-A', ['perps']);

  assert.equal(sandbox.canAccess('perps'), true);
  assert.equal(sandbox.canAccess('spot-dex'), false);

  sandbox.recordExecution({ adapter: 'perps', payload: { side: 'long', size: 2500 } });
  const history = sandbox.listExecutions();

  assert.equal(history.length, 1);
  assert.equal(history[0].adapter, 'perps');
  assert.equal(sandbox.getBalance(), 0);
});
