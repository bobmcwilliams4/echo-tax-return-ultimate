// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Rate Limiting Middleware
// Token bucket per subscription tier
// ═══════════════════════════════════════════════════════════════════════════

import type { Context, Next } from 'hono';
import { Database } from 'bun:sqlite';
import { createLogger } from '../utils/logger';

const log = createLogger('rate-limit');

const TIER_LIMITS: Record<string, number> = {
  free: 100,
  pro: 500,
  business: 1000,
  professional: 5000,
  enterprise: 50000,
  admin: 100000,
};

const requestCounts = new Map<string, { count: number; resetAt: number }>();

export function rateLimitMiddleware(_db: Database) {
  return async (c: Context, next: Next) => {
    const userId = c.get('userId') || 'anonymous';
    const userRole = c.get('userRole') || 'free';
    const limit = TIER_LIMITS[userRole] || TIER_LIMITS.free;

    const now = Date.now();
    const windowMs = 60_000; // 1 minute window

    let entry = requestCounts.get(userId);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      requestCounts.set(userId, entry);
    }

    entry.count++;

    c.header('X-RateLimit-Limit', String(limit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, limit - entry.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > limit) {
      log.warn({ userId, count: entry.count, limit }, 'Rate limit exceeded');
      return c.json({ success: false, error: 'Rate limit exceeded. Upgrade your plan for higher limits.' }, 429);
    }

    await next();
  };
}
