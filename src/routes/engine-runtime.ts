// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Local Engine Runtime Routes
// Exposes 5,500+ engines & 57K+ doctrines for Claude subprocess queries
// ═══════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { getLocalEngineRuntime } from '../services/local-engine-runtime';
import { createLogger } from '../utils/logger';

const log = createLogger('engine-runtime-routes');

export function engineRuntimeRoutes(db: Database) {
  const app = new Hono();
  const runtime = getLocalEngineRuntime();

  // ─── Health & Stats ──────────────────────────────────────────────────

  app.get('/health', (c) => {
    const health = runtime.getHealth();
    return c.json({ success: true, ...health });
  });

  app.get('/stats', (c) => {
    const stats = runtime.getStats();
    return c.json({ success: true, ...stats });
  });

  // ─── Engine Endpoints ────────────────────────────────────────────────

  app.get('/engines', (c) => {
    const query = c.req.query('q');
    const category = c.req.query('category');
    const limit = parseInt(c.req.query('limit') || '50', 10);

    const result = runtime.searchEngines(query, category, limit);
    return c.json({ success: true, ...result });
  });

  app.get('/engines/:engineId', (c) => {
    const engineId = c.req.param('engineId');
    const engine = runtime.getEngine(engineId);
    if (!engine) {
      return c.json({ success: false, error: `Engine ${engineId} not found` }, 404);
    }
    return c.json({ success: true, engine });
  });

  app.get('/categories', (c) => {
    const categories = runtime.listCategories();
    return c.json({ success: true, categories, total: categories.length });
  });

  // ─── Doctrine Query (Main Search) ────────────────────────────────────

  app.post('/query', async (c) => {
    const body = await c.req.json() as {
      query: string;
      engine_id?: string;
      category?: string;
      confidence?: string;
      zone?: string;
      limit?: number;
    };

    if (!body.query) {
      return c.json({ success: false, error: 'Query is required' }, 400);
    }

    const result = runtime.queryDoctrines(body.query, {
      engine_id: body.engine_id,
      category: body.category,
      confidence: body.confidence,
      zone: body.zone,
      limit: body.limit,
    });

    return c.json({ success: true, ...result });
  });

  // GET version for simple queries
  app.get('/query', (c) => {
    const query = c.req.query('q');
    const engineId = c.req.query('engine_id');
    const category = c.req.query('category');
    const confidence = c.req.query('confidence');
    const limit = parseInt(c.req.query('limit') || '20', 10);

    if (!query) {
      return c.json({ success: false, error: 'q parameter is required' }, 400);
    }

    const result = runtime.queryDoctrines(query, {
      engine_id: engineId,
      category,
      confidence,
      limit,
    });

    return c.json({ success: true, ...result });
  });

  // ─── Tax-Specific Query (searches tax-relevant engines only) ─────────

  app.post('/query/tax', async (c) => {
    const body = await c.req.json() as {
      query: string;
      confidence?: string;
      limit?: number;
    };

    if (!body.query) {
      return c.json({ success: false, error: 'Query is required' }, 400);
    }

    const result = runtime.queryTaxDoctrines(body.query, {
      confidence: body.confidence,
      limit: body.limit,
    });

    return c.json({ success: true, ...result });
  });

  app.get('/query/tax', (c) => {
    const query = c.req.query('q');
    const confidence = c.req.query('confidence');
    const limit = parseInt(c.req.query('limit') || '20', 10);

    if (!query) {
      return c.json({ success: false, error: 'q parameter is required' }, 400);
    }

    const result = runtime.queryTaxDoctrines(query, { confidence, limit });
    return c.json({ success: true, ...result });
  });

  // ─── Doctrine Endpoints ──────────────────────────────────────────────

  app.get('/doctrines', (c) => {
    const engineId = c.req.query('engine_id');
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);

    if (!engineId) {
      return c.json({ success: false, error: 'engine_id parameter is required' }, 400);
    }

    const result = runtime.getDoctrinesByEngine(engineId, limit, offset);
    return c.json({ success: true, ...result });
  });

  app.get('/doctrines/:id', (c) => {
    const id = parseInt(c.req.param('id'), 10);
    const doctrine = runtime.getDoctrine(id);
    if (!doctrine) {
      return c.json({ success: false, error: `Doctrine ${id} not found` }, 404);
    }
    return c.json({ success: true, doctrine });
  });

  // ─── Claude-Optimized Endpoint ───────────────────────────────────────
  // Returns concise, structured results perfect for Claude subprocess consumption

  app.post('/claude-query', async (c) => {
    const body = await c.req.json() as {
      question: string;
      context?: string;
      engine_id?: string;
      tax_only?: boolean;
      max_results?: number;
    };

    if (!body.question) {
      return c.json({ success: false, error: 'question is required' }, 400);
    }

    const limit = body.max_results || 10;
    let result;

    if (body.tax_only) {
      result = runtime.queryTaxDoctrines(body.question, { limit });
    } else if (body.engine_id) {
      result = runtime.queryDoctrines(body.question, { engine_id: body.engine_id, limit });
    } else {
      result = runtime.queryDoctrines(body.question, { limit });
    }

    // Format for Claude consumption — compact, high-signal
    const formatted = result.doctrines.map((d, i) => ({
      rank: i + 1,
      engine: d.engine_id,
      topic: d.topic,
      conclusion: d.conclusion,
      confidence: d.confidence,
      authorities: d.authorities.slice(0, 5),
      key_factors: d.key_factors.slice(0, 5),
      irs_position: d.irs_position || null,
    }));

    return c.json({
      success: true,
      question: body.question,
      source: result.source,
      matches: formatted.length,
      latency_ms: result.latency_ms,
      doctrines: formatted,
    });
  });

  // ─── Cloud Runtime Proxy ─────────────────────────────────────────────
  // Falls back to cloud when local DB doesn't have enough data

  app.post('/cloud-query', async (c) => {
    const body = await c.req.json() as {
      query: string;
      engine_id?: string;
    };

    if (!body.query) {
      return c.json({ success: false, error: 'Query is required' }, 400);
    }

    const result = await runtime.queryCloudRuntime(body.query, body.engine_id);
    return c.json({ success: true, ...result });
  });

  return app;
}
