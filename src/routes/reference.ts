// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Tax Reference Data Routes
// Brackets, standard deductions, contribution limits, mileage, deadlines
// ═══════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { createLogger } from '../utils/logger';

const log = createLogger('reference');

// ─── Tax Brackets by Year and Filing Status ────────────────────────────
const TAX_BRACKETS: Record<number, Record<string, Array<{ min: number; max: number; rate: number; base_tax: number }>>> = {
  2024: {
    single: [
      { min: 0, max: 11_600, rate: 0.10, base_tax: 0 },
      { min: 11_600, max: 47_150, rate: 0.12, base_tax: 1_160 },
      { min: 47_150, max: 100_525, rate: 0.22, base_tax: 5_426 },
      { min: 100_525, max: 191_950, rate: 0.24, base_tax: 17_168.50 },
      { min: 191_950, max: 243_725, rate: 0.32, base_tax: 39_110.50 },
      { min: 243_725, max: 609_350, rate: 0.35, base_tax: 55_678.50 },
      { min: 609_350, max: Infinity, rate: 0.37, base_tax: 183_647.25 },
    ],
    mfj: [
      { min: 0, max: 23_200, rate: 0.10, base_tax: 0 },
      { min: 23_200, max: 94_300, rate: 0.12, base_tax: 2_320 },
      { min: 94_300, max: 201_050, rate: 0.22, base_tax: 10_852 },
      { min: 201_050, max: 383_900, rate: 0.24, base_tax: 34_337 },
      { min: 383_900, max: 487_450, rate: 0.32, base_tax: 78_221 },
      { min: 487_450, max: 731_200, rate: 0.35, base_tax: 111_357 },
      { min: 731_200, max: Infinity, rate: 0.37, base_tax: 196_669.50 },
    ],
    mfs: [
      { min: 0, max: 11_600, rate: 0.10, base_tax: 0 },
      { min: 11_600, max: 47_150, rate: 0.12, base_tax: 1_160 },
      { min: 47_150, max: 100_525, rate: 0.22, base_tax: 5_426 },
      { min: 100_525, max: 191_950, rate: 0.24, base_tax: 17_168.50 },
      { min: 191_950, max: 243_725, rate: 0.32, base_tax: 39_110.50 },
      { min: 243_725, max: 365_600, rate: 0.35, base_tax: 55_678.50 },
      { min: 365_600, max: Infinity, rate: 0.37, base_tax: 98_334.75 },
    ],
    hoh: [
      { min: 0, max: 16_550, rate: 0.10, base_tax: 0 },
      { min: 16_550, max: 63_100, rate: 0.12, base_tax: 1_655 },
      { min: 63_100, max: 100_500, rate: 0.22, base_tax: 7_241 },
      { min: 100_500, max: 191_950, rate: 0.24, base_tax: 15_469 },
      { min: 191_950, max: 243_700, rate: 0.32, base_tax: 37_417 },
      { min: 243_700, max: 609_350, rate: 0.35, base_tax: 53_977 },
      { min: 609_350, max: Infinity, rate: 0.37, base_tax: 181_954.50 },
    ],
    qss: [], // Same as MFJ — populated at runtime
  },
  2025: {
    single: [
      { min: 0, max: 11_925, rate: 0.10, base_tax: 0 },
      { min: 11_925, max: 48_475, rate: 0.12, base_tax: 1_192.50 },
      { min: 48_475, max: 103_350, rate: 0.22, base_tax: 5_578.50 },
      { min: 103_350, max: 197_300, rate: 0.24, base_tax: 17_651 },
      { min: 197_300, max: 250_525, rate: 0.32, base_tax: 40_199 },
      { min: 250_525, max: 626_350, rate: 0.35, base_tax: 57_231 },
      { min: 626_350, max: Infinity, rate: 0.37, base_tax: 188_769.75 },
    ],
    mfj: [
      { min: 0, max: 23_850, rate: 0.10, base_tax: 0 },
      { min: 23_850, max: 96_950, rate: 0.12, base_tax: 2_385 },
      { min: 96_950, max: 206_700, rate: 0.22, base_tax: 11_157 },
      { min: 206_700, max: 394_600, rate: 0.24, base_tax: 35_302 },
      { min: 394_600, max: 501_050, rate: 0.32, base_tax: 80_398 },
      { min: 501_050, max: 751_600, rate: 0.35, base_tax: 114_462 },
      { min: 751_600, max: Infinity, rate: 0.37, base_tax: 202_154.50 },
    ],
    mfs: [
      { min: 0, max: 11_925, rate: 0.10, base_tax: 0 },
      { min: 11_925, max: 48_475, rate: 0.12, base_tax: 1_192.50 },
      { min: 48_475, max: 103_350, rate: 0.22, base_tax: 5_578.50 },
      { min: 103_350, max: 197_300, rate: 0.24, base_tax: 17_651 },
      { min: 197_300, max: 250_525, rate: 0.32, base_tax: 40_199 },
      { min: 250_525, max: 375_800, rate: 0.35, base_tax: 57_231 },
      { min: 375_800, max: Infinity, rate: 0.37, base_tax: 101_077.25 },
    ],
    hoh: [
      { min: 0, max: 17_000, rate: 0.10, base_tax: 0 },
      { min: 17_000, max: 64_850, rate: 0.12, base_tax: 1_700 },
      { min: 64_850, max: 103_350, rate: 0.22, base_tax: 7_442 },
      { min: 103_350, max: 197_300, rate: 0.24, base_tax: 15_912 },
      { min: 197_300, max: 250_500, rate: 0.32, base_tax: 38_460 },
      { min: 250_500, max: 626_350, rate: 0.35, base_tax: 55_484 },
      { min: 626_350, max: Infinity, rate: 0.37, base_tax: 187_031.50 },
    ],
    qss: [],
  },
};

