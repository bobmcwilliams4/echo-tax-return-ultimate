// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Local Engine Runtime
// Queries 5,500+ engines & 57K+ doctrines from local SQLite DB
// Falls back to cloud runtime (echo-engine-runtime.bmcii1976.workers.dev)
// ═══════════════════════════════════════════════════════════════════════════

import { Database } from 'bun:sqlite';
import { createLogger } from '../utils/logger';

const log = createLogger('local-engine-runtime');

// ─── Configuration ─────────────────────────────────────────────────────

const LOCAL_DB_PATH = process.env.ENGINE_DB_PATH || 'N:\\CLOUDFLARE_RESCUE\\echo_engine_doctrines.db';
const CLOUD_RUNTIME_URL = process.env.ENGINE_RUNTIME_URL || 'https://echo-engine-runtime.bmcii1976.workers.dev';
const CLOUD_RUNTIME_KEY = process.env.ENGINE_RUNTIME_KEY || 'echo-omega-prime-forge-x-2026';

// ─── Types ─────────────────────────────────────────────────────────────

export interface DoctrineBlock {
  id: number;
  engine_id: string;
  topic: string;
  keywords: string[];
  conclusion: string;
  reasoning: string;
  key_factors: string[];
  authorities: string[];
  confidence: string;
  zone: string;
  burden_holder: string;
  adversary_position: string;
  counter_arguments: string[];
  resolution_strategy: string;
  entity_scope: string;
  confidence_stratification: string;
  controlling_precedent: string;
  cross_domain_routes: string[];
  domain_scope: string;
  irs_position: string;
  appeals_strategy: string;
  related_doctrines: string[];
}

export interface EngineInfo {
  engine_id: string;
  engine_name: string;
  category: string;
  domain: string;
  port: number;
  lines: number;
  doctrines_loaded: number;
  status: string;
}

export interface QueryResult {
  source: 'local' | 'cloud';
  engine_id: string;
  query: string;
  doctrines: DoctrineBlock[];
  total_matches: number;
  latency_ms: number;
  engines_searched: number;
}

export interface EngineSearchResult {
  engines: EngineInfo[];
  total: number;
  categories: string[];
}

// ─── JSON Parser Helper ───────────────────────────────────────────────

function safeParseJSON(val: unknown): string[] {
  if (!val) return [];
  const s = String(val);
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [s];
  } catch {
    // Try comma-separated
    if (s.includes(',')) return s.split(',').map(x => x.trim());
    return s ? [s] : [];
  }
}

