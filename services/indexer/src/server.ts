import express from 'express';
import {
  cancelOrder,
  createOrder,
  initDb,
  listFills,
  listOrders,
  listPendingOrders,
  updateOrderStatus,
} from './db';

const INGEST_SECRET = process.env.INDEXER_INGEST_SECRET || process.env.KEEPER_INGEST_SECRET || '';

function authIngest(req: express.Request): boolean {
  if (!INGEST_SECRET) return true;
  const h = req.headers.authorization || '';
  return h === `Bearer ${INGEST_SECRET}` || req.headers['x-ingest-secret'] === INGEST_SECRET;
}

export async function startHttpServer(port = 8092): Promise<void> {
  await initDb();
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'noviscia-indexer' });
  });

  app.get('/orders', async (req, res) => {
    const wallet = String(req.query.wallet || '');
    if (!wallet) return res.status(400).json({ error: 'wallet required' });
    const status = req.query.status ? String(req.query.status) : undefined;
    const rows = await listOrders(wallet, status);
    res.json({ orders: rows });
  });

  app.get('/orders/pending', async (req, res) => {
    if (!authIngest(req)) return res.status(401).json({ error: 'unauthorized' });
    const rows = await listPendingOrders();
    res.json({ orders: rows });
  });

  app.post('/orders', async (req, res) => {
    const b = req.body || {};
    const wallet = String(b.wallet || '');
    const market = String(b.market || '');
    const side = String(b.side || '');
    if (!wallet || !market || !side || !b.limitPrice) {
      return res.status(400).json({ error: 'wallet, market, side, limitPrice required' });
    }
    const reduceOnly = Boolean(b.reduceOnly);
    if (reduceOnly && !b.closeBps) {
      return res.status(400).json({ error: 'reduce-only close orders require closeBps' });
    }
    const id = String(b.id || `${wallet.slice(0, 8)}-${Date.now()}`);
    await createOrder({
      id,
      wallet,
      market,
      side,
      orderType: b.orderType || 'limit',
      limitPrice: BigInt(b.limitPrice),
      collateralUsdc: BigInt(b.collateralUsdc || 0),
      leverage: Number(b.leverage || 1),
      reduceOnly,
      closeBps: b.closeBps ? Number(b.closeBps) : undefined,
      expiresAt: b.expiresAt ? new Date(b.expiresAt) : undefined,
    });
    res.json({ id, status: 'pending' });
  });

  app.delete('/orders/:id', async (req, res) => {
    const wallet = String(req.query.wallet || req.body?.wallet || '');
    const ok = await cancelOrder(req.params.id, wallet);
    if (!ok) return res.status(404).json({ error: 'not found or not cancellable' });
    res.json({ ok: true });
  });

  app.patch('/orders/:id', async (req, res) => {
    if (!authIngest(req)) return res.status(401).json({ error: 'unauthorized' });
    const status = String(req.body?.status || '');
    if (!status) return res.status(400).json({ error: 'status required' });
    await updateOrderStatus(req.params.id, status, {
      triggerPrice: req.body.triggerPrice != null ? BigInt(req.body.triggerPrice) : undefined,
      filledSignature: req.body.filledSignature,
    });
    res.json({ ok: true });
  });

  app.get('/history', async (req, res) => {
    const wallet = String(req.query.wallet || '');
    if (!wallet) return res.status(400).json({ error: 'wallet required' });
    const fills = await listFills(wallet, Number(req.query.limit || 50));
    res.json({ fills });
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(`📊 indexer API http://0.0.0.0:${port}`);
  });
}