// Copy MFJ to QSS
for (const year of Object.keys(TAX_BRACKETS)) {
  TAX_BRACKETS[parseInt(year)].qss = TAX_BRACKETS[parseInt(year)].mfj;
}

// ─── Standard Deductions ───────────────────────────────────────────────
const STANDARD_DEDUCTIONS: Record<number, Record<string, { base: number; over65: number; blind: number }>> = {
  2024: {
    single: { base: 14_600, over65: 1_950, blind: 1_950 },
    mfj: { base: 29_200, over65: 1_550, blind: 1_550 },
    mfs: { base: 14_600, over65: 1_550, blind: 1_550 },
    hoh: { base: 21_900, over65: 1_950, blind: 1_950 },
    qss: { base: 29_200, over65: 1_550, blind: 1_550 },
  },
  2025: {
    single: { base: 15_000, over65: 2_000, blind: 2_000 },
    mfj: { base: 30_000, over65: 1_600, blind: 1_600 },
    mfs: { base: 15_000, over65: 1_600, blind: 1_600 },
    hoh: { base: 22_500, over65: 2_000, blind: 2_000 },
    qss: { base: 30_000, over65: 1_600, blind: 1_600 },
  },
};

// ─── Contribution Limits ───────────────────────────────────────────────
const CONTRIBUTION_LIMITS: Record<number, Record<string, { limit: number; catchup?: number; catchup_age?: number; note?: string }>> = {
  2024: {
    '401k_employee': { limit: 23_000, catchup: 7_500, catchup_age: 50 },
    '403b_employee': { limit: 23_000, catchup: 7_500, catchup_age: 50 },
    ira_traditional: { limit: 7_000, catchup: 1_000, catchup_age: 50 },
    ira_roth: { limit: 7_000, catchup: 1_000, catchup_age: 50 },
    hsa_individual: { limit: 4_150, catchup: 1_000, catchup_age: 55 },
    hsa_family: { limit: 8_300, catchup: 1_000, catchup_age: 55 },
    sep_ira: { limit: 69_000, note: '25% of compensation, max $69,000' },
    simple_ira: { limit: 16_000, catchup: 3_500, catchup_age: 50 },
    fsa_health: { limit: 3_200 },
    fsa_dependent_care: { limit: 5_000, note: '$2,500 if MFS' },
    '529_annual_gift': { limit: 18_000, note: 'Per beneficiary, gift tax exclusion' },
    '529_superfund': { limit: 90_000, note: '5-year gift election' },
    gift_tax_exclusion: { limit: 18_000 },
    estate_tax_exemption: { limit: 13_610_000 },
    social_security_wage_base: { limit: 168_600 },
  },
  2025: {
    '401k_employee': { limit: 23_500, catchup: 7_500, catchup_age: 50, note: 'Enhanced $11,250 catchup for ages 60-63' },
    '403b_employee': { limit: 23_500, catchup: 7_500, catchup_age: 50 },
    ira_traditional: { limit: 7_000, catchup: 1_000, catchup_age: 50 },
    ira_roth: { limit: 7_000, catchup: 1_000, catchup_age: 50 },
    hsa_individual: { limit: 4_300, catchup: 1_000, catchup_age: 55 },
    hsa_family: { limit: 8_550, catchup: 1_000, catchup_age: 55 },
    sep_ira: { limit: 70_000, note: '25% of compensation, max $70,000' },
    simple_ira: { limit: 16_500, catchup: 3_500, catchup_age: 50 },
    fsa_health: { limit: 3_300 },
    fsa_dependent_care: { limit: 5_000, note: '$2,500 if MFS' },
    '529_annual_gift': { limit: 19_000, note: 'Per beneficiary, gift tax exclusion' },
    '529_superfund': { limit: 95_000, note: '5-year gift election' },
    gift_tax_exclusion: { limit: 19_000 },
    estate_tax_exemption: { limit: 13_990_000 },
    social_security_wage_base: { limit: 176_100 },
  },
};

