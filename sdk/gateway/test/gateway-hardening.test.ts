import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Transaction } from '@solana/web3.js';
import { Gateway } from '../src/index';

class DummyAdapter {
  name = 'perps';
  requiredAccounts() { return []; }
  async buildActionTx() { return new Transaction(); }
}

test('gateway rejects duplicate sandbox ids', () => {
  const conn = { } as any;
  const gw = new Gateway(conn);
  gw.createSandbox('tenant-1');
  assert.throws(() => gw.createSandbox('tenant-1'), /sandbox-already-exists/);
});

test('gateway rejects invalid recall amount and caps oversized recalls', () => {
  const conn = { } as any;
  const gw = new Gateway(conn, { maxRecallUsdc: 1000 });
  const sb = gw.createSandbox('tenant-2');

  const invalid = gw.recallForMargin(sb.id, 0);
  assert.equal(invalid.success, false);
  assert.match(String(invalid.note), /invalid-recall-amount/);

  const tooLarge = gw.recallForMargin(sb.id, 1001);
  assert.equal(tooLarge.success, false);
  assert.equal(tooLarge.note, 'recall-amount-too-large');
});

test('gateway enforces adapter payload size limits', async () => {
  const conn = { } as any;
  const gw = new Gateway(conn, { maxAdapterPayloadBytes: 16 });
  gw.registerAdapter(new DummyAdapter());

  const signer = Keypair.generate();
  const r = await gw.executeAdapterAction('perps', { veryLargePayload: '01234567890123456789' }, signer);
  assert.equal(r.success, false);
  assert.equal(r.note, 'payload-too-large');
});

test('gateway can submit signed adapter tx when enabled', async () => {
  let sent = false;
  const conn = {
    getLatestBlockhash: async () => ({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 123,
    }),
    sendRawTransaction: async (_raw: Buffer | Uint8Array) => {
      sent = true;
      return 'mock-signature';
    },
    confirmTransaction: async () => ({ value: { err: null } }),
  } as any;

  const gw = new Gateway(conn);
  gw.registerAdapter(new DummyAdapter());

  const signer = Keypair.generate();
  const r = await gw.executeAdapterAction('perps', { market: 'SOL' }, signer, undefined, { submit: true });
  assert.equal(r.success, true);
  assert.equal(r.note, 'submitted');
  assert.equal(r.txSig, 'mock-signature');
  assert.equal(sent, true);
});
