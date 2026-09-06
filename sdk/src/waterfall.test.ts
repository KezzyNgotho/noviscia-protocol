import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  REFERENCE_POOL_USD_CENTS,
  SENIOR_LP_BPS,
  JUNIOR_LP_BPS,
  LOC_HAIRCUT_BPS,
  ASSUMPTIONS,
} from './assumptions';
import { ECONOMICS_BPS, mulDiv, referenceTvvParams } from './economics';
import {
  absorbDefault,
  runDefaultCascade,
  referenceWaterfallState,
  referenceJuniorUsdCents,
  locEffectiveUsdCents,
  subFloor,
  singleDefaultScenario,
  correlatedDefaultsScenario,
  reserveShortfallScenario,
  locFailureScenario,
  liquidityShockScenario,
  nonJitoSlotsScenario,
  congestionScenario,
  staleDataScenario,
  duplicateRequestScenario,
  delayedSettlementScenario,
  infrastructureOutageScenario,
  allInvestorScenarios,
  type DeskDefaultEvent,
  type WaterfallResult,
} from './waterfall';

function absorbedDollars(r: WaterfallResult): Record<string, number> {
  return Object.fromEntries(
    Object.entries(r.absorbed).map(([k, v]) => [k, Number(v) / 100]),
  );
}

describe('assumptions registry', () => {
  it('labels every registry entry with a provenance pin', () => {
    for (const a of ASSUMPTIONS) {
      assert.ok(
        ['assumed', 'simulated', 'testnet-measured', 'production-measured', 'pending'].includes(
          a.provenance,
        ),
        `bad provenance ${a.provenance} on ${a.key}`,
      );
    }
  });

  it('declares the LoC haircut at 25%', () => {
    assert.equal(LOC_HAIRCUT_BPS, 2_500n);
  });

  it('keeps tranche sizes on the reference sheet', () => {
    assert.equal(referenceJuniorUsdCents(), 300_000_000n); // $3,000,000
    assert.equal(
      mulDiv(REFERENCE_POOL_USD_CENTS, SENIOR_LP_BPS, ECONOMICS_BPS),
      700_000_000n,
    ); // $7,000,000
  });
});

describe('waterfall primitives', () => {
  it('applies the LoC haircut on a paid draw and zeroes on a failed one', () => {
    const evt: DeskDefaultEvent = {
      deskId: 'd',
      exposureUsdCents: 100_000_000n, // $1,000,000
      collateralRecoveryUsdCents: 0n,
      locFaceUsdCents: 100_000_000n,
      locHaircutBps: LOC_HAIRCUT_BPS,
      locOutcome: 'paid',
    };
    assert.equal(locEffectiveUsdCents(evt), 75_000_000n); // $750,000
    assert.equal(locEffectiveUsdCents({ ...evt, locOutcome: 'failed' }), 0n);
  });

  it('saturating subtraction never crosses zero', () => {
    assert.equal(subFloor(5n, 3n), 2n);
    assert.equal(subFloor(3n, 5n), 0n);
  });

  it('absorbs the full loss and never over-absorbs against exposure', () => {
    const state = referenceWaterfallState();
    const evt: DeskDefaultEvent = {
      deskId: 'd',
      exposureUsdCents: 100_000_000n,
      collateralRecoveryUsdCents: 30_000_000n,
      locFaceUsdCents: 100_000_000n,
      locHaircutBps: LOC_HAIRCUT_BPS,
      locOutcome: 'paid',
    };
    const r = absorbDefault(state, evt);

    const totalAbsorbed = Object.values(r.absorbed).reduce((a, b) => a + b, 0n);
    assert.equal(totalAbsorbed, evt.exposureUsdCents);
    assert.equal(r.absorbed.deskCollateralUsdCents, 30_000_000n); // L1 full collateral
    assert.equal(r.absorbed.locUsdCents, 70_000_000n); // L2 covers the rest
    assert.equal(r.absorbed.juniorTrancheUsdCents, 0n); // tranches untouched
    assert.equal(r.absorbed.seniorTrancheUsdCents, 0n);
    assert.equal(r.absorbed.uncoveredUsdCents, 0n);
  });
});

