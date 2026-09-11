import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey, SystemProgram, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PROGRAM_IDS, USDC_MINT } from './ids';
import {
  TVV_GATE_ARM_DISCRIMINATOR,
  TVV_GATE_SETTLE_DISCRIMINATOR,
  TVV_GATE_CONFIGURE_DISCRIMINATOR,
  gateConfigAddress,
  gateSnapshotAddress,
  gateSnapshotSeed,
  gateVaultAddresses,
  sizeToGateCeiling,
  buildGateArmIx,
  buildGateSettleIx,
  buildGateConfigureIx,
  buildGateBundle,
  runKeeperCycle,
  SYSTEMIC_CAP_BPS,
  type GateArmAccounts,
} from './keeper';
import { JitoBundleClient, KNOWN_JITO_TIP_ACCOUNTS } from './jito';

const ORIGINAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

function fakeFetch(result: unknown, httpStatus = 200) {
  const calls: { body: { method: string; params: unknown } }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? '{}');
    calls.push({ body });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
      status: httpStatus,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

const searcher = Keypair.generate();
const feePayer = Keypair.generate();
const tipPayer = Keypair.generate();
const slotKey = 1_000_000n;
const pid = PROGRAM_IDS.nvUsdcVault;
const vault = gateVaultAddresses();

function armAccounts(): GateArmAccounts {
  return {
    searcher: searcher.publicKey,
    vaultConfig: vault.vaultConfig,
    vaultUsdc: vault.vaultUsdc,
    searcherUsdc: getRandomATA(),
    vaultAuthority: vault.vaultAuthority,
    gate: gateConfigAddress(vault.vaultConfig),
    snapshot: gateSnapshotAddress(searcher.publicKey, slotKey),
  };
}

function getRandomATA(): PublicKey {
  return PublicKey.unique();
}

function transferIx() {
  return SystemProgram.transfer({ fromPubkey: feePayer.publicKey, toPubkey: feePayer.publicKey, lamports: 1 });
}

describe('gate address derivation', () => {
  it('derives the gate config PDA under the nv-usdc-vault program', () => {
    const addr = gateConfigAddress(vault.vaultConfig);
    assert.ok(addr.equals(gateConfigAddress(vault.vaultConfig)));
  });
  it('derives a distinct snapshot PDA per (searcher, slot) with little-endian slot', () => {
    const a = gateSnapshotAddress(searcher.publicKey, slotKey);
    const b = gateSnapshotAddress(searcher.publicKey, slotKey + 1n);
    assert.ok(!a.equals(b));
    const seedLe = gateSnapshotSeed(searcher.publicKey, slotKey)[2];
    const expected = Buffer.alloc(8);
    expected.writeBigUInt64LE(slotKey);
    assert.deepEqual(seedLe.subarray(0, 8), expected);
  });
  it('computes vault config / authority / treasury PDAs', () => {
    assert.ok(vault.vaultConfig instanceof PublicKey);
    assert.ok(!vault.vaultUsdc.equals(PublicKey.default));
  });
  it('vault treasury is the ["nv-vault-usdc", mint] PDA, not an ATA (live devnet 6enRHG...)', () => {
    const { vaultConfig, vaultUsdc } = vault;
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('nv-vault-usdc'), USDC_MINT.toBuffer()],
      pid,
    );
    assert.ok(vaultUsdc.equals(pda), 'treasury must be the nv-vault-usdc PDA');
    const ata = getAssociatedTokenAddressSync(USDC_MINT, vaultConfig, true, TOKEN_PROGRAM_ID);
    assert.ok(!vaultUsdc.equals(ata), 'was accidentally the mint ATA');
  });
});

describe('sizeToGateCeiling', () => {
  it('arms at the ceiling share of the pool and returns principal + net profit', () => {
    const pool = 1_000_000_000_000n; // 1M USDC (1e6)
    const r = sizeToGateCeiling({ poolUsdc: pool, grossSpreadBps: 35n, combinedLegCostBps: 8n });
    assert.equal(r.armAmount, (pool * SYSTEMIC_CAP_BPS) / 10_000n);
    assert.ok(r.profit > 0n);
    assert.equal(r.grossReturn, r.armAmount + r.profit);
    assert.equal(r.edgeOpen, true);
  });
  it('clamps a requested ceiling above the 60% systemic cap', () => {
    const pool = 10_000_000_000n;
    const r = sizeToGateCeiling({ poolUsdc: pool, grossSpreadBps: 200n, slotCeilingBps: 9_000n });
    assert.equal(r.armAmount, (pool * SYSTEMIC_CAP_BPS) / 10_000n);
  });
  it('closes the edge (no opportunity) when spread <= combined cost', () => {
    const r = sizeToGateCeiling({ poolUsdc: 10_000_000n, grossSpreadBps: 5n, combinedLegCostBps: 8n });
    assert.equal(r.edgeOpen, false);
    assert.equal(r.profit, 0n);
    assert.equal(r.grossReturn, r.armAmount);
  });
});

