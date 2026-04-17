// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Interactive Return Preparer Routes
// Claude Opus 4.7 AI-Powered Tax Interview + Engine Runtime + Calculation
// ═══════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { createLogger } from '../utils/logger';
import { logAudit } from '../services/database';
import { ReturnPreparer, queryEngineRuntime } from '../services/return-preparer';

const log = createLogger('preparer-routes');

export function preparerRoutes(db: Database) {
  const router = new Hono();
  const preparer = new ReturnPreparer(db);

  // ── Create preparer_sessions table if not exists ──────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS preparer_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'interviewing' CHECK(status IN ('interviewing','reviewing','calculating','complete','error')),
      phase INTEGER NOT NULL DEFAULT 1,
      current_question_index INTEGER NOT NULL DEFAULT 0,
      client_id TEXT,
      return_id TEXT,
      answers TEXT NOT NULL DEFAULT '{}',
      engine_consultations TEXT NOT NULL DEFAULT '[]',
      claude_interactions TEXT NOT NULL DEFAULT '[]',
      warnings TEXT NOT NULL DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_preparer_sessions_user ON preparer_sessions(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_preparer_sessions_status ON preparer_sessions(status)');

  log.info('Preparer sessions table initialized');

  // ─── POST /start — Start new return preparation session ───────────
  router.post('/start', async (c) => {
    try {
      const userId = c.get('userId') || 'api-user';
      const session = preparer.createSession(userId);
      const nextQuestion = preparer.getNextQuestion(session);

      return c.json({
        success: true,
        data: {
          session_id: session.id,
          status: session.status,
          message: 'Tax return preparation session started. Answer each question to build your return.',
          first_question: nextQuestion,
        },
      }, 201);
    } catch (err) {
      log.error({ err }, 'Failed to start preparer session');
      return c.json({
        success: false,
        error: `Failed to start session: ${(err as Error).message}`,
      }, 500);
    }
  });

  // ─── GET /:sessionId — Get session status and current question ────
  router.get('/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId');
    const session = preparer.getSession(sessionId);

    if (!session) {
      return c.json({ success: false, error: 'Session not found' }, 404);
    }

    const nextQuestion = preparer.getNextQuestion(session);

    return c.json({
      success: true,
      data: {
        session_id: session.id,
        status: session.status,
        phase: session.phase,
        client_id: session.client_id,
        return_id: session.return_id,
        current_question: nextQuestion,
        warnings: session.warnings,
        answers_collected: Object.keys(flattenObject(session.answers)).length,
        engine_consultations: session.engine_consultations.length,
        claude_interactions: session.claude_interactions.length,
        created_at: session.created_at,
        updated_at: session.updated_at,
      },
    });
  });

  // ─── POST /:sessionId/answer — Submit answer, get next question ───
  router.post('/:sessionId/answer', async (c) => {
    const sessionId = c.req.param('sessionId');
    const session = preparer.getSession(sessionId);

    if (!session) {
      return c.json({ success: false, error: 'Session not found' }, 404);
    }

    if (session.status === 'complete') {
      return c.json({ success: false, error: 'Session is already complete. Use /summary to view results.' }, 400);
    }

    if (session.status === 'error') {
      return c.json({ success: false, error: 'Session is in error state. Start a new session.' }, 400);
    }

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }

    const questionId = body.question_id as string;
    const answer = body.answer;

    if (!questionId) {
      return c.json({ success: false, error: 'question_id is required' }, 400);
    }

    if (answer === undefined || answer === null) {
      return c.json({ success: false, error: 'answer is required' }, 400);
    }

    try {
      const userId = c.get('userId') || 'api-user';
      const result = await preparer.processAnswer(session, questionId, answer, userId);

      return c.json({
        success: true,
        data: {
          ...result,
          message: result.question
            ? `Phase ${result.phase}: ${result.phase_name}`
            : 'All questions answered. Ready for calculation.',
        },
      });
    } catch (err) {
      log.error({ err, sessionId, questionId }, 'Failed to process answer');
      return c.json({
        success: false,
        error: (err as Error).message,
      }, 400);
    }
  });

  // ─── POST /:sessionId/consult — Query engine runtime mid-interview ─
  router.post('/:sessionId/consult', async (c) => {
    const sessionId = c.req.param('sessionId');
    const session = preparer.getSession(sessionId);

    if (!session) {
      return c.json({ success: false, error: 'Session not found' }, 404);
    }

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }

    const engineId = (body.engine_id as string) || 'TIE';
    const query = body.query as string;

    if (!query) {
      return c.json({ success: false, error: 'query is required' }, 400);
    }

    try {
      const result = await preparer.consultEngine(session, engineId, query);

      return c.json({
        success: true,
        data: {
          engine_id: engineId,
          query,
          result,
        },
      });
    } catch (err) {
      log.error({ err, sessionId, engineId }, 'Engine consultation failed');
      return c.json({
        success: false,
        error: `Engine consultation failed: ${(err as Error).message}`,
      }, 500);
    }
  });

  // ─── POST /:sessionId/calculate — Run final calculation ───────────
  router.post('/:sessionId/calculate', async (c) => {
    const sessionId = c.req.param('sessionId');
    const session = preparer.getSession(sessionId);

    if (!session) {
      return c.json({ success: false, error: 'Session not found' }, 404);
    }

    if (session.status === 'complete') {
      return c.json({ success: false, error: 'Return already calculated. Use /summary to view.' }, 400);
    }

    try {
      const userId = c.get('userId') || 'api-user';
      const result = await preparer.runCalculation(session, userId);

      return c.json({
        success: true,
        data: {
          session_id: sessionId,
          return_id: result.return_id,
          calculation: result.calculation,
          message: 'Tax return calculated successfully.',
        },
      });
    } catch (err) {
      log.error({ err, sessionId }, 'Calculation failed');
      return c.json({
        success: false,
        error: `Calculation failed: ${(err as Error).message}`,
      }, 500);
    }
  });

  // ─── GET /:sessionId/summary — Get complete return summary ────────
  router.get('/:sessionId/summary', async (c) => {
    const sessionId = c.req.param('sessionId');
    const session = preparer.getSession(sessionId);

    if (!session) {
      return c.json({ success: false, error: 'Session not found' }, 404);
    }

    const summary = preparer.getReturnSummary(session);

    return c.json({
      success: true,
      data: summary,
    });
  });

  // ─── POST /:sessionId/generate — Generate forms (PDF + MeF XML) ──
  router.post('/:sessionId/generate', async (c) => {
    const sessionId = c.req.param('sessionId');
    const session = preparer.getSession(sessionId);

    if (!session) {
      return c.json({ success: false, error: 'Session not found' }, 404);
    }

    if (!session.return_id) {
      return c.json({ success: false, error: 'Return must be calculated before generating forms. Run /calculate first.' }, 400);
    }

    if (session.status !== 'complete') {
      return c.json({ success: false, error: 'Return must be in complete status to generate forms.' }, 400);
    }

    try {
      // Pull the return data
      const taxReturn = db.prepare('SELECT * FROM tax_returns WHERE id = ?').get(session.return_id) as Record<string, unknown>;
      const client = session.client_id
        ? db.prepare('SELECT * FROM clients WHERE id = ?').get(session.client_id) as Record<string, unknown>
        : null;
      const incomeItems = db.prepare('SELECT * FROM income_items WHERE return_id = ?').all(session.return_id);
      const deductionItems = db.prepare('SELECT * FROM deductions WHERE return_id = ?').all(session.return_id);
      const dependentItems = db.prepare('SELECT * FROM dependents WHERE return_id = ?').all(session.return_id);

      // Determine which forms are needed
      const formsNeeded: string[] = ['1040'];
      const incomeCategories = new Set((incomeItems as Array<Record<string, unknown>>).map(i => i.category));
      const deductionCategories = new Set((deductionItems as Array<Record<string, unknown>>).map(d => d.category));

      if (incomeCategories.has('self_employment')) formsNeeded.push('Schedule C', 'Schedule SE');
      if (incomeCategories.has('capital_gains')) formsNeeded.push('Schedule D', 'Form 8949');
      if (incomeCategories.has('rental')) formsNeeded.push('Schedule E');
      if (incomeCategories.has('interest') || incomeCategories.has('dividends')) formsNeeded.push('Schedule B');
      if (deductionCategories.has('itemized')) formsNeeded.push('Schedule A');
      if (dependentItems.length > 0) formsNeeded.push('Schedule 8812');
      if (Number(taxReturn.self_employment_tax || 0) > 0) formsNeeded.push('Schedule SE');
      if (Number(taxReturn.amt_amount || 0) > 0) formsNeeded.push('Form 6251');

      // Update return with forms list
      db.prepare('UPDATE tax_returns SET status = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run('calculated', session.return_id);

      const userId = c.get('userId') || 'api-user';
      logAudit(db, {
        return_id: session.return_id,
        client_id: session.client_id || undefined,
        user_id: userId,
        action: 'forms_generated_via_preparer',
        entity_type: 'tax_return',
        entity_id: session.return_id,
        details: { forms: formsNeeded },
      });

      return c.json({
        success: true,
        data: {
          session_id: sessionId,
          return_id: session.return_id,
          forms_generated: formsNeeded,
          message: `Generated ${formsNeeded.length} tax forms. PDF and MeF XML available via /api/v5/efile endpoints.`,
          next_steps: [
            'Review generated forms via /api/v5/efile/preview',
            'E-file via /api/v5/efile/submit',
            'Download PDF via /api/v5/efile/pdf',
          ],
        },
      });
    } catch (err) {
      log.error({ err, sessionId }, 'Form generation failed');
      return c.json({
        success: false,
        error: `Form generation failed: ${(err as Error).message}`,
      }, 500);
    }
  });

  // ─── POST /smart-prepare — One-shot full return preparation ───────
  router.post('/smart-prepare', async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }

    if (!body.taxpayer) {
      return c.json({ success: false, error: 'taxpayer object is required' }, 400);
    }

    const taxpayer = body.taxpayer as Record<string, unknown>;
    if (!taxpayer.first_name || !taxpayer.last_name || !taxpayer.filing_status) {
      return c.json({
        success: false,
        error: 'taxpayer must include at minimum: first_name, last_name, filing_status',
      }, 400);
    }

    try {
      const userId = c.get('userId') || 'api-user';
      const result = await preparer.smartPrepare(body as any, userId);

      return c.json({
        success: true,
        data: {
          ...result,
          message: 'Tax return prepared and calculated via smart one-shot mode.',
        },
      });
    } catch (err) {
      log.error({ err }, 'Smart prepare failed');
      return c.json({
        success: false,
        error: `Smart prepare failed: ${(err as Error).message}`,
      }, 500);
    }
  });

  // ─── POST /ask-claude — Direct Claude query with return context ───
  router.post('/ask-claude', async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }

    const sessionId = body.session_id as string;
    const question = body.question as string;

    if (!question) {
      return c.json({ success: false, error: 'question is required' }, 400);
    }

    // If session provided, use session context
    if (sessionId) {
      const session = preparer.getSession(sessionId);
      if (!session) {
        return c.json({ success: false, error: 'Session not found' }, 404);
      }

      try {
        const result = await preparer.askClaudeWithContext(session, question);

        return c.json({
          success: true,
          data: {
            session_id: sessionId,
            question,
            answer: result.answer,
            engine_consulted: result.engine_consulted,
          },
        });
      } catch (err) {
        log.error({ err, sessionId }, 'Claude query failed');
        return c.json({
          success: false,
          error: `Claude query failed: ${(err as Error).message}`,
        }, 500);
      }
    }

    // No session — general tax question with engine consultation
    try {
      const engineResult = await queryEngineRuntime('TIE', question);
      const { askClaude } = await import('../services/return-preparer');

      const answer = await askClaude(
        `You are an expert tax advisor powered by the Echo Tax Return Ultimate platform with access to IRS doctrine engines. Answer the following tax question accurately and helpfully.

Engine guidance (if available): ${JSON.stringify(engineResult)}`,
        question,
      );

      return c.json({
        success: true,
        data: {
          question,
          answer,
          engine_consulted: (engineResult as Record<string, unknown>)?.success === true,
        },
      });
    } catch (err) {
      log.error({ err }, 'Claude query (no session) failed');
      return c.json({
        success: false,
        error: `Claude query failed: ${(err as Error).message}`,
      }, 500);
    }
  });

  // ─── GET / — List sessions for current user ───────────────────────
  router.get('/', async (c) => {
    const userId = c.get('userId') || 'api-user';
    const status = c.req.query('status');
    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') || '25', 10), 100);
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE user_id = ?';
    const args: unknown[] = [userId];

    if (status) {
      whereClause += ' AND status = ?';
      args.push(status);
    }

    const countRow = db.prepare(`SELECT COUNT(*) as count FROM preparer_sessions ${whereClause}`).get(...args) as { count: number };
    const sessions = db.prepare(
      `SELECT id, user_id, status, phase, client_id, return_id, created_at, updated_at
       FROM preparer_sessions ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...args, limit, offset);

    return c.json({
      success: true,
      data: sessions,
      pagination: {
        total: countRow.count,
        page,
        limit,
        pages: Math.ceil(countRow.count / limit),
      },
    });
  });

  // ─── DELETE /:sessionId — Delete a session ────────────────────────
  router.delete('/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId');
    const result = db.prepare('DELETE FROM preparer_sessions WHERE id = ?').run(sessionId);

    if (result.changes === 0) {
      return c.json({ success: false, error: 'Session not found' }, 404);
    }

    const userId = c.get('userId') || 'api-user';
    logAudit(db, {
      user_id: userId,
      action: 'preparer_session_deleted',
      entity_type: 'preparer_session',
      entity_id: sessionId,
    });

    return c.json({ success: true, message: 'Session deleted' });
  });

  return router;
}

// ─── Utility: Flatten nested object for counting ────────────────────

function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, fullKey));
    } else if (value !== undefined && value !== null) {
      result[fullKey] = value;
    }
  }
  return result;
}
