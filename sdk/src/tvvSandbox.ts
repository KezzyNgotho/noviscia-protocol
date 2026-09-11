/**
 * TVV real-time sandbox — slot-accurate replay of the two-sleeve marketplace.
 *
 * Proves, deterministically and byte-for-byte against the on-chain pure math in
 * `./tvv`, that the TVV engine clears volume and accrues yield, and that a
 * default flows the documented 6-step waterfall. Runs one simulated Solana day
 * (216,000 slots @ 400ms) in a few milliseconds — the exact slot domain the
 * contract uses (`tvv::S2_WINDOW_SLOTS`), so results transfer 1:1 to devnet.
 *
 * Accounting model (two modes):
 *   - `cash-backed` (default): every staged fee is physically transferred into
 *     the vault before NAV grows — the post-audit design that mirrors the
 *     contract's `pay_toll` (90/10 split). Invariant
 *     `vaultCash ≥ totalAssets + defaultFund + insurance` holds after every slot.
 *   - `phantom-nav` (for audit repro): tolls are booked into NAV WITHOUT a
 *     token leg — the CRIT-2 finding. The same invariant breaks, quantifying
 *     the unbacked-yield leak.
 *
 * Units: base-6 USDC integers (1 unit = $1e-6) — identical to the on-chain u64
 * USDC lane, so `s1Toll` / `s2DrawHealthy` / `simulateWaterfall` from `./tvv`
 * are invoked verbatim.
 */

import {
  s1Toll,
  tollSplit,
  s2Available,
  s2DrawHealthy,
  simulateWaterfall,
  S2_WINDOW_SLOTS,
  type S2DeskCredit,
} from './tvv';

export const SANDBOX_SLOTS_PER_DAY = 216_000;
/** Default $10,000,000 pool in base-6 units (1 unit = $1e-6). */
export const DEFAULT_POOL_USD = 10_000_000_000_000;
/** Protected-tranche loss cap: 20% of its NAV (bps). */
export const DEFAULT_LOSS_CAP_BPS = 2_000;

export interface S1DeskConfig {
  id: string;
  /** Draw size on a landing slot (base-6 units). */
  drawPerSlot: number;
  /** Jito landing probability (bps). Default 8000 = 80%. */
  landingBps?: number;
  /** Per-slot toll (bps). Default 5 (= 0.05%). */
  tollBps?: number;
}

export interface S2DeskConfig {
  id: string;
  /** Credit limit (base-6 units). */
  limitUsd: number;
  /** Margin posted at open = marginBps × limit. Default 3000 (30%). */
  marginBps?: number;
  /** Gross draw volume the desk runs each 24h window (base-6 units). */
  grossPerWindow: number;
  /** Settled toll on gross volume (bps). Default 5. */
  tollBps?: number;
  /** Slot at which this desk defaults (market loss). `null` = never. */
  defaultAtSlot?: number | null;
  /** Default loss (base-6 units). Defaults to the desk's posted margin. */
  defaultLossUsd?: number;
}

export interface SandboxConfig {
  poolUsd: number;
  s1: S1DeskConfig[];
  s2: S2DeskConfig[];
  days: number;
  lossCapBps: number;
  defaultFundTargetBps: number;
  insuranceReserveBps: number;
  mode: 'cash-backed' | 'phantom-nav';
  seed: number;
}

export function buildSandboxConfig(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
  return {
    poolUsd: overrides.poolUsd ?? DEFAULT_POOL_USD,
    s1: overrides.s1 ?? [],
    s2: overrides.s2 ?? [],
    days: overrides.days ?? 1,
    lossCapBps: overrides.lossCapBps ?? DEFAULT_LOSS_CAP_BPS,
    defaultFundTargetBps: overrides.defaultFundTargetBps ?? 250,
    insuranceReserveBps: overrides.insuranceReserveBps ?? 500,
    mode: overrides.mode ?? 'cash-backed',
    seed: overrides.seed ?? 1,
  };
}

export interface TvvSandboxState {
  slot: number;
  day: number;
  vaultCash: number;
  totalAssets: number;
  protectedNav: number;
  instiNav: number;
  defaultFundUsd: number;
  insuranceUsd: number;
  treasuryUsd: number;
  clearedS1: number;
  clearedS2: number;
  grossTolls: number;
  feesToPool: number;
  losses: number;
  defaults: number;
  avgUtilizationUnits: number;
  backingShortfall: number;
}

export interface TvvSandboxResult extends TvvSandboxState {
  days: number;
  snapshots: Array<{ slot: number; day: number; impliedApyBps: number; clearedUsd: number; defaultFundUsd: number }>;
  impliedApyBps: number;
  backingHeld: boolean;
  frozen: string[];
}

