// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Authentication Middleware
// API Key + JWT + Role-Based Access Control
// ═══════════════════════════════════════════════════════════════════════════

import type { Context, Next } from 'hono';
import { Database } from 'bun:sqlite';
import { createLogger } from '../utils/logger';

const log = createLogger('auth');

const API_KEY = process.env.ECHO_API_KEY || 'echo-tax-ultimate-dev-key';

export function authMiddleware(db: Database) {
  return async (c: Context, next: Next) => {
    const apiKey = c.req.header('X-Echo-API-Key');
    const authHeader = c.req.header('Authorization');

    // API Key authentication
    if (apiKey) {
      if (apiKey !== API_KEY) {
        log.warn({ ip: c.req.header('X-Forwarded-For') }, 'Invalid API key');
        return c.json({ success: false, error: 'Invalid API key' }, 401);
      }
      c.set('userId', 'api-user');
      c.set('userRole', 'admin');
      await next();
      return;
    }

    // Bearer token authentication
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        // In production, verify JWT / Firebase token
        // For now, decode and trust (replace with proper verification)
        const payload = JSON.parse(Buffer.from(token.split('.')[1] || '{}', 'base64').toString());
        c.set('userId', payload.sub || payload.uid || 'unknown');
        c.set('userRole', payload.role || 'client');
        await next();
        return;
      } catch (err) {
        log.warn({ err }, 'Invalid bearer token');
        return c.json({ success: false, error: 'Invalid authentication token' }, 401);
      }
    }

    return c.json({ success: false, error: 'Authentication required. Provide X-Echo-API-Key header or Bearer token.' }, 401);
  };
}
