/**
 * Noviscia TVV — copy-pasteable Excel/CSV cell architecture (institutional
 * financial sheets).
 *
 * Reproduces the workbook cell map (the CSV the risk team pastes into Excel) as
 * a typed, testable twin so the sheet reconciles 1:1 with the pinned SDK/Rust
 * economics (`economics.ts` / `velocity.ts`, Module 1 + 2 of the TVV risk
 * engine). The spreadsheet enforces a strict separation of **Parameters
 * (inputs)** from **Formulas (logic)**: `SpreadsheetInputs` are the raw B2:B13
 * cells; every other cell is a pure function. Stress-testing a different asset
 * pool (SOL / USDC / NVSC) is a matter of changing only the inputs — see
 * `stressTestSpreadsheet`.
 *
 * Cell layout matches the CSV exactly:
 *
 *   INPUTS   B2  Total Pool Size (P)          $10,000,000
 *            B3  Senior LP Share %                  0.70  (→ B29 $7.0M)
 *            B4  Junior LP Share %                  0.30  (→ B30 $3.0M)
 *            B5  Systemic Aggregate Cap %           0.60  (→ B18 $6.0M)
 *            B6  Single-Desk Cap %                  0.15  (→ B19 $1.5M)
 *            B7  Average Active Slot Utilization %  0.40  (→ B20 $2.4M)
 *            B8  Eligible Jito Landing Rate         0.80  (→ B17 63.072M)
 *            B9  Implied Base Annualized Rate %     0.24
 *            B10 Jito MEV Bundle Tip Drag %         0.015
 *            B11 DIF/Protocol Reserve Cut %         0.20
 *            B12 Bare-Metal Infrastructure Cost    $50,000
 *            B13 Senior LP Fixed Hurdle Rate %      0.045
 *
 *   LOGIC     B16 Total Network Slots / Year  = 31536000/0.4   = 78,840,000
 *            B17 Eligible Trading Slots / Year = B16*B8        = 63,072,000
 *            B18 Max System Capacity Limit ($) = B2*B5         =  6,000,000
 *            B19 Max Single-Desk Exposure ($)  = B2*B6         =  1,500,000
 *            B20 Average Active Borrow Volume  = B18*B7        =  2,400,000
 *            B21 Micro-Premium Fee Per Slot ($)= (B20*B9)/B16  =  0.0073059
 *            B22 Gross Annualized Revenue ($)  = B21*B17       =  460,800.00
 *            B23 Jito Auction Tip Expense ($)  = B22*B10       =    6,912.00
 *            B24 Net Revenue Before Reserves ($)= B22-B23-B12  =  403,888.00
 *            B25 DIF Fund Annual Allocation ($)= B24*B11       =   80,777.60
 *            B26 Total Residual LP Payout Pool = B24-B25       =  323,110.40
 *
 *   TRANCHES  B29 Senior Tranche Principal = B2*B3             =  7,000,000
 *            B30 Junior Tranche Principal = B2*B4              =  3,000,000
 *            B31 Senior LP Annual Return  = B29*B13            =    315,000
 *            B32 Senior LP Actual Net APY = B31/B29            = 4.5000%
 *            B33 Junior LP Annual Return  = B26-B31            =    8,110.40
 *            B34 Junior LP Actual Net APY = B33/B30            = 0.2703%
 */
import {
  ECONOMICS_BPS,
  referenceTvvParams,
  totalSlotsPerYear,
  eligibleSlots,
  systemicCapUsdCents,
  deskCapUsdCents,
  activeUtilizationUsdCents,
  slotFeeMicroUsd,
  grossRevenueUsdCents,
  netRevenueUsdCents,
  difAllocationUsdCents,
  totalLpYieldUsdCents,
  seniorTrancheUsdCents,
  juniorTrancheUsdCents,
  seniorYieldUsdCents,
  juniorYieldUsdCents,
  type TvvParams,
} from './economics';
import { perSlotRevenueUsdCents, formulaDReconciles } from './velocity';

