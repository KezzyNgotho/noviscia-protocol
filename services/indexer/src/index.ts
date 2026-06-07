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

    await insertFill({
      signature: sig,
      wallet: 'unknown',
      market: 'unknown',
      side: 'unknown',
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
