/**
 * Live devnet proof that the trading-fee 3-way split (added 2026-07-07)
 * actually reaches NVSC — before this, 100% of every trading fee flowed
 * into nv-usdc-vault NAV with zero connection to staking-manager or
 * burn-engine, despite both having instructions (record_trading_fee_usdc,
 * accumulate_funds) built specifically to receive it. Opens then closes a
 * real position, measuring the exact before/after delta on all three
 * targets: vault NAV (60%), staking_fee_pool.accumulated_usdc (25%), and
 * burn_vault_usdc's raw balance (15%, the remainder).
 *
 * Run: npx tsx scripts/e2e-nvsc-fee-split-devnet.ts
 */
import * as anchor from '@coral-xyz/anchor';
import { AnchorProvider, Program, Wallet, BN } from '@coral-xyz/anchor';
import {
  AddressLookupTableProgram, ComputeBudgetProgram, Connection, Keypair, PublicKey,
  SystemProgram, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount, getAccount } from '@solana/spl-token';
import { parseAccumulatorUpdateData } from '@pythnetwork/price-service-sdk';
import { getGuardianSetIndex, trimSignatures } from '@pythnetwork/pyth-solana-receiver/lib/vaa';
import {
  getConfigPda, getTreasuryPda, getGuardianSetPda,
  DEFAULT_RECEIVER_PROGRAM_ID, DEFAULT_WORMHOLE_PROGRAM_ID,
} from '@pythnetwork/pyth-solana-receiver/lib/address';
import * as fs from 'fs';
import * as path from 'path';
import type { PositionTracker } from '../target/types/position_tracker';
import { nettingRemainingAccounts } from '../utils/lib/netting-remaining';

const ROOT = path.resolve(__dirname, '..');
const USDC_MINT = new PublicKey('Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5');
const NVUSDC_MINT = new PublicKey('2TmaUey4Hh2om1kFR77Vw1RDh8H69qcW6UAACVidJeVk');
const NV_VAULT_PROGRAM = new PublicKey('CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC');
const BURN_ENGINE = new PublicKey('nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id');
const STAKING_MANAGER = new PublicKey('HjxcKV51A7jxE2iqMCDY7EvWFL9XsheuM43DamWGabqb');
const BURN_VAULT_USDC = new PublicKey('5gXoi3aqnomJiCZkE6ta5T7tJKNvW9GfNrfHEncsLnna');
const SOL_FEED_HEX = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';
const TREASURY_ID = 0;
const SUB_ID = 4;
const ALT_CACHE_PATH = path.join(ROOT, '.cache/jit-alt-devnet-nvsc-fee.json');
const SIZE_USDC = new BN(200_000_000); // $200 notional, size so a 0.05% fee ($0.10) splits into non-zero cents

