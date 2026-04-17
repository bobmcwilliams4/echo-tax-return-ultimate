// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Operations Routes
// Metrics, health checks, system diagnostics
// ═══════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { createLogger } from '../utils/logger';

const log = createLogger('ops');

const startTime = Date.now();

export function opsRoutes(db: Database) {
  const router = new Hono();

  // GET /metrics — Prometheus-style metrics
  router.get('/metrics', (c) => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const lastHour = new Date(Date.now() - 3_600_000).toISOString();

    // Database table counts
    const tables = ['clients', 'tax_returns', 'income_items', 'deductions', 'dependents',
      'documents', 'engine_queries', 'efile_submissions', 'compliance_checks',
      'subscriptions', 'firms', 'preparers', 'audit_trail', 'doctrine_blocks'];

    const tableCounts: Record<string, number> = {};
    for (const table of tables) {
      try {
        const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
        tableCounts[table] = row.count;
      } catch {
        tableCounts[table] = -1; // Table doesn't exist
      }
    }

    // Return status distribution
    const returnsByStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM tax_returns GROUP BY status
    `).all() as { status: string; count: number }[];

    // API usage stats (today)
    const apiStatsToday = db.prepare(`
      SELECT
        COUNT(*) as total_calls,
        AVG(response_time_ms) as avg_response_ms,
        MAX(response_time_ms) as max_response_ms,
        COUNT(CASE WHEN status_code >= 400 THEN 1 END) as error_count,
        COUNT(CASE WHEN status_code >= 500 THEN 1 END) as server_error_count
      FROM api_usage WHERE timestamp >= ?
    `).get(today) as Record<string, number | null>;

    // Engine query stats (last hour)
    const engineStats = db.prepare(`
      SELECT
        engine_id,
        COUNT(*) as queries,
        AVG(latency_ms) as avg_latency,
        response_layer,
        COUNT(CASE WHEN confidence = 'DEFENSIBLE' THEN 1 END) as defensible,
        COUNT(CASE WHEN confidence = 'AGGRESSIVE' THEN 1 END) as aggressive,
        COUNT(CASE WHEN confidence = 'HIGH_RISK' THEN 1 END) as high_risk
      FROM engine_queries WHERE created_at >= ? GROUP BY engine_id, response_layer
    `).all(lastHour) as Record<string, unknown>[];

    // E-file stats (this month)
    const efileStats = db.prepare(`
      SELECT
        status, COUNT(*) as count
      FROM efile_submissions WHERE created_at >= ? GROUP BY status
    `).all(thisMonth) as { status: string; count: number }[];

    // Subscription distribution
    const subscriptionStats = db.prepare(`
      SELECT tier, status, COUNT(*) as count FROM subscriptions GROUP BY tier, status
    `).all() as { tier: string; status: string; count: number }[];

    // Audit trail volume (last 24h)
    const auditVolume = db.prepare(`
      SELECT action, COUNT(*) as count FROM audit_trail
      WHERE timestamp >= datetime('now', '-24 hours') GROUP BY action ORDER BY count DESC LIMIT 20
    `).all() as { action: string; count: number }[];

    // Database size
    let dbSize = 0;
    try {
      const pageCount = (db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count;
      const pageSize = (db.prepare("PRAGMA page_size").get() as { page_size: number }).page_size;
      dbSize = pageCount * pageSize;
    } catch { /* ignore */ }

    // WAL size
    let walSize = 0;
    try {
      const walPages = db.prepare("PRAGMA wal_checkpoint").get() as Record<string, number>;
      walSize = (walPages?.busy || 0) * 4096;
    } catch { /* ignore */ }

    return c.json({
      success: true,
      data: {
        timestamp: now.toISOString(),
        uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
        database: {
          table_counts: tableCounts,
          total_records: Object.values(tableCounts).filter(v => v >= 0).reduce((a, b) => a + b, 0),
          size_bytes: dbSize,
          size_mb: Math.round(dbSize / 1_048_576 * 100) / 100,
          wal_size_bytes: walSize,
        },
        returns: {
          by_status: Object.fromEntries(returnsByStatus.map(r => [r.status, r.count])),
          total: returnsByStatus.reduce((sum, r) => sum + r.count, 0),
        },
        api: {
          today: {
            total_calls: apiStatsToday.total_calls || 0,
            avg_response_ms: apiStatsToday.avg_response_ms ? Math.round(apiStatsToday.avg_response_ms as number) : null,
            max_response_ms: apiStatsToday.max_response_ms,
            error_rate: (apiStatsToday.total_calls || 0) > 0
              ? Math.round(((apiStatsToday.error_count || 0) / (apiStatsToday.total_calls as number)) * 10000) / 100
              : 0,
            server_errors: apiStatsToday.server_error_count || 0,
          },
        },
        engines: {
          queries_last_hour: engineStats,
        },
        efile: {
          this_month: Object.fromEntries(efileStats.map(r => [r.status, r.count])),
        },
        subscriptions: {
          distribution: subscriptionStats,
        },
        audit: {
          actions_24h: auditVolume,
          total_24h: auditVolume.reduce((sum, r) => sum + r.count, 0),
        },
      },
    });
  });

  // GET /health — Basic health check
  router.get('/health', (c) => {
    let dbOk = false;
    try {
      db.prepare('SELECT 1').get();
      dbOk = true;
    } catch { /* db down */ }

    const status = dbOk ? 'healthy' : 'unhealthy';

    return c.json({
      status,
      version: '1.0.0',
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      database: dbOk ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    }, dbOk ? 200 : 503);
  });

  // GET /health/deep — Deep health check with dependency verification
  router.get('/health/deep', (c) => {
    const checks: Record<string, { status: 'ok' | 'degraded' | 'down'; latency_ms: number; details?: string }> = {};

    // Database check
    const dbStart = performance.now();
    try {
      db.prepare('SELECT 1').get();
      const quickCheck = db.prepare("PRAGMA quick_check").all() as { quick_check: string }[];
      checks.database = {
        status: quickCheck[0]?.quick_check === 'ok' ? 'ok' : 'degraded',
        latency_ms: Math.round(performance.now() - dbStart),
        details: quickCheck[0]?.quick_check,
      };
    } catch (err) {
      checks.database = { status: 'down', latency_ms: Math.round(performance.now() - dbStart), details: (err as Error).message };
    }

    // WAL check
    const walStart = performance.now();
    try {
      const walMode = db.prepare("PRAGMA journal_mode").all() as { journal_mode: string }[];
      checks.wal_mode = {
        status: walMode[0]?.journal_mode === 'wal' ? 'ok' : 'degraded',
        latency_ms: Math.round(performance.now() - walStart),
        details: `journal_mode=${walMode[0]?.journal_mode}`,
      };
    } catch (err) {
      checks.wal_mode = { status: 'down', latency_ms: Math.round(performance.now() - walStart), details: (err as Error).message };
    }

    // Foreign keys check
    const fkStart = performance.now();
    try {
      const fk = db.prepare("PRAGMA foreign_keys").all() as { foreign_keys: number }[];
      checks.foreign_keys = {
        status: fk[0]?.foreign_keys === 1 ? 'ok' : 'degraded',
        latency_ms: Math.round(performance.now() - fkStart),
        details: `foreign_keys=${fk[0]?.foreign_keys}`,
      };
    } catch (err) {
      checks.foreign_keys = { status: 'down', latency_ms: Math.round(performance.now() - fkStart), details: (err as Error).message };
    }

    // Table integrity — verify core tables exist
    const coreTableStart = performance.now();
    const coreTables = ['clients', 'tax_returns', 'income_items', 'deductions', 'dependents', 'audit_trail'];
    const missingTables: string[] = [];
    for (const table of coreTables) {
      try {
        db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
      } catch {
        missingTables.push(table);
      }
    }
    checks.core_tables = {
      status: missingTables.length === 0 ? 'ok' : 'down',
      latency_ms: Math.round(performance.now() - coreTableStart),
      details: missingTables.length === 0 ? `All ${coreTables.length} core tables present` : `Missing: ${missingTables.join(', ')}`,
    };

    // FTS5 check
    const ftsStart = performance.now();
    try {
      db.prepare("SELECT 1 FROM irc_authority_fts LIMIT 1").get();
      checks.fts5 = { status: 'ok', latency_ms: Math.round(performance.now() - ftsStart), details: 'FTS5 index accessible' };
    } catch {
      checks.fts5 = { status: 'degraded', latency_ms: Math.round(performance.now() - ftsStart), details: 'FTS5 index not available (non-critical)' };
    }

    // Audit trail integrity (hash chain)
    const auditStart = performance.now();
    try {
      const lastTwo = db.prepare('SELECT hash, prev_hash FROM audit_trail ORDER BY id DESC LIMIT 2').all() as { hash: string; prev_hash: string }[];
      if (lastTwo.length >= 2) {
        const chainValid = lastTwo[0].prev_hash === lastTwo[1].hash;
        checks.audit_chain = {
          status: chainValid ? 'ok' : 'degraded',
          latency_ms: Math.round(performance.now() - auditStart),
          details: chainValid ? 'Hash chain intact' : 'Hash chain broken — audit integrity compromised',
        };
      } else {
        checks.audit_chain = { status: 'ok', latency_ms: Math.round(performance.now() - auditStart), details: 'Insufficient entries to verify chain' };
      }
    } catch (err) {
      checks.audit_chain = { status: 'degraded', latency_ms: Math.round(performance.now() - auditStart), details: (err as Error).message };
    }

    // Determine overall status
    const statuses = Object.values(checks).map(c => c.status);
    const overallStatus = statuses.includes('down') ? 'unhealthy' : statuses.includes('degraded') ? 'degraded' : 'healthy';

    return c.json({
      status: overallStatus,
      version: '1.0.0',
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      checks,
      total_checks: Object.keys(checks).length,
      passed: statuses.filter(s => s === 'ok').length,
      degraded: statuses.filter(s => s === 'degraded').length,
      down: statuses.filter(s => s === 'down').length,
      timestamp: new Date().toISOString(),
    }, overallStatus === 'unhealthy' ? 503 : 200);
  });

  return router;
}
