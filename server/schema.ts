export const schema = [
  `CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY, username VARCHAR(64) NOT NULL UNIQUE, display_name VARCHAR(120) NOT NULL,
    password_hash VARCHAR(255) NOT NULL, role VARCHAR(16) NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    mfa_secret TEXT, mfa_pending TEXT, mfa_enabled INTEGER NOT NULL DEFAULT 0, mfa_last_step BIGINT NOT NULL DEFAULT 0,
    must_change_password INTEGER NOT NULL DEFAULT 1, created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS login_challenges (
    token_hash VARCHAR(64) PRIMARY KEY, user_id VARCHAR(36) NOT NULL,
    expires_at BIGINT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS web_sessions (
    id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(36) NOT NULL, csrf_token VARCHAR(64) NOT NULL,
    expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS recovery_codes (
    code_hash VARCHAR(64) PRIMARY KEY, user_id VARCHAR(36) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS assets (
    id VARCHAR(36) PRIMARY KEY, name VARCHAR(120) NOT NULL, host VARCHAR(45) NOT NULL,
    port INTEGER NOT NULL, protocol VARCHAR(8) NOT NULL, os VARCHAR(16) NOT NULL,
    group_name VARCHAR(80) NOT NULL, description TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    username VARCHAR(120) NOT NULL, domain_name VARCHAR(120) NOT NULL DEFAULT '', secret TEXT NOT NULL,
    host_key TEXT, ignore_cert INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS grants (
    id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL, asset_id VARCHAR(36) NOT NULL,
    expires_at BIGINT, created_at BIGINT NOT NULL, UNIQUE(user_id, asset_id),
    FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (asset_id) REFERENCES assets(id)
  )`,
  `CREATE TABLE IF NOT EXISTS remote_sessions (
    id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL, asset_id VARCHAR(36) NOT NULL,
    web_session_id VARCHAR(64) NOT NULL, ticket_hash VARCHAR(64) UNIQUE, ticket_expires_at BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL, source_ip VARCHAR(64) NOT NULL, requested_at BIGINT NOT NULL,
    started_at BIGINT, ended_at BIGINT, end_reason VARCHAR(80), recording_available INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (asset_id) REFERENCES assets(id)
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id VARCHAR(36) PRIMARY KEY, actor_id VARCHAR(36), actor_name VARCHAR(64) NOT NULL,
    action VARCHAR(64) NOT NULL, resource_id VARCHAR(120), source_ip VARCHAR(64) NOT NULL,
    details TEXT NOT NULL, created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS gateway_guard (id INTEGER PRIMARY KEY, touched BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS auth_throttle (
    id VARCHAR(64) PRIMARY KEY, failures INTEGER NOT NULL, blocked_until BIGINT NOT NULL, updated_at BIGINT NOT NULL
  )`,
];

export const indexes = [
  "CREATE INDEX idx_remote_user ON remote_sessions(user_id, requested_at)",
  "CREATE INDEX idx_remote_status ON remote_sessions(status, ticket_expires_at)",
  "CREATE INDEX idx_audit_created ON audit_events(created_at)",
  "CREATE INDEX idx_audit_actor ON audit_events(actor_id, created_at)",
  "CREATE INDEX idx_web_expiry ON web_sessions(expires_at)",
];
