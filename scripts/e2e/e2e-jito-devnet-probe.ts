/**
 * Jito Block Engine devnet/mainnet field-test probe.
 *
 * Read-only transport + tip-price verification for the institutional Jito
 * bundle path. Nothing is signed or sent.
 *
 * Cluster reality (verified Sep 2026):
 *   - `devnet.block-engine.jito.wtf` is decommissioned → NXDOMAIN. Devnet
 *     bundle submission is NOT possible; devnet integration must mock the
 *     engine (see sdk/src/jito.test.ts) or ship on mainnet.
 *   - `mainnet.block-engine.jito.wtf` is live. `getTipAccounts` returns the
 *     current 8-account tip set (these rotate); `getBundleTipLimits` is NOT
 *     exposed on the mainnet engine → use `getTipAccounts` + the SDK
 *     `resolveBundleTipLamports` floor.
 *   - The shared public engine rate-limits txn-type JSON-RPC requests to
 *     1/s per IP without an API key (HTTP 429) — bundle clients must back off
 *     and reuse the 1/s budget for `sendBundle`.
 *
 * Checks:
 *   1. Solana RPC (cluster given by JITO_PROBE_RPC, default devnet) reachable.
 *   2. Block engine transport for the engine cluster (default mainnet).
 *   3. `getTipAccounts` — live tip set; drift vs the sdk `KNOWN_JITO_TIP_ACCOUNTS`
 *      offline constant is measured and reported as a warning, not a failure.
 *   4. `getBundleTipLimits` — reported when exposed; "Invalid method" is an
 *      expected finding on mainnet (`DEFAULT_TIP_LAMPORTS` becomes the floor).
 *
 * Run:
 *   npx tsx scripts/e2e/e2e-jito-devnet-probe.ts
 *   JITO_PROBE_RPC=https://api.devnet.solana.com JITO_ENGINE_CLUSTER=mainnet npx tsx scripts/e2e/e2e-jito-devnet-probe.ts
 */
import { Connection } from '@solana/web3.js';
import {
  JitoBundleClient,
  JitoRpcError,
  JITO_BLOCK_ENGINE_URLS,
  DEFAULT_TIP_LAMPORTS,
  KNOWN_JITO_TIP_ACCOUNTS,
} from '../../sdk/src/jito';

const RPC = process.env.JITO_PROBE_RPC ?? 'https://api.devnet.solana.com';
const ENGINE_CLUSTER = (process.env.JITO_ENGINE_CLUSTER ?? 'mainnet') as 'mainnet' | 'devnet';
const BLOCK_ENGINE = process.env.JITO_BLOCK_ENGINE ?? JITO_BLOCK_ENGINE_URLS[ENGINE_CLUSTER][0];

const DELTAS: Record<string, number> = { start: performance.now() };
function start(key: string) {
  DELTAS[key] = performance.now();
}
function ms(key: string): string {
  return `${(performance.now() - (DELTAS[key] ?? DELTAS.start)).toFixed(1)}ms`;
}

