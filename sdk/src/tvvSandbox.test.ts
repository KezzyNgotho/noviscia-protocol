import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runTvvSandbox,
  buildSandboxConfig,
  DEFAULT_POOL_USD,
  type S1DeskConfig,
  type S2DeskConfig,
} from './tvvSandbox';
import { grossApyTenthsBps, grossApyTenthsBpsAtActiveVolume } from './velocity';
import { referenceTvvParams } from './economics';

// Reference: $10,000,000 pool in base-6 units.
const POOL = DEFAULT_POOL_USD; // 1e13 units

function s1Desk(overrides: Partial<S1DeskConfig> = {}): S1DeskConfig {
  return { id: 'alpha', drawPerSlot: 1_000_000_000, tollBps: 5, landingBps: 8_000, ...overrides };
}

function s2Desk(overrides: Partial<S2DeskConfig> = {}): S2DeskConfig {
  return {
    id: 'gamma',
    limitUsd: Math.floor(POOL * 0.6),
    grossPerWindow: 250_000_000_000,
    marginBps: 3_000,
    tollBps: 5,
    defaultAtSlot: null,
    ...overrides,
  };
}

test('sandbox is deterministic for a given seed', () => {
  const cfg = { s1: [s1Desk()], s2: [s2Desk()], days: 1, seed: 42 };
  const a = runTvvSandbox(cfg);
  const b = runTvvSandbox(cfg);
  assert.deepEqual(
    [a.slot, a.totalAssets, a.clearedS1, a.clearedS2, a.grossTolls, a.feesToPool, a.defaultFundUsd, a.impliedApyBps],
    [b.slot, b.totalAssets, b.clearedS1, b.clearedS2, b.grossTolls, b.feesToPool, b.defaultFundUsd, b.impliedApyBps],
  );
  assert.notEqual(a.clearedS1 + a.clearedS2, 0);
});

test('S1 is atomic and lossless (returns same slot, no standing exposure)', () => {
  const r = runTvvSandbox({ s1: [s1Desk({ landingBps: 10_000, tollBps: 5 })], days: 1, seed: 7 });
  assert.ok(r.clearedS1 > 0, 'S1 cleared volume');
  // A single slot's draw returned == the same slot's draw (net = toll only).
  assert.equal(r.losses, 0);
  assert.equal(r.defaults, 0);
  assert.equal(r.frozen.length, 0);
  // No S2 sleeve engaged.
  assert.equal(r.clearedS2, 0);
  // Every booked fee physically entered the vault.
  assert.equal(r.backingShortfall, 0);
  assert.equal(r.backingHeld, true);
});

test('S1 accrues yield and the vault stays cash-backed', () => {
  const r = runTvvSandbox({
    s1: [s1Desk({ drawPerSlot: 1_000_000_000_000, landingBps: 10_000, tollBps: 5 })],
    days: 1,
    seed: 3,
  });
  assert.ok(r.grossTolls > 0, 'tolls collected');
  assert.ok(r.totalAssets > POOL, 'NAV grew past the initial pool');
  // Accounting invariant: everything booked to NAV is physically in the vault.
  assert.ok(
    r.vaultCash >= r.totalAssets + r.defaultFundUsd + r.insuranceUsd,
    `cash backs NAV (cash=${r.vaultCash}, assets+reserves=${r.totalAssets + r.defaultFundUsd + r.insuranceUsd})`,
  );
});

test('S2 intraday netting is margin-floored and cash-backed', () => {
  const r = runTvvSandbox({
    s2: [s2Desk({ grossPerWindow: 500_000_000_000 })],
    days: 1,
    seed: 11,
  });
  assert.ok(r.clearedS2 > 0, 'S2 cleared volume');
  assert.ok(r.grossTolls > 0, 'S2 window tolls settled');
  assert.equal(r.losses, 0, 'no defaults in a clean run');
  assert.equal(r.backingHeld, true);
  assert.equal(r.backingShortfall, 0);
});

test('more flow brings more yield (utilization-linear)', () => {
  const low = runTvvSandbox({ s2: [s2Desk({ grossPerWindow: 250_000_000_000 })], days: 1, seed: 5 });
  const high = runTvvSandbox({ s2: [s2Desk({ grossPerWindow: 1_000_000_000_000 })], days: 1, seed: 5 });
  assert.ok(
    high.impliedApyBps > low.impliedApyBps,
    `APY should grow with flow (low=${low.impliedApyBps}b, high=${high.impliedApyBps}b)`,
  );
  // 4× flow ⇒ ≈4× tolls (integer floors only).
  const ratio = high.grossTolls / low.grossTolls;
  assert.ok(ratio > 3.5 && ratio < 4.5, `4x flow → ~4x tolls (got ${ratio})`);
});

