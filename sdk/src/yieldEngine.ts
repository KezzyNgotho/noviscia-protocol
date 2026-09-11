/**
 * Funding-Carry Yield Engine — the honest yield layer behind the Noviscia
 * neutral on-chain funding vault.
 *
 * Replaces the per-slot Jit-Risk "velocity APY" model (Module 1/2 of the TVV
 * engine, `economics.ts` / `velocity.ts`) as the *vault yield* source of
 * truth. Every number is deterministic **integer (bigint) arithmetic in basis
 * points** — no floats — so the decomposition closes to the unit and the Rust
 * twin (`noviscia-asset-engine-sdk::yield_engine`) can reproduce it
 * byte-for-byte.
 *
 * The yield stack is exactly the one disclosed to LPs:
 *
 *   1. LST-carry base   — staking yield on the delta-hedged spot book. This is
 *      the neutral floor: it does not move with SOL price.
 *   2. Funding capture  — future-style funding payments received on hedged
 *      perp positions across venues. Reward is regime-dependent and can go
 *      negative (bear-funding stretches); hedge efficiency and a venue credit
 *      haircut are applied so the figure is never the raw quoted rate.
 *   3. Cross-venue dispersion — the basis between venues (Hyperliquid vs
 *      Binance vs Bybit vs dYdX) captured without directional exposure.
 *   4. Collateralized leverage — capped at `LEVERAGE_CAP_BPS` (35%) of the
 *      book, applied only to the funding+dispersion legs and only when their
 *      net carry exceeds the borrow cost. Never leveraged to the whole book.
 *
 * Buyback uplift (NVSC buyback funded by protocol fees) is reported as a
 * separate, additive line — it is never mixed into the yield figure.
 *
 * Regime fan: three scenario fixtures (compressed / neutral / bull) whose
 * inputs are labeled `assumed` in `assumptions.ts`; the cycle average is the
 * honest headline (~7% net). The live devnet probe (`scripts/devnet/
 * yield-live-probe.ts`) feeds real quoted funding into this same engine.
 */

/** Basis-point denominator (1 bps = 0.01%). */
export const YIELD_BPS = 10_000n;

/**
 * Collateralized-leverage cap: at most 35% of the book may be used as levered
 * collateral, never the whole book. Mirrors the `<400ms` neutral-by-
 * construction stance disclosed to LPs.
 */
export const LEVERAGE_CAP_BPS = 3_500n;

/** Reference LST staking carry: ≈ 6% (JitoSOL/Sanctum INF band 5.7–6.4%). */
export const DEFAULT_LST_CARRY_BPS = 600n;

/**
 * Hedge efficiency: the share of quoted funding actually realised after
 * roll/spread costs. 90% default — the quoted rate is never taken at face
 * value.
 */
export const DEFAULT_HEDGE_EFFICIENCY_BPS = 9_000n;

/**
 * Venue credit haircut: the share of funding credited after venue default /
 * settlement-slippage / liquidation risk. 90% default; places like a failing
 * DEX are haircut, not assumed risk-free.
 */
export const DEFAULT_VENUE_CREDIT_BPS = 9_000n;

/** Borrow cost on the levered portion of the book (annualized). */
export const DEFAULT_BORROW_COST_APY_BPS = 900n;

/** Full-facing fund cost (ops, infra, custody, distributor). */
export const DEFAULT_COST_AUM_BPS = 150n;

/** Default revenue-backed buyback uplift (reported separately). */
export const DEFAULT_BUYBACK_APY_BPS = 0n;

/** One perp venue's annualized funding quote and its book weight. */
export interface VenueFunding {
  /** Venue identifier, e.g. `hyperliquid`, `binance`, `bybit`, `dydx`. */
  venue: string;
  /** Annualized funding in bps, signed (negative = longs pay shorts reverse). */
  fundingApyBps: bigint;
  /** Design weight of this venue in the book (renormalized at use time). */
  weightBps: bigint;
}

export interface FundingCarryInputs {
  /** Annualized LST staking carry on the spot book (default ~6%). */
  lstCarryApyBps?: bigint;
  /** Live funding quotes per venue (optional — empty → funding leg = 0). */
  venues?: VenueFunding[];
  /** Annualized cross-venue dispersion capture on the base book. */
  dispersionApyBps?: bigint;
  /** Hedge efficiency (bps). Default 90%. */
  hedgeEfficiencyBps?: bigint;
  /** Venue credit haircut (bps). Default 90%. */
  venueCreditBps?: bigint;
  /** Levered-collateral share of the book, clamped to `LEVERAGE_CAP_BPS`. */
  leverageRateBps?: bigint;
  /** Annualized borrow cost on the levered portion. */
  borrowCostApyBps?: bigint;
  /** Full-facing cost of AUM. */
  costAumBps?: bigint;
  /** Revenue-backed buyback uplift — reported separately, never in yield. */
  buybackApyBps?: bigint;
}

