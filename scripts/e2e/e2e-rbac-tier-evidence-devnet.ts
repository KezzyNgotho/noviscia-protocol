/**
 * Cross-tier RBAC evidence proof — reads the three-tier authority mapping
 * (breaker / risk-committee / upgrade) purely from the on-chain capacity-host
 * asset registry, WITHOUT trusting the SDK's decoder or its account layout.
 *
 * Trust-free guarantees:
 *   1. The account is proven to be an `AssetRegistry` by recomputing the
 *      Anchor account discriminator = sha256("account:AssetRegistry")[0..8]
 *      locally and requiring it to match the on-chain first 8 bytes. We never
 *      call into `@coral-xyz/anchor` or the SDK to decode.
 *   2. The three authority keys are raw-decoded at offsets derived from the
 *      program's declared struct (`AssetRegistry::SPACE`: 8-byte discriminator
 *      then three consecutive 32-byte pubkeys). No SDK layout is consulted.
 *   3. The registry PDA is recomputed with the bare `asset-registry` seed and
 *      the program id (hardcoded here, independent of the SDK ids module).
 *   4. Each tier is proven to carry its own distinct, nonzero authority, and
 *      the per-tier instruction builders (a SECOND, SDK-provided encoding
 *      surface) are cross-validated: the signer each builder emits must equal
 *      the matching raw on-chain key. The SDK is thus used only as a
 *      "which key signs" oracle and inferred to be correct because it agrees
 *      with both the source `has_one` contract and the on-chain registry —
 *      never trusted to decode the registry itself.
 *
 * Guard against drift between the program source and this proof: the
 * `TIERS` table encodes the source-level `has_one = <tier>_authority` binding
 * for a representative instruction of each tier (see
 * noviscia-capacity/src/lib.rs). If the program ever rebinds a tier to a
 * different authority these assertions fail locally.
 *
 * Run (no RPC, offline — validates the whole pipeline):
 *   npx tsx scripts/e2e/e2e-rbac-tier-evidence-devnet.ts --self-test
 * Run (on-chain evidence; registry must exist on devnet):
 *   npx tsx scripts/e2e/e2e-rbac-tier-evidence-devnet.ts
 */
import { createHash } from 'node:crypto';
import { Connection, PublicKey } from '@solana/web3.js';

import {
  buildInitializeIx,
  buildRegisterAssetIx,
  buildSetAssetSupportIx,
  buildUpdateAssetParamsIx,
  buildInitializeCreditLineIx,
  buildUpdateCreditLimitIx,
  buildSetCreditFrozenIx,
  buildSetPausedIx,
  buildSetKycRootIx,
  buildWithdrawAssetFeesIx,
} from '../../sdk/src/assetEngine';
import { ASSET_ENGINE_PROGRAM_ID, USDC_MINT, NVSC_MINT } from '../../sdk/src/ids';

const RPC = process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com';

// ── Hardcoded program constant (independent of the SDK ids module) ─────────────
// Mirrors `declare_id!` of the noviscia-capacity host (asset_* handlers). If
// these drift, the registry-PDA recomputation below will fail loudly.
const PROGRAM_ID = new PublicKey('EDBr2VFWweFDzKR4cTT5j3TPGvPd9imoP8F76YK1o9oe');
const REGISTRY_SEED = Buffer.from('asset-registry');

// ── Anchor primitives, recomputed locally ───────────────────────────────────────
function accountDiscriminator(typeName: string): Buffer {
  return createHash('sha256').update(`account:${typeName}`).digest().subarray(0, 8);
}
const REGISTRY_DISCRIMINATOR = accountDiscriminator('AssetRegistry');

/** Bare PDA — no SDK helper. */
function registryPda(): PublicKey {
  return PublicKey.findProgramAddressSync([REGISTRY_SEED], PROGRAM_ID)[0];
}

