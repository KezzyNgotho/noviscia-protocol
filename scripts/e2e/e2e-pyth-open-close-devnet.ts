/**
 * Pyth-only E2E: open → close a 1x long SOL-PERP position on live devnet
 * using the Pyth JIT oracle (Pyth-only flow, no other oracles).
 *
 * Mirrors the sendJitTxWithFeed pattern from app/web/lib/position-tracker/
 * jitOracle.ts — two atomic feed-path transactions:
 *
 *   Open:   ix-0 update_price_feed       — verifies a fresh guardian-signed
 *            Hermes accumulator update on-chain (CPI into the real Pyth
 *            Receiver program, ephemeral price_update_account) and writes the
 *            market's PriceFeed PDA.
 *           ix-1 open_position_from_feed  — opens against that same PriceFeed
 *            PDA in the SAME transaction/slot: zero staleness race regardless
 *            of how long signing or sending takes.
 *
 *   Close:  same pair with close_position_from_feed after a 3s wait, using a
 *           freshly fetched price update.
 *
 * Run:
 *   npx tsx scripts/e2e/e2e-pyth-open-close-devnet.ts
 * Env overrides:
 *   SOLANA_RPC_DEVNET   RPC endpoint (default https://api.devnet.solana.com)
 *   PYTH_E2E_SUB_ID     isolated sub-account id (default 0)
 */
import 'dotenv/config';
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
import { TOKEN_PROGRAM_ID, getAccount, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
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

const ROOT = path.resolve(__dirname, '../..');
const RPC = process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com';

// Deployed program IDs (Anchor.toml [programs.devnet])
const PT_PROGRAM_ID = new PublicKey('6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws');
const NV_VAULT_PROGRAM_ID = new PublicKey('CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC');
const USDC_MINT = new PublicKey('Cx2bfKM7hcpnreSZxiDaN8q4Ca9i5ViCLxqRTs12JhS5');
const NVUSDC_MINT = new PublicKey('2TmaUey4Hh2om1kFR77Vw1RDh8H69qcW6UAACVidJeVk');
const BURN_ENGINE_PROGRAM = new PublicKey('nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id');
const STAKING_MANAGER_PROGRAM = new PublicKey('HjxcKV51A7jxE2iqMCDY7EvWFL9XsheuM43DamWGabqb');
const BURN_VAULT_USDC = new PublicKey('5gXoi3aqnomJiCZkE6ta5T7tJKNvW9GfNrfHEncsLnna');

const SOL_FEED_HEX = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';
const HERMES_URL = 'https://pyth.dourolabs.app/hermes/v2/updates/price/latest';

const TREASURY_ID = 0;
const SUB_ID = Number(process.env.PYTH_E2E_SUB_ID ?? 0);

// 1x long: $1 notional backed by $1 of nvscUSDC collateral (both 1e6-scaled).
const COLLATERAL_USDC = 1_000_000n;

const COMPUTE_UNITS = 600_000;
const CLOSE_WAIT_MS = 3_000;
const TX_ATTEMPTS = 4;
const ALT_CACHE_PATH = path.join(ROOT, '.cache/pyth-e2e-alt-devnet.json');

// The Pyth Receiver's post_update_atomic enforces a 3-signature floor
// (InsufficientGuardianSignatures with fewer), so the VAA must carry 3.
const PYTH_GUARDIAN_SIGNATURES = 3;

// ── Pyth JIT plumbing (mirrors jitOracle.ts) ────────────────────────────────

function loadKeypair(filePath: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(filePath, 'utf-8'))));
}

/**
 * Hand-rolled Borsh encoder for pythnet-sdk's `MerklePriceUpdate` struct
 * (`{ message: PrefixedVec<u16,u8>, proof: MerklePath<Keccak160> }`). Its Borsh
 * derive falls back to the plain field-by-field layout — u32-LE length prefixes
 * on both inner Vecs (see jitOracle.ts::encodeMerklePriceUpdate).
 */
