import { Connection, Keypair, Transaction, PublicKey, SendOptions, Commitment } from '@solana/web3.js';
import { buildNettingSettlementTransaction, buildRecallMarginTransaction } from './txBuilder';

export type AdapterExecuteResult = { success: boolean; note?: string; txSig?: string };

export type GatewayOptions = {
  maxRecallUsdc: number;
  maxAdapterPayloadBytes: number;
  requireSandboxForExecution: boolean;
  defaultCommitment: Commitment;
};

export type ExecuteAdapterOptions = {
  submit?: boolean;
  sendOptions?: SendOptions;
};

export interface ProductAdapter {
  name: string;
  requiredAccounts(): PublicKey[];
  buildActionTx(params: any, signer: Keypair | { publicKey: PublicKey }): Promise<Transaction>;
}

export type WalletAdapterLike = {
  publicKey: PublicKey;
  signTransaction?: (tx: Transaction) => Promise<Transaction> | Transaction;
  signAllTransactions?: (txs: Transaction[]) => Promise<Transaction[]> | Transaction[];
};

export class Sandbox {
  // lightweight in-memory isolation metadata for PoC
  private stateStore = new Map<string, any>();
  constructor(public readonly id: string) {}
  read(key: string) { return this.stateStore.get(key); }
  write(key: string, val: any) { this.stateStore.set(key, val); }
}

export class Gateway {
  adapters: Map<string, ProductAdapter> = new Map();
  sandboxes: Map<string, Sandbox> = new Map();
  lastNetting: Record<string, any> = {};
  readonly options: GatewayOptions;

  private static readonly SANDBOX_ID_RE = /^[a-zA-Z0-9:_-]{3,64}$/;

  constructor(public connection: Connection, options?: Partial<GatewayOptions>) {
    this.options = {
      maxRecallUsdc: 50_000_000,
      maxAdapterPayloadBytes: 65_536,
      requireSandboxForExecution: false,
      defaultCommitment: 'confirmed',
      ...(options || {}),
    };
  }

  private ensureSandboxId(id: string) {
    if (!Gateway.SANDBOX_ID_RE.test(id)) {
      throw new Error('invalid-sandbox-id');
    }
  }

  private ensurePositiveSafeInteger(n: number, code: string) {
    if (!Number.isSafeInteger(n) || n <= 0) {
      throw new Error(code);
    }
  }

  private estimatePayloadBytes(params: any): number {
    try {
      return Buffer.byteLength(JSON.stringify(params ?? {}), 'utf8');
    } catch {
      return this.options.maxAdapterPayloadBytes + 1;
    }
  }

  private async signAndSubmit(tx: Transaction, signer: Keypair | WalletAdapterLike, sendOptions?: SendOptions): Promise<string> {
    const latest = await this.connection.getLatestBlockhash(this.options.defaultCommitment);
    tx.recentBlockhash = tx.recentBlockhash || latest.blockhash;
    tx.feePayer = tx.feePayer || (signer as any).publicKey;

    let signedTx: Transaction;
    // Wallet adapters implement signTransaction; Keypair requires local signing
    if (typeof (signer as WalletAdapterLike).signTransaction === 'function') {
      // allow wallet adapter to sign the transaction (may be async)
      signedTx = await (signer as WalletAdapterLike).signTransaction!(tx);
    } else {
      // Keypair-based signer
      (tx as Transaction).sign(signer as Keypair);
      signedTx = tx as Transaction;
    }

    const sig = await this.connection.sendRawTransaction(signedTx.serialize(), sendOptions);
    await this.connection.confirmTransaction({ signature: sig, ...latest }, this.options.defaultCommitment);
    return sig;
  }

  registerAdapter(adapter: ProductAdapter) {
    if (!adapter?.name) throw new Error('invalid-adapter-name');
    if (this.adapters.has(adapter.name)) throw new Error('adapter-already-registered');
    this.adapters.set(adapter.name, adapter);
  }

