-- ガバナンス強化（バックログ B-02/B-03/B-04/B-09/B-11 スタブ・設定コード）
-- D1 (SQLite) とローカルSQLiteの両方で動作する共通SQL
-- 注意: system-automation サービスアカウントは src/seed.ts で投入する
-- （seedAll の冪等性チェックが users テーブル件数に依存するため、マイグレーションでは投入しない）

-- B-09: 四半期アクセス再認証
CREATE TABLE IF NOT EXISTS access_certifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  cycle TEXT NOT NULL,
  certified_by TEXT NOT NULL REFERENCES users(id),
  certified_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_access_certifications_user ON access_certifications(user_id, expires_at);

-- B-09: 緊急権限付与（期限切れは自動失効の対象）
CREATE TABLE IF NOT EXISTS emergency_access_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  permission TEXT NOT NULL,
  reason TEXT NOT NULL,
  granted_by TEXT NOT NULL REFERENCES users(id),
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  revoked_by TEXT REFERENCES users(id),
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_emergency_grants_user ON emergency_access_grants(user_id, status);
CREATE INDEX IF NOT EXISTS idx_emergency_grants_expires ON emergency_access_grants(status, expires_at);

-- B-03: 通知配送・再送・DLQ記録（実メールプロバイダ接続前の下地）
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications(id),
  channel TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_notification ON notification_deliveries(notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status ON notification_deliveries(status);

-- B-11: 通知の高度化（エスカレーション記録）
ALTER TABLE notifications ADD COLUMN escalated_at TEXT;
ALTER TABLE notifications ADD COLUMN escalated_to TEXT REFERENCES users(id);

-- B-04: 正本外部連携（Webhook受信・送信の記録。実接続先は環境変数で設定）
CREATE TABLE IF NOT EXISTS external_connector_events (
  id TEXT PRIMARY KEY,
  connector TEXT NOT NULL,
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_external_connector_events_connector ON external_connector_events(connector, created_at);

-- B-02: OIDC/SSOログイン試行の一時相関（state/PKCE code_verifier）。短時間で失効する
CREATE TABLE IF NOT EXISTS oidc_login_attempts (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL UNIQUE,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_oidc_login_attempts_state ON oidc_login_attempts(state);