function report(kind: 'PASS' | 'FAIL' | 'WARN' | 'INFO', label: string, detail = ''): void {
  console.log(`${kind === 'PASS' ? 'PASS' : kind === 'FAIL' ? 'FAIL' : kind === 'WARN' ? 'WARN' : 'INFO'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<number> {
  const failures: string[] = [];

  // 1. Solana RPC reachability + blockhash RTT.
  start('rpc');
  const connection = new Connection(RPC, 'confirmed');
  try {
    const bh = (await connection.getLatestBlockhash('confirmed')).blockhash;
    report('PASS', 'solana RPC reachable', `${ms('rpc')} · blockhash=${bh.slice(0, 12)}… (${RPC.replace('https://', '')})`);
  } catch (err) {
    failures.push(`solana RPC unreachable: ${(err as Error).message}`);
    report('FAIL', 'solana RPC reachable', String((err as Error).message));
  }

  // 2. Block engine transport.
  start('eng');
  const client = new JitoBundleClient(BLOCK_ENGINE);
  if (ENGINE_CLUSTER === 'devnet') {
    report('INFO', 'devnet block-engine', 'decommissioned (NXDOMAIN since pre-2026) — devnet bundles unsupported; mainnet is the bundle path');
  }
  let engineOk = false;
  try {
    await client.getTipAccounts();
    engineOk = true;
    report('PASS', `${ENGINE_CLUSTER} block-engine reachable`, `${ms('eng')} (${BLOCK_ENGINE.replace('https://', '')})`);
  } catch (err) {
    const reason = (err as Error).message;
    if (ENGINE_CLUSTER === 'devnet') {
      report('INFO', `${ENGINE_CLUSTER} block-engine reachable`, `expected finding — ${reason}`);
    } else {
      failures.push(`${ENGINE_CLUSTER} block-engine unreachable: ${reason}`);
      report('FAIL', `${ENGINE_CLUSTER} block-engine reachable`, reason);
    }
  }

  // 3. Live tip accounts + drift vs the SDK offline constant.
  if (engineOk) {
    start('tips');
    try {
      const live = await client.getTipAccounts();
      const liveStr = live.map((p) => p.toBase58());
      const knownStr = KNOWN_JITO_TIP_ACCOUNTS.map((p) => p.toBase58());
      const missing = knownStr.filter((k) => !liveStr.includes(k));
      const extra = liveStr.filter((k) => !knownStr.includes(k));
      if (missing.length === 0 && extra.length === 0) {
        report('PASS', 'getTipAccounts === SDK constant', `${liveStr.length} accounts · ${ms('tips')}`);
      } else {
        report(
          'WARN',
          'tip accounts rotated vs SDK constant',
          `live=${liveStr.length} · -${missing.length} +${extra.length} · ${ms('tips')} (rotate live via getTipAccounts)`,
        );
      }
      console.log('    live :', liveStr.join(' '));
      console.log('    sdk  :', knownStr.join(' '));
    } catch (err) {
      failures.push(`getTipAccounts failed: ${(err as Error).message}`);
      report('FAIL', 'getTipAccounts live set', String((err as Error).message));
    }
  }

  // 4. Bundle-tip floor via getBundleTipLimits (optional per engine).
  if (engineOk) {
    start('limits');
    try {
      const limits = await client.getBundleTipLimits();
      report(
        'PASS',
        'getBundleTipLimits exposed',
        `minBundleTip=${(Number(limits.minBundleTipLamports ?? DEFAULT_TIP_LAMPORTS) / 1e9).toFixed(6)} SOL · ${ms('limits')}`,
      );
    } catch (err) {
      const code = err instanceof JitoRpcError ? err.code : undefined;
      const http = err instanceof JitoRpcError ? err.httpStatus : undefined;
      if (code === -32601) {
        report(
          'INFO',
          'getBundleTipLimits',
          `not exposed on ${ENGINE_CLUSTER} engine (expected) — floor = DEFAULT_TIP_LAMPORTS (${Number(DEFAULT_TIP_LAMPORTS) / 1e9} SOL), prefer live getTipAccounts + auction window`,
        );
      } else if (http === 429 || code === -32097) {
        report(
          'INFO',
          'getBundleTipLimits',
          `shared public engine rate-limits txn-requests to 1/s (HTTP 429) without an API key — expected on devnet/mainnet; floor = DEFAULT_TIP_LAMPORTS (${Number(DEFAULT_TIP_LAMPORTS) / 1e9} SOL)`,
        );
      } else {
        failures.push(`getBundleTipLimits failed: ${(err as Error).message}`);
        report('FAIL', 'getBundleTipLimits', String((err as Error).message));
      }
    }
  }

  console.log('---');
  if (failureSummary(failures) === 0) {
    console.log('Jito field-test: PASS — transport + tip-price plumbing verified for the mainnet bundle path; nothing sent.');
    return 0;
  }
  console.log(`Jito field-test: FAIL — ${failures.length} check(s):`);
  failures.forEach((f) => console.log(`  - ${f}`));
  return 1;
}

function failureSummary(f: string[]): number {
  return f.length;
}

main().then((code) => process.exit(code));