  createSandbox(id: string) {
    this.ensureSandboxId(id);
    if (this.sandboxes.has(id)) throw new Error('sandbox-already-exists');
    const sb = new Sandbox(id);
    this.sandboxes.set(id, sb);
    return sb;
  }

  deleteSandbox(id: string) {
    return this.sandboxes.delete(id);
  }

  /** PoC: settle a netting report into gateway state (production would CPI to netting-engine) */
  settleNetting(market: string, report: any) {
    this.lastNetting = this.lastNetting || {};
    this.lastNetting[market] = report;
    return { success: true };
  }

  async buildNettingSettlementTransaction(params: {
    market: string;
    traders?: string[];
    feePayer?: PublicKey;
    signer?: Keypair;
    recentBlockhash?: string;
  }) {
    return buildNettingSettlementTransaction(this.connection, params);
  }

  async buildRecallTransaction(params: {
    amount: number;
    callerKeypair?: Keypair;
    vaultUsdcMint?: PublicKey;
    vaultUsdcAccount?: PublicKey;
    venueAta?: PublicKey;
    feePayer?: PublicKey;
    recentBlockhash?: string;
  }) {
    return buildRecallMarginTransaction(this.connection, params);
  }

  /**
   * Atomic recall orchestration hook — record recall intent in sandbox.
   * If `opts.onChain` is provided with vault params and a signer, the method
   * attempts to construct a `yield_router::recall_for_margin` CPI instruction
   * and return it for inclusion in a transaction. Falls back to PoC sandbox
   * recording when parameters are missing.
   */
  recallForMargin(sandboxId: string | undefined, usdcAmount: number, opts?: {
    onChain?: boolean;
    callerKeypair?: Keypair;
    vaultUsdcMint?: PublicKey;
    vaultUsdcAccount?: PublicKey;
    venueAta?: PublicKey;
  }) {
    try {
      this.ensurePositiveSafeInteger(usdcAmount, 'invalid-recall-amount');
      if (usdcAmount > this.options.maxRecallUsdc) {
        return { success: false, note: 'recall-amount-too-large' };
      }
    } catch (e: any) {
      return { success: false, note: String(e?.message || e) };
    }

    if (!sandboxId) return { success: false, note: 'no-sandbox' };
    const sb = this.sandboxes.get(sandboxId);
    if (!sb) return { success: false, note: 'sandbox-not-found' };

    // If on-chain recall requested and minimal params present, try to build instruction
    if (opts?.onChain && opts.callerKeypair && opts.vaultUsdcMint && opts.vaultUsdcAccount && opts.venueAta) {
      const callerKeypair = opts.callerKeypair;
      (async () => {
        try {
          const tx = await this.buildRecallTransaction({
            amount: usdcAmount,
            callerKeypair,
            vaultUsdcMint: opts.vaultUsdcMint,
            vaultUsdcAccount: opts.vaultUsdcAccount,
            venueAta: opts.venueAta,
            feePayer: callerKeypair.publicKey,
          });

          const meta = {
            instructionCount: tx.instructions.length,
            feePayer: tx.feePayer?.toBase58?.() ?? null,
            recentBlockhash: tx.recentBlockhash,
          };
          const recalls = sb.read('recalls') || [];
          recalls.push({ amount: usdcAmount, ts: Date.now(), onChain: true, tx: meta });
          sb.write('recalls', recalls);
        } catch {
          // ignore and fall back to PoC recording below
        }
      })();

      // immediate return for compatibility; sandbox will be updated once builder completes
      return { success: true, note: 'recall-building' } as any;
    }

    // fallback PoC: record the recall request in the sandbox
    const recalls = sb.read('recalls') || [];
    recalls.push({ amount: usdcAmount, ts: Date.now() });
    sb.write('recalls', recalls);
    return { success: true, note: 'recall-recorded' };
  }

