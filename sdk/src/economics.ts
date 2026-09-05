/**
 * Quantified Risk Pack & Economics — Module 1 of the TVV risk engine.
 *
 * Deterministic unit-economics for the Noviscia Total Value Velocity (TVV)
 * engine in **integer (bigint) arithmetic on USD cents** — no floats. This is
 * the byte-for-byte TypeScript twin of
 * `noviscia-asset-engine-sdk::economics`; both are pinned by tests against the
 * audited `$10,000,000` reference balance sheet:
 *
 * | Step | Reference result |
 * |---|---|
 * | Total slots/yr | `78,840,000` |
 * | Eligible (Jito) slots | `63,072,000` |
 * | Micro-premium/slot | `≈ $0.0073059` |
 * | Gross revenue | `$460,800.00` |
 * | Net revenue | `$403,888.00` |
 * | DIF allocation | `$80,777.60` |
 * | Total LP yield | `$323,110.40` |
 * | Senior hurdle (4.50%) | `$315,000.00` |
 * | Junior residual | `$8,110.40` |
 */

/** Basis-point denominator (1 bps = 0.01%). */
export const ECONOMICS_BPS = 10_000n;

/** Micro-USD ($1e-6) per USD cent. */
export const MICRO_DOLLARS_PER_CENT = 10_000n;

/** Solana slot time: 400ms = 2/5s. */
export const SLOT_SECONDS_NUM = 2n;
export const SLOT_SECONDS_DEN = 5n;

/** Seconds per standard year. */
export const SECONDS_PER_YEAR = 60n * 60n * 24n * 365n;

/**
 * The full parameter set of the economics sheet. All ratios are bps over
 * `ECONOMICS_BPS`; all money fields are USD cents.
 */
export interface TvvParams {
  /** Total pool capital in USD cents. */
  poolUsdCents: bigint;
  /** Senior LP tranche share (bps of pool). Default 70%. */
  seniorBps: bigint;
  /** Junior LP first-loss layer share (bps of pool). Default 30%. */
  juniorBps: bigint;
  /** Systemic concentration cap (bps of pool). Default 60%. */
  systemicCapBps: bigint;
  /** Single-desk cap (bps of pool). Default 15%. */
  deskCapBps: bigint;
  /** Average active slot utilization (bps of systemic cap). Default 40%. */
  avgUtilizationBps: bigint;
  /** Eligible Jito landing rate (bps). Default 80%. */
  jitoLandingBps: bigint;
  /** Implied base annualized borrowing rate (bps). Default 24%. */
  baseRateBps: bigint;
  /** Jito MEV bundle tip cost as a cut of gross revenue (bps). Default 1.5%. */
  jitoTipBps: bigint;
  /** DIF reserve cut of net revenue (bps). Default 20%. */
  difBps: bigint;
  /** Bare-metal infrastructure cost per year in USD cents. Default $50,000. */
  infraUsdCents: bigint;
  /** Senior LP contractual fixed hurdle (bps). Default 4.50%. */
  seniorHurdleBps: bigint;
  /** Junior-tranche drain ratio that trips the hard circuit breaker (bps). Default 50%. */
  circuitBreakerDrainBps: bigint;
}

/** The audited `$10,000,000` reference pool from the economics sheet. */
export function referenceTvvParams(): TvvParams {
  return {
    poolUsdCents: 1_000_000_000n, // $10,000,000.00
    seniorBps: 7_000n,
    juniorBps: 3_000n,
    systemicCapBps: 6_000n,
    deskCapBps: 1_500n,
    avgUtilizationBps: 4_000n,
    jitoLandingBps: 8_000n,
    baseRateBps: 2_400n,
    jitoTipBps: 150n,
    difBps: 2_000n,
    infraUsdCents: 5_000_000n, // $50,000.00
    seniorHurdleBps: 450n,
    circuitBreakerDrainBps: 5_000n,
  };
}

/** Default parameter set — the reference `$10,000,000` pool. */
export function defaultTvvParams(): TvvParams {
  return referenceTvvParams();
}

/** Flooring `n × m / d`, exact over bigint. */
export function mulDiv(n: bigint, m: bigint, d: bigint): bigint {
  return (n * m) / d;
}

/** Senior tranche size in USD cents. */
export function seniorTrancheUsdCents(p: TvvParams): bigint {
  return mulDiv(p.poolUsdCents, p.seniorBps, ECONOMICS_BPS);
}

/** Junior first-loss layer size in USD cents. */
export function juniorTrancheUsdCents(p: TvvParams): bigint {
  return mulDiv(p.poolUsdCents, p.juniorBps, ECONOMICS_BPS);
}

/** Step A — total operational slots per year: `78,840,000`. */
export function totalSlotsPerYear(): bigint {
  return (SECONDS_PER_YEAR * SLOT_SECONDS_DEN) / SLOT_SECONDS_NUM;
}

