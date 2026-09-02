import { TransactionMessage, VersionedTransaction, PublicKey, ComputeBudgetProgram, type AccountMeta } from '@solana/web3.js';
import { type AnchorProvider } from '@coral-xyz/anchor';
import type { NovisciaClient } from './client';

/**
 * Simulate-first sandbox (Gap 1 pillar).
 *
 * Every wallet/bot instruction set can be dry-run through `simulate` BEFORE
 * sending: this catches missing accounts, failed CPI signers, and insufficient
 * balances without paying fees or moving state. `assertAccountsExist` gives a
 * cheap state-isolation pre-check for derived PDAs.
 */

export interface SimulationReport {
  ok: boolean;
  error?: string;
  logs: string[];
  accounts: string[];
  unitsConsumed: number;
}

const CUSTOM_PROGRAM_ERROR = 1;
const INSTRUCTION_ERROR = 0;

function extractProgramError(simulationResponse: any): string | undefined {
  try {
    const value = simulationResponse?.value;
    if (!value?.err) return undefined;
    const err = value.err;
    if (typeof err === 'object' && err.InsufficientFundsForRent) return 'InsufficientFundsForRent';
    if (typeof err === 'object' && err.AccountInUse) return 'AccountInUse';
    if (typeof err === 'string') return err;
    if (typeof err === 'object') {
      for (const [k, v] of Object.entries(err)) {
        if (k === CUSTOM_PROGRAM_ERROR.toString()) {
          const code = (v as any)?.Custom ?? v;
          return `ProgramError(custom=${code})`;
        }
        if (k === INSTRUCTION_ERROR.toString()) {
          const inner = (v as any)?.Custom ?? (v as any);
          return typeof inner === 'object' ? JSON.stringify(inner) : `InstructionError(${inner})`;
        }
        return `${k}:${JSON.stringify(v)}`;
      }
    }
    return JSON.stringify(err);
  } catch {
    return undefined;
  }
}

export async function simulate(
  provider: AnchorProvider,
  payer: PublicKey,
  instructions: import('@solana/web3.js').TransactionInstruction[],
  opts: { computeUnits?: number } = {},
): Promise<SimulationReport> {
  const { blockhash } = await provider.connection.getLatestBlockhash('confirmed');
  const ixs = opts.computeUnits
    ? [ComputeBudgetProgram.setComputeUnitLimit({ units: opts.computeUnits }), ...instructions]
    : instructions;
  const messageV0 = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  const tx = new VersionedTransaction(messageV0);

  const res = await provider.connection.simulateTransaction(tx, {
    replaceRecentBlockhash: true,
    sigVerify: false,
  });

  const logs = res.value.logs ?? [];
  const error = extractProgramError(res);
  const accounts = (res.value.accounts ?? []).map((a) => (a as any)?.pubkey ?? a);
  return {
    ok: !error,
    error,
    logs,
    accounts,
    unitsConsumed: res.value.unitsConsumed ?? 0,
  };
}

/** Sanity check that all derived PDAs/ATAs are currently live on-chain. */
export async function assertAccountsExist(
  client: NovisciaClient,
  pubkeys: Array<{ pubkey: PublicKey; label?: string }>,
): Promise<{ missing: Array<{ pubkey: PublicKey; label?: string }>; present: number }> {
  const infos = await client.connection.getMultipleAccountsInfo(pubkeys.map((p) => p.pubkey));
  const missing: Array<{ pubkey: PublicKey; label?: string }> = [];
  let present = 0;
  infos.forEach((info, i) => {
    if (info) present++;
    else missing.push(pubkeys[i]);
  });
  return { missing, present };
}

/** Build a lookup-free legacy account meta list (for versioned tx assembly). */
export function toAccountMetas(accounts: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>): AccountMeta[] {
  return accounts.map((a) => ({ pubkey: a.pubkey, isSigner: a.isSigner, isWritable: a.isWritable }));
}

