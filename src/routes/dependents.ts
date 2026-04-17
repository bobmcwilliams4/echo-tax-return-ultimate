// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Dependent Routes
// ═══════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { CreateDependentSchema } from '../types/tax';
import { getById, listPaginated, update, remove, logAudit } from '../services/database';
import { encryptField, extractLast4 } from '../utils/encryption';
import { createLogger } from '../utils/logger';

const log = createLogger('dependents');

// ─── Credit Thresholds (2025 Tax Year) ─────────────────────────────────
const CTC_AMOUNT = 2_000;
const ODC_AMOUNT = 500;
const CTC_AGI_PHASEOUT: Record<string, number> = {
  single: 200_000, mfj: 400_000, mfs: 200_000, hoh: 200_000, qss: 400_000,
};
const CTC_PHASEOUT_RATE = 50; // $50 per $1,000 over threshold
const CTC_MAX_AGE = 17; // Under 17 at end of tax year
const QUALIFYING_RELATIVE_INCOME_LIMIT = 5_050; // 2025 estimate
const EIC_MAX_AGE = 19; // Under 19, or 24 if student
const DEPENDENT_CARE_MAX_SINGLE = 3_000;
const DEPENDENT_CARE_MAX_MULTIPLE = 6_000;
const DEPENDENT_CARE_MAX_AGE = 13;

