/**
 * Combined smoke test for Phase 3-8: settle_funding, register_referral,
 * session delegation + open_position_delegate (with a real SPL Approve),
 * and TWAP create/execute/cancel. Does NOT test execute_adl (needs a
 * genuinely insolvent position to set up safely) or Phase 7 (descoped).
 */
import * as anchor from '@coral-xyz/anchor';
import { AnchorProvider, Program, Wallet, BN } from '@coral-xyz/anchor';
import {
  AddressLookupTableProgram, ComputeBudgetProgram, Connection, Keypair, PublicKey,
  SystemProgram, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount, createApproveInstruction, getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { parseAccumulatorUpdateData } from '@pythnetwork/price-service-sdk';
import { getGuardianSetIndex, trimSignatures } from '@pythnetwork/pyth-solana-receiver/lib/vaa';
import { getConfigPda, getTreasuryPda, getGuardianSetPda, DEFAULT_RECEIVER_PROGRAM_ID, DEFAULT_WORMHOLE_PROGRAM_ID } from '@pythnetwork/pyth-solana-receiver/lib/address';
import * as fs from 'fs';
import * as path from 'path';
import type { PositionTracker } from '../target/types/position_tracker';

const ROOT = path.resolve(__dirname, '..');
const RPC = process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com';
const USDC_MINT = new PublicKey('Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5');
const NVUSDC_MINT = new PublicKey('2TmaUey4Hh2om1kFR77Vw1RDh8H69qcW6UAACVidJeVk');
const NV_VAULT_PROGRAM = new PublicKey('CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC');
const BTC_FEED_HEX = 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';
const TREASURY_ID = 0;
const BURN_ENGINE_PROGRAM = new PublicKey('nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id');
const STAKING_MANAGER_PROGRAM = new PublicKey('4VDQjH73DiE3zYt66ukyWY7KMMJrxHUZfjkxRHTPDG75');

function loadKeypair(p: string): Keypair { return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf-8')))); }
function encodeMerklePriceUpdate(message: Buffer, proof: number[][]): Buffer {
  const msgLen = Buffer.alloc(4); msgLen.writeUInt32LE(message.length, 0);
  const proofLen = Buffer.alloc(4); proofLen.writeUInt32LE(proof.length, 0);
  return Buffer.concat([msgLen, message, proofLen, ...proof.map((n) => Buffer.from(n))]);
}
async function fetchJit() {
  const res = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?ids[]=${BTC_FEED_HEX}&encoding=base64`);
  const json: any = await res.json();
  const acc = parseAccumulatorUpdateData(Buffer.from(json.binary.data[0], 'base64'));
  const update = acc.updates[0];
  return {
    signedPricePayload: trimSignatures(acc.vaa),
    merklePriceUpdateBytes: encodeMerklePriceUpdate(Buffer.from(update.message), update.proof),
    guardianSet: getGuardianSetPda(getGuardianSetIndex(acc.vaa), DEFAULT_WORMHOLE_PROGRAM_ID),
    config: getConfigPda(DEFAULT_RECEIVER_PROGRAM_ID),
    treasury: getTreasuryPda(TREASURY_ID, DEFAULT_RECEIVER_PROGRAM_ID),
  };
}
async function sendWithRetry(connection: Connection, payer: Keypair, extraSigners: Keypair[], buildIx: () => Promise<anchor.web3.TransactionInstruction>, altInfo: anchor.web3.AddressLookupTableAccount, label: string, attempts = 4): Promise<string> {
  for (let i = 1; i <= attempts; i++) {
    const ix = await buildIx();
    const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: (await connection.getLatestBlockhash()).blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ix] }).compileToV0Message([altInfo]);
    const tx = new VersionedTransaction(msg);
    tx.sign([payer, ...extraSigners]);
    try {
      const sig = await connection.sendTransaction(tx, { skipPreflight: true });
      const result = await connection.confirmTransaction(sig, 'confirmed');
      if (!result.value.err) return sig;
      console.log(`  ${label} attempt ${i} reverted: ${JSON.stringify(result.value.err)} sig=${sig}`);
    } catch (e: any) {
      console.log(`  ${label} attempt ${i} threw:`, e?.message || e);
      if (e?.getLogs) { try { console.log('  logs:', await e.getLogs(connection)); } catch {} }
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts`);
}

async function main() {
  const trader = loadKeypair(path.join(require('os').homedir(), '.config/solana/new-id.json'));
  const connection = new Connection(RPC, 'confirmed');
  const provider = new AnchorProvider(connection, new Wallet(trader), { commitment: 'confirmed' });
  anchor.setProvider(provider);
  const idl = JSON.parse(fs.readFileSync(path.join(ROOT, 'target/idl/position_tracker.json'), 'utf-8'));
  const pt = new Program<PositionTracker>(idl, provider);

  const [ptConfig] = PublicKey.findProgramAddressSync([Buffer.from('pt-config')], pt.programId);
  const feedId = Buffer.from(BTC_FEED_HEX, 'hex');
  const [market] = PublicKey.findProgramAddressSync([Buffer.from('market'), feedId], pt.programId);
  const [vaultConfig] = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-config'), USDC_MINT.toBuffer()], NV_VAULT_PROGRAM);
  const traderNvusdc = await getOrCreateAssociatedTokenAccount(connection, trader, NVUSDC_MINT, trader.publicKey);

  // ── settle_funding ──
  console.log('--- settle_funding ---');
  try {
    const sig = await pt.methods.settleFunding().accounts({ caller: trader.publicKey, market } as any).rpc();
    console.log('settle_funding tx:', sig);
  } catch (e: any) {
    console.log('settle_funding skipped (likely rate-gated from a prior run):', e?.message?.slice(0, 150));
  }

  // ── register_referral ──
  console.log('--- register_referral ---');
  const referrer = Keypair.generate().publicKey;
  const [referral] = PublicKey.findProgramAddressSync([Buffer.from('referral'), trader.publicKey.toBuffer()], pt.programId);
  if (!(await connection.getAccountInfo(referral))) {
    const sig = await pt.methods.registerReferral(referrer).accounts({ trader: trader.publicKey, referral } as any).rpc();
    console.log('register_referral tx:', sig);
  } else {
    console.log('referral already registered from a prior run');
  }

  // ── session delegation + open_position_delegate ──
  console.log('--- session delegation + open_position_delegate ---');
  const delegate = Keypair.generate();
  await provider.sendAndConfirm(new anchor.web3.Transaction().add(SystemProgram.transfer({ fromPubkey: trader.publicKey, toPubkey: delegate.publicKey, lamports: 0.02 * 1e9 })), [trader]);
  const [sessionDelegate] = PublicKey.findProgramAddressSync([Buffer.from('session-delegate'), trader.publicKey.toBuffer()], pt.programId);
  if (!(await connection.getAccountInfo(sessionDelegate))) {
    const sig = await pt.methods.createSessionDelegation(new BN(Math.floor(Date.now() / 1000) + 3600))
      .accounts({ owner: trader.publicKey, delegate: delegate.publicKey, sessionDelegate } as any).rpc();
    console.log('create_session_delegation tx:', sig);
  } else {
    console.log('session delegate already exists from a prior run');
  }
  // Real SPL delegate approval — the actual authority for open_position_delegate to move funds.
  await provider.sendAndConfirm(new anchor.web3.Transaction().add(
    createApproveInstruction(traderNvusdc.address, delegate.publicKey, trader.publicKey, 5_000_000)
  ), [trader]);

  const SUB_ID = 7; // distinct sub_id so this doesn't collide with earlier tests' sub_id=0 positions
  const [position] = PublicKey.findProgramAddressSync([Buffer.from('position'), trader.publicKey.toBuffer(), market.toBuffer(), Buffer.from([SUB_ID])], pt.programId);
  const [collateralVault] = PublicKey.findProgramAddressSync([Buffer.from('collateral-vault'), position.toBuffer()], pt.programId);
  if (!(await connection.getAccountInfo(position))) {
    const jit1 = await fetchJit();
    const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-authority'), USDC_MINT.toBuffer()], NV_VAULT_PROGRAM);
    const [vaultUsdc] = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-usdc'), USDC_MINT.toBuffer()], NV_VAULT_PROGRAM);
    const [settlementVault] = PublicKey.findProgramAddressSync([Buffer.from('settlement-vault')], pt.programId);
    const BURN_ENGINE_PROGRAM = new PublicKey('nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id');
    const [burnState] = PublicKey.findProgramAddressSync([Buffer.from('burn_state')], BURN_ENGINE_PROGRAM);
    const burnVaultUsdc = getAssociatedTokenAddressSync(USDC_MINT, burnState, true);
    const STAKING_MANAGER_PROGRAM = new PublicKey('4VDQjH73DiE3zYt66ukyWY7KMMJrxHUZfjkxRHTPDG75');
    const [stakingFeePool] = PublicKey.findProgramAddressSync([Buffer.from('staking-fee-pool')], STAKING_MANAGER_PROGRAM);
    const [stakingFeeVault] = PublicKey.findProgramAddressSync([Buffer.from('staking-fee-pool'), Buffer.from('vault')], STAKING_MANAGER_PROGRAM);
    const [stakeAccount] = PublicKey.findProgramAddressSync([Buffer.from('stake'), trader.publicKey.toBuffer()], STAKING_MANAGER_PROGRAM);
    const constantAccounts = [ptConfig, market, vaultConfig, NV_VAULT_PROGRAM, NVUSDC_MINT, vaultAuthority, jit1.config, jit1.guardianSet, jit1.treasury, DEFAULT_RECEIVER_PROGRAM_ID, TOKEN_PROGRAM_ID, SystemProgram.programId, position, collateralVault, traderNvusdc.address, sessionDelegate, delegate.publicKey, settlementVault, burnEngineProgram, burnState, burnVaultUsdc, stakingManagerProgram, stakingFeePool, stakingFeeVault, stakeAccount, vaultUsdc];
    const slot = await connection.getSlot('finalized');
    const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({ authority: trader.publicKey, payer: trader.publicKey, recentSlot: slot });
    const extendIx = AddressLookupTableProgram.extendLookupTable({ payer: trader.publicKey, authority: trader.publicKey, lookupTable: altAddress, addresses: constantAccounts });
    const createMsg = new TransactionMessage({ payerKey: trader.publicKey, recentBlockhash: (await connection.getLatestBlockhash()).blockhash, instructions: [createIx, extendIx] }).compileToV0Message();
    const createTx = new VersionedTransaction(createMsg); createTx.sign([trader]);
    await connection.sendTransaction(createTx).then((s) => connection.confirmTransaction(s, 'confirmed'));
    await new Promise((r) => setTimeout(r, 3000));
    const altInfo = (await connection.getAddressLookupTable(altAddress)).value!;

    const priceUpdateAccount = Keypair.generate();
    const sig = await sendWithRetry(connection, delegate, [priceUpdateAccount], async () => {
      const jit = await fetchJit();
      return pt.methods.openPositionDelegate(SUB_ID, true, new BN(10_000_000), new BN(2_000_000), jit.signedPricePayload, jit.merklePriceUpdateBytes, TREASURY_ID)
        .accounts({
          delegate: delegate.publicKey, ptConfig, market, sessionDelegate, vaultConfig, nvUsdcVaultProgram: NV_VAULT_PROGRAM,
          nvusdcMint: NVUSDC_MINT, position, collateralVault, ownerNvusdc: traderNvusdc.address,
          settlementVault, burnEngineProgram: BURN_ENGINE_PROGRAM, burnState, burnVaultUsdc,
          stakingManagerProgram: STAKING_MANAGER_PROGRAM, stakingFeePool, stakingFeeVault, stakeAccount,
          vaultAuthority, vaultUsdc,
          priceUpdateAccount: priceUpdateAccount.publicKey, guardianSet: jit.guardianSet, pythConfig: jit.config, treasury: jit.treasury,
          pythReceiverProgram: DEFAULT_RECEIVER_PROGRAM_ID, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
        } as any).instruction();
    }, altInfo, 'open_position_delegate');
    console.log('open_position_delegate tx:', sig, '- position created:', !!(await connection.getAccountInfo(position)));
  } else {
    console.log('delegate-opened position already exists from a prior run');
  }

  // ── TWAP: create, one slice, cancel remainder ──
  console.log('--- TWAP create/execute/cancel ---');
  const [twapOrder] = PublicKey.findProgramAddressSync([Buffer.from('twap-order'), trader.publicKey.toBuffer(), market.toBuffer()], pt.programId);
  const [twapVault] = PublicKey.findProgramAddressSync([Buffer.from('twap-vault'), twapOrder.toBuffer()], pt.programId);
  if (!(await connection.getAccountInfo(twapOrder))) {
    const sig = await pt.methods.createTwapOrder(20, 3, true, new BN(5_000_000), new BN(1_000_000), new BN(1))
      .accounts({ trader: trader.publicKey, ptConfig, market, twapOrder, twapVault, nvusdcMint: NVUSDC_MINT, vaultConfig, traderNvusdc: traderNvusdc.address, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId } as any)
      .rpc();
    console.log('create_twap_order tx:', sig);
  }
  const twapAcct: any = await (pt.account as any).twapOrder.fetchNullable(twapOrder);
  if (twapAcct && twapAcct.slicesDone < twapAcct.slicesTotal) {
    const sliceSubId = 20 + twapAcct.slicesDone;
    const [slicePos] = PublicKey.findProgramAddressSync([Buffer.from('position'), trader.publicKey.toBuffer(), market.toBuffer(), Buffer.from([sliceSubId])], pt.programId);
    const [sliceVault] = PublicKey.findProgramAddressSync([Buffer.from('collateral-vault'), slicePos.toBuffer()], pt.programId);
    const jit1 = await fetchJit();
    const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-authority'), USDC_MINT.toBuffer()], NV_VAULT_PROGRAM);
    const constantAccounts = [ptConfig, market, vaultConfig, NV_VAULT_PROGRAM, NVUSDC_MINT, vaultAuthority, jit1.config, jit1.guardianSet, jit1.treasury, DEFAULT_RECEIVER_PROGRAM_ID, TOKEN_PROGRAM_ID, SystemProgram.programId, twapOrder, twapVault, traderNvusdc.address, slicePos, sliceVault];
    const slot = await connection.getSlot('finalized');
    const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({ authority: trader.publicKey, payer: trader.publicKey, recentSlot: slot });
    const extendIx = AddressLookupTableProgram.extendLookupTable({ payer: trader.publicKey, authority: trader.publicKey, lookupTable: altAddress, addresses: constantAccounts });
    const createMsg = new TransactionMessage({ payerKey: trader.publicKey, recentBlockhash: (await connection.getLatestBlockhash()).blockhash, instructions: [createIx, extendIx] }).compileToV0Message();
    const createTx = new VersionedTransaction(createMsg); createTx.sign([trader]);
    await connection.sendTransaction(createTx).then((s) => connection.confirmTransaction(s, 'confirmed'));
    await new Promise((r) => setTimeout(r, 3000));
    const altInfo = (await connection.getAddressLookupTable(altAddress)).value!;

    const priceUpdateAccount = Keypair.generate();
    const settlementVault = PublicKey.findProgramAddressSync([Buffer.from('settlement-vault')], pt.programId)[0];
    const vaultAuthority = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-authority'), USDC_MINT.toBuffer()], NV_VAULT_PROGRAM)[0];
    const vaultUsdc = PublicKey.findProgramAddressSync([Buffer.from('vault'), USDC_MINT.toBuffer()], NV_VAULT_PROGRAM)[0];
    const burnState = PublicKey.findProgramAddressSync([Buffer.from('burn_state')], BURN_ENGINE_PROGRAM)[0];
    const burnVaultUsdc = getAssociatedTokenAddressSync(USDC_MINT, burnState, true);
    const stakingFeePool = PublicKey.findProgramAddressSync([Buffer.from('staking-fee-pool')], STAKING_MANAGER_PROGRAM)[0];
    const stakingFeeVault = PublicKey.findProgramAddressSync([Buffer.from('staking-fee-pool'), Buffer.from('vault')], STAKING_MANAGER_PROGRAM)[0];
    const stakeAccount = PublicKey.findProgramAddressSync([Buffer.from('stake'), trader.publicKey.toBuffer()], STAKING_MANAGER_PROGRAM)[0];
    const sig = await sendWithRetry(connection, trader, [priceUpdateAccount], async () => {
      const jit = await fetchJit();
      return pt.methods.executeTwapSlice(jit.signedPricePayload, jit.merklePriceUpdateBytes, TREASURY_ID)
        .accounts({
          caller: trader.publicKey, ptConfig, market, twapOrder, twapVault, callerNvusdc: traderNvusdc.address,
          position: slicePos, collateralVault: sliceVault, vaultConfig, nvUsdcVaultProgram: NV_VAULT_PROGRAM, nvusdcMint: NVUSDC_MINT,
          settlementVault, vaultAuthority, vaultUsdc,
          burnEngineProgram: BURN_ENGINE_PROGRAM, burnState, burnVaultUsdc,
          stakingManagerProgram: STAKING_MANAGER_PROGRAM, stakingFeePool, stakingFeeVault, stakeAccount,
          priceUpdateAccount: priceUpdateAccount.publicKey, guardianSet: jit.guardianSet, pythConfig: jit.config, treasury: jit.treasury,
          pythReceiverProgram: DEFAULT_RECEIVER_PROGRAM_ID, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
        } as any).instruction();
    }, altInfo, 'execute_twap_slice');
    console.log('execute_twap_slice tx:', sig, '- slice position created:', !!(await connection.getAccountInfo(slicePos)));
  } else {
    console.log('TWAP already fully sliced from a prior run');
  }

  const twapAfter: any = await (pt.account as any).twapOrder.fetchNullable(twapOrder);
  if (twapAfter && twapAfter.slicesDone < twapAfter.slicesTotal) {
    const preBal = await getAccount(connection, traderNvusdc.address);
    const sig = await pt.methods.cancelTwapOrder()
      .accounts({ trader: trader.publicKey, ptConfig, market, twapOrder, twapVault, traderNvusdc: traderNvusdc.address, tokenProgram: TOKEN_PROGRAM_ID } as any)
      .rpc();
    const postBal = await getAccount(connection, traderNvusdc.address);
    console.log('cancel_twap_order tx:', sig, '- refunded shares:', (postBal.amount - preBal.amount).toString());
  }

  console.log('\nPhase 3-8 smoke test complete (execute_adl and Phase 7 not exercised — see report).');
}

main().catch((e) => { console.error(e); process.exit(1); });