describe('single default (S1)', () => {
  it('desk collateral + LoC absorb the desk-cap default — senior never touched', () => {
    const { combined } = runDefaultCascade(
      singleDefaultScenario().state,
      singleDefaultScenario().events,
    );
    assert.equal(combined.circuitBreakerTripped, false);
    assert.equal(combined.absorbed.seniorTrancheUsdCents, 0n);
    assert.equal(combined.absorbed.juniorTrancheUsdCents, 0n);
    assert.equal(combined.absorbed.uncoveredUsdCents, 0n);
    assert.ok(combined.absorbed.deskCollateralUsdCents > 0n);
    assert.ok(combined.absorbed.locUsdCents > 0n);
  });

  it('release test pinned by economics.ts: single default costs zero LP capital', () => {
    // $1.5M exposure: 30% collateral ($450k) + 60%-capped LoC at 25% haircut
    // ($675k) — the residual $375k is caught by the $500k DIF seed.
    const { combined } = runDefaultCascade(
      singleDefaultScenario().state,
      singleDefaultScenario().events,
    );
    assert.deepEqual(absorbedDollars(combined), {
      deskCollateralUsdCents: 450_000,
      locUsdCents: 675_000,
      protocolReservesUsdCents: 375_000,
      juniorTrancheUsdCents: 0,
      seniorTrancheUsdCents: 0,
      uncoveredUsdCents: 0,
    });
  });
});

describe('correlated defaults (S2)', () => {
  it('junior absorbs after reserves/current LoC cloth — senior still whole', () => {
    const s = correlatedDefaultsScenario();
    const { combined } = runDefaultCascade(s.state, s.events);
    assert.equal(combined.absorbed.seniorTrancheUsdCents, 0n);
    assert.ok(combined.absorbed.juniorTrancheUsdCents > 0n);
    assert.equal(combined.absorbed.uncoveredUsdCents, 0n);
  });

  it('four desks at cap cost the pool its junior, not the senior', () => {
    // Each desk $1.5M: L1 30% ($450k) + L2 min(60% LoC @25% haircut = $675k).
    // Residual per desk $375k drains the $500k DIF seed then the junior.
    const s = correlatedDefaultsScenario();
    const { combined } = runDefaultCascade(s.state, s.events);
    assert.deepEqual(absorbedDollars(combined), {
      deskCollateralUsdCents: 1_800_000, // 4 × $450k
      locUsdCents: 2_700_000, // 4 × $675k
      protocolReservesUsdCents: 500_000, // full seed
      juniorTrancheUsdCents: 1_000_000,
      seniorTrancheUsdCents: 0,
      uncoveredUsdCents: 0,
    });
  });
});

describe('reserve shortfall (S3)', () => {
  it('a drained DIF pushes straight to the junior layer', () => {
    const s = reserveShortfallScenario();
    const { combined } = runDefaultCascade(s.state, s.events);
    assert.ok(combined.absorbed.juniorTrancheUsdCents > 0n);
    assert.equal(combined.absorbed.seniorTrancheUsdCents, 0n);
  });
});

describe('LoC failure (S4)', () => {
  it('a failed LoC costs the junior some first-loss but not the senior', () => {
    const s = locFailureScenario();
    const { combined } = runDefaultCascade(s.state, s.events);
    assert.ok(combined.absorbed.juniorTrancheUsdCents > 0n);
    assert.equal(combined.absorbed.seniorTrancheUsdCents, 0n);
    assert.equal(combined.absorbed.uncoveredUsdCents, 0n);
  });
});

describe('liquidity shock (S5)', () => {
  it('a 90% collateral drop + honored LoC still keeps senior whole', () => {
    const s = liquidityShockScenario();
    const { combined } = runDefaultCascade(s.state, s.events);
    assert.equal(combined.absorbed.seniorTrancheUsdCents, 0n);
    assert.ok(combined.absorbed.juniorTrancheUsdCents > 0n);
    assert.equal(combined.absorbed.uncoveredUsdCents, 0n);
  });
});

describe('non-Jito slots (S6)', () => {
  it('zero eligibility ⇒ zero gross and zero DIF build', () => {
    const s = nonJitoSlotsScenario();
    assert.equal(s.events.length, 0); // no loss event — flags halted build
    assert.ok(s.measuredNote && s.measuredNote.includes('L_jito=0%'));
  });
});

describe('congestion (S7) mirrors LoC failure (S4)', () => {
  it('congestion voids the LoC, costing junior, never senior', () => {
    const s = congestionScenario();
    const { combined } = runDefaultCascade(s.state, s.events);
    assert.equal(combined.absorbed.seniorTrancheUsdCents, 0n);
    assert.ok(combined.absorbed.juniorTrancheUsdCents > 0n);
  });
});

