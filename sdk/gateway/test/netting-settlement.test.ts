import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gateway } from '../src/index';
import { NettingLedger } from '../src/nettingLedger';
import { NettingSettlement } from '../src/nettingSettlement';

test('netting settlement publishes report to gateway', () => {
  const gw = new Gateway(new (require('@solana/web3.js').Connection)('https://api.devnet.solana.com'));
  const ledger = new NettingLedger();
  ledger.recordTrade({ tenant: 'a', market: 'SOL', side: 'long', notionalUsdc: 12000 });
  ledger.recordTrade({ tenant: 'b', market: 'SOL', side: 'short', notionalUsdc: 9000 });

  const ns = new NettingSettlement(ledger, gw);
  const rpt = ns.settleMarket('SOL');
  assert.equal(rpt.grossLongUsdc, 12000);
  assert.equal((gw as any).lastNetting.SOL.grossShortUsdc, 9000);
});

test('gateway can assemble a netting settlement transaction with built instructions', async () => {
  const gw = new Gateway(new (require('@solana/web3.js').Connection)('https://api.devnet.solana.com'));
  const ledger = new NettingLedger();
  ledger.recordTrade({ tenant: 'a', market: 'SOL', side: 'long', notionalUsdc: 12000 });
  ledger.recordTrade({ tenant: 'b', market: 'SOL', side: 'short', notionalUsdc: 9000 });

  const tx = await gw.buildNettingSettlementTransaction({ market: 'SOL', traders: ledger.getTradersForMarket('SOL'), feePayer: (require('@solana/web3.js').Keypair.generate()).publicKey });
  assert.ok(tx);
  assert.equal(Array.isArray(tx.instructions), true);
});