function encodeMerklePriceUpdate(message: Buffer, proof: number[][]): Buffer {
  const msgLen = Buffer.alloc(4);
  msgLen.writeUInt32LE(message.length, 0);
  const proofLen = Buffer.alloc(4);
  proofLen.writeUInt32LE(proof.length, 0);
  return Buffer.concat([msgLen, message, proofLen, ...proof.map((node) => Buffer.from(node))]);
}

/** Pyth V1 price-feed message layout (big-endian network byte order):
 *  price i64 @33..41, expo i32 @49..53, publish_time i64 @53..61. */
function readPublishTime(msg: Buffer): number {
  return Number(msg.readBigInt64BE(53));
}

function readDisplayPrice(msg: Buffer): number {
  const raw = msg.readBigInt64BE(33);
  const expo = msg.readInt32BE(49);
  return Number(raw) * Math.pow(10, expo);
}

async function fetchRetry(url: string, attempts = 5, delayMs = 1500): Promise<Response> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetch(url);
    } catch (e) {
      lastErr = e;
      if (i < attempts) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

export interface PythPriceUpdate {
  /** Guardian-signed (trimmed) Wormhole VAA — verified on-chain by the Receiver. */
  signedPricePayload: Buffer;
  /** Borsh-encoded MerklePriceUpdate carrying the price message + proof. */
  merklePriceUpdateBytes: Buffer;
  guardianSet: PublicKey;
  pythConfig: PublicKey;
  treasury: PublicKey;
  /** Unix seconds the on-chain freshness check measures against. */
  publishTime: number;
  /** Human-readable price for logging only. */
  displayPrice: number;
}

/**
 * Fetches a fresh guardian-signed SOL price update from Pyth's Hermes API and
 * derives everything update_price_feed needs to verify it on-chain. Re-polls
 * briefly when the newest sample is already older than 3s (heartbeat feeds can
 * lag during quiet periods) — same behavior as jitOracle.ts's
 * fetchFreshestJitPrice. Call immediately before building each transaction.
 */
export async function fetchPythPriceUpdate(feedHex: string): Promise<PythPriceUpdate> {
  const fetchOnce = async (): Promise<PythPriceUpdate> => {
    const res = await fetchRetry(`${HERMES_URL}?ids[]=${feedHex}&encoding=base64`);
    if (!res.ok) throw new Error(`Hermes fetch failed: ${res.status} ${res.statusText}`);
    const json: any = await res.json();
    const accumulator = parseAccumulatorUpdateData(Buffer.from(json.binary.data[0], 'base64'));
    const guardianSetIndex = getGuardianSetIndex(accumulator.vaa);
    // Trim to the on-chain minimum but never more than the VAA carries.
    const vaaSigCount = accumulator.vaa[5];
    const trimmedVaa = trimSignatures(accumulator.vaa, Math.min(PYTH_GUARDIAN_SIGNATURES, vaaSigCount));
    const update = accumulator.updates[0];
    const msg = Buffer.from(update.message);
    return {
      signedPricePayload: trimmedVaa,
      merklePriceUpdateBytes: encodeMerklePriceUpdate(msg, update.proof),
      guardianSet: getGuardianSetPda(guardianSetIndex, DEFAULT_WORMHOLE_PROGRAM_ID),
      pythConfig: getConfigPda(DEFAULT_RECEIVER_PROGRAM_ID),
      treasury: getTreasuryPda(TREASURY_ID, DEFAULT_RECEIVER_PROGRAM_ID),
      publishTime: readPublishTime(msg),
      displayPrice: readDisplayPrice(msg),
    };
  };

  const STALE_GUARD_TARGET_AGE_SECS = 3;
  let best = await fetchOnce();
  let ageSecs = Math.floor(Date.now() / 1000) - best.publishTime;
  for (let i = 0; i < 2 && ageSecs > STALE_GUARD_TARGET_AGE_SECS; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const next = await fetchOnce();
    if (next.publishTime > best.publishTime) best = next;
    ageSecs = Math.floor(Date.now() / 1000) - best.publishTime;
  }
  return best;
}

// ── Transaction plumbing (v0 + ALT, per e2e-core-trading-loop pattern) ──────

async function getOrCreateAlt(
  connection: Connection,
  payer: Keypair,
  addresses: PublicKey[]
): Promise<PublicKey> {
  const uniqueAddresses = Array.from(new Map(addresses.map((a) => [a.toBase58(), a])).values());

  if (fs.existsSync(ALT_CACHE_PATH)) {
    const cached = new PublicKey(JSON.parse(fs.readFileSync(ALT_CACHE_PATH, 'utf-8')).address);
    const info = await connection.getAddressLookupTable(cached);
    if (info.value && uniqueAddresses.every((a) => info.value!.state.addresses.some((b) => b.equals(a)))) {
      return cached;
    }
  }

  const slot = await connection.getSlot();
  const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot,
  });
  const chunkSize = 20;
  const chunks: PublicKey[][] = [];
  for (let i = 0; i < uniqueAddresses.length; i += chunkSize) {
    chunks.push(uniqueAddresses.slice(i, i + chunkSize));
  }
  const extendIxs = chunks.map((chunk) =>
    AddressLookupTableProgram.extendLookupTable({
      payer: payer.publicKey,
      authority: payer.publicKey,
      lookupTable: altAddress,
      addresses: chunk,
    })
  );

  // Send create in its own transaction (avoids 1232-byte limit)
  const createMsg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    instructions: [createIx],
  }).compileToV0Message();
  const createTx = new VersionedTransaction(createMsg);
  createTx.sign([payer]);
  const createSig = await connection.sendTransaction(createTx);
  await connection.confirmTransaction(createSig, 'confirmed');
  console.log('Created ALT:', altAddress.toBase58(), createSig);

  // Send extend instructions one per transaction (each extend with 20 addresses
  // uses ~652 bytes of instruction data — multiple in one tx exceeds 1232 limit)
  for (let i = 0; i < extendIxs.length; i++) {
    const extMsg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
      instructions: [extendIxs[i]],
    }).compileToV0Message();
    const extTx = new VersionedTransaction(extMsg);
    extTx.sign([payer]);
    const extSig = await connection.sendTransaction(extTx);
    await connection.confirmTransaction(extSig, 'confirmed');
    console.log(`  Extended ALT ${i + 1}/${extendIxs.length}`);
  }

  fs.mkdirSync(path.dirname(ALT_CACHE_PATH), { recursive: true });
  fs.writeFileSync(ALT_CACHE_PATH, JSON.stringify({ address: altAddress.toBase58() }));

  // ALTs activate one slot after creation.
  console.log('Waiting for ALT to activate...');
  await new Promise((r) => setTimeout(r, 3000));
  return altAddress;
}

