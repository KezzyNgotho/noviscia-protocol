import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DAYS_PER_YEAR,
  DEFAULT_GROWTH_HORIZONS,
  projectEquitySimple,
  projectEquityCompound,
  buildGrowthSeries,
  growthMetrics,
} from './growth';

test('simple APY projection is linear over a year', () => {
  assert.equal(projectEquitySimple(1000, 10, 0), 1000);
  assert.ok(Math.abs(projectEquitySimple(1000, 10, DAYS_PER_YEAR) - 1100) < 1e-9);
  assert.ok(Math.abs(projectEquitySimple(1000, 10, DAYS_PER_YEAR / 2) - 1050) < 1e-9);
  assert.ok(Math.abs(projectEquitySimple(500, 13, 30) - 500 * (1 + 0.13 * 30 / 365)) < 1e-9);
});

test('compound projection outgrows simple at the same APY (365d)', () => {
  const simple = projectEquitySimple(1000, 10, DAYS_PER_YEAR);
  const compound = projectEquityCompound(1000, 10, DAYS_PER_YEAR);
  assert.ok(Math.abs(compound - 1105.1559) < 0.01);
  assert.ok(compound > simple);
  assert.ok(Math.abs(simple - 1100) < 1e-9);
});

test('negative APY is clamped flat (the vault never projects a loss rate)', () => {
  assert.equal(projectEquitySimple(1000, -5, 30), 1000);
  assert.equal(projectEquityCompound(1000, -50, 30), 1000);
});

test('series: 6 default horizons, today pinned to live equity, projections rising', () => {
  const s = buildGrowthSeries(1050, 1000, 10);
  assert.equal(s.length, DEFAULT_GROWTH_HORIZONS.length);
  assert.deepEqual(s.map((p) => p.days), [0, 7, 30, 90, 180, 365]);
  assert.deepEqual(s.map((p) => p.label), ['Today', '1W', '1M', '3M', '6M', '1Y']);

  // Today's point is exactly the live equity; principal is constant everywhere.
  assert.equal(s[0].equityUsdc, 1050);
  assert.ok(s.every((p) => p.principalUsdc === 1000));

  // year-end = 1050 × 1.10 → yield 155 above the 1000 basis.
  assert.ok(Math.abs(s[s.length - 1].equityUsdc - 1155) < 1e-9);
  assert.ok(Math.abs(s[s.length - 1].yieldUsdc - 155) < 1e-9);
  assert.equal(s[0].yieldUsdc, 50); // max(0, 1050 − 1000)

  // Monotonic: with APY > 0 the projected equity strictly increases.
  for (let i = 1; i < s.length; i++) assert.ok(s[i].equityUsdc > s[i - 1].equityUsdc);
});

test('series: APY 0 and num-like floats stay flat and deterministic', () => {
  const flat = buildGrowthSeries(940, 940, 0);
  assert.ok(flat.every((p) => p.equityUsdc === 940 && p.yieldUsdc === 0));
  const a = buildGrowthSeries(1.5, 1, 8.25);
  const b = buildGrowthSeries(1.5, 1, 8.25);
  assert.deepEqual(a, b);
});

test('growthMetrics: yield realized so far + projections at 30/90/365', () => {
  const m = growthMetrics(1050, 1000, 10);
  assert.ok(Math.abs(m.netYieldUsdc - 50) < 1e-9);
  assert.ok(Math.abs(m.netYieldPct - 5) < 1e-9);
  assert.ok(Math.abs(m.dailyUsdc - (1050 * 0.1) / 365) < 1e-9);
  assert.ok(Math.abs(m.monthlyUsdc - (1050 * 0.1 * 30) / 365) < 1e-9);
  assert.ok(Math.abs(m.project30dUsdc - 1050 * 0.1 * (30 / 365)) < 1e-9);
  assert.ok(Math.abs(m.project90dUsdc - 1050 * 0.1 * (90 / 365)) < 1e-9);
  assert.ok(Math.abs(m.project365dUsdc - 105) < 1e-9);
  assert.ok(Math.abs(m.projectedEquity365dUsdc - 1155) < 1e-9);
  assert.equal(m.doublingDays, 3650); // 100% / 10% = 10 years
});

test('growthMetrics: a loss is reported honestly (negative yield)', () => {
  const m = growthMetrics(900, 1000, 10);
  assert.equal(m.netYieldUsdc, -100);
  assert.equal(m.netYieldPct, -10);
  // Projections continue to accrue on current equity (900), not the deposit.
  assert.ok(Math.abs(m.projectedEquity365dUsdc - 990) < 1e-9);
});

test('growthMetrics: no position → zeroed metrics, no doubling horizon', () => {
  const m = growthMetrics(0, 0, 12);
  assert.equal(m.netYieldUsdc, 0);
  assert.equal(m.netYieldPct, 0);
  assert.equal(m.dailyUsdc, 0);
  assert.equal(m.project365dUsdc, 0);
  assert.ok(m.doublingDays !== null); // APY positive → doubling defined even with 0 equity
});

test('growthMetrics: flat at 0% APY', () => {
  const m = growthMetrics(1050, 1000, 0);
  assert.equal(m.dailyUsdc, 0);
  assert.equal(m.project30dUsdc, 0);
  assert.equal(m.projectedEquity365dUsdc, 1050);
  assert.equal(m.doublingDays, null);
});