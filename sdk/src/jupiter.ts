/**
 * Jupiter Route-Leg Provider — the in-bundle DEX leg for the TVV gate keeper.
 *
 * The keeper's `routeIxs` slot in `buildGateBundle` (Tx-1 between arm and
 * settle) normally carries opaque cross-venue arb legs. This provider builds a
 * *real* atomic Jupiter route instead: one `JupiterV6` instruction that routes
 * `inMint -> ... -> outMint` across whatever route Jupiter prices (single leg
 * or multi-hop, all atomic inside the one instruction). For the spatial-arb
 * used by the gate, `inMint == outMint == USDC` produces a full circular route.
 *
 * Two calls, both pure HTTP against the public Jupiter v6 API:
 *
 *   1. `quote(...)`   — GET  /quote   → the priced route (in/out amounts).
 *   2. `buildSwapLeg` — POST /swap    → a constructed `TransactionInstruction`
 *      plus any address-lookup tables the route needs.
 *
 * No call at import time; `fetch`-injectable so offline tests can pin exact
 * request/response pairs.
 */

import { PublicKey, TransactionInstruction } from '@solana/web3.js';

/** Minimum amount Jupiter requires (`amount` param), in base units. */
export const JUPITER_V6_QUOTE_API = 'https://quote-api.jup.ag/v6';

/** Raw response shape from Jupiter `/quote` (number-as-string for amounts). */
interface JupiterApiRoute {
  inputMint: string;
  outputMint: string;
  inAmount: string | number;
  outAmount: string | number;
  slippageBps?: number | string;
  otherAmountThreshold?: string | number;
  swapMode?: string;
  routePlan?: unknown[];
}

/** A priced Jupiter route (normalized from the v6 quote response). */
export interface JupiterQuoteRoute {
  inputMint: string;
  outputMint: string;
  inAmount: bigint;
  outAmount: bigint;
  slippageBps: number;
  otherAmountThreshold: bigint;
  swapMode: 'ExactIn' | 'ExactOut';
  /** Raw route-plan legs (for stats/observability; not needed to execute). */
  routePlan?: unknown[];
}

export interface QuoteOptions {
  slippageBps?: number;
  restrictIntermediateTokens?: boolean;
  feeBps?: number;
}

/** A real, buildable swap leg for the keeper's route slot. */
export interface JupiterSwapLeg {
  /** The atomic swap instruction to drop into Tx-1 of the gate bundle. */
  instruction: TransactionInstruction;
  /** Addresses of lookup tables the instruction references (fetch + pass to
   *  `buildGateBundle` as `routeLookupTables`). */
  lookupTableAddresses: string[];
  inAmount: bigint;
  outAmount: bigint;
  /** Price impact in % if the API reported it; else `null`. */
  priceImpactPct: number | null;
}

export class JupSwapProviderError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'JupSwapProviderError';
  }
}

/**
 * Thin, defensive client over the Jupiter v6 quote + swap APIs.
 *
 * @param baseUrl    API root (defaults to the public v6 endpoint).
 * @param fetchImpl  fetch implementation to use (inject for tests).
 */
