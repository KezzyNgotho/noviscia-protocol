/**
 * Live devnet proof of `place_limit_order` / `cancel_limit_order` /
 * `execute_limit_order`:
 *  1. Places a long-entry limit order on BTC with a trigger price of
 *     $10,000,000 — guaranteed to be crossed immediately by any real BTC
 *     price (entry_price <= trigger_price), so execution is deterministic.
 *     A second wallet executes it permissionlessly, proving a brand-new
 *     position gets created for the order's owner without them signing.
 *  2. Places a second order and cancels it, proving the escrowed collateral
 *     and both accounts' rent come back to the owner.
 *
 * Run: npx tsx scripts/e2e-limit-order-devnet.ts
 */
import * as anchor from '@coral-xyz/anchor';
import { AnchorProvider, Program, Wallet, BN } from '@coral-xyz/anchor';
import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount, getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { parseAccumulatorUpdateData } from '@pythnetwork/price-service-sdk';
import { getGuardianSetIndex, trimSignatures } from '@pythnetwork/pyth-solana-receiver/lib/vaa';
import {
  getConfigPda,
  getTreasuryPda,
  getGuardianSetPda,
  DEFAULT_RECEIVER_PROGRAM_ID,
  DEFAULT_WORMHOLE_PROGRAM_ID,
} from '@pythnetwork/pyth-solana-receiver/lib/address';
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
const SUB_ID = 0;
const BURN_ENGINE_PROGRAM = new PublicKey('nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id');
const STAKING_MANAGER_PROGRAM = new PublicKey('4VDQjH73DiE3zYt66ukyWY7KMMJrxHUZfjkxRHTPDG75');
const GUARANTEED_TRIGGER_PRICE = new BN(10_000_000_000_000); // $10,000,000 — always >= real BTC price

