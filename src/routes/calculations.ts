// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Advanced Calculation Routes
// AMT, NIIT, Estimated Payments
// ═══════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { getById, update, logAudit } from '../services/database';
import { createLogger } from '../utils/logger';

const log = createLogger('calculations');

// ─── AMT Exemption Amounts (2025) ──────────────────────────────────────
const AMT_EXEMPTIONS: Record<number, Record<string, number>> = {
  2024: { single: 85_700, mfj: 133_300, mfs: 66_650, hoh: 85_700, qss: 133_300 },
  2025: { single: 88_100, mfj: 137_000, mfs: 68_500, hoh: 88_100, qss: 137_000 },
  2026: { single: 90_500, mfj: 140_800, mfs: 70_400, hoh: 90_500, qss: 140_800 },
};

const AMT_PHASEOUT_THRESHOLDS: Record<number, Record<string, number>> = {
  2024: { single: 609_350, mfj: 1_218_700, mfs: 609_350, hoh: 609_350, qss: 1_218_700 },
  2025: { single: 626_350, mfj: 1_252_700, mfs: 626_350, hoh: 626_350, qss: 1_252_700 },
  2026: { single: 643_350, mfj: 1_286_700, mfs: 643_350, hoh: 643_350, qss: 1_286_700 },
};

const AMT_RATES = { lower: 0.26, higher: 0.28 };
const AMT_RATE_THRESHOLD: Record<number, Record<string, number>> = {
  2024: { single: 232_600, mfj: 232_600, mfs: 116_300, hoh: 232_600, qss: 232_600 },
  2025: { single: 239_100, mfj: 239_100, mfs: 119_550, hoh: 239_100, qss: 239_100 },
  2026: { single: 245_600, mfj: 245_600, mfs: 122_800, hoh: 245_600, qss: 245_600 },
};

// ─── NIIT Thresholds ───────────────────────────────────────────────────
const NIIT_RATE = 0.038; // 3.8%
const NIIT_THRESHOLDS: Record<string, number> = {
  single: 200_000, mfj: 250_000, mfs: 125_000, hoh: 200_000, qss: 250_000,
};

// ─── Estimated Payment Safe Harbor ─────────────────────────────────────
const SAFE_HARBOR_PRIOR_YEAR_PCT = 1.00; // 100% of prior year tax
const SAFE_HARBOR_PRIOR_YEAR_HIGH_INCOME_PCT = 1.10; // 110% if AGI > $150k ($75k MFS)
const SAFE_HARBOR_CURRENT_YEAR_PCT = 0.90; // 90% of current year tax
const HIGH_INCOME_AGI_THRESHOLD = 150_000;
const HIGH_INCOME_AGI_THRESHOLD_MFS = 75_000;

