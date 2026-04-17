// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Tax Engine Query Routes
// Multi-engine doctrine system: TIE, PIE, ARCS, FIE, STE, etc.
// ═══════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { EngineQuerySchema } from '../types/tax';
import { getById, logAudit } from '../services/database';
import { createLogger } from '../utils/logger';

const log = createLogger('engines');

// ─── Engine Registry ───────────────────────────────────────────────────
const ENGINE_REGISTRY: Record<string, { name: string; port: number; domain: string; description: string }> = {
  TIE: { name: 'Tax Intelligence Engine', port: 8391, domain: 'individual_tax', description: 'Federal individual income tax — IRC Title 26 Subtitle A' },
  PIE: { name: 'Property Intelligence Engine', port: 8392, domain: 'property_tax', description: 'Real/personal property tax, assessments, appeals' },
  ARCS: { name: 'Advanced Research & Citation System', port: 8393, domain: 'research', description: 'IRC section lookup, case law, revenue rulings, PLRs' },
  FIE: { name: 'Foreign Income Engine', port: 8394, domain: 'international', description: 'FBAR, FATCA, foreign tax credit, treaty positions' },
  STE: { name: 'State Tax Engine', port: 8395, domain: 'state_tax', description: 'Multi-state apportionment, nexus, state-specific rules' },
  BIE: { name: 'Business Income Engine', port: 8396, domain: 'business_tax', description: 'Schedule C, partnerships, S-corps, LLCs' },
  CRE: { name: 'Credit & Relief Engine', port: 8397, domain: 'credits', description: 'CTC, EIC, education, energy, foreign tax credits' },
  DEP: { name: 'Depreciation Engine', port: 8398, domain: 'depreciation', description: 'MACRS, Section 179, bonus depreciation, cost segregation' },
  EST: { name: 'Estate & Trust Engine', port: 8399, domain: 'estate_trust', description: 'Estate tax, gift tax, trust taxation, generation-skipping' },
  CRY: { name: 'Crypto Tax Engine', port: 8400, domain: 'crypto', description: 'Digital asset taxation, DeFi, staking, mining, NFTs' },
  INT: { name: 'Interest & Penalty Engine', port: 8401, domain: 'penalties', description: 'Underpayment penalties, accuracy penalties, reasonable cause' },
  AUD: { name: 'Audit Defense Engine', port: 8402, domain: 'audit', description: 'Audit triggers, defense strategies, documentation requirements' },
  PLN: { name: 'Tax Planning Engine', port: 8403, domain: 'planning', description: 'Multi-year planning, Roth conversions, tax-loss harvesting' },
  LEG: { name: 'Legislative Tracking Engine', port: 8404, domain: 'legislation', description: 'Tax law changes, sunset provisions, proposed legislation' },
  RET: { name: 'Retirement Engine', port: 8405, domain: 'retirement', description: 'RMDs, 401k, IRA, Roth, SIMPLE, SEP, defined benefit' },
};

// ─── Engine Selection Logic ────────────────────────────────────────────
const KEYWORD_ENGINE_MAP: Record<string, string[]> = {
  TIE: ['income tax', 'deduction', 'agi', 'filing status', '1040', 'standard deduction', 'itemized', 'w-2', 'taxable income'],
  PIE: ['property tax', 'assessment', 'real estate', 'property', 'reassessment', 'appeal'],
  ARCS: ['irc section', 'code section', 'case law', 'revenue ruling', 'regulation', 'precedent', 'citation'],
  FIE: ['foreign income', 'fbar', 'fatca', 'treaty', 'foreign tax credit', 'expat', 'offshore'],
  STE: ['state tax', 'state return', 'nexus', 'apportionment', 'multi-state'],
  BIE: ['business income', 'schedule c', 'self-employment', 'partnership', 's-corp', 'llc', 'k-1'],
  CRE: ['credit', 'ctc', 'child tax', 'earned income', 'eic', 'education credit', 'energy credit'],
  DEP: ['depreciation', 'macrs', 'section 179', 'bonus depreciation', 'cost segregation', 'amortization'],
  EST: ['estate', 'trust', 'gift tax', 'generation-skipping', 'inheritance', 'fiduciary'],
  CRY: ['crypto', 'bitcoin', 'ethereum', 'defi', 'staking', 'mining', 'nft', 'digital asset', 'token'],
  INT: ['penalty', 'interest', 'underpayment', 'late filing', 'reasonable cause', 'abatement'],
  AUD: ['audit', 'examination', 'irs notice', 'cp2000', 'correspondence audit', 'field audit'],
  PLN: ['planning', 'strategy', 'roth conversion', 'tax loss harvesting', 'bunching', 'projection'],
  LEG: ['legislation', 'tax reform', 'sunset', 'tcja', 'new law', 'proposed'],
  RET: ['retirement', 'rmd', '401k', 'ira', 'roth', 'pension', 'sep', 'simple', 'defined benefit'],
};

