/**
 * Noviscia Institutional Sandbox Hub — Tier 1: local ledger provisioning.
 *
 * Boots an isolated `solana-test-validator` (local RPC only, no devnet), mints
 * fresh local USDC + NVSC (wSOL = native), funds an operator keypair, and
 * provisions a cold-start capacity-host asset registry exactly the way the
 * devnet cap-wire does (`e2e-asset-engine-capwire-devnet.ts`) but with the
 * C_sys / C_desk economics re-derived from the $10M reference pool.
 *
 * The capacity host binary (`target/deploy/noviscia_capacity.so`) is mounted
 * with `--bpf-program JDsM18…BaBiMc:<noviscia_capacity.so>` using the address
 * form, so the sandbox exposes the SAME canonical host address (`asset_*` +
 * `risk_*` handlers) as devnet and the Tier-1 ledger is byte-compatible with
 * the pools the Tier-2 stream simulates.
 *
 * Usage:
 *   npx tsx scripts/sandbox/provision-local-ledger.ts            # dry run
 *   npx tsx scripts/sandbox/provision-local-ledger.ts --apply    # create + provision
 *   npx tsx scripts/sandbox/provision-local-ledger.ts --up       # run validator only
 *
 * Requirement: `solana-test-validator`, `solana`, `spl-token` on PATH (solana
 * active-release install). The validator is spawned as a background child and
 * killed on script exit, so this is safe to run repeatedly.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';

import {
  USDC_MINT,
  NVSC_MINT,
  ASSET_ENGINE_PROGRAM_ID,
} from '../../sdk/src/ids';
import {
  registryPDA,
  assetPoolPDA,
  creditLinePDA,
  buildInitializeIx,
  buildRegisterAssetIx,
  buildSetAssetSupportIx,
  buildInitializeCreditLineIx,
  buildUpdateCreditLimitIx,
  buildUpdateAssetParamsIx,
  USDC_PROFILE,
  NVSC_PROFILE,
  WSOL_PROFILE,
} from '../../sdk/src/assetEngine';
import {
  referenceTvvParams,
  systemicCapUsdCents,
  deskCapUsdCents,
} from '../../sdk/src/economics';

const APPLY = process.argv.includes('--apply');
const UP_ONLY = process.argv.includes('--up');

const LOCAL_RPC = 'http://127.0.0.1:8899';
const VALIDATOR_LOG = path.join(process.cwd(), 'scripts/sandbox/validator.log');
const SANDBOX_DIR = path.join(process.cwd(), 'scripts/sandbox/.local-validator');

const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const PRICE_USD_CENTS = { USDC: 100n, WSOL: 15_000n, NVSC: 100n };

/** The enterprise (desk) keypair — a fresh local key reused across runs. */
function ensureOperatorKeypair(dir: string): Keypair {
  const p = path.join(dir, 'sandbox-operator.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (fs.existsSync(p)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf-8'))));
  const kp = Keypair.generate();
  fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const fmtUsd = (cents: bigint) =>
  `$${(Number(cents) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

function usdCentsToRaw(usdCents: bigint, decimals: number, priceCentsPerUnit: bigint): bigint {
  const scale = 10n ** BigInt(decimals);
  return (usdCents * scale) / priceCentsPerUnit;
}

/** The capacity host binary path — mounted at the canonical host address. */
const CAPACITY_SO = path.join(process.cwd(), 'target/deploy/noviscia_capacity.so');

/** Resolve the canonical capacity host address (guards that the .so exists). */
function loadProgramAddress(): PublicKey {
  if (!fs.existsSync(CAPACITY_SO)) throw new Error(`Capacity host binary not found at ${CAPACITY_SO}`);
  return ASSET_ENGINE_PROGRAM_ID;
}

function validatorAlive(): boolean {
  try {
    cp.execSync('solana cluster-version --url ' + LOCAL_RPC, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function startValidator(programId: PublicKey) {
  console.log('Starting isolated solana-test-validator…');
  const progMount = `${programId.toBase58()}:${CAPACITY_SO}`;
  fs.mkdirSync(SANDBOX_DIR, { recursive: true });
  const proc = cp.spawn(
    'solana-test-validator',
    [
      '--ledger', SANDBOX_DIR,
      '--bind-address', '127.0.0.1',
      '--rpc-port', '8899',
      '--faucet-port', '9900',
      '--quiet',
      '--bpf-program', progMount,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const out = fs.createWriteStream(VALIDATOR_LOG, { flags: 'a' });
  proc.stderr?.pipe(out);
  proc.stdout?.pipe(out);
  // Wait for the RPC to come up.
  for (let i = 0; i < 60; i++) {
    if (validatorAlive()) return proc;
    sleepSync(1000);
  }
  throw new Error('validator did not come up (see scripts/sandbox/validator.log)');
}

function sleepSync(ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* busy wait */
  }
}

async function readRegistry(connection: Connection) {
  const pda = registryPDA();
  const info = await connection.getAccountInfo(pda);
  if (!info) return null;
  const d = info.data;
  return {
    breaker: new PublicKey(d.subarray(8, 40)),
    riskCommittee: new PublicKey(d.subarray(40, 72)),
    upgrade: new PublicKey(d.subarray(72, 104)),
  };
}

async function readPool(connection: Connection, mint: PublicKey) {
  const pda = assetPoolPDA(mint);
  const info = await connection.getAccountInfo(pda);
  if (!info) return null;
  const d = info.data;
  return {
    decimals: d[137],
    supported: d[138] === 1,
    maxCapacity: d.readBigUInt64LE(167),
    activeCreditUtilization: d.readBigUInt64LE(147),
  };
}

async function readCreditLine(connection: Connection, institution: PublicKey) {
  const pda = creditLinePDA(institution);
  const info = await connection.getAccountInfo(pda);
  if (!info) return null;
  const d = info.data;
  return {
    authority: new PublicKey(d.subarray(40, 72)),
    totalCreditLimit: d.readBigUInt64LE(72),
    activeUtilization: d.readBigUInt64LE(80),
  };
}

async function main() {
  const programId = loadProgramAddress();
  const operator = ensureOperatorKeypair(SANDBOX_DIR);

  if (!validatorAlive()) {
    startValidator(programId);
  }
  const connection = new Connection(LOCAL_RPC, 'confirmed');

  console.log(`RPC:        ${LOCAL_RPC}`);
  console.log(`mode:       ${APPLY ? 'APPLY (sends transaction)' : 'DRY-RUN (validator up, nothing sent)'}${UP_ONLY ? ' / UP-ONLY' : ''}`);
  console.log(`program:    ${programId.toBase58()}`);
  console.log(`operator:   ${operator.publicKey.toBase58()}`);

  // 1. Airdrop the operator.
  if (!UP_ONLY) {
    const lamports = await connection.getBalance(operator.publicKey);
    if (lamports < LAMPORTS_PER_SOL) {
      console.log(`Airdropping ${LAMPORTS_PER_SOL / 1e9} SOL to operator…`);
      await connection.requestAirdrop(operator.publicKey, LAMPORTS_PER_SOL * 5);
      await sleep(800);
    }
  }

  const p = referenceTvvParams();
  const C_sys = systemicCapUsdCents(p);
  const C_desk = deskCapUsdCents(p);
  console.log(`\nDerived caps (reference $10M pool):`);
  console.log(`  C_sys  (aggregate credit line) ${fmtUsd(C_sys)}`);
  console.log(`  C_desk (per-asset max_capacity) ${fmtUsd(C_desk)}`);
  const desiredLimit = usdCentsToRaw(C_sys, USDC_PROFILE.decimals, PRICE_USD_CENTS.USDC);

  // 2. Create local mints (fresh USDC + NVSC; wSOL native).
  let usdcMint = USDC_MINT;
  let nvscMint = NVSC_MINT;
  if (!UP_ONLY) {
    console.log('\nLocal mints:');
    usdcMint = await createMint(connection, operator, operator.publicKey, null, USDC_PROFILE.decimals);
    console.log(`  USDC → ${usdcMint.toBase58()}`);
    nvscMint = await createMint(connection, operator, operator.publicKey, null, NVSC_PROFILE.decimals);
    console.log(`  NVSC → ${nvscMint.toBase58()}`);
    console.log(`  wSOL (native) → ${WSOL_MINT.toBase58()}`);

    // Fund the operator's ATAs so the local pools are real and funded.
    for (const [mint, decimals] of [
      [usdcMint, USDC_PROFILE.decimals],
      [nvscMint, NVSC_PROFILE.decimals],
    ] as [PublicKey, number][]) {
      const ata = await getOrCreateAssociatedTokenAccount(connection, operator, mint, operator.publicKey);
      await mintTo(connection, operator, mint, ata.address, operator, 10_000_000n * 10n ** BigInt(decimals));
    }
    console.log('  operator funded with 10,000,000 USDC + 10,000,000 NVSC');
  }

  // 3. Provision the registry (cold start) via the cap-wire instruction set.
  const assets = [
    { symbol: 'wSOL', mint: WSOL_MINT, profile: WSOL_PROFILE, priceCents: PRICE_USD_CENTS.WSOL },
    { symbol: 'USDC', mint: usdcMint, profile: USDC_PROFILE, priceCents: PRICE_USD_CENTS.USDC },
    { symbol: 'NVSC', mint: nvscMint, profile: NVSC_PROFILE, priceCents: PRICE_USD_CENTS.NVSC },
  ];

  const sendTx = async (label: string, ix: TransactionInstruction, signers: Keypair[]) => {
    console.log(`  … ${label}`);
    if (!APPLY) {
      console.log('    (dry-run — skipped)');
      return;
    }
    try {
      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [operator, ...signers.filter((s) => !s.publicKey.equals(operator.publicKey))]);
      console.log(`    ✓ sent ${sig}`);
      await sleep(150);
    } catch (e) {
      console.log(`    ✗ failed: ${(e as Error).message}`);
      fail += 1;
    }
  };

  if (!UP_ONLY) {
    const registry = await readRegistry(connection);
    if (!registry) {
      console.log('\nStep A — initialize registry (three-tier = operator, cold start):');
      await sendTx(
        'asset_initialize(wsol/usdc/nvsc)',
        buildInitializeIx(programId, {
          upgradeAuthority: operator.publicKey,
          breakerAuthority: operator.publicKey,
          riskCommitteeAuthority: operator.publicKey,
          wsolMint: WSOL_MINT,
          usdcMint: usdcMint,
          nvscMint: nvscMint,
        }),
        [operator]
      );
    }

    console.log('\nStep B — register assets (Tier-3):');
    for (const a of assets) {
      const pool = await readPool(connection, a.mint);
      if (!pool) {
        const desired = usdCentsToRaw(C_desk, a.profile.decimals, a.priceCents);
        await sendTx(`asset_register(${a.symbol}) maxCapacity=${desired}`, buildRegisterAssetIx(programId, operator.publicKey, a.mint, { ...a.profile, maxCapacity: desired }), [operator]);
      }
    }

    console.log('\nStep C — set asset support (Tier-2):');
    for (const a of assets) {
      const pool = await readPool(connection, a.mint);
      if (pool && !pool.supported) {
        await sendTx(`asset_set_support(${a.symbol}, true)`, buildSetAssetSupportIx(programId, operator.publicKey, a.mint, true), [operator]);
      }
    }

    console.log('\nStep D — aggregate credit line = C_sys (Tier-2):');
    const creditLine = await readCreditLine(connection, operator.publicKey);
    if (!creditLine) {
      await sendTx(`asset_initialize_credit_line(operator) C_sys=${desiredLimit}`, buildInitializeCreditLineIx(programId, operator.publicKey, operator.publicKey, desiredLimit), [operator]);
    }

    console.log('\nStep E — enforce per-asset C_desk (Tier-2):');
    for (const a of assets) {
      const pool = await readPool(connection, a.mint);
      const desired = usdCentsToRaw(C_desk, a.profile.decimals, a.priceCents);
      if (pool && pool.maxCapacity !== desired) {
        await sendTx(`asset_update_params(${a.symbol}) maxCapacity=${desired}`, buildUpdateAssetParamsIx(programId, operator.publicKey, a.mint, { ...a.profile, maxCapacity: desired }), [operator]);
      }
    }
  }

  // 4. Verification.
  if (!UP_ONLY) {
    console.log('\n=== VERIFICATION ===');
    const reg = await readRegistry(connection);
    check('registry initialized', !!reg);
    if (reg) {
      check('three-tier = operator (cold start)', reg.breaker.equals(operator.publicKey) && reg.riskCommittee.equals(operator.publicKey) && reg.upgrade.equals(operator.publicKey));
    }
    for (const a of assets) {
      const pool = await readPool(connection, a.mint);
      const desired = usdCentsToRaw(C_desk, a.profile.decimals, a.priceCents);
      if (!pool) {
        check(`pool(${a.symbol}) registered`, false, 'missing');
        continue;
      }
      check(`pool(${a.symbol}) registered`, true, `maxCapacity=${pool.maxCapacity}`);
      check(`pool(${a.symbol}) support`, pool.supported);
      check(`pool(${a.symbol}) max_capacity == C_desk ${desired}`, pool.maxCapacity === desired, `on-chain ${pool.maxCapacity}`);
    }
    const cl = await readCreditLine(connection, operator.publicKey);
    if (cl) {
      check('credit_line total == C_sys', cl.totalCreditLimit === desiredLimit, `on-chain ${cl.totalCreditLimit}`);
    } else {
      check('credit_line initialized', false, 'missing');
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    if (!APPLY) console.log('DRY-RUN complete — re-run with --apply to create + provision the ledger.');
  } else {
    console.log('\nValidator running. Kill via Ctrl-C or kill the sandbox-hub process group.');
    await new Promise(() => {}); // hold
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});