/**
 * Jito Block Engine integration for the Noviscia credit bundle path.
 *
 * The institutional borrower flow (see docs/PARTICIPANT_ACCESS.md) compiles its
 * atomic pull → venue trade → repay sequence into a single-block *bundle* and
 * routes it to the Jito Block Engine for atomic, all-or-nothing inclusion with a
 * leader tip. This module provides:
 *
 *   - `assembleVersionedTransactions` — compiles per-request instruction groups
 *     into unsigned `VersionedTransaction`s (one per transaction in the bundle),
 *     optionally appending the leader tip transfer to the first transaction so it
 *     is paid only if the intra-bundle state assertions hold.
 *   - `buildTipInstruction` — the canonical tip: a SOL transfer to one of the 8
 *     Jito tip accounts ("any instruction that transfers SOL to a tip account").
 *   - `JitoBundleClient` — JSON-RPC client for the Block Engine HTTP API
 *     (`sendBundle`, `getTipAccounts`, `getBundleTipLimits`,
 *     `getBundleStatuses`).
 *
 * No network calls are made at import time; every method uses the global `fetch`
 * (Node >= 18 / browsers). The Block Engine accepts up to 5 fully-signed
 * transactions per bundle, base64-encoded.
 */

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
} from '@solana/web3.js';

/** Hard cap enforced by the Block Engine on transactions per bundle. */
export const BUNDLE_MAX_TRANSACTIONS = 5;

/**
 * Offline fallback of the canonical Jito tip accounts (snapshot from the live
 * mainnet engine, Sep 2026). Tip accounts rotate — ALWAYS resolve live via
 * `getTipAccounts` (`selectTipAccount`) before submitting; never hard-code a
 * frozen set into the borrower path. Kept only so the sub-2ms path can avoid
 * the RPC round-trip as a *cache* that is refreshed periodically.
 */
export const KNOWN_JITO_TIP_ACCOUNTS: PublicKey[] = [
  new PublicKey('ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49'),
  new PublicKey('Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY'),
  new PublicKey('DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL'),
  new PublicKey('96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5'),
  new PublicKey('3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT'),
  new PublicKey('DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh'),
  new PublicKey('HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe'),
  new PublicKey('ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt'),
];

/** Region-distributed Block Engine HTTP endpoints. */
export const JITO_BLOCK_ENGINE_URLS = {
  mainnet: [
    'https://mainnet.block-engine.jito.wtf',
    'https://amsterdam.mainnet.block-engine.jito.wtf',
    'https://frankfurt.mainnet.block-engine.jito.wtf',
    'https://london.mainnet.block-engine.jito.wtf',
    'https://ny.mainnet.block-engine.jito.wtf',
    'https://tokyo.mainnet.block-engine.jito.wtf',
  ],
  /**
   * Private Devnet relay — the Noviscia Jito-Solana validator exposes its
   * block engine at this URL. Override via `DEVNET_JITO_BLOCK_ENGINE_URL`
   * env for remote validators.
   */
  devnet: [
    process.env.DEVNET_JITO_BLOCK_ENGINE_URL || 'http://127.0.0.1:9000',
  ],
} as const;

/**
 * Default leader tip applied when the auction minimum is unknown or zero.
 * Programmable, not protocol-enforced: a low tip is skipped by the auction.
 */
export const DEFAULT_TIP_LAMPORTS = 5_000_000n;

/** `getBundleTipLimits` result shape (fields may be absent on older engines). */
export interface BundleTipLimits {
  /** Minimum lamports a bundle must tip to be considered by the auction. */
  minBundleTipLamports: bigint;
  /** Max bundle size in ETH units, used only for MEV-space accounting. */
  maxBundleSizeInEth: number;
  /** Max builder fee (in lamports) an MEV auction may collect. */
  maxBuilderFeeLamports: bigint;
  /** Max transactions per bundle the engine will accept. */
  maxTransactions: number;
}

/** A single bundle's on-chain status as reported by `getBundleStatuses`. */
export interface JitoBundleStatus {
  bundleId: string;
  /** Base-58 signatures applied by the landed bundle (non-empty when found). */
  transactions: string[];
  /** Slot the bundle processed in; `null` until it lands. */
  slot: number | null;
  confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
  /** Any retryable / non-retryable error, or `null`/`{ Ok: null }`. */
  err: unknown;
}

/** Raised when the Block Engine returns a JSON-RPC error or non-2xx HTTP. */
export class JitoRpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'JitoRpcError';
  }
}

/**
 * Canonical bundle tip: a SOL transfer to one of the 8 Jito tip accounts.
 * Attached to the first transaction so it only pays if that transaction's
 * intra-bundle assertions pass ("tip can only go through conditionally").
 */