function calculateAge(dob: string, taxYear: number): number {
  const birth = new Date(dob);
  const endOfYear = new Date(taxYear, 11, 31); // Dec 31 of tax year
  let age = endOfYear.getFullYear() - birth.getFullYear();
  const monthDiff = endOfYear.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && endOfYear.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function qualifiesForCTC(dep: Record<string, unknown>, taxYear: number): boolean {
  if (!dep.dob) return false;
  const age = calculateAge(dep.dob as string, taxYear);
  if (age >= CTC_MAX_AGE) return false;
  if ((dep.months_lived as number) < 6) return false;
  // Must have SSN (not ITIN) for CTC
  if (!dep.ssn_encrypted) return false;
  return true;
}

function qualifiesForODC(dep: Record<string, unknown>, taxYear: number): boolean {
  // ODC for dependents who don't qualify for CTC
  if (qualifiesForCTC(dep, taxYear)) return false;
  // Must be a qualifying relative or qualifying child over 16
  return true;
}

function qualifiesForEIC(dep: Record<string, unknown>, taxYear: number): boolean {
  if (!dep.dob) return false;
  const age = calculateAge(dep.dob as string, taxYear);
  const maxAge = (dep.student as number) ? 24 : EIC_MAX_AGE;
  if (age >= maxAge) return false;
  if ((dep.months_lived as number) < 6) return false;
  if ((dep.disabled as number) && age >= maxAge) return true; // Disabled exception
  return true;
}

function qualifiesForDependentCare(dep: Record<string, unknown>, taxYear: number): boolean {
  if (!dep.dob) return false;
  const age = calculateAge(dep.dob as string, taxYear);
  if (age < DEPENDENT_CARE_MAX_AGE) return true;
  if (dep.disabled) return true;
  return false;
}

export function dependentRoutes(db: Database) {
  const router = new Hono();

  // POST / — Add dependent to return
  router.post('/', async (c) => {
    const body = await c.req.json();
    const returnId = body.return_id;
    if (!returnId) return c.json({ success: false, error: 'return_id is required' }, 400);

    const parsed = CreateDependentSchema.safeParse(body);
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
    const taxYear = (taxReturn.tax_year as number) || 2025;

    // Encrypt SSN
    const ssnEncrypted = input.ssn ? encryptField(input.ssn) : null;
    const ssnLast4 = input.ssn ? extractLast4(input.ssn) : null;

    // Auto-determine credit qualifications
    const depRecord: Record<string, unknown> = {
      dob: input.dob,
      months_lived: input.months_lived,
      student: input.student ? 1 : 0,
      disabled: input.disabled ? 1 : 0,
      gross_income: input.gross_income,
      ssn_encrypted: ssnEncrypted,
    };

    const ctc = qualifiesForCTC(depRecord, taxYear);
    const odc = qualifiesForODC(depRecord, taxYear);
    const eic = qualifiesForEIC(depRecord, taxYear);
    const depCare = qualifiesForDependentCare(depRecord, taxYear);

    db.prepare(`
      INSERT INTO dependents (id, return_id, first_name, last_name, ssn_encrypted, ssn_last4,
        relationship, dob, months_lived, student, disabled, gross_income,
        qualifies_ctc, qualifies_odc, qualifies_eic, qualifies_dependent_care)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, returnId, input.first_name, input.last_name,
      ssnEncrypted, ssnLast4, input.relationship, input.dob,
      input.months_lived, input.student ? 1 : 0, input.disabled ? 1 : 0,
      input.gross_income, ctc ? 1 : 0, odc ? 1 : 0, eic ? 1 : 0, depCare ? 1 : 0,
    );

    logAudit(db, {
      return_id: returnId,
      user_id: c.get('userId'),
      action: 'dependent_added',
      entity_type: 'dependent',
      entity_id: id,
      details: { name: `${input.first_name} ${input.last_name}`, relationship: input.relationship },
    });

    log.info({ dependentId: id, returnId, name: `${input.first_name} ${input.last_name}` }, 'Dependent added');
    const item = getById(db, 'dependents', id);
    return c.json({ success: true, data: item }, 201);
  });

  // GET /:returnId — List dependents for return
  router.get('/:returnId', (c) => {
    const returnId = c.req.param('returnId');
    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 100);

    const result = listPaginated(db, 'dependents', {
      page,
      limit,
      where: 'return_id = ?',
      args: [returnId],
      orderBy: 'first_name ASC',
    });

    return c.json({ success: true, ...result });
  });

  // PUT /:depId — Update dependent
  router.put('/:depId', async (c) => {
    const id = c.req.param('depId');
    const existing = getById(db, 'dependents', id) as Record<string, unknown> | undefined;
    if (!existing) return c.json({ success: false, error: 'Dependent not found' }, 404);

    const taxReturn = getById(db, 'tax_returns', existing.return_id as string) as Record<string, unknown> | undefined;
    if (taxReturn && (taxReturn.status === 'locked' || taxReturn.status === 'filed')) {
      return c.json({ success: false, error: 'Return is locked/filed' }, 403);
    }

    const body = await c.req.json();

    // Handle SSN update
    if (body.ssn) {
      body.ssn_encrypted = encryptField(body.ssn);
      body.ssn_last4 = extractLast4(body.ssn);
      delete body.ssn;
    }

    // Convert booleans to integers for SQLite
    if (typeof body.student === 'boolean') body.student = body.student ? 1 : 0;
    if (typeof body.disabled === 'boolean') body.disabled = body.disabled ? 1 : 0;

    // Re-evaluate credit qualifications if relevant fields changed
    const taxYear = (taxReturn?.tax_year as number) || 2025;
    const merged = { ...existing, ...body };
    if (body.dob || body.months_lived !== undefined || body.student !== undefined ||
        body.disabled !== undefined || body.gross_income !== undefined || body.ssn) {
      body.qualifies_ctc = qualifiesForCTC(merged, taxYear) ? 1 : 0;
      body.qualifies_odc = qualifiesForODC(merged, taxYear) ? 1 : 0;
      body.qualifies_eic = qualifiesForEIC(merged, taxYear) ? 1 : 0;
      body.qualifies_dependent_care = qualifiesForDependentCare(merged, taxYear) ? 1 : 0;
    }

    update(db, 'dependents', id, body);

    logAudit(db, {
      return_id: existing.return_id as string,
      user_id: c.get('userId'),
      action: 'dependent_updated',
      entity_type: 'dependent',
      entity_id: id,
      details: { fields_updated: Object.keys(body) },
    });

    const updated = getById(db, 'dependents', id);
    return c.json({ success: true, data: updated });
  });

  // DELETE /:depId — Delete dependent
  router.delete('/:depId', (c) => {
    const id = c.req.param('depId');
    const existing = getById(db, 'dependents', id) as Record<string, unknown> | undefined;
    if (!existing) return c.json({ success: false, error: 'Dependent not found' }, 404);

    const taxReturn = getById(db, 'tax_returns', existing.return_id as string) as Record<string, unknown> | undefined;
    if (taxReturn && (taxReturn.status === 'locked' || taxReturn.status === 'filed')) {
      return c.json({ success: false, error: 'Return is locked/filed' }, 403);
    }

    remove(db, 'dependents', id);

    logAudit(db, {
      return_id: existing.return_id as string,
      user_id: c.get('userId'),
      action: 'dependent_deleted',
      entity_type: 'dependent',
      entity_id: id,
      details: { name: `${existing.first_name} ${existing.last_name}` },
    });

    return c.json({ success: true, message: 'Dependent deleted' });
  });

  // GET /:returnId/credits — Credit qualification analysis
  router.get('/:returnId/credits', (c) => {
    const returnId = c.req.param('returnId');
    const taxReturn = getById(db, 'tax_returns', returnId) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);

    const client = getById(db, 'clients', taxReturn.client_id as string) as Record<string, unknown> | undefined;
    const filingStatus = (client?.filing_status as string) || 'single';
    const taxYear = (taxReturn.tax_year as number) || 2025;
    const agi = (taxReturn.adjusted_gross_income as number) || 0;

    const dependents = db.prepare('SELECT * FROM dependents WHERE return_id = ?').all(returnId) as Record<string, unknown>[];

    // CTC calculation
    const ctcQualifying = dependents.filter(d => d.qualifies_ctc);
    const ctcPhaseoutThreshold = CTC_AGI_PHASEOUT[filingStatus] || 200_000;
    let ctcPhaseoutReduction = 0;
    if (agi > ctcPhaseoutThreshold) {
      const excess = Math.ceil((agi - ctcPhaseoutThreshold) / 1000) * CTC_PHASEOUT_RATE;
      ctcPhaseoutReduction = excess;
    }
    const ctcGross = ctcQualifying.length * CTC_AMOUNT;
    const ctcNet = Math.max(0, ctcGross - ctcPhaseoutReduction);
    const ctcRefundable = Math.min(ctcNet, ctcQualifying.length * 1_700); // ACTC refundable portion 2025

    // ODC calculation
    const odcQualifying = dependents.filter(d => d.qualifies_odc);
    const odcGross = odcQualifying.length * ODC_AMOUNT;
    const odcNet = Math.max(0, odcGross - Math.max(0, ctcPhaseoutReduction - ctcGross)); // ODC phases out after CTC

    // EIC qualifying children count
    const eicQualifying = dependents.filter(d => d.qualifies_eic);

    // EIC amounts by number of children (2025 estimates)
    const eicMaxByChildren: Record<number, number> = { 0: 632, 1: 3_995, 2: 6_604, 3: 7_430 };
    const eicChildren = Math.min(eicQualifying.length, 3);
    const eicMaxCredit = eicMaxByChildren[eicChildren] || 0;

    // EIC AGI limits (2025 estimates)
    const eicAgiLimits: Record<string, Record<number, number>> = {
      single: { 0: 18_591, 1: 49_084, 2: 55_768, 3: 59_899 },
      mfj: { 0: 25_511, 1: 56_004, 2: 62_688, 3: 66_819 },
      mfs: { 0: 18_591, 1: 49_084, 2: 55_768, 3: 59_899 },
      hoh: { 0: 18_591, 1: 49_084, 2: 55_768, 3: 59_899 },
      qss: { 0: 25_511, 1: 56_004, 2: 62_688, 3: 66_819 },
    };
    const statusLimits = eicAgiLimits[filingStatus] || eicAgiLimits.single;
    const eicAgiLimit = statusLimits[eicChildren] || 0;
    const eicEligible = agi <= eicAgiLimit;

    // Dependent care credit
    const depCareQualifying = dependents.filter(d => d.qualifies_dependent_care);
    const depCareMaxExpenses = depCareQualifying.length >= 2 ? DEPENDENT_CARE_MAX_MULTIPLE : DEPENDENT_CARE_MAX_SINGLE;
    // Credit rate ranges from 35% (AGI <= $15k) to 20% (AGI >= $43k)
    let depCareRate = 0.20;
    if (agi <= 15_000) depCareRate = 0.35;
    else if (agi <= 43_000) depCareRate = 0.35 - (Math.floor((agi - 15_000) / 2_000) * 0.01);
    depCareRate = Math.max(0.20, depCareRate);

    const dependentDetails = dependents.map(d => {
      const age = d.dob ? calculateAge(d.dob as string, taxYear) : null;
      return {
        id: d.id,
        name: `${d.first_name} ${d.last_name}`,
        relationship: d.relationship,
        age,
        qualifies_ctc: !!d.qualifies_ctc,
        qualifies_odc: !!d.qualifies_odc,
        qualifies_eic: !!d.qualifies_eic,
        qualifies_dependent_care: !!d.qualifies_dependent_care,
        missing_ssn: !d.ssn_encrypted,
      };
    });

    const warnings: string[] = [];
    const missingSsn = dependents.filter(d => !d.ssn_encrypted);
    if (missingSsn.length > 0) {
      warnings.push(`${missingSsn.length} dependent(s) missing SSN — required for CTC.`);
    }
    if (ctcPhaseoutReduction > 0) {
      warnings.push(`CTC reduced by $${ctcPhaseoutReduction.toLocaleString()} due to AGI exceeding $${ctcPhaseoutThreshold.toLocaleString()}.`);
    }
    if (!eicEligible && eicQualifying.length > 0) {
      warnings.push(`AGI ($${agi.toLocaleString()}) exceeds EIC limit ($${eicAgiLimit.toLocaleString()}) for ${eicChildren} qualifying child(ren).`);
    }

    return c.json({
      success: true,
      data: {
        dependent_count: dependents.length,
        dependents: dependentDetails,
        credits: {
          child_tax_credit: {
            qualifying_children: ctcQualifying.length,
            gross_credit: ctcGross,
            phaseout_reduction: ctcPhaseoutReduction,
            net_credit: ctcNet,
            refundable_portion: ctcRefundable,
            nonrefundable_portion: ctcNet - ctcRefundable,
          },
          other_dependent_credit: {
            qualifying_dependents: odcQualifying.length,
            gross_credit: odcGross,
            net_credit: odcNet,
          },
          earned_income_credit: {
            qualifying_children: eicQualifying.length,
            eligible: eicEligible,
            max_credit: eicEligible ? eicMaxCredit : 0,
            agi_limit: eicAgiLimit,
            note: eicEligible ? 'Actual EIC depends on earned income and AGI' : 'AGI exceeds limit',
          },
          dependent_care_credit: {
            qualifying_dependents: depCareQualifying.length,
            max_eligible_expenses: depCareMaxExpenses,
            credit_rate: depCareRate,
            max_credit: Math.round(depCareMaxExpenses * depCareRate),
            note: 'Actual credit limited to actual dependent care expenses paid',
          },
          total_estimated: ctcNet + odcNet + (eicEligible ? eicMaxCredit : 0),
        },
        warnings,
      },
    });
  });

  return router;
}
