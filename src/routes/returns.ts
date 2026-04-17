// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Tax Return Routes
// ═══════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { CreateReturnSchema } from '../types/tax';
import { getById, listPaginated, update, remove, logAudit } from '../services/database';
import { createLogger } from '../utils/logger';

const log = createLogger('returns');

export function returnRoutes(db: Database) {
  const router = new Hono();

  // POST /returns — Create new tax return
  router.post('/', async (c) => {
    const body = await c.req.json();
    const parsed = CreateReturnSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const input = parsed.data;
    const id = crypto.randomUUID().replace(/-/g, '');

    // Verify client exists
    const client = getById(db, 'clients', input.client_id);
    if (!client) return c.json({ success: false, error: 'Client not found' }, 404);

    // Check for duplicate
    const existing = db.prepare(
      'SELECT id FROM tax_returns WHERE client_id = ? AND tax_year = ? AND return_type = ?'
    ).get(input.client_id, input.tax_year, input.return_type);
    if (existing) {
      return c.json({ success: false, error: `Return already exists for ${input.tax_year} (${input.return_type})` }, 409);
    }

    db.prepare(`
      INSERT INTO tax_returns (id, client_id, tax_year, return_type, status)
      VALUES (?, ?, ?, ?, 'draft')
    `).run(id, input.client_id, input.tax_year, input.return_type);

    logAudit(db, {
      return_id: id,
      client_id: input.client_id,
      user_id: c.get('userId'),
      action: 'return_created',
      entity_type: 'tax_return',
      entity_id: id,
      details: { tax_year: input.tax_year, return_type: input.return_type },
    });

    log.info({ returnId: id, taxYear: input.tax_year }, 'Tax return created');
    const taxReturn = getById(db, 'tax_returns', id);
    return c.json({ success: true, data: taxReturn }, 201);
  });

  // GET /returns/:id — Get return details
  router.get('/:id', (c) => {
    const id = c.req.param('id');
    const taxReturn = getById(db, 'tax_returns', id);
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);

    // Include income, deductions, dependents counts
    const incomeCt = db.prepare('SELECT COUNT(*) as count FROM income_items WHERE return_id = ?').get(id) as { count: number };
    const dedCt = db.prepare('SELECT COUNT(*) as count FROM deductions WHERE return_id = ?').get(id) as { count: number };
    const depCt = db.prepare('SELECT COUNT(*) as count FROM dependents WHERE return_id = ?').get(id) as { count: number };
    const docCt = db.prepare('SELECT COUNT(*) as count FROM documents WHERE return_id = ?').get(id) as { count: number };

    return c.json({
      success: true,
      data: {
        ...taxReturn as object,
        counts: { income_items: incomeCt.count, deductions: dedCt.count, dependents: depCt.count, documents: docCt.count },
      },
    });
  });

  // GET /returns — List returns
  router.get('/', (c) => {
    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 100);
    const clientId = c.req.query('client_id');
    const taxYear = c.req.query('tax_year');
    const status = c.req.query('status');

    const conditions: string[] = [];
    const args: unknown[] = [];

    if (clientId) { conditions.push('client_id = ?'); args.push(clientId); }
    if (taxYear) { conditions.push('tax_year = ?'); args.push(parseInt(taxYear, 10)); }
    if (status) { conditions.push('status = ?'); args.push(status); }

    const result = listPaginated(db, 'tax_returns', {
      page,
      limit,
      where: conditions.length > 0 ? conditions.join(' AND ') : undefined,
      args: args.length > 0 ? args : undefined,
      orderBy: 'tax_year DESC, created_at DESC',
    });

    return c.json({ success: true, ...result });
  });

  // PUT /returns/:id — Update return
  router.put('/:id', async (c) => {
    const id = c.req.param('id');
    const existing = getById(db, 'tax_returns', id) as Record<string, unknown> | undefined;
    if (!existing) return c.json({ success: false, error: 'Return not found' }, 404);
    if (existing.status === 'locked' || existing.status === 'filed') {
      return c.json({ success: false, error: 'Return is locked/filed and cannot be modified' }, 403);
    }

    const body = await c.req.json();
    update(db, 'tax_returns', id, body);

    logAudit(db, {
      return_id: id,
      user_id: c.get('userId'),
      action: 'return_updated',
      entity_type: 'tax_return',
      entity_id: id,
      details: { fields_updated: Object.keys(body) },
    });

    const updated = getById(db, 'tax_returns', id);
    return c.json({ success: true, data: updated });
  });

  // DELETE /returns/:id
  router.delete('/:id', (c) => {
    const id = c.req.param('id');
    const existing = getById(db, 'tax_returns', id) as Record<string, unknown> | undefined;
    if (!existing) return c.json({ success: false, error: 'Return not found' }, 404);
    if (existing.status === 'filed' || existing.status === 'accepted') {
      return c.json({ success: false, error: 'Filed/accepted returns cannot be deleted' }, 403);
    }

    remove(db, 'tax_returns', id);
    logAudit(db, { return_id: id, user_id: c.get('userId'), action: 'return_deleted', entity_type: 'tax_return', entity_id: id });
    return c.json({ success: true, message: 'Return deleted' });
  });

  // GET /returns/:id/summary — Return summary
  router.get('/:id/summary', (c) => {
    const id = c.req.param('id');
    const taxReturn = getById(db, 'tax_returns', id) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);

    const income = db.prepare('SELECT category, SUM(amount) as total FROM income_items WHERE return_id = ? GROUP BY category').all(id);
    const deductions = db.prepare('SELECT category, SUM(amount) as total FROM deductions WHERE return_id = ? GROUP BY category').all(id);
    const dependents = db.prepare('SELECT first_name, last_name, relationship, qualifies_ctc, qualifies_odc FROM dependents WHERE return_id = ?').all(id);

    return c.json({
      success: true,
      data: {
        return: taxReturn,
        income_breakdown: income,
        deduction_breakdown: deductions,
        dependents,
      },
    });
  });

  // POST /returns/:id/calculate — Run full tax calculation
  router.post('/:id/calculate', async (c) => {
    const id = c.req.param('id');
    const taxReturn = getById(db, 'tax_returns', id) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);

    // Import calculation engine
    const { calculateReturn } = await import('../services/tax-calculator');
    const result = calculateReturn(db, id);

    // Update return with calculated values
    update(db, 'tax_returns', id, {
      total_income: result.total_income,
      adjusted_gross_income: result.adjusted_gross_income,
      total_adjustments: result.adjustments,
      taxable_income: result.taxable_income,
      total_tax: result.total_tax,
      total_credits: result.total_credits,
      total_payments: result.total_payments,
      refund_or_owed: result.refund_or_owed,
      effective_rate: result.effective_rate,
      marginal_rate: result.marginal_rate,
      deduction_method: result.deduction_method,
      standard_deduction_amount: result.deduction_method === 'standard' ? result.deduction_amount : 0,
      itemized_deduction_amount: result.deduction_method === 'itemized' ? result.deduction_amount : 0,
      self_employment_tax: result.self_employment_tax,
      amt_amount: result.amt,
      niit_amount: result.niit,
      qbi_deduction: result.qbi_deduction,
      status: 'calculated',
    });

    logAudit(db, {
      return_id: id,
      user_id: c.get('userId'),
      action: 'return_calculated',
      entity_type: 'tax_return',
      entity_id: id,
      details: { refund_or_owed: result.refund_or_owed },
    });

    return c.json({ success: true, data: result });
  });

  // POST /returns/:id/lock — Lock return for e-filing
  router.post('/:id/lock', (c) => {
    const id = c.req.param('id');
    const taxReturn = getById(db, 'tax_returns', id) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);
    if (taxReturn.status !== 'calculated' && taxReturn.status !== 'review') {
      return c.json({ success: false, error: 'Return must be calculated before locking' }, 400);
    }

    update(db, 'tax_returns', id, { status: 'locked', locked_at: new Date().toISOString() });
    logAudit(db, { return_id: id, user_id: c.get('userId'), action: 'return_locked', entity_type: 'tax_return', entity_id: id });
    return c.json({ success: true, message: 'Return locked for e-filing' });
  });

  // POST /returns/:id/unlock — Unlock return
  router.post('/:id/unlock', (c) => {
    const id = c.req.param('id');
    const taxReturn = getById(db, 'tax_returns', id) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);
    if (taxReturn.status !== 'locked') {
      return c.json({ success: false, error: 'Return is not locked' }, 400);
    }

    update(db, 'tax_returns', id, { status: 'calculated', locked_at: null });
    logAudit(db, { return_id: id, user_id: c.get('userId'), action: 'return_unlocked', entity_type: 'tax_return', entity_id: id });
    return c.json({ success: true, message: 'Return unlocked' });
  });

  // POST /returns/:id/clone — Clone return for what-if
  router.post('/:id/clone', (c) => {
    const id = c.req.param('id');
    const original = getById(db, 'tax_returns', id) as Record<string, unknown> | undefined;
    if (!original) return c.json({ success: false, error: 'Return not found' }, 404);

    const cloneId = crypto.randomUUID().replace(/-/g, '');

    // Clone return
    db.prepare(`
      INSERT INTO tax_returns (id, client_id, tax_year, return_type, status,
        total_income, adjusted_gross_income, taxable_income, total_tax, total_credits,
        total_payments, refund_or_owed, deduction_method)
      SELECT ?, client_id, tax_year, return_type, 'draft',
        total_income, adjusted_gross_income, taxable_income, total_tax, total_credits,
        total_payments, refund_or_owed, deduction_method
      FROM tax_returns WHERE id = ?
    `).run(cloneId, id);

    // Clone income items
    const incomeItems = db.prepare('SELECT * FROM income_items WHERE return_id = ?').all(id) as Record<string, unknown>[];
    for (const item of incomeItems) {
      const newId = crypto.randomUUID().replace(/-/g, '');
      db.prepare(`
        INSERT INTO income_items (id, return_id, category, subcategory, description, payer_name, payer_ein, amount, tax_withheld, state_withheld, form_type, form_line, state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(newId, cloneId, item.category, item.subcategory, item.description, item.payer_name, item.payer_ein, item.amount, item.tax_withheld, item.state_withheld, item.form_type, item.form_line, item.state);
    }

    // Clone deductions
    const deds = db.prepare('SELECT * FROM deductions WHERE return_id = ?').all(id) as Record<string, unknown>[];
    for (const d of deds) {
      const newId = crypto.randomUUID().replace(/-/g, '');
      db.prepare(`
        INSERT INTO deductions (id, return_id, category, subcategory, description, amount, schedule, form_line, carryover_amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(newId, cloneId, d.category, d.subcategory, d.description, d.amount, d.schedule, d.form_line, d.carryover_amount);
    }

    // Clone dependents
    const deps = db.prepare('SELECT * FROM dependents WHERE return_id = ?').all(id) as Record<string, unknown>[];
    for (const dep of deps) {
      const newId = crypto.randomUUID().replace(/-/g, '');
      db.prepare(`
        INSERT INTO dependents (id, return_id, first_name, last_name, ssn_encrypted, ssn_last4, relationship, dob, months_lived, student, disabled, gross_income, qualifies_ctc, qualifies_odc, qualifies_eic, qualifies_dependent_care)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(newId, cloneId, dep.first_name, dep.last_name, dep.ssn_encrypted, dep.ssn_last4, dep.relationship, dep.dob, dep.months_lived, dep.student, dep.disabled, dep.gross_income, dep.qualifies_ctc, dep.qualifies_odc, dep.qualifies_eic, dep.qualifies_dependent_care);
    }

    logAudit(db, { return_id: cloneId, user_id: c.get('userId'), action: 'return_cloned', entity_type: 'tax_return', entity_id: cloneId, details: { cloned_from: id } });

    const clone = getById(db, 'tax_returns', cloneId);
    return c.json({ success: true, data: clone }, 201);
  });

  // GET /returns/:id/health — Return completeness check
  router.get('/:id/health', (c) => {
    const id = c.req.param('id');
    const taxReturn = getById(db, 'tax_returns', id) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);

    const issues: string[] = [];
    const warnings: string[] = [];

    // Check for income
    const incomeCount = (db.prepare('SELECT COUNT(*) as count FROM income_items WHERE return_id = ?').get(id) as { count: number }).count;
    if (incomeCount === 0) issues.push('No income items entered');

    // Check for filing status
    const client = getById(db, 'clients', taxReturn.client_id as string) as Record<string, unknown> | undefined;
    if (!client?.filing_status) issues.push('Filing status not set');
    if (!client?.ssn_encrypted) issues.push('SSN not provided');
    if (!client?.address_zip) warnings.push('Address not complete');

    // Check dependents have SSN
    const depsNoSsn = db.prepare('SELECT COUNT(*) as count FROM dependents WHERE return_id = ? AND ssn_encrypted IS NULL').get(id) as { count: number };
    if (depsNoSsn.count > 0) warnings.push(`${depsNoSsn.count} dependent(s) missing SSN`);

    const completeness = Math.max(0, 100 - (issues.length * 20) - (warnings.length * 5));

    return c.json({
      success: true,
      data: {
        completeness_pct: completeness,
        ready_to_file: issues.length === 0,
        issues,
        warnings,
      },
    });
  });

  return router;
}