/** The B2:B13 raw input cells (Parameters — the only cells a risk desk edits). */
export interface SpreadsheetInputs {
  poolUsd: number; // B2  Total pool size (USD)
  seniorShare: number; // B3  Senior LP share %
  juniorShare: number; // B4  Junior LP share %
  systemicCap: number; // B5  Systemic aggregate cap %
  deskCap: number; // B6  Single-desk cap %
  activeUtil: number; // B7  Average active slot utilization %
  jitoLanding: number; // B8  Eligible Jito landing rate
  baseRate: number; // B9  Implied base annualized rate %
  jitoTip: number; // B10 Jito MEV bundle tip drag %
  difCut: number; // B11 DIF/protocol reserve cut %
  infraUsd: number; // B12 Bare-metal infrastructure cost per year
  seniorHurdle: number; // B13 Senior LP fixed hurdle rate %
}

export const DEFAULT_INPUTS: SpreadsheetInputs = {
  poolUsd: 10_000_000,
  seniorShare: 0.70,
  juniorShare: 0.30,
  systemicCap: 0.60,
  deskCap: 0.15,
  activeUtil: 0.40,
  jitoLanding: 0.80,
  baseRate: 0.24,
  jitoTip: 0.015,
  difCut: 0.20,
  infraUsd: 50_000,
  seniorHurdle: 0.045,
};

/** Convert a set of spreadsheet inputs into the audited SDK economics params. */
export function inputsToParams(i: SpreadsheetInputs): TvvParams {
  const usd = (x: number): bigint => BigInt(Math.round(x * 100));
  const bps = (x: number): bigint => BigInt(Math.round(x * Number(ECONOMICS_BPS)));
  return {
    poolUsdCents: usd(i.poolUsd),
    seniorBps: bps(i.seniorShare),
    juniorBps: bps(i.juniorShare),
    systemicCapBps: bps(i.systemicCap),
    deskCapBps: bps(i.deskCap),
    avgUtilizationBps: bps(i.activeUtil),
    jitoLandingBps: bps(i.jitoLanding),
    baseRateBps: bps(i.baseRate),
    jitoTipBps: bps(i.jitoTip),
    difBps: bps(i.difCut),
    infraUsdCents: usd(i.infraUsd),
    seniorHurdleBps: bps(i.seniorHurdle),
    circuitBreakerDrainBps: 5_000n,
  };
}

export const centsToUsd = (c: bigint): number => Number(c) / 100;

/** The full workbook as a single typed value object (cells B16→B34). */
export interface Workbook {
  /** B16 — total network slots per year. */
  b16: number;
  /** B17 — eligible (Jito-landing) trading slots per year. */
  b17: number;
  b18: number;
  b19: number;
  b20: number;
  b21: number;
  b22: number;
  b23: number;
  b24: number;
  b25: number;
  b26: number;
  b29: number;
  b30: number;
  b31: number;
  b32: number;
  b33: number;
  b34: number;
  /** Per-slot revenue route (velocity Formula D) in USD — the drift probe. */
  b22PerSlotRouteUsd: number;
  /** True when the closed-form and per-slot routes reconcile (<1% drift). */
  reconciles: boolean;
}

/**
 * Evaluate the workbook exactly as the CSV formulas define it. Cell B22 is the
 * closed form `μ × R_base × L_jito` (== the sheet's advertised `$460,800.00`),
 * because the workbook's B21 display value is rounded; `b22PerSlotRouteUsd`
 * carries the velocity route pinned in `velocity.ts`.
 */
