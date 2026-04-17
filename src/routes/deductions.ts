// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Deduction Routes
// ═══════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { CreateDeductionSchema } from '../types/tax';
import { getById, listPaginated, update, remove, logAudit } from '../services/database';
import { createLogger } from '../utils/logger';

const log = createLogger('deductions');

// ─── Standard Deduction Amounts by Year ────────────────────────────────
const STANDARD_DEDUCTIONS: Record<number, Record<string, number>> = {
  2024: { single: 14_600, mfj: 29_200, mfs: 14_600, hoh: 21_900, qss: 29_200 },
  2025: { single: 15_000, mfj: 30_000, mfs: 15_000, hoh: 22_500, qss: 30_000 },
  2026: { single: 15_400, mfj: 30_800, mfs: 15_400, hoh: 23_100, qss: 30_800 },
};

const ADDITIONAL_STANDARD_65_BLIND: Record<number, Record<string, number>> = {
  2024: { single: 1_950, mfj: 1_550, mfs: 1_550, hoh: 1_950, qss: 1_550 },
  2025: { single: 2_000, mfj: 1_600, mfs: 1_600, hoh: 2_000, qss: 1_600 },
  2026: { single: 2_050, mfj: 1_650, mfs: 1_650, hoh: 2_050, qss: 1_650 },
};

// ─── SALT Cap ──────────────────────────────────────────────────────────
const SALT_CAP = 10_000;
const SALT_CAP_MFS = 5_000;

// ─── Itemized Categories ───────────────────────────────────────────────
const ITEMIZED_CATEGORIES = new Set([
  'mortgage_interest', 'state_local_taxes', 'property_taxes', 'charitable_cash',
  'charitable_noncash', 'medical', 'casualty_loss', 'gambling_loss',
  'other_itemized', 'investment_expense',
]);

const ABOVE_LINE_CATEGORIES = new Set([
  'student_loan_interest', 'educator_expense', 'hsa_contribution', 'ira_contribution',
  'self_employment_tax_deduction', 'self_employment_health', 'penalty_early_withdrawal',
  'moving_expense_military', 'alimony_paid', 'other_above_line',
]);

const SCHEDULE_C_CATEGORIES = new Set([
  'home_office', 'vehicle', 'depreciation', 'business_expense',
]);

// ─── AGI-Based Limitation Rules ────────────────────────────────────────
const MEDICAL_AGI_THRESHOLD = 0.075; // 7.5% of AGI
const CHARITABLE_CASH_AGI_LIMIT = 0.60; // 60% of AGI
const CHARITABLE_NONCASH_AGI_LIMIT = 0.30; // 30% of AGI

