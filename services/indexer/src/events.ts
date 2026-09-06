import { BorshCoder, EventParser } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// Resolved at process start; the indexer runs from the monorepo root.
const IDL_DIR =
  process.env.IDL_DIR ||
  path.resolve(__dirname, '../../../target/idl');

interface ProgramMeta {
  name: string;         // display name written to user_activity.program
  programId: string;
  idlName: string;      // filename under IDL_DIR without .json
}

const PROGRAMS: ProgramMeta[] = [
  { name: 'position-tracker', programId: process.env.NEXT_PUBLIC_POSITION_TRACKER_PROGRAM_ID || '3zGRWKZq4V3npHbH9Lati46BwgmstTjynWZFFMxarQgY', idlName: 'position_tracker' },
  { name: 'escrow',            programId: process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID            || 'EscRowXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', idlName: 'escrow' },
  { name: 'staking-manager',   programId: process.env.NEXT_PUBLIC_STAKING_MANAGER_PROGRAM_ID  || 'StakeXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', idlName: 'staking_manager' },
  { name: 'liquidation-vault', programId: process.env.NEXT_PUBLIC_LIQUIDATION_VAULT_PROGRAM_ID || 'LiqVltXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', idlName: 'liquidation_vault' },
  { name: 'burn-engine',       programId: process.env.NEXT_PUBLIC_BURN_ENGINE_PROGRAM_ID       || 'BurnXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', idlName: 'burn_engine' },
  { name: 'nv-usdc-vault',     programId: process.env.NEXT_PUBLIC_NV_USDC_VAULT_PROGRAM_ID    || 'VaultXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', idlName: 'nv_usdc_vault' },
  { name: 'yield-distributor', programId: process.env.NEXT_PUBLIC_YIELD_DISTRIBUTOR_PROGRAM_ID || 'YieldXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', idlName: 'yield_distributor' },
  { name: 'prediction-market', programId: process.env.NEXT_PUBLIC_PREDICTION_MARKET_PROGRAM_ID  || 'GtTJWLa6MXjZoNucGHWVnE9LpZTw6Dsr5K1gxpM1Q4fe', idlName: 'prediction_market' },
  { name: 'token-nvsc',        programId: process.env.NEXT_PUBLIC_NVSC_MINT                     || 'HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT', idlName: 'token_nvsc' },
  { name: 'jit-risk',          programId: process.env.NEXT_PUBLIC_JIT_RISK_PROGRAM_ID            || 'JDsM18uSZ1UJEP49XdKSjumdftpuZ8cJbpb8CkBaBiMc', idlName: 'noviscia_capacity' },
  // Revenue engines: gateway-auction + sovereign-netting (matches jit-risk above).
  // These feed the omni-pool revenue chart. IDL names are the target/idl filenames.
  { name: 'gateway-auction',   programId: process.env.NEXT_PUBLIC_GATEWAY_AUCTION_PROGRAM_ID      || 'HQ26VTfoBVmGFY1JsFp5HmMT3rjLNoLJH6zurm8TL9xR', idlName: 'gateway_auction' },
  { name: 'sovereign-netting', programId: process.env.NEXT_PUBLIC_SOVEREIGN_NETTING_PROGRAM_ID    || '68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56', idlName: 'netting_engine' },
];

export interface ParsedEvent {
  program: string;
  eventType: string;
  wallet: string | null;
  market: string | null;
  amountUsdc: bigint | null;
  pnlUsdc: bigint | null;
  metadata: Record<string, unknown>;
}

interface LoadedParser {
  name: string;
  programId: PublicKey;
  parser: EventParser;
}

let _parsers: LoadedParser[] | null = null;

function loadParsers(): LoadedParser[] {
  if (_parsers) return _parsers;
  const result: LoadedParser[] = [];
  for (const p of PROGRAMS) {
    const idlPath = path.join(IDL_DIR, `${p.idlName}.json`);
    if (!fs.existsSync(idlPath)) {
      console.warn(`[events] IDL not found for ${p.name}: ${idlPath} — skipping`);
      continue;
    }
    try {
      const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
      // EventParser needs the program address from the IDL or caller.
      const pid = new PublicKey(idl.address ?? p.programId);
      const coder = new BorshCoder(idl);
      const parser = new EventParser(pid, coder);
      result.push({ name: p.name, programId: pid, parser });
    } catch (e) {
      console.warn(`[events] failed to load ${p.name}:`, (e as Error).message);
    }
  }
  _parsers = result;
  return result;
}

