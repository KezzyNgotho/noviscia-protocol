-- 001: Initial schema
-- Applied: 2026-08-22
-- Description: Baseline tables extracted from db.ts initDb()

BEGIN;

-- ── Perps fills ──────────────────────────────────────────────────────────
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

-- ── Perps limit orders ──────────────────────────────────────────────────
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
  twap_slices INT,
  twap_slices_filled INT DEFAULT 0,
  twap_interval_secs INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_perps_orders_wallet ON perps_orders(wallet);
CREATE INDEX IF NOT EXISTS idx_perps_orders_status ON perps_orders(status);

-- ── Oracle price ticks ──────────────────────────────────────────────────
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

-- ── Copy trading followers ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS copy_followers (
  id SERIAL PRIMARY KEY,
  follower_wallet TEXT NOT NULL,
  leader_wallet TEXT NOT NULL,
  copy_ratio_bps INT NOT NULL DEFAULT 10000,
  max_notional_usdc BIGINT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(follower_wallet, leader_wallet)
);
CREATE INDEX IF NOT EXISTS idx_copy_leader ON copy_followers(leader_wallet) WHERE active;

-- ── API keys ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  wallet TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  rate_limit_per_min INT NOT NULL DEFAULT 120,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_wallet ON api_keys(wallet);

-- ── User activity log ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_activity (
  id BIGSERIAL PRIMARY KEY,
  signature TEXT NOT NULL,
  wallet TEXT NOT NULL,
  program TEXT NOT NULL,
  event_type TEXT NOT NULL,
  market TEXT,
  amount_usdc BIGINT,
  pnl_usdc BIGINT,
  slot BIGINT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (signature, event_type)
);
CREATE INDEX IF NOT EXISTS idx_user_activity_wallet ON user_activity(wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_program ON user_activity(program, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_type ON user_activity(event_type, created_at DESC);

-- ── Migration tracking ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS _migrations (
  id INT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO _migrations (id, name) VALUES (1, '001_initial_schema')
  ON CONFLICT (id) DO NOTHING;

COMMIT;
