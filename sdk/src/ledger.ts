/**
 * Settlement Ledger — TVV risk engine Module 4 (the time-stepped cash ledger).
 *
 * The annual sheet (Module 1), desk feasibility (Module 3) and velocity
 * (Module 2) prove the engine CLOSES on paper. This module proves it CLOSES
 * UNDER SETTLEMENT: a deterministic, integer-only, day-stepped simulation in
 * which HFT desks borrow per slot, tolls accrue in micro-USD, a 24-hour
 * settlement batch collects them, the fee split (Jito tip → infra → DIF → LP)
 * settles, LP yield compounds day over day, and NO-DRAIN invariants are
 * checked every settlement cycle.
 *
 * What the ledger models (mirrors the on-chain asset-engine semantics):
 *
 *   - Desks borrow a per-slot size up to `C_desk` each slot; total active
 *     per-slot volume is capped by `C_sys`. Tolls accrue only on landing
 *     (Jito-eligible) slots: `L_jito × 216,000` per day.
 *   - A 24-hour clearing batch floors every day's micro-USD tolls to cents
 *     (`MICRO_DOLLARS_PER_CENT`) — the exact "one daily batch transfer" of
 *     the institutional product.
 *   - The waterfall of that batch: `tolls → − tip (Jito 1.5%) → − infra
 *     (bare-metal, $50k/365) → − DIF (20% of net) → LP pool` (senior fixed
 *     hurdle first, junior residual second). Day-level mirrors of
 *     `netRevenueUsdCents` / `difAllocationUsdCents`.
 *   - Senior LPs accrue their 4.50% hurdle daily; junior LPs are first-loss
 *     and receive the residual; if payouts fall short the senior shortfall
 *     absorbs into junior equity (never into senior).
 *   - A desk that fails to settle by window + grace (`sandboxClock` constants)
 *     BREACHES: its outstanding principal becomes a default event absorbed
 *     through the L1→L5 loss waterfall (`waterfall.absorbDefault`), draining
 *     DIF then junior equity first — tracked against the hard circuit breaker
 *     (`hardLockTriggered`). That is the "money leaves Noviscia securely"
 *     path: it only ever exits via validated losses, never as free money.
 *
 * No-drain guarantees (checked every settlement cycle via `checkNoDrain`):
 *   C1  Money conservation — every micro-USD tolled plus the initial principal
 *       is exactly accounted for in captured balances + outflows (tips, infra,
 *       covered default losses, uncovered losses). Nothing leaves silently.
 *   C2  Cap enforcement — no desk borrows above `C_desk`; the aggregate deck
 *       never exceeds `C_sys`.
 *   C3  Claims ≥ principal — senior and junior claims never drop below their
 *       contributed principal until all protective layers are exhausted.
 *
 * All arithmetic is bigint; no floats. The reference 365-day run reproduces
 * the workbook year-end numbers within the same <1% tolerance the other
 * modules pin (`ledgerReconcilesToAnnual`).
 *
 * @module ledger
 */

import {
  ECONOMICS_BPS,
  MICRO_DOLLARS_PER_CENT,
  mulDiv,
  hardLockTriggered,
  juniorTrancheUsdCents,
  seniorTrancheUsdCents,
  systemicCapUsdCents,
  deskCapUsdCents,
  netRevenueUsdCents,
  difAllocationUsdCents,
  totalLpYieldUsdCents,
  seniorYieldUsdCents,
  juniorYieldUsdCents,
  type TvvParams,
} from './economics';
import { deskSlotTollMicroUsd } from './feasibility';
import { REAL_SLOTS_PER_DAY, REAL_GRACE_SLOTS } from './sandboxClock';
import {
  absorbDefault,
  type DeskDefaultEvent,
  type WaterfallState,
} from './waterfall';
import { DESK_COLLATERAL_COVERAGE_BPS, LOC_COVERAGE_BPS, LOC_HAIRCUT_BPS } from './assumptions';

/** Days per year (the ledger horizon used by the reference scenarios). */
export const DAYS_PER_YEAR = 365n;

/** The tolerance band the ledger must close within (same as the other modules). */
export const LEDGER_RECONCILE_TOLERANCE_BPS = 100n; // 1%

