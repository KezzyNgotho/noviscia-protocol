import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { CreditLineClient, CREDIT_LINE_PROGRAM_ID, LP_NAV_SPLIT_BPS, TREASURY_SPLIT_BPS, BPS } from './creditLine';
import { USDC_MINT } from './ids';

/** Minimal Anchor-Program-shaped stub — enough to exercise PDA derivation. */
function stubProgram() {
  const programId = CREDIT_LINE_PROGRAM_ID;
  return {
    programId,
    provider: { publicKey: PublicKey.unique() },
    methods: {},
    account: {},
  } as unknown as ConstructorParameters<typeof CreditLineClient>[0];
}

describe('creditLine', () => {
  it('exposes the deployed program ID', () => {
    assert.equal(CREDIT_LINE_PROGRAM_ID.toBase58(), '8usJu6agjifCXYwSsRVoMWqm22h2HUSfebw1zEEHAMYg');
  });

  it('rejects a client built on the wrong program ID', () => {
    const wrong = { ...stubProgram(), programId: PublicKey.unique() };
    assert.throws(() => new CreditLineClient(wrong as never), /wrong program id/);
  });

  it('derives deterministic PDAs for ledger, credit vault, toll vault and borrower', () => {
    const client = new CreditLineClient(stubProgram(), { usdcMint: USDC_MINT });
    const owner = PublicKey.unique();

    const line = client.creditLine();
    const vault = client.creditVault();
    const tollVault = client.tollVault();
    const borrower = client.borrower(owner);

    assert.notEqual(line.toBase58(), vault.toBase58());
    assert.notEqual(vault.toBase58(), tollVault.toBase58());
    assert.equal(client.creditVault().toBase58(), vault.toBase58(), 'PDA is deterministic');
    assert.equal(client.borrower(owner).toBase58(), borrower.toBase58(), 'borrower PDA is deterministic');
  });

  it('routes the 90% LP-NAV sweep to the nv-usdc-vault pool accounts', () => {
    const client = new CreditLineClient(stubProgram(), { usdcMint: USDC_MINT });
    const { vaultConfig, vaultUsdc } = client.vaultAccounts();
    assert.notEqual(vaultConfig.toBase58(), vaultUsdc.toBase58());
    assert.notEqual(vaultConfig.toBase58(), USDC_MINT.toBase58());
  });

  it('defines the 90/10 toll split', () => {
    assert.equal(LP_NAV_SPLIT_BPS, 9000, '90% to LP NAV');
    assert.equal(TREASURY_SPLIT_BPS, 1000, '10% to treasury');
    assert.equal(LP_NAV_SPLIT_BPS + TREASURY_SPLIT_BPS, BPS, 'split conserves the toll');
  });
});
