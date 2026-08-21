/**
 * Live devnet proof of the rewritten position-tracker's core requirements:
 *  1. JIT oracle pull — fetches a REAL guardian-signed Pyth Hermes price
 *     update for SOL/USD and has open_position_jit verify it on-chain via
 *     CPI into the real Pyth Receiver program, in the same instruction.
 *  2. Double-yield margin — opens against live nvscUSDC NAV read from
 *     nv-usdc-vault, then closes and settles PnL.
 *
 * Uses a v0 versioned transaction + Address Lookup Table: the JIT accounts
 * (16 pubkeys) plus a size-reduced VAA don't fit in a legacy 1232-byte
 * transaction otherwise (measured: 1541 bytes). Every account here except
 * `trader`/`position`/`collateral_vault`/`trader_nvusdc`/`price_update_account`
 * is constant across every call, so they're the ones worth putting in the ALT.
 *
 * Run: npx tsx scripts/e2e-jit-open-close-devnet.ts
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
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
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
const BURN_ENGINE_PROGRAM = new PublicKey('nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id');
const STAKING_MANAGER_PROGRAM_ID = new PublicKey('4VDQjH73DiE3zYt66ukyWY7KMMJrxHUZfjkxRHTPDG75');
const SOL_FEED_HEX = process.env.JIT_FEED_HEX || 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';
const CYCLES = Number(process.env.JIT_CYCLES || '1');
const SUB_ID = Number(process.env.JIT_SUB_ID || '0');
const TREASURY_ID = 0;
const ALT_CACHE_PATH = path.join(ROOT, '.cache/jit-alt-devnet.json');

// The Pyth Receiver's post_update_atomic enforces a 3-signature floor
// (InsufficientGuardianSignatures with fewer), so the VAA must carry 3.
const JIT_GUARDIAN_SIGNATURES = 3;

function loadKeypair(filePath: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(filePath, 'utf-8'))));
}

/**
 * Hand-rolled Borsh encoder for pythnet-sdk's `MerklePriceUpdate` struct
 * (`{ message: PrefixedVec<u16,u8>, proof: MerklePath<Keccak160> }`).
 * Its Borsh derive falls back to the plain field-by-field layout
 * (PhantomData<L> serializes as zero bytes; both PrefixedVec's and
 * MerklePath's inner Vec use Borsh's native u32-LE length prefix, confirmed
 * against pythnet-sdk's own `test_borsh_roundtrip` unit test) — NOT the
 * generic-parameterized length its name implies. We can't use Anchor's TS
 * BorshCoder for this because the vendored Pyth Receiver IDL predates the
 * current IDL spec and fails to parse in this anchor version.
 */
function encodeMerklePriceUpdate(message: Buffer, proof: number[][]): Buffer {
  const msgLen = Buffer.alloc(4);
  msgLen.writeUInt32LE(message.length, 0);
  const proofLen = Buffer.alloc(4);
  proofLen.writeUInt32LE(proof.length, 0);
  const proofBytes = proof.map((node) => Buffer.from(node));
  return Buffer.concat([msgLen, message, proofLen, ...proofBytes]);
}