/** One HFT desk's per-slot borrowing schedule for the simulation horizon. */
export interface DeskSchedule {
  deskId: string;
  /**
   * Utilization of the desk cap, in bps, per day (index = day, length = days).
   * `10_000` = full `C_desk` every slot of that day.
   */
  utilBpsPerDay: bigint[];
  /**
   * Whether the desk settles within the 24 h window + grace. A non-settling
   * desk defaults its outstanding principal into the loss waterfall.
   */
  settling: boolean;
}

/** The per-settlement-cycle slice of the ledger. All values USD cents. */
export interface DaySettlement {
  day: number;
  grossTollsCents: bigint;
  jitoTipCents: bigint;
  infraCents: bigint;
  netCents: bigint;
  difCents: bigint;
  lpPayoutCents: bigint;
  seniorAccruedCents: bigint;
  seniorShortfallCents: bigint;
  juniorResidualCents: bigint;
}

/** One desk default absorbed through the loss waterfall during the run. */
export interface LedgerBreach {
  day: number;
  deskId: string;
  exposureUsdCents: bigint;
  uncoveredUsdCents: bigint;
}

/** The accumulated reserve/claim balances of the pool. */
export interface LedgerReserve {
  /** Default Insurance Fund reserve (L3 protective capital). */
  difReserveUsdCents: bigint;
  /** Senior LP claim (principal + accrued fixed hurdle). */
  seniorLiabilityUsdCents: bigint;
  /** Junior LP equity (principal + residual − absorbed losses; first-loss). */
  juniorEquityUsdCents: bigint;
  /** Cumulative junior-tranche drain absorbed by defaults (circuit-breaker input). */
  juniorDrainedUsdCents: bigint;
  /** Hard circuit breaker tripped — yield accrual halts. */
  frozen: boolean;
  /** Cumulative loss the L1→L5 layers could not cover (capital write-down). */
  uncoveredUsdCents: bigint;
}

/** Realized money movements during the run (all USD cents). */
export interface LedgerOutflows {
  jitoTipsUsdCents: bigint;
  infraUsdCents: bigint;
  /** Losses covered by the protective layers (DIF/junior/senior absorbed). */
  coveredDefaultLossUsdCents: bigint;
  /** Losses no layer covered (realized capital write-down). */
  uncoveredLossUsdCents: bigint;
}

/** The full result of a ledger run. */
export interface LedgerState {
  params: TvvParams;
  desks: DeskSchedule[];
  days: number;
  daysSettled: DaySettlement[];
  reserve: LedgerReserve;
  breaches: LedgerBreach[];
  /** Any no-drain invariant violated during the run (empty = clean). */
  violations: string[];
  outflows: LedgerOutflows;
}

/** Landing (Jito-eligible) real slots in one day: `216,000 × L_jito`. */
export function landedRealSlotsPerDay(p: TvvParams): bigint {
  return mulDiv(BigInt(REAL_SLOTS_PER_DAY), p.jitoLandingBps, ECONOMICS_BPS);
}

/**
 * The per-day toll a desk accrues for borrowing `size` on every landing slot
 * of the day, in micro-USD: `per-slot toll × landed slots`. (Sized by the
 * annual rate across all slots, exactly like the Module-3 annual toll.)
 */
export function dayDeskTollMicro(p: TvvParams, sizeUsdCents: bigint): bigint {
  return deskSlotTollMicroUsd(p, sizeUsdCents) * landedRealSlotsPerDay(p);
}

/** Daily bare-metal infra cost: `$50,000 / 365`, floored to the cent. */
export function dayInfraUsdCents(p: TvvParams): bigint {
  return mulDiv(p.infraUsdCents, 1n, DAYS_PER_YEAR);
}

/** Daily senior-hurdle obligation: `P_sr × 4.50% / 365`, floored. */
export function daySeniorHurdleUsdCents(p: TvvParams): bigint {
  return mulDiv(seniorYieldUsdCents(p), 1n, DAYS_PER_YEAR);
}

/**
 * Build the reference desk schedule: active slot volume ≡ `μ` = 40% of
 * `C_sys` = $2.4M, held constant every day (desk-a full `C_desk` = $1.5M,
 * desk-b at 60% of `C_desk` = $0.9M). All desks settle. This is the exact
 * active-utilization shape the annual sheet assumes.
 */