export class JupiterSwapLegProvider {
  constructor(
    readonly baseUrl: string = JUPITER_V6_QUOTE_API,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  /**
   * Request a quote. Returns `null` when no route exists between the two mints
   * at the requested size (the keeper then falls back to a non-swap leg).
   */
  async quote(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amount: bigint,
    options: QuoteOptions = {},
  ): Promise<JupiterQuoteRoute | null> {
    const params = new URLSearchParams({
      inputMint: inputMint.toBase58(),
      outputMint: outputMint.toBase58(),
      amount: amount.toString(),
      slippageBps: String(options.slippageBps ?? 50),
    });
    if (options.restrictIntermediateTokens !== undefined) {
      params.set('restrictIntermediateTokens', String(options.restrictIntermediateTokens));
    }
    if (options.feeBps !== undefined) params.set('feeBps', String(options.feeBps));

    const data = await this.get(`/quote?${params.toString()}`);
    const route = this.pickRoute(data);
    if (!route) return null;
    return {
      inputMint: String(route.inputMint),
      outputMint: String(route.outputMint),
      inAmount: BigInt(String(route.inAmount)),
      outAmount: BigInt(String(route.outAmount)),
      slippageBps: Number(route.slippageBps ?? 0),
      otherAmountThreshold: route.otherAmountThreshold !== undefined ? BigInt(String(route.otherAmountThreshold)) : 0n,
      swapMode: route.swapMode === 'ExactOut' ? 'ExactOut' : 'ExactIn',
      routePlan: route.routePlan,
    };
  }

  /**
   * Turn a quote response into a real swap instruction (plus its lookup tables).
   * Throws `JupSwapProviderError` if the `/swap` call fails.
   */
  async buildSwapLeg(route: JupiterQuoteRoute, userPublicKey: PublicKey): Promise<JupiterSwapLeg> {
    // The API expects amounts as strings (the quote response shape); Jupiter's
    // own clients pass them through verbatim. BigInt must be serialized as its
    // decimal value, never thrown.
    const quoteResponse = JSON.parse(
      JSON.stringify(route, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
    );
    const data = await this.post('/swap', {
      quoteResponse,
      userPublicKey: userPublicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    });
    const instruction = decodeSwapInstruction(data);
    return {
      instruction,
      lookupTableAddresses: Array.isArray(data.addressLookupTableAddresses)
        ? data.addressLookupTableAddresses.map(String)
        : [],
      inAmount: route.inAmount,
      outAmount: route.outAmount,
      priceImpactPct: data.priceImpactPct !== undefined ? Number(data.priceImpactPct) : null,
    };
  }

  private async get(path: string): Promise<JupiterApiObject> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`);
    if (!res.ok) {
      throw new JupSwapProviderError(`Jupiter GET ${path} failed with HTTP ${res.status}`, res.status);
    }
    return (await res.json()) as JupiterApiObject;
  }

  private async post(path: string, body: unknown): Promise<JupiterApiObject> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new JupSwapProviderError(`Jupiter POST ${path} failed with HTTP ${res.status}`, res.status);
    }
    return (await res.json()) as JupiterApiObject;
  }

  /** Jupiter v6 /quote returns a single route object; older shapes wrap in
   *  `routes[]`. Accept both. */
  private pickRoute(data: JupiterApiObject): JupiterApiRoute | null {
    const routes = data.routes;
    if (Array.isArray(routes) && routes.length > 0) {
      return routes[0] as JupiterApiRoute;
    }
    if (data.inAmount !== undefined && data.inputMint !== undefined) {
      return data as unknown as JupiterApiRoute;
    }
    if (data.route !== undefined && typeof data.route === 'object') {
      return data.route as JupiterApiRoute;
    }
    return null;
  }
}

interface JupiterSwapInstructionRaw {
  programId?: string;
  accounts?: JupiterAccountRaw[];
  accountKeys?: JupiterAccountRaw[];
  data?: string;
}

interface JupiterAccountRaw {
  pubkey: string;
  isSigner?: boolean;
  isWritable?: boolean;
  isResolved?: boolean;
}

interface JupiterApiObject {
  [key: string]: unknown;
}

function decodeSwapInstruction(data: JupiterApiObject): TransactionInstruction {
  const raw = data.swapInstruction as JupiterSwapInstructionRaw | undefined;
  if (!raw || typeof raw.programId !== 'string' || !raw.data) {
    throw new JupSwapProviderError('Jupiter /swap returned no usable swapInstruction');
  }
  const accountList = raw.accounts ?? raw.accountKeys ?? [];
  const keys = accountList.map((acct) => {
    if (typeof acct === 'string') {
      return { pubkey: new PublicKey(acct), isSigner: false, isWritable: false };
    }
    return {
      pubkey: new PublicKey(acct.pubkey),
      isSigner: Boolean(acct.isSigner),
      // Jupiter keys without an explicit writable flag are read-only — `null`
      // (mutable) would wrongly mark authority-bearing accounts as static.
      isWritable: Boolean(acct.isWritable),
    };
  });
  return {
    programId: new PublicKey(raw.programId),
    keys,
    data: Buffer.from(raw.data, 'base64'),
  };
}