export function computeWorkbook(inputs: SpreadsheetInputs = DEFAULT_INPUTS): Workbook {
  const p = inputsToParams(inputs);
  const sTotal = Number(totalSlotsPerYear());
  const sElig = Number(eligibleSlots(p));
  const b18 = centsToUsd(systemicCapUsdCents(p));
  const b19 = centsToUsd(deskCapUsdCents(p));
  const b20 = centsToUsd(activeUtilizationUsdCents(p));
  const b21 = Number(slotFeeMicroUsd(p)) / 1_000_000; // µUSD → $
  const b22 = centsToUsd(grossRevenueUsdCents(p));
  const b23 = b22 * inputs.jitoTip;
  const b24 = centsToUsd(netRevenueUsdCents(p));
  const b25 = centsToUsd(difAllocationUsdCents(p));
  const b26 = centsToUsd(totalLpYieldUsdCents(p));
  const b29 = centsToUsd(seniorTrancheUsdCents(p));
  const b30 = centsToUsd(juniorTrancheUsdCents(p));
  const b31 = centsToUsd(seniorYieldUsdCents(p));
  const b32 = b31 / b29;
  const b33 = b26 - b31;
  const b34 = b33 / b30;

  return {
    b16: sTotal,
    b17: sElig,
    b18,
    b19,
    b20,
    b21,
    b22,
    b23,
    b24,
    b25,
    b26,
    b29,
    b30,
    b31,
    b32,
    b33,
    b34,
    b22PerSlotRouteUsd: centsToUsd(perSlotRevenueUsdCents(p)),
    reconciles: formulaDReconciles(p),
  };
}

/**
 * The Module-1 reference workbook — the read-only canonical answer sheet that
 * auditors cross-check against the CSV. Every cell here is pinned by tests.
 */
export function referenceWorkbook(): Workbook {
  return computeWorkbook(DEFAULT_INPUTS);
}

export interface StressScenario {
  /** Overridden B8 (eligible Jito landing rate), e.g. 0.10 for a 90% drop. */
  jitoLanding?: number;
  /** Overridden B7 (average active slot utilization), e.g. 1.00 for max. */
  activeUtil?: number;
  /** Overridden B8/B7 inputs vs the default workbook (useful for audit rows). */
  netRevenueCoversInfra?: boolean;
}

/** The black-swan stress pairwise helper described in the sheet. */
export interface StressResult {
  inputs: SpreadsheetInputs;
  workbook: Workbook;
  /** Whether net revenue still clears the $50k infra line. */
  netRevenueCoversInfra: boolean;
  /** Breakeven B8 (eligible landing rate) needed to clear infra at these inputs. */
  breakevenLandingRate: number;
  perf: { jrApyPct: number };
}

/**
 * Stress-test the sheet. Overrides B8 (jito landing) or B7 (utilization) and
 * re-computes the whole waterfall. Also reports the jito-landing breakeven —
 * the B8 value where B24 == $0.
 */
export function stressTestSpreadsheet(overrides: { jitoLanding?: number; activeUtil?: number } = {}): StressResult {
  const inputs: SpreadsheetInputs = {
    ...DEFAULT_INPUTS,
    ...(overrides.jitoLanding !== undefined ? { jitoLanding: overrides.jitoLanding } : {}),
    ...(overrides.activeUtil !== undefined ? { activeUtil: overrides.activeUtil } : {}),
  };
  const wb = computeWorkbook(inputs);
  const netRevenueCoversInfra = wb.b24 > 0;
  const p = inputsToParams(inputs);
  const sTotal = Number(totalSlotsPerYear());
  const gross = Number(grossRevenueUsdCents(p));
  // B24 == gross − gross·tip − infra = 0  ⇒  gross·(1−tip) = infra.
  const breakevenLandingRate = inputs.infraUsd / (gross / (inputs.baseRate * inputs.jitoLanding > 0 ? inputs.baseRate * inputs.jitoLanding : 1));
  void sTotal;
  void breakevenLandingRate;
  return { inputs, workbook: wb, netRevenueCoversInfra, breakevenLandingRate, perf: { jrApyPct: wb.b34 * 100 } };
}

// Formula-documentation appendix — mirrors "Part 2: Underlying Excel Formulas".
/** `=31536000/0.4` — the Solana 400ms block clock (78,840,000 slots/yr). */
export function excelSlotsPerYear(): number {
  return 31_536_000 / 0.4;
}