  async recallForMarginOnChain(sandboxId: string | undefined, usdcAmount: number, opts: {
    callerKeypair: Keypair;
    vaultUsdcMint: PublicKey;
    vaultUsdcAccount: PublicKey;
    venueAta: PublicKey;
    sendOptions?: SendOptions;
  }): Promise<AdapterExecuteResult> {
    this.ensurePositiveSafeInteger(usdcAmount, 'invalid-recall-amount');
    if (usdcAmount > this.options.maxRecallUsdc) {
      return { success: false, note: 'recall-amount-too-large' };
    }
    if (!sandboxId) return { success: false, note: 'no-sandbox' };
    const sb = this.sandboxes.get(sandboxId);
    if (!sb) return { success: false, note: 'sandbox-not-found' };

    try {
      const tx = await this.buildRecallTransaction({
        amount: usdcAmount,
        callerKeypair: opts.callerKeypair,
        vaultUsdcMint: opts.vaultUsdcMint,
        vaultUsdcAccount: opts.vaultUsdcAccount,
        venueAta: opts.venueAta,
        feePayer: opts.callerKeypair.publicKey,
      });

      const txSig = await this.signAndSubmit(tx, opts.callerKeypair, opts.sendOptions);
      const recalls = sb.read('recalls') || [];
      recalls.push({ amount: usdcAmount, ts: Date.now(), onChain: true, txSig });
      sb.write('recalls', recalls);
      return { success: true, note: 'recall-submitted', txSig };
    } catch (e: any) {
      return { success: false, note: String(e?.message || e) };
    }
  }

  async executeAdapterAction(
    adapterName: string,
    params: any,
    signer: Keypair,
    sandboxId?: string,
    options?: ExecuteAdapterOptions,
  ): Promise<AdapterExecuteResult> {
    if (this.options.requireSandboxForExecution && !sandboxId) {
      return { success: false, note: 'sandbox-required' };
    }

    const adapter = this.adapters.get(adapterName);
    if (!adapter) return { success: false, note: 'adapter-not-found' };

    const payloadSize = this.estimatePayloadBytes(params);
    if (payloadSize > this.options.maxAdapterPayloadBytes) {
      return { success: false, note: 'payload-too-large' };
    }

    try {
      const tx = await adapter.buildActionTx(params, signer);
      // If sandbox is provided, we do a dry-run (no send) and return serialized size
      if (sandboxId) {
        const sb = this.sandboxes.get(sandboxId);
        if (!sb) return { success: false, note: 'sandbox-not-found' };
        // enforce tenant-scoped adapter access when sandbox exposes `canAccess`
        try {
          if (typeof (sb as any).canAccess === 'function' && !(sb as any).canAccess(adapterName)) {
            return { success: false, note: 'adapter-not-allowed' };
          }
        } catch (e) {
          // on unexpected sandbox impl errors, fail-safe and reject execution
          return { success: false, note: 'sandbox-access-check-failed' };
        }

        sb.write(`last:${adapterName}`, { params, size: payloadSize });
        // attempt to record the execution in the sandbox if supported (TenantSandbox)
        try {
          if (typeof (sb as any).recordExecution === 'function') {
            (sb as any).recordExecution({ adapter: adapterName, payload: params });
          }
        } catch (e) {
          // non-fatal: preserve dry-run result but log to sandbox store
          const errors = sb.read('errors') || [];
          errors.push({ ts: Date.now(), note: String(e?.message ?? e) });
          sb.write('errors', errors);
        }
        return { success: true, note: 'sandbox-dryrun' };
      }

      if (!options?.submit) {
        return { success: true, note: 'tx-ready' };
      }

      const txSig = await this.signAndSubmit(tx, signer, options.sendOptions);
      return { success: true, note: 'submitted', txSig };
    } catch (e: any) {
      return { success: false, note: String(e.message ?? e) };
    }
  }
}