function loadKeypair(fp: string): Keypair { return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(fp, 'utf-8')))); }
function encodeMerklePriceUpdate(message: Buffer, proof: number[][]): Buffer {
  const a = Buffer.alloc(4); a.writeUInt32LE(message.length, 0);
  const b = Buffer.alloc(4); b.writeUInt32LE(proof.length, 0);
  return Buffer.concat([a, message, b, ...proof.map((n) => Buffer.from(n))]);
}
async function fetchRetry(url: string, attempts = 5, delayMs = 2000): Promise<Response> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) { try { return await fetch(url); } catch (e) { lastErr = e; if (i < attempts) await new Promise((r) => setTimeout(r, delayMs)); } }
  throw lastErr;
}
async function fetchJitPriceArgs() {
  const res = await fetchRetry(`https://pyth.dourolabs.app/hermes/v2/updates/price/latest?ids[]=${SOL_FEED_HEX}&encoding=base64`);
  const json: any = await res.json();
  const acc = parseAccumulatorUpdateData(Buffer.from(json.binary.data[0], 'base64'));
  const guardianSetIndex = getGuardianSetIndex(acc.vaa);
  const trimmedVaa = trimSignatures(acc.vaa);
  const update = acc.updates[0];
  return {
    signedPricePayload: trimmedVaa,
    merklePriceUpdateBytes: encodeMerklePriceUpdate(Buffer.from(update.message), update.proof),
    guardianSet: getGuardianSetPda(guardianSetIndex, DEFAULT_WORMHOLE_PROGRAM_ID),
    config: getConfigPda(DEFAULT_RECEIVER_PROGRAM_ID),
    treasury: getTreasuryPda(TREASURY_ID, DEFAULT_RECEIVER_PROGRAM_ID),
  };
}
async function getOrCreateAlt(connection: Connection, payer: Keypair, addresses: PublicKey[]): Promise<AddressLookupTableAccount> {
  if (fs.existsSync(ALT_CACHE_PATH)) {
    const cached = new PublicKey(JSON.parse(fs.readFileSync(ALT_CACHE_PATH, 'utf-8')).address);
    const info = await connection.getAddressLookupTable(cached);
    if (info.value && addresses.every((a) => info.value!.state.addresses.some((b) => b.equals(a)))) return info.value;
  }
  const slot = await connection.getSlot();
  const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey, payer: payer.publicKey, recentSlot: slot });
  const extendIx = AddressLookupTableProgram.extendLookupTable({ payer: payer.publicKey, authority: payer.publicKey, lookupTable: altAddress, addresses });
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: (await connection.getLatestBlockhash()).blockhash, instructions: [createIx, extendIx] }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([payer]);
  const sig = await connection.sendTransaction(tx);
  await connection.confirmTransaction(sig, 'confirmed');
  console.log('Created ALT:', altAddress.toBase58(), sig);
  fs.mkdirSync(path.dirname(ALT_CACHE_PATH), { recursive: true });
  fs.writeFileSync(ALT_CACHE_PATH, JSON.stringify({ address: altAddress.toBase58() }));
  const createdAtSlot = await connection.getSlot('confirmed');
  for (let i = 0; i < 20; i++) {
    if ((await connection.getSlot('confirmed')) > createdAtSlot) {
      const info = await connection.getAddressLookupTable(altAddress);
      if (info.value) return info.value;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('ALT did not activate in time');
}
async function sendV0(connection: Connection, payer: Keypair, extraSigners: Keypair[], instructions: any[], alt: AddressLookupTableAccount) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message([alt]);
  const tx = new VersionedTransaction(message);
  tx.sign([payer, ...extraSigners]);
  console.log('  serialized tx size:', tx.serialize().length, 'bytes');
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return sig;
}