describe('buildGateArmIx', () => {
  it('prepends the Arm discriminator and encodes u64 args little-endian', () => {
    const ix = buildGateArmIx({
      searcher: searcher.publicKey,
      vaultConfig: vault.vaultConfig,
      vaultUsdc: vault.vaultUsdc,
      searcherUsdc: vault.vaultUsdc,
      vaultAuthority: vault.vaultAuthority,
      gate: gateConfigAddress(vault.vaultConfig),
      snapshot: gateSnapshotAddress(searcher.publicKey, slotKey),
      slotKey,
      armAmount: 5_000_000n,
    });
    assert.ok(ix.programId.equals(pid));
    assert.deepEqual(ix.data.subarray(0, 8), TVV_GATE_ARM_DISCRIMINATOR);
    const slotBuf = ix.data.subarray(8, 16);
    const amountBuf = ix.data.subarray(16, 24);
    assert.equal(slotBuf.readBigUInt64LE(), slotKey);
    assert.equal(amountBuf.readBigUInt64LE(), 5_000_000n);
    assert.ok(ix.keys[0].pubkey.equals(searcher.publicKey) && ix.keys[0].isSigner);
    assert.ok(ix.keys[4].pubkey.equals(vault.vaultAuthority));
  });
});

describe('buildGateSettleIx', () => {
  it('prepends the Settle discriminator and encodes the gross return', () => {
    const ix = buildGateSettleIx({
      searcher: searcher.publicKey,
      vaultConfig: vault.vaultConfig,
      vaultUsdc: vault.vaultUsdc,
      searcherUsdc: vault.vaultUsdc,
      gate: gateConfigAddress(vault.vaultConfig),
      snapshot: gateSnapshotAddress(searcher.publicKey, slotKey),
      slotKey,
      grossReturn: 5_109_000n,
    });
    assert.deepEqual(ix.data.subarray(0, 8), TVV_GATE_SETTLE_DISCRIMINATOR);
    assert.equal(ix.data.subarray(16, 24).readBigUInt64LE(), 5_109_000n);
  });
});

describe('buildGateConfigureIx', () => {
  const admin = Keypair.generate().publicKey;
  const gateSearcher = Keypair.generate().publicKey;
  const timelockedAdmin = PublicKey.unique();
  const gate = gateConfigAddress(vault.vaultConfig);

  it('prepends the Configure discriminator and encodes the args in Rust field order', () => {
    const ix = buildGateConfigureIx({
      admin,
      vaultConfig: vault.vaultConfig,
      timelockedAdmin,
      gate,
      active: true,
      searcher: gateSearcher,
      slotCeilingUsd: 5_000_000n,
      strictBundle: true,
    });
    assert.ok(ix.programId.equals(pid));
    assert.deepEqual(ix.data.subarray(0, 8), TVV_GATE_CONFIGURE_DISCRIMINATOR);
    // args: [active: bool][searcher: pubkey][ceiling: u64][strict: bool]
    assert.equal(ix.data[8], 1, 'active true');
    assert.ok(ix.data.subarray(9, 41).equals(gateSearcher.toBuffer()), 'searcher pubkey');
    assert.equal(ix.data.subarray(41, 49).readBigUInt64LE(), 5_000_000n);
    assert.equal(ix.data[49], 1, 'strict_bundle true');
  });

  it('builds the full account map: admin / vault_config / timelocked_admin / gate + sysvars', () => {
    const ix = buildGateConfigureIx({
      admin,
      vaultConfig: vault.vaultConfig,
      timelockedAdmin,
      gate,
      active: false,
      searcher: gateSearcher,
      slotCeilingUsd: 1_000_000n,
      strictBundle: false,
    });
    assert.equal(ix.keys.length, 6);
    assert.ok(ix.keys[0].pubkey.equals(admin) && ix.keys[0].isSigner);
    assert.ok(ix.keys[1].pubkey.equals(vault.vaultConfig));
    assert.ok(ix.keys[2].pubkey.equals(timelockedAdmin));
    assert.ok(ix.keys[3].pubkey.equals(gate) && ix.keys[3].isWritable);
    assert.ok(ix.keys[4].pubkey.equals(SystemProgram.programId));
  });
});