async function fetchJitPriceArgs() {
  const res = await fetch(
    `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${SOL_FEED_HEX}&encoding=base64`
  );
  const json: any = await res.json();
  const binary = json.binary.data[0] as string;
  const accumulatorUpdateData = parseAccumulatorUpdateData(Buffer.from(binary, 'base64'));
  const guardianSetIndex = getGuardianSetIndex(accumulatorUpdateData.vaa);
  const vaaSigCount = accumulatorUpdateData.vaa[5];
  const trimmedVaa = trimSignatures(accumulatorUpdateData.vaa, Math.min(JIT_GUARDIAN_SIGNATURES, vaaSigCount));
  const update = accumulatorUpdateData.updates[0];

  const merkleBytes = encodeMerklePriceUpdate(Buffer.from(update.message), update.proof);
  const guardianSet = getGuardianSetPda(guardianSetIndex, DEFAULT_WORMHOLE_PROGRAM_ID);
  const config = getConfigPda(DEFAULT_RECEIVER_PROGRAM_ID);
  const treasury = getTreasuryPda(TREASURY_ID, DEFAULT_RECEIVER_PROGRAM_ID);

  return { signedPricePayload: trimmedVaa, merklePriceUpdateBytes: merkleBytes, guardianSet, config, treasury };
}

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
  const extendIx = AddressLookupTableProgram.extendLookupTable({
    payer: payer.publicKey,
    authority: payer.publicKey,
    lookupTable: altAddress,
    addresses: uniqueAddresses,
  });

  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    instructions: [createIx, extendIx],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([payer]);
  const sig = await connection.sendTransaction(tx);
  await connection.confirmTransaction(sig, 'confirmed');
  console.log('Created ALT:', altAddress.toBase58(), sig);

  fs.mkdirSync(path.dirname(ALT_CACHE_PATH), { recursive: true });
  fs.writeFileSync(ALT_CACHE_PATH, JSON.stringify({ address: altAddress.toBase58() }));

  // ALTs must warm up for one slot before they can be used in a transaction.
  console.log('Waiting for ALT to activate...');
  await new Promise((r) => setTimeout(r, 3000));
  return altAddress;
}

