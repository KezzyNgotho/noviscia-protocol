/**
 * Loss-Waterfall & Failure-Scenario Engine — TVV risk engine Module 5.
 *
 * Executable twin of the insolvency policy (docs/INSOLVENCY_POLICY.md L1–L5)
 * expressed in the investor-checklist terminology. A desk default event absorbs
 * through these layers, in order, until the loss is fully covered:
 *
 *   L1  Desk collateral   — proceeds from seizing the desk's margin
 *   L2  Line of credit    — the desk's committed LoC at the risk-committee
 *                           haircut (25%, sees ASSUMPTIONS.loc_haircut)
 *   L3  Protocol reserves — DIF / default fund / CCP equity (on-chain L2–L4)
 *   L4  Junior LPs        — the first-loss tranche (30% of pool)
 *   L5  Senior LPs        — last-loss, contractual 4.50% hurdle capital
 *
 * The engine is:
 *   - deterministic  — same inputs ⇒ identical bigint outputs, no floats
 *   - reproducible   — the 11 checklist failure scenarios are built here and
 *                      re-emitted by scripts/investor as a stress table
 *   - decoupled from live state — every input is explicit, so the module runs
 *                      purely "on paper"; nothing here is production telemetry.
 *
 * Provenance: these numbers are SIMULATED. They become live only once a desk
 * actually defaults under supervision on devnet and the transfers are
 * observed — that evidence is tracked separately (counterparty validation).
 */

import {
  REFERENCE_POOL_USD_CENTS,
  SENIOR_LP_BPS,
  JUNIOR_LP_BPS,
  DESK_CAP_BPS,
  DESK_COLLATERAL_COVERAGE_BPS,
  LOC_HAIRCUT_BPS,
  LOC_COVERAGE_BPS,
  REFERENCE_RESERVE_USD_CENTS,
} from './assumptions';
import {
  ECONOMICS_BPS,
  mulDiv,
  grossRevenueUsdCents,
  referenceTvvParams,
  type TvvParams,
} from './economics';

/** Whether a committed LoC actually pays out during the default event. */
export type LocOutcome = 'paid' | 'delayed' | 'failed';

/** One desk default event. All values USD cents (integer bigint). */
export interface DeskDefaultEvent {
  deskId: string;
  /** Principal at risk when the desk fails to repay. */
  exposureUsdCents: bigint;
  /** Proceeds actually recovered from seizing the desk's collateral. */
  collateralRecoveryUsdCents: bigint;
  /** Face value of the desk's committed line of credit. */
  locFaceUsdCents: bigint;
  /** Haircut the committee applies to the LoC (bps of face). */
  locHaircutBps: bigint;
  /** Whether the LoC actually honors the draw during this event. */
  locOutcome: LocOutcome;
}

/** The protective-capital stock available to absorb a sequence of defaults. */
export interface WaterfallState {
  /** DIF / default fund / CCP equity. */
  protocolReservesUsdCents: bigint;
  /** Current junior-tranche balance (first-loss layer). */
  juniorTrancheUsdCents: bigint;
  /** Current senior-tranche balance (last-loss layer). */
  seniorTrancheUsdCents: bigint;
  /** Cumulative junior-tranche drain (bps) that trips the hard lock. */
  circuitBreakerDrainBps: bigint;
}

/** How much each layer absorbed, in the order the waterfall enforces. */
export interface WaterfallResult {
  absorbed: {
    deskCollateralUsdCents: bigint;
    locUsdCents: bigint;
    protocolReservesUsdCents: bigint;
    juniorTrancheUsdCents: bigint;
    seniorTrancheUsdCents: bigint;
    /** Remaining loss no layer covered — the pool takes a capital write-down. */
    uncoveredUsdCents: bigint;
  };
  post: {
    protocolReservesUsdCents: bigint;
    juniorTrancheUsdCents: bigint;
    seniorTrancheUsdCents: bigint;
  };
  /** True once cumulative junior drain ≥ circuitBreakerDrainBps (hard lock). */
  circuitBreakerTripped: boolean;
  /** Cumulative junior-tranche drain ratio in bps (0 → not yet draining). */
  juniorDrainedBps: bigint;
}

/** Saturating subtraction: `a − b`, floor 0. */
export function subFloor(a: bigint, b: bigint): bigint {
  return a > b ? a - b : 0n;
}

