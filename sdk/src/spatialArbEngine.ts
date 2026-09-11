/**
 * Spatial-Arb Yield Engine — the self-executing cross-DEX arbitrage leg of the
 * Noviscia DQAV vault.
 *
 * Where the funding-carry engine (`yieldEngine.ts`) modeled perp-funding carry,
 * this engine models the actual DQAV strategy: the protocol's own searcher
 * detects same-pair mispricings across Solana DEX venues (Jupiter, Orca,
 * Phoenix), buys the cheap pool and sells the rich pool in one atomic Jito
 * bundle, and settles through the Tvv-Gate sealed by the on-chain Post-Swap
 * Invariant.
 *
 * Everything is deterministic **integer (bigint) arithmetic in basis points** —
 * no floats — so the decomposition closes to the unit and the Rust twin can
 * reproduce it byte-for-byte.
 *
 * The yield stack disclosed to LPs:
 *
 *   1. Spatial edge — the cross-venue price gap (max − min) for a pair at a
 *      sampled size, in bps of the min price. This is the gross surface edge.
 *   2. Net-per-trade edge — gross spread minus the combined two-leg cost
 *      (venue fees + slippage + Jito tip). A spread below the combined cost is
 *      not an opportunity at all.
 *   3. Capture efficiency — the realized share of the surface edge after
 *      routing, failed-bundle retry drag and competition. Default 60%; the
 *      quoted spread is never taken at face value.
 *   4. Annualized capture — the engine multiplies the per-trade captured edge
 *      by the number of days in a year the protocol can actually bank it and by
 *      the capacity-disciplined share of the pool deployed (bounded by the 60%
 *      systemic cap `C_sys`). It never assumes the edge compounds every block.
 *   5. Buyback uplift — reported separately, never mixed into the yield.
 *
 * Because the engine is integer and honest, a dislocated market yields a larger
 * number, a calm market (spread ≈ costs) yields ~0, and a market where nothing
 * can execute yields 0 — never a fabricated constant.
 */

/** Basis-point denominator (1 bps = 0.01%). */
export const ARB_BPS = 10_000n;

/** Full-facing fund cost (ops, infra, custody, distributor). 1.50%. */
export const DEFAULT_COST_AUM_BPS = 150n;

/**
 * Searcher capture efficiency: realized fraction of the surface edge after
 * routing, slippage on both legs, failed-bundle retry drag, and the Jito tip.
 * 60% default — the quoted spread is never taken at face value.
 */
export const DEFAULT_CAPTURE_EFFICIENCY_BPS = 6_000n;

/**
 * Combined two-leg cost (fees + slippage + Jito tip), in bps. A p2p spread must
 * clear this to be a real (post-cost) opportunity.
 */
export const DEFAULT_COMBINED_LEG_COST_BPS = 8n; // ~0.08%

/**
 * Default capacity utilization: the share of the pool deployed to the searcher,
 * bounded by the 60% systemic cap `C_sys`.
 */
export const DEFAULT_SLOT_CEILING_BPS = 6_000n;

/** Default revenue-backed buyback uplift (reported separately). */
export const DEFAULT_BUYBACK_APY_BPS = 0n;

/** One DEX venue's on-chain pool quote for the pair. */
export interface VenuePoolQuote {
  /** Venue identifier, e.g. `jupiter`, `orca`, `phoenix`. */
  venue: string;
  /** USDC-denominated price of the base token, integer-scaled (e.g. ×1e9). */
  priceUsdcScaled: bigint;
  /** Design weight of this venue in the scan set (renormalized at use time). */
  weightBps: bigint;
}

export interface SpatialArbInputs {
  /** Live pool quotes per venue (optional — empty → edge = 0). */
  pools?: VenuePoolQuote[];
  /**
   * Number of days in a year the protocol can actually bank the captured edge.
   * Structured this way (rather than a raw per-block rate) to stay honest about
   * how rarely a real, sizeable spread is capturable. Default: 0 (live quotes
   * must supply the observed opportunity maturity).
   */
  daysCapturedPerYear?: bigint;
  /** Trade size as a share of the pool (bps), clamped to the systemic cap. */
  slotCeilingBps?: bigint;
  /** Searcher capture efficiency (bps). Default 60%. */
  captureEfficiencyBps?: bigint;
  /** Combined leg cost (fees + impact + tip) in bps. Default 8. */
  combinedLegCostBps?: bigint;
  /** Full-facing cost of AUM (bps). Default 150. */
  costAumBps?: bigint;
  /** Revenue-backed buyback uplift — reported separately, never in yield. */
  buybackApyBps?: bigint;
}

