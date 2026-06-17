import express from 'express';
import {
  advanceTwapSlice,
  cancelOrder,
  createApiKey,
  createOrder,
  followLeader,
  initDb,
  insertActivity,
  insertOracleTick,
  listActiveTwapOrders,
  listActivity,
  listCopyFollowers,
  listCopyFollowing,
  listFills,
  listOrders,
  listPendingOrders,
  unfollowLeader,
  updateOrderStatus,
  verifyApiKey,
} from './db';

const INGEST_SECRET = process.env.INDEXER_INGEST_SECRET || process.env.KEEPER_INGEST_SECRET || '';

function authIngest(req: express.Request): boolean {
  if (!INGEST_SECRET) return true;
  const h = req.headers.authorization || '';
  return h === `Bearer ${INGEST_SECRET}` || req.headers['x-ingest-secret'] === INGEST_SECRET;
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string, limit = 120): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

export async function startHttpServer(port = 8092): Promise<void> {
  await initDb();
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.use((req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const apiKey = String(req.headers['x-api-key'] || '');
    const bucketKey = apiKey ? `key:${apiKey.slice(0, 12)}` : `ip:${ip}`;
    const limit = apiKey ? 300 : 120;
    if (!rateLimit(bucketKey, limit)) {
      return res.status(429).json({ error: 'rate limit exceeded' });
    }
    next();
  });

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

  app.get('/orders/twap/active', async (req, res) => {
    if (!authIngest(req)) return res.status(401).json({ error: 'unauthorized' });
    const rows = await listActiveTwapOrders();
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
    const orderType = String(b.orderType || 'limit');
    if (orderType === 'twap' && (!b.twapSlices || !b.twapIntervalSecs)) {
      return res.status(400).json({ error: 'twap orders require twapSlices and twapIntervalSecs' });
    }
    const id = String(b.id || `${wallet.slice(0, 8)}-${Date.now()}`);
    await createOrder({
      id,
      wallet,
      market,
      side,
      orderType,
      limitPrice: BigInt(b.limitPrice),
      collateralUsdc: BigInt(b.collateralUsdc || 0),
      leverage: Number(b.leverage || 1),
      reduceOnly,
      closeBps: b.closeBps ? Number(b.closeBps) : undefined,
      expiresAt: b.expiresAt ? new Date(b.expiresAt) : undefined,
      twapSlices: b.twapSlices ? Number(b.twapSlices) : undefined,
      twapIntervalSecs: b.twapIntervalSecs ? Number(b.twapIntervalSecs) : undefined,
    });
    res.json({ id, status: orderType === 'twap' ? 'twap_active' : 'pending' });
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

  app.patch('/orders/:id/twap-slice', async (req, res) => {
    if (!authIngest(req)) return res.status(401).json({ error: 'unauthorized' });
    const sliceIndex = Number(req.body?.sliceIndex ?? -1);
    if (sliceIndex < 0) return res.status(400).json({ error: 'sliceIndex required' });
    await advanceTwapSlice(req.params.id, sliceIndex);
    res.json({ ok: true });
  });

  app.post('/oracle/ticks', async (req, res) => {
    if (!authIngest(req)) return res.status(401).json({ error: 'unauthorized' });
    const b = req.body || {};
    if (!b.market || b.markPrice == null) {
      return res.status(400).json({ error: 'market and markPrice required' });
    }
    await insertOracleTick({
      market: String(b.market),
      markPrice: BigInt(b.markPrice),
      indexPrice: BigInt(b.indexPrice ?? b.markPrice),
      fundingRateBps: Number(b.fundingRateBps || 0),
      openInterestUsdc: BigInt(b.openInterestUsdc || 0),
      slot: b.slot ? Number(b.slot) : undefined,
    });
    res.json({ ok: true });
  });

  app.post('/copy/follow', async (req, res) => {
    const follower = String(req.body?.followerWallet || '');
    const leader = String(req.body?.leaderWallet || '');
    if (!follower || !leader) {
      return res.status(400).json({ error: 'followerWallet and leaderWallet required' });
    }
    await followLeader({
      followerWallet: follower,
      leaderWallet: leader,
      copyRatioBps: Number(req.body?.copyRatioBps || 10000),
      maxNotionalUsdc: req.body?.maxNotionalUsdc != null ? BigInt(req.body.maxNotionalUsdc) : undefined,
    });
    res.json({ ok: true });
  });

  app.delete('/copy/follow', async (req, res) => {
    const follower = String(req.query.followerWallet || req.body?.followerWallet || '');
    const leader = String(req.query.leaderWallet || req.body?.leaderWallet || '');
    const ok = await unfollowLeader(follower, leader);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  app.get('/copy/leaders/:wallet', async (req, res) => {
    const rows = await listCopyFollowers(req.params.wallet);
    res.json({ followers: rows });
  });

  app.get('/copy/following/:wallet', async (req, res) => {
    const rows = await listCopyFollowing(req.params.wallet);
    res.json({ following: rows });
  });

  app.post('/api-keys', async (req, res) => {
    const wallet = String(req.body?.wallet || '');
    if (!wallet) return res.status(400).json({ error: 'wallet required' });
    const { key, id } = await createApiKey(wallet, req.body?.label);
    res.json({ id, key, wallet, note: 'Store this key securely — shown once' });
  });

  app.get('/api-keys/verify', async (req, res) => {
    const key = String(req.headers['x-api-key'] || req.query.key || '');
    if (!key) return res.status(401).json({ valid: false });
    const result = await verifyApiKey(key);
    if (!result.valid) return res.status(401).json({ valid: false });
    res.json(result);
  });

  app.get('/history', async (req, res) => {
    const wallet = String(req.query.wallet || '');
    if (!wallet) return res.status(400).json({ error: 'wallet required' });
    const fills = await listFills(wallet, Number(req.query.limit || 50));
    res.json({ fills });
  });

  // ── Unified activity log ───────────────────────────────────────────────────
  app.get('/activity', async (req, res) => {
    const wallet = String(req.query.wallet || '');
    if (!wallet) return res.status(400).json({ error: 'wallet required' });
    const rows = await listActivity(wallet, {
      limit: Number(req.query.limit || 100),
      program: req.query.program ? String(req.query.program) : undefined,
      eventType: req.query.type ? String(req.query.type) : undefined,
    });
    res.json({ activity: rows, total: rows.length });
  });

  // Ingest endpoint — keeper/backend can push events without waiting for the
  // next slot scan (useful for low-latency activity feeds).
  app.post('/activity', async (req, res) => {
    if (!authIngest(req)) return res.status(401).json({ error: 'unauthorized' });
    const b = req.body || {};
    if (!b.signature || !b.wallet || !b.program || !b.eventType) {
      return res.status(400).json({ error: 'signature, wallet, program, eventType required' });
    }
    await insertActivity({
      signature: String(b.signature),
      wallet: String(b.wallet),
      program: String(b.program),
      eventType: String(b.eventType),
      market: b.market ? String(b.market) : undefined,
      amountUsdc: b.amountUsdc != null ? BigInt(b.amountUsdc) : undefined,
      pnlUsdc: b.pnlUsdc != null ? BigInt(b.pnlUsdc) : undefined,
      slot: b.slot != null ? Number(b.slot) : undefined,
      metadata: b.metadata ?? undefined,
    });
    res.json({ ok: true });
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(`📊 indexer API http://0.0.0.0:${port}`);
  });
}
