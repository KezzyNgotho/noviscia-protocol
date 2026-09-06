-- 002: API key scope + audit
-- Description: Add an authorization scope to each key and track last usage, so a
-- token can be issued read-only vs. privileged and its activity can be audited.

BEGIN;

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'read';
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_api_keys_scope ON api_keys(scope) WHERE NOT revoked;

INSERT INTO _migrations (id, name) VALUES (2, '002_api_key_scope')
  ON CONFLICT (id) DO NOTHING;

COMMIT;