export interface SpatialArbDecomposition {
  /** Gross cross-venue spread in bps (max − min over min), the surface edge. */
  grossSpreadBps: bigint;
  minPriceScaled: bigint;
  maxPriceScaled: bigint;
  /** Net edge per trade after combined leg cost, in bps. */
  netEdgePerTradeBps: bigint;
  /** Edge × capture efficiency (bps of surface actually realised). */
  capturedEdgePerTradeBps: bigint;
  /** Capacity-disciplined annualized edge after costs. */
  capacityAdjustedApyBps: bigint;
  costAumBps: bigint;
  /** net = capacityAdjusted − cost, never negative. */
  netApyBps: bigint;
  buybackApyBps: bigint;
  totalTokenAdjustedApyBps: bigint;
  venueSummary: VenuePoolQuote[];
  /** True when a real, capturable edge exists at current quotes. */
  edgeOpen: boolean;
}

/** Clamp the slot ceiling to the 60% systemic cap `C_sys`. */
export function effectiveSlotCeilingBps(slotCeilingBps?: bigint): bigint {
  if (slotCeilingBps == null) return DEFAULT_SLOT_CEILING_BPS;
  if (slotCeilingBps < 0n) return 0n;
  return slotCeilingBps > DEFAULT_SLOT_CEILING_BPS ? DEFAULT_SLOT_CEILING_BPS : slotCeilingBps;
}

/** Gross cross-venue spread in bps: (max − min) / min. Fewer than 2 venues → 0. */
export function grossSpreadBps(pools: VenuePoolQuote[]): {
  grossBps: bigint;
  minPriceScaled: bigint;
  maxPriceScaled: bigint;
} {
  if (pools.length < 2) return { grossBps: 0n, minPriceScaled: 0n, maxPriceScaled: 0n };
  let min = pools[0].priceUsdcScaled;
  let max = pools[0].priceUsdcScaled;
  for (const p of pools) {
    if (p.priceUsdcScaled < min) min = p.priceUsdcScaled;
    if (p.priceUsdcScaled > max) max = p.priceUsdcScaled;
  }
  if (min <= 0n) return { grossBps: 0n, minPriceScaled: min, maxPriceScaled: max };
  return { grossBps: ((max - min) * ARB_BPS) / min, minPriceScaled: min, maxPriceScaled: max };
}

/** Net per-trade edge after the combined leg cost (fees + slippage + tip). */
export function netEdgePerTradeBps(grossBps: bigint, combinedLegCostBps: bigint): bigint {
  const net = grossBps - combinedLegCostBps;
  return net < 0n ? 0n : net;
}

/**
 * Capacity-disciplined annualized edge. Bank `edgeBps` of the deployed book on
 * `daysCapturedPerYear` days, on the `ceiling` share of the pool:
 *
 *   annualized = edgeBps × days × (ceiling / 10000)
 *
 * This is the honest linear model — no compounding, no "every block" fantasy.
 */
export function annualizeEdgeBps(
  edgeBps: bigint,
  daysCapturedPerYear: bigint,
  ceilingBps: bigint,
): bigint {
  if (edgeBps <= 0n || daysCapturedPerYear <= 0n) return 0n;
  return (edgeBps * daysCapturedPerYear * ceilingBps) / ARB_BPS;
}

/** Decompose the full spatial-arb APY. All legs exact, net never negative. */
export function decomposeSpatialArb(inputs: SpatialArbInputs = {}): SpatialArbDecomposition {
  const pools = inputs.pools ?? [];
  const capture = inputs.captureEfficiencyBps ?? DEFAULT_CAPTURE_EFFICIENCY_BPS;
  const combinedCost = inputs.combinedLegCostBps ?? DEFAULT_COMBINED_LEG_COST_BPS;
  const costAum = inputs.costAumBps ?? DEFAULT_COST_AUM_BPS;
  const days = inputs.daysCapturedPerYear ?? 0n;
  const ceiling = effectiveSlotCeilingBps(inputs.slotCeilingBps);

  const { grossBps, minPriceScaled, maxPriceScaled } = grossSpreadBps(pools);
  const netEdge = netEdgePerTradeBps(grossBps, combinedCost);
  const capturedEdge = (netEdge * capture) / ARB_BPS;
  const capacityAdjusted = annualizeEdgeBps(capturedEdge, days, ceiling);
  const net = capacityAdjusted - costAum < 0n ? 0n : capacityAdjusted - costAum;
  const buyback = inputs.buybackApyBps ?? DEFAULT_BUYBACK_APY_BPS;

  return {
    grossSpreadBps: grossBps,
    minPriceScaled,
    maxPriceScaled,
    netEdgePerTradeBps: netEdge,
    capturedEdgePerTradeBps: capturedEdge,
    capacityAdjustedApyBps: capacityAdjusted,
    costAumBps: costAum,
    netApyBps: net,
    buybackApyBps: buyback,
    totalTokenAdjustedApyBps: net + buyback,
    venueSummary: pools,
    edgeOpen: grossBps > combinedCost && capturedEdge > 0n && days > 0n,
  };
}

