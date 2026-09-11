const anchor = require('@coral-xyz/anchor');
const splToken = require('@solana/spl-token');
const { SystemProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, SYSVAR_CLOCK_PUBKEY } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const SEARCHER_KEYFILE = path.join(__dirname, '..', '.searcher-key.json');

function loadSearcherKeypair() {
  if (fs.existsSync(SEARCHER_KEYFILE)) {
    const secret = JSON.parse(fs.readFileSync(SEARCHER_KEYFILE, 'utf8')).secretKey;
    if (secret) return Keypair.fromSecretKey(Uint8Array.from(secret));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(SEARCHER_KEYFILE, JSON.stringify({ secretKey: Array.from(kp.secretKey), publicKey: kp.publicKey.toBase58() }));
  return kp;
}

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const conn = provider.connection;

const gate = new anchor.Program(require('../target/idl/noviscia_tvv_gate.json'), provider);
const omni = new anchor.Program(require('../target/idl/noviscia_omni_pool.json'), provider);
const admin = provider.wallet.publicKey;

const GATE_SEED = Buffer.from('tvv-gate');
const SEARCHER_SEED = Buffer.from('tvv-searcher');
const RUN_SEED = Buffer.from('tvv-run');
const RISK_SEED = Buffer.from('tvv-risk');
const DIF_SEED = Buffer.from('tvv-dif');
const MARGIN_SEED = Buffer.from('tvv-margin');
const VAULT_SEED = Buffer.from('omni-vault');
const NSHARES_SEED = Buffer.from('nshares');

const JLF_CAPITAL = 800_000_000;
const MAX_EXPOSURE = 5_000_000_000;
const MAX_SHARE_BPS = 10_000;
const MAINT_BPS = 200;

let usdcMint;
let adminUsdc;
let configPda;
let searcherKp;
let searcherStatePda;
let searcherUsdc;
let searcherMarginVault;
let marginPda;
let marginEscrow;
let runPdaKeys;
let reserve;
let riskPda;

const toBuf = (pk) => pk.toBuffer ? pk.toBuffer() : pk;
const pda = async (seeds, id) => PublicKey.findProgramAddress(seeds, id);
const u64Le = (n) => {
  if (Buffer.isBuffer(n)) return n;
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(n));
  return out;
};

async function pdaGateConfig() {
  const [k] = await pda([GATE_SEED], gate.programId);
  return k;
}
async function pdaRisk() {
  const [k] = await pda([RISK_SEED, toBuf(configPda)], gate.programId);
  return k;
}
async function pdaDifTreasury() {
  const [k] = await pda([DIF_SEED, toBuf(configPda)], gate.programId);
  return k;
}
async function pdaSearcherState(sk) {
  const [k] = await pda([SEARCHER_SEED, toBuf(sk)], gate.programId);
  return k;
}
async function pdaMargin(sk) {
  const [k] = await pda([MARGIN_SEED, toBuf(sk)], gate.programId);
  return k;
}
async function pdaRun(sk, mint, seq) {
  const [k] = await pda([RUN_SEED, toBuf(sk), toBuf(mint), u64Le(seq)], gate.programId);
  return k;
}
async function pdaVault(mint) {
  const [k] = await pda([VAULT_SEED, toBuf(mint)], omni.programId);
  return k;
}
async function pdaShares(mint) {
  const [k] = await pda([NSHARES_SEED, toBuf(mint)], omni.programId);
  return k;
}

async function airdrop(pk, sol = 20) {
  const sig = await conn.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, 'confirmed');
}

async function ata(mint, owner, offCurve = false) {
  return (await splToken.getOrCreateAssociatedTokenAccount(conn, provider.wallet.payer, mint, owner, offCurve)).address;
}

async function bal(ataKey) {
  const a = await splToken.getAccount(conn, ataKey);
  return Number(a.amount);
}
async function quickBal(key) {
  const mk = new PublicKey(key);
  const info = await conn.getAccountInfo(mk);
  if (!info) return 0;
  const a = splToken.AccountLayout.decode(info.data);
  return Number(a.amount);
}

async function expectRevert(promise, re) {
  let hit = false;
  try {
    await promise;
  } catch (e) {
    hit = true;
    const msg = JSON.stringify((e && e.logs) || (e && e.message) || e);
    if (re && !re.test(msg)) throw new Error(`reverted but not with ${re}:\n${msg}`);
  }
  if (!hit) throw new Error('expected revert, tx succeeded');
}