// ─── Mileage Rates ─────────────────────────────────────────────────────
const MILEAGE_RATES: Record<number, { business: number; medical: number; charity: number; moving_military: number }> = {
  2023: { business: 0.655, medical: 0.22, charity: 0.14, moving_military: 0.22 },
  2024: { business: 0.67, medical: 0.21, charity: 0.14, moving_military: 0.21 },
  2025: { business: 0.70, medical: 0.22, charity: 0.14, moving_military: 0.22 },
};

// ─── Tax Calendar ──────────────────────────────────────────────────────
function getTaxCalendar(taxYear: number): Array<{ date: string; description: string; form?: string; penalty_risk: boolean }> {
  const nextYear = taxYear + 1;
  return [
    { date: `${nextYear}-01-15`, description: `Q4 ${taxYear} estimated tax payment due`, form: '1040-ES', penalty_risk: true },
    { date: `${nextYear}-01-31`, description: `Employers: W-2 and 1099-NEC due to recipients`, form: 'W-2, 1099-NEC', penalty_risk: true },
    { date: `${nextYear}-02-15`, description: `Reclaim withholding exemption or new W-4 required`, form: 'W-4', penalty_risk: false },
    { date: `${nextYear}-02-28`, description: `Paper 1099 forms due to IRS (March 31 if e-filing)`, form: '1099 series', penalty_risk: true },
    { date: `${nextYear}-03-15`, description: `S-Corp (1120S) and Partnership (1065) returns due`, form: '1120-S, 1065', penalty_risk: true },
    { date: `${nextYear}-03-31`, description: `Electronic 1099 forms due to IRS`, form: '1099 series', penalty_risk: true },
    { date: `${nextYear}-04-01`, description: `Required Beginning Date for RMDs (if turned 73 in ${taxYear})`, form: '', penalty_risk: true },
    { date: `${nextYear}-04-15`, description: `Individual tax returns due (Form 1040)`, form: '1040', penalty_risk: true },
    { date: `${nextYear}-04-15`, description: `IRA/HSA contribution deadline for ${taxYear}`, form: '5498', penalty_risk: false },
    { date: `${nextYear}-04-15`, description: `Extension filing deadline (Form 4868)`, form: '4868', penalty_risk: false },
    { date: `${nextYear}-04-15`, description: `Q1 ${nextYear} estimated tax payment due`, form: '1040-ES', penalty_risk: true },
    { date: `${nextYear}-06-15`, description: `Q2 ${nextYear} estimated tax payment due`, form: '1040-ES', penalty_risk: true },
    { date: `${nextYear}-06-15`, description: `US citizens/residents abroad: auto 2-month extension expires`, form: '1040', penalty_risk: true },
    { date: `${nextYear}-09-15`, description: `Q3 ${nextYear} estimated tax payment due`, form: '1040-ES', penalty_risk: true },
    { date: `${nextYear}-09-15`, description: `Extended S-Corp and Partnership returns due`, form: '1120-S, 1065', penalty_risk: true },
    { date: `${nextYear}-10-15`, description: `Extended individual returns due`, form: '1040', penalty_risk: true },
    { date: `${nextYear}-12-31`, description: `Roth conversion deadline for ${taxYear}`, form: '', penalty_risk: false },
    { date: `${nextYear}-12-31`, description: `Required Minimum Distribution deadline`, form: '', penalty_risk: true },
    { date: `${nextYear}-12-31`, description: `401(k) employee contribution deadline for ${nextYear}`, form: '', penalty_risk: false },
  ];
}