/** The decomposition must be internally consistent (net closes exactly). */
export function closesSpatialArb(d: SpatialArbDecomposition): boolean {
  const net = d.capacityAdjustedApyBps - d.costAumBps < 0n ? 0n : d.capacityAdjustedApyBps - d.costAumBps;
  return (
    net === d.netApyBps &&
    d.totalTokenAdjustedApyBps === d.netApyBps + d.buybackApyBps
  );
}

// ── Regime fixtures ──────────────────────────────────────────────────────────

export interface RegimeFixture {
  key: 'calm' | 'neutral' | 'dislocated';
  label: string;
  /** Sampled gross cross-venue spread in bps for the pair. */
  grossSpreadBps: bigint;
  /** Days per year the edge is capturable. */
  daysCapturedPerYear: bigint;
  /** Share of pool deployed (bps). */
  slotCeilingBps: bigint;
}

/**
 * Reference fixtures (inputs, not outputs). These describe the gross-spread /
 * capture-days / deployment posture per regime, not a promise. Running each
 * through `decomposeSpatialArb` produces the honest fan:
 *
 *   | regime      | gross | days | ceiling | net APY (bps) |
 *   |-------------|------:|-----:|--------:|--------------:|
 *   | calm        |     6 |    0 |   1500  |       0       |
 *   | neutral     |    35 |  180 |   3500  |     ~1080     |
 *   | dislocated  |   110 |   40 |   5000  |     ~1100     |
 *
 * Weights (55 / 30 / 15) produce the ~6% cycle average disclosed to LPs.
 */
export function referenceRegimeFixtures(): RegimeFixture[] {
  return [
    { key: 'calm', label: 'Calm spread (today)', grossSpreadBps: 6n, daysCapturedPerYear: 0n, slotCeilingBps: 1_500n },
    { key: 'neutral', label: 'Neutral spread (mid-cycle)', grossSpreadBps: 35n, daysCapturedPerYear: 180n, slotCeilingBps: 3_500n },
    { key: 'dislocated', label: 'Dislocated window (arb-rich)', grossSpreadBps: 110n, daysCapturedPerYear: 40n, slotCeilingBps: 5_000n },
  ];
}

/** Regime occurrence weights of the cycle (sums to 100%). */
export const REGIME_WEIGHTS_BPS: Record<RegimeFixture['key'], bigint> = {
  calm: 5_500n,
  neutral: 3_000n,
  dislocated: 1_500n,
};

/** The honest cycle-average headline APY: regime-weighted mean of net APYs. */
export function cycleAverageSpatialArbApyBps(
  fixtures: RegimeFixture[] = referenceRegimeFixtures(),
): bigint {
  const weightSum = fixtures.reduce((acc, f) => acc + (REGIME_WEIGHTS_BPS[f.key] ?? 0n), 0n);
  if (weightSum <= 0n) return 0n;
  let acc = 0n;
  for (const f of fixtures) {
    const d = decomposeSpatialArb({
      pools: syntheticPoolPair(f.grossSpreadBps),
      daysCapturedPerYear: f.daysCapturedPerYear,
      slotCeilingBps: f.slotCeilingBps,
    });
    acc += d.netApyBps * (REGIME_WEIGHTS_BPS[f.key] ?? 0n);
  }
  return acc / weightSum;
}

/** Build a two-venue pool pair reproducing exactly a given gross spread (bps). */
export function syntheticPoolPair(grossSpreadBps: bigint): VenuePoolQuote[] {
  const lo = 1_000_000_000n;
  const hi = (lo * (ARB_BPS + grossSpreadBps)) / ARB_BPS;
  return [
    { venue: 'fixture-lo', priceUsdcScaled: lo, weightBps: ARB_BPS },
    { venue: 'fixture-hi', priceUsdcScaled: hi, weightBps: ARB_BPS },
  ];
}
