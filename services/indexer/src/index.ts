import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { initDb, insertActivity, insertFill, insertOracleTick } from './db';
import { parseActivityFromLogs } from './events';
import { startHttpServer } from './server';

const RPC = process.env.SOLANA_RPC_DEVNET || process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PT_PID = new PublicKey(
  process.env.NEXT_PUBLIC_POSITION_TRACKER_PROGRAM_ID || '6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws'
);
const PORT = parseInt(process.env.PORT || process.env.INDEXER_PORT || '8092', 10);

const POSITION_OPENED = 'Program log: Instruction: OpenPosition';
const POSITION_CLOSED = 'Program log: Instruction: ClosePosition';
const PARTIAL_CLOSE = 'Program log: Instruction: ClosePositionPartial';
const LIQUIDATED = 'Program log: Instruction: Liquidate';

const MARKET_KEYS = [
  'SOL-PERP', 'BTC-PERP', 'ETH-PERP', 'BONK-PERP', 'WIF-PERP', 'JUP-PERP',
  'PYTH-PERP', 'RAY-PERP', 'JTO-PERP', 'ORCA-PERP', 'POPCAT-PERP', 'MEW-PERP',
  'RENDER-PERP', 'HNT-PERP', 'TRUMP-PERP', 'PNUT-PERP',
];

type BlockTx = { transaction: { signatures: string[]; message: { getAccountKeys(): { staticAccountKeys: { toBase58(): string }[] } } }; meta: { logMessages?: string[] | null; err?: unknown } | null };

function parseFillFromTx(
  tx: BlockTx,
  eventType: string
): { wallet: string; market: string; side: string } {
  const keys = tx.transaction.message.getAccountKeys().staticAccountKeys.map((k: { toBase58(): string }) => k.toBase58());
  const wallet = keys[0] ?? 'unknown';

  let market = 'unknown';
  let side = 'unknown';

  for (const log of tx.meta?.logMessages ?? []) {
    for (const mk of MARKET_KEYS) {
      if (log.includes(mk)) {
        market = mk;
        break;
      }
    }
    if (log.includes('side: long') || log.includes('Side: Long')) side = 'long';
    if (log.includes('side: short') || log.includes('Side: Short')) side = 'short';
  }

  if (market === 'unknown' && eventType === 'liquidate') {
    for (const k of keys) {
      if (k !== wallet && k.length >= 32) {
        /* liquidator is often first signer; position owner resolved via logs in future */
      }
    }
  }

  return { wallet, market, side };
}

// Program IDs we want to scan — position-tracker plus all other protocol programs.
const WATCHED_PIDS = new Set(
  (process.env.WATCHED_PROGRAM_IDS || [
    '6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws',
    process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID,
    process.env.NEXT_PUBLIC_STAKING_MANAGER_PROGRAM_ID,
    process.env.NEXT_PUBLIC_LIQUIDATION_VAULT_PROGRAM_ID,
    process.env.NEXT_PUBLIC_BURN_ENGINE_PROGRAM_ID,
    process.env.NEXT_PUBLIC_NV_USDC_VAULT_PROGRAM_ID,
    process.env.NEXT_PUBLIC_YIELD_DISTRIBUTOR_PROGRAM_ID,
    process.env.NEXT_PUBLIC_PREDICTION_MARKET_PROGRAM_ID || 'GtTJWLa6MXjZoNucGHWVnE9LpZTw6Dsr5K1gxpM1Q4fe',
    process.env.NEXT_PUBLIC_NVSC_MINT                    || 'HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT',
    process.env.NEXT_PUBLIC_JIT_RISK_PROGRAM_ID          || 'JDsM18uSZ1UJEP49XdKSjumdftpuZ8cJbpb8CkBaBiMc',
    process.env.NEXT_PUBLIC_GATEWAY_AUCTION_PROGRAM_ID     || 'HQ26VTfoBVmGFY1JsFp5HmMT3rjLNoLJH6zurm8TL9xR',
    process.env.NEXT_PUBLIC_SOVEREIGN_NETTING_PROGRAM_ID   || '68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56',
  ].filter(Boolean) as string[])
);

async function ingestSlot(conn: Connection, slot: number) {
  const block = await conn.getBlock(slot, {
    maxSupportedTransactionVersion: 0,
    transactionDetails: 'full',
    rewards: false,
  });
  if (!block?.transactions) return;

  for (const tx of block.transactions) {
    const sig = tx.transaction.signatures[0];
    if (!sig || tx.meta?.err) continue;
    const logs = tx.meta?.logMessages || [];

    const touchesProtocol = logs.some((l) => {
      for (const pid of WATCHED_PIDS) if (l.includes(pid)) return true;
      return false;
    });
    if (!touchesProtocol) continue;

    // ── Perps fills (existing path, kept for backwards-compat) ────────────────
    if (logs.some((l) => l.includes(PT_PID.toBase58()))) {
      let fillType = '';
      if (logs.some((l) => l.includes(POSITION_OPENED))) fillType = 'open';
      else if (logs.some((l) => l.includes(POSITION_CLOSED))) fillType = 'close';
      else if (logs.some((l) => l.includes(PARTIAL_CLOSE))) fillType = 'partial_close';
      else if (logs.some((l) => l.includes(LIQUIDATED))) fillType = 'liquidate';

      if (fillType) {
        const { wallet, market, side } = parseFillFromTx(tx, fillType);
        await insertFill({ signature: sig, wallet, market, side, eventType: fillType, slot }).catch(() => undefined);
      }
    }

    // ── Unified activity log: parse all Anchor events ─────────────────────────
    const events = parseActivityFromLogs(logs);
    for (const ev of events) {
      // Revenue events (premium/tip/rent flowing to the omni-pool) often carry
      // no per-user wallet — keep them so the revenue chart has data. Everything
      // else needs a wallet to be a meaningful user-activity row.
      const revenueProgram = ev.program === 'jit-risk' || ev.program === 'gateway-auction' || ev.program === 'sovereign-netting';
      if (!ev.wallet && !revenueProgram) continue;
      await insertActivity({
        signature: sig,
        wallet: ev.wallet ?? 'protocol',
        program: ev.program,
        eventType: ev.eventType,
        market: ev.market ?? undefined,
        amountUsdc: ev.amountUsdc ?? undefined,
        pnlUsdc: ev.pnlUsdc ?? undefined,
        slot,
        metadata: ev.metadata,
      }).catch(() => undefined);
    }
  }
}

async function main() {
  await initDb();
  await startHttpServer(PORT);
  const conn = new Connection(RPC, 'confirmed');
  let last = await conn.getSlot('confirmed');
  console.log(`📡 indexing ${WATCHED_PIDS.size} programs from slot ${last}`);

  const slotIntervalMs = parseInt(process.env.INDEXER_SLOT_INTERVAL_MS || '30000', 10);
  setInterval(async () => {
    try {
      const current = await conn.getSlot('confirmed');
      for (let s = last + 1; s <= current; s++) {
        await ingestSlot(conn, s);
      }
      last = current;
    } catch (e) {
      console.warn('indexer slot loop:', (e as Error).message);
    }
  }, slotIntervalMs);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export { insertOracleTick };