/** Effective LoC coverage: `face × (1 − haircut)`, floored to 0 on non-pay. */
export function locEffectiveUsdCents(e: DeskDefaultEvent): bigint {
  if (e.locOutcome !== 'paid') return 0n;
  return mulDiv(e.locFaceUsdCents, ECONOMICS_BPS - e.locHaircutBps, ECONOMICS_BPS);
}

/**
 * Absorb a single default event through the L1→L5 cascade against the state's
 * protective capital, **mutating** the state (a later event starts from the
 * drained stock — that is how correlated defaults compound).
 *
 * @returns the per-layer absorption for this event only (not cumulative)
 */
export function absorbDefault(state: WaterfallState, e: DeskDefaultEvent): WaterfallResult {
  let remaining = e.exposureUsdCents;
  const absorbed = {
    deskCollateralUsdCents: 0n,
    locUsdCents: 0n,
    protocolReservesUsdCents: 0n,
    juniorTrancheUsdCents: 0n,
    seniorTrancheUsdCents: 0n,
    uncoveredUsdCents: 0n,
  };

  const takeAtMost = (available: bigint): bigint => {
    if (available <= 0n) return 0n;
    const take = available > remaining ? remaining : available;
    remaining -= take;
    return take;
  };

  absorbed.deskCollateralUsdCents = takeAtMost(e.collateralRecoveryUsdCents);
  absorbed.locUsdCents = takeAtMost(locEffectiveUsdCents(e));
  absorbed.protocolReservesUsdCents = takeAtMost(state.protocolReservesUsdCents);
  absorbed.juniorTrancheUsdCents = takeAtMost(state.juniorTrancheUsdCents);
  absorbed.seniorTrancheUsdCents = takeAtMost(state.seniorTrancheUsdCents);
  absorbed.uncoveredUsdCents = remaining;

  state.protocolReservesUsdCents -= absorbed.protocolReservesUsdCents;
  state.juniorTrancheUsdCents -= absorbed.juniorTrancheUsdCents;
  state.seniorTrancheUsdCents -= absorbed.seniorTrancheUsdCents;

  return {
    absorbed,
    post: { ...state },
    circuitBreakerTripped: false,
    juniorDrainedBps: 0n,
  };
}

/** Initial junior-tranche size for the reference $10M pool. */
export function referenceJuniorUsdCents(): bigint {
  return mulDiv(REFERENCE_POOL_USD_CENTS, JUNIOR_LP_BPS, ECONOMICS_BPS);
}

/** Build the $10M waterfall starting stock (reserves start at the steady-state seed). */
export function referenceWaterfallState(): WaterfallState {
  return {
    protocolReservesUsdCents: REFERENCE_RESERVE_USD_CENTS, // $500k steady-state DIF seed
    juniorTrancheUsdCents: referenceJuniorUsdCents(), // $3,000,000
    seniorTrancheUsdCents: mulDiv(REFERENCE_POOL_USD_CENTS, SENIOR_LP_BPS, ECONOMICS_BPS), // $7M
    circuitBreakerDrainBps: 5_000n, // 50% of junior → freeze
  };
}

/**
 * Absorb a sequence of default events, computing per-event absorption and the
 * running cumulative junior-drain ratio (the circuit-breaker input).
 */
