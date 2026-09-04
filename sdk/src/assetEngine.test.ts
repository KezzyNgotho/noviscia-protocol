import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  ASSET_ENGINE_PROGRAM_ID,
  anchorDiscriminator,
  registryPDA,
  assetPoolPDA,
  assetVaultPDA,
  assetFeeVaultPDA,
  assetAuthorityPDA,
  creditLinePDA,
  deskPositionPDA,
  assetLpMintPDA,
  assetLpPositionPDA,
  buildInitializeIx,
  buildRegisterAssetIx,
  buildUpdateAssetParamsIx,
  buildSetAssetSupportIx,
  buildInitializeCreditLineIx,
  buildUpdateCreditLimitIx,
  buildSetCreditFrozenIx,
  buildSetPausedIx,
  buildAllocateAssetCapacityIx,
  buildRecreditAssetCapacityIx,
  buildSetKycRootIx,
  buildSettleDailyIx,
  buildDepositAssetLiquidityIx,
  buildWithdrawAssetLiquidityIx,
  buildWithdrawAssetFeesIx,
  computePremium,
  computeLateFee,
  windowPosture,
  computeDepositShares,
  computeLpWithdrawValue,
  computeLpSharePrice,
  WINDOW_SLOTS,
  GRACE_SLOTS,
  USDC_PROFILE,
  NVSC_PROFILE,
  WSOL_PROFILE,
} from './assetEngine';

const uuid = (): PublicKey => PublicKey.unique();
const le64 = (v: bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
};