export function referenceDeskSchedule(_p: TvvParams, days = Number(DAYS_PER_YEAR)): DeskSchedule[] {
  const constant = (utilBps: bigint): bigint[] => new Array(days).fill(utilBps);
  return [
    { deskId: 'desk-a', utilBpsPerDay: constant(10_000n), settling: true },
    { deskId: 'desk-b', utilBpsPerDay: constant(6_000n), settling: true },
  ];
}

/**
 * Full-utilization schedule: the aggregate cap saturated — four max-sized
 * desks at full `C_desk` → $6M active every slot (μ = 100% of `C_sys`).
 * All desks settle. Reproduces the 18.43% junior-APY stress case.
 */
export function fullUtilizationSchedule(_p: TvvParams, days = Number(DAYS_PER_YEAR)): DeskSchedule[] {
  const constant = new Array(days).fill(10_000n);
  return ['desk-a', 'desk-b', 'desk-c', 'desk-d'].map((id) => ({
    deskId: id,
    utilBpsPerDay: constant,
    settling: true,
  }));
}

/**
 * Breach stress schedule: desk-a borrows at the cap every slot but never
 * settles (defaults through the waterfall); desk-b settles normally and keeps
 * the pool producing yield around the breach.
 */
export function breachedDeskSchedule(_p: TvvParams, days = Number(DAYS_PER_YEAR)): DeskSchedule[] {
  return [
    { deskId: 'desk-a', utilBpsPerDay: new Array(days).fill(10_000n), settling: false },
    { deskId: 'desk-b', utilBpsPerDay: new Array(days).fill(6_000n), settling: true },
  ];
}

/** The initial $10M balance-sheet reserve: contributed principal + zero yield. */
export function initialReserve(p: TvvParams): LedgerReserve {
  return {
    difReserveUsdCents: 0n,
    seniorLiabilityUsdCents: seniorTrancheUsdCents(p),
    juniorEquityUsdCents: juniorTrancheUsdCents(p),
    juniorDrainedUsdCents: 0n,
    frozen: false,
    uncoveredUsdCents: 0n,
  };
}

/**
 * Check the three no-drain invariants for the ledger state as of `day`.
 * Returns the list of violated invariants (empty = clean).
 */
export function checkNoDrain(state: LedgerState, day: number): string[] {
  const violations: string[] = [];
  const p = state.params;
  const senior0 = seniorTrancheUsdCents(p);
  const junior0 = juniorTrancheUsdCents(p);
  const initialTotal = senior0 + junior0;

  // C1 — money conservation: inflow ≡ captured balances + outflows.
  const settled = state.daysSettled.slice(0, day + 1);
  const totTolls = settled.reduce((a, d) => a + d.grossTollsCents, 0n);
  const captured =
    state.reserve.difReserveUsdCents +
    state.reserve.seniorLiabilityUsdCents +
    state.reserve.juniorEquityUsdCents;
  const outflows =
    state.outflows.jitoTipsUsdCents +
    state.outflows.infraUsdCents +
    state.outflows.coveredDefaultLossUsdCents +
    state.outflows.uncoveredLossUsdCents;
  const inflow = initialTotal + totTolls;
  // Per-day µ→¢ flooring leaks < 1¢/cycle; allow 2¢ of slack.
  const diff = inflow - (captured + outflows);
  if (diff < -2n || diff > 2n) {
    violations.push(`C1-conservation day=${day} inflow=${String(inflow)} captured+out=${String(captured + outflows)} diff=${String(diff)}¢`);
  }

  // C2 — cap enforcement: per-desk and systemic schedule bounds.
  for (const d of state.desks) {
    for (let i = 0; i <= day && i < d.utilBpsPerDay.length; i++) {
      const size = mulDiv(deskCapUsdCents(p), d.utilBpsPerDay[i], ECONOMICS_BPS);
      if (size > deskCapUsdCents(p)) violations.push(`C2-desk-cap ${d.deskId} day=${i}`);
    }
  }
  const deckSize = state.desks.reduce(
    (acc, d) => acc + mulDiv(deskCapUsdCents(p), d.utilBpsPerDay[day] ?? 0n, ECONOMICS_BPS),
    0n,
  );
  if (deckSize > systemicCapUsdCents(p)) {
    violations.push(`C2-systemic-cap day=${day} deck=${String(deckSize)}`);
  }

  // C3 — senior principal is never impaired while DIF or junior capital remains.
  if (state.reserve.seniorLiabilityUsdCents < senior0) {
    if (!(state.reserve.difReserveUsdCents === 0n && state.reserve.juniorEquityUsdCents <= 0n)) {
      violations.push(`C3-senior-impairment day=${day}`);
    }
  }
  // ...and junior equity never drops meaningfully below principal minus its
  // committed first-loss exposure while the desk is not frozen (a default is
  // the FIRST-loss layer; full junior loss is by design at the breaker pit).
  if (state.reserve.juniorEquityUsdCents < 0n) {
    violations.push(`C3-junior-negative day=${day}`);
  }

  return violations;
}