/** Hermes latest price for a Pyth feed, scaled to 1e6 USDC units. */
export async function fetchJitPrice(feedId: string): Promise<{ price1e6: number; publishTime: number }> {
  const res = await fetch(`https://pyth.dourolabs.app/hermes/v2/updates/price/latest?ids[]=${feedId}`, { headers: { Authorization: `Bearer ${process.env.PYTH_API_KEY || ''}` } });
  if (!res.ok) throw new Error(`Hermes ${res.status}`);
  const json = await res.json() as { parsed: Array<{ price: { price: string; expo: number }; publishTime: number }> };
  const p = json.parsed[0]?.price;
  if (!p) throw new Error(`No price for feed ${feedId}`);
  const delta = p.expo + 6;
  const price1e6 = delta >= 0
    ? Number(BigInt(p.price) * BigInt(10 ** delta))
    : Number(BigInt(p.price) / BigInt(10 ** (-delta)));
  return { price1e6, publishTime: json.parsed[0].publishTime };
}

// ════════════════════════════════════════════════════════════════════
// ═══ Simulated Market State for Sandbox Dry-Runs ════════════════════
// ════════════════════════════════════════════════════════════════════

export interface SimulatedPosition {
  owner: string;
  market: string;
  isLong: boolean;
  sizeUsdc: number;
  entryPrice: number;
  collateralShares: number;
  maintenanceMarginBps: number;
}

export interface SimulatedMarketData {
  price: number;
  fundingIndex: number;
  maxLeverageBps: number;
  maintenanceMarginBps: number;
}

export interface MarginCheckResult {
  ok: boolean;
  liveMarginUsdc: number;
  requiredMarginUsdc: number;
  shortfall: number;
}

/**
 * In-memory simulator for dry-run order fills and margin checks.
 * Tracks simulated positions, market prices, and computes PnL/margin
 * without touching on-chain state. Useful for the sandbox's "simulate
 * before you submit" pattern.
 */
export class SandboxSimulator {
  private markets = new Map<string, SimulatedMarketData>();
  private positions: SimulatedPosition[] = [];

  setMarket(market: string, data: SimulatedMarketData) {
    this.markets.set(market, data);
  }

  getMarket(market: string): SimulatedMarketData | undefined {
    return this.markets.get(market);
  }

  addPosition(pos: SimulatedPosition) {
    this.positions.push(pos);
  }

  getPositions(): SimulatedPosition[] {
    return this.positions.slice();
  }

  clearPositions() {
    this.positions = [];
  }

  /** Compute unrealized PnL for a position at a given reference price. */
  computePnl(pos: SimulatedPosition, referencePrice: number): number {
    if (referencePrice <= 0) return 0;
    const direction = pos.isLong ? 1 : -1;
    return (referencePrice - pos.entryPrice) * direction * (pos.sizeUsdc / pos.entryPrice);
  }

  /** Compute live margin (collateral + unrealized PnL) for a position. */
  computeLiveMargin(pos: SimulatedPosition, referencePrice: number): number {
    const redeemUsdc = pos.collateralShares; // simplified: 1:1 for sandbox
    const pnl = this.computePnl(pos, referencePrice);
    return redeemUsdc + pnl;
  }

  /** Compute required margin for a position. */
  computeRequiredMargin(pos: SimulatedPosition): number {
    return (pos.sizeUsdc * pos.maintenanceMarginBps) / 10_000;
  }

  /** Check if a single position is healthy. */
  checkPositionHealth(pos: SimulatedPosition, currentPrice: number): MarginCheckResult {
    const liveMargin = this.computeLiveMargin(pos, currentPrice);
    const required = this.computeRequiredMargin(pos);
    const shortfall = Math.max(0, required - liveMargin);
    return { ok: liveMargin >= required, liveMarginUsdc: liveMargin, requiredMarginUsdc: required, shortfall };
  }

  /** Simulate an order fill and return the updated position. */
  simulateFill(
    market: string,
    isLong: boolean,
    sizeUsdc: number,
    fillPrice: number,
    existingCollateralShares: number,
    maintenanceMarginBps: number,
  ): SimulatedPosition {
    return {
      owner: 'simulated',
      market,
      isLong,
      sizeUsdc,
      entryPrice: fillPrice,
      collateralShares: existingCollateralShares,
      maintenanceMarginBps,
    };
  }
}