export function buildTipInstruction(options: {
  tipAccount: PublicKey;
  tipPayer: PublicKey;
  lamports: number | bigint;
}): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: options.tipPayer,
    toPubkey: options.tipAccount,
    lamports: Number(options.lamports),
  });
}

/** Pick a tip account at random to reduce contention across searchers. */
export function selectTipAccount(accounts: PublicKey[] = KNOWN_JITO_TIP_ACCOUNTS): PublicKey {
  if (accounts.length === 0) {
    throw new Error('no tip accounts available');
  }
  return accounts[Math.floor(Math.random() * accounts.length)];
}

/** Resolve the lamport tip for a bundle given the auctioned minimum. */
export function resolveBundleTipLamports(
  minimum: bigint | undefined,
  defaultLamports: bigint = DEFAULT_TIP_LAMPORTS,
): bigint {
  if (minimum === undefined) return defaultLamports;
  return minimum > defaultLamports ? minimum : defaultLamports;
}

export interface AssembleBundleOptions {
  /** Signer that pays the base fee for every transaction in the bundle. */
  feePayer: PublicKey;
  /** Single recent blockhash shared by all transactions (one-slot atomicity). */
  recentBlockhash: string;
  /**
   * Address lookup tables for each transaction group in `instructionGroups`
   * (parallel, one entry per group). Jupiter route legs routinely reference
   * tables; arm/settle do not. Pass `[]` per group when no tables are used.
   */
  lookupTables?: AddressLookupTableAccount[][];
  /**
   * Leader tip. The transfer is appended to the first transaction only, so the
   * tip is conditional on that transaction's assertions. The tipPayer becomes a
   * required signer of the first transaction and must sign it downstream.
   */
  tip?: {
    tipAccount: PublicKey;
    tipPayer: PublicKey;
    lamports: number | bigint;
  };
}

/**
 * Compile the credit bundle's per-transaction instruction groups into unsigned
 * `VersionedTransaction`s sharing one blockhash (one slot, atomic). Callers sign
 * each transaction with its required signers (e.g. `tx.sign([feePayerSigner,
 * tipPayerSigner, deskSigner])`) before passing to `JitoBundleClient.sendBundle`.
 *
 * @param instructionGroups one array of instructions per bundle transaction
 */
export function assembleVersionedTransactions(
  instructionGroups: TransactionInstruction[][],
  options: AssembleBundleOptions,
): VersionedTransaction[] {
  const { feePayer, recentBlockhash } = options;
  const groupCount = instructionGroups.length;
  if (groupCount === 0) {
    throw new RangeError('a bundle needs at least one transaction');
  }
  if (groupCount > BUNDLE_MAX_TRANSACTIONS) {
    throw new RangeError(
      `Block Engine accepts at most ${BUNDLE_MAX_TRANSACTIONS} transactions per bundle (got ${groupCount})`,
    );
  }
  return instructionGroups.map((instructions, index) => {
    if (instructions.length === 0) {
      throw new RangeError(`transaction at index ${index} has no instructions`);
    }
    if (options.tip !== undefined && index === 0) {
      instructions = [
        ...instructions,
        buildTipInstruction({
          tipAccount: options.tip.tipAccount,
          tipPayer: options.tip.tipPayer,
          lamports: options.tip.lamports,
        }),
      ];
    }
    const message = new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash,
      instructions,
    }).compileToV0Message(options.lookupTables?.[index] ?? []);
    return new VersionedTransaction(message);
  });
}

/**
 * JSON-RPC client for the Jito Block Engine HTTP API. No request is made at
 * construction; every method issues a POST to `<baseUrl>/api/v1/bundles`.
 */
