/**
 * Assumption Registry — the single source of truth for every economic input in
 * the Noviscia TVV risk engine.
 *
 * Every assumption is labeled with a provenance pin so no number can be
 * mistaken for something stronger than it is:
 *
 *   `assumed`          — a design/planning input, not yet end-to-end measured
 *   `simulated`        — derived by the deterministic bigint engine in this SDK
 *   `testnet-measured` — observed on our devnet ledger / sandbox runs
 *   `production-measured` — observed on a live mainnet deployment
 *   `pending`          — target for a live measurement that has not run yet
 *
 * The biggest rule: a simulated result is NOT live performance, and a legal
 * design is NOT legal protection. Assumption entries document the basis for
 * every figure so an external reviewer can reproduce each number.
 */

/** Provenance label for every assumption in the registry. */
export type Provenance =
  | 'assumed'
  | 'simulated'
  | 'testnet-measured'
  | 'production-measured'
  | 'pending';

/** One registry entry. All monetary values are USD cents (integer bigint). */
export interface Assumption {
  key: string;
  label: string;
  valueUsdCents: bigint;
  provenance: Provenance;
  basis: string;
}

const USD = (x: number): bigint => BigInt(Math.round(x * 100));

/**
 * The audited reference pool and its slot-economics parameters. This is the
 * exact set the economics engine (`economics.ts`) treats as canonical.
 */
export const REFERENCE_POOL_USD_CENTS = USD(10_000_000); // $10,000,000
export const SENIOR_LP_BPS = 7_000n; // 70%
export const JUNIOR_LP_BPS = 3_000n; // 30%
export const SYSTEMIC_CAP_BPS = 6_000n; // 60%
export const DESK_CAP_BPS = 1_500n; // 15%
export const AVG_ACTIVE_UTILIZATION_BPS = 4_000n; // 40% of systemic cap
export const JITO_LANDING_BPS = 8_000n; // 80%
export const BASE_RATE_BPS = 2_400n; // 24% implied annualized rate
export const JITO_TIP_BPS = 150n; // 1.5% of gross → Jito auction
export const DIF_BPS = 2_000n; // 20% of net revenue → protocol reserves
export const INFRA_USD_CENTS = USD(50_000); // bare-metal infra p.a.
export const SENIOR_HURDLE_BPS = 450n; // 4.50% contractual senior hurdle
export const CIRCUIT_BREAKER_DRAIN_BPS = 5_000n; // 50% junior drain → hard lock

/**
 * Counterparty/liquidity assumptions.
 *
 * `locHaircutBps` is the 25% flat LoC haircut applied by the risk committee
 * to a desk's committed line of credit (per QUANTIFIED_RISK_PACK.md §5).
 */
export const LOC_HAIRCUT_BPS = 2_500n; // 25%

/**
 * LoC coverage cap: the committed line is sized at 60% of the desk's exposure
 * (the haircut is then applied on whichever is smaller). With full-face LoCs
 * the L2 layer would absorb every default, so a realistic cap is what lets the
 * waterfall reach reserves/tranches for the checklist scenarios.
 */
export const LOC_COVERAGE_BPS = 6_000n; // 60% of exposure

/** Collateral coverage assumed per desk position (fraction of exposure). */
export const DESK_COLLATERAL_COVERAGE_BPS = 3_000n; // 30% of position exposure

/**
 * Steady-state protocol-reserve seed (DIF + default fund). Purely illustrative
 * for the waterfall scenarios — the reserve is fed by the 20% DIF cut over
 * time; a $500k seed approximates the modeled build on the reference pool.
 */
export const REFERENCE_RESERVE_USD_CENTS = USD(500_000);

/**
 * Settlement/operational windows. These are protocol constants (on-chain time
 * locks) — measured where the ledger enforces them, assumed where they only
 * exist in the spec sheet.
 */
export const DEBT_WINDOW_HOURS = 24n;
export const GRACE_PERIOD_HOURS = 2n;

/**
 * The full registry as a stable, ordered list. The order matches the
 * investor-checklist ordering so the claims table can index straight into it.
 */
export const ASSUMPTIONS: Assumption[] = [
  {
    key: 'pool_size',
    label: 'Total pool size',
    valueUsdCents: REFERENCE_POOL_USD_CENTS,
    provenance: 'assumed',
    basis: 'Reference balance sheet per economics.ts (§ reference pool $10M).',
  },
  {
    key: 'senior_share',
    label: 'Senior LP tranche share',
    valueUsdCents: USD(7_000_000),
    provenance: 'assumed',
    basis: '70/30 tranche split from the economics spec.',
  },
  {
    key: 'junior_share',
    label: 'Junior LP first-loss share',
    valueUsdCents: USD(3_000_000),
    provenance: 'assumed',
    basis: '70/30 tranche split — junior is the full first-loss layer.',
  },
  {
    key: 'systemic_cap',
    label: 'Systemic aggregate cap (60%)',
    valueUsdCents: USD(6_000_000),
    provenance: 'assumed',
    basis: 'Tier-2 administrable ceiling (total_credit_limit); derived from pool.',
  },
  {
    key: 'desk_cap',
    label: 'Single-desk cap (15%)',
    valueUsdCents: USD(1_500_000),
    provenance: 'assumed',
    basis: 'Per-asset max_capacity administrable on-chain; derived from pool.',
  },
  {
    key: 'jito_eligibility',
    label: 'Jito-eligible slot rate (80%)',
    valueUsdCents: 0n,
    provenance: 'pending',
    basis: 'Needs live leader-schedule measurement; placeholder for the 80% design target.',
  },
  {
    key: 'debt_window',
    label: '24-hour debt window',
    valueUsdCents: 0n,
    provenance: 'assumed',
    basis: 'On-chain settlement window constant (window_slots = 24h).',
  },
  {
    key: 'grace_period',
    label: '2-hour grace period',
    valueUsdCents: 0n,
    provenance: 'assumed',
    basis: 'On-chain grace constant (grace_slots = 2h).',
  },
  {
    key: 'loc_haircut',
    label: 'LoC haircut (25%)',
    valueUsdCents: 0n,
    provenance: 'assumed',
    basis: 'Risk-committee applied per QUANTIFIED_RISK_PACK.md §5.',
  },
  {
    key: 'infrastructure',
    label: 'Annual bare-metal infrastructure',
    valueUsdCents: INFRA_USD_CENTS,
    provenance: 'assumed',
    basis: 'Node + gRPC + indexer footprint estimate.',
  },
];

/**
 * Resolve a single assumption by key (throws on unknown key so typos surface
 * in tests rather than producing a silent undefined).
 */
export function assumptionByKey(key: string): Assumption {
  const hit = ASSUMPTIONS.find((a) => a.key === key);
  if (!hit) throw new RangeError(`unknown assumption key: ${key}`);
  return hit;
}

/** True when a given monetary figure is safe to describe as measured. */
export function isMeasured(a: Assumption): boolean {
  return a.provenance === 'testnet-measured' || a.provenance === 'production-measured';
}