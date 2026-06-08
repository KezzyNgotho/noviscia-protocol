import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { insertFill, insertOracleTick } from './db';
import { startHttpServer } from './server';

const RPC = process.env.SOLANA_RPC_DEVNET || process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PT_PID = new PublicKey(
  process.env.NEXT_PUBLIC_POSITION_TRACKER_PROGRAM_ID || '3zGRWKZq4V3npHbH9Lati46BwgmstTjynWZFFMxarQgY'
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

function parseFillFromTx(
  tx: NonNullable<Awaited<ReturnType<Connection['getBlock']>>>['transactions'][number],
  eventType: string
): { wallet: string; market: string; side: string } {
  const keys = tx.transaction.message.getAccountKeys().staticAccountKeys.map((k) => k.toBase58());
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
    const touchesPt = logs.some((l) => l.includes(PT_PID.toBase58()));
    if (!touchesPt) continue;

    let eventType = 'unknown';
    if (logs.some((l) => l.includes(POSITION_OPENED))) eventType = 'open';
    else if (logs.some((l) => l.includes(POSITION_CLOSED))) eventType = 'close';
    else if (logs.some((l) => l.includes(PARTIAL_CLOSE))) eventType = 'partial_close';
    else if (logs.some((l) => l.includes(LIQUIDATED))) eventType = 'liquidate';
    else continue;

    const { wallet, market, side } = parseFillFromTx(tx, eventType);

    await insertFill({
      signature: sig,
      wallet,
      market,
      side,
      eventType,
      slot,
    }).catch(() => undefined);
  }
}

async function main() {
  await startHttpServer(PORT);
  const conn = new Connection(RPC, 'confirmed');
  let last = await conn.getSlot('confirmed');
  console.log(`📡 indexing position-tracker ${PT_PID.toBase58()} from slot ${last}`);

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