async function sendV0(
  connection: Connection,
  payer: Keypair,
  extraSigners: Keypair[],
  instructions: anchor.web3.TransactionInstruction[],
  altAddress: PublicKey
): Promise<string> {
  const altInfo = (await connection.getAddressLookupTable(altAddress)).value!;
  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    instructions,
  }).compileToV0Message([altInfo]);
  const tx = new VersionedTransaction(msg);
  tx.sign([payer, ...extraSigners]);
  console.log('  serialized tx size:', tx.serialize().length, 'bytes');
  const sig = await connection.sendTransaction(tx, { skipPreflight: false });
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
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

  const [ptConfig] = PublicKey.findProgramAddressSync([Buffer.from('pt-config')], pt.programId);
  const feedId = Buffer.from(SOL_FEED_HEX, 'hex');
  const [market] = PublicKey.findProgramAddressSync([Buffer.from('market'), feedId], pt.programId);
  const [position] = PublicKey.findProgramAddressSync(
    [Buffer.from('position'), trader.publicKey.toBuffer(), market.toBuffer(), Buffer.from([SUB_ID])],
    pt.programId
  );
  const [collateralVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('collateral-vault'), position.toBuffer()],
    pt.programId
  );
  const [vaultConfig] = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-config'), USDC_MINT.toBuffer()], NV_VAULT_PROGRAM);
  const [burnState] = PublicKey.findProgramAddressSync([Buffer.from('burn_state')], BURN_ENGINE_PROGRAM);
  const burnVaultUsdc = getAssociatedTokenAddressSync(USDC_MINT, burnState, true);
  const [stakingFeePool] = PublicKey.findProgramAddressSync([Buffer.from('staking-fee-pool')], STAKING_MANAGER_PROGRAM_ID);
  const [stakingFeeVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('staking-fee-pool'), Buffer.from('vault')],
    STAKING_MANAGER_PROGRAM_ID
  );
  const [stakeAccount] = PublicKey.findProgramAddressSync([Buffer.from('stake'), trader.publicKey.toBuffer()], STAKING_MANAGER_PROGRAM_ID);
  const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from('nv-vault-authority'), USDC_MINT.toBuffer()], NV_VAULT_PROGRAM);
  const [settlementVault] = PublicKey.findProgramAddressSync([Buffer.from('settlement-vault')], pt.programId);
  const [insuranceVault] = PublicKey.findProgramAddressSync([Buffer.from('insurance-vault')], pt.programId);
  const vaultCfg: any = await (nvProgram.account as any).vaultConfig.fetch(vaultConfig);
  const vaultUsdc: PublicKey = vaultCfg.vaultUsdc;

  const traderNvusdc = await getOrCreateAssociatedTokenAccount(connection, trader, NVUSDC_MINT, trader.publicKey);
  const traderUsdc = await getOrCreateAssociatedTokenAccount(connection, trader, USDC_MINT, trader.publicKey);

  const existing = await connection.getAccountInfo(position);
  if (existing) {
    console.log('Position already open for this trader/market — run close first, or use a fresh test wallet.');
    process.exit(1);
  }

  console.log('Fetching live Pyth Hermes VAA...');
  const jit1 = await fetchJitPriceArgs();

  const constantAccounts = [
    ptConfig,
    market,
    vaultConfig,
    NV_VAULT_PROGRAM,
    NVUSDC_MINT,
    vaultAuthority,
    vaultUsdc,
    settlementVault,
    TOKEN_PROGRAM_ID,
    SystemProgram.programId,
    position,
    collateralVault,
    traderNvusdc.address,
    // Fee-split accounts (now in remaining_accounts but still in ALT for size)
    BURN_ENGINE_PROGRAM,
    burnState,
    burnVaultUsdc,
    STAKING_MANAGER_PROGRAM_ID,
    stakingFeePool,
    stakingFeeVault,
    stakeAccount,
    // Pyth accounts (now in remaining_accounts)
    jit1.guardianSet,
    jit1.config,
    jit1.treasury,
    DEFAULT_RECEIVER_PROGRAM_ID,
    // Netting-engine accounts (remaining_accounts[11..16])
    ...nettingRemainingAccounts(trader.publicKey).map((a) => a.pubkey),
  ];
  const altAddress = await getOrCreateAlt(connection, trader, constantAccounts);

  const logVaultAssets = async (label: string) => {
    const cfg: any = await (nvProgram.account as any).vaultConfig.fetch(vaultConfig);
    console.log(`vault_config.total_assets ${label}: ${cfg.totalAssets.toString()}`);
    return cfg.totalAssets as BN;
  };

  for (let cycle = 1; cycle <= CYCLES; cycle++) {
    console.log(`\n===== Cycle ${cycle}/${CYCLES} =====`);
    const assetsBeforeOpen = await logVaultAssets('BEFORE open');
    // Always fetch fresh right before submitting — the 3s JIT ceiling is
    // strict, and any delay (ALT warmup, RPC round trips) between fetching
    // and landing on-chain can blow past it.
    const jitOpen = await fetchJitPriceArgs();
    const priceUpdateAccount1 = Keypair.generate();
    const sizeUsdc = new BN(10_000_000); // $10 notional
    const collateralShares = new BN(2_000_000); // 2 nvscUSDC shares (~$2, well above the 50x min margin of $0.20)

    console.log('Opening position via open_position_jit (real JIT-verified price)...');
    const openIx = await pt.methods
      .openPositionJit(SUB_ID, true, sizeUsdc, collateralShares, 0, null, null, jitOpen.signedPricePayload, jitOpen.merklePriceUpdateBytes, TREASURY_ID)
      .accounts({
        trader: trader.publicKey,
        ptConfig,
        market,
        vaultConfig,
        vaultAuthority,
        vaultUsdc,
        nvUsdcVaultProgram: NV_VAULT_PROGRAM,
        nvusdcMint: NVUSDC_MINT,
        settlementVault,
        position,
        collateralVault,
        traderNvusdc: traderNvusdc.address,
        priceUpdateAccount: priceUpdateAccount1.publicKey,
        // The trading-fee sweep redeems on behalf of pt_config (user = pt_config
        // in the vault CPI), so user_vault_state must be derived from pt_config.
        userVaultState: PublicKey.findProgramAddressSync(
          [Buffer.from('user-vault-state'), ptConfig.toBuffer(), vaultConfig.toBuffer()],
          NV_VAULT_PROGRAM
        )[0],
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .remainingAccounts([
        // [0..6] fee-split accounts
        { pubkey: BURN_ENGINE_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: burnState, isSigner: false, isWritable: true },
        { pubkey: burnVaultUsdc, isSigner: false, isWritable: true },
        { pubkey: STAKING_MANAGER_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: stakingFeePool, isSigner: false, isWritable: true },
        { pubkey: stakingFeeVault, isSigner: false, isWritable: true },
        { pubkey: stakeAccount, isSigner: false, isWritable: false },
        // [7..10] Pyth accounts
        { pubkey: jitOpen.guardianSet, isSigner: false, isWritable: false },
        { pubkey: jitOpen.config, isSigner: false, isWritable: false },
        { pubkey: jitOpen.treasury, isSigner: false, isWritable: true },
        { pubkey: DEFAULT_RECEIVER_PROGRAM_ID, isSigner: false, isWritable: false },
        // [11..15] netting-engine accounts
        ...nettingRemainingAccounts(trader.publicKey),
      ])
      .instruction();

    const openSig = await sendV0(connection, trader, [priceUpdateAccount1], [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), openIx], altAddress);
    console.log('open_position_jit() tx:', openSig);

    const positionAccount: any = await (pt.account as any).position.fetch(position);
    console.log('Position on-chain:', {
      entryPrice: positionAccount.entryPrice.toString(),
      sizeUsdc: positionAccount.sizeUsdc.toString(),
      collateralShares: positionAccount.collateralShares.toString(),
      lockedMarginSnapshot: positionAccount.lockedMarginSnapshot.toString(),
    });
    const assetsAfterOpen = await logVaultAssets('AFTER open (entry fee should be swept in)');
    console.log(`  delta from entry fee: +${assetsAfterOpen.sub(assetsBeforeOpen).toString()}`);

    console.log('Fetching a fresh Pyth Hermes VAA to close the position...');
    const jit2 = await fetchJitPriceArgs();
    const priceUpdateAccount2 = Keypair.generate();

    console.log('Closing position via close_position (real JIT-verified exit price)...');
    const closeIx = await pt.methods
      .closePosition(SUB_ID, jit2.signedPricePayload, jit2.merklePriceUpdateBytes, TREASURY_ID)
      .accounts({
        trader: trader.publicKey,
        ptConfig,
        market,
        position,
        collateralVault,
        traderNvusdc: traderNvusdc.address,
        traderUsdc: traderUsdc.address,
        vaultConfig,
        vaultAuthority,
        vaultUsdc,
        nvusdcMint: NVUSDC_MINT,
        nvUsdcVaultProgram: NV_VAULT_PROGRAM,
        settlementVault,
        insuranceVault,
        priceUpdateAccount: priceUpdateAccount2.publicKey,
        guardianSet: jit2.guardianSet,
        pythConfig: jit2.config,
        treasury: jit2.treasury,
        pythReceiverProgram: DEFAULT_RECEIVER_PROGRAM_ID,
        userVaultState: PublicKey.findProgramAddressSync(
          [Buffer.from('user-vault-state'), ptConfig.toBuffer(), vaultConfig.toBuffer()],
          NV_VAULT_PROGRAM
        )[0],
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        burnEngineProgram: BURN_ENGINE_PROGRAM,
        burnState,
        burnVaultUsdc,
        stakingManagerProgram: STAKING_MANAGER_PROGRAM_ID,
        stakingFeePool,
        stakingFeeVault,
        stakeAccount,
      } as any)
      .remainingAccounts(nettingRemainingAccounts(trader.publicKey))
      .instruction();

    const closeSig = await sendV0(connection, trader, [priceUpdateAccount2], [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), closeIx], altAddress);
    console.log('close_position() tx:', closeSig);

    const afterClose = await connection.getAccountInfo(position);
    const vaultAfterClose = await connection.getAccountInfo(collateralVault);
    console.log('position closed:', !afterClose, '| collateral_vault closed:', !vaultAfterClose);
    const assetsAfterClose = await logVaultAssets('AFTER close (exit fee should be swept in too)');
    console.log(`  delta from exit fee: +${assetsAfterClose.sub(assetsAfterOpen).toString()}`);
    console.log(`  total delta this cycle: +${assetsAfterClose.sub(assetsBeforeOpen).toString()} (both fees combined)`);
  }

  console.log('\ne2e JIT open+close proof complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
