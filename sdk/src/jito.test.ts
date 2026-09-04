import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey, SystemProgram, VersionedTransaction } from '@solana/web3.js';
import {
  JitoBundleClient,
  JitoRpcError,
  KNOWN_JITO_TIP_ACCOUNTS,
  BUNDLE_MAX_TRANSACTIONS,
  DEFAULT_TIP_LAMPORTS,
  assembleVersionedTransactions,
  buildTipInstruction,
  selectTipAccount,
  resolveBundleTipLamports,
  JITO_BLOCK_ENGINE_URLS,
} from './jito';

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

/** Install a fake fetch capturing the request and returning a canned result. */
function fakeFetch(result: unknown, httpStatus = 200) {
  const calls: { url: string; body: { method: string; params: unknown } }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = JSON.parse((init?.body as string) ?? '{}');
    calls.push({ url, body });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
      status: httpStatus,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

/** Install a fake fetch returning an arbitrary raw JSON-RPC body (e.g. errors). */
function fakeRawFetch(body: unknown, httpStatus = 200) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: httpStatus,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
}

const payer = Keypair.generate();
const tipPayer = Keypair.generate();
const tipAccount = KNOWN_JITO_TIP_ACCOUNTS[0];

describe('buildTipInstruction', () => {
  it('is a SOL transfer to the tip account signable by the tip payer', () => {
    const ix = buildTipInstruction({ tipAccount, tipPayer: tipPayer.publicKey, lamports: 5_000_000 });

    assert.ok(ix.programId.equals(SystemProgram.programId));
    assert.equal(ix.keys.length, 2, 'transfer has exactly 2 account metas');
    assert.ok(ix.keys[0].pubkey.equals(tipPayer.publicKey), 'payer is index 0');
    assert.ok(ix.keys[0].isSigner, 'payer must sign');
    assert.ok(ix.keys[1].pubkey.equals(tipAccount), 'tip account is index 1');
    assert.ok(ix.keys[1].isWritable, 'tip account receives lamports');
    assert.ok(!ix.keys[1].isSigner, 'tip account does not sign');
  });

  it('converts bigint lamports without overflow loss', () => {
    const ix = buildTipInstruction({ tipAccount, tipPayer: tipPayer.publicKey, lamports: 3_000_000n });
    assert.equal(ix.data.length, 12, 'system transfer ix data is 12 bytes');
  });
});

describe('selectTipAccount', () => {
  it('returns a member of the known tip set', () => {
    const picked = selectTipAccount();
    assert.ok(KNOWN_JITO_TIP_ACCOUNTS.some((pk) => pk.equals(picked)));
  });
});

describe('resolveBundleTipLamports', () => {
  it('floors at the default when the auction minimum is lower', () => {
    assert.equal(resolveBundleTipLamports(1n), DEFAULT_TIP_LAMPORTS);
  });
  it('respects an auction minimum above the default', () => {
    assert.equal(resolveBundleTipLamports(50_000_000n), 50_000_000n);
  });
});

describe('assembleVersionedTransactions', () => {
  const blockhash = '11111111111111111111111111111111';
  const transfer = () =>
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 });

  it('compiles one unsigned VersionedTransaction per group with a shared blockhash', () => {
    const txs = assembleVersionedTransactions([[transfer()], [transfer()]], {
      feePayer: payer.publicKey,
      recentBlockhash: blockhash,
    });
    assert.equal(txs.length, 2);
    for (const tx of txs) {
      assert.ok(tx instanceof VersionedTransaction);
      assert.equal(tx.message.recentBlockhash, blockhash);
      assert.equal(tx.signatures.length, 1, 'only the fee payer signs without a tip');
    }
  });

  it('appends the tip to the first transaction, making the tip payer a required signer', () => {
    const txs = assembleVersionedTransactions([[transfer()], [transfer()]], {
      feePayer: payer.publicKey,
      recentBlockhash: blockhash,
      tip: { tipAccount, tipPayer: tipPayer.publicKey, lamports: DEFAULT_TIP_LAMPORTS },
    });
    assert.equal(txs.length, 2);
    assert.equal(txs[0].signatures.length, 2, 'fee payer + tip payer sign tx 0');
    assert.equal(txs[1].signatures.length, 1, 'only fee payer signs tx 1');
  });

  it('rejects more than 5 transactions and empty groups', () => {
    const groups = Array.from({ length: BUNDLE_MAX_TRANSACTIONS + 1 }, () => [transfer()]);
    assert.throws(
      () => assembleVersionedTransactions(groups, { feePayer: payer.publicKey, recentBlockhash: blockhash }),
      RangeError,
    );
    assert.throws(
      () => assembleVersionedTransactions([[]], { feePayer: payer.publicKey, recentBlockhash: blockhash }),
      RangeError,
    );
  });
});

