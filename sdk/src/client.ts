import { AnchorProvider, Program, Wallet, type Idl } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface NovisciaClientOptions {
  rpc?: string;
  wallet?: Keypair;
  idlRoot?: string;
}

/**
 * NovisciaClient — a single handle over every anchor program in the stack.
 * IDLs are resolved from `idlRoot` (default <repo-root>/target/idl) so SDK
 * consumers never hardcode instruction layouts.
 */
/**
 * Resolve IDL root: prefer bundled IDLs (published package), fall back to
 * monorepo target/idl (local dev).
 */
function resolveIdlRoot(): string {
  const bundled = path.resolve(__dirname, 'idl');
  if (fs.existsSync(bundled)) return bundled;
  return path.resolve(__dirname, '..', 'target/idl');
}

export class NovisciaClient {
  readonly connection: Connection;
  readonly wallet: Keypair;
  readonly provider: AnchorProvider;
  readonly idlRoot: string;

  readonly positionTracker: Program;
  readonly nettingEngine: Program;
  readonly yieldRouter: Program;
  readonly nvUsdcVault: Program;
  readonly burnEngine: Program;
  readonly stakingManager: Program;
  readonly jitRisk: Program;

  constructor(opts: NovisciaClientOptions = {}) {
    this.idlRoot = opts.idlRoot ?? resolveIdlRoot();
    this.connection = new Connection(opts.rpc ?? process.env.SOLANA_RPC_DEVNET ?? 'https://api.devnet.solana.com', 'confirmed');
    this.wallet = opts.wallet ?? loadCliWallet();
    this.provider = new AnchorProvider(this.connection, new Wallet(this.wallet), { commitment: 'confirmed' });

    this.positionTracker = this.program('position_tracker');
    this.nettingEngine = this.program('netting_engine');
    this.yieldRouter = this.program('yield_router');
    this.nvUsdcVault = this.program('nv_usdc_vault');
    this.burnEngine = this.program('burn_engine');
    this.stakingManager = this.program('staking_manager');
    this.jitRisk = this.program('jit_risk');
  }

  private program(name: string): Program {
    const file = path.join(this.idlRoot, `${name}.json`);
    if (!fs.existsSync(file)) throw new Error(`IDL ${file} not found — run anchor build / scripts/deploy/sync-idls.sh`);
    const idl = JSON.parse(fs.readFileSync(file, 'utf-8')) as Idl;
    // Program ID is carried by the IDL (address) — deployed IDs must match.
    return new Program(idl, this.provider);
  }
}

export function loadCliWallet(): Keypair {
  const candidates = [
    process.env.ADMIN_KEYPAIR_PATH,
    process.env.ANCHOR_WALLET,
    process.env.EXECUTOR_KEYPAIR_PATH,
    cliConfigKeypair(),
    path.join(os.homedir(), '.config/solana/new-id.json'),
  ].filter((p): p is string => !!p);
  for (const c of candidates) {
    try {
      const resolved = path.isAbsolute(c) ? c : path.resolve(c);
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(resolved, 'utf-8'))));
    } catch { /* next */ }
  }
  throw new Error('No wallet found — set ADMIN_KEYPAIR_PATH / ANCHOR_WALLET / EXECUTOR_KEYPAIR_PATH');
}

function cliConfigKeypair(): string | null {
  const cfgPath = path.join(os.homedir(), '.config/solana/cli/config.yml');
  if (!fs.existsSync(cfgPath)) return null;
  const text = fs.readFileSync(cfgPath, 'utf-8');
  const m = text.match(/^\s*keypair_path:\s*(.+)\s*$/m);
  if (!m) return null;
  const p = m[1].trim().replace(/^~/, os.homedir());
  return fs.existsSync(p) ? p : null;
}