export function runDefaultCascade(
  state: WaterfallState,
  events: DeskDefaultEvent[],
): { events: WaterfallResult[]; combined: WaterfallResult; scenariosTripped: Set<string> } {
  const juniorStart = state.juniorTrancheUsdCents;
  const perEvent = events.map((e) => absorbDefault(state, e));
  const drained = juniorStart - state.juniorTrancheUsdCents;
  const drainBps = juniorStart === 0n ? 0n : mulDiv(drained, ECONOMICS_BPS, juniorStart);
  const breaker = state.circuitBreakerDrainBps > 0n && drainBps >= state.circuitBreakerDrainBps;

  const zeros = (): { [K in keyof WaterfallResult['absorbed']]: bigint } => ({
    deskCollateralUsdCents: 0n,
    locUsdCents: 0n,
    protocolReservesUsdCents: 0n,
    juniorTrancheUsdCents: 0n,
    seniorTrancheUsdCents: 0n,
    uncoveredUsdCents: 0n,
  });
  const tot = zeros();
  for (const r of perEvent) {
    for (const k of Object.keys(tot) as (keyof typeof tot)[]) {
      tot[k] += r.absorbed[k];
    }
  }

  const combined: WaterfallResult = {
    absorbed: tot,
    post: {
      protocolReservesUsdCents: state.protocolReservesUsdCents,
      juniorTrancheUsdCents: state.juniorTrancheUsdCents,
      seniorTrancheUsdCents: state.seniorTrancheUsdCents,
    },
    circuitBreakerTripped: breaker,
    juniorDrainedBps: drainBps,
  };

  return {
    events: perEvent,
    combined,
    scenariosTripped: new Set<string>(),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Failure scenarios — the 11 investor-checklist scenarios, each expressed as
 * an explicit set of default events + protective-capital state. Every row is
 * SIMULATED unless a `measuredNote` says otherwise.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface Scenario {
  name: string;
  description: string;
  state: WaterfallState;
  events: DeskDefaultEvent[];
  provenance: 'simulated' | 'testnet-observed';
  measuredNote?: string;
}

/** Reference desk event at the desk cap: standard collateral + honored LoC. */
function deskDefaultAt(deskId: string, exposureUsdCents: bigint): DeskDefaultEvent {
  const collateral = mulDiv(exposureUsdCents, DESK_COLLATERAL_COVERAGE_BPS, ECONOMICS_BPS);
  return {
    deskId,
    exposureUsdCents,
    collateralRecoveryUsdCents: collateral,
    locFaceUsdCents: mulDiv(exposureUsdCents, LOC_COVERAGE_BPS, ECONOMICS_BPS), // 60% cap
    locHaircutBps: LOC_HAIRCUT_BPS,
    locOutcome: 'paid',
  };
}

const HAS_DESK_CAP = mulDiv(REFERENCE_POOL_USD_CENTS, DESK_CAP_BPS, ECONOMICS_BPS); // $1.5M

/** Scenario S1 — a single desk defaults at the desk cap. */
export function singleDefaultScenario(): Scenario {
  return {
    name: 'S1 · single default',
    description:
      'One desk fails to repay at the desk cap ($1.5M). Collateral seized at standard coverage; LoC honored at the 25% haircut.',
    state: referenceWaterfallState(),
    events: [deskDefaultAt('desk-a', HAS_DESK_CAP)],
    provenance: 'simulated',
  };
}

/** Scenario S2 — correlated defaults saturate the 60% systemic cap. */
export function correlatedDefaultsScenario(): Scenario {
  return {
    name: 'S2 · correlated defaults (systemic cap saturated)',
    description:
      'Four desks default simultaneously, totalling the 60% system cap ($6M). The stress the systemic cap is designed against.',
    state: referenceWaterfallState(),
    events: [
      deskDefaultAt('desk-a', HAS_DESK_CAP),
      deskDefaultAt('desk-b', HAS_DESK_CAP),
      deskDefaultAt('desk-c', HAS_DESK_CAP),
      deskDefaultAt('desk-d', HAS_DESK_CAP),
    ],
    provenance: 'simulated',
  };
}

/** Scenario S3 — correlated defaults with protocol reserves already drained. */
export function reserveShortfallScenario(): Scenario {
  const s = correlatedDefaultsScenario();
  s.name = 'S3 · correlated defaults + reserve shortfall';
  s.description =
    'Couples the S2 correlated cascade with a pre-existing reserve drawdown (DIF at $0) to show the direct jump to junior capital.';
  s.state.protocolReservesUsdCents = 0n;
  return s;
}

/** Scenario S4 — the desk's LoC is delayed/failed during settlement. */
export function locFailureScenario(): Scenario {
  const s = singleDefaultScenario();
  s.name = 'S4 · LoC delay / failure';
  s.description =
    'The committed LoC does not honor the draw within settlement (delay or refusal), so L2 contributes $0 and the loss cascades to reserves + tranches.';
  s.events = s.events.map((e) => ({ ...e, locOutcome: 'failed' as LocOutcome }));
  return s;
}

/** Scenario S5 — a 90% liquidity shock destroys collateral recovery. */
export function liquidityShockScenario(): Scenario {
  return {
    name: 'S5 · 90% liquidity shock',
    description:
      'Collateral value collapses ~90% at liquidation time, so L1 recovery drops to ~10% of the desk cap; LoC still honored.',
    state: referenceWaterfallState(),
    events: [
      {
        deskId: 'desk-a',
        exposureUsdCents: HAS_DESK_CAP,
        collateralRecoveryUsdCents: mulDiv(HAS_DESK_CAP, 1_000n, ECONOMICS_BPS), // ~10%
        locFaceUsdCents: mulDiv(HAS_DESK_CAP, LOC_COVERAGE_BPS, ECONOMICS_BPS),
        locHaircutBps: LOC_HAIRCUT_BPS,
        locOutcome: 'paid',
      },
    ],
    provenance: 'simulated',
  };
}

/** Scenario S6 — non-Jito slot dominance: 0% eligible landing. */
export function nonJitoSlotsScenario(p: TvvParams = { ...referenceTvvParams(), jitoLandingBps: 0n }): Scenario {
  return {
    name: 'S6 · non-Jito slot dominance',
    description:
      'Jito eligibility collapses to 0% on the leader schedule; no single-slot bundle lands, so gross revenue and the DIF build halt.',
    state: referenceWaterfallState(),
    events: [],
    provenance: 'simulated',
    measuredNote: `Revenue line rerun with L_jito=0% ⇒ gross ${grossRevenueUsdCents(p)}¢/yr; DIF contribution $0 for the period.`,
  };
}

/** Scenario S7 — congestion backs settlement past the debt window. */
export function congestionScenario(): Scenario {
  const s = singleDefaultScenario();
  s.name = 'S7 · congestion';
  s.description =
    'Network congestion backs the bundle past the debt window + grace, voiding the LoC draw; L2 contributes nothing this cycle.';
  s.events = s.events.map((e) => ({ ...e, locOutcome: 'failed' as LocOutcome }));
  return s;
}

/** Scenario S8 — stale oracle data misprices collateral at liquidation. */
export function staleDataScenario(): Scenario {
  return {
    name: 'S8 · stale oracle data',
    description:
      'A stale price paints the desk solvent; by the time liquidation executes the position is deeper underwater, shrinking L1 recovery to ~5%.',
    state: referenceWaterfallState(),
    events: [
      {
        deskId: 'desk-a',
        exposureUsdCents: HAS_DESK_CAP,
        collateralRecoveryUsdCents: mulDiv(HAS_DESK_CAP, 500n, ECONOMICS_BPS), // ~5%
        locFaceUsdCents: mulDiv(HAS_DESK_CAP, LOC_COVERAGE_BPS, ECONOMICS_BPS),
        locHaircutBps: LOC_HAIRCUT_BPS,
        locOutcome: 'paid',
      },
    ],
    provenance: 'simulated',
  };
}

/** Scenario S9 — duplicate draw requests revert atomically (no double-draw). */
export function duplicateRequestScenario(): Scenario {
  return {
    name: 'S9 · duplicate draw requests',
    description:
      'Two identical pulls land in the same slot. The atomic balance-state constraint should revert the second; modeled here as the vault being unchanged (all layers zero).',
    state: referenceWaterfallState(),
    events: [],
    provenance: 'simulated',
    measuredNote:
      'Relies on cl_repay_and_settle’s atomic balance-state constraint; needs a devnet atomicity test to become testnet-observed.',
  };
}

/** Scenario S10 — delayed settlement past the 24h debt window + 2h grace. */
export function delayedSettlementScenario(): Scenario {
  return {
    name: 'S10 · delayed settlement',
    description:
      'Settlement slips past the 24h debt window and 2h grace (e.g. RPC outage); the facility freezes mid-flight with one desk fully exposed and the LoC void.',
    state: referenceWaterfallState(),
    events: [
      {
        deskId: 'desk-a',
        exposureUsdCents: HAS_DESK_CAP,
        collateralRecoveryUsdCents: 0n,
        locFaceUsdCents: 0n,
        locHaircutBps: LOC_HAIRCUT_BPS,
        locOutcome: 'failed',
      },
    ],
    provenance: 'simulated',
    measuredNote: 'Window/grace constants are on-chain (24h / 2h); event-path evidence pending.',
  };
}

/** Scenario S11 — full infrastructure outage. */
export function infrastructureOutageScenario(): Scenario {
  return {
    name: 'S11 · infrastructure outage',
    description:
      'Geyser + RPC + bundle engine unreachable; no settlement, revenue build halts, and the DIF cannot be replenished. Flags the frozen pipeline, not a loss event.',
    state: referenceWaterfallState(),
    events: [],
    provenance: 'simulated',
    measuredNote: 'Depends on the Geyser latency probe (see investor v0 VALIDATION section).',
  };
}

/** The 11 scenarios in checklist order, fully reproducible. */
export function allInvestorScenarios(): Scenario[] {
  return [
    singleDefaultScenario(),
    correlatedDefaultsScenario(),
    reserveShortfallScenario(),
    locFailureScenario(),
    liquidityShockScenario(),
    nonJitoSlotsScenario(),
    congestionScenario(),
    staleDataScenario(),
    duplicateRequestScenario(),
    delayedSettlementScenario(),
    infrastructureOutageScenario(),
  ];
}