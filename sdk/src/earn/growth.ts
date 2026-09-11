/**
 * LP growth math — the canonical, dependency-free projection engine shared by
 * the @noviscia/sdk and the web dashboard (app/web/lib/earn/growth.ts re-exports
 * this exact module so there is ONE tested implementation).
 *
 * APY semantics follow the vault's realized flow model: SIMPLE, non-compounding
 * yield annualized over a year (APY = flow/AUM × year/window). Projections are
 * therefore LINEAR — the same convention the on-chain fee_index release and the
 * sandbox use. A compounding mode is offered only as an "if yield were
 * reinvested" view; the vault itself never compounds.
 *
 * All functions are pure and deterministic for a given (valueUsdc,
 * principalUsdc, apyPct) triple, which keeps them trivially testable and safe
 * to call from live tickers that re-render every 400 ms.
 */

/** Calendar days per year used everywhere in this engine. */
export const DAYS_PER_YEAR = 365;

export interface GrowthHorizon {
  /** number of days from today */
  days: number;
  /** short axis label e.g. "1M" */
  label: string;
}

/** Default chart horizons: today, 1 week, 1/3/6 months, 1 year. */
export const DEFAULT_GROWTH_HORIZONS: readonly GrowthHorizon[] = [
  { days: 0, label: 'Today' },
  { days: 7, label: '1W' },
  { days: 30, label: '1M' },
  { days: 90, label: '3M' },
  { days: 180, label: '6M' },
  { days: 365, label: '1Y' },
] as const;

export type GrowthMode = 'simple' | 'compound';

export interface GrowthPoint {
  /** days out from today (0 == now) */
  days: number;
  /** short label */
  label: string;
  /** total equity (deposit basis + accrued yield) at that point, USD */
  equityUsdc: number;
  /** the LP's deposit basis, USD (constant across the series) */
  principalUsdc: number;
  /**
   * Positive growth only (`max(0, equity − principal)`) — safe to stack on a
   * chart. Use GrowthMetrics.netYieldUsdc for the real sign (a loss is
   * negative and must be surfaced honestly).
   */
  yieldUsdc: number;
}

export interface GrowthMetrics {
  /** realized net yield = current equity − deposit basis (negative on a loss) */
  netYieldUsdc: number;
  /** realized net yield as a % of the deposit basis */
  netYieldPct: number;
  /** current annual rate in percent (clamped ≥ 0) */
  dailyRatePct: number;
  /** USDC accrued per day at the current rate, on current equity */
  dailyUsdc: number;
  /** USDC accrued per 30-day month at the current rate, on current equity */
  monthlyUsdc: number;
  /** projected additional yield over the next 30 days */
  project30dUsdc: number;
  /** projected additional yield over the next 90 days */
  project90dUsdc: number;
  /** projected additional yield over the next 365 days */
  project365dUsdc: number;
  /** projected total equity one year out */
  projectedEquity365dUsdc: number;
  /** days to double the deposit at the current rate (simple APY); null if APY ≤ 0 */
  doublingDays: number | null;
}

/**
 * Simple (non-compounding) APY projection — the vault's actual model.
 * `valueUsdc × (1 + apyPct/100 × days/365)`. A non-positive APY flat-lines.
 */
export function projectEquitySimple(valueUsdc: number, apyPct: number, days: number): number {
  const r = Math.max(0, apyPct) / 100;
  return valueUsdc * (1 + (r * Math.max(0, days)) / DAYS_PER_YEAR);
}

/**
 * Compounding projection — "if yield were reinvested" view only. The vault does
 * not compound; use projectEquitySimple for honest numbers.
 */
export function projectEquityCompound(valueUsdc: number, apyPct: number, days: number): number {
  const r = Math.max(0, apyPct) / 100;
  return valueUsdc * Math.pow(1 + r / DAYS_PER_YEAR, Math.max(0, days));
}

/**
 * Build the deterministic growth series used by the dashboard chart.
 * Today's point is pinned to the live equity; future points are simple-APY
 * projections (or compound when `mode: 'compound'` is passed).
 */
export function buildGrowthSeries(
  valueUsdc: number,
  principalUsdc: number,
  apyPct: number,
  options: { horizons?: readonly GrowthHorizon[]; mode?: GrowthMode } = {},
): GrowthPoint[] {
  const horizons = options.horizons ?? DEFAULT_GROWTH_HORIZONS;
  const mode = options.mode ?? 'simple';
  const base = Math.max(0, valueUsdc);
  const basis = principalUsdc > 0 ? principalUsdc : base;
  const project = mode === 'compound' ? projectEquityCompound : projectEquitySimple;

  return horizons.map((h) => {
    const equity = h.days === 0 ? base : project(base, apyPct, h.days);
    return {
      days: h.days,
      label: h.label,
      equityUsdc: equity,
      principalUsdc: basis,
      yieldUsdc: Math.max(0, equity - basis),
    };
  });
}

/** Live metrics + short/medium/long projections for the current position. */
export function growthMetrics(
  valueUsdc: number,
  principalUsdc: number,
  apyPct: number,
): GrowthMetrics {
  const base = Math.max(0, valueUsdc);
  const basis = principalUsdc > 0 ? principalUsdc : base;
  const r = Math.max(0, apyPct) / 100;

  const netYieldUsdc = base - basis;
  const dailyUsdc = (base * r) / DAYS_PER_YEAR;

  return {
    netYieldUsdc,
    netYieldPct: basis > 0 ? (netYieldUsdc / basis) * 100 : 0,
    dailyRatePct: r * 100,
    dailyUsdc,
    monthlyUsdc: (dailyUsdc * 30),
    project30dUsdc: base * r * (30 / DAYS_PER_YEAR),
    project90dUsdc: base * r * (90 / DAYS_PER_YEAR),
    project365dUsdc: base * r,
    projectedEquity365dUsdc: base * (1 + r),
    doublingDays: r > 0 ? DAYS_PER_YEAR / r : null,
  };
}