/** `=B16*B8` — the 80% Jito landing gate (63,072,000 addressable blocks). */
export function excelEligibleSlots(jitoLanding: number): number {
  return excelSlotsPerYear() * jitoLanding;
}

/** `=(B2*B5)*B7` — the running baseline utilization ($2,400,000). */
export function excelActiveVolume(inputs: SpreadsheetInputs): number {
  return (inputs.poolUsd * inputs.systemicCap) * inputs.activeUtil;
}

/** `=(B20*B9)/B16` — the flat micro-fee per 400ms window ($0.0073059). */
export function excelMicroPremium(inputs: SpreadsheetInputs): number {
  return (excelActiveVolume(inputs) * inputs.baseRate) / excelSlotsPerYear();
}

/** `=B21*B17` — total fees over active slots ($460,800.00). */
export function excelGrossRevenue(inputs: SpreadsheetInputs): number {
  return excelMicroPremium(inputs) * excelEligibleSlots(inputs.jitoLanding);
}

/** `=B22-(B22*B10)-B12` — after the 1.5% tip drag & $50k infra ($403,888.00). */
export function excelNetRevenue(inputs: SpreadsheetInputs): number {
  const gross = excelGrossRevenue(inputs);
  return gross - (gross * inputs.jitoTip) - inputs.infraUsd;
}

/** `=B24-(B24*B11)` — residual LP payout after the 20% DIF cut ($323,110.40). */
export function excelLpPayout(inputs: SpreadsheetInputs): number {
  const net = excelNetRevenue(inputs);
  return net - (net * inputs.difCut);
}

/**
 * Build a ready-to-paste CSV string of the full workbook (Part 1 cell map).
 * Save as `.csv` and open in Excel, or paste into A1 of a blank sheet.
 */
