// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Income Item Routes
// ═══════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { CreateIncomeSchema } from '../types/tax';
import { getById, listPaginated, update, remove, logAudit } from '../services/database';
import { createLogger } from '../utils/logger';

const log = createLogger('income');

// ─── W-2 Form Line Mappings ────────────────────────────────────────────
const W2_FIELD_MAP: Record<string, { category: string; formLine: string }> = {
  wages: { category: 'wages', formLine: '1' },
  federal_withheld: { category: 'wages', formLine: '2' },
  ss_wages: { category: 'wages', formLine: '3' },
  ss_withheld: { category: 'wages', formLine: '4' },
  medicare_wages: { category: 'wages', formLine: '5' },
  medicare_withheld: { category: 'wages', formLine: '6' },
  tips: { category: 'tips', formLine: '7' },
  allocated_tips: { category: 'tips', formLine: '8' },
  dependent_care: { category: 'other', formLine: '10' },
  nonqualified_plans: { category: 'other', formLine: '11' },
  box12_codes: { category: 'other', formLine: '12' },
  statutory_employee: { category: 'wages', formLine: '13' },
  retirement_plan: { category: 'other', formLine: '13' },
  third_party_sick: { category: 'other', formLine: '13' },
  state_wages: { category: 'wages', formLine: '16' },
  state_withheld: { category: 'wages', formLine: '17' },
  local_wages: { category: 'wages', formLine: '18' },
  local_withheld: { category: 'wages', formLine: '19' },
};

// ─── Income Category → 1040 Line Mapping ──────────────────────────────
const CATEGORY_LINE_MAP: Record<string, string> = {
  wages: '1a', salary: '1a', tips: '1a',
  interest: '2b', dividends: '3b', qualified_dividends: '3a',
  business: '8', capital_gains: '7', capital_gains_short: '7',
  capital_gains_long: '7', rental: '8', royalty: '8',
  partnership: '8', s_corp: '8', trust: '8', farm: '8',
  unemployment: '7', social_security: '6b', pension: '5b',
  annuity: '5b', ira_distribution: '4b', alimony: '2a',
  gambling: '8', crypto: '7', staking: '8', mining: '8',
  nec_1099: '8', misc_1099: '8', state_refund: '1',
  foreign: '8', other: '8',
};