// Convert any Anchor data value to a plain JSON-safe object.
function toPlain(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof PublicKey) return value.toBase58();
  if (Buffer.isBuffer(value)) return value.toString('hex');
  // u64/i64 in Anchor events deserialize to BN — serialize as decimal string
  // so consumers can read numeric fields (premium, collateral, …) directly.
  if (
    typeof value === 'object' &&
    Array.isArray((value as { words?: unknown }).words) &&
    typeof (value as { toString: () => string }).toString === 'function'
  ) {
    return (value as { toString: (base?: number) => string }).toString(10);
  }
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toPlain(v);
    }
    return out;
  }
  return value;
}

function extractWallet(data: Record<string, unknown>): string | null {
  for (const key of ['user', 'wallet', 'authority', 'keeper', 'mm', 'winner', 'bidder', 'payer']) {
    const v = data[key];
    if (v instanceof PublicKey) return v.toBase58();
    if (typeof v === 'string' && v.length >= 32) return v;
  }
  return null;
}

function extractMarket(data: Record<string, unknown>): string | null {
  const v = data['market'];
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

function extractAmountUsdc(data: Record<string, unknown>): bigint | null {
  // Revenue-carrying fields first (premium/tip/rent are the value flowing to the
  // omni-pool), then generic capacity fields. Order matters: for SliceRented we
  // want `premium` (earnings), not `amount_usdc` (risk capacity).
  const keys = [
    'premium', 'nav_cut', 'tip', 'premium_tips', 'amount_base', 'rent',
    'amount_usdc', 'amountUsdc', 'collateral_usdc', 'collateralUsdc',
    'notional_usdc', 'notionalUsdc', 'amount', 'usdc_amount',
  ];
  for (const key of keys) {
    const v = data[key];
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(v);
    if (typeof v === 'string') { try { return BigInt(v); } catch { /* skip */ } }
    // Anchor decodes u64/i64 to a BN instance — normalize to bigint.
    if (
      typeof v === 'object' && v !== null &&
      typeof (v as { toString?: unknown }).toString === 'function'
    ) {
      const s = (v as { toString: (radix?: number) => string }).toString(10);
      if (/^\d+$/.test(s)) { try { return BigInt(s); } catch { /* skip */ } }
    }
  }
  return null;
}

function extractPnlUsdc(data: Record<string, unknown>): bigint | null {
  for (const key of ['final_pnl', 'finalPnl', 'pnl_usdc', 'pnlUsdc', 'pnl', 'unrealized_pnl']) {
    const v = data[key];
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(v);
    if (typeof v === 'string') { try { return BigInt(v); } catch { /* skip */ } }
    if (typeof v === 'object' && v !== null && typeof (v as { toString?: unknown }).toString === 'function') {
      const s = (v as { toString: (radix?: number) => string }).toString(10);
      if (/^-?\d+$/.test(s)) { try { return BigInt(s); } catch { /* skip */ } }
    }
  }
  return null;
}

export function parseActivityFromLogs(logs: string[]): ParsedEvent[] {
  const parsers = loadParsers();
  const results: ParsedEvent[] = [];

  for (const { name, parser } of parsers) {
    try {
      for (const event of parser.parseLogs(logs)) {
        const data = event.data as Record<string, unknown>;
        results.push({
          program: name,
          eventType: event.name,
          wallet: extractWallet(data),
          market: extractMarket(data),
          amountUsdc: extractAmountUsdc(data),
          pnlUsdc: extractPnlUsdc(data),
          metadata: toPlain(data) as Record<string, unknown>,
        });
      }
    } catch {
      // Parsing errors on a specific program are non-fatal — skip.
    }
  }

  return results;
}