export function deductionRoutes(db: Database) {
  const router = new Hono();

  // POST / — Add deduction to return
  router.post('/', async (c) => {
    const body = await c.req.json();
    const returnId = body.return_id;
    if (!returnId) return c.json({ success: false, error: 'return_id is required' }, 400);

    const parsed = CreateDeductionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const taxReturn = getById(db, 'tax_returns', returnId) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);
    if (taxReturn.status === 'locked' || taxReturn.status === 'filed') {
      return c.json({ success: false, error: 'Return is locked/filed' }, 403);
    }

    const input = parsed.data;
    const id = crypto.randomUUID().replace(/-/g, '');

    // Determine schedule
    let schedule = input.schedule || null;
    if (!schedule) {
      if (ITEMIZED_CATEGORIES.has(input.category)) schedule = 'A';
      else if (SCHEDULE_C_CATEGORIES.has(input.category)) schedule = 'C';
      else if (ABOVE_LINE_CATEGORIES.has(input.category)) schedule = '1040_adjustments';
    }

    // Determine form line
    let formLine: string | null = null;
    switch (input.category) {
      case 'medical': formLine = 'Schedule A, Line 4'; break;
      case 'state_local_taxes': formLine = 'Schedule A, Line 5a'; break;
      case 'property_taxes': formLine = 'Schedule A, Line 5b'; break;
      case 'mortgage_interest': formLine = 'Schedule A, Line 8a'; break;
      case 'charitable_cash': formLine = 'Schedule A, Line 12'; break;
      case 'charitable_noncash': formLine = 'Schedule A, Line 12'; break;
      case 'student_loan_interest': formLine = 'Schedule 1, Line 21'; break;
      case 'educator_expense': formLine = 'Schedule 1, Line 11'; break;
      case 'hsa_contribution': formLine = 'Schedule 1, Line 13'; break;
      case 'ira_contribution': formLine = 'Schedule 1, Line 20'; break;
      case 'self_employment_tax_deduction': formLine = 'Schedule 1, Line 15'; break;
      case 'self_employment_health': formLine = 'Schedule 1, Line 17'; break;
      case 'home_office': formLine = 'Schedule C, Line 30'; break;
      case 'vehicle': formLine = 'Schedule C, Line 9'; break;
    }

    db.prepare(`
      INSERT INTO deductions (id, return_id, category, subcategory, description, amount,
        schedule, form_line, carryover_amount, carryover_year)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, returnId, input.category, input.subcategory || null,
      input.description || null, input.amount, schedule, formLine,
      input.carryover_amount, input.carryover_year || null,
    );

    logAudit(db, {
      return_id: returnId,
      user_id: c.get('userId'),
      action: 'deduction_added',
      entity_type: 'deduction',
      entity_id: id,
      details: { category: input.category, amount: input.amount },
    });

    log.info({ deductionId: id, returnId, category: input.category, amount: input.amount }, 'Deduction added');
    const item = getById(db, 'deductions', id);
    return c.json({ success: true, data: item }, 201);
  });

  // GET /:returnId — List deductions for return
  router.get('/:returnId', (c) => {
    const returnId = c.req.param('returnId');
    const category = c.req.query('category');
    const schedule = c.req.query('schedule');
    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 200);

    const conditions: string[] = ['return_id = ?'];
    const args: unknown[] = [returnId];

    if (category) { conditions.push('category = ?'); args.push(category); }
    if (schedule) { conditions.push('schedule = ?'); args.push(schedule); }

    const result = listPaginated(db, 'deductions', {
      page,
      limit,
      where: conditions.join(' AND '),
      args,
      orderBy: 'schedule ASC, category ASC, amount DESC',
    });

    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) as total_deductions,
        COALESCE(SUM(CASE WHEN schedule = 'A' THEN amount ELSE 0 END), 0) as total_itemized,
        COALESCE(SUM(CASE WHEN schedule = '1040_adjustments' THEN amount ELSE 0 END), 0) as total_above_line,
        COALESCE(SUM(CASE WHEN schedule = 'C' THEN amount ELSE 0 END), 0) as total_schedule_c,
        COALESCE(SUM(carryover_amount), 0) as total_carryover,
        COUNT(*) as item_count
      FROM deductions WHERE return_id = ?
    `).get(returnId) as Record<string, number>;

    return c.json({ success: true, ...result, totals });
  });

  // PUT /:dedId — Update deduction
  router.put('/:dedId', async (c) => {
    const id = c.req.param('dedId');
    const existing = getById(db, 'deductions', id) as Record<string, unknown> | undefined;
    if (!existing) return c.json({ success: false, error: 'Deduction not found' }, 404);

    const taxReturn = getById(db, 'tax_returns', existing.return_id as string) as Record<string, unknown> | undefined;
    if (taxReturn && (taxReturn.status === 'locked' || taxReturn.status === 'filed')) {
      return c.json({ success: false, error: 'Return is locked/filed' }, 403);
    }

    const body = await c.req.json();
    update(db, 'deductions', id, body);

    logAudit(db, {
      return_id: existing.return_id as string,
      user_id: c.get('userId'),
      action: 'deduction_updated',
      entity_type: 'deduction',
      entity_id: id,
      details: { fields_updated: Object.keys(body) },
    });

    const updated = getById(db, 'deductions', id);
    return c.json({ success: true, data: updated });
  });

  // DELETE /:dedId — Delete deduction
  router.delete('/:dedId', (c) => {
    const id = c.req.param('dedId');
    const existing = getById(db, 'deductions', id) as Record<string, unknown> | undefined;
    if (!existing) return c.json({ success: false, error: 'Deduction not found' }, 404);

    const taxReturn = getById(db, 'tax_returns', existing.return_id as string) as Record<string, unknown> | undefined;
    if (taxReturn && (taxReturn.status === 'locked' || taxReturn.status === 'filed')) {
      return c.json({ success: false, error: 'Return is locked/filed' }, 403);
    }

    remove(db, 'deductions', id);

    logAudit(db, {
      return_id: existing.return_id as string,
      user_id: c.get('userId'),
      action: 'deduction_deleted',
      entity_type: 'deduction',
      entity_id: id,
      details: { category: existing.category, amount: existing.amount },
    });

    return c.json({ success: true, message: 'Deduction deleted' });
  });

  // GET /:returnId/optimize — Optimal deduction strategy
  router.get('/:returnId/optimize', (c) => {
    const returnId = c.req.param('returnId');
    const taxReturn = getById(db, 'tax_returns', returnId) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);

    const client = getById(db, 'clients', taxReturn.client_id as string) as Record<string, unknown> | undefined;
    const filingStatus = (client?.filing_status as string) || 'single';
    const taxYear = (taxReturn.tax_year as number) || 2025;
    const yearData = STANDARD_DEDUCTIONS[taxYear] || STANDARD_DEDUCTIONS[2025];
    const standardAmount = yearData[filingStatus] || yearData.single;

    // Calculate itemized total with limitations
    const agi = (taxReturn.adjusted_gross_income as number) || 0;

    // Medical — only amount exceeding 7.5% of AGI
    const medicalRaw = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM deductions WHERE return_id = ? AND category = 'medical'
    `).get(returnId) as { total: number };
    const medicalFloor = agi * MEDICAL_AGI_THRESHOLD;
    const medicalAllowed = Math.max(0, medicalRaw.total - medicalFloor);

    // SALT — capped at $10,000 ($5,000 MFS)
    const saltRaw = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM deductions WHERE return_id = ? AND category IN ('state_local_taxes', 'property_taxes')
    `).get(returnId) as { total: number };
    const saltCap = filingStatus === 'mfs' ? SALT_CAP_MFS : SALT_CAP;
    const saltAllowed = Math.min(saltRaw.total, saltCap);
    const saltLimited = saltRaw.total > saltCap;

    // Mortgage interest
    const mortgageTotal = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM deductions WHERE return_id = ? AND category = 'mortgage_interest'
    `).get(returnId) as { total: number };

    // Charitable — limited by AGI
    const charitableCash = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM deductions WHERE return_id = ? AND category = 'charitable_cash'
    `).get(returnId) as { total: number };
    const charitableNonCash = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM deductions WHERE return_id = ? AND category = 'charitable_noncash'
    `).get(returnId) as { total: number };
    const charitableCashLimit = agi * CHARITABLE_CASH_AGI_LIMIT;
    const charitableNonCashLimit = agi * CHARITABLE_NONCASH_AGI_LIMIT;
    const charitableCashAllowed = Math.min(charitableCash.total, charitableCashLimit);
    const charitableNonCashAllowed = Math.min(charitableNonCash.total, charitableNonCashLimit);
    const charitableCarryover = Math.max(0, charitableCash.total - charitableCashLimit) + Math.max(0, charitableNonCash.total - charitableNonCashLimit);

    // Other itemized (gambling losses, casualty, etc.)
    const otherItemized = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM deductions WHERE return_id = ?
        AND category IN ('casualty_loss', 'gambling_loss', 'investment_expense', 'other_itemized')
    `).get(returnId) as { total: number };

    const totalItemized = medicalAllowed + saltAllowed + mortgageTotal.total +
      charitableCashAllowed + charitableNonCashAllowed + otherItemized.total;

    const recommendation = totalItemized > standardAmount ? 'itemized' : 'standard';
    const benefit = recommendation === 'itemized'
      ? totalItemized - standardAmount
      : standardAmount - totalItemized;

    const suggestions: string[] = [];
    if (saltLimited) {
      suggestions.push(`SALT deductions capped at $${saltCap.toLocaleString()}. $${(saltRaw.total - saltCap).toLocaleString()} in excess taxes not deductible.`);
    }
    if (medicalRaw.total > 0 && medicalAllowed === 0) {
      suggestions.push(`Medical expenses ($${medicalRaw.total.toLocaleString()}) below 7.5% AGI threshold ($${medicalFloor.toLocaleString()}).`);
    }
    if (charitableCarryover > 0) {
      suggestions.push(`$${charitableCarryover.toLocaleString()} in charitable contributions can be carried forward up to 5 years.`);
    }
    if (recommendation === 'standard' && totalItemized > standardAmount * 0.8) {
      suggestions.push('Itemized deductions are close to standard deduction. Consider bunching charitable contributions.');
    }
    if (recommendation === 'itemized' && benefit < 2000) {
      suggestions.push('Itemized benefit is small. Verify all deductions are documented for audit protection.');
    }

    return c.json({
      success: true,
      data: {
        recommendation,
        standard_deduction: standardAmount,
        itemized_total: totalItemized,
        benefit_amount: benefit,
        breakdown: {
          medical: { raw: medicalRaw.total, floor: medicalFloor, allowed: medicalAllowed },
          salt: { raw: saltRaw.total, cap: saltCap, allowed: saltAllowed, limited: saltLimited },
          mortgage_interest: mortgageTotal.total,
          charitable_cash: { raw: charitableCash.total, limit: charitableCashLimit, allowed: charitableCashAllowed },
          charitable_noncash: { raw: charitableNonCash.total, limit: charitableNonCashLimit, allowed: charitableNonCashAllowed },
          charitable_carryover: charitableCarryover,
          other_itemized: otherItemized.total,
        },
        suggestions,
      },
    });
  });

  // GET /:returnId/standard-vs-itemized — Side-by-side comparison
  router.get('/:returnId/standard-vs-itemized', (c) => {
    const returnId = c.req.param('returnId');
    const taxReturn = getById(db, 'tax_returns', returnId) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);

    const client = getById(db, 'clients', taxReturn.client_id as string) as Record<string, unknown> | undefined;
    const filingStatus = (client?.filing_status as string) || 'single';
    const taxYear = (taxReturn.tax_year as number) || 2025;
    const yearData = STANDARD_DEDUCTIONS[taxYear] || STANDARD_DEDUCTIONS[2025];
    const standardAmount = yearData[filingStatus] || yearData.single;

    // All itemized deductions by category
    const itemizedByCategory = db.prepare(`
      SELECT category, SUM(amount) as total, COUNT(*) as count
      FROM deductions WHERE return_id = ? AND schedule = 'A'
      GROUP BY category ORDER BY total DESC
    `).all(returnId) as Record<string, unknown>[];

    const itemizedTotal = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM deductions WHERE return_id = ? AND schedule = 'A'
    `).get(returnId) as { total: number };

    // Above-the-line deductions (same either way)
    const aboveLine = db.prepare(`
      SELECT category, SUM(amount) as total FROM deductions WHERE return_id = ? AND schedule = '1040_adjustments'
      GROUP BY category ORDER BY total DESC
    `).all(returnId) as Record<string, unknown>[];

    const aboveLineTotal = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM deductions WHERE return_id = ? AND schedule = '1040_adjustments'
    `).get(returnId) as { total: number };

    const totalIncome = (taxReturn.total_income as number) || 0;
    const agi = totalIncome - aboveLineTotal.total;

    // Estimate marginal rate for tax savings calculation
    const marginalRates: Record<string, number[]> = {
      single: [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37],
      mfj: [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37],
      mfs: [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37],
      hoh: [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37],
      qss: [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37],
    };

    // Simplified marginal rate estimate based on AGI
    let estimatedRate = 0.22; // default
    if (agi < 45_000) estimatedRate = 0.12;
    else if (agi < 95_000) estimatedRate = 0.22;
    else if (agi < 180_000) estimatedRate = 0.24;
    else if (agi < 340_000) estimatedRate = 0.32;
    else if (agi < 430_000) estimatedRate = 0.35;
    else estimatedRate = 0.37;

    const standardTaxable = Math.max(0, agi - standardAmount);
    const itemizedTaxable = Math.max(0, agi - itemizedTotal.total);
    const taxSavings = Math.abs(standardTaxable - itemizedTaxable) * estimatedRate;

    return c.json({
      success: true,
      data: {
        filing_status: filingStatus,
        tax_year: taxYear,
        agi_estimate: agi,
        estimated_marginal_rate: estimatedRate,
        standard: {
          amount: standardAmount,
          taxable_income: standardTaxable,
        },
        itemized: {
          total: itemizedTotal.total,
          taxable_income: itemizedTaxable,
          by_category: itemizedByCategory,
        },
        above_line: {
          total: aboveLineTotal.total,
          by_category: aboveLine,
          note: 'Above-the-line deductions apply regardless of standard vs itemized choice',
        },
        recommendation: itemizedTotal.total > standardAmount ? 'itemized' : 'standard',
        difference: Math.abs(itemizedTotal.total - standardAmount),
        estimated_tax_savings: Math.round(taxSavings * 100) / 100,
      },
    });
  });

  return router;
}