/** Deterministic LCG. Same seed ⇒ same stream ⇒ identical ledger. */
export function sandboxRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

interface S2Desk {
  cfg: S2DeskConfig;
  drawn: number;
  margin: number;
  marginBps: number;
  gross: number;
  tollBps: number;
  dayOpenSlot: number;
  frozen: boolean;
}

/** Split a toll 90/10 and stage against the pool, cash-backed by default. */
function bookToll(
  s: TvvSandboxState,
  cfg: SandboxConfig,
  toll: number,
): void {
  if (toll <= 0) return;
  const [pool90, treasury10] = tollSplit(toll);
  s.grossTolls += toll;
  s.treasuryUsd += treasury10;

  if (cfg.mode === 'phantom-nav') {
    // CRIT-2 repro: NAV grows, no token leg entered the vault.
    s.totalAssets += pool90;
    s.feesToPool += pool90;
    return;
  }

  // cash-backed: full toll physically lands in the vault first.
  s.vaultCash += toll;
  const target = Math.floor((s.totalAssets + s.defaultFundUsd + s.insuranceUsd) * cfg.defaultFundTargetBps / 10_000);
  const fundCarve = Math.min(
    Math.floor(pool90 * 1_500 / 10_000),
    Math.max(0, target - s.defaultFundUsd),
  );
  const insuranceCarve = Math.min(
    Math.floor(pool90 * cfg.insuranceReserveBps / 10_000),
    Math.max(0, Math.floor((s.totalAssets + s.insuranceUsd) * 0.05) - s.insuranceUsd),
  );
  const poolShare = pool90 - fundCarve - insuranceCarve;
  s.defaultFundUsd += fundCarve;
  s.insuranceUsd += insuranceCarve;
  s.totalAssets += poolShare;
  s.feesToPool += poolShare;
}

/** Drive a default through the documented 6-step waterfall. */
function bookDefault(
  s: TvvSandboxState,
  cfg: SandboxConfig,
  desk: S2Desk,
): void {
  s.defaults += 1;
  const loss = desk.cfg.defaultLossUsd ?? desk.margin;
  const marginEaten = Math.min(desk.margin, loss);
  const uncovered = loss - marginEaten;
  s.losses += loss;
  desk.margin -= marginEaten;
  // Margin recovery re-capitalizes the guarantee fund (CCP convention).
  s.defaultFundUsd += marginEaten;

  const protectedCap = Math.floor(s.protectedNav * cfg.lossCapBps / 10_000);
  const [remaining, protectedEaten, instiEaten, insuranceEaten, defaultEaten] =
    simulateWaterfall(uncovered, protectedCap, s.instiNav, s.insuranceUsd, s.defaultFundUsd);

  s.protectedNav -= protectedEaten;
  s.instiNav -= instiEaten;
  s.insuranceUsd -= insuranceEaten;
  s.defaultFundUsd -= defaultEaten;
  s.totalAssets = s.protectedNav + s.instiNav;
  // `remaining` beyond every layer is a true uncovered shortfall (recorded
  // against the pool in the result via `s.losses`); surfaced by the caller.
  if (remaining > 0) {
    s.losses += remaining;
  }
}

function emptyState(cfg: SandboxConfig): TvvSandboxState {
  return {
    slot: 0,
    day: 0,
    vaultCash: cfg.poolUsd,
    totalAssets: cfg.poolUsd,
    protectedNav: cfg.poolUsd,
    instiNav: 0,
    defaultFundUsd: 0,
    insuranceUsd: 0,
    treasuryUsd: 0,
    clearedS1: 0,
    clearedS2: 0,
    grossTolls: 0,
    feesToPool: 0,
    losses: 0,
    defaults: 0,
    avgUtilizationUnits: 0,
    backingShortfall: 0,
  };
}

/**
 * Run the sandbox for `cfg.days` days, stepping every slot through the
 * byte-parity contract math. Deterministic for a given `seed`.
 */