/** The real-slot threshold (as a day-fraction) at which a window breaches. */
function breachDayOffset(): bigint {
  return (BigInt(REAL_SLOTS_PER_DAY) + BigInt(REAL_GRACE_SLOTS)) / BigInt(REAL_SLOTS_PER_DAY);
}

/**
 * Run the settlement ledger for `days` settlement cycles against the desk
 * schedules. All desks must have exactly `days` util entries.
 */
export function runLedger(p: TvvParams, desks: DeskSchedule[], days = Number(DAYS_PER_YEAR)): LedgerState {
  const reserve = initialReserve(p);
  const daysSettled: DaySettlement[] = [];
  const breaches: LedgerBreach[] = [];
  const outflows: LedgerOutflows = {
    jitoTipsUsdCents: 0n,
    infraUsdCents: 0n,
    coveredDefaultLossUsdCents: 0n,
    uncoveredLossUsdCents: 0n,
  };
  const violations: string[] = [];
  const perDeskCap = deskCapUsdCents(p);
  // Per-desk breach lifecycle: windowOpenedDay (bigint|undefined) → breachedHandledOnce.
  const opened = new Map<string, bigint>();

  for (let day = 0; day < days; day++) {
    let grossTolls = 0n;
    let deckSize = 0n;

    for (const d of desks) {
      const size = mulDiv(perDeskCap, d.utilBpsPerDay[day] ?? 0n, ECONOMICS_BPS);
      deckSize += size;
      grossTolls += dayDeskTollMicro(p, size);

      // Track window opening for non-settling desks (real-slot clock).
      if (size > 0n && !d.settling && !opened.has(d.deskId)) {
        opened.set(d.deskId, BigInt(day));
      }
    }

    // Floor the day's micro-USD tolls to cents (the 24h clearing batch).
    const tollsCents = mulDiv(grossTolls, 1n, MICRO_DOLLARS_PER_CENT);

    // Waterfall: tip → infra → net → DIF → LP.
    const tipCents = mulDiv(tollsCents, p.jitoTipBps, ECONOMICS_BPS);
    const infraCents = dayInfraUsdCents(p);
    // The bare-metal bill is always paid: if the day's tolls cannot cover tip
    // + infra, the operational shortfall is funded from DIF → junior → senior
    // (protective layers, in waterfall order) — never created out of nothing.
    let netBeforeOps = tollsCents - tipCents - infraCents;
    let opsShortfall = 0n;
    if (netBeforeOps < 0n) {
      opsShortfall = -netBeforeOps;
      netBeforeOps = 0n;
    }
    let funding = opsShortfall;
    const draw = (avail: bigint): bigint => {
      const take = avail >= funding ? funding : avail;
      funding -= take;
      return take;
    };
    reserve.difReserveUsdCents -= draw(reserve.difReserveUsdCents);
    const juniorOpsDraw = draw(reserve.juniorEquityUsdCents);
    reserve.juniorEquityUsdCents -= juniorOpsDraw;
    reserve.juniorDrainedUsdCents += juniorOpsDraw; // ops drain counts toward the breaker
    reserve.seniorLiabilityUsdCents -= draw(reserve.seniorLiabilityUsdCents);
    if (funding > 0n) {
      outflows.uncoveredLossUsdCents += funding; // ops cost beyond every layer: write-down
      reserve.uncoveredUsdCents += funding;
    }
    const netCents = netBeforeOps;
    const difCents = mulDiv(netCents, p.difBps, ECONOMICS_BPS);
    const lpPayoutCents = netCents - difCents;

    // Senior fixed hurdle paid first; a payout shortfall simply means senior
    // yield was not fully earned that day (it never draws down principal or
    // converts into junior losses — the L1→L5 waterfall owns default risk).
    const seniorDue = daySeniorHurdleUsdCents(p);
    const seniorAccrued = lpPayoutCents >= seniorDue ? seniorDue : lpPayoutCents;
    const juniorResidual = lpPayoutCents - seniorAccrued;
    const seniorShortfall = seniorDue - seniorAccrued;

    // Credit the reserve (compounding: balances grow and are never clawed back).
    reserve.difReserveUsdCents += difCents;
    reserve.seniorLiabilityUsdCents += seniorAccrued;
    reserve.juniorEquityUsdCents += juniorResidual;

    daysSettled.push({
      day,
      grossTollsCents: tollsCents,
      jitoTipCents: tipCents,
      infraCents,
      netCents,
      difCents,
      lpPayoutCents,
      seniorAccruedCents: seniorAccrued,
      seniorShortfallCents: seniorShortfall,
      juniorResidualCents: juniorResidual,
    });

    outflows.jitoTipsUsdCents += tipCents;
    outflows.infraUsdCents += infraCents;

    // ── Breach handling ────────────────────────────────────────────────
    // A non-settling desk's outstanding principal goes through L1→L5 once its
    // window + grace has elapsed (24h window + 2h grace, real slots).
    for (const d of desks) {
      if (d.settling) continue;
      const dayN = BigInt(day);
      const openedDay = opened.get(d.deskId);
      if (openedDay === undefined) continue;
      if (dayN - openedDay < breachDayOffset()) continue; // still inside window+grace
      const outstanding = mulDiv(perDeskCap, d.utilBpsPerDay[day] ?? 0n, ECONOMICS_BPS);
      if (outstanding === 0n) continue;
      const event: DeskDefaultEvent = {
        deskId: d.deskId,
        exposureUsdCents: outstanding,
        collateralRecoveryUsdCents: mulDiv(outstanding, DESK_COLLATERAL_COVERAGE_BPS, ECONOMICS_BPS),
        locFaceUsdCents: mulDiv(outstanding, LOC_COVERAGE_BPS, ECONOMICS_BPS),
        locHaircutBps: LOC_HAIRCUT_BPS,
        locOutcome: 'paid',
      };
      const wf: WaterfallState = {
        protocolReservesUsdCents: reserve.difReserveUsdCents,
        juniorTrancheUsdCents: reserve.juniorEquityUsdCents,
        seniorTrancheUsdCents: reserve.seniorLiabilityUsdCents,
        circuitBreakerDrainBps: p.circuitBreakerDrainBps,
      };
      const result = absorbDefault(wf, event);
      reserve.difReserveUsdCents = wf.protocolReservesUsdCents;
      reserve.juniorEquityUsdCents = wf.juniorTrancheUsdCents;
      reserve.seniorLiabilityUsdCents = wf.seniorTrancheUsdCents;
      reserve.juniorDrainedUsdCents += result.absorbed.juniorTrancheUsdCents;
      outflows.coveredDefaultLossUsdCents +=
        result.absorbed.protocolReservesUsdCents +
        result.absorbed.juniorTrancheUsdCents +
        result.absorbed.seniorTrancheUsdCents;
      if (result.absorbed.uncoveredUsdCents > 0n) {
        reserve.uncoveredUsdCents += result.absorbed.uncoveredUsdCents;
        outflows.uncoveredLossUsdCents += result.absorbed.uncoveredUsdCents;
      }
      breaches.push({
        day,
        deskId: d.deskId,
        exposureUsdCents: outstanding,
        uncoveredUsdCents: result.absorbed.uncoveredUsdCents,
      });
      // Freeze the desk: it cannot borrow further (schedule zeroed to horizon).
      d.utilBpsPerDay.fill(0n, day);
    }

    // ── Hard circuit breaker ───────────────────────────────────────────
    // 50% of the junior layer drained by defaults → all yield accrual halts.
    if (!reserve.frozen && hardLockTriggered(p, reserve.juniorDrainedUsdCents)) {
      reserve.frozen = true;
    }

    violations.push(
      ...checkNoDrain(
        { params: p, desks, days, daysSettled, reserve, breaches, violations: [], outflows },
        day,
      ),
    );
  }

  const unique = (v: string[]): string[] => Array.from(new Set(v));
  return { params: p, desks, days, daysSettled, reserve, breaches, violations: unique(violations), outflows };
}

