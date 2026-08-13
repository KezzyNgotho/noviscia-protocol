/**
 * Live devnet proof of `set_tp_sl` + `execute_tp_sl`: opens a small long on
 * BTC, sets a take-profit trigger price of $1 (1e6-scaled = 1_000_000) —
 * guaranteed to be crossed immediately by any real BTC price, so the test
 * is deterministic and doesn't need to wait for real market movement. A
 * second wallet acts as the permissionless executor to prove no special
 * privilege is required, same pattern as e2e-liquidate-devnet.ts.
 *
 * Run: npx tsx scripts/e2e-tp-sl-devnet.ts
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
import { nettingRemainingAccounts } from '../utils/lib/netting-remaining';

const ROOT = path.resolve(__dirname, '..');
const RPC = process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com';
const USDC_MINT = new PublicKey('Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5');
const NVUSDC_MINT = new PublicKey('2TmaUey4Hh2om1kFR77Vw1RDh8H69qcW6UAACVidJeVk');
const NV_VAULT_PROGRAM = new PublicKey('CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC');
const BTC_FEED_HEX = 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';
const TREASURY_ID = 0;
const SUB_ID = 1;
const GUARANTEED_TP_PRICE = new BN(1_000_000); // $1 — any real BTC price triggers this instantly

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
  let computeUnits = 400_000;
  for (let i = 1; i <= attempts; i++) {
    try {
      const ix = await buildIx();
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const msg = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
          ix,
        ],
      }).compileToV0Message([altInfo]);
      const tx = new VersionedTransaction(msg);
      tx.sign([payer, ...extraSigners]);
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 0 });
      const result = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      if (result.value.err) {
        const errStr = JSON.stringify(result.value.err);
        console.log(`  ${label} attempt ${i}/${attempts} reverted on-chain: ${errStr}`);
        if (errStr.includes('ComputationalBudgetExceeded') && computeUnits < 1_400_000) {
          computeUnits = Math.min(computeUnits * 2, 1_400_000);
          console.log(`  ${label} increasing CU to ${computeUnits}`);
          continue;
        }
        if (i < attempts) await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      return sig;
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.log(`  ${label} attempt ${i}/${attempts} threw:`, msg.slice(0, 200));
      if (msg.includes('ComputationalBudgetExceeded') && computeUnits < 1_400_000) {
        computeUnits = Math.min(computeUnits * 2, 1_400_000);
      } else if (i < attempts) {
        await new Promise(r => setTimeout(r, 2000));
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
  const [position] = PublicKey.findProgramAddressSync([Buffer.from('position'), trader.publicKey.toBuffer(), market.toBuffer(), Buffer.from([SUB_ID])], pt.programId);
  const [collateralVault] = PublicKey.findProgramAddressSync([Buffer.from('collateral-vault'), position.toBuffer()], pt.programId);
  const [vaultConfig] = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-config'), USDC_MINT.toBuffer()], NV_VAULT_PROGRAM);
  const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-authority'), USDC_MINT.toBuffer()], NV_VAULT_PROGRAM);
  const [settlementVault] = PublicKey.findProgramAddressSync([Buffer.from('settlement-vault')], pt.programId);
  const [insuranceVault] = PublicKey.findProgramAddressSync([Buffer.from('insurance-vault')], pt.programId);
  const vaultCfg: any = await (nvProgram.account as any).vaultConfig.fetch(vaultConfig);
  const vaultUsdc: PublicKey = vaultCfg.vaultUsdc;

  const traderNvusdc = await getOrCreateAssociatedTokenAccount(connection, trader, NVUSDC_MINT, trader.publicKey);
  const traderUsdc = await getOrCreateAssociatedTokenAccount(connection, trader, USDC_MINT, trader.publicKey);

  const jit1 = await fetchJit();
  const BURN_ENGINE_PROGRAM = new PublicKey('nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id');
  const [burnState] = PublicKey.findProgramAddressSync([Buffer.from('burn_state')], BURN_ENGINE_PROGRAM);
  const burnVaultUsdc = getAssociatedTokenAddressSync(USDC_MINT, burnState, true);
  const STAKING_MANAGER_PROGRAM = new PublicKey('4VDQjH73DiE3zYt66ukyWY7KMMJrxHUZfjkxRHTPDG75');
  const [stakingFeePool] = PublicKey.findProgramAddressSync([Buffer.from('staking-fee-pool')], STAKING_MANAGER_PROGRAM);
  const [stakingFeeVault] = PublicKey.findProgramAddressSync([Buffer.from('staking-fee-pool'), Buffer.from('vault')], STAKING_MANAGER_PROGRAM);
  const [stakeAccount] = PublicKey.findProgramAddressSync([Buffer.from('stake'), trader.publicKey.toBuffer()], STAKING_MANAGER_PROGRAM);
  const constantAccounts = [
    ptConfig, market, vaultConfig, NV_VAULT_PROGRAM, NVUSDC_MINT, vaultAuthority, vaultUsdc,
    settlementVault, insuranceVault, jit1.config, jit1.guardianSet, jit1.treasury, DEFAULT_RECEIVER_PROGRAM_ID,
    TOKEN_PROGRAM_ID, SystemProgram.programId, position, collateralVault, traderNvusdc.address,
    traderUsdc.address, callerNvusdc.address, caller.publicKey, trader.publicKey,
    BURN_ENGINE_PROGRAM, burnState, burnVaultUsdc, STAKING_MANAGER_PROGRAM, stakingFeePool, stakingFeeVault, stakeAccount,
    ...nettingRemainingAccounts(trader.publicKey).map((a) => a.pubkey),
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

  const skipOpen = !!(await connection.getAccountInfo(position));
  if (!skipOpen) {
    const sizeUsdc = new BN(10_000_000); // $10 notional
    const collateralShares = new BN(2_000_000); // 2 nvscUSDC shares
    const priceUpdateAccount1 = Keypair.generate();

    const openSig = await sendWithRetry(
      connection, trader, [priceUpdateAccount1],
      async () => {
        const openJit = await fetchJit();
        return pt.methods
          .openPositionJit(SUB_ID, true, sizeUsdc, collateralShares, 0, null, null,
            openJit.signedPricePayload, openJit.merklePriceUpdateBytes, TREASURY_ID)
          .accounts({
            trader: trader.publicKey, ptConfig, market, vaultConfig, vaultAuthority, vaultUsdc,
            nvUsdcVaultProgram: NV_VAULT_PROGRAM, nvusdcMint: NVUSDC_MINT,
            settlementVault,
            position, collateralVault, traderNvusdc: traderNvusdc.address,
            priceUpdateAccount: priceUpdateAccount1.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
          } as any)
          .remainingAccounts([
            // Fee split [0..6]
            { pubkey: BURN_ENGINE_PROGRAM, isSigner: false, isWritable: false },
            { pubkey: burnState, isSigner: false, isWritable: true },
            { pubkey: burnVaultUsdc, isSigner: false, isWritable: true },
            { pubkey: STAKING_MANAGER_PROGRAM, isSigner: false, isWritable: false },
            { pubkey: stakingFeePool, isSigner: false, isWritable: true },
            { pubkey: stakingFeeVault, isSigner: false, isWritable: true },
            { pubkey: stakeAccount, isSigner: false, isWritable: true },
            // Pyth JIT [7..10]
            { pubkey: openJit.guardianSet, isSigner: false, isWritable: true },
            { pubkey: openJit.config, isSigner: false, isWritable: true },
            { pubkey: openJit.treasury, isSigner: false, isWritable: true },
            { pubkey: DEFAULT_RECEIVER_PROGRAM_ID, isSigner: false, isWritable: false },
            // Netting-engine accounts [11..15]
            ...nettingRemainingAccounts(trader.publicKey),
          ])
          .instruction();
      },
      altInfo, 'open_position_jit'
    );
    console.log('open_position_jit() tx:', openSig);
  } else {
    console.log('Position already open from a prior run — skipping open.');
  }

  console.log(`Setting take-profit trigger at $${GUARANTEED_TP_PRICE.toNumber() / 1e6} (guaranteed to be crossed immediately)...`);
  const setTpSlSig = await pt.methods
    .setTpSl(SUB_ID, GUARANTEED_TP_PRICE, null)
    .accounts({ trader: trader.publicKey, market, position } as any)
    .rpc();
  console.log('set_tp_sl() tx:', setTpSlSig);

  await new Promise((r) => setTimeout(r, 2000));

  const preLamportsCaller = await connection.getBalance(caller.publicKey);
  const priceUpdateAccount2 = Keypair.generate();

  const execSig = await sendWithRetry(
    connection, caller, [priceUpdateAccount2],
    async () => {
      const execJit = await fetchJit();
      return pt.methods
        .executeTpSl(SUB_ID, execJit.signedPricePayload, execJit.merklePriceUpdateBytes, TREASURY_ID)
        .accounts({
          caller: caller.publicKey, ptConfig, market, owner: trader.publicKey, position,
          collateralVault, traderNvusdc: traderNvusdc.address, callerNvusdc: callerNvusdc.address,
          traderUsdc: traderUsdc.address, vaultConfig, vaultAuthority, vaultUsdc,
          nvusdcMint: NVUSDC_MINT, nvUsdcVaultProgram: NV_VAULT_PROGRAM, settlementVault,
          insuranceVault,
          burnEngineProgram: BURN_ENGINE_PROGRAM, burnState, burnVaultUsdc,
          stakingManagerProgram: STAKING_MANAGER_PROGRAM, stakingFeePool, stakingFeeVault, stakeAccount,
          priceUpdateAccount: priceUpdateAccount2.publicKey, guardianSet: execJit.guardianSet,
          pythConfig: execJit.config, treasury: execJit.treasury, pythReceiverProgram: DEFAULT_RECEIVER_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
        } as any)
        .instruction();
    },
    altInfo, 'execute_tp_sl'
  );
  console.log('execute_tp_sl() tx (permissionless, separate wallet):', execSig);

  const postLamportsCaller = await connection.getBalance(caller.publicKey);
  const callerShares = await getAccount(connection, callerNvusdc.address);
  const positionClosed = !(await connection.getAccountInfo(position));
  const vaultClosed = !(await connection.getAccountInfo(collateralVault));

  console.log('\nResults:');
  console.log('  position closed:', positionClosed, '| collateral_vault closed:', vaultClosed);
  console.log('  caller nvscUSDC bounty shares received:', callerShares.amount.toString());
  console.log('  caller rent reclaimed (lamports):', postLamportsCaller - preLamportsCaller);
  console.log('\ne2e TP/SL proof complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