describe('assetEngine', () => {
  it('exposes the deployed program ID', () => {
    assert.equal(ASSET_ENGINE_PROGRAM_ID.toBase58(), '4FP4vWmTxnRHPkZGu5q74EVhk792PMVhpEVRBo3BwUQ5');
  });

  it('uses the Anchor sha256 global discriminator prefix', () => {
    const ix = buildSetPausedIx(ASSET_ENGINE_PROGRAM_ID, uuid(), true);
    assert.deepEqual(ix.data.subarray(0, 8), anchorDiscriminator('set_paused'));
    assert.equal(ix.data.length, 9);
    // spot-check the well-known Anchor prefixes
    assert.equal(anchorDiscriminator('initialize').subarray(0, 1).toString('hex').length, 2);
  });

  it('encodes three-tier governance keys and account orders in initialize', () => {
    const breaker = uuid();
    const committee = uuid();
    const council = uuid();
    const wsol = uuid();
    const usdc = uuid();
    const nvsc = uuid();
    const ix = buildInitializeIx(ASSET_ENGINE_PROGRAM_ID, {
      upgradeAuthority: council,
      breakerAuthority: breaker,
      riskCommitteeAuthority: committee,
      wsolMint: wsol,
      usdcMint: usdc,
      nvscMint: nvsc,
    });
    assert.equal(ix.keys.length, 3);
    assert.equal(ix.keys[0].pubkey.toBase58(), council.toBase58());
    assert.equal(ix.keys[0].isSigner, true);
    assert.equal(ix.keys[1].pubkey.toBase58(), registryPDA(ASSET_ENGINE_PROGRAM_ID).toBase58());
    // discriminator(8) + 3 keys + 3 mints = 200 bytes
    assert.equal(ix.data.length, 200);
    assert.deepEqual(ix.data.subarray(8, 40), breaker.toBuffer());
    assert.deepEqual(ix.data.subarray(40, 72), committee.toBuffer());
    assert.deepEqual(ix.data.subarray(72, 104), council.toBuffer());
    assert.deepEqual(ix.data.subarray(104, 136), wsol.toBuffer());
    assert.deepEqual(ix.data.subarray(136, 168), usdc.toBuffer());
    assert.deepEqual(ix.data.subarray(168, 200), nvsc.toBuffer());
  });

  it('register_asset lays out the five asset PDAs and the standardized profile', () => {
    const mint = uuid();
    const council = uuid();
    const ix = buildRegisterAssetIx(ASSET_ENGINE_PROGRAM_ID, council, mint, USDC_PROFILE);
    assert.equal(ix.keys.length, 11);
    assert.equal(ix.keys[0].pubkey.toBase58(), registryPDA(ASSET_ENGINE_PROGRAM_ID).toBase58());
    assert.equal(ix.keys[1].pubkey.toBase58(), council.toBase58());
    assert.equal(ix.keys[3].pubkey.toBase58(), assetPoolPDA(mint).toBase58());
    assert.equal(ix.keys[4].pubkey.toBase58(), assetVaultPDA(mint).toBase58());
    assert.equal(ix.keys[5].pubkey.toBase58(), assetFeeVaultPDA(mint).toBase58());
    assert.equal(ix.keys[6].pubkey.toBase58(), assetAuthorityPDA(mint).toBase58());
    assert.equal(ix.keys[7].pubkey.toBase58(), assetLpMintPDA(mint).toBase58());
    assert.equal(ix.keys[8].pubkey.toBase58(), SystemProgram.programId.toBase58());
    assert.equal(ix.keys[9].pubkey.toBase58(), TOKEN_PROGRAM_ID.toBase58());
    assert.equal(ix.keys[10].pubkey.toBase58(), SYSVAR_RENT_PUBKEY.toBase58());
    assert.equal(ix.data[8], USDC_PROFILE.decimals);
    assert.deepEqual(ix.data.subarray(29, 31), Buffer.from([USDC_PROFILE.lpYieldSplitBps & 0xff, USDC_PROFILE.lpYieldSplitBps >> 8]));
  });

  it('binds each governance tier to its scope', () => {
    const breaker = uuid();
    const committee = uuid();
    const council = uuid();
    const institution = uuid();

    const pause = buildSetPausedIx(ASSET_ENGINE_PROGRAM_ID, breaker, false);
    assert.equal(pause.keys[0].pubkey.toBase58(), breaker.toBase58());
    assert.equal(pause.keys[0].isSigner, true);

    const freeze = buildSetCreditFrozenIx(ASSET_ENGINE_PROGRAM_ID, breaker, institution, true);
    assert.equal(freeze.keys[1].pubkey.toBase58(), breaker.toBase58());
    assert.equal(freeze.keys[2].pubkey.toBase58(), creditLinePDA(institution).toBase58());

    const limit = buildUpdateCreditLimitIx(ASSET_ENGINE_PROGRAM_ID, committee, institution, 1_000n);
    assert.equal(limit.keys[1].pubkey.toBase58(), committee.toBase58());
    assert.equal(limit.keys[1].isSigner, true);
    assert.deepEqual(limit.data.subarray(8, 16), le64(1_000n));

    const params = buildUpdateAssetParamsIx(ASSET_ENGINE_PROGRAM_ID, committee, uuid(), USDC_PROFILE);
    assert.equal(params.keys[1].pubkey.toBase58(), committee.toBase58());

    const support = buildSetAssetSupportIx(ASSET_ENGINE_PROGRAM_ID, committee, uuid(), true);
    assert.equal(support.keys[1].pubkey.toBase58(), committee.toBase58());

    const cl = buildInitializeCreditLineIx(ASSET_ENGINE_PROGRAM_ID, institution, committee, 10_000_000n);
    assert.equal(cl.keys[1].pubkey.toBase58(), institution.toBase58());
    assert.equal(cl.keys[1].isSigner, true);
    assert.equal(cl.keys[2].pubkey.toBase58(), committee.toBase58());

    const kyc = buildSetKycRootIx(ASSET_ENGINE_PROGRAM_ID, committee, institution, new Uint8Array(32).fill(42));
    assert.equal(kyc.keys[1].pubkey.toBase58(), committee.toBase58());
    assert.deepEqual(kyc.data.subarray(8, 40), Buffer.alloc(32, 42));

    const fees = buildWithdrawAssetFeesIx(ASSET_ENGINE_PROGRAM_ID, council, uuid(), uuid(), 500n);
    assert.equal(fees.keys[2].pubkey.toBase58(), council.toBase58());
    assert.equal(fees.keys[2].isSigner, true);
  });

  it('allocate_asset_capacity encodes the 24h JIT accounts and merkle proof', () => {
    const mint = uuid();
    const institution = uuid();
    const trader = uuid();
    const ata = uuid();
    const proof = [Buffer.alloc(32, 7), Buffer.alloc(32, 9)];
    const ix = buildAllocateAssetCapacityIx(ASSET_ENGINE_PROGRAM_ID, {
      mint,
      institution,
      trader,
      traderTokenAccount: ata,
      requestedAmount: 500_000_000n,
      targetSlot: 123n,
      expectedPremium: 600_000n,
      expiry: 1_758_000_000n,
      merkleProof: proof,
    });
    assert.equal(ix.keys.length, 10);
    assert.equal(ix.keys[0].pubkey.toBase58(), assetPoolPDA(mint).toBase58());
    assert.equal(ix.keys[1].pubkey.toBase58(), assetVaultPDA(mint).toBase58());
    assert.equal(ix.keys[3].pubkey.toBase58(), creditLinePDA(institution).toBase58());
    assert.equal(ix.keys[4].pubkey.toBase58(), deskPositionPDA(institution, mint).toBase58());
    assert.equal(ix.keys[5].pubkey.toBase58(), trader.toBase58());
    assert.equal(ix.keys[5].isSigner, true);
    assert.equal(ix.keys[8].pubkey.toBase58(), TOKEN_PROGRAM_ID.toBase58());
    assert.equal(ix.keys[9].pubkey.toBase58(), SystemProgram.programId.toBase58());
    assert.deepEqual(ix.data.subarray(8, 16), le64(500_000_000n));
    assert.deepEqual(ix.data.subarray(16, 24), le64(123n));
    assert.deepEqual(ix.data.subarray(24, 32), le64(600_000n));
    assert.deepEqual(ix.data.subarray(40, 44), Buffer.from([2, 0, 0, 0]));
    assert.deepEqual(ix.data.subarray(44, 76), proof[0]);
    assert.deepEqual(ix.data.subarray(76, 108), proof[1]);
  });

  it('clearing + LP vault builders lay out the daily flow', () => {
    const mint = uuid();
    const institution = uuid();
    const treasury = uuid();
    const tta = uuid();

    const settle = buildSettleDailyIx(ASSET_ENGINE_PROGRAM_ID, mint, institution, treasury, tta, 1_000_000_000n, 50_000n, 777n);
    assert.equal(settle.keys.length, 8);
    assert.equal(settle.keys[0].pubkey.toBase58(), assetPoolPDA(mint).toBase58());
    assert.equal(settle.keys[1].pubkey.toBase58(), assetVaultPDA(mint).toBase58());
    assert.equal(settle.keys[2].pubkey.toBase58(), assetFeeVaultPDA(mint).toBase58());
    assert.equal(settle.keys[4].pubkey.toBase58(), deskPositionPDA(institution, mint).toBase58());
    assert.equal(settle.keys[5].pubkey.toBase58(), treasury.toBase58());
    assert.deepEqual(settle.data.subarray(8, 16), le64(1_000_000_000n));
    assert.deepEqual(settle.data.subarray(16, 24), le64(50_000n));
    assert.deepEqual(settle.data.subarray(24, 32), le64(777n));

    const provider = uuid();
    const dep = buildDepositAssetLiquidityIx(ASSET_ENGINE_PROGRAM_ID, mint, provider, uuid(), uuid(), 2_000_000_000n);
    assert.equal(dep.keys.length, 10);
    assert.equal(dep.keys[2].pubkey.toBase58(), assetLpMintPDA(mint).toBase58());
    assert.equal(dep.keys[3].pubkey.toBase58(), assetLpPositionPDA(mint, provider).toBase58());
    assert.deepEqual(dep.data.subarray(8, 16), le64(2_000_000_000n));

    const lp = uuid();
    const wd = buildWithdrawAssetLiquidityIx(ASSET_ENGINE_PROGRAM_ID, mint, lp, uuid(), uuid(), 500n);
    assert.equal(wd.keys.length, 9);
    assert.equal(wd.keys[3].pubkey.toBase58(), assetLpPositionPDA(mint, lp).toBase58());
    assert.equal(wd.keys[5].pubkey.toBase58(), lp.toBase58());
    assert.equal(wd.keys[5].isSigner, true);

    const rc = buildRecreditAssetCapacityIx(ASSET_ENGINE_PROGRAM_ID, mint, institution, treasury, tta, 100n);
    assert.equal(rc.keys.length, 7);
    assert.deepEqual(rc.data.subarray(8, 16), le64(100n));
  });

  it('PDA derivations are stable and distinct per mint / institution', () => {
    const a = uuid();
    const b = uuid();
    const pid = ASSET_ENGINE_PROGRAM_ID;
    assert.notEqual(assetPoolPDA(a, pid).toBase58(), assetPoolPDA(b, pid).toBase58());
    assert.notEqual(assetVaultPDA(a, pid).toBase58(), assetVaultPDA(b, pid).toBase58());
    assert.notEqual(assetFeeVaultPDA(a, pid).toBase58(), assetFeeVaultPDA(b, pid).toBase58());
    assert.notEqual(assetPoolPDA(a, pid).toBase58(), assetVaultPDA(a, pid).toBase58());
    assert.notEqual(assetVaultPDA(a, pid).toBase58(), assetFeeVaultPDA(a, pid).toBase58());
    assert.notEqual(creditLinePDA(a, pid).toBase58(), creditLinePDA(b, pid).toBase58());
    assert.notEqual(deskPositionPDA(a, a, pid).toBase58(), deskPositionPDA(a, b, pid).toBase58());
  });

  it('standardized profiles carry distinct limits', () => {
    assert.equal(USDC_PROFILE.decimals, 6);
    assert.equal(WSOL_PROFILE.decimals, 9);
    assert.equal(NVSC_PROFILE.decimals, 9);
    assert.equal(USDC_PROFILE.basePremiumRateBps < NVSC_PROFILE.basePremiumRateBps, true);
    assert.equal(NVSC_PROFILE.maxCapacity > USDC_PROFILE.maxCapacity, true);
  });

  it('premium + late fee mirror the on-chain formulas', () => {
    assert.equal(computePremium(1_000_000n, 8, 0n), 800n);
    assert.equal(computePremium(1_000_000n, 30, 0n), 3_000n);
    assert.equal(computePremium(1_000n, 12, 500n), 500n);
    assert.equal(computeLateFee(1_000_000_000n, 0n), 0n);
    assert.equal(computeLateFee(1_000_000_000n, 200n), 100_000n);
    assert.equal(computeLateFee(1_000_000_000n, GRACE_SLOTS), 9_000_000n);
  });

  it('window posture matches the 24h / 2h grace schedule', () => {
    const start = 1_000n;
    assert.equal(windowPosture(start, 999n), 'Open');
    const mature = start + WINDOW_SLOTS;
    assert.equal(windowPosture(start, mature - 1n), 'Open');
    assert.equal(windowPosture(start, mature), 'Overdue');
    assert.equal(windowPosture(start, mature + GRACE_SLOTS - 1n), 'Overdue');
    assert.equal(windowPosture(start, mature + GRACE_SLOTS), 'Breached');
    assert.equal(windowPosture(0n, 5n), 'NoWindow');
  });

  it('LP share math mirrors the 4626 on-chain ledger', () => {
    assert.equal(computeDepositShares(1_000n, 0n, 0n), 1_000n);
    assert.equal(computeLpSharePrice(1_000n, 1_200n), 1_200_000n);
    assert.equal(computeLpWithdrawValue(1_000n, 1_000n, 1_200n), 1_200n);
    assert.equal(computeDepositShares(600n, 1_000n, 1_200n), 500n);
    assert.equal(computeLpWithdrawValue(500n, 1_500n, 1_800n), 600n);
    assert.equal(computeLpWithdrawValue(1_000n, 1_000n, 0n), 0n);
    assert.equal(computeLpWithdrawValue(1_000n, 1_000n, 500n), 500n);
  });
});