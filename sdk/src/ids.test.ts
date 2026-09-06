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
    assert.equal(PROGRAM_IDS.jitRisk.toBase58(), 'EDBr2VFWweFDzKR4cTT5j3TPGvPd9imoP8F76YK1o9oe');
    assert.equal(PROGRAM_IDS.creditLine.toBase58(), '68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56');
    assert.equal(PROGRAM_IDS.assetEngine.toBase58(), 'EDBr2VFWweFDzKR4cTT5j3TPGvPd9imoP8F76YK1o9oe');
  });

  it('mint constants are valid PublicKeys', () => {
    assert.ok(USDC_MINT instanceof PublicKey);
    assert.ok(NVSC_MINT instanceof PublicKey);
    assert.ok(NVSCUSDC_MINT instanceof PublicKey);
  });

  it('TREASURY_ID is 0', () => {
    assert.equal(TREASURY_ID, 0);
  });

  it('no duplicate program IDs (except consolidated hosts)', () => {
    const ids = Object.values(PROGRAM_IDS).map((pk) => pk.toBase58());
    const unique = new Set(ids);
    // jit-risk + asset-engine share the noviscia-capacity host (`risk_*` /
    // `asset_*` handlers), and credit-line shares the netting-engine host
    // with nettingEngine (`cl_*` handlers) after the 19→4 consolidation.
    assert.equal(ids.length - unique.size, 2, `expected exactly the capacity-host + netting-host duplicates`);
    assert.equal(unique.size, ids.length - 2);
  });
});
