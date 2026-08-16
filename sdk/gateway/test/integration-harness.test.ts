import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Gateway } from '../src/index';
import { NettingLedger } from '../src/nettingLedger';
import { NettingSettlement } from '../src/nettingSettlement';
import { TenantSandbox } from '../src/tenantSandbox';

test('gateway integration harness composes netting + recall flows without crashing', async () => {
  const gw = new Gateway(new Connection('https://api.devnet.solana.com'));
  const ledger = new NettingLedger();
  ledger.recordTrade({ tenant: 'alice', market: 'SOL', side: 'long', notionalUsdc: 12000 });
  ledger.recordTrade({ tenant: 'bob', market: 'SOL', side: 'short', notionalUsdc: 9000 });

  const settlement = new NettingSettlement(ledger, gw);
  const report = settlement.settleMarket('SOL');
  assert.equal(report.grossLongUsdc, 12000);

  const settlementTx = await gw.buildNettingSettlementTransaction({
    market: 'SOL',
    traders: ledger.getTradersForMarket('SOL'),
    feePayer: Keypair.generate().publicKey,
  });
  assert.equal(Array.isArray(settlementTx.instructions), true);
  assert.doesNotThrow(() => settlementTx.serializeMessage());

  const sandbox = new TenantSandbox('tenant-harness', ['perps']);
  (gw as any).sandboxes.set(sandbox.id, sandbox);
  const recallResult = gw.recallForMargin(sandbox.id, 2500, {
    onChain: true,
    callerKeypair: Keypair.generate(),
    vaultUsdcMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    vaultUsdcAccount: new PublicKey('3Q9oH1NQYEXY7sVfuzLZtQ4YH9HfQ2WjQnJm7m2jQH6N'),
    venueAta: new PublicKey('8n8d1qVn9vS9QFQdY8AdLycG7Q3u9ZVjJ9xFHTGFRJ1p'),
  });
  assert.equal(recallResult.success, true);

  const recallTx = await gw.buildRecallTransaction({
    amount: 2500,
    callerKeypair: Keypair.generate(),
    vaultUsdcMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    vaultUsdcAccount: new PublicKey('3Q9oH1NQYEXY7sVfuzLZtQ4YH9HfQ2WjQnJm7m2jQH6N'),
    venueAta: new PublicKey('8n8d1qVn9vS9QFQdY8AdLycG7Q3u9ZVjJ9xFHTGFRJ1p'),
  });
  assert.equal(Array.isArray(recallTx.instructions), true);
  assert.doesNotThrow(() => recallTx.serializeMessage());
});
