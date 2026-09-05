import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { PROGRAM_IDS, USDC_MINT, NVSC_MINT, NVSCUSDC_MINT, TREASURY_ID } from './ids';

describe('ids', () => {
  it('exports 18 program IDs', () => {
    const keys = Object.keys(PROGRAM_IDS);
    assert.equal(keys.length, 18, `expected 18 programs, got ${keys.length}: ${keys.join(', ')}`);
  });

  it('every program ID is a valid PublicKey', () => {
    for (const [name, pk] of Object.entries(PROGRAM_IDS)) {
      assert.ok(pk instanceof PublicKey, `${name} is not a PublicKey`);
      assert.ok(pk.toBase58().length >= 32 && pk.toBase58().length <= 44, `${name} has invalid length`);
    }
  });

  it('devnet defaults match Anchor.toml', () => {
    assert.equal(PROGRAM_IDS.positionTracker.toBase58(), '6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws');
    assert.equal(PROGRAM_IDS.nvUsdcVault.toBase58(), 'CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC');
    assert.equal(PROGRAM_IDS.burnEngine.toBase58(), 'nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id');
    assert.equal(PROGRAM_IDS.nettingEngine.toBase58(), '68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56');
    assert.equal(PROGRAM_IDS.escrow.toBase58(), '2WPb3wsyp4G6zFPx8sTYf3bTDyySxwpo1Ja8H6RCHXCZ');
    assert.equal(PROGRAM_IDS.jitRisk.toBase58(), '3w9GrHBXpMNSc3P3kBWmHwkhEr1u5FBQrTiD4k3NAXwh');
    assert.equal(PROGRAM_IDS.creditLine.toBase58(), '8usJu6agjifCXYwSsRVoMWqm22h2HUSfebw1zEEHAMYg');
    assert.equal(PROGRAM_IDS.assetEngine.toBase58(), '5qpohgfMvV89oRJqcV7MrBxJJ95i7TgZ9VvUNdyZrMKb');
  });

  it('mint constants are valid PublicKeys', () => {
    assert.ok(USDC_MINT instanceof PublicKey);
    assert.ok(NVSC_MINT instanceof PublicKey);
    assert.ok(NVSCUSDC_MINT instanceof PublicKey);
  });

  it('TREASURY_ID is 0', () => {
    assert.equal(TREASURY_ID, 0);
  });

  it('no duplicate program IDs', () => {
    const ids = Object.values(PROGRAM_IDS).map((pk) => pk.toBase58());
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, 'duplicate program IDs found');
  });
});
