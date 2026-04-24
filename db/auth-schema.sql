-- ═══════════════════════════════════════════════════════════════════════════
-- ECHO TAX RETURN ULTIMATE — Auth & Memory Schema
-- Adds: user_accounts, oauth_accounts, otp_codes, user_sessions, claude_memory
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_accounts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT UNIQUE,
  email_verified_at TEXT,
  phone TEXT UNIQUE,
  phone_verified_at TEXT,
  name TEXT,
  image_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT,
  login_count INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','preparer','admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','deleted'))
);

CREATE INDEX IF NOT EXISTS idx_user_accounts_email ON user_accounts(email);
CREATE INDEX IF NOT EXISTS idx_user_accounts_phone ON user_accounts(phone);

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('google','microsoft','apple','github')),
  provider_account_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TEXT,
  scope TEXT,
  id_token TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts(user_id);

CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  identifier TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('email','sms')),
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_otp_identifier ON otp_codes(identifier, channel, consumed_at);
CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_codes(expires_at);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash);

CREATE TABLE IF NOT EXISTS claude_memory (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  return_id TEXT REFERENCES tax_returns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('conversation','decision','fact','preference','document_summary','answer','reasoning')),
  content TEXT NOT NULL,
  embedding BLOB,
  importance INTEGER NOT NULL DEFAULT 5 CHECK(importance BETWEEN 1 AND 10),
  tags TEXT,
  metadata TEXT,
  accessed_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_claude_memory_user ON claude_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_claude_memory_return ON claude_memory(return_id);
CREATE INDEX IF NOT EXISTS idx_claude_memory_kind ON claude_memory(kind);
CREATE INDEX IF NOT EXISTS idx_claude_memory_importance ON claude_memory(importance);

CREATE VIRTUAL TABLE IF NOT EXISTS claude_memory_fts USING fts5(
  content, tags,
  content='claude_memory',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS claude_memory_ai AFTER INSERT ON claude_memory BEGIN
  INSERT INTO claude_memory_fts(rowid, content, tags) VALUES (new.rowid, new.content, COALESCE(new.tags,''));
END;
CREATE TRIGGER IF NOT EXISTS claude_memory_ad AFTER DELETE ON claude_memory BEGIN
  INSERT INTO claude_memory_fts(claude_memory_fts, rowid, content, tags) VALUES('delete', old.rowid, old.content, COALESCE(old.tags,''));
END;
CREATE TRIGGER IF NOT EXISTS claude_memory_au AFTER UPDATE ON claude_memory BEGIN
  INSERT INTO claude_memory_fts(claude_memory_fts, rowid, content, tags) VALUES('delete', old.rowid, old.content, COALESCE(old.tags,''));
  INSERT INTO claude_memory_fts(rowid, content, tags) VALUES (new.rowid, new.content, COALESCE(new.tags,''));
END;

CREATE TABLE IF NOT EXISTS auth_audit_log (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT REFERENCES user_accounts(id) ON DELETE SET NULL,
  event TEXT NOT NULL,
  channel TEXT,
  identifier TEXT,
  ip_address TEXT,
  user_agent TEXT,
  success INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_user ON auth_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_audit_event ON auth_audit_log(event);
CREATE INDEX IF NOT EXISTS idx_auth_audit_time ON auth_audit_log(created_at);