async function main() {
  const trader = loadKeypair(path.join(require('os').homedir(), '.config/solana/new-id.json'));
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const provider = new AnchorProvider(connection, new Wallet(trader), { commitment: 'confirmed' });
  anchor.setProvider(provider);
  const idl = JSON.parse(fs.readFileSync(path.join(ROOT, 'target/idl/position_tracker.json'), 'utf-8'));
  const pt = new Program<PositionTracker>(idl, provider);
  const nvProgram = new Program(JSON.parse(fs.readFileSync(path.join(ROOT, 'target/idl/nv_usdc_vault.json'), 'utf-8')), provider);
  const stakingProgram = new Program(JSON.parse(fs.readFileSync(path.join(ROOT, 'target/idl/staking_manager.json'), 'utf-8')), provider);

  const [ptConfig] = PublicKey.findProgramAddressSync([Buffer.from('pt-config')], pt.programId);
  const [market] = PublicKey.findProgramAddressSync([Buffer.from('market'), Buffer.from(SOL_FEED_HEX, 'hex')], pt.programId);
  const [position] = PublicKey.findProgramAddressSync([Buffer.from('position'), trader.publicKey.toBuffer(), market.toBuffer(), Buffer.from([SUB_ID])], pt.programId);
  const [collateralVault] = PublicKey.findProgramAddressSync([Buffer.from('collateral-vault'), position.toBuffer()], pt.programId);
  const [vaultConfig] = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-config'), USDC_MINT.toBuffer()], NV_VAULT_PROGRAM);
  const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-authority'), USDC_MINT.toBuffer()], NV_VAULT_PROGRAM);
  const [settlementVault] = PublicKey.findProgramAddressSync([Buffer.from('settlement-vault')], pt.programId);
  const [insuranceVault] = PublicKey.findProgramAddressSync([Buffer.from('insurance-vault')], pt.programId);
  const [burnState] = PublicKey.findProgramAddressSync([Buffer.from('burn_state')], BURN_ENGINE);
  const [stakingFeePool] = PublicKey.findProgramAddressSync([Buffer.from('staking-fee-pool')], STAKING_MANAGER);
  const [stakingFeeVault] = PublicKey.findProgramAddressSync([Buffer.from('staking-fee-pool'), Buffer.from('vault')], STAKING_MANAGER);
  const [stakeAccount] = PublicKey.findProgramAddressSync([Buffer.from('stake'), trader.publicKey.toBuffer()], STAKING_MANAGER);

  const vaultCfg: any = await (nvProgram.account as any).vaultConfig.fetch(vaultConfig);
  const vaultUsdc: PublicKey = vaultCfg.vaultUsdc;

  const traderNvusdc = await getOrCreateAssociatedTokenAccount(connection, trader, NVUSDC_MINT, trader.publicKey);
  const traderUsdc = await getOrCreateAssociatedTokenAccount(connection, trader, USDC_MINT, trader.publicKey);

  const existing = await connection.getAccountInfo(position);
  if (existing) { console.log(`sub_id ${SUB_ID} already open — bump SUB_ID and re-run.`); process.exit(1); }

  console.log('--- BEFORE ---');
  const navBefore = Number(vaultCfg.totalAssets.toString()) / Number(vaultCfg.totalShares.toString());
  const stakingPoolBefore: any = await (stakingProgram.account as any).stakingFeePool.fetch(stakingFeePool);
  const burnVaultBefore = await getAccount(connection, BURN_VAULT_USDC);
  console.log('NAV/share:', navBefore.toFixed(10));
  console.log('staking_fee_pool.accumulated_usdc:', stakingPoolBefore.accumulatedUsdc.toString());
  console.log('burn_vault_usdc balance:', burnVaultBefore.amount.toString());

  const jit0 = await fetchJitPriceArgs();
  const constantAccounts = [
    ptConfig, market, vaultConfig, NV_VAULT_PROGRAM, NVUSDC_MINT, vaultAuthority, vaultUsdc, settlementVault, insuranceVault,
    jit0.config, jit0.guardianSet, jit0.treasury, DEFAULT_RECEIVER_PROGRAM_ID, TOKEN_PROGRAM_ID, SystemProgram.programId,
    position, collateralVault, traderNvusdc.address, traderUsdc.address,
    BURN_ENGINE, burnState, BURN_VAULT_USDC, STAKING_MANAGER, stakingFeePool, stakingFeeVault, stakeAccount,
    ...nettingRemainingAccounts(trader.publicKey).map((a) => a.pubkey),
  ];
  const alt = await getOrCreateAlt(connection, trader, constantAccounts);

  console.log('\n1) Opening $200 SOL long...');
  const jitOpen = await fetchJitPriceArgs();
  const priceUpdateAccount1 = Keypair.generate();
  const collateralShares = new BN(20_000_000); // $20 margin, comfortably above the ~$4 minimum at 50x
  const openIx = await pt.methods
    .openPositionJit(SUB_ID, true, SIZE_USDC, collateralShares, 0, null, null, jitOpen.signedPricePayload, jitOpen.merklePriceUpdateBytes, TREASURY_ID)
    .accounts({
      trader: trader.publicKey, ptConfig, market, vaultConfig, vaultAuthority, vaultUsdc,
      nvUsdcVaultProgram: NV_VAULT_PROGRAM, nvusdcMint: NVUSDC_MINT, settlementVault,
      position, collateralVault, traderNvusdc: traderNvusdc.address,
      priceUpdateAccount: priceUpdateAccount1.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    } as any)
    .remainingAccounts([
      // Fee split [0..6]
      { pubkey: BURN_ENGINE, isSigner: false, isWritable: false },
      { pubkey: burnState, isSigner: false, isWritable: true },
      { pubkey: BURN_VAULT_USDC, isSigner: false, isWritable: true },
      { pubkey: STAKING_MANAGER, isSigner: false, isWritable: false },
      { pubkey: stakingFeePool, isSigner: false, isWritable: true },
      { pubkey: stakingFeeVault, isSigner: false, isWritable: true },
      { pubkey: stakeAccount, isSigner: false, isWritable: true },
      // Pyth JIT [7..10]
      { pubkey: jitOpen.guardianSet, isSigner: false, isWritable: true },
      { pubkey: jitOpen.config, isSigner: false, isWritable: true },
      { pubkey: jitOpen.treasury, isSigner: false, isWritable: true },
      { pubkey: DEFAULT_RECEIVER_PROGRAM_ID, isSigner: false, isWritable: false },
      // Netting-engine accounts [11..15]
      ...nettingRemainingAccounts(trader.publicKey),
    ])
    .instruction();
  const openSig = await sendV0(connection, trader, [priceUpdateAccount1], [ComputeBudgetProgram.setComputeUnitLimit({ units: 350_000 }), openIx], alt);
  console.log('open_position_jit() tx:', openSig);

  console.log('\n2) Closing...');
  const jitClose = await fetchJitPriceArgs();
  const priceUpdateAccount2 = Keypair.generate();
  const closeIx = await pt.methods
    .closePosition(SUB_ID, jitClose.signedPricePayload, jitClose.merklePriceUpdateBytes, TREASURY_ID)
    .accounts({
      trader: trader.publicKey, ptConfig, market, position, collateralVault,
      traderNvusdc: traderNvusdc.address, traderUsdc: traderUsdc.address,
      vaultConfig, vaultAuthority, vaultUsdc, nvusdcMint: NVUSDC_MINT, nvUsdcVaultProgram: NV_VAULT_PROGRAM,
      settlementVault, insuranceVault, burnEngineProgram: BURN_ENGINE, burnState, burnVaultUsdc: BURN_VAULT_USDC,
      stakingManagerProgram: STAKING_MANAGER, stakingFeePool, stakingFeeVault, stakeAccount,
      priceUpdateAccount: priceUpdateAccount2.publicKey, guardianSet: jitClose.guardianSet,
      pythConfig: jitClose.config, treasury: jitClose.treasury, pythReceiverProgram: DEFAULT_RECEIVER_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    } as any)
    .remainingAccounts(nettingRemainingAccounts(trader.publicKey))
    .instruction();
  const closeSig = await sendV0(connection, trader, [priceUpdateAccount2], [ComputeBudgetProgram.setComputeUnitLimit({ units: 350_000 }), closeIx], alt);
  console.log('close_position() tx:', closeSig);

  console.log('\n--- AFTER ---');
  const vaultCfgAfter: any = await (nvProgram.account as any).vaultConfig.fetch(vaultConfig);
  const navAfter = Number(vaultCfgAfter.totalAssets.toString()) / Number(vaultCfgAfter.totalShares.toString());
  const stakingPoolAfter: any = await (stakingProgram.account as any).stakingFeePool.fetch(stakingFeePool);
  const burnVaultAfter = await getAccount(connection, BURN_VAULT_USDC);
  console.log('NAV/share:', navAfter.toFixed(10), navAfter > navBefore ? '(increased)' : '(DID NOT increase)');
  console.log('staking_fee_pool.accumulated_usdc:', stakingPoolBefore.accumulatedUsdc.toString(), '->', stakingPoolAfter.accumulatedUsdc.toString(),
    `(delta +${(BigInt(stakingPoolAfter.accumulatedUsdc.toString()) - BigInt(stakingPoolBefore.accumulatedUsdc.toString())).toString()})`);
  console.log('burn_vault_usdc balance:', burnVaultBefore.amount.toString(), '->', burnVaultAfter.amount.toString(),
    `(delta +${(burnVaultAfter.amount - burnVaultBefore.amount).toString()})`);

  const totalFeeCharged = Number(SIZE_USDC.toString()) * 2 * 5 / 10000; // open + close, 5bps each
  console.log(`\nExpected total trading fee (open+close, 5bps each on $200 notional): ${totalFeeCharged} raw units`);
  console.log(`Expected split: vault~${Math.round(totalFeeCharged * 0.6)}, staking~${Math.round(totalFeeCharged * 0.25)}, burn~${Math.round(totalFeeCharged * 0.15)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