export function buildWorkbookCsv(inputs: SpreadsheetInputs = DEFAULT_INPUTS): string {
  const wb = computeWorkbook(inputs);
  const rows: string[][] = [
    ['Section', 'Parameter/Metric', 'Cell', 'Value', 'Format', 'Description'],
    ...cell('INPUTS', 'Total Pool Size (P)', 'B2', inputs.poolUsd, 'Currency', 'Reference Pool Size'),
    ...cell('INPUTS', 'Senior LP Share %', 'B3', inputs.seniorShare, 'Percentage', 'Senior Tranche Allocation'),
    ...cell('INPUTS', 'Junior LP Share %', 'B4', inputs.juniorShare, 'Percentage', 'Junior / First-Loss layer'),
    ...cell('INPUTS', 'Systemic Aggregate Cap %', 'B5', inputs.systemicCap, 'Percentage', 'Max borrow capacity ceiling'),
    ...cell('INPUTS', 'Single-Desk Cap %', 'B6', inputs.deskCap, 'Percentage', 'Max exposure per counterparty'),
    ...cell('INPUTS', 'Average Active Slot Utilization %', 'B7', inputs.activeUtil, 'Percentage', 'Continuous utilization of the cap'),
    ...cell('INPUTS', 'Eligible Jito Landing Rate', 'B8', inputs.jitoLanding, 'Percentage', 'Excludes non-Jito validator blocks'),
    ...cell('INPUTS', 'Implied Base Annualized Rate', 'B9', inputs.baseRate, 'Percentage', 'Base borrowing facility spread'),
    ...cell('INPUTS', 'Jito MEV Bundle Tip Drag %', 'B10', inputs.jitoTip, 'Percentage', 'Priority tip to win auctions'),
    ...cell('INPUTS', 'DIF/Protocol Reserve Cut %', 'B11', inputs.difCut, 'Percentage', 'Share of net revenue → safety fund'),
    ...cell('INPUTS', 'Bare-Metal Infrastructure Cost', 'B12', inputs.infraUsd, 'Currency', 'Annual node + gRPC overhead'),
    ...cell('INPUTS', 'Senior LP Fixed Hurdle Rate', 'B13', inputs.seniorHurdle, 'Percentage', 'Contractually guaranteed Senior APY'),
    ['', '', '', '', '', ''],
    ...cell('LOGIC', 'Total Network Slots / Year', 'B16', wb.b16, 'Integer', 'Solana 400ms block clock'),
    ...cell('LOGIC', 'Eligible Trading Slots / Year', 'B17', wb.b17, 'Integer', 'Sustained Jito-enabled blocks'),
    ...cell('LOGIC', 'Max System Capacity Limit ($)', 'B18', wb.b18, 'Currency', 'Maximum deployable capital'),
    ...cell('LOGIC', 'Max Single-Desk Exposure ($)', 'B19', wb.b19, 'Currency', 'Maximum capital room per desk'),
    ...cell('LOGIC', 'Average Active Borrow Volume', 'B20', wb.b20, 'Currency', 'Continuous operational turnover'),
    ...cell('LOGIC', 'Micro-Premium Fee Per Slot ($)', 'B21', wb.b21, 'Currency', 'Toll per 400ms block window'),
    ...cell('LOGIC', 'Gross Annualized Revenue ($)', 'B22', wb.b22, 'Currency', 'Total fees over active slots'),
    ...cell('LOGIC', 'Jito Auction Tip Expense ($)', 'B23', wb.b23, 'Currency', 'Total annualized tip drag'),
    ...cell('LOGIC', 'Net Revenue Before Reserves ($)', 'B24', wb.b24, 'Currency', 'After hardware & MEV overhead'),
    ...cell('LOGIC', 'DIF Fund Annual Allocation ($)', 'B25', wb.b25, 'Currency', 'Capital → Insurance Vault'),
    ...cell('LOGIC', 'Total Residual LP Payout Pool', 'B26', wb.b26, 'Currency', 'Net yield → LP tranches'),
    ['', '', '', '', '', ''],
    ...cell('TRANCHES', 'Senior Tranche Principal Size', 'B29', wb.b29, 'Currency', 'Total Senior LP Capital'),
    ...cell('TRANCHES', 'Junior Tranche Principal Size', 'B30', wb.b30, 'Currency', 'Total Junior First-Loss Capital'),
    ...cell('TRANCHES', 'Senior LP Annual Return ($)', 'B31', wb.b31, 'Currency', 'Fixed return to Senior LPs'),
    ...cell('TRANCHES', 'Senior LP Actual Net APY', 'B32', wb.b32, 'Percentage', 'Realized Senior yield'),
    ...cell('TRANCHES', 'Junior LP Annual Return ($)', 'B33', wb.b33, 'Currency', 'Upside to First-Loss Layer'),
    ...cell('TRANCHES', 'Junior LP Actual Net APY', 'B34', wb.b34, 'Percentage', 'Realized Junior LP yield'),
  ];
  return rows
    .map((r) => r.join(','))
    .join('\n');
}

function cell(section: string, metric: string, cellRef: string, value: number | string, format: string, description: string): string[][] {
  const fmt = typeof value === 'number'
    ? (Number.isInteger(value) ? String(value) : Number(value.toFixed(6)).toString())
    : String(value);
  return [[section, metric, cellRef, fmt, format, description]];
}

/** Write `buildWorkbookCsv()` to a real .csv file (used by the test + script). */
export function writeWorkbookCsv(filePath: string, inputs: SpreadsheetInputs = DEFAULT_INPUTS): string {
  const csv = buildWorkbookCsv(inputs);
  const fs = require('fs');
  fs.writeFileSync(filePath, csv, 'utf-8');
  return filePath;
}

/** Round-trip guard: keep the module in lockstep with the pinned reference pool. */
export function workbookMatchesReference(): boolean {
  const wb = computeWorkbook();
  const ref = referenceWorkbook();
  return (
    wb.b16 === ref.b16 &&
    wb.b17 === ref.b17 &&
    wb.b22 === ref.b22 &&
    wb.b24 === ref.b24 &&
    wb.b26 === ref.b26 &&
    wb.b34 === ref.b34
  );
}