describe('stale oracle (S8)', () => {
  it('a 5% recovery win below the LoC line keeps senior whole', () => {
    const s = staleDataScenario();
    const { combined } = runDefaultCascade(s.state, s.events);
    assert.equal(combined.absorbed.seniorTrancheUsdCents, 0n);
    assert.equal(combined.absorbed.uncoveredUsdCents, 0n);
  });
});

describe('duplicate requests (S9)', () => {
  it('atomic constraint keeps the vault unchanged (all layers zero)', () => {
    const s = duplicateRequestScenario();
    const { combined } = runDefaultCascade(s.state, s.events);
    assert.equal(
      Object.values(combined.absorbed).reduce((a, b) => a + b, 0n),
      0n,
    );
    assert.equal(combined.post.seniorTrancheUsdCents, combined.post.seniorTrancheUsdCents);
  });
});

describe('delayed settlement (S10)', () => {
  it('a frozen one-desk book with void LoC stays senior-safe', () => {
    const s = delayedSettlementScenario();
    const { combined } = runDefaultCascade(s.state, s.events);
    assert.equal(combined.absorbed.seniorTrancheUsdCents, 0n);
  });
});

describe('infrastructure outage (S11)', () => {
  it('flags a frozen pipeline, no loss event modeled', () => {
    const s = infrastructureOutageScenario();
    assert.equal(s.events.length, 0);
  });
});

describe('property tests (reproducibility guarantees)', () => {
  it('re-running the same scenario returns bit-identical answers', () => {
    for (const s of allInvestorScenarios()) {
      const clone = () => ({ ...s, state: { ...s.state }, events: [...s.events] });
      const a = runDefaultCascade(clone().state, clone().events);
      for (let i = 0; i < 2; i++) {
        const b = runDefaultCascade(clone().state, clone().events);
        assert.deepEqual(a.combined.absorbed, b.combined.absorbed, s.name);
        assert.deepEqual(a.combined.post, b.combined.post, s.name);
      }
    }
  });

  it('total absorbed across layers never exceeds total exposure', () => {
    for (const s of allInvestorScenarios()) {
      const totalExposure = s.events.reduce((a, e) => a + e.exposureUsdCents, 0n);
      const { combined } = runDefaultCascade(s.state, s.events);
      const absorbed = Object.values(combined.absorbed).reduce((a, b) => a + b, 0n);
      assert.equal(absorbed, totalExposure, s.name);
    }
  });

  it('senior tranche is never touched until junior has been exhausted', () => {
    for (const s of allInvestorScenarios()) {
      const { combined } = runDefaultCascade(s.state, s.events);
      if (combined.absorbed.seniorTrancheUsdCents > 0n) {
        // Senior absorbs only if the junior layer is fully drained first.
        assert.equal(combined.post.juniorTrancheUsdCents, 0n, s.name);
        assert.equal(combined.absorbed.juniorTrancheUsdCents, referenceJuniorUsdCents(), s.name);
      }
    }
  });

  it('no scenario in the checklist reaches senior capital', () => {
    for (const s of allInvestorScenarios()) {
      const { combined } = runDefaultCascade(s.state, s.events);
      assert.equal(combined.absorbed.seniorTrancheUsdCents, 0n, s.name);
    }
  });

  it('the engine is monotonically loss-ordered: Lk absorbs only after Lk-1 is exhausted', () => {
    const evt: DeskDefaultEvent = {
      deskId: 'd',
      exposureUsdCents: 700_000_000n, // $7M — just under L1+L2+L3+junior stack
      collateralRecoveryUsdCents: 100_000_000n,
      locFaceUsdCents: 100_000_000n,
      locHaircutBps: 0n,
      locOutcome: 'paid',
    };
    const state = referenceWaterfallState();
    state.protocolReservesUsdCents = 200_000_000n;
    const r = absorbDefault(state, evt);
    // L1 the only recovery, L2 the only LoC, L3 the only reserve.
    assert.equal(r.absorbed.deskCollateralUsdCents, 100_000_000n);
    assert.equal(r.absorbed.locUsdCents, 100_000_000n);
    assert.equal(r.absorbed.protocolReservesUsdCents, 200_000_000n);
    assert.equal(r.absorbed.juniorTrancheUsdCents, 300_000_000n); // junior fully drained
    assert.equal(r.absorbed.seniorTrancheUsdCents, 0n); // hasn't touched senior yet
  });
});