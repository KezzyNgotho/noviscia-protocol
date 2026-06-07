import { Pool } from 'pg';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://noviscia:noviscia-dev-password@localhost:5432/novisca',
});

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS perps_fills (
      id SERIAL PRIMARY KEY,
      signature TEXT NOT NULL UNIQUE,
      wallet TEXT NOT NULL,
      market TEXT NOT NULL,
      side TEXT NOT NULL,
      event_type TEXT NOT NULL,
      notional_usdc BIGINT DEFAULT 0,
      pnl_usdc BIGINT DEFAULT 0,
      fee_usdc BIGINT DEFAULT 0,
      slot BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_perps_fills_wallet ON perps_fills(wallet);
    CREATE INDEX IF NOT EXISTS idx_perps_fills_market ON perps_fills(market);

    CREATE TABLE IF NOT EXISTS perps_orders (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      market TEXT NOT NULL,
      side TEXT NOT NULL,
      order_type TEXT NOT NULL DEFAULT 'limit',
      limit_price BIGINT NOT NULL,
      collateral_usdc BIGINT NOT NULL,
      leverage INT NOT NULL DEFAULT 1,
      reduce_only BOOLEAN NOT NULL DEFAULT FALSE,
      close_bps INT,
      status TEXT NOT NULL DEFAULT 'pending',
      trigger_price BIGINT,
      filled_signature TEXT,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_perps_orders_wallet ON perps_orders(wallet);
    CREATE INDEX IF NOT EXISTS idx_perps_orders_status ON perps_orders(status);

    CREATE TABLE IF NOT EXISTS perps_oracle_ticks (
      id SERIAL PRIMARY KEY,
      market TEXT NOT NULL,
      mark_price BIGINT NOT NULL,
      index_price BIGINT NOT NULL,
      funding_rate_bps INT DEFAULT 0,
      open_interest_usdc BIGINT DEFAULT 0,
      slot BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_oracle_ticks_market_ts ON perps_oracle_ticks(market, created_at DESC);
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
}) {
  await pool.query(
    `INSERT INTO perps_orders
      (id, wallet, market, side, order_type, limit_price, collateral_usdc, leverage, reduce_only, close_bps, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
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
     WHERE id = $1 AND wallet = $2 AND status IN ('pending','fillable')`,
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