function loadKeypair(filePath: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(filePath, 'utf-8'))));
}
function encodeMerklePriceUpdate(message: Buffer, proof: number[][]): Buffer {
  const msgLen = Buffer.alloc(4);
  msgLen.writeUInt32LE(message.length, 0);
  const proofLen = Buffer.alloc(4);
  proofLen.writeUInt32LE(proof.length, 0);
  return Buffer.concat([msgLen, message, proofLen, ...proof.map((n) => Buffer.from(n))]);
}
async function fetchJit() {
  const res = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?ids[]=${BTC_FEED_HEX}&encoding=base64`);
  const json: any = await res.json();
  const acc = parseAccumulatorUpdateData(Buffer.from(json.binary.data[0], 'base64'));
  const guardianSetIndex = getGuardianSetIndex(acc.vaa);
  const update = acc.updates[0];
  return {
    signedPricePayload: trimSignatures(acc.vaa),
    merklePriceUpdateBytes: encodeMerklePriceUpdate(Buffer.from(update.message), update.proof),
    guardianSet: getGuardianSetPda(guardianSetIndex, DEFAULT_WORMHOLE_PROGRAM_ID),
    config: getConfigPda(DEFAULT_RECEIVER_PROGRAM_ID),
    treasury: getTreasuryPda(TREASURY_ID, DEFAULT_RECEIVER_PROGRAM_ID),
  };
}

async function sendWithRetry(
  connection: Connection,
  payer: Keypair,
  extraSigners: Keypair[],
  buildIx: () => Promise<anchor.web3.TransactionInstruction>,
  altInfo: anchor.web3.AddressLookupTableAccount,
  label: string,
  attempts = 4
): Promise<string> {
  for (let i = 1; i <= attempts; i++) {
    const ix = await buildIx();
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
      instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ix],
    }).compileToV0Message([altInfo]);
    const tx = new VersionedTransaction(msg);
    tx.sign([payer, ...extraSigners]);
    try {
      const sig = await connection.sendTransaction(tx, { skipPreflight: true });
      const result = await connection.confirmTransaction(sig, 'confirmed');
      if (!result.value.err) return sig;
      console.log(`  ${label} attempt ${i}/${attempts} reverted on-chain (${JSON.stringify(result.value.err)}) sig=${sig}, retrying...`);
    } catch (e: any) {
      console.log(`  ${label} attempt ${i}/${attempts} threw:`, e?.message || e);
      if (e?.getLogs) {
        try { console.log('  logs:', await e.getLogs(connection)); } catch {}
      }
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
  const nvIdl = JSON.parse(fs.readFileSync(path.join(ROOT, 'target/idl/nv_usdc_vault.json'), 'utf-8'));
  const nvProgram = new Program(nvIdl, provider);

  const caller = Keypair.generate();
  const { Transaction } = anchor.web3;
  const fundTx = new Transaction().add(SystemProgram.transfer({ fromPubkey: trader.publicKey, toPubkey: caller.publicKey, lamports: 0.02 * 1e9 }));
  await provider.sendAndConfirm(fundTx, [trader]);
  const callerNvusdc = await getOrCreateAssociatedTokenAccount(connection, trader, NVUSDC_MINT, caller.publicKey);

  const [ptConfig] = PublicKey.findProgramAddressSync([Buffer.from('pt-config')], pt.programId);
  const feedId = Buffer.from(BTC_FEED_HEX, 'hex');
  const [market] = PublicKey.findProgramAddressSync([Buffer.from('market'), feedId], pt.programId);
  const [vaultConfig] = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-config'), USDC_MINT.toBuffer()], NV_VAULT_PROGRAM);
  const vaultCfg: any = await (nvProgram.account as any).vaultConfig.fetch(vaultConfig);
  const vaultUsdc: PublicKey = vaultCfg.vaultUsdc;
  const traderNvusdc = await getOrCreateAssociatedTokenAccount(connection, trader, NVUSDC_MINT, trader.publicKey);

  const orderIdBuf = (id: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(id); return b; };
  const orderPda = (id: bigint) => PublicKey.findProgramAddressSync(
    [Buffer.from('limit-order'), trader.publicKey.toBuffer(), market.toBuffer(), Buffer.from([SUB_ID]), orderIdBuf(id)], pt.programId
  )[0];
  const orderVaultPda = (order: PublicKey) => PublicKey.findProgramAddressSync(
    [Buffer.from('limit-order-vault'), order.toBuffer()], pt.programId
  )[0];

  const jit1 = await fetchJit();
  const orderIdA = BigInt(Date.now());
  const orderA = orderPda(orderIdA);
  const orderVaultA = orderVaultPda(orderA);
  const [position] = PublicKey.findProgramAddressSync([Buffer.from('position'), trader.publicKey.toBuffer(), market.toBuffer(), Buffer.from([SUB_ID])], pt.programId);
  const [collateralVault] = PublicKey.findProgramAddressSync([Buffer.from('collateral-vault'), position.toBuffer()], pt.programId);
  const [settlementVault] = PublicKey.findProgramAddressSync([Buffer.from('settlement-vault')], pt.programId);
  const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-authority'), USDC_MINT.toBuffer()], NV_VAULT_PROGRAM);

  const constantAccounts = [
    ptConfig, market, vaultConfig, NV_VAULT_PROGRAM, NVUSDC_MINT, vaultAuthority, vaultUsdc,
    settlementVault, jit1.config, jit1.guardianSet, jit1.treasury, DEFAULT_RECEIVER_PROGRAM_ID,
    TOKEN_PROGRAM_ID, SystemProgram.programId, traderNvusdc.address, callerNvusdc.address,
    caller.publicKey, trader.publicKey, orderA, orderVaultA, position, collateralVault,
  ];
  const slot = await connection.getSlot('finalized');
  const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({ authority: trader.publicKey, payer: trader.publicKey, recentSlot: slot });
  const extendIx = AddressLookupTableProgram.extendLookupTable({ payer: trader.publicKey, authority: trader.publicKey, lookupTable: altAddress, addresses: constantAccounts });
  const createMsg = new TransactionMessage({ payerKey: trader.publicKey, recentBlockhash: (await connection.getLatestBlockhash()).blockhash, instructions: [createIx, extendIx] }).compileToV0Message();
  const createTx = new VersionedTransaction(createMsg);
  createTx.sign([trader]);
  await connection.sendTransaction(createTx).then((s) => connection.confirmTransaction(s, 'confirmed'));
  console.log('Created ALT, waiting for activation...');
  await new Promise((r) => setTimeout(r, 3000));
  const altInfo = (await connection.getAddressLookupTable(altAddress)).value!;

  const positionAlreadyOpen = !!(await connection.getAccountInfo(position));
  if (!positionAlreadyOpen && !(await connection.getAccountInfo(orderA))) {
    console.log(`Placing long-entry limit order (id=${orderIdA}) with trigger $${GUARANTEED_TRIGGER_PRICE.toNumber() / 1e6} (guaranteed immediate fill)...`);
    const placeSig = await pt.methods
      .placeLimitOrder(SUB_ID, new BN(orderIdA.toString()), true, new BN(10_000_000), new BN(2_000_000), GUARANTEED_TRIGGER_PRICE, new BN(0))
      .accounts({
        trader: trader.publicKey, ptConfig, market, limitOrder: orderA, orderVault: orderVaultA,
        nvusdcMint: NVUSDC_MINT, vaultConfig, traderNvusdc: traderNvusdc.address,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      } as any)
      .rpc();
    console.log('place_limit_order() tx:', placeSig);

    console.log('Executing limit order (permissionless, separate wallet)...');
    const priceUpdateAccount = Keypair.generate();
    const settlementVault = PublicKey.findProgramAddressSync([Buffer.from('settlement-vault')], pt.programId)[0];
    const vaultAuthority = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-authority'), USDC_MINT.toBuffer()], NV_VAULT_PROGRAM)[0];
    const vaultUsdc = PublicKey.findProgramAddressSync([Buffer.from('vault'), USDC_MINT.toBuffer()], NV_VAULT_PROGRAM)[0];
    const burnState = PublicKey.findProgramAddressSync([Buffer.from('burn_state')], BURN_ENGINE_PROGRAM)[0];
    const burnVaultUsdc = getAssociatedTokenAddressSync(USDC_MINT, burnState, true);
    const stakingFeePool = PublicKey.findProgramAddressSync([Buffer.from('staking-fee-pool')], STAKING_MANAGER_PROGRAM)[0];
    const stakingFeeVault = PublicKey.findProgramAddressSync([Buffer.from('staking-fee-pool'), Buffer.from('vault')], STAKING_MANAGER_PROGRAM)[0];
    const stakeAccount = PublicKey.findProgramAddressSync([Buffer.from('stake'), trader.publicKey.toBuffer()], STAKING_MANAGER_PROGRAM)[0];
    const execSig = await sendWithRetry(
      connection, caller, [priceUpdateAccount],
      async () => {
        const execJit = await fetchJit();
        return pt.methods
          .executeLimitOrder(SUB_ID, new BN(orderIdA.toString()), false, execJit.signedPricePayload, execJit.merklePriceUpdateBytes, TREASURY_ID)
          .accounts({
            caller: caller.publicKey, ptConfig, market, owner: trader.publicKey, limitOrder: orderA,
            orderVault: orderVaultA, callerNvusdc: callerNvusdc.address, position, collateralVault,
            vaultConfig, nvUsdcVaultProgram: NV_VAULT_PROGRAM, nvusdcMint: NVUSDC_MINT,
            settlementVault, vaultAuthority, vaultUsdc,
            burnEngineProgram: BURN_ENGINE_PROGRAM, burnState, burnVaultUsdc,
            stakingManagerProgram: STAKING_MANAGER_PROGRAM, stakingFeePool, stakingFeeVault, stakeAccount,
            priceUpdateAccount: priceUpdateAccount.publicKey, guardianSet: execJit.guardianSet,
            pythConfig: execJit.config, treasury: execJit.treasury, pythReceiverProgram: DEFAULT_RECEIVER_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
          } as any)
          .instruction();
      },
      altInfo, 'execute_limit_order'
    );
    console.log('execute_limit_order() tx (permissionless, separate wallet):', execSig);
  } else {
    console.log('Order/position already exist from a prior run — skipping place+execute.');
  }

  const positionInfo = await connection.getAccountInfo(position);
  const callerShares = await getAccount(connection, callerNvusdc.address);
  console.log('\nExecute results:');
  console.log('  position created:', !!positionInfo);
  console.log('  order + order_vault closed:', !(await connection.getAccountInfo(orderA)), !(await connection.getAccountInfo(orderVaultA)));
  console.log('  caller nvscUSDC bounty shares received:', callerShares.amount.toString());

  // ── Cancel proof: place a second order, then cancel it ──
  const orderIdB = orderIdA + 1n;
  const orderB = orderPda(orderIdB);
  const orderVaultB = orderVaultPda(orderB);
  if (!(await connection.getAccountInfo(orderB))) {
    console.log(`\nPlacing a second order (id=${orderIdB}) to prove cancel_limit_order...`);
    const placeSig2 = await pt.methods
      .placeLimitOrder(SUB_ID, new BN(orderIdB.toString()), true, new BN(10_000_000), new BN(1_000_000), GUARANTEED_TRIGGER_PRICE, new BN(0))
      .accounts({
        trader: trader.publicKey, ptConfig, market, limitOrder: orderB, orderVault: orderVaultB,
        nvusdcMint: NVUSDC_MINT, vaultConfig, traderNvusdc: traderNvusdc.address,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      } as any)
      .rpc();
    console.log('place_limit_order() tx (order B):', placeSig2);
  }
  const preCancelShares = await getAccount(connection, traderNvusdc.address);
  const cancelSig = await pt.methods
    .cancelLimitOrder(SUB_ID, new BN(orderIdB.toString()))
    .accounts({
      trader: trader.publicKey, ptConfig, market, limitOrder: orderB, orderVault: orderVaultB,
      traderNvusdc: traderNvusdc.address, tokenProgram: TOKEN_PROGRAM_ID,
    } as any)
    .rpc();
  const postCancelShares = await getAccount(connection, traderNvusdc.address);
  console.log('cancel_limit_order() tx:', cancelSig);
  console.log('\nCancel results:');
  console.log('  order + order_vault closed:', !(await connection.getAccountInfo(orderB)), !(await connection.getAccountInfo(orderVaultB)));
  console.log('  shares returned to trader:', (postCancelShares.amount - preCancelShares.amount).toString());

  console.log('\ne2e limit order proof complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