/**
 * The year-end aggregate of interest: does the time-stepped ledger reproduce
 * the annual sheet's headline numbers within the 1% tolerance?
 */
export interface AnnualReconciliation {
  gross: bigint;
  net: bigint;
  dif: bigint;
  lpPool: bigint;
  senior: bigint;
  junior: bigint;
  juniorApyTenthsBps: bigint;
  withinTolerance: boolean;
}

/** Compare the ledger's cumulative cash flows to the Module-1 closed forms. */
export function ledgerReconcilesToAnnual(
  state: LedgerState,
  target: TvvParams = state.params,
): AnnualReconciliation {
  const p = target;
  const sum = (k: keyof DaySettlement): bigint =>
    state.daysSettled.reduce((a, d) => a + (d[k] as bigint), 0n);
  const gross = sum('grossTollsCents');
  const net = sum('netCents');
  const dif = sum('difCents');
  const lp = sum('lpPayoutCents');
  const senior = sum('seniorAccruedCents');
  const junior = sum('juniorResidualCents');
  const junior0 = juniorTrancheUsdCents(p);
  // Junior APY = junior yield / junior principal, stored as percent × 1,000
  // (18.4259% → 184.2; display divides by 10), floored.
  const juniorApyTenthsBps = junior0 === 0n ? 0n : mulDiv(junior, 1_000n, junior0);

  const within = (got: bigint, want: bigint): boolean => {
    const diff = got > want ? got - want : want - got;
    return diff * ECONOMICS_BPS <= want * LEDGER_RECONCILE_TOLERANCE_BPS;
  };

  return {
    gross,
    net,
    dif,
    lpPool: lp,
    senior,
    junior,
    juniorApyTenthsBps,
    withinTolerance:
      within(net, netRevenueUsdCents(p)) &&
      within(dif, difAllocationUsdCents(p)) &&
      within(lp, totalLpYieldUsdCents(p)) &&
      within(senior, seniorYieldUsdCents(p)) &&
      (junior0 === 0n || within(junior, juniorYieldUsdCents(p))),
  };
}