/**
 * Builds + signs + sends a fresh atomic feed-path transaction each attempt
 * (`buildTxs` re-fetches the price so every retry carries a brand-new VAA and
 * a brand-new ephemeral price_update_account). Checks the ACTUAL on-chain
 * result — a tx can submit cleanly yet revert (e.g. OracleStale), which looks
 * like success unless you inspect `.err` (as the devnet e2e scripts do).
 */
async function sendFeedTxWithRetry(
  connection: Connection,
  payer: Keypair,
  buildTxs: () => Promise<{ updateIx: any; tradeIx: any; priceUpdateAccount: Keypair }>,
  altAddress: PublicKey,
  label: string,
  attempts = TX_ATTEMPTS
): Promise<string> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      // A fresh VAA + a fresh ephemeral price_update_account every attempt
      // (same as jitOracle.ts's retry loop — avoids create-account collisions).
      const { updateIx, tradeIx, priceUpdateAccount } = await buildTxs();
      const altInfo = (await connection.getAddressLookupTable(altAddress)).value!;
      const msg = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
          updateIx,
          tradeIx,
        ],
      }).compileToV0Message([altInfo]);
      const tx = new VersionedTransaction(msg);
      tx.sign([payer, priceUpdateAccount]);
      console.log(`  serialized ${label} tx size:`, tx.serialize().length, 'bytes');
      const sig = await connection.sendTransaction(tx, { skipPreflight: false });
      const result = await connection.confirmTransaction(sig, 'confirmed');
      if (!result.value.err) return sig;
      lastErr = new Error(`${label} reverted on-chain: ${JSON.stringify(result.value.err)} sig=${sig}`);
    } catch (e) {
      lastErr = e;
    }
    console.log(`  ${label} attempt ${i}/${attempts} failed, retrying with a fresh price...`);
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw lastErr;
}