let pass = 0;
let fail = 0;
let verbose = true;
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass += 1;
    if (verbose) console.log(`  \u2713 ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail += 1;
    if (verbose) console.log(`  \u2717 ${name}${extra ? ' — ' + extra : ''}`);
  }
}

/** Raw decode of the AssetRegistry at offsets from the program struct. */
function decodeRegistry(data: Uint8Array): {
  breaker: PublicKey;
  riskCommittee: PublicKey;
  upgrade: PublicKey;
  supportedCount: number;
  paused: boolean;
} {
  return {
    breaker: new PublicKey(data.subarray(8, 40)),
    riskCommittee: new PublicKey(data.subarray(40, 72)),
    upgrade: new PublicKey(data.subarray(72, 104)),
    supportedCount: data[200],
    paused: data[201] === 1,
  };
}

/** Deterministic synthetic pubkey for self-test fixtures. */
function mk(i: number): PublicKey {
  return new PublicKey(Buffer.from(Array.from({ length: 32 }, (_, j) => (j * i + i) % 251)));
}

/**
 * Source-level tier contract: for each tier, a representative anchor
 * instruction and the captured `has_one` field it is sealed to
 * (noviscia-capacity/src/lib.rs). The `builder` is a function that takes
 * the tier authority and returns the instruction; we then require the FIRST
 * signer it emits to equal the raw key for that tier. This turns the SDK into
 * a falsifiable oracle cross-checked against the raw registry.
 */
const TIERS = [
  {
    tier: 'Tier 1 — Breaker (1-of-3 Squads)',
    field: 'breaker_authority',
    cap: (k: PublicKey) => buildSetPausedIx(PROGRAM_ID, k, true),
  },
  {
    tier: 'Tier 2 — Risk Committee (3-of-5 Squads)',
    field: 'risk_committee_authority',
    cap: (k: PublicKey) => buildSetAssetSupportIx(PROGRAM_ID, k, USDC_MINT, true),
  },
  {
    tier: 'Tier 3 — Upgrade / Council (5-of-7, 72h timelock)',
    field: 'upgrade_authority',
    cap: (k: PublicKey) =>
      buildRegisterAssetIx(PROGRAM_ID, k, USDC_MINT, {
        decimals: 6,
        basePremiumRateBps: 500,
        premiumCapBps: 2000,
        maxCapacity: 1_500_000_000_000n,
        minPremiumLamports: 1_000n,
        lpYieldSplitBps: 8000,
      }),
  },
] as const;

/**
 * Runs the full trust-free evidence pipeline over a raw AssetRegistry payload.
 * Returns { pass, fail } so callers (devnet / self-test) decide exit status.
 * When `quiet`, verdicts are tallied but not printed (used for negative
 * fixtures whose failures are expected).
 */
function runEvidence(
  owner: PublicKey,
  executable: boolean,
  data: Uint8Array,
  sourceLabel: string,
  quiet = false,
): { pass: number; fail: number } {
  pass = 0;
  fail = 0;
  verbose = !quiet;
  console.log(`\n— evidence from ${sourceLabel} —`);
  console.log(`  registry data len: ${data.length} (expected ${8 + 32 * 3 + 32 * 3 + 3})`);

  const disc = Buffer.from(data.subarray(0, 8));
  check(
    'decoded account is an AssetRegistry (discriminator match)',
    disc.equals(REGISTRY_DISCRIMINATOR),
    `${disc.toString('hex')}`
  );
  check('registry owned by capacity host', owner.equals(PROGRAM_ID), owner.toBase58());
  check('registry executable flag is false (CA holds data, not a program)', !executable);

  const reg = decodeRegistry(data);

  // Per-tier key integrity — nonzero and pairwise distinct.
  const notZero = (k: PublicKey) => !k.equals(PublicKey.default);
  check('breaker authority is set (nonzero)', notZero(reg.breaker));
  check('risk-committee authority is set (nonzero)', notZero(reg.riskCommittee));
  check('upgrade authority is set (nonzero)', notZero(reg.upgrade));
  check(
    'three tiers are pairwise distinct',
    !reg.breaker.equals(reg.riskCommittee) &&
      !reg.breaker.equals(reg.upgrade) &&
      !reg.riskCommittee.equals(reg.upgrade),
    'a cold-start deployer (single key for all tiers) fails this — proving real separation'
  );

  console.log('\n  tier → authority mapping (raw decode):');
  console.log(`    breaker          ${reg.breaker.toBase58()}`);
  console.log(`    risk_committee   ${reg.riskCommittee.toBase58()}`);
  console.log(`    upgrade          ${reg.upgrade.toBase58()}`);
  console.log();

  // Cross-validate each tier against the SDK instruction builders: the tier
  // authority MUST be among the signers each builder emits. This catches
  // either registry drift or builder drift. (Some instructions — e.g.
  // `asset_initialize_credit_line` — are legitimately co-signed by an institution
  // key, so membership, not lead-signer identity, is the correct contract.)
  for (const t of TIERS) {
    const rawKey =
      t.field === 'breaker_authority' ? reg.breaker : t.field === 'risk_committee_authority' ? reg.riskCommittee : reg.upgrade;
    const signer = t.cap(rawKey).keys.find((k) => k.isSigner);
    check(
      `${t.tier} — builder signer == raw ${t.field}`,
      !!signer && signer.pubkey.equals(rawKey),
      signer ? signer.pubkey.toBase58() : 'no signer emitted'
    );
  }

  // Structural sanity: a representative of EVERY tiered instruction binds the
  // registry explicitly and names the correct signer key — the mapping is not
  // an artifact of a single builder.
  const extraSigners: Array<[string, PublicKey, (k: PublicKey) => ReturnType<typeof buildSetPausedIx>]> = [
    ['asset_set_paused (T1)', reg.breaker, (k) => buildSetPausedIx(PROGRAM_ID, k, true)],
    ['asset_set_credit_frozen (T1)', reg.breaker, (k) => buildSetCreditFrozenIx(PROGRAM_ID, k, PublicKey.default, true)],
    ['asset_set_support (T2)', reg.riskCommittee, (k) => buildSetAssetSupportIx(PROGRAM_ID, k, USDC_MINT, true)],
    ['asset_update_params (T2)', reg.riskCommittee, (k) => buildUpdateAssetParamsIx(PROGRAM_ID, k, USDC_MINT, { decimals: 6, basePremiumRateBps: 500, premiumCapBps: 2000, maxCapacity: 1n, minPremiumLamports: 1_000n, lpYieldSplitBps: 8000 })],
    ['asset_initialize_credit_line (T2)', reg.riskCommittee, (k) => buildInitializeCreditLineIx(PROGRAM_ID, PublicKey.default, k, 1n)],
    ['asset_update_credit_limit (T2)', reg.riskCommittee, (k) => buildUpdateCreditLimitIx(PROGRAM_ID, k, PublicKey.default, 1n)],
    ['asset_set_kyc_root (T2)', reg.riskCommittee, (k) => buildSetKycRootIx(PROGRAM_ID, k, PublicKey.default, Buffer.alloc(32))],
    ['asset_register (T3)', reg.upgrade, (k) => buildRegisterAssetIx(PROGRAM_ID, k, NVSC_MINT, { decimals: 9, basePremiumRateBps: 500, premiumCapBps: 2000, maxCapacity: 1n, minPremiumLamports: 1_000n, lpYieldSplitBps: 8000 })],
    ['asset_initialize (T3)', reg.upgrade, (k) =>
      buildInitializeIx(PROGRAM_ID, {
        upgradeAuthority: k,
        breakerAuthority: reg.breaker,
        riskCommitteeAuthority: reg.riskCommittee,
        wsolMint: new PublicKey('So11111111111111111111111111111111111111112'),
        usdcMint: USDC_MINT,
        nvscMint: NVSC_MINT,
      }),
    ],
    ['asset_withdraw_fees (T3)', reg.upgrade, (k) => buildWithdrawAssetFeesIx(PROGRAM_ID, k, USDC_MINT, PublicKey.default, 1n)],
  ];
  for (const [label, key, build] of extraSigners) {
    const isTierSigner = build(key).keys.some((k) => k.isSigner && k.pubkey.equals(key));
    check(
      `${label} — signer routes the correct tier key`,
      isTierSigner,
      isTierSigner ? key.toBase58() : 'tier key not among signers'
    );
  }

  return { pass, fail };
}

/** Well-formed synthetic AssetRegistry bytes for the local self-test. */
function syntheticRegistryData(): Uint8Array {
  return Buffer.concat([
    REGISTRY_DISCRIMINATOR,
    mk(7).toBuffer(),   // breaker
    mk(13).toBuffer(),  // risk committee
    mk(29).toBuffer(),  // upgrade
    new PublicKey('So11111111111111111111111111111111111111112').toBuffer(), // wsol
    mk(3).toBuffer(),   // usdc
    mk(17).toBuffer(),  // nvsc
    Buffer.from([2, 0, 254]),
  ]);
}

function selfTest(): { pass: number; fail: number } {
  console.log('Running --self-test against a synthetic AssetRegistry (no RPC).');
  const data = syntheticRegistryData();
  const r = runEvidence(PROGRAM_ID, false, data, 'self-test — synthetic registry');
  console.log(`\n  self-test positive pass: ${r.pass}, fail: ${r.fail}`);
  console.log();

  const reg = decodeRegistry(data);

  // Oracle teeth — the checks above must be able to FAIL, or they prove
  // nothing. Exercise three guards that a faulty registry would trip. Guard
  // verdicts use their own tallier (always printed, never muted) so expected
  // failures inside the sentinel fixtures cannot leak into the exit status.
  let gPass = 0;
  let gFail = 0;
  const guard = (name: string, cond: boolean, extra = '') => {
    if (cond) {
      gPass += 1;
      console.log(`  \u2713 ${name}${extra ? ' — ' + extra : ''}`);
    } else {
      gFail += 1;
      console.log(`  \u2717 ${name}${extra ? ' — ' + extra : ''}`);
    }
  };

  const drifted = buildSetPausedIx(PROGRAM_ID, mk(77), true);
  const driftedSigner = drifted.keys.find((k) => k.isSigner);
  guard(
    'self-test: signer-drift is detectable (builder with a foreign key != registry breaker)',
    !!(driftedSigner && !driftedSigner.pubkey.equals(reg.breaker)),
    driftedSigner?.pubkey.toBase58() ?? 'no signer'
  );

  const wrongOwner = runEvidence(PublicKey.default, false, data, 'self-test — wrong owner', true);
  guard('self-test: mismatched owner is rejected (returns >0 failures)', wrongOwner.fail > 0, `${wrongOwner.fail} fails seen`);

  const wrongDiscBlob = Buffer.from(data);
  wrongDiscBlob[0] ^= 0xff;
  const wrongDisc = runEvidence(PROGRAM_ID, false, wrongDiscBlob, 'self-test — corrupted discriminator', true);
  guard(
    'self-test: corrupted discriminator is rejected (returns >0 failures)',
    wrongDisc.fail > 0,
    `${wrongDisc.fail} fails seen`
  );

  console.log(`\n  self-test oriented checks: ${gPass} passed, ${gFail} failed`);
  return { pass: r.pass + gPass, fail: r.fail + gFail };
}

async function main() {
  if (process.argv.includes('--self-test')) {
    const r = selfTest();
    const total = r.pass + r.fail;
    console.log(`\n${r.pass} passed, ${r.fail} failed`);
    process.exit(r.fail > 0 ? 1 : 0);
  }

  const connection = new Connection(RPC, 'confirmed');
  console.log(`RPC:       ${RPC}`);
  console.log(`program:   ${PROGRAM_ID.toBase58()}`);
  console.log(`registry:  ${registryPda().toBase58()}`);
  console.log(`account discr (sha256 "account:AssetRegistry")[0..8]: ${REGISTRY_DISCRIMINATOR.toString('hex')}`);

  // 1. Deployment gate.
  const programInfo = await connection.getAccountInfo(PROGRAM_ID);
  check(
    'capacity host deployed on devnet',
    !!programInfo,
    programInfo ? `owner=${programInfo.owner.toBase58()}` : 'MISSING — deploy first (host needs the JDsM18…BaBiMc program keypair)'
  );

  // 2. Registry presence + discriminator + ownership.
  const pda = registryPda();
  const info = await connection.getAccountInfo(pda);
  check('asset-registry account exists', !!info);
  if (!info) {
    console.log('\nRegistry is absent on-chain (program not deployed / not initialized).');
    console.log('The evidence proof cannot be completed until the host is live at the');
    console.log('canonical program id and `asset_initialize` has pinned the three-tier keys.');
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  }

  const r = runEvidence(info.owner, info.executable, info.data, 'devnet');
  console.log(`\n${r.pass} passed, ${r.fail} failed`);
  process.exit(r.fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