test('defaults flow the waterfall and the protected tranche respects its loss cap', () => {
  const lossCapBps = 2_000;
  const catastrophic = 50_000_000_000_000; // $50M — beyond margin, cap, every layer
  const r = runTvvSandbox({
    s1: [s1Desk({ drawPerSlot: 1_000_000_000, landingBps: 10_000 })],
    s2: [s2Desk({ defaultAtSlot: Math.floor(216_000 / 2), defaultLossUsd: catastrophic })],
    days: 1,
    seed: 9,
    lossCapBps,
  });
  assert.ok(r.defaults >= 1, 'default recorded');
  assert.ok(r.losses > 0, 'loss recorded');
  const protectedHaircut = POOL - r.protectedNav;
  const capUsd = Math.floor(POOL * lossCapBps / 10_000);
  assert.ok(
    protectedHaircut <= capUsd,
    `protected tranche absorbed ≤ ${lossCapBps}bps of its NAV (haircut=${protectedHaircut}, cap=${capUsd})`,
  );
  // Margin was eaten first, before any layer.
  assert.equal(r.backingShortfall, 0);
});

test('phantom-nav repro breaks the cash-backing invariant (CRIT-2 audit proof)', () => {
  const same = (mode: 'cash-backed' | 'phantom-nav') =>
    runTvvSandbox({ s2: [s2Desk({ grossPerWindow: 500_000_000_000 })], days: 1, seed: 21, mode });
  const cash = same('cash-backed');
  const phantom = same('phantom-nav');
  assert.equal(cash.backingHeld, true);
  assert.equal(phantom.backingHeld, false);
  assert.ok(phantom.backingShortfall > 0, 'unbacked NAV detected');
  assert.ok(phantom.totalAssets > cash.totalAssets, 'phantom books MORE NAV than cash on the same flow');
});

test('sandbox reconciles to the closed-form velocity model (reference $460,800 gross)', () => {
  // One S2 desk clearing $2.525M gross/day at 5bps ⇒ $1,262/day ⇒ $460,800/yr.
  const grossPerWindow = 2_525_000_000_000;
  const r = runTvvSandbox({ s2: [s2Desk({ grossPerWindow })], days: 1, seed: 2 });
  const expectGrossUsdCents = 46_080_000n; // $460,800
  // units ($1e-6) → cents: divide by 10,000; annualize over 365 windows.
  const sandboxAnnualCents = (BigInt(r.grossTolls) * 365n) / 10_000n;
  const relErr = Math.abs(Number(((sandboxAnnualCents - expectGrossUsdCents) * 100n) / expectGrossUsdCents));
  assert.ok(relErr < 1, `sandbox annual gross ≈ closed-form (relErr ${relErr}%)`);

  // The gross APY must close to the velocity module's closed form (4.608%);
  // net-of-carve APY (DF/insurance targets) stays below it, above zero.
  const vel = Number(grossApyTenthsBps(referenceTvvParams())); // 4608 tenths-bps
  const grossApyTenths = Number((BigInt(r.grossTolls) * 365n * 100_000n) / BigInt(r.totalAssets + r.defaultFundUsd + r.insuranceUsd));
  assert.ok(
    Math.abs(grossApyTenths - vel) / vel < 0.02,
    `sandbox gross APY ≈ velocity closed-form (sandbox=${grossApyTenths}tbps, closed=${vel}tbps)`,
  );
  assert.ok(r.impliedApyBps > 0 && r.impliedApyBps * 10 < grossApyTenths, 'net-of-carve APY < gross APY');

  // Reference 90/10 split: treasury got ~10% of gross, feesToPool ~90% minus carves.
  assert.ok(r.treasuryUsd > 0 && r.treasuryUsd < r.grossTolls / 10 + r.grossTolls / 5);
});

test('S1+S2 combined yields more than S1 alone on the same pool', () => {
  const s1Only = runTvvSandbox({ s1: [s1Desk({ drawPerSlot: 500_000_000_000, landingBps: 10_000 })], days: 1, seed: 13 });
  const combined = runTvvSandbox({
    s1: [s1Desk({ drawPerSlot: 500_000_000_000, landingBps: 10_000 })],
    s2: [s2Desk({ grossPerWindow: 250_000_000_000 })],
    days: 1,
    seed: 13,
  });
  assert.ok(
    combined.impliedApyBps > s1Only.impliedApyBps,
    `two sleeves beat one (S1=${s1Only.impliedApyBps}b, S1+S2=${combined.impliedApyBps}b)`,
  );
  assert.ok(combined.clearedS1 > 0 && combined.clearedS2 > 0, 'both sleeves cleared volume');
});

test('config builder snaps to documented caps', () => {
  const cfg = buildSandboxConfig({});
  assert.equal(cfg.poolUsd, 10_000_000_000_000);
  assert.equal(cfg.lossCapBps, 2_000);
  assert.equal(cfg.mode, 'cash-backed');
  assert.equal(cfg.seed, 1);
});