function parseDoctrineRow(row: Record<string, unknown>): DoctrineBlock {
  return {
    id: row.id as number,
    engine_id: String(row.engine_id || ''),
    topic: String(row.topic || ''),
    keywords: safeParseJSON(row.keywords),
    conclusion: String(row.conclusion || ''),
    reasoning: String(row.reasoning || ''),
    key_factors: safeParseJSON(row.key_factors),
    authorities: safeParseJSON(row.authorities),
    confidence: String(row.confidence || ''),
    zone: String(row.zone || ''),
    burden_holder: String(row.burden_holder || ''),
    adversary_position: String(row.adversary_position || ''),
    counter_arguments: safeParseJSON(row.counter_arguments),
    resolution_strategy: String(row.resolution_strategy || ''),
    entity_scope: String(row.entity_scope || ''),
    confidence_stratification: String(row.confidence_stratification || ''),
    controlling_precedent: String(row.controlling_precedent || ''),
    cross_domain_routes: safeParseJSON(row.cross_domain_routes),
    domain_scope: String(row.domain_scope || ''),
    irs_position: String(row.irs_position || ''),
    appeals_strategy: String(row.appeals_strategy || ''),
    related_doctrines: safeParseJSON(row.related_doctrines),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LOCAL ENGINE RUNTIME CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class LocalEngineRuntime {
  private db: Database | null = null;
  private hasFTS: boolean = false;
  private engineCount: number = 0;
  private doctrineCount: number = 0;

  constructor() {
    this.init();
  }

  private init(): void {
    try {
      this.db = new Database(LOCAL_DB_PATH, { readonly: true });
      this.db.exec('PRAGMA cache_size = -64000'); // 64MB cache

      // Count records
      const engRow = this.db.prepare('SELECT COUNT(*) as cnt FROM engines').get() as { cnt: number };
      const docRow = this.db.prepare('SELECT COUNT(*) as cnt FROM doctrines').get() as { cnt: number };
      this.engineCount = engRow.cnt;
      this.doctrineCount = docRow.cnt;

      // Check if FTS index exists
      try {
        this.db.prepare("SELECT * FROM doctrines_fts LIMIT 1").get();
        this.hasFTS = true;
      } catch {
        // Create FTS5 virtual table for fast full-text search
        try {
          this.db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS doctrines_fts USING fts5(
              topic, keywords, conclusion, reasoning, authorities,
              content=doctrines, content_rowid=id
            )
          `);
          // Populate FTS
          this.db.exec(`
            INSERT OR IGNORE INTO doctrines_fts(rowid, topic, keywords, conclusion, reasoning, authorities)
            SELECT id, topic, keywords, conclusion, reasoning, authorities FROM doctrines
          `);
          this.hasFTS = true;
          log.info('FTS5 index created for doctrines');
        } catch (ftsErr) {
          log.warn({ err: ftsErr }, 'FTS5 creation failed — will use LIKE queries (readonly DB)');
          this.hasFTS = false;
        }
      }

      log.info({
        engines: this.engineCount,
        doctrines: this.doctrineCount,
        fts: this.hasFTS,
        path: LOCAL_DB_PATH,
      }, 'Local engine runtime initialized');
    } catch (err) {
      log.error({ err, path: LOCAL_DB_PATH }, 'Failed to open local engine DB — will use cloud fallback');
      this.db = null;
    }
  }

  // ─── Health Check ──────────────────────────────────────────────────

  getHealth(): { status: string; engines: number; doctrines: number; fts: boolean; source: string } {
    return {
      status: this.db ? 'ok' : 'cloud_fallback',
      engines: this.engineCount,
      doctrines: this.doctrineCount,
      fts: this.hasFTS,
      source: this.db ? 'local' : 'cloud',
    };
  }

  // ─── Engine Search ─────────────────────────────────────────────────

  searchEngines(query?: string, category?: string, limit: number = 50): EngineSearchResult {
    if (!this.db) return { engines: [], total: 0, categories: [] };

    let sql = 'SELECT * FROM engines WHERE 1=1';
    const params: unknown[] = [];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    if (query) {
      sql += ' AND (engine_id LIKE ? OR engine_name LIKE ? OR domain LIKE ?)';
      const q = `%${query}%`;
      params.push(q, q, q);
    }

    sql += ' ORDER BY doctrines_loaded DESC LIMIT ?';
    params.push(limit);

    const engines = this.db.prepare(sql).all(...params) as EngineInfo[];

    // Get all categories
    const cats = this.db.prepare('SELECT DISTINCT category FROM engines ORDER BY category').all() as { category: string }[];

    return {
      engines,
      total: engines.length,
      categories: cats.map(c => c.category),
    };
  }

  // ─── Get Engine By ID ──────────────────────────────────────────────

  getEngine(engineId: string): EngineInfo | null {
    if (!this.db) return null;
    return this.db.prepare('SELECT * FROM engines WHERE engine_id = ?').get(engineId) as EngineInfo | null;
  }

  // ─── List Engine Categories ────────────────────────────────────────

  listCategories(): Array<{ category: string; engine_count: number; doctrine_count: number }> {
    if (!this.db) return [];
    return this.db.prepare(`
      SELECT e.category, COUNT(DISTINCT e.engine_id) as engine_count,
             COUNT(d.id) as doctrine_count
      FROM engines e
      LEFT JOIN doctrines d ON e.engine_id = d.engine_id
      GROUP BY e.category
      ORDER BY doctrine_count DESC
    `).all() as Array<{ category: string; engine_count: number; doctrine_count: number }>;
  }

  // ─── Query Doctrines (Main Search) ─────────────────────────────────

  queryDoctrines(
    query: string,
    options: {
      engine_id?: string;
      category?: string;
      confidence?: string;
      zone?: string;
      limit?: number;
    } = {},
  ): QueryResult {
    const start = Date.now();
    const limit = options.limit || 20;

    if (!this.db) {
      return this.cloudFallbackQuery(query, options.engine_id, limit);
    }

    let doctrines: DoctrineBlock[] = [];
    let enginesSearched = 0;

    // Build engine filter
    let engineFilter = '';
    const engineParams: unknown[] = [];

    if (options.engine_id) {
      engineFilter = ' AND d.engine_id = ?';
      engineParams.push(options.engine_id);
      enginesSearched = 1;
    } else if (options.category) {
      engineFilter = ' AND d.engine_id IN (SELECT engine_id FROM engines WHERE category = ?)';
      engineParams.push(options.category);
      const catCount = this.db.prepare('SELECT COUNT(*) as cnt FROM engines WHERE category = ?').get(options.category) as { cnt: number };
      enginesSearched = catCount.cnt;
    } else {
      enginesSearched = this.engineCount;
    }

    // Confidence filter
    let confFilter = '';
    if (options.confidence) {
      confFilter = ' AND d.confidence = ?';
      engineParams.push(options.confidence);
    }

    // Zone filter
    let zoneFilter = '';
    if (options.zone) {
      zoneFilter = ' AND d.zone = ?';
      engineParams.push(options.zone);
    }

    // Try FTS first, fall back to LIKE
    if (this.hasFTS) {
      try {
        // FTS5 query: split into words, join with OR for broad matching
        const words = query.replace(/[^\w\s]/g, ' ').trim().split(/\s+/).filter(w => w.length > 2);
        const ftsQuery = words.length > 0 ? words.join(' OR ') : query;
        const sql = `
          SELECT d.*, fts.rank
          FROM doctrines_fts fts
          JOIN doctrines d ON d.id = fts.rowid
          WHERE doctrines_fts MATCH ?
          ${engineFilter.replace(/\bd\./g, 'd.')}${confFilter.replace(/\bd\./g, 'd.')}${zoneFilter.replace(/\bd\./g, 'd.')}
          ORDER BY fts.rank
          LIMIT ?
        `;
        const rows = this.db.prepare(sql).all(ftsQuery, ...engineParams, limit) as Array<Record<string, unknown>>;
        doctrines = rows.map(parseDoctrineRow);
      } catch (ftsErr) {
        log.warn({ err: ftsErr, query }, 'FTS query failed, falling back to LIKE');
        doctrines = this.likeSearch(query, engineFilter, confFilter, zoneFilter, engineParams, limit);
      }
    } else {
      doctrines = this.likeSearch(query, engineFilter, confFilter, zoneFilter, engineParams, limit);
    }

    const latency = Date.now() - start;
    log.info({ query, matches: doctrines.length, latency, fts: this.hasFTS }, 'Doctrine query completed');

    return {
      source: 'local',
      engine_id: options.engine_id || '*',
      query,
      doctrines,
      total_matches: doctrines.length,
      latency_ms: latency,
      engines_searched: enginesSearched,
    };
  }

  private likeSearch(
    query: string,
    engineFilter: string,
    confFilter: string,
    zoneFilter: string,
    engineParams: unknown[],
    limit: number,
  ): DoctrineBlock[] {
    if (!this.db) return [];

    // Split query into keywords for multi-term search
    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
    if (keywords.length === 0) return [];

    // Build LIKE conditions for each keyword
    const likeConditions = keywords.map(() => '(d.topic LIKE ? OR d.keywords LIKE ? OR d.conclusion LIKE ? OR d.reasoning LIKE ?)');
    const likeParams: unknown[] = [];
    for (const kw of keywords) {
      const pattern = `%${kw}%`;
      likeParams.push(pattern, pattern, pattern, pattern);
    }

    const sql = `
      SELECT d.* FROM doctrines d
      WHERE (${likeConditions.join(' AND ')})
      ${engineFilter}${confFilter}${zoneFilter}
      ORDER BY
        CASE WHEN d.topic LIKE ? THEN 0 ELSE 1 END,
        CASE WHEN d.confidence = 'DEFENSIBLE' THEN 0
             WHEN d.confidence = 'AGGRESSIVE' THEN 1
             ELSE 2 END
      LIMIT ?
    `;

    const params = [...likeParams, ...engineParams, `%${query}%`, limit];
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(parseDoctrineRow);
  }

  // ─── Get Doctrines by Engine ───────────────────────────────────────

  getDoctrinesByEngine(engineId: string, limit: number = 100, offset: number = 0): { doctrines: DoctrineBlock[]; total: number } {
    if (!this.db) return { doctrines: [], total: 0 };

    const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM doctrines WHERE engine_id = ?').get(engineId) as { cnt: number };
    const rows = this.db.prepare('SELECT * FROM doctrines WHERE engine_id = ? ORDER BY id LIMIT ? OFFSET ?')
      .all(engineId, limit, offset) as Array<Record<string, unknown>>;

    return {
      doctrines: rows.map(parseDoctrineRow),
      total: countRow.cnt,
    };
  }

  // ─── Get Doctrine by ID ────────────────────────────────────────────

  getDoctrine(id: number): DoctrineBlock | null {
    if (!this.db) return null;
    const row = this.db.prepare('SELECT * FROM doctrines WHERE id = ?').get(id) as Record<string, unknown> | null;
    return row ? parseDoctrineRow(row) : null;
  }

  // ─── Multi-Engine Query (search across tax-related engines) ────────

  queryTaxDoctrines(
    query: string,
    options: { limit?: number; confidence?: string } = {},
  ): QueryResult {
    // Search across all tax-relevant engine categories
    const taxCategories = ['TX', 'OGTAX', 'TAXINT', 'TAXPLAN', 'TXLAW', 'ACCT', 'FIN', 'INS'];
    const start = Date.now();
    const limit = options.limit || 30;

    if (!this.db) {
      return this.cloudFallbackQuery(query, undefined, limit);
    }

    const categoryPlaceholders = taxCategories.map(() => '?').join(',');

    let confFilter = '';
    const confParams: unknown[] = [];
    if (options.confidence) {
      confFilter = ' AND d.confidence = ?';
      confParams.push(options.confidence);
    }

    let rows: Array<Record<string, unknown>> = [];

    // Try FTS first
    if (this.hasFTS) {
      try {
        const words = query.replace(/[^\w\s]/g, ' ').trim().split(/\s+/).filter(w => w.length > 2);
        const ftsQuery = words.length > 0 ? words.join(' OR ') : query;
        const sql = `
          SELECT d.*, fts.rank FROM doctrines_fts fts
          JOIN doctrines d ON d.id = fts.rowid
          WHERE doctrines_fts MATCH ?
            AND d.engine_id IN (SELECT engine_id FROM engines WHERE category IN (${categoryPlaceholders}))
            ${confFilter}
          ORDER BY fts.rank
          LIMIT ?
        `;
        rows = this.db.prepare(sql).all(ftsQuery, ...taxCategories, ...confParams, limit) as Array<Record<string, unknown>>;
      } catch {
        // Fall through to LIKE
      }
    }

    // LIKE fallback
    if (rows.length === 0) {
      const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
      if (keywords.length === 0) {
        return { source: 'local', engine_id: '*tax*', query, doctrines: [], total_matches: 0, latency_ms: 0, engines_searched: 0 };
      }
      const likeConditions = keywords.map(() => '(d.topic LIKE ? OR d.keywords LIKE ? OR d.conclusion LIKE ?)');
      const likeParams: unknown[] = [];
      for (const kw of keywords) {
        const pattern = `%${kw}%`;
        likeParams.push(pattern, pattern, pattern);
      }
      const sql = `
        SELECT d.* FROM doctrines d
        WHERE d.engine_id IN (SELECT engine_id FROM engines WHERE category IN (${categoryPlaceholders}))
          AND (${likeConditions.join(' AND ')})
          ${confFilter}
        ORDER BY CASE WHEN d.confidence = 'DEFENSIBLE' THEN 0 ELSE 1 END
        LIMIT ?
      `;
      rows = this.db.prepare(sql).all(...taxCategories, ...likeParams, ...confParams, limit) as Array<Record<string, unknown>>;
    }

    const doctrines = rows.map(parseDoctrineRow);

    const latency = Date.now() - start;
    return {
      source: 'local',
      engine_id: '*tax*',
      query,
      doctrines,
      total_matches: doctrines.length,
      latency_ms: latency,
      engines_searched: taxCategories.length * 10, // approximate
    };
  }

  // ─── Cross-Domain Query (search ALL engines) ──────────────────────

  queryAllEngines(query: string, limit: number = 20): QueryResult {
    return this.queryDoctrines(query, { limit });
  }

  // ─── Statistics ────────────────────────────────────────────────────

  getStats(): {
    total_engines: number;
    total_doctrines: number;
    categories: number;
    top_categories: Array<{ category: string; engines: number; doctrines: number }>;
    confidence_distribution: Record<string, number>;
  } {
    if (!this.db) {
      return { total_engines: 0, total_doctrines: 0, categories: 0, top_categories: [], confidence_distribution: {} };
    }

    const cats = this.db.prepare(`
      SELECT e.category, COUNT(DISTINCT e.engine_id) as engines, COUNT(d.id) as doctrines
      FROM engines e LEFT JOIN doctrines d ON e.engine_id = d.engine_id
      GROUP BY e.category ORDER BY doctrines DESC LIMIT 20
    `).all() as Array<{ category: string; engines: number; doctrines: number }>;

    const confRows = this.db.prepare(`
      SELECT confidence, COUNT(*) as cnt FROM doctrines GROUP BY confidence ORDER BY cnt DESC
    `).all() as Array<{ confidence: string; cnt: number }>;

    const confDist: Record<string, number> = {};
    for (const r of confRows) confDist[r.confidence || 'UNKNOWN'] = r.cnt;

    const catCount = this.db.prepare('SELECT COUNT(DISTINCT category) as cnt FROM engines').get() as { cnt: number };

    return {
      total_engines: this.engineCount,
      total_doctrines: this.doctrineCount,
      categories: catCount.cnt,
      top_categories: cats,
      confidence_distribution: confDist,
    };
  }

  // ─── Cloud Fallback ────────────────────────────────────────────────

  private cloudFallbackQuery(query: string, engineId?: string, limit: number = 20): QueryResult {
    log.warn('Local DB unavailable, returning empty — cloud runtime has KV rate limits');
    return {
      source: 'cloud',
      engine_id: engineId || '*',
      query,
      doctrines: [],
      total_matches: 0,
      latency_ms: 0,
      engines_searched: 0,
    };
  }

  async queryCloudRuntime(query: string, engineId?: string): Promise<QueryResult> {
    const start = Date.now();
    try {
      const body: Record<string, string> = { query };
      if (engineId) body.engine_id = engineId;

      const resp = await fetch(`${CLOUD_RUNTIME_URL}/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': CLOUD_RUNTIME_KEY,
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const err = await resp.text();
        log.warn({ status: resp.status, err }, 'Cloud runtime query failed');
        return this.cloudFallbackQuery(query, engineId);
      }

      const data = await resp.json() as Record<string, unknown>;
      const latency = Date.now() - start;
      return {
        source: 'cloud',
        engine_id: engineId || '*',
        query,
        doctrines: (data.doctrines || data.results || []) as DoctrineBlock[],
        total_matches: (data.total || 0) as number,
        latency_ms: latency,
        engines_searched: (data.engines_searched || 0) as number,
      };
    } catch (err) {
      log.error({ err }, 'Cloud runtime request failed');
      return this.cloudFallbackQuery(query, engineId);
    }
  }

  // ─── Cleanup ───────────────────────────────────────────────────────

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// ─── Singleton Instance ────────────────────────────────────────────────

let _instance: LocalEngineRuntime | null = null;

export function getLocalEngineRuntime(): LocalEngineRuntime {
  if (!_instance) {
    _instance = new LocalEngineRuntime();
  }
  return _instance;
}