export function referenceRoutes(db: Database) {
  const router = new Hono();

  // GET /brackets/:year — Tax brackets
  router.get('/brackets/:year', (c) => {
    const year = parseInt(c.req.param('year'), 10);
    const filingStatus = c.req.query('filing_status');

    const brackets = TAX_BRACKETS[year];
    if (!brackets) {
      return c.json({
        success: false,
        error: `Tax brackets not available for year ${year}. Available years: ${Object.keys(TAX_BRACKETS).join(', ')}`,
      }, 404);
    }

    if (filingStatus) {
      const statusBrackets = brackets[filingStatus];
      if (!statusBrackets) {
        return c.json({ success: false, error: `Invalid filing status: ${filingStatus}` }, 400);
      }
      return c.json({ success: true, data: { tax_year: year, filing_status: filingStatus, brackets: statusBrackets } });
    }

    return c.json({ success: true, data: { tax_year: year, brackets } });
  });

  // GET /standard-deduction/:year — Standard deduction amounts
  router.get('/standard-deduction/:year', (c) => {
    const year = parseInt(c.req.param('year'), 10);
    const filingStatus = c.req.query('filing_status');

    const deductions = STANDARD_DEDUCTIONS[year];
    if (!deductions) {
      return c.json({
        success: false,
        error: `Standard deduction data not available for year ${year}. Available: ${Object.keys(STANDARD_DEDUCTIONS).join(', ')}`,
      }, 404);
    }

    if (filingStatus) {
      const statusDeduction = deductions[filingStatus];
      if (!statusDeduction) {
        return c.json({ success: false, error: `Invalid filing status: ${filingStatus}` }, 400);
      }

      // Calculate total with optional over65/blind modifiers
      const over65 = c.req.query('over65') === 'true';
      const blind = c.req.query('blind') === 'true';
      const spouseOver65 = c.req.query('spouse_over65') === 'true';
      const spouseBlind = c.req.query('spouse_blind') === 'true';

      let total = statusDeduction.base;
      if (over65) total += statusDeduction.over65;
      if (blind) total += statusDeduction.blind;
      if ((filingStatus === 'mfj' || filingStatus === 'qss') && spouseOver65) total += statusDeduction.over65;
      if ((filingStatus === 'mfj' || filingStatus === 'qss') && spouseBlind) total += statusDeduction.blind;

      return c.json({
        success: true,
        data: {
          tax_year: year,
          filing_status: filingStatus,
          base: statusDeduction.base,
          additional_over65: statusDeduction.over65,
          additional_blind: statusDeduction.blind,
          total,
          adjustments_applied: { over65, blind, spouse_over65: spouseOver65, spouse_blind: spouseBlind },
        },
      });
    }

    return c.json({ success: true, data: { tax_year: year, standard_deductions: deductions } });
  });

  // GET /contribution-limits/:year — Retirement/HSA/FSA limits
  router.get('/contribution-limits/:year', (c) => {
    const year = parseInt(c.req.param('year'), 10);
    const account = c.req.query('account');

    const limits = CONTRIBUTION_LIMITS[year];
    if (!limits) {
      return c.json({
        success: false,
        error: `Contribution limits not available for year ${year}. Available: ${Object.keys(CONTRIBUTION_LIMITS).join(', ')}`,
      }, 404);
    }

    if (account) {
      const accountLimit = limits[account];
      if (!accountLimit) {
        return c.json({
          success: false,
          error: `Unknown account type: ${account}. Available: ${Object.keys(limits).join(', ')}`,
        }, 400);
      }
      return c.json({ success: true, data: { tax_year: year, account, ...accountLimit } });
    }

    return c.json({ success: true, data: { tax_year: year, limits } });
  });

  // GET /mileage-rate/:year — IRS standard mileage rates
  router.get('/mileage-rate/:year', (c) => {
    const year = parseInt(c.req.param('year'), 10);

    const rates = MILEAGE_RATES[year];
    if (!rates) {
      return c.json({
        success: false,
        error: `Mileage rates not available for year ${year}. Available: ${Object.keys(MILEAGE_RATES).join(', ')}`,
      }, 404);
    }

    return c.json({
      success: true,
      data: {
        tax_year: year,
        rates_per_mile: rates,
        examples: {
          business_10k_miles: Math.round(rates.business * 10_000 * 100) / 100,
          medical_1k_miles: Math.round(rates.medical * 1_000 * 100) / 100,
          charity_500_miles: Math.round(rates.charity * 500 * 100) / 100,
        },
        note: 'Charity rate is set by statute and rarely changes. Business/medical rates are adjusted annually.',
      },
    });
  });

  // GET /calendar — Tax deadlines
  router.get('/calendar', (c) => {
    const year = parseInt(c.req.query('year') || '2025', 10);
    const upcoming = c.req.query('upcoming') === 'true';

    let calendar = getTaxCalendar(year);

    if (upcoming) {
      const today = new Date().toISOString().split('T')[0];
      calendar = calendar.filter(item => item.date >= today);
    }

    return c.json({
      success: true,
      data: {
        tax_year: year,
        deadlines: calendar,
        total: calendar.length,
        penalty_risk_items: calendar.filter(item => item.penalty_risk).length,
      },
    });
  });

  return router;
}
