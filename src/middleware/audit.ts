// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Audit Trail Middleware
// Append-only, SHA-256 hash-chained audit log
// ═══════════════════════════════════════════════════════════════════════════

import type { Context, Next } from 'hono';
import { Database } from 'bun:sqlite';
import { logAudit } from '../services/database';

export function auditMiddleware(db: Database) {
  return async (c: Context, next: Next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;

    // Only audit mutating operations
    const method = c.req.method;
    if (method === 'GET' || method === 'OPTIONS' || method === 'HEAD') return;

    try {
      logAudit(db, {
        user_id: c.get('userId') || 'unknown',
        action: `${method} ${c.req.path}`,
        details: { status: c.res.status, duration_ms: duration },
        ip_address: c.req.header('X-Forwarded-For') || c.req.header('CF-Connecting-IP') || 'unknown',
        user_agent: c.req.header('User-Agent') || 'unknown',
      });
    } catch {
      // Never fail the request because of audit logging
    }
  };
}
