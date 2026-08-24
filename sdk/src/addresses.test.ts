import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
import { pda, ptAddresses, nettingAddresses, yrAddresses, vaultAddresses, feeRoutingAddresses } from './addresses';
import { USDC_MINT, PROGRAM_IDS } from './ids';

const randomPubkey = () => Keypair.generate().publicKey;

describe('addresses', () => {
  describe('pda', () => {
    it('derives a deterministic PDA', () => {
      const seed = Buffer.from('test-seed');
      const pk1 = pda([seed], PROGRAM_IDS.positionTracker);
      const pk2 = pda([seed], PROGRAM_IDS.positionTracker);
      assert.equal(pk1.toBase58(), pk2.toBase58());
    });

    it('different seeds produce different PDAs', () => {
      const pk1 = pda([Buffer.from('seed-a')], PROGRAM_IDS.positionTracker);
      const pk2 = pda([Buffer.from('seed-b')], PROGRAM_IDS.positionTracker);
      assert.notEqual(pk1.toBase58(), pk2.toBase58());
    });

    it('different programs produce different PDAs', () => {
      const pk1 = pda([Buffer.from('config')], PROGRAM_IDS.positionTracker);
      const pk2 = pda([Buffer.from('config')], PROGRAM_IDS.nvUsdcVault);
      assert.notEqual(pk1.toBase58(), pk2.toBase58());
    });
  });

  describe('ptAddresses', () => {
    it('returns all required fields', () => {
      const owner = randomPubkey();
      const market = randomPubkey();
      const addrs = ptAddresses(owner, market, 0);
      assert.ok(addrs.ptConfig instanceof PublicKey);
      assert.ok(addrs.settlementVault instanceof PublicKey);
      assert.ok(addrs.position instanceof PublicKey);
      assert.ok(addrs.collateralVault instanceof PublicKey);
      assert.ok(addrs.referral instanceof PublicKey);
    });

    it('different subIds produce different position PDAs', () => {
      const owner = randomPubkey();
      const market = randomPubkey();
      const a = ptAddresses(owner, market, 0);
      const b = ptAddresses(owner, market, 1);
      assert.notEqual(a.position.toBase58(), b.position.toBase58());
    });

    it('different owners produce different position PDAs', () => {
      const market = randomPubkey();
      const a = ptAddresses(randomPubkey(), market, 0);
      const b = ptAddresses(randomPubkey(), market, 0);
      assert.notEqual(a.position.toBase58(), b.position.toBase58());
    });
  });

  describe('nettingAddresses', () => {
    it('returns all required fields', () => {
      const addrs = nettingAddresses(randomPubkey(), 0);
      assert.ok(addrs.config instanceof PublicKey);
      assert.ok(addrs.houseBook instanceof PublicKey);
      assert.ok(addrs.venue instanceof PublicKey);
      assert.ok(addrs.netPosition instanceof PublicKey);
      assert.ok(addrs.nettingSet instanceof PublicKey);
    });

    it('different venue IDs produce different venue PDAs', () => {
      const a = nettingAddresses(randomPubkey(), 0);
      const b = nettingAddresses(randomPubkey(), 1);
      assert.notEqual(a.venue.toBase58(), b.venue.toBase58());
    });
  });

  describe('yrAddresses', () => {
    it('returns yrConfig and venueAta', () => {
      const addrs = yrAddresses(USDC_MINT);
      assert.ok(addrs.yrConfig instanceof PublicKey);
      assert.ok(addrs.venueAta instanceof PublicKey);
    });
  });

  describe('vaultAddresses', () => {
    it('returns base vault fields without user', () => {
      const addrs = vaultAddresses(USDC_MINT);
      assert.ok(addrs.vaultConfig instanceof PublicKey);
      assert.ok(addrs.vaultAuthority instanceof PublicKey);
      assert.ok(addrs.vaultUsdc instanceof PublicKey);
      assert.ok(addrs.nvscusdcMint instanceof PublicKey);
      assert.ok(addrs.insuranceBuffer instanceof PublicKey);
      assert.ok(addrs.principalPartition instanceof PublicKey);
      assert.ok(addrs.timelockedAdmin instanceof PublicKey);
      assert.ok(addrs.withdrawalTracker instanceof PublicKey);
      assert.ok(addrs.protocolWithdrawal instanceof PublicKey);
      assert.equal(addrs.userVaultState, undefined);
    });

    it('includes userVaultState when user provided', () => {
      const addrs = vaultAddresses(USDC_MINT, randomPubkey());
      assert.ok(addrs.userVaultState instanceof PublicKey);
    });

    it('includes mint pool fields when collateralMint provided', () => {
      const addrs = vaultAddresses(USDC_MINT, randomPubkey(), USDC_MINT);
      assert.ok(addrs.mintPool instanceof PublicKey);
      assert.ok(addrs.mintPoolAuthority instanceof PublicKey);
      assert.ok(addrs.mintPoolVault instanceof PublicKey);
      assert.ok(addrs.assetRiskConfig instanceof PublicKey);
      assert.ok(addrs.assetExposure instanceof PublicKey);
      assert.ok(addrs.userMintVault instanceof PublicKey);
    });
  });

  describe('feeRoutingAddresses', () => {
    it('returns all required fields', () => {
      const addrs = feeRoutingAddresses(USDC_MINT, randomPubkey());
      assert.ok(addrs.burnState instanceof PublicKey);
      assert.ok(addrs.burnVaultUsdc instanceof PublicKey);
      assert.ok(addrs.stakingFeePool instanceof PublicKey);
      assert.ok(addrs.stakingFeeVault instanceof PublicKey);
      assert.ok(addrs.stakeAccount instanceof PublicKey);
    });
  });
});
