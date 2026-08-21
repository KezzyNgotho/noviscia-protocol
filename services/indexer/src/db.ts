import { createHash, randomBytes } from 'crypto';
import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
});

export async function initDb(): Promise<void> {
  // Ensure the migrations table exists, then apply any pending .sql files.
  // The actual schema lives in migrations/*.sql — this keeps a single source of truth.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // If _migrations is empty, this is a fresh DB — run all migration SQL files
  // via the migrate.ts runner.  For existing DBs that were already initialised
  // with the old inline DDL, the runner will only apply new migrations.
  const { execSync } = require('child_process');
  const path = require('path');
  const migrateScript = path.join(__dirname, '..', 'migrations', 'migrate.ts');
  try {
    execSync(`npx tsx "${migrateScript}"`, {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL! },
      timeout: 30_000,
    });
  } catch {
    // migrate.ts may fail if run from within the container without tsx —
    // fall back to the inline baseline (idempotent CREATE TABLE IF NOT EXISTS)
    console.warn('[db] migrate.ts failed, falling back to inline schema baseline');
    await inlineBaseline();
  }
}

/** Fallback: idempotent schema creation for environments without tsx. */
async function inlineBaseline(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS perps_fills (
      id SERIAL PRIMARY KEY, signature TEXT NOT NULL UNIQUE,
      wallet TEXT NOT NULL, market TEXT NOT NULL, side TEXT NOT NULL,
      event_type TEXT NOT NULL, notional_usdc BIGINT DEFAULT 0,
      pnl_usdc BIGINT DEFAULT 0, fee_usdc BIGINT DEFAULT 0,
      slot BIGINT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_perps_fills_wallet ON perps_fills(wallet);
    CREATE INDEX IF NOT EXISTS idx_perps_fills_market ON perps_fills(market);

    CREATE TABLE IF NOT EXISTS perps_orders (
      id TEXT PRIMARY KEY, wallet TEXT NOT NULL, market TEXT NOT NULL,
      side TEXT NOT NULL, order_type TEXT NOT NULL DEFAULT 'limit',
      limit_price BIGINT NOT NULL, collateral_usdc BIGINT NOT NULL,
      leverage INT NOT NULL DEFAULT 1, reduce_only BOOLEAN NOT NULL DEFAULT FALSE,
      close_bps INT, status TEXT NOT NULL DEFAULT 'pending',
      trigger_price BIGINT, filled_signature TEXT, expires_at TIMESTAMPTZ,
      twap_slices INT, twap_slices_filled INT DEFAULT 0, twap_interval_secs INT,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_perps_orders_wallet ON perps_orders(wallet);
    CREATE INDEX IF NOT EXISTS idx_perps_orders_status ON perps_orders(status);

    CREATE TABLE IF NOT EXISTS perps_oracle_ticks (
      id SERIAL PRIMARY KEY, market TEXT NOT NULL,
      mark_price BIGINT NOT NULL, index_price BIGINT NOT NULL,
      funding_rate_bps INT DEFAULT 0, open_interest_usdc BIGINT DEFAULT 0,
      slot BIGINT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_oracle_ticks_market_ts ON perps_oracle_ticks(market, created_at DESC);

    CREATE TABLE IF NOT EXISTS copy_followers (
      id SERIAL PRIMARY KEY, follower_wallet TEXT NOT NULL, leader_wallet TEXT NOT NULL,
      copy_ratio_bps INT NOT NULL DEFAULT 10000, max_notional_usdc BIGINT,
      active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(follower_wallet, leader_wallet)
    );
    CREATE INDEX IF NOT EXISTS idx_copy_leader ON copy_followers(leader_wallet) WHERE active;

    CREATE TABLE IF NOT EXISTS api_keys (
      id SERIAL PRIMARY KEY, wallet TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE,
      label TEXT, rate_limit_per_min INT NOT NULL DEFAULT 120,
      revoked BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_wallet ON api_keys(wallet);

    CREATE TABLE IF NOT EXISTS user_activity (
      id BIGSERIAL PRIMARY KEY, signature TEXT NOT NULL, wallet TEXT NOT NULL,
      program TEXT NOT NULL, event_type TEXT NOT NULL, market TEXT,
      amount_usdc BIGINT, pnl_usdc BIGINT, slot BIGINT, metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (signature, event_type)
    );
    CREATE INDEX IF NOT EXISTS idx_user_activity_wallet ON user_activity(wallet, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_activity_program ON user_activity(program, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_activity_type ON user_activity(event_type, created_at DESC);
  `);
}

export { pool };

export type PerpsOrderRow = {
  id: string;
  wallet: string;
  market: string;
  side: string;
  order_type: string;
  limit_price: string;
  collateral_usdc: string;
  leverage: number;
  reduce_only: boolean;
  close_bps: number | null;
  status: string;
  trigger_price: string | null;
  filled_signature: string | null;
  expires_at: Date | null;
  twap_slices: number | null;
  twap_slices_filled: number | null;
  twap_interval_secs: number | null;
  created_at: Date;
  updated_at: Date;
};

export async function insertFill(row: {
  signature: string;
  wallet: string;
  market: string;
  side: string;
  eventType: string;
  notionalUsdc?: bigint;
  pnlUsdc?: bigint;
  feeUsdc?: bigint;
  slot?: number;
}) {
  await pool.query(
    `INSERT INTO perps_fills (signature, wallet, market, side, event_type, notional_usdc, pnl_usdc, fee_usdc, slot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (signature) DO NOTHING`,
    [
      row.signature,
      row.wallet,
      row.market,
      row.side,
      row.eventType,
      row.notionalUsdc?.toString() ?? '0',
      row.pnlUsdc?.toString() ?? '0',
      row.feeUsdc?.toString() ?? '0',
      row.slot ?? null,
    ]
  );
}

export async function createOrder(row: {
  id: string;
  wallet: string;
  market: string;
  side: string;
  orderType: string;
  limitPrice: bigint;
  collateralUsdc: bigint;
  leverage: number;
  reduceOnly: boolean;
  closeBps?: number;
  expiresAt?: Date;
  twapSlices?: number;
  twapIntervalSecs?: number;
}) {
  const isTwap = row.orderType === 'twap' && row.twapSlices && row.twapIntervalSecs;
  await pool.query(
    `INSERT INTO perps_orders
      (id, wallet, market, side, order_type, limit_price, collateral_usdc, leverage, reduce_only, close_bps, expires_at,
       twap_slices, twap_interval_secs, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      row.id,
      row.wallet,
      row.market,
      row.side,
      row.orderType,
      row.limitPrice.toString(),
      row.collateralUsdc.toString(),
      row.leverage,
      row.reduceOnly,
      row.closeBps ?? null,
      row.expiresAt ?? null,
      row.twapSlices ?? null,
      row.twapIntervalSecs ?? null,
      isTwap ? 'twap_active' : 'pending',
    ]
  );
}

export async function listOrders(wallet: string, status?: string): Promise<PerpsOrderRow[]> {
  const q = status
    ? `SELECT * FROM perps_orders WHERE wallet = $1 AND status = $2 ORDER BY created_at DESC LIMIT 100`
    : `SELECT * FROM perps_orders WHERE wallet = $1 ORDER BY created_at DESC LIMIT 100`;
  const params = status ? [wallet, status] : [wallet];
  const res = await pool.query<PerpsOrderRow>(q, params);
  return res.rows;
}

export async function listPendingOrders(): Promise<PerpsOrderRow[]> {
  const res = await pool.query<PerpsOrderRow>(
    `SELECT * FROM perps_orders WHERE status IN ('pending','fillable') ORDER BY created_at ASC`
  );
  return res.rows;
}

export async function listActiveTwapOrders(): Promise<PerpsOrderRow[]> {
  const res = await pool.query<PerpsOrderRow>(
    `SELECT * FROM perps_orders
     WHERE order_type = 'twap' AND status IN ('twap_active','pending')
       AND twap_slices IS NOT NULL AND twap_slices_filled < twap_slices
     ORDER BY created_at ASC`
  );
  return res.rows;
}

export async function advanceTwapSlice(id: string, sliceIndex: number): Promise<void> {
  const res = await pool.query<PerpsOrderRow>(`SELECT * FROM perps_orders WHERE id = $1`, [id]);
  const row = res.rows[0];
  if (!row?.twap_slices) return;
  const filled = Math.min(sliceIndex, row.twap_slices);
  const status = filled >= row.twap_slices ? 'filled' : 'twap_active';
  await pool.query(
    `UPDATE perps_orders SET twap_slices_filled = $2, status = $3, updated_at = NOW() WHERE id = $1`,
    [id, filled, status]
  );
}

export async function updateOrderStatus(
  id: string,
  status: string,
  extra?: { triggerPrice?: bigint; filledSignature?: string }
) {
  await pool.query(
    `UPDATE perps_orders SET status = $2, trigger_price = COALESCE($3, trigger_price),
     filled_signature = COALESCE($4, filled_signature), updated_at = NOW() WHERE id = $1`,
    [id, status, extra?.triggerPrice?.toString() ?? null, extra?.filledSignature ?? null]
  );
}

export async function cancelOrder(id: string, wallet: string): Promise<boolean> {
  const res = await pool.query(
    `UPDATE perps_orders SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND wallet = $2 AND status IN ('pending','fillable','twap_active')`,
    [id, wallet]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function listFills(wallet: string, limit = 50) {
  const res = await pool.query(
    `SELECT * FROM perps_fills WHERE wallet = $1 ORDER BY created_at DESC LIMIT $2`,
    [wallet, limit]
  );
  return res.rows;
}

// ── User activity log ──────────────────────────────────────────────────────────

export type ActivityRow = {
  id: string;
  signature: string;
  wallet: string;
  program: string;
  event_type: string;
  market: string | null;
  amount_usdc: string | null;
  pnl_usdc: string | null;
  slot: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
};

export async function insertActivity(row: {
  signature: string;
  wallet: string;
  program: string;
  eventType: string;
  market?: string;
  amountUsdc?: bigint;
  pnlUsdc?: bigint;
  slot?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await pool.query(
    `INSERT INTO user_activity
       (signature, wallet, program, event_type, market, amount_usdc, pnl_usdc, slot, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (signature, event_type) DO NOTHING`,
    [
      row.signature,
      row.wallet,
      row.program,
      row.eventType,
      row.market ?? null,
      row.amountUsdc != null ? row.amountUsdc.toString() : null,
      row.pnlUsdc != null ? row.pnlUsdc.toString() : null,
      row.slot ?? null,
      row.metadata != null ? JSON.stringify(row.metadata) : null,
    ]
  );
}

export async function listActivity(
  wallet: string,
  opts: { limit?: number; program?: string; eventType?: string } = {}
): Promise<ActivityRow[]> {
  const { limit = 100, program, eventType } = opts;
  const conditions: string[] = ['wallet = $1'];
  const params: unknown[] = [wallet];
  if (program) { conditions.push(`program = $${params.push(program)}`); }
  if (eventType) { conditions.push(`event_type = $${params.push(eventType)}`); }
  params.push(limit);
  const res = await pool.query<ActivityRow>(
    `SELECT * FROM user_activity WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  return res.rows;
}

export async function insertOracleTick(row: {
  market: string;
  markPrice: bigint;
  indexPrice: bigint;
  fundingRateBps: number;
  openInterestUsdc: bigint;
  slot?: number;
}) {
  await pool.query(
    `INSERT INTO perps_oracle_ticks (market, mark_price, index_price, funding_rate_bps, open_interest_usdc, slot)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      row.market,
      row.markPrice.toString(),
      row.indexPrice.toString(),
      row.fundingRateBps,
      row.openInterestUsdc.toString(),
      row.slot ?? null,
    ]
  );
}

export async function followLeader(row: {
  followerWallet: string;
  leaderWallet: string;
  copyRatioBps: number;
  maxNotionalUsdc?: bigint;
}) {
  await pool.query(
    `INSERT INTO copy_followers (follower_wallet, leader_wallet, copy_ratio_bps, max_notional_usdc)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (follower_wallet, leader_wallet)
     DO UPDATE SET copy_ratio_bps = $3, max_notional_usdc = $4, active = TRUE`,
    [
      row.followerWallet,
      row.leaderWallet,
      row.copyRatioBps,
      row.maxNotionalUsdc?.toString() ?? null,
    ]
  );
}

export async function unfollowLeader(followerWallet: string, leaderWallet: string): Promise<boolean> {
  const res = await pool.query(
    `UPDATE copy_followers SET active = FALSE WHERE follower_wallet = $1 AND leader_wallet = $2`,
    [followerWallet, leaderWallet]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function listCopyFollowers(leaderWallet: string) {
  const res = await pool.query(
    `SELECT follower_wallet, copy_ratio_bps, max_notional_usdc, created_at
     FROM copy_followers WHERE leader_wallet = $1 AND active ORDER BY created_at DESC`,
    [leaderWallet]
  );
  return res.rows;
}

export async function listCopyFollowing(followerWallet: string) {
  const res = await pool.query(
    `SELECT leader_wallet, copy_ratio_bps, max_notional_usdc, created_at
     FROM copy_followers WHERE follower_wallet = $1 AND active ORDER BY created_at DESC`,
    [followerWallet]
  );
  return res.rows;
}

export async function createApiKey(wallet: string, label?: string): Promise<{ key: string; id: number }> {
  const key = `nvk_${randomBytes(24).toString('hex')}`;
  const keyHash = createHash('sha256').update(key).digest('hex');
  const res = await pool.query<{ id: number }>(
    `INSERT INTO api_keys (wallet, key_hash, label) VALUES ($1,$2,$3) RETURNING id`,
    [wallet, keyHash, label ?? null]
  );
  return { key, id: res.rows[0].id };
}

export async function verifyApiKey(key: string): Promise<{ valid: boolean; wallet?: string; rateLimit?: number }> {
  const keyHash = createHash('sha256').update(key).digest('hex');
  const res = await pool.query<{ wallet: string; rate_limit_per_min: number }>(
    `SELECT wallet, rate_limit_per_min FROM api_keys WHERE key_hash = $1 AND NOT revoked`,
    [keyHash]
  );
  if (!res.rows[0]) return { valid: false };
  return {
    valid: true,
    wallet: res.rows[0].wallet,
    rateLimit: res.rows[0].rate_limit_per_min,
  };
}
