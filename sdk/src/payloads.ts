import { PublicKey } from '@solana/web3.js';
import * as crypto from 'crypto';

/**
 * Payload translators — turn standard domain intents into wire-level payloads
 * (the "translator layer" of the SDK). Kept framework-agnostic: pure functions
 * over bytes/pubkeys so they run identically in Node services and the browser.
 */

export type TranslationKind = 'execution' | 'clearing' | 'netting-report' | 'liquidation' | 'recall';

export interface TranslationRequest {
  kind: TranslationKind;
  data: Record<string, unknown>;
}

export interface TranslationResult {
  ok: boolean;
  kind: TranslationKind;
  /** human-readable summary for trace/logs */
  summary: string;
  /** wire payload (bytes) if the translation is a blob carrier */
  payload?: Buffer;
  /** derived accounts to include in the transaction */
  accounts: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>;
}

/**
 * Translate a standard perps execution order into the position-tracker
 * open_position_from_feed payload (side 0=long / 1=short, size in raw USDC
 * 1e6 units) plus the JIT oracle accounts.
 */
export function translateExecutionOrder(req: TranslationRequest): TranslationResult {
  const { symbol, side, sizeUsdc, market, priceUpdateAccount, guardianSet, pythConfig, treasury } = req.data as {
    symbol: string;
    side: 'long' | 'short';
    sizeUsdc: number;
    market: PublicKey;
    priceUpdateAccount: PublicKey;
    guardianSet: PublicKey;
    pythConfig: PublicKey;
    treasury: PublicKey;
  };
  if (sizeUsdc <= 0) return { ok: false, kind: req.kind, summary: `rejected: non-positive size for ${symbol}`, accounts: [] };

  const payload = Buffer.alloc(1 + 8 + 4);
  payload[0] = side === 'long' ? 0 : 1;
  payload.writeBigUInt64LE(BigInt(Math.floor(sizeUsdc)), 1);
  payload.writeUInt32LE(0, 9); // sub-id 0 by default

  return {
    ok: true,
    kind: req.kind,
    summary: `execution ${side} ${sizeUsdc.toLocaleString()} USDC ${symbol}`,
    payload,
    accounts: [
      { pubkey: market, isSigner: false, isWritable: false },
      { pubkey: priceUpdateAccount, isSigner: false, isWritable: false },
      { pubkey: guardianSet, isSigner: false, isWritable: false },
      { pubkey: pythConfig, isSigner: false, isWritable: false },
      { pubkey: treasury, isSigner: false, isWritable: false },
    ],
  };
}

/** Translate a clearing/close intent (position close → liquidate payload). */
export function translateClearingOrder(req: TranslationRequest): TranslationResult {
  const { subId, market, priceUpdateAccount } = req.data as { subId: number; market: PublicKey; priceUpdateAccount: PublicKey };
  const payload = Buffer.alloc(1);
  payload[0] = subId;
  return {
    ok: true,
    kind: req.kind,
    summary: `clearing close sub=${subId} @ ${market.toBase58().slice(0, 8)}…`,
    payload,
    accounts: [
      { pubkey: market, isSigner: false, isWritable: false },
      { pubkey: priceUpdateAccount, isSigner: false, isWritable: false },
    ],
  };
}

/** Translate a netting fill report (perps venue → CCP ledger). */
export function translateNettingReport(req: TranslationRequest): TranslationResult {
  const { venue, trader, side, notionalUsdc } = req.data as {
    venue: PublicKey;
    trader: PublicKey;
    side: 'long' | 'short';
    notionalUsdc: number;
  };
  const payload = Buffer.alloc(1 + 8);
  payload[0] = side === 'long' ? 0 : 1;
  payload.writeBigUInt64LE(BigInt(Math.floor(notionalUsdc)), 1);
  return {
    ok: true,
    kind: req.kind,
    summary: `netting report ${side} ${notionalUsdc.toLocaleString()} for ${trader.toBase58().slice(0, 8)}…`,
    payload,
    accounts: [
      { pubkey: venue, isSigner: false, isWritable: true },
      { pubkey: trader, isSigner: false, isWritable: false },
    ],
  };
}

/** Translate a margin-call recall (yield-router recall_for_margin payload). */
export function translateRecall(req: TranslationRequest): TranslationResult {
  const { usdcAmount } = req.data as { usdcAmount: number };
  const payload = Buffer.alloc(8);
  payload.writeBigUInt64LE(BigInt(Math.floor(usdcAmount)), 0);
  return {
    ok: true,
    kind: req.kind,
    summary: `atomic recall ${usdcAmount.toLocaleString()} USDC for margin`,
    payload,
    accounts: [],
  };
}

/** Translate a liquidation intent — emits netting(5) + recall(7) account sets. */
export function translateLiquidation(req: TranslationRequest): TranslationResult {
  const { nettingAccounts, recallAccounts } = req.data as {
    nettingAccounts: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>;
    recallAccounts: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>;
  };
  return {
    ok: true,
    kind: req.kind,
    summary: `liquidation with netting(${nettingAccounts.length}) + recall(${recallAccounts.length})`,
    accounts: [...nettingAccounts, ...recallAccounts],
  };
}

const TRANSLATORS: Record<TranslationKind, (req: TranslationRequest) => TranslationResult> = {
  execution: translateExecutionOrder,
  clearing: translateClearingOrder,
  'netting-report': translateNettingReport,
  liquidation: translateLiquidation,
  recall: translateRecall,
};

/** Dispatch a standard payload to its translator. */
export function translate(req: TranslationRequest): TranslationResult {
  const fn = TRANSLATORS[req.kind];
  if (!fn) return { ok: false, kind: req.kind, summary: `unknown translation kind ${req.kind}`, accounts: [] };
  return fn(req);
}

/** SHA-256 content digest for payloads (tracing/verification). */
export function digest(payload: Buffer): string {
  return crypto.createHash('sha256').update(payload).digest('hex');
}
