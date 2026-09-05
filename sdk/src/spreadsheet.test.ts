import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_INPUTS,
  computeWorkbook,
  referenceWorkbook,
  stressTestSpreadsheet,
  buildWorkbookCsv,
  excelSlotsPerYear,
  excelEligibleSlots,
  excelActiveVolume,
  excelMicroPremium,
  excelGrossRevenue,
  excelNetRevenue,
  excelLpPayout,
} from './spreadsheet';

test('B16/B17 — slot clock and the 80% Jito landing gate', () => {
  const wb = referenceWorkbook();
  assert.equal(wb.b16, 31_536_000 / 0.4); // = 78,840,000
  assert.equal(wb.b16, 78_840_000);
  assert.equal(wb.b17, 63_072_000); // 78,840,000 × 0.80
  assert.equal(excelSlotsPerYear(), 78_840_000);
  assert.equal(excelEligibleSlots(0.8), 63_072_000);
});

test('B18–B20 — capacity cages and baseline utilization', () => {
  const wb = referenceWorkbook();
  assert.equal(wb.b18, 6_000_000); // 60% of $10M
  assert.equal(wb.b19, 1_500_000); // 15% of $10M
  assert.equal(wb.b20, 2_400_000); // 40% of $6M
  assert.equal(excelActiveVolume(DEFAULT_INPUTS), 2_400_000);
});

test('B21–B26 — the revenue waterfall (reference chain)', () => {
  const wb = referenceWorkbook();
  // Micro-fee/slot ≈ $0.0073059 (the pinned F_slot band; sheet displays 0.0073055).
  assert.ok(Math.abs(wb.b21 - 0.0073059) < 1e-5, `b21=${wb.b21}`);
  assert.equal(excelMicroPremium(DEFAULT_INPUTS), 576_000 / 78_840_000);
  assert.equal(wb.b22, 460_800);
  assert.equal(wb.b23, 6_912);
  assert.equal(wb.b24, 403_888);
  assert.equal(wb.b25, 80_777.6);
  assert.ok(Math.abs(wb.b26 - 323_110.4) < 1e-6);
  assert.equal(excelNetRevenue(DEFAULT_INPUTS), 460_800 - 6_912 - 50_000);
  assert.equal(excelLpPayout(DEFAULT_INPUTS), 323_110.4);
});

test('B29–B34 — tranche split isolates the senior hurdle', () => {
  const wb = referenceWorkbook();
  assert.equal(wb.b29, 7_000_000); // senior principal
  assert.equal(wb.b30, 3_000_000); // junior first-loss layer
  assert.equal(wb.b31, 315_000); // 4.5% fixed hurdle on $7M
  assert.equal(wb.b32, 0.045); // senior APY == hurdle (isolation proof)
  assert.ok(Math.abs(wb.b33 - 8_110.4) < 1e-6, `b33=${wb.b33}`); // 323,110.40 − 315,000
  assert.ok(Math.abs(wb.b34 - 8_110.4 / 3_000_000) < 1e-9); // ≈0.27%
});

test('closed-form vs per-slot formula-D routes reconcile <1%', () => {
  const wb = referenceWorkbook();
  assert.equal(wb.b22, 460_800);
  assert.equal(wb.b22PerSlotRouteUsd, 460_740.96); // pinned velocity route
  assert.equal(wb.reconciles, true);
  const drift = Math.abs(wb.b22 - wb.b22PerSlotRouteUsd) / wb.b22;
  assert.ok(drift < 0.01, `drift=${drift}`);
});

test('stress: 90% network drop exposes the infra breakeven', () => {
  const s = stressTestSpreadsheet({ jitoLanding: 0.1 });
  assert.equal(s.workbook.b17, 7_884_000); // 10% of slots
  assert.equal(s.workbook.b22, 57_600); // 2.4M × 0.24 × 0.10
  assert.equal(s.workbook.b24, 57_600 - 864 - 50_000); // still clears infra
  assert.ok(s.netRevenueCoversInfra, 'net revenue must cover the 50k infrastructure line');
});

test('stress: 100% utilization lifts junior APY (formula-exact 18.43%)', () => {
  const s = stressTestSpreadsheet({ activeUtil: 1.0 });
  assert.equal(s.workbook.b20, 6_000_000);
  assert.equal(s.workbook.b22, 1_152_000);
  assert.equal(s.workbook.b24, 1_084_720);
  const juniorApy = s.workbook.b34 * 100;
  // Formula-exact result. NOTE: the published quick-scenario blurb says 19.11% —
  // that number is inconsistent with the workbook's own formulas; the true value
  // is 18.4259% (junior residual $552,776 / $3,000,000). We pin the formula.
  assert.ok(Math.abs(juniorApy - 18.4259) < 0.01, `juniorApy=${juniorApy}`);
});

test('buildWorkbookCsv emits the ready-to-paste sheet', () => {
  const csv = buildWorkbookCsv();
  assert.match(csv, /Total Pool Size \(P\),B2,10000000/);
  assert.match(csv, /Gross Annualized Revenue \(\$\),B22/);
  assert.match(csv, /Junior LP Actual Net APY,B34/);
  assert.match(csv, /Value,Format,Description/);
  const lines = csv.split('\n');
  assert.ok(lines.length >= 32);
});

test('inputsToParams round-trips the audited reference pool', () => {
  const wb = referenceWorkbook();
  const csv = buildWorkbookCsv();
  assert.ok(csv.includes(`${wb.b26}`));
  assert.deepEqual(computeWorkbook(), referenceWorkbook());
});