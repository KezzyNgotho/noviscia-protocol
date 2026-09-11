import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assumptionsDigest, scenarioDigest, scenarioDigestOf, replayDigest } from './replay';
import { ASSUMPTIONS } from './assumptions';
import { allInvestorScenarios, type DeskDefaultEvent } from './waterfall';

describe('replay digest (reproducibility fingerprint)', () => {
  it('pins the assumption-registry digest — inputs must not drift silently', () => {
    // Golden value: recompute if (and only if) the assumption registry or its
    // provenance labels are intentionally changed. Changing an assumption is a
    // deliberate, reviewed act — never a silent one.
    assert.equal(
      assumptionsDigest(),
      'e807f11d441bb01a76a1eddbe228661036bdcf7a6c37f7fff7c9fa5cad41012a',
    );
  });

  it('pins the 11-scenario cascade digest — outputs must not drift silently', () => {
    assert.equal(scenarioDigest(), '0bea634989592c4e8efe084ee98f5a3d3cba979170a8eaea40b221b4d54931e3');
  });

  it('replay digest is stable across repeated runs', () => {
    const a = replayDigest();
    const b = replayDigest();
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  it('a mutated assumption or scenario changes the digest', () => {
    const before = replayDigest();

    // Temporarily perturb the registry value; must change the digest.
    const saved = ASSUMPTIONS[0].valueUsdCents;
    ASSUMPTIONS[0].valueUsdCents = saved + 1n;
    const perturbedAssumption = replayDigest();
    ASSUMPTIONS[0].valueUsdCents = saved;

    assert.notEqual(perturbedAssumption, before);
    assert.equal(assumptionsDigest(), assumptionsDigest()); // restore leaves stable

    // Perturb a scenario by adding a phantom desk event to a private copy —
    // the canonical suite is untouched, so scenarioDigest() remains pinned.
    const canonical = allInvestorScenarios();
    const baseline = scenarioDigestOf(canonical);
    const s1 = canonical[0];
    const phantom: DeskDefaultEvent = {
      deskId: 'phantom',
      exposureUsdCents: 1n,
      collateralRecoveryUsdCents: 0n,
      locFaceUsdCents: 0n,
      locHaircutBps: 0n,
      locOutcome: 'paid',
    };
    const perturbedScenarios = scenarioDigestOf([{ ...s1, events: [...s1.events, phantom] }]);
    assert.notEqual(perturbedScenarios, baseline);
  });

  it('all scenarios plus the registry combine into one 64-hex digest', () => {
    assert.equal(assumptionsDigest().length, 64);
    assert.equal(scenarioDigest().length, 64);
    assert.equal(replayDigest().length, 64);
  });
});