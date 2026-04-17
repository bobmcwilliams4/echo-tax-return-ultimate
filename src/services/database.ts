// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Database Service
// Bun native SQLite (bun:sqlite) | WAL + FTS5 | Zero-dependency
// ═══════════════════════════════════════════════════════════════════════════

import { Database } from 'bun:sqlite';
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../utils/logger';

const log = createLogger('database');

const DB_PATH = process.env.DATABASE_PATH || join(process.cwd(), 'data', 'returns.db');

export function createDatabase(): Database {
  // Ensure data directory exists
  const dir = join(DB_PATH, '..');
  try { mkdirSync(dir, { recursive: true }); } catch { /* exists */ }

  const db = new Database(DB_PATH, { create: true });

  // WAL mode for concurrent reads + single writer
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA cache_size = -64000');
  db.exec('PRAGMA mmap_size = 268435456');
  db.exec('PRAGMA temp_store = MEMORY');

  log.info({ path: DB_PATH }, 'Database opened in WAL mode');

  // Run schema
  try {
    const schemaPath = join(process.cwd(), 'db', 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
    log.info('Schema applied successfully');
  } catch (err) {
    log.warn({ err }, 'Schema application skipped (may already exist)');
  }

  return db;
}

// ─── Query Helpers ──────────────────────────────────────────────────────

export function getById<T>(db: Database, table: string, id: string): T | undefined {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as T | undefined;
}

export function listPaginated<T>(
  db: Database,
  table: string,
  params: { page: number; limit: number; where?: string; orderBy?: string; args?: unknown[] },
): { data: T[]; total: number; page: number; limit: number } {
  const { page, limit, where, orderBy, args } = params;
  const offset = (page - 1) * limit;
  const whereClause = where ? `WHERE ${where}` : '';
  const orderClause = orderBy ? `ORDER BY ${orderBy}` : 'ORDER BY created_at DESC';

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM ${table} ${whereClause}`).get(...(args || [])) as { count: number };
  const data = db.prepare(`SELECT * FROM ${table} ${whereClause} ${orderClause} LIMIT ? OFFSET ?`).all(...(args || []), limit, offset) as T[];

  return { data, total: countRow.count, page, limit };
}

export function insert(db: Database, table: string, data: Record<string, unknown>): string {
  const id = data.id as string || crypto.randomUUID().replace(/-/g, '');
  const fields = Object.keys(data);
  const values = fields.map(f => data[f]);

  if (!fields.includes('id')) {
    fields.unshift('id');
    values.unshift(id);
  }

  db.prepare(`INSERT INTO ${table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`).run(...values);
  return id;
}

export function update(db: Database, table: string, id: string, data: Record<string, unknown>): boolean {
  const fields = Object.keys(data).filter(k => k !== 'id');
  if (fields.length === 0) return false;

  const sets = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => data[f]);

  const result = db.prepare(`UPDATE ${table} SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
  return result.changes > 0;
}

export function remove(db: Database, table: string, id: string): boolean {
  const result = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  return result.changes > 0;
}

// ─── Audit Trail ────────────────────────────────────────────────────────

export function logAudit(
  db: Database,
  params: {
    return_id?: string;
    client_id?: string;
    user_id: string;
    action: string;
    entity_type?: string;
    entity_id?: string;
    details?: Record<string, unknown>;
    ip_address?: string;
    user_agent?: string;
  },
): void {
  // Get previous hash for chain
  const lastEntry = db.prepare('SELECT hash FROM audit_trail ORDER BY id DESC LIMIT 1').get() as { hash: string } | undefined;
  const prevHash = lastEntry?.hash || '0000000000000000000000000000000000000000000000000000000000000000';

  // Compute hash
  const content = JSON.stringify({ ...params, prev_hash: prevHash, timestamp: new Date().toISOString() });
  const hash = new Bun.CryptoHasher('sha256').update(content).digest('hex');

  db.prepare(`
    INSERT INTO audit_trail (return_id, client_id, user_id, action, entity_type, entity_id, details, ip_address, user_agent, prev_hash, hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.return_id || null,
    params.client_id || null,
    params.user_id,
    params.action,
    params.entity_type || null,
    params.entity_id || null,
    params.details ? JSON.stringify(params.details) : null,
    params.ip_address || null,
    params.user_agent || null,
    prevHash,
    hash,
  );
}
