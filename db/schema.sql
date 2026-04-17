-- ═══════════════════════════════════════════════════════════════════════════
-- ECHO TAX RETURN ULTIMATE — Database Schema v1.0
-- SQLite WAL + FTS5 | 24 Tables | Full IRS Compliance
-- ═══════════════════════════════════════════════════════════════════════════

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000; -- 64MB cache
PRAGMA mmap_size = 268435456; -- 256MB mmap

-- ─── Core Tables ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  email TEXT,
  first_name TEXT,
  middle_name TEXT,
  last_name TEXT,
  suffix TEXT,
  ssn_encrypted BLOB,
  ssn_last4 TEXT,
  dob TEXT,
  phone TEXT,
  address_street TEXT,
  address_city TEXT,
  address_state TEXT,
  address_zip TEXT,
  filing_status TEXT CHECK(filing_status IN ('single','mfj','mfs','hoh','qss')),
  occupation TEXT,
  spouse_first_name TEXT,
  spouse_last_name TEXT,
  spouse_ssn_encrypted BLOB,
  spouse_ssn_last4 TEXT,
  spouse_dob TEXT,
  spouse_occupation TEXT,
  ip_pin TEXT,
  bank_routing_encrypted BLOB,
  bank_account_encrypted BLOB,
  bank_type TEXT CHECK(bank_type IN ('checking','savings')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tax_returns (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  tax_year INTEGER NOT NULL,
  status TEXT DEFAULT 'draft' CHECK(status IN (
    'draft','in_progress','review','calculated','locked','filed',
    'accepted','rejected','amended'
  )),
  return_type TEXT DEFAULT '1040' CHECK(return_type IN (
    '1040','1040SR','1040NR','1040X','1120','1120S','1065','1041','990'
  )),
  is_clone INTEGER DEFAULT 0,
  cloned_from TEXT,
  total_income REAL DEFAULT 0,
  adjusted_gross_income REAL DEFAULT 0,
  total_adjustments REAL DEFAULT 0,
  taxable_income REAL DEFAULT 0,
  total_tax REAL DEFAULT 0,
  total_credits REAL DEFAULT 0,
  total_payments REAL DEFAULT 0,
  total_withholding REAL DEFAULT 0,
  estimated_payments REAL DEFAULT 0,
  refund_or_owed REAL DEFAULT 0,
  effective_rate REAL DEFAULT 0,
  marginal_rate REAL DEFAULT 0,
  deduction_method TEXT CHECK(deduction_method IN ('standard','itemized')),
  standard_deduction_amount REAL DEFAULT 0,
  itemized_deduction_amount REAL DEFAULT 0,
  self_employment_tax REAL DEFAULT 0,
  amt_amount REAL DEFAULT 0,
  niit_amount REAL DEFAULT 0,
  qbi_deduction REAL DEFAULT 0,
  preparer_ptin TEXT,
  preparer_name TEXT,
  firm_ein TEXT,
  firm_name TEXT,
  efile_submission_id TEXT,
  efile_status TEXT,
  efile_accepted_at TEXT,
  efile_rejection_codes TEXT,
  self_select_pin TEXT,
  form_8879_signed INTEGER DEFAULT 0,
  locked_at TEXT,
  filed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS income_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  return_id TEXT NOT NULL REFERENCES tax_returns(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  subcategory TEXT,
  description TEXT,
  payer_name TEXT,
  payer_ein TEXT,
  amount REAL NOT NULL DEFAULT 0,
  tax_withheld REAL DEFAULT 0,
  state_withheld REAL DEFAULT 0,
  local_withheld REAL DEFAULT 0,
  form_type TEXT,
  form_line TEXT,
  state TEXT,
  document_id TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deductions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  return_id TEXT NOT NULL REFERENCES tax_returns(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  subcategory TEXT,
  description TEXT,
  amount REAL NOT NULL DEFAULT 0,
  limited_amount REAL,
  schedule TEXT,
  form_line TEXT,
  carryover_amount REAL DEFAULT 0,
  carryover_year INTEGER,
  document_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dependents (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  return_id TEXT NOT NULL REFERENCES tax_returns(id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  ssn_encrypted BLOB,
  ssn_last4 TEXT,
  relationship TEXT,
  dob TEXT,
  months_lived INTEGER DEFAULT 12,
  student INTEGER DEFAULT 0,
  disabled INTEGER DEFAULT 0,
  gross_income REAL DEFAULT 0,
  qualifies_ctc INTEGER DEFAULT 0,
  qualifies_odc INTEGER DEFAULT 0,
  qualifies_eic INTEGER DEFAULT 0,
  qualifies_dependent_care INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  return_id TEXT NOT NULL REFERENCES tax_returns(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  issuer_name TEXT,
  file_path TEXT,
  file_size INTEGER,
  file_hash TEXT,
  mime_type TEXT,
  ocr_status TEXT DEFAULT 'pending' CHECK(ocr_status IN ('pending','processing','complete','failed')),
  ocr_extracted_data TEXT,
  ocr_confidence REAL,
  status TEXT DEFAULT 'uploaded' CHECK(status IN ('uploaded','verified','rejected')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- ─── E-File Tables ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS efile_submissions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  return_id TEXT NOT NULL REFERENCES tax_returns(id),
  submission_id TEXT UNIQUE,
  transmission_timestamp TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN (
    'pending','queued','transmitted','accepted','rejected','error'
  )),
  xml_content TEXT,
  xml_hash TEXT,
  ack_timestamp TEXT,
  ack_status TEXT,
  rejection_codes TEXT,
  rejection_details TEXT,
  auto_fix_applied TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  state_code TEXT,
  is_state_return INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS efile_rejections (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  submission_id TEXT NOT NULL REFERENCES efile_submissions(id),
  error_code TEXT NOT NULL,
  error_description TEXT,
  severity TEXT CHECK(severity IN ('critical','high','medium','low')),
  auto_fixable INTEGER DEFAULT 0,
  auto_fix_action TEXT,
  user_action TEXT,
  irs_resolution_path TEXT,
  resolved INTEGER DEFAULT 0,
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ─── Engine Tables ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS engine_queries (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  return_id TEXT REFERENCES tax_returns(id),
  client_id TEXT REFERENCES clients(id),
  engine_id TEXT NOT NULL,
  query_text TEXT NOT NULL,
  response_text TEXT,
  response_json TEXT,
  response_layer TEXT CHECK(response_layer IN ('doctrine_cache','semantic','claude_deep')),
  latency_ms INTEGER,
  confidence TEXT CHECK(confidence IN ('DEFENSIBLE','AGGRESSIVE','DISCLOSURE','HIGH_RISK')),
  citations TEXT,
  model_used TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS doctrine_blocks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  engine_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  keywords TEXT NOT NULL,
  conclusion_template TEXT NOT NULL,
  reasoning_framework TEXT NOT NULL,
  key_factors TEXT,
  primary_authority TEXT,
  burden_holder TEXT,
  adversary_position TEXT,
  counter_arguments TEXT,
  resolution_strategy TEXT,
  entity_scope TEXT,
  confidence TEXT DEFAULT 'DEFENSIBLE',
  confidence_stratification TEXT,
  controlling_precedent TEXT,
  version INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ─── Tax Reference Tables ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tax_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tax_year INTEGER NOT NULL,
  table_type TEXT NOT NULL,
  filing_status TEXT,
  data TEXT NOT NULL,
  effective_date TEXT,
  source TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tax_year, table_type, filing_status)
);

CREATE TABLE IF NOT EXISTS irc_authority (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL,
  title TEXT NOT NULL,
  full_text TEXT,
  regulations TEXT,
  case_law TEXT,
  revenue_rulings TEXT,
  revenue_procedures TEXT,
  notices TEXT,
  authority_weight INTEGER DEFAULT 50,
  last_amended TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS irc_authority_fts USING fts5(
  section, title, full_text, regulations, case_law, revenue_rulings,
  content='irc_authority', content_rowid='rowid'
);

-- ─── Compliance Tables ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS compliance_checks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  return_id TEXT NOT NULL REFERENCES tax_returns(id),
  check_type TEXT NOT NULL,
  rule_id TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','passed','failed','overridden','warning')),
  details TEXT,
  override_reason TEXT,
  override_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_trail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id TEXT,
  client_id TEXT,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details TEXT,
  ip_address TEXT,
  user_agent TEXT,
  prev_hash TEXT,
  hash TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);

-- ─── Firm / Professional Tables ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS firms (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  ein TEXT,
  efin TEXT,
  ptin TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  subscription_tier TEXT DEFAULT 'professional',
  branding_config TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS preparers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  firm_id TEXT REFERENCES firms(id),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  ptin TEXT,
  designation TEXT CHECK(designation IN ('CPA','EA','attorney','AFSP','unenrolled')),
  permissions TEXT,
  hourly_rate REAL,
  cpe_hours_ytd REAL DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS return_assignments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  return_id TEXT NOT NULL REFERENCES tax_returns(id),
  preparer_id TEXT REFERENCES preparers(id),
  reviewer_id TEXT REFERENCES preparers(id),
  signer_id TEXT REFERENCES preparers(id),
  status TEXT DEFAULT 'assigned' CHECK(status IN (
    'assigned','in_progress','review','approved','signed','filed'
  )),
  assigned_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  time_spent_minutes INTEGER DEFAULT 0,
  notes TEXT
);

-- ─── Billing Tables ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  tier TEXT NOT NULL CHECK(tier IN ('free','pro','business','professional','enterprise')),
  status TEXT DEFAULT 'active' CHECK(status IN ('active','canceled','past_due','trialing')),
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER,
  response_time_ms INTEGER,
  timestamp TEXT DEFAULT (datetime('now'))
);

-- ─── Correspondence Tables ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS irs_correspondence (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  notice_type TEXT,
  received_date TEXT,
  due_date TEXT,
  original_document TEXT,
  ocr_extracted TEXT,
  ai_draft_response TEXT,
  final_response TEXT,
  status TEXT DEFAULT 'received' CHECK(status IN (
    'received','drafting','reviewed','sent','resolved'
  )),
  resolution TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ─── Indexes ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_clients_user ON clients(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
CREATE INDEX IF NOT EXISTS idx_returns_client ON tax_returns(client_id);
CREATE INDEX IF NOT EXISTS idx_returns_year ON tax_returns(tax_year);
CREATE INDEX IF NOT EXISTS idx_returns_status ON tax_returns(status);
CREATE INDEX IF NOT EXISTS idx_returns_type ON tax_returns(return_type);
CREATE INDEX IF NOT EXISTS idx_income_return ON income_items(return_id);
CREATE INDEX IF NOT EXISTS idx_income_category ON income_items(category);
CREATE INDEX IF NOT EXISTS idx_deductions_return ON deductions(return_id);
CREATE INDEX IF NOT EXISTS idx_deductions_category ON deductions(category);
CREATE INDEX IF NOT EXISTS idx_dependents_return ON dependents(return_id);
CREATE INDEX IF NOT EXISTS idx_documents_return ON documents(return_id);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_efile_return ON efile_submissions(return_id);
CREATE INDEX IF NOT EXISTS idx_efile_status ON efile_submissions(status);
CREATE INDEX IF NOT EXISTS idx_engine_return ON engine_queries(return_id);
CREATE INDEX IF NOT EXISTS idx_engine_id ON engine_queries(engine_id);
CREATE INDEX IF NOT EXISTS idx_engine_layer ON engine_queries(response_layer);
CREATE INDEX IF NOT EXISTS idx_doctrine_engine ON doctrine_blocks(engine_id);
CREATE INDEX IF NOT EXISTS idx_doctrine_active ON doctrine_blocks(active);
CREATE INDEX IF NOT EXISTS idx_compliance_return ON compliance_checks(return_id);
CREATE INDEX IF NOT EXISTS idx_audit_return ON audit_trail(return_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_trail(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_trail(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_trail(action);
CREATE INDEX IF NOT EXISTS idx_firms_active ON firms(active);
CREATE INDEX IF NOT EXISTS idx_preparers_firm ON preparers(firm_id);
CREATE INDEX IF NOT EXISTS idx_assignments_return ON return_assignments(return_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tier ON subscriptions(tier);
CREATE INDEX IF NOT EXISTS idx_usage_user ON api_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON api_usage(timestamp);
CREATE INDEX IF NOT EXISTS idx_correspondence_client ON irs_correspondence(client_id);
CREATE INDEX IF NOT EXISTS idx_irc_section ON irc_authority(section);
CREATE INDEX IF NOT EXISTS idx_tax_tables_year ON tax_tables(tax_year, table_type);