export interface ApyDecomposition {
  lstCarryApyBps: bigint;
  weightedFundingApyBps: bigint;
  fundingNetApyBps: bigint;
  dispersionApyBps: bigint;
  dispersionNetApyBps: bigint;
  leverageRateAppliedBps: bigint;
  leverageBoostApyBps: bigint;
  grossApyBps: bigint;
  costAumBps: bigint;
  netApyBps: bigint;
  buybackApyBps: bigint;
  totalTokenAdjustedApyBps: bigint;
  venueSummary: VenueFunding[];
}

export interface RegimeFixture {
  key: 'compressed' | 'neutral' | 'bull';
  label: string;
  fundingApyBps: bigint;
  dispersionApyBps: bigint;
  leverageRateBps: bigint;
}

/**
 * Signed floor `n × m / d`, exact over bigint. JS `/` truncates toward zero
 * for negatives; the engine floors so negative funding legs stay conservative
 * (never rounds a loss up).
 */
export function mulDivFloor(n: bigint, m: bigint, d: bigint): bigint {
  const p = n * m;
  const q = p / d;
  const r = p % d;
  if (r !== 0n && p < 0n) return q - 1n;
  return q;
}

/** Clamp the levered share of the book to the 35% cap. */
export function effectiveLeverageRateBps(leverageRateBps?: bigint): bigint {
  if (leverageRateBps == null) return LEVERAGE_CAP_BPS;
  if (leverageRateBps < 0n) return 0n;
  return leverageRateBps > LEVERAGE_CAP_BPS ? LEVERAGE_CAP_BPS : leverageRateBps;
}

/**
 * Weighted, weight-normalized funding across venues. Weights are renormalized
 * against their own sum so a partial venue set (some feeds down) does not skew
 * the blend. Empty venue list → 0 (the funding leg is then honestly zero).
 */
export function weightedVenueFundingApyBps(venues: VenueFunding[]): bigint {
  if (venues.length === 0) return 0n;
  const weightSum = venues.reduce((acc, v) => acc + v.weightBps, 0n);
  if (weightSum <= 0n) return 0n;
  let acc = 0n;
  for (const v of venues) acc += v.fundingApyBps * v.weightBps;
  return mulDivFloor(acc, 1n, weightSum);
}

/** Funding leg after hedge efficiency and venue credit haircuts. */
export function fundingNetApyBps(
  fundingApyBps: bigint,
  hedgeEfficiencyBps: bigint = DEFAULT_HEDGE_EFFICIENCY_BPS,
  venueCreditBps: bigint = DEFAULT_VENUE_CREDIT_BPS,
): bigint {
  return mulDivFloor(
    mulDivFloor(fundingApyBps, hedgeEfficiencyBps, YIELD_BPS),
    venueCreditBps,
    YIELD_BPS,
  );
}

/**
 * Collateralized-leverage boost. Applied only to the funding+dispersion legs,
 * only on the levered share, and only when the combined carry clears the
 * borrow cost. Max: 35% of the book.
 */
export function leverageBoostApyBps(
  fundingNet: bigint,
  dispersionNet: bigint,
  leverageRateBps: bigint,
  borrowCostApyBps: bigint = DEFAULT_BORROW_COST_APY_BPS,
): bigint {
  const lev = effectiveLeverageRateBps(leverageRateBps);
  if (lev <= 0n) return 0n;
  const carry = fundingNet + dispersionNet;
  const spread = carry - borrowCostApyBps;
  if (spread <= 0n) return 0n;
  return mulDivFloor(spread, lev, YIELD_BPS);
}

/**
 * The full decomposed APY. Legs are exact; `gross = lst + funding + dispersion
 * + leverage` closes to the unit, and `net = gross − cost` (never negative).
 */
export function decomposeApy(inputs: FundingCarryInputs = {}): ApyDecomposition {
  const lstCarry = inputs.lstCarryApyBps ?? DEFAULT_LST_CARRY_BPS;
  const venues = inputs.venues ?? [];
  const hedge = inputs.hedgeEfficiencyBps ?? DEFAULT_HEDGE_EFFICIENCY_BPS;
  const credit = inputs.venueCreditBps ?? DEFAULT_VENUE_CREDIT_BPS;
  const dispersion = inputs.dispersionApyBps ?? 0n;
  const borrowCost = inputs.borrowCostApyBps ?? DEFAULT_BORROW_COST_APY_BPS;
  const costAum = inputs.costAumBps ?? DEFAULT_COST_AUM_BPS;
  const levRequested = inputs.leverageRateBps ?? 0n;

  const weightedFunding = weightedVenueFundingApyBps(venues);
  const fundingNet = fundingNetApyBps(weightedFunding, hedge, credit);
  const dispersionNet = fundingNetApyBps(dispersion, hedge, credit);
  const levApplied = effectiveLeverageRateBps(levRequested);
  const boost = leverageBoostApyBps(fundingNet, dispersionNet, levApplied, borrowCost);

  const gross = lstCarry + fundingNet + dispersionNet + boost;
  const net = gross - costAum < 0n ? 0n : gross - costAum;
  const buyback = inputs.buybackApyBps ?? DEFAULT_BUYBACK_APY_BPS;

  return {
    lstCarryApyBps: lstCarry,
    weightedFundingApyBps: weightedFunding,
    fundingNetApyBps: fundingNet,
    dispersionApyBps: dispersion,
    dispersionNetApyBps: dispersionNet,
    leverageRateAppliedBps: levApplied,
    leverageBoostApyBps: boost,
    grossApyBps: gross,
    costAumBps: costAum,
    netApyBps: net,
    buybackApyBps: buyback,
    totalTokenAdjustedApyBps: net + buyback,
    venueSummary: venues,
  };
}