async function readAmount(connection: Connection, ata: PublicKey): Promise<bigint> {
  try {
    return (await getAccount(connection, ata)).amount;
  } catch {
    return 0n;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // 1) Connect to devnet with the deployer wallet (Anchor.toml [provider]).
  const deployer = loadKeypair(path.join(require('os').homedir(), '.config/solana/new-id.json'));
  const connection = new Connection(RPC, 'confirmed');
  const provider = new AnchorProvider(connection, new Wallet(deployer), { commitment: 'confirmed' });
  anchor.setProvider(provider);
  console.log('RPC:', RPC);
  console.log('Deployer:', deployer.publicKey.toBase58());

  // 2) Load position-tracker + nv-usdc-vault programs.
  const pt = new Program<PositionTracker>(
    JSON.parse(fs.readFileSync(path.join(ROOT, 'target/idl/position_tracker.json'), 'utf-8')),
    provider
  );
  const nvProgram = new Program(
    JSON.parse(fs.readFileSync(path.join(ROOT, 'target/idl/nv_usdc_vault.json'), 'utf-8')),
    provider
  );

  // PDAs.
  const feedId = Buffer.from(SOL_FEED_HEX, 'hex');
  const [ptConfig] = PublicKey.findProgramAddressSync([Buffer.from('pt-config')], PT_PROGRAM_ID);
  const [market] = PublicKey.findProgramAddressSync([Buffer.from('market'), feedId], PT_PROGRAM_ID);
  const [priceFeed] = PublicKey.findProgramAddressSync([Buffer.from('price-feed'), market.toBuffer()], PT_PROGRAM_ID);
  const [settlementVault] = PublicKey.findProgramAddressSync([Buffer.from('settlement-vault')], PT_PROGRAM_ID);
  const [insuranceVault] = PublicKey.findProgramAddressSync([Buffer.from('insurance-vault')], PT_PROGRAM_ID);
  const [position] = PublicKey.findProgramAddressSync(
    [Buffer.from('position'), deployer.publicKey.toBuffer(), market.toBuffer(), Buffer.from([SUB_ID])],
    PT_PROGRAM_ID
  );
  const [collateralVault] = PublicKey.findProgramAddressSync([Buffer.from('collateral-vault'), position.toBuffer()], PT_PROGRAM_ID);
  const [vaultConfig] = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-config'), USDC_MINT.toBuffer()], NV_VAULT_PROGRAM_ID);
  const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-authority'), USDC_MINT.toBuffer()], NV_VAULT_PROGRAM_ID);
  const [userVaultState] = PublicKey.findProgramAddressSync(
    [Buffer.from('user-vault-state'), ptConfig.toBuffer(), vaultConfig.toBuffer()],
    NV_VAULT_PROGRAM_ID
  );
  const [burnState] = PublicKey.findProgramAddressSync([Buffer.from('burn_state')], BURN_ENGINE_PROGRAM);
  const [stakingFeePool] = PublicKey.findProgramAddressSync([Buffer.from('staking-fee-pool')], STAKING_MANAGER_PROGRAM);
  const [stakingFeeVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('staking-fee-pool'), Buffer.from('vault')],
    STAKING_MANAGER_PROGRAM
  );
  const [stakeAccount] = PublicKey.findProgramAddressSync([Buffer.from('stake'), deployer.publicKey.toBuffer()], STAKING_MANAGER_PROGRAM);

  const traderNvusdc = await getOrCreateAssociatedTokenAccount(connection, deployer, NVUSDC_MINT, deployer.publicKey);
  const traderUsdc = await getOrCreateAssociatedTokenAccount(connection, deployer, USDC_MINT, deployer.publicKey);

  const vaultCfg: any = await (nvProgram.account as any).vaultConfig.fetch(vaultConfig);
  const vaultUsdc: PublicKey = vaultCfg.vaultUsdc;
  const totalAssets = BigInt(vaultCfg.totalAssets.toString());
  const totalShares = BigInt(vaultCfg.totalShares.toString());
  if (totalAssets === 0n || totalShares === 0n) throw new Error('Vault is empty — nothing to price collateral against.');

  // Ceiling division: guarantee redeemable value >= COLLATERAL_USDC even when NAV > 1.
  const collateralShares =
    (COLLATERAL_USDC * totalShares + totalAssets - 1n) / totalAssets;

  const navMicros = (totalAssets * 1_000_000n) / totalShares;
  console.log(`nvscUSDC NAV: ${(Number(navMicros) / 1e6).toFixed(6)} | collateral: ${COLLATERAL_USDC} USDC -> ${collateralShares} shares`);

  const nvusdcBalance = await readAmount(connection, traderNvusdc.address);
  console.log(`Trader nvscUSDC balance: ${nvusdcBalance}`);
  if (nvusdcBalance < collateralShares) {
    throw new Error(
      `Insufficient nvscUSDC (${nvusdcBalance}) — need at least ${collateralShares}. Mint some first (e2e-mint-vault-devnet.ts).`
    );
  }

  const existing = await connection.getAccountInfo(position);
  if (existing) {
    throw new Error(
      `Sub-id ${SUB_ID} already has an open/closed position on the SOL market. Set PYTH_E2E_SUB_ID=<n> and rerun.`
    );
  }

  // ALT covering every constant account across BOTH transactions.
  const altAddress = await getOrCreateAlt(connection, deployer, [
    ptConfig, market, priceFeed, vaultConfig, vaultAuthority, vaultUsdc,
    NV_VAULT_PROGRAM_ID, NVUSDC_MINT, USDC_MINT, settlementVault, insuranceVault,
    TOKEN_PROGRAM_ID, SystemProgram.programId, DEFAULT_RECEIVER_PROGRAM_ID,
    position, collateralVault, traderNvusdc.address, traderUsdc.address, userVaultState,
    BURN_ENGINE_PROGRAM, burnState, BURN_VAULT_USDC, STAKING_MANAGER_PROGRAM,
    stakingFeePool, stakingFeeVault, stakeAccount,
    ...nettingRemainingAccounts(deployer.publicKey).map((a) => a.pubkey),
  ]);

  const balancesBefore = {
    nvusdc: nvusdcBalance,
    usdc: await readAmount(connection, traderUsdc.address),
  };
  console.log('Balances before:', {
    nvusdc: balancesBefore.nvusdc.toString(),
    usdc: balancesBefore.usdc.toString(),
  });

  const buildUpdateIx = async (jit: PythPriceUpdate, priceUpdateAccount: PublicKey) =>
    (pt.methods as any)
      .updatePriceFeed(jit.signedPricePayload, jit.merklePriceUpdateBytes, TREASURY_ID)
      .accounts({
        caller: deployer.publicKey,
        ptConfig,
        market,
        priceFeed,
        priceUpdateAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .remainingAccounts([
        // [guardian_set, pyth_config, treasury, pyth_receiver]
        { pubkey: jit.guardianSet, isSigner: false, isWritable: false },
        { pubkey: jit.pythConfig, isSigner: false, isWritable: false },
        { pubkey: jit.treasury, isSigner: false, isWritable: true },
        { pubkey: DEFAULT_RECEIVER_PROGRAM_ID, isSigner: false, isWritable: false },
      ])
      .instruction();

  // 3) Fetch a fresh Pyth price update for SOL...
  const openJit = await fetchPythPriceUpdate(SOL_FEED_HEX);
  console.log(`\nSOL/USD (Pyth): $${openJit.displayPrice.toFixed(4)} (publish_time age ${Math.floor(Date.now() / 1000) - openJit.publishTime}s)`);

  // 4) ...and open the 1x long atomically: update_price_feed +
  //    open_position_from_feed in ONE transaction.
  console.log('\n1) Opening 1x long via update_price_feed + open_position_from_feed...');
  const openSig = await sendFeedTxWithRetry(
    connection,
    deployer,
    async () => {
      const jit = await fetchPythPriceUpdate(SOL_FEED_HEX);
      const priceUpdateAccount = Keypair.generate();
      const updateIx = await buildUpdateIx(jit, priceUpdateAccount.publicKey);
      const tradeIx = await (pt.methods as any)
        .openPositionFromFeed(SUB_ID, true, new BN(COLLATERAL_USDC.toString()), new BN(collateralShares.toString()), 0, null, null)
        .accounts({
          trader: deployer.publicKey,
          ptConfig,
          market,
          nvusdcMint: NVUSDC_MINT,
          position,
          collateralVault,
          priceFeed,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .remainingAccounts([
          // [0..6] nv-vault infra
          { pubkey: vaultConfig, isSigner: false, isWritable: true },
          { pubkey: vaultAuthority, isSigner: false, isWritable: false },
          { pubkey: vaultUsdc, isSigner: false, isWritable: true },
          { pubkey: NV_VAULT_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: settlementVault, isSigner: false, isWritable: true },
          { pubkey: traderNvusdc.address, isSigner: false, isWritable: true },
          { pubkey: userVaultState, isSigner: false, isWritable: true },
          // [7..14] fee split
          { pubkey: BURN_ENGINE_PROGRAM, isSigner: false, isWritable: false },
          { pubkey: burnState, isSigner: false, isWritable: true },
          { pubkey: BURN_VAULT_USDC, isSigner: false, isWritable: true },
          { pubkey: STAKING_MANAGER_PROGRAM, isSigner: false, isWritable: false },
          { pubkey: stakingFeePool, isSigner: false, isWritable: true },
          { pubkey: stakingFeeVault, isSigner: false, isWritable: true },
          { pubkey: stakeAccount, isSigner: false, isWritable: false },
          // [14..19] netting engine
          ...nettingRemainingAccounts(deployer.publicKey),
        ])
        .instruction();
      return { updateIx, tradeIx, priceUpdateAccount };
    },
    altAddress,
    'open'
  );
  console.log('  open tx:', openSig);

  const posAfterOpen: any = await (pt.account as any).position.fetch(position);
  console.log('  Position on-chain:', {
    side: posAfterOpen.isLong ? 'LONG' : 'SHORT',
    entryPrice: posAfterOpen.entryPrice.toString(),
    sizeUsdc: posAfterOpen.sizeUsdc.toString(),
    collateralShares: posAfterOpen.collateralShares.toString(),
  });
  const nvusdcAfterOpen = await readAmount(connection, traderNvusdc.address);
  console.log(`  nvscUSDC locked into collateral vault: ${(balancesBefore.nvusdc - nvusdcAfterOpen).toString()} shares`);

  // 5) Wait 3 seconds.
  console.log(`\nWaiting ${CLOSE_WAIT_MS / 1000}s...`);
  await new Promise((r) => setTimeout(r, CLOSE_WAIT_MS));

  // 6) Fetch another Pyth price update...
  const closeJit = await fetchPythPriceUpdate(SOL_FEED_HEX);
  console.log(`\nSOL/USD (Pyth): $${closeJit.displayPrice.toFixed(4)} (publish_time age ${Math.floor(Date.now() / 1000) - closeJit.publishTime}s)`);

  // 7) ...and close the position atomically: update_price_feed +
  //    close_position_from_feed in ONE transaction.
  console.log('\n2) Closing via update_price_feed + close_position_from_feed...');
  const closeSig = await sendFeedTxWithRetry(
    connection,
    deployer,
    async () => {
      const jit = await fetchPythPriceUpdate(SOL_FEED_HEX);
      const priceUpdateAccount = Keypair.generate();
      const updateIx = await buildUpdateIx(jit, priceUpdateAccount.publicKey);
      const tradeIx = await (pt.methods as any)
        .closePositionFromFeed(SUB_ID)
        .accounts({
          trader: deployer.publicKey,
          ptConfig,
          market,
          position,
          collateralVault,
          traderNvusdc: traderNvusdc.address,
          traderUsdc: traderUsdc.address,
          priceFeed,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .remainingAccounts([
          // [0..6] nv-vault infra (close-specific layout: trader_nvusdc stays
          // a named account, so [5] is user_vault_state and [6] nvusdc_mint)
          { pubkey: vaultConfig, isSigner: false, isWritable: true },
          { pubkey: vaultAuthority, isSigner: false, isWritable: false },
          { pubkey: vaultUsdc, isSigner: false, isWritable: true },
          { pubkey: NV_VAULT_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: settlementVault, isSigner: false, isWritable: true },
          { pubkey: userVaultState, isSigner: false, isWritable: true },
          { pubkey: NVUSDC_MINT, isSigner: false, isWritable: true },
          // [7..14] fee split
          { pubkey: BURN_ENGINE_PROGRAM, isSigner: false, isWritable: false },
          { pubkey: burnState, isSigner: false, isWritable: true },
          { pubkey: BURN_VAULT_USDC, isSigner: false, isWritable: true },
          { pubkey: STAKING_MANAGER_PROGRAM, isSigner: false, isWritable: false },
          { pubkey: stakingFeePool, isSigner: false, isWritable: true },
          { pubkey: stakingFeeVault, isSigner: false, isWritable: true },
          { pubkey: stakeAccount, isSigner: false, isWritable: false },
          // [14..19] netting engine
          ...nettingRemainingAccounts(deployer.publicKey),
          // [19] insurance vault (CCP first-loss waterfall layer)
          { pubkey: insuranceVault, isSigner: false, isWritable: true },
        ])
        .instruction();
      return { updateIx, tradeIx, priceUpdateAccount };
    },
    altAddress,
    'close'
  );
  console.log('  close tx:', closeSig);

  // 8) Results.
  const positionClosed = !(await connection.getAccountInfo(position));
  const collateralVaultClosed = !(await connection.getAccountInfo(collateralVault));
  const balancesAfter = {
    nvusdc: await readAmount(connection, traderNvusdc.address),
    usdc: await readAmount(connection, traderUsdc.address),
  };
  const pnlUsdc = balancesAfter.usdc - balancesBefore.usdc;
  const priceDeltaPct = ((closeJit.displayPrice - openJit.displayPrice) / openJit.displayPrice) * 100;

  console.log('\n===== RESULTS =====');
  console.log('open tx:              ', openSig);
  console.log('close tx:             ', closeSig);
  console.log('entry (Pyth):         ', `$${openJit.displayPrice.toFixed(4)}`);
  console.log('exit (Pyth):          ', `$${closeJit.displayPrice.toFixed(4)}`, `(${priceDeltaPct >= 0 ? '+' : ''}${priceDeltaPct.toFixed(4)}%)`);
  console.log('position closed:      ', positionClosed, '| collateral_vault closed:', collateralVaultClosed);
  console.log('USDC settled back:    ', pnlUsdc.toString(), `(entry fee + exit fee were split to burn/staking)`);
  console.log('nvscUSDC delta:       ', (balancesAfter.nvusdc - balancesBefore.nvusdc).toString(), 'shares');

  if (!positionClosed || !collateralVaultClosed) {
    throw new Error('Position or collateral vault still alive after close.');
  }

  console.log('\nSUCCESS: Pyth-only open→close loop passed (update_price_feed + *_from_feed).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