/** Step B — eligible (Jito-landing) trading slots per year. */
export function eligibleSlots(p: TvvParams): bigint {
  return mulDiv(totalSlotsPerYear(), p.jitoLandingBps, ECONOMICS_BPS);
}

/** Systemic concentration cap (`C_sys`) in USD cents. Default: 60% of pool. */
export function systemicCapUsdCents(p: TvvParams): bigint {
  return mulDiv(p.poolUsdCents, p.systemicCapBps, ECONOMICS_BPS);
}

/** Single-desk cap (`C_desk`) in USD cents. Default: 15% of pool. */
export function deskCapUsdCents(p: TvvParams): bigint {
  return mulDiv(p.poolUsdCents, p.deskCapBps, ECONOMICS_BPS);
}

/**
 * Average active slot utilization (`μ`) in USD cents. Default: 40% of `C_sys`
 * = 24% of pool.
 */
export function activeUtilizationUsdCents(p: TvvParams): bigint {
  return mulDiv(systemicCapUsdCents(p), p.avgUtilizationBps, ECONOMICS_BPS);
}

/**
 * Step C — the micro-premium fee per slot in micro-USD ($1e-6), floored.
 * Exact form is `(μ × R_base) / S_total`; ≈ `$0.0073059` (7,305 µUSD).
 */
export function slotFeeMicroUsd(p: TvvParams): bigint {
  const annualUsdCents = mulDiv(activeUtilizationUsdCents(p), p.baseRateBps, ECONOMICS_BPS);
  return mulDiv(annualUsdCents, MICRO_DOLLARS_PER_CENT, totalSlotsPerYear());
}

/**
 * Step D — gross annualized revenue in USD cents. Equivalent closed form
 * `μ × R_base × L_jito` (no per-slot rounding): `$460,800.00` for the
 * reference pool.
 */
export function grossRevenueUsdCents(p: TvvParams): bigint {
  const priced = mulDiv(activeUtilizationUsdCents(p), p.baseRateBps, ECONOMICS_BPS);
  return mulDiv(priced, p.jitoLandingBps, ECONOMICS_BPS);
}

/** Step E — net revenue after the Jito tip cut and bare-metal infra cost. */
export function netRevenueUsdCents(p: TvvParams): bigint {
  const gross = grossRevenueUsdCents(p);
  const afterTip = gross - mulDiv(gross, p.jitoTipBps, ECONOMICS_BPS);
  const net = afterTip - p.infraUsdCents;
  return net < 0n ? 0n : net;
}

/** Step F — Default Insurance Fund (DIF) reserve cut of net revenue. */
export function difAllocationUsdCents(p: TvvParams): bigint {
  return mulDiv(netRevenueUsdCents(p), p.difBps, ECONOMICS_BPS);
}

/** Step G — total residual yield distributed to LP tranches: `N − D`. */
export function totalLpYieldUsdCents(p: TvvParams): bigint {
  return netRevenueUsdCents(p) - difAllocationUsdCents(p);
}

/** Senior LP contractual fixed hurdle: `P_sr × R_hurdle`. */
export function seniorYieldUsdCents(p: TvvParams): bigint {
  return mulDiv(seniorTrancheUsdCents(p), p.seniorHurdleBps, ECONOMICS_BPS);
}

/** Junior LP performance residual: everything above the senior hurdle. */
export function juniorYieldUsdCents(p: TvvParams): bigint {
  const residual = totalLpYieldUsdCents(p) - seniorYieldUsdCents(p);
  return residual < 0n ? 0n : residual;
}

/**
 * Junior-tranche drain (in USD cents) that trips the on-chain hard circuit
 * breaker. Default: 50% of the junior first-loss layer = `$1,500,000`.
 */
export function circuitBreakerDrainUsdCents(p: TvvParams): bigint {
  return mulDiv(juniorTrancheUsdCents(p), p.circuitBreakerDrainBps, ECONOMICS_BPS);
}

/** Junior-tranche drain ratio in bps given the junior tranche size. */
export function juniorDrainRatioBps(drainedUsdCents: bigint, juniorUsdCents: bigint): bigint {
  if (juniorUsdCents === 0n) return 0n;
  return mulDiv(drainedUsdCents, ECONOMICS_BPS, juniorUsdCents);
}

/**
 * Hard circuit breaker predicate: a cascading liquidation down to the
 * `circuitBreakerDrainBps` floor freezes every credit facility so the senior
 * principal can never be impaired.
 */
export function hardLockTriggered(p: TvvParams, drainedUsdCents: bigint): boolean {
  return juniorDrainRatioBps(drainedUsdCents, juniorTrancheUsdCents(p)) >= p.circuitBreakerDrainBps;
}