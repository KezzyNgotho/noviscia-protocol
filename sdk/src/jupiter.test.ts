import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { JupiterSwapLegProvider, JupSwapProviderError } from './jupiter';

const ORIGINAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

function fakeFetch(handler: (url: string, init?: RequestInit) => unknown) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = handler(url, init);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }) as Response;
  }) as typeof fetch;
}

const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const SOL = new PublicKey('So11111111111111111111111111111111111111112');

describe('quote', () => {
  it('returns a normalized route for an ExactIn swap', async () => {
    fakeFetch((url) => {
      assert.ok(url.includes('/quote'), 'quotes via GET /quote');
      assert.ok(url.includes(`inputMint=${USDC.toBase58()}`));
      assert.ok(url.includes(`amount=${(1_000_000n).toString()}`));
      return {
        inputMint: USDC.toBase58(),
        outputMint: SOL.toBase58(),
        inAmount: '1000000',
        outAmount: '1234567',
        slippageBps: 50,
        otherAmountThreshold: '1200000',
        swapMode: 'ExactIn',
        routePlan: [{ swapInfo: {} }],
      };
    });
    const p = new JupiterSwapLegProvider('https://quote-api.jup.ag/v6');
    const route = await p.quote(USDC, SOL, 1_000_000n, { slippageBps: 50 });
    assert.ok(route);
    assert.equal(route.inAmount, 1_000_000n);
    assert.equal(route.outAmount, 1_234_567n);
    assert.equal(route.swapMode, 'ExactIn');
  });

  it('returns null when the API reports no route', async () => {
    fakeFetch(() => ({ routes: [] }));
    const p = new JupiterSwapLegProvider();
    const route = await p.quote(SOL, USDC, 100n);
    assert.equal(route, null);
  });

  it('throws when the quote HTTP call fails', async () => {
    globalThis.fetch = (async () => {
      return new Response('boom', { status: 503, headers: { 'Content-Type': 'application/json' } }) as Response;
    }) as typeof fetch;
    const p = new JupiterSwapLegProvider();
    await assert.rejects(p.quote(SOL, USDC, 100n), JupSwapProviderError);
  });
});

describe('buildSwapLeg', () => {
  const swapJson = {
    swapInstruction: {
      programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      accounts: [
        { pubkey: '11111111111111111111111111111111' },
        { pubkey: USDC.toBase58(), isWritable: true },
        { pubkey: SOL.toBase58(), isSigner: true },
      ],
      data: Buffer.from('a0b1c2deadbeef', 'hex').toString('base64'),
    },
    addressLookupTableAddresses: ['LUT1111111111111111111111111111111111111111'],
    priceImpactPct: 0.42,
  };

  const route = {
    inputMint: USDC.toBase58(),
    outputMint: SOL.toBase58(),
    inAmount: 1_000_000n,
    outAmount: 1_234_567n,
    slippageBps: 50,
    otherAmountThreshold: 1_200_000n,
    swapMode: 'ExactIn' as const,
  };

  it('decodes the swap instruction, keys and lookup tables', async () => {
    fakeFetch((url, init) => {
      assert.ok(url.includes('/swap'), 'swaps via POST /swap');
      assert.ok(JSON.parse(init?.body as string).userPublicKey.includes('1111'), 'carries the user pubkey');
      return swapJson;
    });
    const p = new JupiterSwapLegProvider();
    const user = PublicKey.unique();
    const leg = await p.buildSwapLeg(route, user);
    assert.equal(leg.instruction.programId.toBase58(), 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
    assert.equal(leg.instruction.keys.length, 3);
    assert.deepEqual(leg.lookupTableAddresses, ['LUT1111111111111111111111111111111111111111']);
    assert.equal(leg.priceImpactPct, 0.42);
  });

  it('throws when no usable swap instruction is present', async () => {
    fakeFetch(() => ({}));
    const p = new JupiterSwapLegProvider();
    await assert.rejects(p.buildSwapLeg(route, PublicKey.unique()), JupSwapProviderError);
  });
});

describe('integration helper', () => {
  it('builds an ExactIn circular route (in == out) usable as a keeper Tx-1 leg', async () => {
    const route = {
      inputMint: USDC.toBase58(),
      outputMint: USDC.toBase58(),
      inAmount: 10_000_000n,
      outAmount: 10_090_000n,
      slippageBps: 100,
      otherAmountThreshold: 10_050_000n,
      swapMode: 'ExactIn' as const,
    };
    fakeFetch(() => swapJsonFor(route));
    const p = new JupiterSwapLegProvider();
    const leg = await p.buildSwapLeg(route, PublicKey.unique());
    assert.equal(leg.inAmount, 10_000_000n);
    assert.equal(leg.outAmount, 10_090_000n);
    assert.ok(leg.instruction.data.length > 0);
  });
});

function swapJsonFor(route: { inputMint: string; outputMint: string }) {
  return {
    swapInstruction: {
      programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      accounts: [
        { pubkey: '11111111111111111111111111111111' },
        { pubkey: USDC.toBase58(), isWritable: true },
      ],
      data: Buffer.from('deadbeef', 'hex').toString('base64'),
    },
    addressLookupTableAddresses: [],
    priceImpactPct: 0.1,
  };
}