/** The decomposition must be internally consistent (gross/net close exactly). */
export function closesApy(d: ApyDecomposition): boolean {
  const gross = d.lstCarryApyBps + d.fundingNetApyBps + d.dispersionNetApyBps + d.leverageBoostApyBps;
  if (gross !== d.grossApyBps) return false;
  const net = d.grossApyBps - d.costAumBps < 0n ? 0n : d.grossApyBps - d.costAumBps;
  return net === d.netApyBps && d.totalTokenAdjustedApyBps === d.netApyBps + d.buybackApyBps;
}

/**
 * Reference regime fixtures (inputs, not outputs). These are labeled `assumed`
 * in `assumptions.ts` — they describe the funding/dispersion/leverage posture
 * per regime, not a promise. `decomposeApy` on each fixture produces the
 * honest fan:
 *
 *   | regime     | funding | dispersion | levered | net APY (bps) |
 *   |------------|--------:|-----------:|--------:|--------------:|
 *   | compressed |   −500  |     400    |  0%     |      369      |
 *   | neutral    |    100  |     350    | 15%     |      814      |
 *   | bull       |   1000  |     500    | 20%     |     1728      |
 *
 * Weights (55 / 30 / 15) produce the ~706 bps cycle average.
 */
export function referenceRegimeFixtures(): RegimeFixture[] {
  return [
    { key: 'compressed', label: 'Compressed funding (today)', fundingApyBps: -500n, dispersionApyBps: 400n, leverageRateBps: 0n },
    { key: 'neutral', label: 'Neutral funding (mid-cycle)', fundingApyBps: 100n, dispersionApyBps: 350n, leverageRateBps: 1_500n },
    { key: 'bull', label: 'Bull funding window', fundingApyBps: 1_000n, dispersionApyBps: 500n, leverageRateBps: 2_000n },
  ];
}

/** Regime occurrence weights of the cycle (sums to 100%). */
export const REGIME_WEIGHTS_BPS: Record<RegimeFixture['key'], bigint> = {
  compressed: 5_500n,
  neutral: 3_000n,
  bull: 1_500n,
};

/**
 * The regime fan: each fixture decomposed with defaults and any per-regime
 * overrides. `inputs` lets a caller override defaults (e.g. force cost=0).
 */
export function regimeFanBps(
  fixtures: RegimeFixture[] = referenceRegimeFixtures(),
  inputs: FundingCarryInputs = {},
): { key: RegimeFixture['key']; label: string; netApyBps: bigint; grossApyBps: bigint }[] {
  return fixtures.map((f) => {
    const d = decomposeApy({
      lstCarryApyBps: inputs.lstCarryApyBps,
      hedgeEfficiencyBps: inputs.hedgeEfficiencyBps,
      venueCreditBps: inputs.venueCreditBps,
      borrowCostApyBps: inputs.borrowCostApyBps,
      costAumBps: inputs.costAumBps,
      venues: [{ venue: f.key, fundingApyBps: f.fundingApyBps, weightBps: YIELD_BPS }],
      dispersionApyBps: f.dispersionApyBps,
      leverageRateBps: f.leverageRateBps,
    });
    return { key: f.key, label: f.label, netApyBps: d.netApyBps, grossApyBps: d.grossApyBps };
  });
}

/**
 * The honest cycle-average headline APY: regime-weighted mean of the fan's net
 * APYs. Reference result ≈ **706 bps (7.06%)** — matches the disclosed ~7%
 * cycle average.
 */
export function cycleAverageApyBps(
  fixtures: RegimeFixture[] = referenceRegimeFixtures(),
  inputs: FundingCarryInputs = {},
): bigint {
  const fan = regimeFanBps(fixtures, inputs);
  const weightSum = fixtures.reduce((acc, f) => acc + (REGIME_WEIGHTS_BPS[f.key] ?? 0n), 0n);
  if (weightSum <= 0n) return 0n;
  let acc = 0n;
  for (const row of fan) {
    const fixture = fixtures.find((f) => f.key === row.key);
    const w = fixture ? REGIME_WEIGHTS_BPS[fixture.key] ?? 0n : 0n;
    acc += row.netApyBps * w;
  }
  return mulDivFloor(acc, 1n, weightSum);
}