export class JitoBundleClient {
  /**
   * Defaults to the mainnet engine. For Devnet testing, pass one of the
   * `JITO_BLOCK_ENGINE_URLS.devnet` URLs (the private relay) or set
   * `DEVNET_JITO_BLOCK_ENGINE_URL` env.
   */
  constructor(readonly baseUrl: string = JITO_BLOCK_ENGINE_URLS.mainnet[0]) {}

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    let httpStatus: number | undefined;
    let body: string | undefined;
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/bundles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params,
        }),
      });
      httpStatus = res.status;
      body = await res.text();
      if (!res.ok) {
        throw new JitoRpcError(
          `Block Engine ${method} failed with HTTP ${res.status}: ${body.slice(0, 200)}`,
          undefined,
          res.status,
        );
      }
      const json = JSON.parse(body) as { result?: T; error?: { code?: number; message?: string } };
      if (json.error) {
        throw new JitoRpcError(
          `Block Engine ${method} error: ${json.error.message ?? 'unknown error'}`,
          json.error.code,
          httpStatus,
        );
      }
      return json.result as T;
    } catch (err) {
      if (err instanceof JitoRpcError) throw err;
      throw new JitoRpcError(
        `Block Engine ${method} unreachable: ${(err as Error).message}`,
        undefined,
        httpStatus,
      );
    }
  }

  /** Current tip accounts (rotate via `selectTipAccount`). */
  async getTipAccounts(): Promise<PublicKey[]> {
    const result = await this.rpc<string[]>('getTipAccounts', []);
    return result.map((pk) => new PublicKey(pk));
  }

  /** Pick a random current tip account. */
  async getRandomTipAccount(): Promise<PublicKey> {
    return selectTipAccount(await this.getTipAccounts());
  }

  /**
   * Auction limits for the current leader. Older engines may not support the
   * method; returns a zero-minimum default so the caller can still tip.
   */
  async getBundleTipLimits(): Promise<BundleTipLimits> {
    try {
      const result = await this.rpc<Partial<BundleTipLimits>>('getBundleTipLimits', []);
      return {
        minBundleTipLamports:
          result.minBundleTipLamports !== undefined ? BigInt(result.minBundleTipLamports) : 0n,
        maxBundleSizeInEth: result.maxBundleSizeInEth ?? 0,
        maxBuilderFeeLamports:
          result.maxBuilderFeeLamports !== undefined ? BigInt(result.maxBuilderFeeLamports) : 0n,
        maxTransactions: result.maxTransactions ?? BUNDLE_MAX_TRANSACTIONS,
      };
    } catch (err) {
      if (err instanceof JitoRpcError && (err.code === -32601 || err.httpStatus === 400)) {
        return {
          minBundleTipLamports: 0n,
          maxBundleSizeInEth: 0,
          maxBuilderFeeLamports: 0n,
          maxTransactions: BUNDLE_MAX_TRANSACTIONS,
        };
      }
      throw err;
    }
  }

  /**
   * Submit a fully-signed versioned bundle. Each transaction must already carry
   * every required signature (fee payer, tip payer on tx 0, desk signers).
   * Returns the bundle id (sha256 of the bundle's tx signatures); the engine
   * replies before the slot expires, so this is not an on-chain receipt.
   */
  async sendBundle(transactions: VersionedTransaction[]): Promise<string> {
    if (transactions.length === 0) {
      throw new RangeError('cannot submit an empty bundle');
    }
    if (transactions.length > BUNDLE_MAX_TRANSACTIONS) {
      throw new RangeError(
        `Block Engine accepts at most ${BUNDLE_MAX_TRANSACTIONS} transactions per bundle (got ${transactions.length})`,
      );
    }
    const encoded = transactions.map((tx) => Buffer.from(tx.serialize()).toString('base64'));
    return this.sendEncodedBundle(encoded);
  }

  /** Submit raw base64-serialized, fully-signed transactions. */
  async sendEncodedBundle(encoded: string[]): Promise<string> {
    if (encoded.length === 0 || encoded.length > BUNDLE_MAX_TRANSACTIONS) {
      throw new RangeError(
        `bundle must contain between 1 and ${BUNDLE_MAX_TRANSACTIONS} transactions`,
      );
    }
    return this.rpc<string>('sendBundle', [[...encoded], { encoding: 'base64' }]);
  }

  /**
   * Poll the landing status of previously-submitted bundle ids. A `null` result
   * means the bundle has not yet landed; otherwise `confirmationStatus` and
   * `slot` describe the on-chain state.
   */
  async getBundleStatuses(bundleIds: string[]): Promise<(JitoBundleStatus | null)[]> {
    if (bundleIds.length === 0 || bundleIds.length > BUNDLE_MAX_TRANSACTIONS) {
      throw new RangeError(`query between 1 and ${BUNDLE_MAX_TRANSACTIONS} bundle ids`);
    }
    const result = await this.rpc<{
      context: { slot: number };
      value: (RawBundleStatus | null)[];
    }>('getBundleStatuses', [bundleIds]);
    return result.value.map((item) =>
      item === null
        ? null
        : {
            bundleId: item.bundle_id,
            transactions: item.transactions,
            slot: item.slot,
            confirmationStatus: item.confirmation_status,
            err: item.err,
          },
    );
  }
}

interface RawBundleStatus {
  bundle_id: string;
  transactions: string[];
  slot: number | null;
  confirmation_status: 'processed' | 'confirmed' | 'finalized' | null;
  err: unknown;
}