const pullAccounts = (runKey, amount, signers) =>
  gate.methods
    .pullCap(new anchor.BN(amount))
    .accounts({
      config: configPda,
      searcherState: searcherStatePda,
      searcher: searcherKp.publicKey,
      margin: marginPda,
      reserveVault: reserve,
      searcherVault: searcherUsdc,
      assetMint: usdcMint,
      run: runKey,
      risk: riskPda,
      tokenProgram: splToken.TOKEN_PROGRAM_ID,
      clock: SYSVAR_CLOCK_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .signers(signers || [searcherKp]);

const settleAccounts = (runKey) =>
  gate.methods
    .settleRun()
    .accounts({
      config: configPda,
      run: runKey,
      searcher: searcherKp.publicKey,
      reserveVault: reserve,
      searcherVault: searcherUsdc,
      assetMint: usdcMint,
      searcherState: searcherStatePda,
      margin: marginPda,
      risk: riskPda,
      tokenProgram: splToken.TOKEN_PROGRAM_ID,
      clock: SYSVAR_CLOCK_PUBKEY,
    })
    .signers([searcherKp]);

const forceCloseRun = (runKey) =>
  gate.methods
    .forceClose()
    .accounts({
      config: configPda,
      run: runKey,
      searcherState: searcherStatePda,
      margin: marginPda,
      risk: riskPda,
      authority: admin,
      clock: SYSVAR_CLOCK_PUBKEY,
    })
    .rpc();

const postMargin = (amount) =>
  gate.methods
    .postMargin(new anchor.BN(amount))
    .accounts({
      config: configPda,
      margin: marginPda,
      searcher: searcherKp.publicKey,
      searcherMarginVault,
      marginEscrow,
      assetMint: usdcMint,
      tokenProgram: splToken.TOKEN_PROGRAM_ID,
    })
    .signers([searcherKp])
    .rpc();

const withdrawMargin = (amount) =>
  gate.methods
    .withdrawMargin(new anchor.BN(amount))
    .accounts({
      config: configPda,
      margin: marginPda,
      searcher: searcherKp.publicKey,
      marginEscrow,
      searcherMarginVault,
      assetMint: usdcMint,
      tokenProgram: splToken.TOKEN_PROGRAM_ID,
    })
    .signers([searcherKp])
    .rpc();

const setHedge = (hedged) =>
  gate.methods
    .setHedge(new anchor.BN(hedged))
    .accounts({ config: configPda, margin: marginPda, searcher: searcherKp.publicKey })
    .signers([searcherKp])
    .rpc();

before(async () => {
  await airdrop(admin);
  searcherKp = loadSearcherKeypair();
  await airdrop(searcherKp.publicKey);

  usdcMint = await splToken.createMint(conn, provider.wallet.payer, admin, admin, 6);
  adminUsdc = await ata(usdcMint, admin);

  await splToken.mintTo(conn, provider.wallet.payer, usdcMint, adminUsdc, admin, 10_000_000_000, [], { commitment: 'confirmed' });

  configPda = await pdaGateConfig();
  riskPda = await pdaRisk();
});

describe('gate: atomic invariant lock', () => {
  it('initializes the gate + risk state', async () => {
    await gate.methods
      .initialize(6000, new anchor.BN(600), new anchor.BN(1_000_000_000), 3, new anchor.BN(JLF_CAPITAL), new anchor.BN(MAX_EXPOSURE), MAX_SHARE_BPS, [usdcMint])
      .accounts({ config: configPda, risk: riskPda, authority: admin, systemProgram: SystemProgram.programId })
      .rpc();
    const cfg = await gate.account.gateConfig.fetch(configPda);
    if (Number(cfg.maxRunCap) !== 1_000_000_000) throw new Error('bad maxRunCap');
    const risk = await gate.account.riskState.fetch(riskPda);
    if (Number(risk.jlfCapital) !== JLF_CAPITAL) throw new Error('bad jlf capital');
    if (risk.halted) throw new Error('risk should start unhalted');
    if (Number(risk.maxExposure) !== MAX_EXPOSURE) throw new Error('bad max exposure');
  });

  it('registers + provisions the searcher reserve', async () => {
    searcherStatePda = await pdaSearcherState(searcherKp.publicKey);
    marginPda = await pdaMargin(searcherKp.publicKey);
    const runVaultKp = Keypair.generate();
    searcherUsdc = await splToken.createAccount(conn, provider.wallet.payer, usdcMint, searcherKp.publicKey, runVaultKp);
    searcherMarginVault = await ata(usdcMint, searcherKp.publicKey);
    await gate.methods
      .initSearcher(10_000, MAINT_BPS, true)
      .accounts({ config: configPda, searcherState: searcherStatePda, margin: marginPda, searcher: searcherKp.publicKey, authority: admin, systemProgram: SystemProgram.programId })
      .rpc();

    marginEscrow = await ata(usdcMint, marginPda, true);
    await splToken.mintTo(conn, provider.wallet.payer, usdcMint, searcherMarginVault, admin, 100_000_000, [], { commitment: 'confirmed' });
    await postMargin(100_000_000);

    reserve = await ata(usdcMint, configPda, true);
    await gate.methods
      .provisionReserve(new anchor.BN(1_000_000_000))
      .accounts({ config: configPda, reserveVault: reserve, from: adminUsdc, fromAuthority: admin, assetMint: usdcMint, tokenProgram: splToken.TOKEN_PROGRAM_ID })
      .rpc();
    if ((await bal(reserve)) !== 1_000_000_000) throw new Error('reserve not provisioned');
  });

  it('pull_cap moves capital, opens a run, commits exposure', async () => {
    runPdaKeys = { seq0: await pdaRun(searcherKp.publicKey, usdcMint, 0) };
    await pullAccounts(runPdaKeys.seq0, 100_000_000).rpc();
    if ((await bal(reserve)) !== 900_000_000) throw new Error('reserve did not decrease');
    if ((await bal(searcherUsdc)) !== 100_000_000) throw new Error('searcher did not receive');
    const run = await gate.account.run.fetch(runPdaKeys.seq0);
    if (run.initialPoolBalance.toString() !== '1000000000') throw new Error('bad initial snapshot');
    const risk = await gate.account.riskState.fetch(riskPda);
    if (risk.committedTotal.toString() !== '100000000') throw new Error('commit not tracked');
  });

  it('settle_run with a win banks realized net + DIF carve', async () => {
    await splToken.mintTo(conn, provider.wallet.payer, usdcMint, searcherUsdc, admin, 50_000_000, [], { commitment: 'confirmed' });
    await settleAccounts(runPdaKeys.seq0).rpc();
    if ((await bal(reserve)) !== 1_050_000_000) throw new Error('profit not returned');
    const cfg = await gate.account.gateConfig.fetch(configPda);
    if (cfg.realizedYield.toString() !== '40000000') throw new Error(`realized=${cfg.realizedYield}`);
    if (cfg.difLedger.toString() !== '10000000') throw new Error(`dif=${cfg.difLedger}`);
    const run = await gate.account.run.fetch(runPdaKeys.seq0);
    if (run.status !== 1) throw new Error('run not settled');
    if (run.creditedYield.toString() !== '40000000') throw new Error(`run yield=${run.creditedYield}`);
    const risk = await gate.account.riskState.fetch(riskPda);
    if (risk.committedTotal.toString() !== '0') throw new Error('commit not released');
  });

  it('a losing return reverts atomically (zero leakage)', async () => {
    const seq1 = await pdaRun(searcherKp.publicKey, usdcMint, 1);
    await pullAccounts(seq1, 100_000_000).rpc();

    const beforeReserve = await bal(reserve);
    await splToken.transfer(conn, searcherKp, searcherUsdc, adminUsdc, searcherKp.publicKey, 100_000_000, []);
    const beforeSearcher = await bal(searcherUsdc);

    await expectRevert(
      settleAccounts(seq1).rpc(),
      /invariant/i,
    );

    if ((await bal(reserve)) !== beforeReserve) throw new Error('reserve moved on revert');
    if ((await bal(searcherUsdc)) !== beforeSearcher) throw new Error('searcher balance moved on revert');
    const run = await gate.account.run.fetch(seq1);
    if (run.status !== 0) throw new Error('run state mutated on revert');
  });

  it('force_close writes off principal into the JLF, below breaker', async () => {
    const seq1 = await pdaRun(searcherKp.publicKey, usdcMint, 1);
    await forceCloseRun(seq1);
    const run = await gate.account.run.fetch(seq1);
    if (run.status !== 2) throw new Error('not timed out');
    const st = await gate.account.searcherState.fetch(searcherStatePda);
    if (st.openRuns !== 0) throw new Error('open runs not decremented');
    const risk = await gate.account.riskState.fetch(riskPda);
    if (risk.jlfLosses.toString() !== '100000000') throw new Error(`jlf=${risk.jlfLosses}`);
    if (risk.halted) throw new Error('100M under half of 800M must not halt');
    if (risk.committedTotal.toString() !== '0') throw new Error('commit not released');
  });
});

describe('omni-pool: NAV accrual through the gate', () => {
  let vaultPda, sharesPda, vaultUsdc, userShares;
  let carryOwed, insOwed, taAfterSettle;

  it('initializes the vault with gate highwater', async () => {
    vaultPda = await pdaVault(usdcMint);
    sharesPda = await pdaShares(usdcMint);
    await omni.methods
      .initialize(configPda, 200, 2000, 1500)
      .accounts({
        vault: vaultPda, gate: configPda, usdcMint,
        authority: admin, systemProgram: SystemProgram.programId,
        tokenProgram: splToken.TOKEN_PROGRAM_ID, clock: SYSVAR_CLOCK_PUBKEY,
      })
      .rpc();
    await omni.methods
      .initializeShares()
      .accounts({
        vault: vaultPda, sharesMint: sharesPda, usdcMint,
        authority: admin, systemProgram: SystemProgram.programId,
        tokenProgram: splToken.TOKEN_PROGRAM_ID,
      })
      .rpc();
    const v = await omni.account.vaultState.fetch(vaultPda);
    if (v.highwaterYield.toString() !== '40000000') throw new Error(`highwater=${v.highwaterYield}`);
  });

  it('deposit mints nTokens 1:1', async () => {
    vaultUsdc = await ata(usdcMint, vaultPda, true);
    userShares = await ata(sharesPda, admin);
    await omni.methods
      .deposit(new anchor.BN(1_000_000_000))
      .accounts({
        vault: vaultPda, sharesMint: sharesPda, vaultUsdc, userUsdc: adminUsdc,
        userShares, usdcMint, user: admin, tokenProgram: splToken.TOKEN_PROGRAM_ID,
      })
      .rpc();
    const v = await omni.account.vaultState.fetch(vaultPda);
    if (v.totalAssets.toString() !== '1000000000') throw new Error('TA');
    if (v.totalShares.toString() !== '1000000000') throw new Error('TS');
    if ((await bal(userShares)) !== 1_000_000_000) throw new Error('shares minted');
  });

  it('gate earns, sentinel sweeps, settle_day credits 80% NAV', async () => {
    const seq2 = await pdaRun(searcherKp.publicKey, usdcMint, 2);
    await pullAccounts(seq2, 200_000_000).rpc();
    await splToken.mintTo(conn, provider.wallet.payer, usdcMint, searcherUsdc, admin, 100_000_000, [], { commitment: 'confirmed' });

    await settleAccounts(seq2).rpc();

    await gate.methods
      .sweepProfits(new anchor.BN(120_000_000))
      .accounts({
        config: configPda, reserveVault: reserve, toVault: vaultUsdc, assetMint: usdcMint,
        signer: admin, tokenProgram: splToken.TOKEN_PROGRAM_ID,
      })
      .rpc();

    await omni.methods
      .settleDay()
      .accounts({ vault: vaultPda, gate: configPda, usdcMint, clock: SYSVAR_CLOCK_PUBKEY })
      .rpc();

    const v = await omni.account.vaultState.fetch(vaultPda);
    taAfterSettle = Number(v.totalAssets);
    carryOwed = Number(v.carryLedger);
    insOwed = Number(v.insuranceLedger);
    if (v.totalShares.toString() !== '1000000000') throw new Error(`TS=${v.totalShares}`);
    if (carryOwed < 13_600_000 || carryOwed > 13_600_100) throw new Error(`carry=${carryOwed}`);
    if (insOwed !== 2_400_000) throw new Error(`ins=${insOwed}`);
    if (taAfterSettle < 1_063_999_000 || taAfterSettle > 1_064_001_000) throw new Error(`TA=${taAfterSettle}`);
    if (v.highwaterYield.toString() !== '120000000') throw new Error(`highwater=${v.highwaterYield}`);
  });

  it('redeem realizes the pro-rata NAV (net of provisions)', async () => {
    const v = await omni.account.vaultState.fetch(vaultPda);
    const expectOut = taAfterSettle - carryOwed - insOwed;
    const before = await bal(adminUsdc);
    await omni.methods
      .redeem(new anchor.BN(1_000_000_000), new anchor.BN(expectOut - 100))
      .accounts({
        vault: vaultPda, sharesMint: sharesPda, vaultUsdc, userUsdc: adminUsdc,
        userShares, usdcMint, user: admin, tokenProgram: splToken.TOKEN_PROGRAM_ID,
      })
      .rpc();
    const after = await bal(adminUsdc);
    if (after - before !== expectOut) throw new Error(`redeem paid ${after - before}, want ${expectOut}`);
    if ((await bal(userShares)) !== 0) throw new Error('shares not burned');
    const v2 = await omni.account.vaultState.fetch(vaultPda);
    if (v2.totalAssets.toString() !== String(carryOwed + insOwed)) throw new Error(`TA after=${v2.totalAssets}`);
  });

  it('authority collects carry + insurance', async () => {
    const before = await bal(adminUsdc);
    if (carryOwed > 0) {
      await omni.methods
        .collectCarry(new anchor.BN(carryOwed))
        .accounts({ vault: vaultPda, vaultUsdc, toVault: adminUsdc, usdcMint, authority: admin, tokenProgram: splToken.TOKEN_PROGRAM_ID })
        .rpc();
    }
    await omni.methods
      .collectInsurance(new anchor.BN(insOwed))
      .accounts({ vault: vaultPda, vaultUsdc, toVault: adminUsdc, usdcMint, authority: admin, tokenProgram: splToken.TOKEN_PROGRAM_ID })
      .rpc();
    if ((await bal(adminUsdc)) - before !== carryOwed + insOwed) throw new Error('collect mismatch');
    const v = await omni.account.vaultState.fetch(vaultPda);
    if (v.carryLedger.toString() !== '0') throw new Error(`carry leftover=${v.carryLedger}`);
    if (v.insuranceLedger.toString() !== '0') throw new Error(`insurance leftover=${v.insuranceLedger}`);
  });
});

describe('gate: cluster-1 margin & netting engine', () => {
  it('registration posted 100M collateral and pinned the gateway handshake', async () => {
    const margin = await gate.account.marginState.fetch(marginPda);
    if (Number(margin.collateral) !== 100_000_000) throw new Error(`collateral=${margin.collateral}`);
    if (Number(margin.maintenanceBps) !== MAINT_BPS) throw new Error(`maintenance=${margin.maintenanceBps}`);
    if (margin.flag) throw new Error('margin must start un-flagged');
    if ((await bal(marginEscrow)) !== 100_000_000) throw new Error(`escrow=${await bal(marginEscrow)}`);
    const risk = await gate.account.riskState.fetch(riskPda);
    if (risk.gateway.toBase58() !== gate.programId.toBase58()) throw new Error('gateway handshake mismatch');
    await expectRevert(withdrawMargin(101_000_000), /collateral/i);
  });

  it('breach on pull rolls back atomically and leaves collateral usable', async () => {
    await withdrawMargin(99_000_000);
    let margin = await gate.account.marginState.fetch(marginPda);
    if (Number(margin.collateral) !== 1_000_000) throw new Error(`collateral=${margin.collateral}`);
    const seq3 = await pdaRun(searcherKp.publicKey, usdcMint, 3);
    await expectRevert(pullAccounts(seq3, 100_000_000).rpc(), /margin/i);
    margin = await gate.account.marginState.fetch(marginPda);
    if (margin.flag) throw new Error('flag must roll back with the reverting pull');
    if (Number(margin.grossExposure) !== 0) throw new Error(`gross=${margin.grossExposure}`);
  });

  it('top-up clears the flag, opens the run, pins the exact floor', async () => {
    await postMargin(50_000_000);
    let margin = await gate.account.marginState.fetch(marginPda);
    if (Number(margin.collateral) !== 51_000_000) throw new Error(`collateral=${margin.collateral}`);
    if (margin.flag) throw new Error('flag must clear after top-up');
    const seq3 = await pdaRun(searcherKp.publicKey, usdcMint, 3);
    await pullAccounts(seq3, 100_000_000).rpc();
    if ((await bal(reserve)) !== 830_000_000) throw new Error(`reserve=${await bal(reserve)}`);
    margin = await gate.account.marginState.fetch(marginPda);
    if (Number(margin.grossExposure) !== 100_000_000) throw new Error(`gross=${margin.grossExposure}`);
    await expectRevert(withdrawMargin(50_000_000), /margin/i);
    await withdrawMargin(49_000_000);
    margin = await gate.account.marginState.fetch(marginPda);
    if (Number(margin.collateral) !== 2_000_000) throw new Error(`collateral=${margin.collateral}`);
  });

  it('hedge leg frees margin and settles the run back to principal', async () => {
    await setHedge(100_000_000);
    await withdrawMargin(2_000_000);
    let margin = await gate.account.marginState.fetch(marginPda);
    if (Number(margin.collateral) !== 0) throw new Error(`collateral=${margin.collateral}`);
    await setHedge(0);
    margin = await gate.account.marginState.fetch(marginPda);
    if (!margin.flag) throw new Error('uncovered exposure must trip the flag');
    await expectRevert(withdrawMargin(1_000_000), /margin/i);
    await postMargin(2_000_000);
    margin = await gate.account.marginState.fetch(marginPda);
    if (margin.flag) throw new Error('flag must clear after top-up');

    const seq3 = await pdaRun(searcherKp.publicKey, usdcMint, 3);
    await settleAccounts(seq3).rpc();
    margin = await gate.account.marginState.fetch(marginPda);
    if (Number(margin.grossExposure) !== 0) throw new Error(`gross=${margin.grossExposure}`);
    if (margin.flag) throw new Error('flag must clear after settle');
    if ((await bal(reserve)) !== 930_000_000) throw new Error(`reserve=${await bal(reserve)}`);
  });

  it('re-posts collateral through the CCP window', async () => {
    await postMargin(5_000_000);
    const margin = await gate.account.marginState.fetch(marginPda);
    if (Number(margin.collateral) !== 7_000_000) throw new Error(`collateral=${margin.collateral}`);
    if (Number(margin.grossExposure) !== 0) throw new Error(`gross=${margin.grossExposure}`);
    if (margin.flag) throw new Error('flag must stay clear');
  });
});

describe('gate: CCP risk controls + DIF treasury', () => {
  it('dif accrued from both wins and collects to the treasury', async () => {
    const cfg = await gate.account.gateConfig.fetch(configPda);
    if (cfg.difLedger.toString() !== '30000000') throw new Error(`dif=${cfg.difLedger}`);
    const difTreasury = await pdaDifTreasury();
    const difAta = await ata(usdcMint, difTreasury, true);
    await gate.methods
      .collectDif(new anchor.BN(30_000_000))
      .accounts({ config: configPda, reserveVault: reserve, difVault: difAta, difTreasury, assetMint: usdcMint, authority: admin, tokenProgram: splToken.TOKEN_PROGRAM_ID })
      .rpc();
    if ((await bal(reserve)) !== 900_000_000) throw new Error(`reserve=${await bal(reserve)}`);
    if ((await bal(difAta)) !== 30_000_000) throw new Error('dif not swept');
    const cfg2 = await gate.account.gateConfig.fetch(configPda);
    if (cfg2.difLedger.toString() !== '0') throw new Error('dif ledger not zeroed');
  });

  it('emergency halt blocks allocations until lifted', async () => {
    await gate.methods
      .setRiskConfig(true, null, null, null)
      .accounts({ config: configPda, risk: riskPda, authority: admin })
      .rpc();
    const seq3 = await pdaRun(searcherKp.publicKey, usdcMint, 4);
    await expectRevert(pullAccounts(seq3, 100_000_000).rpc(), /emergency/i);
    await gate.methods
      .setRiskConfig(false, null, null, null)
      .accounts({ config: configPda, risk: riskPda, authority: admin })
      .rpc();
    const risk = await gate.account.riskState.fetch(riskPda);
    if (risk.emergencyHalt) throw new Error('halt not lifted');
  });

  it('exposure + concentration caps are enforced', async () => {
    await gate.methods
      .setRiskConfig(null, new anchor.BN(50_000_000), null, null)
      .accounts({ config: configPda, risk: riskPda, authority: admin })
      .rpc();
    const seq3 = await pdaRun(searcherKp.publicKey, usdcMint, 4);
    await expectRevert(pullAccounts(seq3, 100_000_000).rpc(), /exposure/i);
    await gate.methods
      .setRiskConfig(null, new anchor.BN(MAX_EXPOSURE), null, null)
      .accounts({ config: configPda, risk: riskPda, authority: admin })
      .rpc();

    await gate.methods
      .setRiskConfig(null, null, 1_000, null)
      .accounts({ config: configPda, risk: riskPda, authority: admin })
      .rpc();
    await expectRevert(pullAccounts(seq3, 100_000_000).rpc(), /share/i);
    await gate.methods
      .setRiskConfig(null, null, MAX_SHARE_BPS, null)
      .accounts({ config: configPda, risk: riskPda, authority: admin })
      .rpc();
  });

  it('JLF breaker trips at 50% drawdown, unlocks on top-up, lending resumes', async () => {
    const seq4 = await pdaRun(searcherKp.publicKey, usdcMint, 4);
    await pullAccounts(seq4, 300_000_000).rpc();
    await splToken.transfer(conn, searcherKp, searcherUsdc, adminUsdc, searcherKp.publicKey, 300_000_000, []);

    await forceCloseRun(seq4);
    let risk = await gate.account.riskState.fetch(riskPda);
    if (risk.jlfLosses.toString() !== '400000000') throw new Error(`jlf=${risk.jlfLosses}`);
    if (!risk.halted) throw new Error('breaker must trip at exactly 50%');

    const seq5 = await pdaRun(searcherKp.publicKey, usdcMint, 5);
    await expectRevert(pullAccounts(seq5, 100_000_000).rpc(), /breaker/i);

    await gate.methods
      .setRiskConfig(null, null, null, new anchor.BN(400_000_000))
      .accounts({ config: configPda, risk: riskPda, authority: admin })
      .rpc();
    risk = await gate.account.riskState.fetch(riskPda);
    if (risk.jlfCapital.toString() !== '1200000000') throw new Error(`jlf cap=${risk.jlfCapital}`);
    if (risk.halted) throw new Error('breaker must unlock after top-up');

    await pullAccounts(seq5, 100_000_000).rpc();
    await splToken.mintTo(conn, provider.wallet.payer, usdcMint, searcherUsdc, admin, 20_000_000, [], { commitment: 'confirmed' });
    await settleAccounts(seq5).rpc();

    const cfg = await gate.account.gateConfig.fetch(configPda);
    if (cfg.realizedYield.toString() !== '136000000') throw new Error(`realized=${cfg.realizedYield}`);
    if (cfg.difLedger.toString() !== '4000000') throw new Error(`dif=${cfg.difLedger}`);
    if (cfg.timeoutCount.toString() !== '2') throw new Error(`timeouts=${cfg.timeoutCount}`);
    risk = await gate.account.riskState.fetch(riskPda);
    if (risk.halted) throw new Error('halted should stay false');
    if (risk.committedTotal.toString() !== '0') throw new Error('final commit not zero');
    if ((await bal(reserve)) !== 620_000_000) throw new Error(`final reserve=${await bal(reserve)}`);

    const vaultPda2 = await pdaVault(usdcMint);
    const vaultUsdc2 = await ata(usdcMint, vaultPda2, true);
    await gate.methods
      .sweepProfits(new anchor.BN(16_000_000))
      .accounts({ config: configPda, reserveVault: reserve, toVault: vaultUsdc2, assetMint: usdcMint, signer: admin, tokenProgram: splToken.TOKEN_PROGRAM_ID })
      .rpc();
    const cfg2 = await gate.account.gateConfig.fetch(configPda);
    if (cfg2.sweptYield.toString() !== '136000000') throw new Error(`swept=${cfg2.sweptYield}`);
    if ((await bal(reserve)) !== 604_000_000) throw new Error(`final reserve=${await bal(reserve)}`);
  });
});

describe('gate: pool supply pump (cluster 3 -> 2)', () => {
  let vaultPda, vaultUsdc, sharesPda, userShares;

  it('LPs re-fund the vault and register it as the gate lender', async () => {
    vaultPda = await pdaVault(usdcMint);
    sharesPda = await pdaShares(usdcMint);
    vaultUsdc = await ata(usdcMint, vaultPda, true);
    userShares = await ata(sharesPda, admin);
    await omni.methods
      .deposit(new anchor.BN(300_000_000))
      .accounts({
        vault: vaultPda, sharesMint: sharesPda, vaultUsdc, userUsdc: adminUsdc,
        userShares, usdcMint, user: admin, tokenProgram: splToken.TOKEN_PROGRAM_ID,
      })
      .rpc();
    const v = await omni.account.vaultState.fetch(vaultPda);
    if (v.gateLoan.toString() !== '0') throw new Error(`gateLoan=${v.gateLoan}`);
    await gate.methods
      .registerLender(vaultPda)
      .accounts({ config: configPda, authority: admin })
      .rpc();
    const cfg = await gate.account.gateConfig.fetch(configPda);
    if (cfg.lenderPool.toBase58() !== vaultPda.toBase58()) throw new Error('lender not registered');
  });

  it('deploy_supply pushes LP capital into the gate reserve, authority-gated', async () => {
    const beforeReserve = await bal(reserve);
    await omni.methods
      .deploySupply(new anchor.BN(200_000_000))
      .accounts({
        vault: vaultPda, gate: configPda, vaultUsdc, reserveVault: reserve, usdcMint,
        authority: admin, tokenProgram: splToken.TOKEN_PROGRAM_ID,
      })
      .rpc();
    const v = await omni.account.vaultState.fetch(vaultPda);
    if (v.gateLoan.toString() !== '200000000') throw new Error(`gateLoan=${v.gateLoan}`);
    if ((await bal(reserve)) !== beforeReserve + 200_000_000) throw new Error(`reserve=${await bal(reserve)}`);
    const rand = Keypair.generate();
    await airdrop(rand.publicKey);
    const v2 = await omni.account.vaultState.fetch(vaultPda);
    await expectRevert(
      omni.methods
        .deploySupply(new anchor.BN(50_000_000))
        .accounts({
          vault: vaultPda, gate: configPda, vaultUsdc, reserveVault: reserve, usdcMint,
          authority: rand.publicKey, tokenProgram: splToken.TOKEN_PROGRAM_ID,
        })
        .signers([rand])
        .rpc(),
      /authority only/i,
    );
    if (v2.gateLoan.toString() !== '200000000') throw new Error('gateLoan changed on unauthorized deploy');
    if ((await bal(reserve)) !== beforeReserve + 200_000_000) throw new Error('reserve moved on unauthorized deploy');
  });

  it('over-lending reverts against vault liquidity', async () => {
    const beforeReserve = await bal(reserve);
    await expectRevert(
      omni.methods
        .deploySupply(new anchor.BN(400_000_000))
        .accounts({
          vault: vaultPda, gate: configPda, vaultUsdc, reserveVault: reserve, usdcMint,
          authority: admin, tokenProgram: splToken.TOKEN_PROGRAM_ID,
        })
        .rpc(),
      /liquidity/i,
    );
    const v = await omni.account.vaultState.fetch(vaultPda);
    if (v.gateLoan.toString() !== '200000000') throw new Error(`gateLoan=${v.gateLoan}`);
    if ((await bal(reserve)) !== beforeReserve) throw new Error('reserve moved on revert');
  });

  it('searcher borrows the deployed supply and banks 8M net + 2M dif', async () => {
    const seq6 = await pdaRun(searcherKp.publicKey, usdcMint, 6);
    const beforeReserve = await bal(reserve);
    await pullAccounts(seq6, 50_000_000).rpc();
    await splToken.mintTo(conn, provider.wallet.payer, usdcMint, searcherUsdc, admin, 10_000_000, [], { commitment: 'confirmed' });
    await settleAccounts(seq6).rpc();
    if ((await bal(reserve)) !== beforeReserve + 10_000_000) throw new Error(`reserve=${await bal(reserve)}`);
    const cfg = await gate.account.gateConfig.fetch(configPda);
    if (cfg.realizedYield.toString() !== '144000000') throw new Error(`realized=${cfg.realizedYield}`);
    if (cfg.difLedger.toString() !== '6000000') throw new Error(`dif=${cfg.difLedger}`);
  });

  it('recall_supply cannot over-claim the loan and only the authority recalls', async () => {
    await expectRevert(
      omni.methods
        .recallSupply(new anchor.BN(300_000_000))
        .accounts({
          vault: vaultPda, gate: configPda, reserveVault: reserve, vaultUsdc, usdcMint,
          authority: admin, tokenProgram: splToken.TOKEN_PROGRAM_ID, gateProgram: gate.programId,
        })
        .rpc(),
      /ledger/i,
    );
    const v = await omni.account.vaultState.fetch(vaultPda);
    if (v.gateLoan.toString() !== '200000000') throw new Error('gateLoan changed on revert');
  });

  it('recall_supply repays principal to the vault through the gate CPI', async () => {
    const beforeReserve = await bal(reserve);
    const beforeVault = await bal(vaultUsdc);
    await omni.methods
      .recallSupply(new anchor.BN(200_000_000))
      .accounts({
        vault: vaultPda, gate: configPda, reserveVault: reserve, vaultUsdc, usdcMint,
        authority: admin, tokenProgram: splToken.TOKEN_PROGRAM_ID, gateProgram: gate.programId,
      })
      .rpc();
    const v = await omni.account.vaultState.fetch(vaultPda);
    if (v.gateLoan.toString() !== '0') throw new Error(`gateLoan=${v.gateLoan}`);
    if ((await bal(vaultUsdc)) !== beforeVault + 200_000_000) throw new Error('vault not repaid');
    if ((await bal(reserve)) !== beforeReserve - 200_000_000) throw new Error(`reserve=${await bal(reserve)}`);
  });

  it('repay_supply rejects unregistered lender targets', async () => {
    const bogus = Keypair.generate();
    await airdrop(bogus.publicKey);
    const bogusAta = await splToken.createAccount(conn, provider.wallet.payer, usdcMint, bogus.publicKey);
    await expectRevert(
      gate.methods
        .repaySupply(new anchor.BN(1_000_000))
        .accounts({ config: configPda, reserveVault: reserve, toVault: bogusAta, assetMint: usdcMint, tokenProgram: splToken.TOKEN_PROGRAM_ID })
        .rpc(),
      /registered lender/i,
    );
  });

  it('dif + yield cut settle on the pump and reserve reconciles to 604M', async () => {
    const difTreasury = await pdaDifTreasury();
    const difAta = await ata(usdcMint, difTreasury, true);
    await gate.methods
      .collectDif(new anchor.BN(2_000_000))
      .accounts({ config: configPda, reserveVault: reserve, difVault: difAta, difTreasury, assetMint: usdcMint, authority: admin, tokenProgram: splToken.TOKEN_PROGRAM_ID })
      .rpc();
    await gate.methods
      .sweepProfits(new anchor.BN(8_000_000))
      .accounts({ config: configPda, reserveVault: reserve, toVault: vaultUsdc, assetMint: usdcMint, signer: admin, tokenProgram: splToken.TOKEN_PROGRAM_ID })
      .rpc();
    const cfg = await gate.account.gateConfig.fetch(configPda);
    if (cfg.realizedYield.toString() !== '144000000') throw new Error(`realized=${cfg.realizedYield}`);
    if (cfg.sweptYield.toString() !== '144000000') throw new Error(`swept=${cfg.sweptYield}`);
    if (cfg.difLedger.toString() !== '4000000') throw new Error(`dif=${cfg.difLedger}`);
    if ((await bal(reserve)) !== 604_000_000) throw new Error(`reserve=${await bal(reserve)}`);
    if ((await bal(difAta)) !== 32_000_000) throw new Error(`dif treasury=${await bal(difAta)}`);
  });
});

describe('whirlpool venue: directed capture through the gate', () => {
  const { WhirlpoolVenue } = require('../services/sentinel/src/venues/whirlpool');
  const venueOwner = Keypair.generate();
  const noise = Keypair.generate();
  let venue, ledger, tokenB;
  let vsKp, vsState, vsMargin, vsUsdc, vsMarginEscrow, vsRun;
  const prevRealized = 144_000_000;
  const prevDif = 4_000_000;

  it('bootstrap pool with gate usdcMint', async () => {
    await airdrop(venueOwner.publicKey);
    await airdrop(noise.publicKey, 5);
    tokenB = await splToken.createMint(conn, provider.wallet.payer, admin, admin, 6);
    const ownerA = await splToken.createAccount(conn, provider.wallet.payer, usdcMint, venueOwner.publicKey);
    const ownerB = await splToken.createAccount(conn, provider.wallet.payer, tokenB, venueOwner.publicKey);
    await splToken.mintTo(conn, provider.wallet.payer, usdcMint, ownerA, admin, 10_000_000_000);
    await splToken.mintTo(conn, provider.wallet.payer, tokenB, ownerB, admin, 10_000_000_000);
    const noiseAta = await splToken.createAccount(conn, provider.wallet.payer, usdcMint, noise.publicKey);
    await splToken.mintTo(conn, provider.wallet.payer, usdcMint, noiseAta, admin, 50_000_000);
    venue = await WhirlpoolVenue.connect(conn, venueOwner);
    ledger = await venue.bootstrap(usdcMint, tokenB);
  });

  it('registers searcher + pulls 100M', async () => {
    vsKp = Keypair.generate();
    await airdrop(vsKp.publicKey);
    vsState = await pdaSearcherState(vsKp.publicKey);
    vsMargin = await pdaMargin(vsKp.publicKey);
    const runVaultKp = Keypair.generate();
    vsUsdc = await splToken.createAccount(conn, provider.wallet.payer, usdcMint, vsKp.publicKey, runVaultKp);
    const vsMarginVault = await ata(usdcMint, vsKp.publicKey);
    vsMarginEscrow = await ata(usdcMint, vsMargin, true);
    await gate.methods
      .initSearcher(10_000, MAINT_BPS, true)
      .accounts({ config: configPda, searcherState: vsState, margin: vsMargin, searcher: vsKp.publicKey, authority: admin, systemProgram: SystemProgram.programId })
      .rpc();
    await splToken.mintTo(conn, provider.wallet.payer, usdcMint, vsMarginVault, admin, 100_000_000);
    await gate.methods
      .postMargin(new anchor.BN(100_000_000))
      .accounts({ config: configPda, margin: vsMargin, searcher: vsKp.publicKey, searcherMarginVault: vsMarginVault, marginEscrow: vsMarginEscrow, assetMint: usdcMint, tokenProgram: splToken.TOKEN_PROGRAM_ID })
      .signers([vsKp])
      .rpc();
    const cfg = await gate.account.gateConfig.fetch(configPda);
    vsRun = await pdaRun(vsKp.publicKey, usdcMint, Number(cfg.runSeq));
    await gate.methods
      .pullCap(new anchor.BN(100_000_000))
      .accounts({ config: configPda, searcherState: vsState, searcher: vsKp.publicKey, margin: vsMargin, reserveVault: reserve, searcherVault: vsUsdc, assetMint: usdcMint, run: vsRun, risk: riskPda, tokenProgram: splToken.TOKEN_PROGRAM_ID, clock: SYSVAR_CLOCK_PUBKEY, systemProgram: SystemProgram.programId })
      .signers([vsKp])
      .rpc();
    if ((await bal(vsUsdc)) !== 100_000_000) throw new Error('searcher did not receive');
  });

  it('directed capture + settle yields verified profit', async () => {
    const venueOwnerUsdc = splToken.getAssociatedTokenAddressSync(usdcMint, venueOwner.publicKey);
    await splToken.transfer(conn, vsKp, vsUsdc, venueOwnerUsdc, vsKp.publicKey, 100_000_000, []);
    const result = await venue.captureFlow(ledger, usdcMint, new anchor.BN(100_000_000), { source: noise, amount: new anchor.BN(50_000_000) });
    if (!result.noiseSig) throw new Error('noise sig missing');
    if (result.netUsdcPnl <= 0) throw new Error(`no profit: ${result.netUsdcPnl}`);
    const transferBack = 100_000_000 + result.netUsdcPnl;
    await splToken.transfer(conn, venueOwner, venueOwnerUsdc, vsUsdc, venueOwner.publicKey, transferBack, []);
    await gate.methods
      .settleRun()
      .accounts({ config: configPda, run: vsRun, searcher: vsKp.publicKey, reserveVault: reserve, searcherVault: vsUsdc, assetMint: usdcMint, searcherState: vsState, margin: vsMargin, risk: riskPda, tokenProgram: splToken.TOKEN_PROGRAM_ID, clock: SYSVAR_CLOCK_PUBKEY })
      .signers([vsKp])
      .rpc();
    const run = await gate.account.run.fetch(vsRun);
    if (run.status !== 1) throw new Error('run not settled');
    const cfg = await gate.account.gateConfig.fetch(configPda);
    const expectedProfit = result.netUsdcPnl;
    const expectedRealized = prevRealized + Math.floor(expectedProfit * 8000 / 10000);
    const expectedDif = prevDif + Math.floor(expectedProfit * 2000 / 10000);
    const realized = Number(cfg.realizedYield);
    const dif = Number(cfg.difLedger);
    if (Math.abs(realized - expectedRealized) > 1) throw new Error(`realized=${realized} expected=${expectedRealized}`);
    if (Math.abs(dif - expectedDif) > 1) throw new Error(`dif=${dif} expected=${expectedDif}`);
  });
});

describe('phoenix venue: directed capture through the gate', () => {
  const { PhoenixVenue } = require('../services/sentinel/src/venues/phoenix');
  const venueOwner = Keypair.generate();
  const noise = Keypair.generate();
  let venue, ledger, baseMint;
  let vsKp, vsState, vsMargin, vsUsdc, vsMarginEscrow, vsRun;
  let prevRealized = 144_000_000;
  let prevDif = 4_000_000;

  it('bootstrap phoenix market with gate usdcMint', async () => {
    await airdrop(venueOwner.publicKey);
    await airdrop(noise.publicKey, 2);
    baseMint = await splToken.createMint(conn, provider.wallet.payer, admin, admin, 6);
    const ownerQuoteAta = await ata(usdcMint, venueOwner.publicKey);
    const ownerBaseAta = await ata(baseMint, venueOwner.publicKey);
    await splToken.mintTo(conn, provider.wallet.payer, usdcMint, ownerQuoteAta, admin, 2_000_000_000_000);
    await splToken.mintTo(conn, provider.wallet.payer, baseMint, ownerBaseAta, admin, 30_000_000_000);
    const noiseQuoteAta = await ata(usdcMint, noise.publicKey);
    await splToken.mintTo(conn, provider.wallet.payer, usdcMint, noiseQuoteAta, admin, 250_000_000_000);
    venue = await PhoenixVenue.connect(conn, venueOwner);
    ledger = await venue.bootstrap(baseMint, usdcMint, {
      seed: { bidPrice: 99.9, askPrice: 100.1, bidSize: 5000, askSize: 5000 },
    });
  });

  it('registers searcher + pulls 100M', async () => {
    const cfgPrev = await gate.account.gateConfig.fetch(configPda);
    prevRealized = Number(cfgPrev.realizedYield);
    prevDif = Number(cfgPrev.difLedger);
    vsKp = Keypair.generate();
    await airdrop(vsKp.publicKey);
    vsState = await pdaSearcherState(vsKp.publicKey);
    vsMargin = await pdaMargin(vsKp.publicKey);
    const runVaultKp = Keypair.generate();
    vsUsdc = await splToken.createAccount(conn, provider.wallet.payer, usdcMint, vsKp.publicKey, runVaultKp);
    const vsMarginVault = await ata(usdcMint, vsKp.publicKey);
    vsMarginEscrow = await ata(usdcMint, vsMargin, true);
    await gate.methods
      .initSearcher(10_000, MAINT_BPS, true)
      .accounts({ config: configPda, searcherState: vsState, margin: vsMargin, searcher: vsKp.publicKey, authority: admin, systemProgram: SystemProgram.programId })
      .rpc();
    await splToken.mintTo(conn, provider.wallet.payer, usdcMint, vsMarginVault, admin, 100_000_000);
    await gate.methods
      .postMargin(new anchor.BN(100_000_000))
      .accounts({ config: configPda, margin: vsMargin, searcher: vsKp.publicKey, searcherMarginVault: vsMarginVault, marginEscrow: vsMarginEscrow, assetMint: usdcMint, tokenProgram: splToken.TOKEN_PROGRAM_ID })
      .signers([vsKp])
      .rpc();
    const cfg = await gate.account.gateConfig.fetch(configPda);
    vsRun = await pdaRun(vsKp.publicKey, usdcMint, Number(cfg.runSeq));
    await gate.methods
      .pullCap(new anchor.BN(100_000_000))
      .accounts({ config: configPda, searcherState: vsState, searcher: vsKp.publicKey, margin: vsMargin, reserveVault: reserve, searcherVault: vsUsdc, assetMint: usdcMint, run: vsRun, risk: riskPda, tokenProgram: splToken.TOKEN_PROGRAM_ID, clock: SYSVAR_CLOCK_PUBKEY, systemProgram: SystemProgram.programId })
      .signers([vsKp])
      .rpc();
    if ((await bal(vsUsdc)) !== 100_000_000) throw new Error('searcher did not receive');
  });

  it('directed capture + settle yields verified profit', async () => {
    const venueOwnerUsdc = splToken.getAssociatedTokenAddressSync(usdcMint, venueOwner.publicKey);
    await splToken.transfer(conn, vsKp, vsUsdc, venueOwnerUsdc, vsKp.publicKey, 100_000_000, []);
    const result = await venue.captureFlow(ledger, usdcMint, 100_000_000, { source: noise, amount: 200_200_000_000 });
    if (result.netQuotePnl <= 0) throw new Error(`no profit: ${result.netQuotePnl}`);
    const transferBack = 100_000_000 + result.netQuotePnl;
    await splToken.transfer(conn, venueOwner, venueOwnerUsdc, vsUsdc, venueOwner.publicKey, transferBack, []);
    await gate.methods
      .settleRun()
      .accounts({ config: configPda, run: vsRun, searcher: vsKp.publicKey, reserveVault: reserve, searcherVault: vsUsdc, assetMint: usdcMint, searcherState: vsState, margin: vsMargin, risk: riskPda, tokenProgram: splToken.TOKEN_PROGRAM_ID, clock: SYSVAR_CLOCK_PUBKEY })
      .signers([vsKp])
      .rpc();
    const run = await gate.account.run.fetch(vsRun);
    if (run.status !== 1) throw new Error('run not settled');
    const cfg = await gate.account.gateConfig.fetch(configPda);
    const expectedProfit = result.netQuotePnl;
    const expectedRealized = prevRealized + Math.floor((expectedProfit * 8000) / 10000);
    const expectedDif = prevDif + Math.floor((expectedProfit * 2000) / 10000);
    const realized = Number(cfg.realizedYield);
    const dif = Number(cfg.difLedger);
    if (Math.abs(realized - expectedRealized) > 1) throw new Error(`realized=${realized} expected=${expectedRealized}`);
    if (Math.abs(dif - expectedDif) > 1) throw new Error(`dif=${dif} expected=${expectedDif}`);
  });
});