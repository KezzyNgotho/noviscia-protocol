/**
 * Replay digest — the reproducible fingerprint of the investor risk engine.
 *
 * Combines the assumption registry and the full 11-scenario loss-waterfall
 * output into a single deterministic SHA‑256 digest. An external reviewer can
 * recompute this from a clean checkout:
 *
 *   node --import tsx -e "const {replayDigest}=await import('./src/replay.ts'); console.log(replayDigest())"
 *
 * If two runs produce the same digest, the engine's inputs AND outputs were
 * byte-identical — the strongest on-paper reproducibility guarantee the v0 can
 * offer short of live data (which flips provenance to testnet/production).
 */
import { createHash } from 'node:crypto';
import { ASSUMPTIONS } from './assumptions';
import {
  allInvestorScenarios,
  runDefaultCascade,
  type Scenario,
} from './waterfall';

/** Canonical assertion-digest of the engine's inputs (the assumption registry). */
export function assumptionsDigest(): string {
  const h = createHash('sha256');
  for (const a of ASSUMPTIONS) {
    h.update(`${a.key}|${a.valueUsdCents}|${a.provenance}|${a.basis}\n`);
  }
  return h.digest('hex');
}

/**
 * Canonical output-digest of a scenario batch (absorption per layer).
 * The engine-level `scenarioDigest()` feeds it `allInvestorScenarios()`;
 * exposing the list forms lets tests (and future replay-of-recorded-defaults)
 * fingerprint an arbitrary event batch.
 */
export function scenarioDigestOf(scenarios: Scenario[]): string {
  const h = createHash('sha256');
  for (const s of scenarios) {
    const { combined } = runDefaultCascade(s.state, s.events);
    const a = combined.absorbed;
    h.update(
      [
        s.name,
        String(a.deskCollateralUsdCents),
        String(a.locUsdCents),
        String(a.protocolReservesUsdCents),
        String(a.juniorTrancheUsdCents),
        String(a.seniorTrancheUsdCents),
        String(a.uncoveredUsdCents),
        String(combined.circuitBreakerTripped),
        String(combined.juniorDrainedBps),
      ].join('|') + '\n',
    );
  }
  return h.digest('hex');
}

/** Digest of the canonical 11-scenario suite. */
export function scenarioDigest(): string {
  return scenarioDigestOf(allInvestorScenarios());
}

/**
 * The single replay digest of the whole v0 evidence pack: inputs (registry)
 * and outputs (cascade) hashed together, so swapping either silently changes
 * the fingerprint.
 */
export function replayDigest(): string {
  const h = createHash('sha256');
  h.update(`assumptions:${assumptionsDigest()}\n`);
  h.update(`scenarios:${scenarioDigest()}\n`);
  return h.digest('hex');
}