describe('buildGateBundle', () => {
  const blockhash = '11111111111111111111111111111111';

  it('builds a 3-transaction arm → route → settle bundle with one shared blockhash', () => {
    const txs = buildGateBundle({
      routeIxs: [transferIx()],
      armSigners: [searcher],
      routeSigners: [],
      settleSigners: [searcher],
      feePayer,
      recentBlockhash: blockhash,
      accounts: armAccounts(),
      slotKey,
      armAmount: 5_000_000n,
      grossReturn: 5_109_000n,
    });
    assert.equal(txs.length, 3, 'arm + route + settle');
    for (const tx of txs) assert.equal(tx.message.recentBlockhash, blockhash);
  });

  it('appends the conditional tip to Tx-0 and requires the tip payer as a signer there', () => {
    const txs = buildGateBundle({
      routeIxs: [transferIx()],
      tip: {
        tipAccount: KNOWN_JITO_TIP_ACCOUNTS[0],
        tipPayer: tipPayer.publicKey,
        tipPayerKeypair: tipPayer,
        lamports: 1_000_000n,
      },
      armSigners: [searcher],
      settleSigners: [searcher],
      feePayer,
      recentBlockhash: blockhash,
      accounts: armAccounts(),
      slotKey,
      armAmount: 5_000_000n,
      grossReturn: 5_109_000n,
    });
    assert.equal(txs[0].signatures.length, 3, 'fee payer + searcher + tip payer sign Tx-0');
    assert.equal(txs[txs.length - 1].signatures.length, 2, 'settle tx: fee payer + searcher');
  });

  it('can run without a DEX route (arm → settle, 2 txs)', () => {
    const txs = buildGateBundle({
      armSigners: [searcher],
      settleSigners: [searcher],
      feePayer,
      recentBlockhash: blockhash,
      accounts: armAccounts(),
      slotKey,
      armAmount: 100n,
      grossReturn: 100n,
    });
    assert.equal(txs.length, 2);
  });
});

describe('runKeeperCycle', () => {
  const pool = 1_000_000_000_000n;

  it('sizes, submits a signed bundle and reports landed with a confirmed status', async () => {
    const calls = fakeFetch('bundle-id-123');
    const client = new JitoBundleClient('http://127.0.0.1:9000');

    const outcomePromise = runKeeperCycle(
      {
        poolUsdc: pool,
        grossSpreadBps: 35n,
        combinedLegCostBps: 8n,
        routeIxs: [transferIx()],
        tip: {
          tipAccount: KNOWN_JITO_TIP_ACCOUNTS[0],
          tipPayer: tipPayer.publicKey,
          tipPayerKeypair: tipPayer,
          lamports: 1_000_000n,
        },
        armSigners: [searcher],
        settleSigners: [searcher],
        feePayer,
        recentBlockhash: '11111111111111111111111111111111',
        accounts: armAccounts(),
        slotKey,
      },
      client,
    );

    const txCalls = calls.filter((c) => c.body.method === 'sendBundle');
    assert.equal(txCalls.length, 1, 'one sendBundle on submit');
    const params = txCalls[0].body.params as unknown[];
    const encoded = params[0] as string[];
    const txs = encoded.map((b) => VersionedTransaction.deserialize(Buffer.from(b, 'base64')));
    assert.equal(txs.length, 3, 'arm + route + settle submitted');

    fakeFetch({
      context: { slot: 1000001 },
      value: [{ bundle_id: 'bundle-id-123', transactions: ['sig'], slot: 1000001, confirmation_status: 'confirmed', err: { Ok: null } }],
    });
    const outcome = await outcomePromise;
    assert.equal(outcome.landed, true);
    assert.equal(outcome.status, 'confirmed');
  });

  it('rejects a cold market (spread <= cost) before submitting anything', async () => {
    const client = new JitoBundleClient('http://127.0.0.1:9000');
    await assert.rejects(
      runKeeperCycle(
        {
          poolUsdc: pool,
          grossSpreadBps: 3n,
          combinedLegCostBps: 8n,
          armSigners: [searcher],
          settleSigners: [searcher],
          feePayer,
          recentBlockhash: '11111111111111111111111111111111',
          accounts: armAccounts(),
          slotKey,
        },
        client,
      ),
      /no capturable edge/,
    );
  });

  it('refuses to run without a conditional tip (unsafe landing)', async () => {
    fakeFetch('bundle-no-tip');
    const client = new JitoBundleClient('http://127.0.0.1:9000');
    await assert.rejects(
      runKeeperCycle(
        {
          poolUsdc: pool,
          grossSpreadBps: 50n,
          armSigners: [searcher],
          settleSigners: [searcher],
          feePayer,
          recentBlockhash: '11111111111111111111111111111111',
          accounts: armAccounts(),
          slotKey,
        },
        client,
      ),
      /without a conditional tip/,
    );
  });
});