function selectEngine(query: string): string {
  const lowerQuery = query.toLowerCase();
  let bestEngine = 'TIE'; // default
  let bestScore = 0;

  for (const [engineId, keywords] of Object.entries(KEYWORD_ENGINE_MAP)) {
    let score = 0;
    for (const keyword of keywords) {
      if (lowerQuery.includes(keyword)) {
        score += keyword.split(' ').length; // Multi-word matches score higher
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestEngine = engineId;
    }
  }

  return bestEngine;
}

// ─── Doctrine Cache Search ─────────────────────────────────────────────
function searchDoctrineCache(db: Database, query: string, engineId?: string): Record<string, unknown> | null {
  const lowerQuery = query.toLowerCase();
  const conditions: string[] = ['active = 1'];
  const args: unknown[] = [];

  if (engineId) {
    conditions.push('engine_id = ?');
    args.push(engineId);
  }

  const blocks = db.prepare(`
    SELECT * FROM doctrine_blocks WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC
  `).all(...args) as Record<string, unknown>[];

  let bestBlock: Record<string, unknown> | null = null;
  let bestScore = 0;

  for (const block of blocks) {
    let score = 0;
    const keywords = (block.keywords as string || '').toLowerCase().split(',').map(k => k.trim());
    const topic = (block.topic as string || '').toLowerCase();

    // Topic match
    if (lowerQuery.includes(topic) || topic.includes(lowerQuery)) {
      score += 10;
    }

    // Keyword matches
    for (const keyword of keywords) {
      if (keyword && lowerQuery.includes(keyword)) {
        score += 3;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestBlock = block;
    }
  }

  return bestScore >= 3 ? bestBlock : null;
}

export function engineRoutes(db: Database) {
  const router = new Hono();

  // POST /query — Multi-engine query
  router.post('/query', async (c) => {
    const startTime = performance.now();
    const body = await c.req.json();
    const parsed = EngineQuerySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const input = parsed.data;
    const engineId = input.engine_id || selectEngine(input.query);
    const engine = ENGINE_REGISTRY[engineId];
    if (!engine) return c.json({ success: false, error: `Unknown engine: ${engineId}` }, 400);

    let responseLayer: 'doctrine_cache' | 'semantic' | 'claude_deep' = 'doctrine_cache';
    let analysis = '';
    let citations: string[] = [];
    let confidence = 'DEFENSIBLE';
    let reasoningChain: string[] = [];
    let counterArguments: string[] = [];

    // Layer 1: Doctrine Cache (0-200ms target)
    const doctrineBlock = searchDoctrineCache(db, input.query, engineId);
    if (doctrineBlock && !input.force_claude) {
      responseLayer = 'doctrine_cache';
      const conclusionParts = (doctrineBlock.conclusion_template as string || '').split('\n').filter(Boolean);
      analysis = conclusionParts.join(' ');
      citations = (doctrineBlock.primary_authority as string || '').split(',').map(s => s.trim()).filter(Boolean);
      confidence = (doctrineBlock.confidence as string) || 'DEFENSIBLE';
      reasoningChain = (doctrineBlock.reasoning_framework as string || '').split('\n').filter(Boolean);
      counterArguments = (doctrineBlock.counter_arguments as string || '').split(',').map(s => s.trim()).filter(Boolean);
    }

    // Layer 2: Semantic search fallback (FTS5)
    if (!analysis) {
      responseLayer = 'semantic';
      try {
        const ftsResults = db.prepare(`
          SELECT section, title, full_text, regulations, case_law, revenue_rulings
          FROM irc_authority_fts WHERE irc_authority_fts MATCH ? LIMIT 5
        `).all(input.query.replace(/[^\w\s]/g, '')) as Record<string, unknown>[];

        if (ftsResults.length > 0) {
          const topResult = ftsResults[0];
          analysis = `Per IRC Section ${topResult.section}: ${topResult.title}. ${(topResult.full_text as string || '').substring(0, 500)}`;
          citations = ftsResults.map(r => `IRC \u00A7${r.section}`);
          confidence = 'DEFENSIBLE';
          reasoningChain = [`FTS5 search matched ${ftsResults.length} IRC sections`, `Primary authority: IRC \u00A7${ftsResults[0].section}`];
        }
      } catch {
        log.debug('FTS5 search failed, falling to deep analysis');
      }
    }

    // Layer 3: Claude deep analysis (if force_claude or no cache/semantic hit)
    if (!analysis || input.force_claude) {
      responseLayer = 'claude_deep';
      analysis = `[Deep analysis required] Query "${input.query}" requires Claude subprocess analysis for engine ${engineId} (${engine.name}). ` +
        `Domain: ${engine.domain}. This query did not match any cached doctrine blocks or IRC FTS5 entries. ` +
        `Recommend submitting via /engine/claude endpoint for full analysis.`;
      confidence = 'DISCLOSURE';
      reasoningChain = [
        'No doctrine cache match found',
        'No FTS5 semantic match found',
        'Claude deep analysis recommended for comprehensive answer',
      ];
    }

    const latencyMs = Math.round(performance.now() - startTime);

    // Log the query
    const queryId = crypto.randomUUID().replace(/-/g, '');
    db.prepare(`
      INSERT INTO engine_queries (id, return_id, client_id, engine_id, query_text, response_text, response_json,
        response_layer, latency_ms, confidence, citations)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      queryId, input.return_id || null, null, engineId, input.query,
      analysis, JSON.stringify({ citations, reasoningChain, counterArguments }),
      responseLayer, latencyMs, confidence,
      JSON.stringify(citations),
    );

    logAudit(db, {
      return_id: input.return_id || undefined,
      user_id: c.get('userId'),
      action: 'engine_query',
      entity_type: 'engine_query',
      entity_id: queryId,
      details: { engine_id: engineId, response_layer: responseLayer, latency_ms: latencyMs },
    });

    return c.json({
      success: true,
      data: {
        query_id: queryId,
        engine_id: engineId,
        engine_name: engine.name,
        engine_domain: engine.domain,
        analysis,
        citations,
        confidence,
        authority: citations,
        risk_level: confidence === 'HIGH_RISK' ? 9 : confidence === 'AGGRESSIVE' ? 7 : confidence === 'DISCLOSURE' ? 5 : 3,
        reasoning_chain: reasoningChain,
        counter_arguments: counterArguments,
        documentation_needed: [],
        response_layer: responseLayer,
        latency_ms: latencyMs,
      },
    });
  });

  // POST /claude — Direct Claude subprocess query
  router.post('/claude', async (c) => {
    const startTime = performance.now();
    const body = await c.req.json();
    const { query, return_id, system_context, temperature } = body;

    if (!query) return c.json({ success: false, error: 'query is required' }, 400);

    // Build context from return data if return_id provided
    let returnContext = '';
    if (return_id) {
      const taxReturn = getById(db, 'tax_returns', return_id) as Record<string, unknown> | undefined;
      if (taxReturn) {
        const client = getById(db, 'clients', taxReturn.client_id as string) as Record<string, unknown> | undefined;
        returnContext = `Tax Year: ${taxReturn.tax_year}, Filing Status: ${client?.filing_status || 'unknown'}, ` +
          `AGI: $${taxReturn.adjusted_gross_income || 0}, Taxable Income: $${taxReturn.taxable_income || 0}`;
      }
    }

    // Claude subprocess call via Bun.spawn
    const systemPrompt = system_context || `You are an expert tax advisor with deep knowledge of IRC, Treasury Regulations, and case law. ` +
      `Provide authoritative analysis with specific IRC section citations. ${returnContext ? `Context: ${returnContext}` : ''}`;

    let claudeResponse = '';
    try {
      const proc = Bun.spawn(['claude', '--print', '-p', `${systemPrompt}\n\nQuery: ${query}`], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env },
      });

      claudeResponse = await new Response(proc.stdout).text();
      await proc.exited;

      if (!claudeResponse.trim()) {
        claudeResponse = 'Claude subprocess returned no output. Verify Claude CLI is installed and configured.';
      }
    } catch (err) {
      log.error({ err }, 'Claude subprocess failed');
      claudeResponse = `Claude subprocess error: ${(err as Error).message}. Ensure Claude CLI is installed.`;
    }

    const latencyMs = Math.round(performance.now() - startTime);

    // Log the query
    const queryId = crypto.randomUUID().replace(/-/g, '');
    db.prepare(`
      INSERT INTO engine_queries (id, return_id, engine_id, query_text, response_text,
        response_layer, latency_ms, confidence, model_used)
      VALUES (?, ?, 'CLAUDE', ?, ?, 'claude_deep', ?, 'DEFENSIBLE', 'claude-opus-4-6')
    `).run(queryId, return_id || null, query, claudeResponse, latencyMs);

    logAudit(db, {
      return_id: return_id || undefined,
      user_id: c.get('userId'),
      action: 'claude_query',
      entity_type: 'engine_query',
      entity_id: queryId,
      details: { latency_ms: latencyMs },
    });

    return c.json({
      success: true,
      data: {
        query_id: queryId,
        response: claudeResponse,
        model: 'claude-opus-4-6',
        response_layer: 'claude_deep',
        latency_ms: latencyMs,
      },
    });
  });

  // GET /doctrine/:topic — Doctrine block lookup
  router.get('/doctrine/:topic', (c) => {
    const topic = c.req.param('topic');
    const engineId = c.req.query('engine_id');

    const conditions: string[] = ['active = 1'];
    const args: unknown[] = [];

    if (engineId) {
      conditions.push('engine_id = ?');
      args.push(engineId);
    }

    // Search by topic (exact or partial)
    conditions.push("(topic LIKE ? OR keywords LIKE ?)");
    args.push(`%${topic}%`, `%${topic}%`);

    const blocks = db.prepare(`
      SELECT * FROM doctrine_blocks WHERE ${conditions.join(' AND ')} ORDER BY engine_id, topic
    `).all(...args) as Record<string, unknown>[];

    // Parse JSON arrays in results
    const parsed = blocks.map(b => ({
      ...b,
      keywords: (b.keywords as string || '').split(',').map(k => k.trim()).filter(Boolean),
      conclusion_template: (b.conclusion_template as string || '').split('\n').filter(Boolean),
      reasoning_framework: (b.reasoning_framework as string || '').split('\n').filter(Boolean),
      key_factors: (b.key_factors as string || '').split(',').map(k => k.trim()).filter(Boolean),
      primary_authority: (b.primary_authority as string || '').split(',').map(k => k.trim()).filter(Boolean),
      counter_arguments: (b.counter_arguments as string || '').split(',').map(k => k.trim()).filter(Boolean),
    }));

    return c.json({ success: true, data: parsed, count: parsed.length });
  });

  // GET /authority/:irc — IRC section search
  router.get('/authority/:irc', (c) => {
    const section = c.req.param('irc');

    // Direct section lookup
    const exact = db.prepare('SELECT * FROM irc_authority WHERE section = ?').all(section) as Record<string, unknown>[];

    // FTS5 search if no exact match
    let ftsResults: Record<string, unknown>[] = [];
    if (exact.length === 0) {
      try {
        ftsResults = db.prepare(`
          SELECT rowid, section, title, full_text, regulations, case_law, revenue_rulings
          FROM irc_authority_fts WHERE irc_authority_fts MATCH ? LIMIT 10
        `).all(section.replace(/[^\w\s§.()-]/g, '')) as Record<string, unknown>[];
      } catch {
        log.debug({ section }, 'FTS5 search failed for IRC section');
      }
    }

    const results = exact.length > 0 ? exact : ftsResults;

    return c.json({
      success: true,
      data: results,
      count: results.length,
      search_type: exact.length > 0 ? 'exact' : 'fts5',
    });
  });

  // GET /health — Engine cluster health
  router.get('/health', (c) => {
    const engines = Object.entries(ENGINE_REGISTRY).map(([id, info]) => {
      // Count queries in last hour
      const recentQueries = db.prepare(`
        SELECT COUNT(*) as count, AVG(latency_ms) as avg_latency
        FROM engine_queries WHERE engine_id = ? AND created_at > datetime('now', '-1 hour')
      `).get(id) as { count: number; avg_latency: number | null };

      // Count doctrine blocks
      const doctrineCount = db.prepare(`
        SELECT COUNT(*) as count FROM doctrine_blocks WHERE engine_id = ? AND active = 1
      `).get(id) as { count: number };

      return {
        engine_id: id,
        name: info.name,
        domain: info.domain,
        port: info.port,
        status: 'available' as const,
        doctrine_blocks: doctrineCount.count,
        queries_last_hour: recentQueries.count,
        avg_latency_ms: recentQueries.avg_latency ? Math.round(recentQueries.avg_latency) : null,
      };
    });

    // Overall stats
    const totalQueries = db.prepare(`
      SELECT COUNT(*) as count FROM engine_queries WHERE created_at > datetime('now', '-24 hours')
    `).get() as { count: number };

    const layerDistribution = db.prepare(`
      SELECT response_layer, COUNT(*) as count
      FROM engine_queries WHERE created_at > datetime('now', '-24 hours')
      GROUP BY response_layer
    `).all() as { response_layer: string; count: number }[];

    return c.json({
      success: true,
      data: {
        cluster_status: 'healthy',
        engine_count: engines.length,
        engines,
        stats_24h: {
          total_queries: totalQueries.count,
          layer_distribution: Object.fromEntries(layerDistribution.map(r => [r.response_layer, r.count])),
        },
        timestamp: new Date().toISOString(),
      },
    });
  });

  return router;
}