export function incomeRoutes(db: Database) {
  const router = new Hono();

  // POST / — Add income item to return
  router.post('/', async (c) => {
    const body = await c.req.json();
    const returnId = body.return_id;
    if (!returnId) return c.json({ success: false, error: 'return_id is required' }, 400);

    const parsed = CreateIncomeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    // Verify return exists and is editable
    const taxReturn = getById(db, 'tax_returns', returnId) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);
    if (taxReturn.status === 'locked' || taxReturn.status === 'filed' || taxReturn.status === 'accepted') {
      return c.json({ success: false, error: 'Return is locked/filed and cannot be modified' }, 403);
    }

    const input = parsed.data;
    const id = crypto.randomUUID().replace(/-/g, '');
    const formLine = CATEGORY_LINE_MAP[input.category] || '8';

    db.prepare(`
      INSERT INTO income_items (id, return_id, category, subcategory, description, payer_name, payer_ein,
        amount, tax_withheld, state_withheld, local_withheld, form_type, form_line, state, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, returnId, input.category, input.subcategory || null,
      input.description || null, input.payer_name || null, input.payer_ein || null,
      input.amount, input.tax_withheld, input.state_withheld, input.local_withheld,
      input.form_type || null, formLine, input.state || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    );

    logAudit(db, {
      return_id: returnId,
      user_id: c.get('userId'),
      action: 'income_added',
      entity_type: 'income_item',
      entity_id: id,
      details: { category: input.category, amount: input.amount },
    });

    log.info({ incomeId: id, returnId, category: input.category, amount: input.amount }, 'Income item added');
    const item = getById(db, 'income_items', id);
    return c.json({ success: true, data: item }, 201);
  });

  // GET /:returnId — List income items for return
  router.get('/:returnId', (c) => {
    const returnId = c.req.param('returnId');
    const category = c.req.query('category');
    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 200);

    const conditions: string[] = ['return_id = ?'];
    const args: unknown[] = [returnId];

    if (category) { conditions.push('category = ?'); args.push(category); }

    const result = listPaginated(db, 'income_items', {
      page,
      limit,
      where: conditions.join(' AND '),
      args,
      orderBy: 'category ASC, amount DESC',
    });

    // Compute totals
    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) as total_income,
        COALESCE(SUM(tax_withheld), 0) as total_federal_withheld,
        COALESCE(SUM(state_withheld), 0) as total_state_withheld,
        COALESCE(SUM(local_withheld), 0) as total_local_withheld,
        COUNT(*) as item_count
      FROM income_items WHERE return_id = ?
    `).get(returnId) as Record<string, number>;

    return c.json({ success: true, ...result, totals });
  });

  // PUT /:incomeId — Update income item
  router.put('/:incomeId', async (c) => {
    const id = c.req.param('incomeId');
    const existing = getById(db, 'income_items', id) as Record<string, unknown> | undefined;
    if (!existing) return c.json({ success: false, error: 'Income item not found' }, 404);

    // Verify parent return is editable
    const taxReturn = getById(db, 'tax_returns', existing.return_id as string) as Record<string, unknown> | undefined;
    if (taxReturn && (taxReturn.status === 'locked' || taxReturn.status === 'filed')) {
      return c.json({ success: false, error: 'Return is locked/filed' }, 403);
    }

    const body = await c.req.json();

    // Update form_line if category changed
    if (body.category && body.category !== existing.category) {
      body.form_line = CATEGORY_LINE_MAP[body.category] || '8';
    }

    if (body.metadata && typeof body.metadata === 'object') {
      body.metadata = JSON.stringify(body.metadata);
    }

    update(db, 'income_items', id, body);

    logAudit(db, {
      return_id: existing.return_id as string,
      user_id: c.get('userId'),
      action: 'income_updated',
      entity_type: 'income_item',
      entity_id: id,
      details: { fields_updated: Object.keys(body) },
    });

    const updated = getById(db, 'income_items', id);
    return c.json({ success: true, data: updated });
  });

  // DELETE /:incomeId — Delete income item
  router.delete('/:incomeId', (c) => {
    const id = c.req.param('incomeId');
    const existing = getById(db, 'income_items', id) as Record<string, unknown> | undefined;
    if (!existing) return c.json({ success: false, error: 'Income item not found' }, 404);

    const taxReturn = getById(db, 'tax_returns', existing.return_id as string) as Record<string, unknown> | undefined;
    if (taxReturn && (taxReturn.status === 'locked' || taxReturn.status === 'filed')) {
      return c.json({ success: false, error: 'Return is locked/filed' }, 403);
    }

    remove(db, 'income_items', id);

    logAudit(db, {
      return_id: existing.return_id as string,
      user_id: c.get('userId'),
      action: 'income_deleted',
      entity_type: 'income_item',
      entity_id: id,
      details: { category: existing.category, amount: existing.amount },
    });

    return c.json({ success: true, message: 'Income item deleted' });
  });

  // POST /:returnId/import-w2 — Import W-2 data
  router.post('/:returnId/import-w2', async (c) => {
    const returnId = c.req.param('returnId');
    const taxReturn = getById(db, 'tax_returns', returnId) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);
    if (taxReturn.status === 'locked' || taxReturn.status === 'filed') {
      return c.json({ success: false, error: 'Return is locked/filed' }, 403);
    }

    const body = await c.req.json();
    const { employer_name, employer_ein, state_code, ...w2Fields } = body;

    if (!employer_name) return c.json({ success: false, error: 'employer_name is required' }, 400);

    const createdItems: string[] = [];
    const insertStmt = db.prepare(`
      INSERT INTO income_items (id, return_id, category, subcategory, description, payer_name, payer_ein,
        amount, tax_withheld, state_withheld, local_withheld, form_type, form_line, state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertW2 = db.transaction(() => {
      // Wages (Box 1)
      if (w2Fields.wages && w2Fields.wages > 0) {
        const id = crypto.randomUUID().replace(/-/g, '');
        insertStmt.run(id, returnId, 'wages', 'w2_box1', `W-2 Wages from ${employer_name}`,
          employer_name, employer_ein || null,
          w2Fields.wages, w2Fields.federal_withheld || 0,
          w2Fields.state_withheld || 0, w2Fields.local_withheld || 0,
          'W-2', '1a', state_code || null);
        createdItems.push(id);
      }

      // Tips (Box 7)
      if (w2Fields.tips && w2Fields.tips > 0) {
        const id = crypto.randomUUID().replace(/-/g, '');
        insertStmt.run(id, returnId, 'tips', 'w2_box7', `W-2 Tips from ${employer_name}`,
          employer_name, employer_ein || null,
          w2Fields.tips, 0, 0, 0, 'W-2', '1a', state_code || null);
        createdItems.push(id);
      }

      // Allocated Tips (Box 8) — reported separately
      if (w2Fields.allocated_tips && w2Fields.allocated_tips > 0) {
        const id = crypto.randomUUID().replace(/-/g, '');
        insertStmt.run(id, returnId, 'tips', 'w2_box8_allocated', `W-2 Allocated Tips from ${employer_name}`,
          employer_name, employer_ein || null,
          w2Fields.allocated_tips, 0, 0, 0, 'W-2', '1a', state_code || null);
        createdItems.push(id);
      }

      // Dependent care benefits (Box 10)
      if (w2Fields.dependent_care && w2Fields.dependent_care > 0) {
        const id = crypto.randomUUID().replace(/-/g, '');
        insertStmt.run(id, returnId, 'other', 'w2_box10_dependent_care', `W-2 Dependent Care Benefits from ${employer_name}`,
          employer_name, employer_ein || null,
          w2Fields.dependent_care, 0, 0, 0, 'W-2', '8', state_code || null);
        createdItems.push(id);
      }
    });

    insertW2();

    logAudit(db, {
      return_id: returnId,
      user_id: c.get('userId'),
      action: 'w2_imported',
      entity_type: 'income_item',
      entity_id: createdItems[0] || returnId,
      details: { employer: employer_name, items_created: createdItems.length },
    });

    log.info({ returnId, employer: employer_name, itemCount: createdItems.length }, 'W-2 imported');
    return c.json({ success: true, data: { items_created: createdItems.length, item_ids: createdItems } }, 201);
  });

  // GET /:returnId/analysis — Income analysis with categorization
  router.get('/:returnId/analysis', (c) => {
    const returnId = c.req.param('returnId');
    const taxReturn = getById(db, 'tax_returns', returnId) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);

    // Category breakdown
    const byCategory = db.prepare(`
      SELECT category, COUNT(*) as count, SUM(amount) as total,
             AVG(amount) as avg_amount, MIN(amount) as min_amount, MAX(amount) as max_amount
      FROM income_items WHERE return_id = ? GROUP BY category ORDER BY total DESC
    `).all(returnId) as Record<string, unknown>[];

    // Source breakdown (by payer)
    const byPayer = db.prepare(`
      SELECT payer_name, COUNT(*) as count, SUM(amount) as total
      FROM income_items WHERE return_id = ? AND payer_name IS NOT NULL GROUP BY payer_name ORDER BY total DESC
    `).all(returnId) as Record<string, unknown>[];

    // Withholding summary
    const withholding = db.prepare(`
      SELECT
        COALESCE(SUM(tax_withheld), 0) as federal_withheld,
        COALESCE(SUM(state_withheld), 0) as state_withheld,
        COALESCE(SUM(local_withheld), 0) as local_withheld,
        COALESCE(SUM(tax_withheld + state_withheld + local_withheld), 0) as total_withheld
      FROM income_items WHERE return_id = ?
    `).get(returnId) as Record<string, number>;

    // Income type classification for 1040
    const earnedIncome = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM income_items WHERE return_id = ? AND category IN ('wages', 'salary', 'tips', 'business', 'nec_1099', 'farm')
    `).get(returnId) as { total: number };

    const investmentIncome = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM income_items WHERE return_id = ? AND category IN ('interest', 'dividends', 'qualified_dividends',
        'capital_gains', 'capital_gains_short', 'capital_gains_long', 'rental', 'royalty', 'crypto', 'staking', 'mining')
    `).get(returnId) as { total: number };

    const passiveIncome = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM income_items WHERE return_id = ? AND category IN ('rental', 'partnership', 's_corp', 'trust')
    `).get(returnId) as { total: number };

    const totalIncome = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM income_items WHERE return_id = ?
    `).get(returnId) as { total: number };

    // Determine if NIIT risk exists (investment income + AGI threshold)
    const niitThresholds: Record<string, number> = {
      single: 200_000, mfj: 250_000, mfs: 125_000, hoh: 200_000, qss: 250_000,
    };
    const client = getById(db, 'clients', taxReturn.client_id as string) as Record<string, unknown> | undefined;
    const filingStatus = (client?.filing_status as string) || 'single';
    const niitThreshold = niitThresholds[filingStatus] || 200_000;
    const niitRisk = investmentIncome.total > 0 && totalIncome.total > niitThreshold;

    // Self-employment income detection
    const selfEmployment = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM income_items WHERE return_id = ? AND category IN ('business', 'nec_1099', 'farm')
    `).get(returnId) as { total: number };

    return c.json({
      success: true,
      data: {
        total_income: totalIncome.total,
        by_category: byCategory,
        by_payer: byPayer,
        withholding,
        classification: {
          earned_income: earnedIncome.total,
          investment_income: investmentIncome.total,
          passive_income: passiveIncome.total,
          self_employment_income: selfEmployment.total,
        },
        flags: {
          has_self_employment: selfEmployment.total > 0,
          niit_risk: niitRisk,
          niit_threshold: niitThreshold,
          has_capital_gains: byCategory.some((r) => (r.category as string).includes('capital_gains')),
          multi_state: new Set(
            (db.prepare('SELECT DISTINCT state FROM income_items WHERE return_id = ? AND state IS NOT NULL').all(returnId) as { state: string }[]).map(r => r.state)
          ).size > 1,
          state_count: new Set(
            (db.prepare('SELECT DISTINCT state FROM income_items WHERE return_id = ? AND state IS NOT NULL').all(returnId) as { state: string }[]).map(r => r.state)
          ).size,
        },
      },
    });
  });

  return router;
}