export function calculationRoutes(db: Database) {
  const router = new Hono();

  // POST /amt/:returnId — Calculate Alternative Minimum Tax
  router.post('/amt/:returnId', async (c) => {
    const returnId = c.req.param('returnId');
    const taxReturn = getById(db, 'tax_returns', returnId) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);

    const client = getById(db, 'clients', taxReturn.client_id as string) as Record<string, unknown> | undefined;
    const filingStatus = (client?.filing_status as string) || 'single';
    const taxYear = (taxReturn.tax_year as number) || 2025;
    const taxableIncome = (taxReturn.taxable_income as number) || 0;

    // Load year-specific data
    const exemptions = AMT_EXEMPTIONS[taxYear] || AMT_EXEMPTIONS[2025];
    const phaseouts = AMT_PHASEOUT_THRESHOLDS[taxYear] || AMT_PHASEOUT_THRESHOLDS[2025];
    const rateThresholds = AMT_RATE_THRESHOLD[taxYear] || AMT_RATE_THRESHOLD[2025];

    const exemptionAmount = exemptions[filingStatus] || exemptions.single;
    const phaseoutThreshold = phaseouts[filingStatus] || phaseouts.single;
    const rateThreshold = rateThresholds[filingStatus] || rateThresholds.single;

    // AMT preference items — pull from deductions
    const saltDeductions = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM deductions
      WHERE return_id = ? AND category IN ('state_local_taxes', 'property_taxes')
    `).get(returnId) as { total: number };

    // If itemized, SALT was deducted — add back for AMT
    const deductionMethod = taxReturn.deduction_method as string;
    const saltAddBack = deductionMethod === 'itemized' ? saltDeductions.total : 0;

    // Other common AMT adjustments
    const body = await c.req.json().catch(() => ({}));
    const miscAdjustments = (body as Record<string, number>).misc_adjustments || 0;
    const isoExerciseIncome = (body as Record<string, number>).iso_exercise_income || 0;
    const privateActivityBondInterest = (body as Record<string, number>).private_activity_bond_interest || 0;

    // Calculate AMTI (Alternative Minimum Taxable Income)
    const amti = taxableIncome + saltAddBack + isoExerciseIncome + privateActivityBondInterest + miscAdjustments;

    // Exemption phaseout: reduced by 25% of amount exceeding phaseout threshold
    let effectiveExemption = exemptionAmount;
    if (amti > phaseoutThreshold) {
      const reduction = (amti - phaseoutThreshold) * 0.25;
      effectiveExemption = Math.max(0, exemptionAmount - reduction);
    }

    // AMT base
    const amtBase = Math.max(0, amti - effectiveExemption);

    // AMT tax: 26% up to threshold, 28% above
    let amtTax = 0;
    if (amtBase <= rateThreshold) {
      amtTax = amtBase * AMT_RATES.lower;
    } else {
      amtTax = (rateThreshold * AMT_RATES.lower) + ((amtBase - rateThreshold) * AMT_RATES.higher);
    }

    // Tentative minimum tax vs regular tax
    const regularTax = (taxReturn.total_tax as number) || 0;
    const amtOwed = Math.max(0, amtTax - regularTax);

    // Update return
    update(db, 'tax_returns', returnId, { amt_amount: amtOwed });

    logAudit(db, {
      return_id: returnId,
      user_id: c.get('userId'),
      action: 'amt_calculated',
      entity_type: 'tax_return',
      entity_id: returnId,
      details: { amt_amount: amtOwed, amti, amt_tax: amtTax },
    });

    log.info({ returnId, amtOwed, amti }, 'AMT calculated');

    return c.json({
      success: true,
      data: {
        taxable_income: taxableIncome,
        adjustments: {
          salt_add_back: saltAddBack,
          iso_exercise_income: isoExerciseIncome,
          private_activity_bonds: privateActivityBondInterest,
          misc_adjustments: miscAdjustments,
        },
        amti,
        exemption: {
          base: exemptionAmount,
          phaseout_threshold: phaseoutThreshold,
          effective: effectiveExemption,
          fully_phased_out: effectiveExemption === 0,
        },
        amt_base: amtBase,
        amt_rates: {
          lower_rate: AMT_RATES.lower,
          higher_rate: AMT_RATES.higher,
          threshold: rateThreshold,
        },
        amt_tax: Math.round(amtTax * 100) / 100,
        regular_tax: regularTax,
        amt_owed: Math.round(amtOwed * 100) / 100,
        subject_to_amt: amtOwed > 0,
        form: 'Form 6251',
      },
    });
  });

  // POST /niit/:returnId — Calculate Net Investment Income Tax
  router.post('/niit/:returnId', async (c) => {
    const returnId = c.req.param('returnId');
    const taxReturn = getById(db, 'tax_returns', returnId) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);

    const client = getById(db, 'clients', taxReturn.client_id as string) as Record<string, unknown> | undefined;
    const filingStatus = (client?.filing_status as string) || 'single';
    const agi = (taxReturn.adjusted_gross_income as number) || 0;
    const threshold = NIIT_THRESHOLDS[filingStatus] || 200_000;

    // Calculate net investment income
    const investmentIncome = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM income_items WHERE return_id = ? AND category IN (
        'interest', 'dividends', 'qualified_dividends', 'capital_gains',
        'capital_gains_short', 'capital_gains_long', 'rental', 'royalty',
        'annuity', 'crypto', 'staking', 'mining'
      )
    `).get(returnId) as { total: number };

    // Investment expenses (deductible against investment income)
    const investmentExpenses = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM deductions WHERE return_id = ? AND category = 'investment_expense'
    `).get(returnId) as { total: number };

    const netInvestmentIncome = Math.max(0, investmentIncome.total - investmentExpenses.total);

    // NIIT is 3.8% of the LESSER of:
    // 1. Net investment income, OR
    // 2. Amount by which MAGI exceeds the threshold
    const excessAgi = Math.max(0, agi - threshold);
    const niitBase = Math.min(netInvestmentIncome, excessAgi);
    const niitTax = Math.round(niitBase * NIIT_RATE * 100) / 100;

    // Update return
    update(db, 'tax_returns', returnId, { niit_amount: niitTax });

    logAudit(db, {
      return_id: returnId,
      user_id: c.get('userId'),
      action: 'niit_calculated',
      entity_type: 'tax_return',
      entity_id: returnId,
      details: { niit_amount: niitTax, net_investment_income: netInvestmentIncome },
    });

    // Breakdown by investment type
    const investmentBreakdown = db.prepare(`
      SELECT category, SUM(amount) as total
      FROM income_items WHERE return_id = ? AND category IN (
        'interest', 'dividends', 'qualified_dividends', 'capital_gains',
        'capital_gains_short', 'capital_gains_long', 'rental', 'royalty',
        'annuity', 'crypto', 'staking', 'mining'
      ) GROUP BY category ORDER BY total DESC
    `).all(returnId) as Record<string, unknown>[];

    return c.json({
      success: true,
      data: {
        agi,
        threshold,
        excess_agi: excessAgi,
        gross_investment_income: investmentIncome.total,
        investment_expenses: investmentExpenses.total,
        net_investment_income: netInvestmentIncome,
        niit_base: niitBase,
        niit_rate: NIIT_RATE,
        niit_tax: niitTax,
        subject_to_niit: niitTax > 0,
        investment_breakdown: investmentBreakdown,
        form: 'Form 8960',
        note: niitTax > 0
          ? `NIIT of $${niitTax.toLocaleString()} applies because AGI ($${agi.toLocaleString()}) exceeds $${threshold.toLocaleString()} threshold and you have net investment income.`
          : excessAgi === 0
            ? `AGI ($${agi.toLocaleString()}) is below NIIT threshold ($${threshold.toLocaleString()}).`
            : `No net investment income subject to NIIT.`,
      },
    });
  });

  // POST /estimated-payments/:returnId — Calculate estimated tax payments
  router.post('/estimated-payments/:returnId', async (c) => {
    const returnId = c.req.param('returnId');
    const taxReturn = getById(db, 'tax_returns', returnId) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);

    const client = getById(db, 'clients', taxReturn.client_id as string) as Record<string, unknown> | undefined;
    const filingStatus = (client?.filing_status as string) || 'single';
    const taxYear = (taxReturn.tax_year as number) || 2025;
    const agi = (taxReturn.adjusted_gross_income as number) || 0;

    const body = await c.req.json().catch(() => ({}));
    const priorYearTax = (body as Record<string, number>).prior_year_tax || 0;
    const priorYearAgi = (body as Record<string, number>).prior_year_agi || 0;

    // Current year projected tax
    const currentYearTax = (taxReturn.total_tax as number) || 0;
    const selfEmploymentTax = (taxReturn.self_employment_tax as number) || 0;
    const amtAmount = (taxReturn.amt_amount as number) || 0;
    const niitAmount = (taxReturn.niit_amount as number) || 0;
    const totalTaxLiability = currentYearTax + selfEmploymentTax + amtAmount + niitAmount;

    // Withholding already paid
    const totalWithholding = db.prepare(`
      SELECT COALESCE(SUM(tax_withheld), 0) as total FROM income_items WHERE return_id = ?
    `).get(returnId) as { total: number };

    // Tax after withholding
    const taxAfterWithholding = Math.max(0, totalTaxLiability - totalWithholding.total);

    // Safe harbor calculation
    const highIncomeThreshold = filingStatus === 'mfs' ? HIGH_INCOME_AGI_THRESHOLD_MFS : HIGH_INCOME_AGI_THRESHOLD;
    const isHighIncome = priorYearAgi > highIncomeThreshold || agi > highIncomeThreshold;
    const priorYearSafeHarbor = priorYearTax * (isHighIncome ? SAFE_HARBOR_PRIOR_YEAR_HIGH_INCOME_PCT : SAFE_HARBOR_PRIOR_YEAR_PCT);
    const currentYearSafeHarbor = totalTaxLiability * SAFE_HARBOR_CURRENT_YEAR_PCT;

    // Minimum required payment is the lesser of two safe harbors
    const minimumRequired = Math.min(priorYearSafeHarbor, currentYearSafeHarbor);
    const minimumAfterWithholding = Math.max(0, minimumRequired - totalWithholding.total);

    // Quarterly payments (standard dates)
    const quarterlyDates = [
      { quarter: 'Q1', due: `${taxYear}-04-15`, period: `Jan 1 - Mar 31` },
      { quarter: 'Q2', due: `${taxYear}-06-15`, period: `Apr 1 - May 31` },
      { quarter: 'Q3', due: `${taxYear}-09-15`, period: `Jun 1 - Aug 31` },
      { quarter: 'Q4', due: `${taxYear + 1}-01-15`, period: `Sep 1 - Dec 31` },
    ];

    const quarterlyAmount = Math.ceil(minimumAfterWithholding / 4 * 100) / 100;

    // Underpayment penalty check
    const estimatedPaymentsMade = (taxReturn.estimated_payments as number) || 0;
    const totalPaid = totalWithholding.total + estimatedPaymentsMade;
    const underpayment = Math.max(0, minimumRequired - totalPaid);
    const penaltyRisk = underpayment > 1_000; // Generally no penalty if underpayment < $1,000

    // Annualized income method flag
    const hasIrregularIncome = db.prepare(`
      SELECT COUNT(DISTINCT category) as categories FROM income_items
      WHERE return_id = ? AND category IN ('business', 'capital_gains', 'rental', 'partnership', 's_corp')
    `).get(returnId) as { categories: number };
    const considerAnnualized = hasIrregularIncome.categories > 0;

    return c.json({
      success: true,
      data: {
        tax_year: taxYear,
        filing_status: filingStatus,
        current_year: {
          total_tax_liability: totalTaxLiability,
          income_tax: currentYearTax,
          self_employment_tax: selfEmploymentTax,
          amt: amtAmount,
          niit: niitAmount,
        },
        withholding: {
          total: totalWithholding.total,
          estimated_payments_made: estimatedPaymentsMade,
          total_paid: totalPaid,
        },
        safe_harbor: {
          is_high_income: isHighIncome,
          prior_year_tax: priorYearTax,
          prior_year_safe_harbor: Math.round(priorYearSafeHarbor * 100) / 100,
          prior_year_rate: isHighIncome ? '110%' : '100%',
          current_year_safe_harbor: Math.round(currentYearSafeHarbor * 100) / 100,
          current_year_rate: '90%',
          minimum_required: Math.round(minimumRequired * 100) / 100,
          after_withholding: Math.round(minimumAfterWithholding * 100) / 100,
        },
        quarterly_payments: quarterlyDates.map(q => ({
          ...q,
          amount: quarterlyAmount,
        })),
        underpayment: {
          amount: Math.round(underpayment * 100) / 100,
          penalty_risk: penaltyRisk,
          note: penaltyRisk
            ? `Potential underpayment penalty — shortfall of $${underpayment.toLocaleString()}. Consider making a catch-up payment.`
            : underpayment > 0
              ? `Small underpayment of $${underpayment.toLocaleString()} — generally no penalty if under $1,000.`
              : 'No underpayment — safe harbor met.',
        },
        annualized_income_method: {
          recommended: considerAnnualized,
          note: considerAnnualized
            ? 'Income appears irregular. Consider Form 2210 Schedule AI to potentially reduce/eliminate penalty.'
            : 'Income appears regular — standard quarterly payments appropriate.',
        },
        form: 'Form 1040-ES / Form 2210',
      },
    });
  });

  return router;
}