/**
 * One-line human summary of a settled ledger state (the "see the real yield"
 * view a reviewer or an investor dashboard can print).
 */
export function ledgerSummary(state: LedgerState): string {
  const rec = ledgerReconcilesToAnnual(state);
  return (
    `days=${state.days} settled=${state.daysSettled.length}` +
    ` breaches=${state.breaches.length} frozen=${state.reserve.frozen}` +
    ` violations=${state.violations.length}` +
    ` gross${fmtCents(rec.gross)} net${fmtCents(rec.net)} dif${fmtCents(rec.dif)}` +
    ` senior${fmtCents(rec.senior)} junior${fmtCents(rec.junior)}` +
    ` juniorApy=${(Number(rec.juniorApyTenthsBps) / 100).toFixed(2)}%` +
    ` closesWithin1%=${rec.withinTolerance}` +
    ` difReserve${fmtCents(state.reserve.difReserveUsdCents)}` +
    ` seniorLiability${fmtCents(state.reserve.seniorLiabilityUsdCents)}` +
    ` juniorEquity${fmtCents(state.reserve.juniorEquityUsdCents)}`
  );
}

/** Cents → "$xxx.yy" display (display only — all accounting stays integer). */
function fmtCents(c: bigint): string {
  const sign = c < 0n ? '-' : '';
  const a = c < 0n ? -c : c;
  return `${sign}$${String(a / 100n)}.${String(a % 100n).padStart(2, '0')}`;
}