describe('JitoBundleClient', () => {
  it('submits a signed bundle as base64 over the block engine endpoint and returns the bundle id', async () => {
    const calls = fakeFetch('etcvQ8uvx3oD2kJQYcv3RUUMyLLq9ZCNUZny8A4YdRpprtbe8xgMTm5oyhzGbJQVJy3wVYVvfhbnWxjUQgbY8oV');
    const client = new JitoBundleClient(JITO_BLOCK_ENGINE_URLS.devnet[0]);

    const tx = assembleVersionedTransactions([[SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 })]], {
      feePayer: payer.publicKey,
      recentBlockhash: '11111111111111111111111111111111',
    })[0];
    tx.sign([payer]);

    const bundleId = await client.sendBundle([tx]);

    assert.equal(bundleId, 'etcvQ8uvx3oD2kJQYcv3RUUMyLLq9ZCNUZny8A4YdRpprtbe8xgMTm5oyhzGbJQVJy3wVYVvfhbnWxjUQgbY8oV');
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith('/api/v1/bundles'));
    assert.equal((calls[0].body as { method: string }).method, 'sendBundle');
    const params = (calls[0].body as { params: unknown[] }).params;
    assert.equal(params.length, 2, 'encoding is passed as the second param');
    const encoding = params[1] as { encoding: string };
    assert.equal(encoding.encoding, 'base64');
    const txs = params[0] as string[];
    assert.equal(txs.length, 1);
    assert.equal(Buffer.from(txs[0], 'base64').length > 0, true, 'transaction body decodes');
  });

  it('rejects submitting more than 5 transactions', async () => {
    fakeFetch('x');
    const client = new JitoBundleClient();
    const tx = assembleVersionedTransactions([[SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 })]], {
      feePayer: payer.publicKey,
      recentBlockhash: '11111111111111111111111111111111',
    })[0]!;
    tx.sign([payer]);
    await assert.rejects(client.sendBundle(Array.from({ length: 6 }, () => tx)), RangeError);
  });

  it('fetches current tip accounts and picks a valid random one', async () => {
    const accounts = KNOWN_JITO_TIP_ACCOUNTS.map((pk) => pk.toBase58());
    fakeFetch(accounts);
    const client = new JitoBundleClient();
    const tips = await client.getTipAccounts();
    assert.equal(tips.length, 8);
    assert.ok(await client.getRandomTipAccount() instanceof PublicKey);
  });

  it('parses auction tip limits with a zero-minimum fallback for older engines', async () => {
    fakeFetch({ minBundleTipLamports: 2_000_000, maxBundleSizeInEth: 0, maxBuilderFeeLamports: 0, maxTransactions: 5 });
    const client = new JitoBundleClient();
    const limits = await client.getBundleTipLimits();
    assert.equal(limits.minBundleTipLamports, 2_000_000n);
    assert.equal(limits.maxTransactions, 5);

    fakeRawFetch({ error: { code: -32601, message: 'Method not found' } });
    const fallback = await client.getBundleTipLimits();
    assert.equal(fallback.minBundleTipLamports, 0n);
    assert.equal(fallback.maxTransactions, BUNDLE_MAX_TRANSACTIONS);
  });

  it('maps getBundleStatuses into typed statuses with nulls preserved', async () => {
    fakeFetch({
      context: { slot: 242806119 },
      value: [
        {
          bundle_id: '892b79ed49138bfb3aa5441f0df6e06ef34f9ee8f3976c15b323605bae0cf51d',
          transactions: ['sig1', 'sig2'],
          slot: 242804011,
          confirmation_status: 'finalized',
          err: { Ok: null },
        },
        null,
      ],
    });
    const client = new JitoBundleClient();
    const statuses = await client.getBundleStatuses(['892b79ed49138bfb3aa5441f0df6e06ef34f9ee8f3976c15b323605bae0cf51d']);
    assert.equal(statuses.length, 2);
    assert.equal(statuses[0]?.bundleId, '892b79ed49138bfb3aa5441f0df6e06ef34f9ee8f3976c15b323605bae0cf51d');
    assert.equal(statuses[0]?.confirmationStatus, 'finalized');
    assert.equal(statuses[1], null);
  });

  it('throws JitoRpcError on non-2xx HTTP and on JSON-RPC error envelopes', async () => {
    fakeFetch(null, 429);
    const rate = new JitoBundleClient();
    await assert.rejects(rate.getTipAccounts(), (err) => err instanceof JitoRpcError);

    fakeRawFetch({ error: { code: -32602, message: 'Invalid params' } });
    const bad = new JitoBundleClient();
    await assert.rejects(bad.getTipAccounts(), (err) => err instanceof JitoRpcError);
  });
});