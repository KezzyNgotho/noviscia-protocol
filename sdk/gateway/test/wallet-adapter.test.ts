import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Transaction } from '@solana/web3.js';
import { Gateway } from '../src/index';

// Mock connection that accepts raw txs and returns a fake signature
class MockConnection {
  async getLatestBlockhash() { return { blockhash: '11111111111111111111111111111111' }; }
  async sendRawTransaction(_raw: Buffer) { return 'FAKESIG123'; }
  async confirmTransaction(_obj: any, _commitment: any) { return true; }
}

test('gateway signAndSubmit supports wallet adapters', async () => {
  const gw = new Gateway(new MockConnection() as any);

  // create a tx and a mock wallet adapter that will "sign" it by adding a mock signature
  const signer = Keypair.generate();
  const tx = new Transaction();
  // empty transaction is sufficient for this mocked-signing test

  let received = false;
  const mockWallet = {
    publicKey: signer.publicKey,
    async signTransaction(t: Transaction) {
      // emulate wallet: attach the signer's signature for test purposes
      t.sign(signer);
      received = true;
      return t;
    }
  } as any;

  const sig = await (gw as any).signAndSubmit(tx, mockWallet, undefined);
  assert.equal(received, true);
  assert.equal(sig, 'FAKESIG123');
});