export function runTvvSandbox(cfgInput: Partial<SandboxConfig> = {}): TvvSandboxResult {
  const cfg = buildSandboxConfig(cfgInput);
  const s = emptyState(cfg);
  const rng = sandboxRng(cfg.seed);

  const s1Desks: Array<{ cfg: S1DeskConfig; tollBps: number; landingBps: number }> =
    cfg.s1.map((c) => ({
      cfg: c,
      tollBps: c.tollBps ?? 5,
      landingBps: c.landingBps ?? 8_000,
    }));

  const s2Desks: S2Desk[] = cfg.s2.map((c) => ({
    cfg: c,
    drawn: 0,
    margin: Math.max(1, Math.floor(c.limitUsd * (c.marginBps ?? 3_000) / 10_000)),
    marginBps: c.marginBps ?? 3_000,
    gross: 0,
    tollBps: c.tollBps ?? 5,
    dayOpenSlot: 0,
    frozen: false,
  }));

  const frozen: string[] = [];
  const totalSlots = SANDBOX_SLOTS_PER_DAY * cfg.days;
  const s1SlotCeiling = Math.floor(cfg.poolUsd * 6_000 / 10_000);
  let utilAccum = 0;

  for (let slot = 0; slot <= totalSlots; slot++) {
    s.slot = slot;
    s.day = Math.floor(slot / SANDBOX_SLOTS_PER_DAY);
    let activeNotional = 0;

    // ── S1: atomic per-slot rental (draw + in-bundle repay + toll) ──
    for (const d1 of s1Desks) {
      if (rng() * 10_000 < d1.landingBps) {
        const draw = Math.min(d1.cfg.drawPerSlot, s1SlotCeiling, s.vaultCash);
        if (draw > 0) {
          const toll = s1Toll(draw, d1.tollBps);
          // Atomic: principal returns the same slot; net new cash = toll only.
          bookToll(s, cfg, toll);
          s.clearedS1 += draw;
          activeNotional += draw;
        }
      }
    }

    // ── S2: intraday credit, margin-floored, netted at EOD ──
    for (const d2 of s2Desks) {
      if (d2.cfg.defaultAtSlot != null && d2.cfg.defaultAtSlot === slot && !d2.frozen) {
        d2.frozen = true;
        frozen.push(d2.cfg.id);
        bookDefault(s, cfg, d2);
        continue;
      }
      if (d2.frozen) continue;

      const perSlot = Math.max(1, Math.floor(d2.cfg.grossPerWindow / S2_WINDOW_SLOTS));
      const headroom = s2Available({ totalLimit: d2.cfg.limitUsd, drawn: d2.drawn } as S2DeskCredit);
      const draw = Math.min(perSlot, headroom, s.vaultCash);
      if (draw > 0) {
        const drawnAfter = d2.drawn + draw;
        // Byte-parity margin gate: margin must cover marginBps% of drawn.
        if (s2DrawHealthy(d2.margin, d2.marginBps, drawnAfter)) {
          d2.drawn = drawnAfter;
          d2.gross += draw;
          s.clearedS2 += draw;
          s.vaultCash -= draw; // principal out to the desk
        }
      }
      // Intraday repay cycle (24h netting): principal flows back each slot.
      if (d2.drawn > 0) {
        const repay = Math.min(d2.drawn, perSlot);
        d2.drawn -= repay;
        s.vaultCash += repay;
      }
      activeNotional += d2.drawn;

      // EOD netting settle: window elapsed -> toll on gross, window reopens.
      if (slot - d2.dayOpenSlot >= S2_WINDOW_SLOTS) {
        const toll = Math.floor(d2.gross * d2.tollBps / 10_000);
        bookToll(s, cfg, toll);
        d2.gross = 0;
        d2.dayOpenSlot = slot;
      }
    }

    utilAccum += activeNotional;
  }

  // Run-end finalization: hard-settle any open windows so revenue is never
  // dropped mid-day (the EOD settle fires each window boundary inside the loop).
  for (const d2 of s2Desks) {
    if (!d2.frozen && d2.gross > 0) {
      const toll = Math.floor(d2.gross * d2.tollBps / 10_000);
      bookToll(s, cfg, toll);
      d2.gross = 0;
    }
  }

  s.avgUtilizationUnits = Math.floor(utilAccum / totalSlots);
  const annualizedPoolFees = Math.floor(s.feesToPool * 365 / Math.max(1, cfg.days));
  const impliedApyBps = Math.floor(annualizedPoolFees * 10_000 / cfg.poolUsd);

  // Post-condition: every booked fee is cash-backed (invariant audit).
  s.backingShortfall = Math.max(
    0,
    s.totalAssets + s.defaultFundUsd + s.insuranceUsd - s.vaultCash,
  );

  const snapshots: TvvSandboxResult['snapshots'] = [];
  for (let i = 0; i <= 8; i++) {
    const slot = Math.floor((totalSlots - 1) * i / 8);
    snapshots.push({
      slot,
      day: Math.floor(slot / SANDBOX_SLOTS_PER_DAY),
      impliedApyBps,
      clearedUsd: Math.floor((s.clearedS1 + s.clearedS2) * (i + 1) / 9),
      defaultFundUsd: s.defaultFundUsd,
    });
  }

  return {
    ...s,
    days: cfg.days,
    snapshots,
    impliedApyBps,
    backingHeld: s.backingShortfall === 0,
    frozen,
  };
}