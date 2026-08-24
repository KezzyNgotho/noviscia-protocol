import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import {
  translate, translateExecutionOrder, translateClearingOrder,
  translateNettingReport, translateRecall, translateLiquidation, digest,
} from './payloads';

const randomPubkey = () => PublicKey.unique();

const mkExecReq = (overrides: Record<string, unknown> = {}) => ({
  kind: 'execution' as const,
  data: {
    symbol: 'SOL',
    side: 'long' as const,
    sizeUsdc: 50_000_000,
    market: randomPubkey(),
    priceUpdateAccount: randomPubkey(),
    guardianSet: randomPubkey(),
    pythConfig: randomPubkey(),
    treasury: randomPubkey(),
    ...overrides,
  },
});

describe('payloads', () => {
  describe('translateExecutionOrder', () => {
    it('produces a 13-byte payload for a long', () => {
      const result = translateExecutionOrder(mkExecReq());
      assert.equal(result.ok, true);
      assert.equal(result.kind, 'execution');
      assert.equal(result.payload!.length, 13);
      assert.equal(result.payload![0], 0); // 0 = long
      assert.equal(result.accounts.length, 5);
    });

    it('sets side byte to 1 for short', () => {
      const result = translateExecutionOrder(mkExecReq({ side: 'short' }));
      assert.equal(result.payload![0], 1);
    });

    it('rejects non-positive size', () => {
      const result = translateExecutionOrder(mkExecReq({ sizeUsdc: 0 }));
      assert.equal(result.ok, false);
      assert.ok(result.summary.includes('non-positive'));
    });

    it('writes sizeUsdc as little-endian u64', () => {
      const result = translateExecutionOrder(mkExecReq({ sizeUsdc: 256 }));
      const size = result.payload!.readBigUInt64LE(1);
      assert.equal(size, 256n);
    });
  });

  describe('translateClearingOrder', () => {
    it('produces a 1-byte payload with subId', () => {
      const result = translateClearingOrder({
        kind: 'clearing',
        data: { subId: 3, market: randomPubkey(), priceUpdateAccount: randomPubkey() },
      });
      assert.equal(result.ok, true);
      assert.equal(result.payload!.length, 1);
      assert.equal(result.payload![0], 3);
      assert.equal(result.accounts.length, 2);
    });
  });

  describe('translateNettingReport', () => {
    it('produces a 9-byte payload', () => {
      const result = translateNettingReport({
        kind: 'netting-report',
        data: { venue: randomPubkey(), trader: randomPubkey(), side: 'long', notionalUsdc: 10_000_000 },
      });
      assert.equal(result.ok, true);
      assert.equal(result.payload!.length, 9);
      assert.equal(result.accounts.length, 2);
    });

    it('writes notional as LE u64', () => {
      const result = translateNettingReport({
        kind: 'netting-report',
        data: { venue: randomPubkey(), trader: randomPubkey(), side: 'short', notionalUsdc: 1_000_000 },
      });
      assert.equal(result.payload![0], 1); // short
      assert.equal(result.payload!.readBigUInt64LE(1), 1_000_000n);
    });
  });

  describe('translateRecall', () => {
    it('produces an 8-byte payload', () => {
      const result = translateRecall({
        kind: 'recall',
        data: { usdcAmount: 500_000 },
      });
      assert.equal(result.ok, true);
      assert.equal(result.payload!.length, 8);
      assert.equal(result.payload!.readBigUInt64LE(0), 500_000n);
    });
  });

  describe('translateLiquidation', () => {
    it('merges netting and recall accounts', () => {
      const netting = [{ pubkey: randomPubkey(), isSigner: false, isWritable: true }];
      const recall = [{ pubkey: randomPubkey(), isSigner: false, isWritable: true }];
      const result = translateLiquidation({
        kind: 'liquidation',
        data: { nettingAccounts: netting, recallAccounts: recall },
      });
      assert.equal(result.ok, true);
      assert.equal(result.accounts.length, 2);
    });
  });

  describe('translate (dispatcher)', () => {
    it('dispatches to the correct translator', () => {
      const r1 = translate(mkExecReq());
      assert.equal(r1.kind, 'execution');

      const r2 = translate({ kind: 'recall', data: { usdcAmount: 100 } });
      assert.equal(r2.kind, 'recall');
    });

    it('returns ok=false for unknown kind', () => {
      const r = translate({ kind: 'unknown' as any, data: {} });
      assert.equal(r.ok, false);
    });
  });

  describe('digest', () => {
    it('returns a 64-char hex string', () => {
      const h = digest(Buffer.from('hello'));
      assert.equal(h.length, 64);
      assert.ok(/^[0-9a-f]{64}$/.test(h));
    });

    it('is deterministic', () => {
      const h1 = digest(Buffer.from('test'));
      const h2 = digest(Buffer.from('test'));
      assert.equal(h1, h2);
    });

    it('different inputs produce different digests', () => {
      const h1 = digest(Buffer.from('a'));
      const h2 = digest(Buffer.from('b'));
      assert.notEqual(h1, h2);
    });
  });
});
