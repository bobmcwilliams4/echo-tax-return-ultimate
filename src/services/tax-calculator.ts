// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Federal Tax Calculation Engine (FIE)
// Production-grade 1040 line-by-line calculation | 2025 tax year
// Reverse-engineered from UsTaxes, PolicyEngine, 2025-tax-engine, TAXSIM
// ═══════════════════════════════════════════════════════════════════════════

import { Database } from 'bun:sqlite';
import { createLogger } from '../utils/logger';
import type { TaxCalculationResult, FilingStatus, IncomeItem, Deduction, Dependent } from '../types/tax';

const log = createLogger('tax-calculator');

// ─── 2025 Federal Tax Tables ────────────────────────────────────────────

interface Bracket { min: number; max: number; rate: number; baseTax: number }

const BRACKETS_2025: Record<string, Bracket[]> = {
  single: [
    { min: 0, max: 11925, rate: 0.10, baseTax: 0 },
    { min: 11925, max: 48475, rate: 0.12, baseTax: 1192.50 },
    { min: 48475, max: 103350, rate: 0.22, baseTax: 5578.50 },
    { min: 103350, max: 197300, rate: 0.24, baseTax: 17651.50 },
    { min: 197300, max: 250525, rate: 0.32, baseTax: 40199.50 },
    { min: 250525, max: 626350, rate: 0.35, baseTax: 57231.50 },
    { min: 626350, max: Infinity, rate: 0.37, baseTax: 188769.75 },
  ],
  mfj: [
    { min: 0, max: 23850, rate: 0.10, baseTax: 0 },
    { min: 23850, max: 96950, rate: 0.12, baseTax: 2385 },
    { min: 96950, max: 206700, rate: 0.22, baseTax: 11157 },
    { min: 206700, max: 394600, rate: 0.24, baseTax: 35301 },
    { min: 394600, max: 501050, rate: 0.32, baseTax: 80397 },
    { min: 501050, max: 751600, rate: 0.35, baseTax: 114461 },
    { min: 751600, max: Infinity, rate: 0.37, baseTax: 202154 },
  ],
  mfs: [
    { min: 0, max: 11925, rate: 0.10, baseTax: 0 },
    { min: 11925, max: 48475, rate: 0.12, baseTax: 1192.50 },
    { min: 48475, max: 103350, rate: 0.22, baseTax: 5578.50 },
    { min: 103350, max: 197300, rate: 0.24, baseTax: 17651.50 },
    { min: 197300, max: 250525, rate: 0.32, baseTax: 40199.50 },
    { min: 250525, max: 375800, rate: 0.35, baseTax: 57231.50 },
    { min: 375800, max: Infinity, rate: 0.37, baseTax: 101078 },
  ],
  hoh: [
    { min: 0, max: 17000, rate: 0.10, baseTax: 0 },
    { min: 17000, max: 64850, rate: 0.12, baseTax: 1700 },
    { min: 64850, max: 103350, rate: 0.22, baseTax: 7442 },
    { min: 103350, max: 197300, rate: 0.24, baseTax: 15912 },
    { min: 197300, max: 250500, rate: 0.32, baseTax: 38460 },
    { min: 250500, max: 626350, rate: 0.35, baseTax: 55484 },
    { min: 626350, max: Infinity, rate: 0.37, baseTax: 187032 },
  ],
  qss: [], // Qualifying Surviving Spouse = same as MFJ
};
BRACKETS_2025.qss = BRACKETS_2025.mfj;

// ─── Long-Term Capital Gains Brackets (0% / 15% / 20%) ─────────────────
// These are taxable income thresholds for LTCG rate tiers
const LTCG_BRACKETS_2025: Record<string, { zero: number; fifteen: number }> = {
  single:  { zero: 48350,  fifteen: 533400 },
  mfj:     { zero: 96700,  fifteen: 600050 },
  mfs:     { zero: 48350,  fifteen: 300025 },
  hoh:     { zero: 64750,  fifteen: 566700 },
  qss:     { zero: 96700,  fifteen: 600050 },
};

// ─── Standard Deductions ────────────────────────────────────────────────
const STANDARD_DEDUCTION_2025: Record<string, number> = {
  single: 15700, mfj: 31400, mfs: 15700, hoh: 23500, qss: 31400,
};
const ADDITIONAL_STD_DED_2025 = {
  single_over65: 2000,   // Single/HOH per qualifying condition (over 65 or blind)
  married_over65: 1600,  // MFJ/MFS/QSS per qualifying condition (over 65 or blind)
};

// ─── FICA / SE Tax ──────────────────────────────────────────────────────
const SS_WAGE_BASE_2025 = 176100;
const SS_RATE = 0.124;       // Combined employer+employee for SE
const MEDICARE_RATE = 0.029; // Combined employer+employee for SE
const ADDITIONAL_MEDICARE_RATE = 0.009;
const ADDITIONAL_MEDICARE_THRESHOLDS: Record<string, number> = {
  single: 200000, mfj: 250000, mfs: 125000, hoh: 200000, qss: 250000,
};

// ─── NIIT ───────────────────────────────────────────────────────────────
const NIIT_RATE = 0.038;
const NIIT_THRESHOLDS: Record<string, number> = {
  single: 200000, mfj: 250000, mfs: 125000, hoh: 200000, qss: 250000,
};

// ─── AMT ────────────────────────────────────────────────────────────────
const AMT_EXEMPTIONS_2025: Record<string, number> = {
  single: 88100, mfj: 137000, mfs: 68500, hoh: 88100, qss: 137000,
};
const AMT_PHASEOUT_2025: Record<string, number> = {
  single: 626350, mfj: 1252700, mfs: 626350, hoh: 626350, qss: 1252700,
};
const AMT_RATE_THRESHOLD_2025: Record<string, number> = {
  single: 239100, mfj: 239100, mfs: 119550, hoh: 239100, qss: 239100,
};

// ─── SALT Cap ───────────────────────────────────────────────────────────
const SALT_CAP = 10000;
const SALT_CAP_MFS = 5000;

// ─── Mortgage Interest ──────────────────────────────────────────────────
const MORTGAGE_DEBT_LIMIT = 750000; // Post-TCJA limit
const MORTGAGE_DEBT_LIMIT_GRANDFATHERED = 1000000; // Pre-12/15/2017

// ─── Charitable Contribution AGI Limits ─────────────────────────────────
const CHARITABLE_CASH_AGI_LIMIT = 0.60;
const CHARITABLE_PROPERTY_AGI_LIMIT = 0.30;

// ─── Credits ────────────────────────────────────────────────────────────
const CTC_AMOUNT = 2000;
const CTC_REFUNDABLE_MAX = 1700; // Additional CTC refundable portion
const CTC_PHASEOUT_SINGLE = 200000;
const CTC_PHASEOUT_MFJ = 400000;
const ODC_AMOUNT = 500;

// EIC Tables (2025) — max credit, phase-in rate, phase-out starts, phase-out rate
interface EICParams {
  maxCredit: number;
  phaseInRate: number;
  phaseInEnd: number;
  phaseOutStart: Record<string, number>;
  phaseOutRate: number;
  incomeLimit: Record<string, number>;
}
const EIC_TABLE_2025: Record<number, EICParams> = {
  0: {
    maxCredit: 649, phaseInRate: 0.0765, phaseInEnd: 8490,
    phaseOutStart: { single: 10330, mfj: 18590, hoh: 10330 },
    phaseOutRate: 0.0765,
    incomeLimit: { single: 18591, mfj: 26851, hoh: 18591 },
  },
  1: {
    maxCredit: 4328, phaseInRate: 0.34, phaseInEnd: 12730,
    phaseOutStart: { single: 22090, mfj: 30420, hoh: 22090 },
    phaseOutRate: 0.1598,
    incomeLimit: { single: 49084, mfj: 57414, hoh: 49084 },
  },
  2: {
    maxCredit: 7152, phaseInRate: 0.40, phaseInEnd: 17880,
    phaseOutStart: { single: 22090, mfj: 30420, hoh: 22090 },
    phaseOutRate: 0.2106,
    incomeLimit: { single: 55768, mfj: 64098, hoh: 55768 },
  },
  3: {
    maxCredit: 8046, phaseInRate: 0.45, phaseInEnd: 17880,
    phaseOutStart: { single: 22090, mfj: 30420, hoh: 22090 },
    phaseOutRate: 0.2106,
    incomeLimit: { single: 59899, mfj: 68229, hoh: 59899 },
  },
};

// Education Credits
const AOTC_MAX = 2500; // American Opportunity Tax Credit
const AOTC_EXPENSES_FULL = 2000;
const AOTC_EXPENSES_PARTIAL = 4000;
const AOTC_PHASEOUT: Record<string, { start: number; end: number }> = {
  single: { start: 80000, end: 90000 },
  mfj: { start: 160000, end: 180000 },
  mfs: { start: 0, end: 0 }, // MFS cannot claim AOTC
  hoh: { start: 80000, end: 90000 },
  qss: { start: 160000, end: 180000 },
};

const LLC_MAX = 2000; // Lifetime Learning Credit
const LLC_PHASEOUT: Record<string, { start: number; end: number }> = {
  single: { start: 80000, end: 90000 },
  mfj: { start: 160000, end: 180000 },
  mfs: { start: 0, end: 0 },
  hoh: { start: 80000, end: 90000 },
  qss: { start: 160000, end: 180000 },
};

// Child & Dependent Care Credit (Form 2441)
const DEPENDENT_CARE_MAX_1 = 3000;  // 1 qualifying individual
const DEPENDENT_CARE_MAX_2PLUS = 6000; // 2+ qualifying individuals
const DEPENDENT_CARE_RATE_TABLE: Array<{ agiMax: number; rate: number }> = [
  { agiMax: 15000, rate: 0.35 },
  { agiMax: 17000, rate: 0.34 },
  { agiMax: 19000, rate: 0.33 },
  { agiMax: 21000, rate: 0.32 },
  { agiMax: 23000, rate: 0.31 },
  { agiMax: 25000, rate: 0.30 },
  { agiMax: 27000, rate: 0.29 },
  { agiMax: 29000, rate: 0.28 },
  { agiMax: 31000, rate: 0.27 },
  { agiMax: 33000, rate: 0.26 },
  { agiMax: 35000, rate: 0.25 },
  { agiMax: 37000, rate: 0.24 },
  { agiMax: 39000, rate: 0.23 },
  { agiMax: 41000, rate: 0.22 },
  { agiMax: 43000, rate: 0.21 },
  { agiMax: Infinity, rate: 0.20 },
];

// Saver's Credit (Retirement Savings Contributions Credit)
const SAVERS_CREDIT_RATES: Record<string, Array<{ agiMax: number; rate: number }>> = {
  single: [
    { agiMax: 23750, rate: 0.50 },
    { agiMax: 25750, rate: 0.20 },
    { agiMax: 39500, rate: 0.10 },
    { agiMax: Infinity, rate: 0 },
  ],
  mfj: [
    { agiMax: 47500, rate: 0.50 },
    { agiMax: 51500, rate: 0.20 },
    { agiMax: 79000, rate: 0.10 },
    { agiMax: Infinity, rate: 0 },
  ],
  hoh: [
    { agiMax: 35625, rate: 0.50 },
    { agiMax: 38625, rate: 0.20 },
    { agiMax: 59250, rate: 0.10 },
    { agiMax: Infinity, rate: 0 },
  ],
};
SAVERS_CREDIT_RATES.mfs = SAVERS_CREDIT_RATES.single;
SAVERS_CREDIT_RATES.qss = SAVERS_CREDIT_RATES.mfj;

// QBI §199A
const QBI_THRESHOLD_2025: Record<string, number> = {
  single: 191950, mfj: 383900, mfs: 191950, hoh: 191950, qss: 383900,
};

// ─── Energy Credits (§25C, §25D, §30D) ──────────────────────────────────
const CLEAN_VEHICLE_CREDIT_NEW = 7500;     // §30D new EV
const CLEAN_VEHICLE_CREDIT_USED = 4000;    // §25E used EV
const CLEAN_VEHICLE_AGI_LIMITS: Record<string, number> = {
  single: 150000, mfj: 300000, mfs: 150000, hoh: 225000, qss: 300000,
};
const RESIDENTIAL_ENERGY_RATE = 0.30;      // §25D — 30%, no cap
const ENERGY_EFFICIENT_HOME_RATE = 0.30;   // §25C — 30%, $3,200 annual cap
const ENERGY_EFFICIENT_HOME_CAP = 3200;

// ─── Estimated Tax Penalty (Form 2210) ──────────────────────────────────
const UNDERPAYMENT_PENALTY_RATE = 0.08;    // ~8% annualized rate for 2025
const UNDERPAYMENT_THRESHOLD = 1000;       // Penalty triggers if owed > $1K
const SAFE_HARBOR_PERCENT = 0.90;          // 90% of current year tax
const PRIOR_YEAR_PERCENT = 1.00;           // 100% of prior year tax
const PRIOR_YEAR_HIGH_AGI = 150000;        // AGI threshold for 110% rule
const PRIOR_YEAR_HIGH_PERCENT = 1.10;      // 110% if AGI > $150K

// ─── Passive Activity Loss Rules ────────────────────────────────────────
const PASSIVE_LOSS_EXCEPTION = 25000;      // Active participation exception
const PASSIVE_LOSS_PHASEOUT_START = 100000;// AGI phaseout starts
const PASSIVE_LOSS_PHASEOUT_END = 150000;  // Fully phased out

// ═══════════════════════════════════════════════════════════════════════════
// CORE CALCULATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/** Compute progressive tax from brackets */
function computeBracketTax(income: number, brackets: Bracket[]): { tax: number; marginalRate: number } {
  if (income <= 0) return { tax: 0, marginalRate: 0 };
  let tax = 0;
  let marginalRate = 0;
  for (const bracket of brackets) {
    if (income > bracket.min) {
      const taxableInBracket = Math.min(income, bracket.max) - bracket.min;
      tax = bracket.baseTax + taxableInBracket * bracket.rate;
      marginalRate = bracket.rate;
    }
  }
  return { tax, marginalRate };
}

/**
 * Capital Gains Tax with Stacking (Qualified Dividends & Capital Gains Worksheet)
 * Per UsTaxes SDQualifiedAndCapGains pattern + 2025-tax-engine stacking algorithm
 *
 * Long-term gains and qualified dividends "stack on top" of ordinary income
 * in the bracket structure, filling from where ordinary income stops.
 */
function computeCapitalGainsTax(
  taxableIncome: number,
  ordinaryIncome: number,
  longTermGains: number,
  qualifiedDividends: number,
  filingStatus: string,
): { capGainsTax: number; ordinaryTax: number; totalTax: number } {
  const preferentialIncome = Math.max(0, longTermGains + qualifiedDividends);
  if (preferentialIncome <= 0 || taxableIncome <= 0) {
    const { tax } = computeBracketTax(taxableIncome, BRACKETS_2025[filingStatus] || BRACKETS_2025.single);
    return { capGainsTax: 0, ordinaryTax: tax, totalTax: tax };
  }

  // Cap preferential income at taxable income
  const effectivePreferential = Math.min(preferentialIncome, taxableIncome);
  const effectiveOrdinary = Math.max(0, taxableIncome - effectivePreferential);

  // Ordinary tax on the non-preferential portion
  const { tax: ordinaryTax } = computeBracketTax(effectiveOrdinary, BRACKETS_2025[filingStatus] || BRACKETS_2025.single);

  // Capital gains brackets — gains "stack" on top of ordinary income
  const thresholds = LTCG_BRACKETS_2025[filingStatus] || LTCG_BRACKETS_2025.single;
  let capGainsTax = 0;

  // How much of the 0% bracket is left after ordinary income fills it
  const zeroSpaceLeft = Math.max(0, thresholds.zero - effectiveOrdinary);
  const gainsAt0 = Math.min(effectivePreferential, zeroSpaceLeft);

  // How much fills the 15% bracket
  const fifteenSpaceLeft = Math.max(0, thresholds.fifteen - Math.max(effectiveOrdinary, thresholds.zero));
  const remainingAfterZero = effectivePreferential - gainsAt0;
  const gainsAt15 = Math.min(remainingAfterZero, fifteenSpaceLeft);

  // Rest is at 20%
  const gainsAt20 = Math.max(0, remainingAfterZero - gainsAt15);

  capGainsTax = (gainsAt0 * 0) + (gainsAt15 * 0.15) + (gainsAt20 * 0.20);

  // Use the LESSER of normal bracket tax or stacked tax (per IRS Qualified Dividends worksheet)
  const { tax: fullBracketTax } = computeBracketTax(taxableIncome, BRACKETS_2025[filingStatus] || BRACKETS_2025.single);
  const stackedTax = ordinaryTax + capGainsTax;
  const totalTax = Math.min(fullBracketTax, stackedTax);

  return { capGainsTax, ordinaryTax, totalTax };
}

/** Calculate EIC using phase-in / phase-out (real IRS formula, not approximation) */
function computeEIC(
  earnedIncome: number,
  agi: number,
  numQualifyingChildren: number,
  filingStatus: string,
): number {
  if (filingStatus === 'mfs') return 0; // MFS cannot claim EIC

  const children = Math.min(numQualifyingChildren, 3);
  const params = EIC_TABLE_2025[children];
  if (!params) return 0;

  const statusKey = filingStatus === 'mfj' ? 'mfj' : 'single';
  const incomeLimit = params.incomeLimit[statusKey] || params.incomeLimit.single;

  // Must be below income limit
  if (earnedIncome >= incomeLimit || agi >= incomeLimit) return 0;

  // Phase-in: credit increases as income rises
  const phaseInCredit = Math.min(earnedIncome * params.phaseInRate, params.maxCredit);

  // Phase-out: credit decreases above threshold
  const phaseOutStart = params.phaseOutStart[statusKey] || params.phaseOutStart.single;
  const higherIncome = Math.max(earnedIncome, agi);

  let phaseOutReduction = 0;
  if (higherIncome > phaseOutStart) {
    phaseOutReduction = (higherIncome - phaseOutStart) * params.phaseOutRate;
  }

  const credit = Math.max(0, phaseInCredit - phaseOutReduction);
  return Math.round(credit * 100) / 100;
}

/** Calculate AMT inline */
function computeAMT(
  taxableIncome: number,
  regularTax: number,
  saltDeducted: number,
  deductionMethod: string,
  filingStatus: string,
): { amt: number; amti: number; amtTax: number } {
  // Add back SALT if itemized (primary AMT preference item)
  const saltAddBack = deductionMethod === 'itemized' ? saltDeducted : 0;
  const amti = taxableIncome + saltAddBack;

  // Exemption with phaseout
  const baseExemption = AMT_EXEMPTIONS_2025[filingStatus] || AMT_EXEMPTIONS_2025.single;
  const phaseoutThreshold = AMT_PHASEOUT_2025[filingStatus] || AMT_PHASEOUT_2025.single;
  let exemption = baseExemption;
  if (amti > phaseoutThreshold) {
    exemption = Math.max(0, baseExemption - (amti - phaseoutThreshold) * 0.25);
  }

  const amtBase = Math.max(0, amti - exemption);
  const rateThreshold = AMT_RATE_THRESHOLD_2025[filingStatus] || AMT_RATE_THRESHOLD_2025.single;

  // 26% up to threshold, 28% above
  let amtTax: number;
  if (amtBase <= rateThreshold) {
    amtTax = amtBase * 0.26;
  } else {
    amtTax = (rateThreshold * 0.26) + ((amtBase - rateThreshold) * 0.28);
  }

  // AMT = excess of tentative minimum tax over regular tax
  const amt = Math.max(0, amtTax - regularTax);
  return { amt, amti, amtTax };
}

/** Education credit with phaseout */
function applyPhaseout(credit: number, agi: number, phaseout: { start: number; end: number }): number {
  if (phaseout.end === 0) return 0; // MFS excluded
  if (agi <= phaseout.start) return credit;
  if (agi >= phaseout.end) return 0;
  const ratio = (phaseout.end - agi) / (phaseout.end - phaseout.start);
  return Math.round(credit * ratio * 100) / 100;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN CALCULATION — 18-STEP PRODUCTION PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

export function calculateReturn(db: Database, returnId: string): TaxCalculationResult {
  const startMs = Date.now();

  // ─── Load Data ────────────────────────────────────────────────────

  const taxReturn = db.prepare('SELECT * FROM tax_returns WHERE id = ?').get(returnId) as Record<string, unknown>;
  if (!taxReturn) throw new Error(`Return ${returnId} not found`);

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(taxReturn.client_id as string) as Record<string, unknown>;
  if (!client) throw new Error(`Client not found for return ${returnId}`);

  const filingStatus = (client.filing_status || 'single') as string;
  const incomeItems = db.prepare('SELECT * FROM income_items WHERE return_id = ?').all(returnId) as IncomeItem[];
  const deductionItems = db.prepare('SELECT * FROM deductions WHERE return_id = ?').all(returnId) as Deduction[];
  const dependents = db.prepare('SELECT * FROM dependents WHERE return_id = ?').all(returnId) as Dependent[];

  const warnings: string[] = [];
  const suggestions: string[] = [];
  const formsGenerated: string[] = ['1040'];

  // ═══════════════════════════════════════════════════════════════════
  // STEP 1: Categorize & Total Income (Form 1040 Lines 1-9)
  // ═══════════════════════════════════════════════════════════════════

  let totalIncome = 0;
  let totalWithholding = 0;
  let wageIncome = 0;
  let businessIncome = 0;
  let capitalGainsShort = 0;
  let capitalGainsLong = 0;
  let interestIncome = 0;
  let ordinaryDividends = 0;
  let qualifiedDividends = 0;
  let rentalIncome = 0;
  let socialSecurityIncome = 0;
  let pensionIncome = 0;
  let unemploymentIncome = 0;
  let otherIncome = 0;
  let foreignIncome = 0;
  let foreignTaxPaid = 0;
  let cryptoIncome = 0;

  for (const item of incomeItems) {
    totalIncome += item.amount;
    totalWithholding += item.tax_withheld;

    switch (item.category) {
      case 'wages': case 'salary': case 'tips':
        wageIncome += item.amount;
        break;
      case 'business': case 'nec_1099':
        businessIncome += item.amount;
        formsGenerated.push('Schedule C');
        break;
      case 'capital_gains_short':
        capitalGainsShort += item.amount;
        break;
      case 'capital_gains_long': case 'capital_gains':
        capitalGainsLong += item.amount;
        break;
      case 'interest':
        interestIncome += item.amount;
        if (interestIncome > 1500) formsGenerated.push('Schedule B');
        break;
      case 'dividends':
        ordinaryDividends += item.amount;
        if (ordinaryDividends > 1500) formsGenerated.push('Schedule B');
        break;
      case 'qualified_dividends':
        qualifiedDividends += item.amount;
        ordinaryDividends += item.amount; // QD is subset of ordinary dividends
        break;
      case 'rental': case 'royalty':
        rentalIncome += item.amount;
        formsGenerated.push('Schedule E');
        break;
      case 'social_security':
        socialSecurityIncome += item.amount;
        break;
      case 'pension': case 'annuity': case 'ira_distribution':
        pensionIncome += item.amount;
        break;
      case 'unemployment':
        unemploymentIncome += item.amount;
        break;
      case 'crypto': case 'staking': case 'mining':
        cryptoIncome += item.amount;
        break;
      case 'foreign':
        foreignIncome += item.amount;
        foreignTaxPaid += item.tax_withheld; // Foreign tax paid tracked separately
        break;
      default:
        otherIncome += item.amount;
        break;
    }
  }

  // Net capital gains (enforce $3K annual loss limitation per §1211)
  const netCapitalGains = capitalGainsShort + capitalGainsLong;
  let capitalLossDeduction = 0;
  let capitalLossCarryforward = 0;
  if (netCapitalGains < 0) {
    const maxLoss = filingStatus === 'mfs' ? 1500 : 3000;
    capitalLossDeduction = Math.min(Math.abs(netCapitalGains), maxLoss);
    capitalLossCarryforward = Math.max(0, Math.abs(netCapitalGains) - maxLoss);
    if (capitalLossCarryforward > 0) {
      warnings.push(`Capital loss carryforward of $${capitalLossCarryforward.toLocaleString()} to next tax year`);
    }
  }

  if (capitalGainsShort !== 0 || capitalGainsLong !== 0) {
    formsGenerated.push('Schedule D', 'Form 8949');
  }

  // Social Security taxable portion (up to 85%)
  let taxableSS = 0;
  if (socialSecurityIncome > 0) {
    const provisionalIncome = totalIncome - socialSecurityIncome + (socialSecurityIncome * 0.5);
    const baseThreshold = filingStatus === 'mfj' ? 32000 : 25000;
    const upperThreshold = filingStatus === 'mfj' ? 44000 : 34000;
    if (provisionalIncome > upperThreshold) {
      taxableSS = Math.min(socialSecurityIncome * 0.85,
        (provisionalIncome - upperThreshold) * 0.85 + Math.min((upperThreshold - baseThreshold) * 0.5, socialSecurityIncome * 0.5));
    } else if (provisionalIncome > baseThreshold) {
      taxableSS = Math.min(socialSecurityIncome * 0.50, (provisionalIncome - baseThreshold) * 0.50);
    }
  }

  // Adjust total income for SS and capital loss limitation
  const adjustedTotalIncome = totalIncome - socialSecurityIncome + taxableSS
    - (netCapitalGains < 0 ? Math.abs(netCapitalGains) - capitalLossDeduction : 0);

  // ═══════════════════════════════════════════════════════════════════
  // STEP 2: Self-Employment Tax (Schedule SE)
  // ═══════════════════════════════════════════════════════════════════

  let selfEmploymentTax = 0;
  let seDeduction = 0;
  let additionalMedicareTaxSE = 0;

  if (businessIncome > 0) {
    const netSE = businessIncome * 0.9235; // 92.35% of net SE income

    // Social Security: 12.4% up to wage base (reduced by W-2 wages already subject to SS)
    const ssWagesAlready = Math.min(wageIncome, SS_WAGE_BASE_2025);
    const ssBaseRemaining = Math.max(0, SS_WAGE_BASE_2025 - ssWagesAlready);
    const ssTaxableSE = Math.min(netSE, ssBaseRemaining);
    const ssTax = ssTaxableSE * SS_RATE;

    // Medicare: 2.9% on all SE income (uncapped)
    const medicareTax = netSE * MEDICARE_RATE;

    selfEmploymentTax = ssTax + medicareTax;
    seDeduction = selfEmploymentTax * 0.5; // Deductible half

    // Additional Medicare (0.9%) on combined wages + SE above threshold
    const addMedThreshold = ADDITIONAL_MEDICARE_THRESHOLDS[filingStatus] || 200000;
    const combinedMedicareBase = wageIncome + netSE;
    if (combinedMedicareBase > addMedThreshold) {
      // Only on SE portion above what wages already covered
      const sePortionAbove = Math.max(0, combinedMedicareBase - Math.max(wageIncome, addMedThreshold));
      additionalMedicareTaxSE = sePortionAbove * ADDITIONAL_MEDICARE_RATE;
      selfEmploymentTax += additionalMedicareTaxSE;
    }

    formsGenerated.push('Schedule SE');
  }

  // Additional Medicare Tax on wages (Form 8959)
  let additionalMedicareTaxWages = 0;
  const addMedThreshold = ADDITIONAL_MEDICARE_THRESHOLDS[filingStatus] || 200000;
  if (wageIncome > addMedThreshold) {
    additionalMedicareTaxWages = (wageIncome - addMedThreshold) * ADDITIONAL_MEDICARE_RATE;
    formsGenerated.push('Form 8959');
  }

  // ═══════════════════════════════════════════════════════════════════
  // STEP 3: Adjustments to Income (Schedule 1 Part II, Lines 11-26)
  // ═══════════════════════════════════════════════════════════════════

  let adjustments = seDeduction;
  let hsaDeduction = 0;
  let iraDeduction = 0;
  let studentLoanInterest = 0;
  let educatorExpense = 0;
  let selfEmployedHealthInsurance = 0;

  for (const ded of deductionItems) {
    switch (ded.category) {
      case 'self_employment_tax_deduction':
        // Already counted via seDeduction
        break;
      case 'hsa_contribution':
        hsaDeduction = ded.amount;
        adjustments += ded.amount;
        break;
      case 'ira_contribution':
        iraDeduction = ded.amount;
        adjustments += ded.amount;
        break;
      case 'student_loan_interest':
        studentLoanInterest = Math.min(ded.amount, 2500); // $2,500 cap
        adjustments += studentLoanInterest;
        break;
      case 'educator_expense':
        educatorExpense = Math.min(ded.amount, 300); // $300 cap
        adjustments += educatorExpense;
        break;
      case 'self_employment_health':
        selfEmployedHealthInsurance = ded.amount;
        adjustments += ded.amount;
        break;
      case 'penalty_early_withdrawal':
      case 'alimony_paid':
      case 'moving_expense_military':
      case 'other_above_line':
        adjustments += ded.amount;
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // STEP 4: AGI (Adjusted Gross Income — Line 11)
  // ═══════════════════════════════════════════════════════════════════

  let agi = adjustedTotalIncome - adjustments;

  // ═══════════════════════════════════════════════════════════════════
  // STEP 4B: Passive Activity Loss Limitation (Form 8582)
  // ═══════════════════════════════════════════════════════════════════

  let passiveLossSuspended = 0;
  let passiveLossAllowed = 0;

  if (rentalIncome < 0) {
    const rentalLoss = Math.abs(rentalIncome);

    if (filingStatus === 'mfs') {
      // MFS: no passive loss exception (unless lived apart all year — simplified to $0)
      passiveLossAllowed = 0;
      passiveLossSuspended = rentalLoss;
    } else if (agi >= PASSIVE_LOSS_PHASEOUT_END) {
      // AGI >= $150K: no exception at all
      passiveLossAllowed = 0;
      passiveLossSuspended = rentalLoss;
    } else if (agi <= PASSIVE_LOSS_PHASEOUT_START) {
      // AGI <= $100K: full $25K exception
      passiveLossAllowed = Math.min(rentalLoss, PASSIVE_LOSS_EXCEPTION);
      passiveLossSuspended = Math.max(0, rentalLoss - passiveLossAllowed);
    } else {
      // AGI $100K-$150K: phase out — reduce $25K by 50% of AGI over $100K
      const phaseoutReduction = (agi - PASSIVE_LOSS_PHASEOUT_START) * 0.50;
      const reducedException = Math.max(0, PASSIVE_LOSS_EXCEPTION - phaseoutReduction);
      passiveLossAllowed = Math.min(rentalLoss, reducedException);
      passiveLossSuspended = Math.max(0, rentalLoss - passiveLossAllowed);
    }

    if (passiveLossSuspended > 0) {
      // Re-adjust AGI: add back the disallowed portion of the rental loss
      agi += passiveLossSuspended;
      warnings.push(`Passive activity loss limited: $${round2(passiveLossAllowed).toLocaleString()} allowed, $${round2(passiveLossSuspended).toLocaleString()} suspended (carries forward)`);
      formsGenerated.push('Form 8582');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // STEP 5: Deductions — Standard vs. Itemized (Schedule A)
  // ═══════════════════════════════════════════════════════════════════

  let standardDeduction = STANDARD_DEDUCTION_2025[filingStatus] || 15700;

  // Additional standard deduction for age 65+ and/or blind (§63(f))
  const isMarriedFiling = filingStatus === 'mfj' || filingStatus === 'mfs' || filingStatus === 'qss';
  const additionalPerCondition = isMarriedFiling
    ? ADDITIONAL_STD_DED_2025.married_over65
    : ADDITIONAL_STD_DED_2025.single_over65;

  // Check primary taxpayer age (born before Jan 2, 1961 = over 65 for TY2025)
  const over65Cutoff = new Date('1961-01-02');
  let additionalStdDedCount = 0;
  if (client.date_of_birth) {
    const dob = new Date(client.date_of_birth as string);
    if (dob < over65Cutoff) additionalStdDedCount++;
  }
  if (client.is_blind) additionalStdDedCount++;

  // For MFJ/QSS, also check spouse
  if ((filingStatus === 'mfj' || filingStatus === 'qss') && client.spouse_date_of_birth) {
    const spouseDob = new Date(client.spouse_date_of_birth as string);
    if (spouseDob < over65Cutoff) additionalStdDedCount++;
  }
  if ((filingStatus === 'mfj' || filingStatus === 'qss') && client.spouse_is_blind) {
    additionalStdDedCount++;
  }

  const additionalStdDed = additionalStdDedCount * additionalPerCondition;
  standardDeduction += additionalStdDed;

  if (additionalStdDed > 0) {
    log.info({ additionalStdDed, conditions: additionalStdDedCount }, 'Additional standard deduction applied (age 65+/blind)');
  }

  // Itemized deduction calculation
  let saltTotal = 0;
  let mortgageInterest = 0;
  let charitableCash = 0;
  let charitableProperty = 0;
  let medicalTotal = 0;
  let otherItemized = 0;
  let gamblingLoss = 0;

  for (const ded of deductionItems) {
    switch (ded.category) {
      case 'state_local_taxes': case 'property_taxes':
        saltTotal += ded.amount;
        break;
      case 'mortgage_interest':
        mortgageInterest += ded.amount;
        break;
      case 'charitable_cash':
        charitableCash += ded.amount;
        break;
      case 'charitable_noncash':
        charitableProperty += ded.amount;
        break;
      case 'medical':
        medicalTotal += ded.amount;
        break;
      case 'gambling_loss':
        gamblingLoss += ded.amount;
        break;
      case 'casualty_loss':
      case 'other_itemized':
        otherItemized += ded.amount;
        break;
    }
  }

  // Apply SALT cap ($10K single/MFJ/HOH/QSS, $5K MFS)
  const saltCap = filingStatus === 'mfs' ? SALT_CAP_MFS : SALT_CAP;
  const saltDeducted = Math.min(saltTotal, saltCap);
  if (saltTotal > saltCap) {
    warnings.push(`SALT capped at $${saltCap.toLocaleString()} (claimed $${saltTotal.toLocaleString()}, lost $${(saltTotal - saltCap).toLocaleString()})`);
  }

  // Medical expenses: deductible only above 7.5% AGI floor
  const medicalFloor = agi * 0.075;
  const allowedMedical = Math.max(0, medicalTotal - medicalFloor);
  if (medicalTotal > 0 && allowedMedical === 0) {
    warnings.push(`Medical expenses ($${medicalTotal.toLocaleString()}) below 7.5% AGI floor ($${Math.round(medicalFloor).toLocaleString()})`);
  }

  // Charitable contribution AGI limits
  const charitableCashLimit = agi * CHARITABLE_CASH_AGI_LIMIT;
  const charitablePropertyLimit = agi * CHARITABLE_PROPERTY_AGI_LIMIT;
  const allowedCharitableCash = Math.min(charitableCash, charitableCashLimit);
  const allowedCharitableProperty = Math.min(charitableProperty, charitablePropertyLimit);
  const charitableCarryover = Math.max(0, charitableCash - allowedCharitableCash) +
                              Math.max(0, charitableProperty - allowedCharitableProperty);
  if (charitableCarryover > 0) {
    warnings.push(`Charitable contribution carryover of $${charitableCarryover.toLocaleString()} (exceeds AGI limits)`);
  }

  // Gambling losses limited to gambling winnings
  const gamblingWinnings = incomeItems
    .filter(i => i.category === 'gambling')
    .reduce((sum, i) => sum + i.amount, 0);
  const allowedGamblingLoss = Math.min(gamblingLoss, gamblingWinnings);

  // Mortgage interest (limited to $750K acquisition debt)
  // Simplified — assumes debt metadata would indicate if grandfathered
  const allowedMortgageInterest = mortgageInterest; // Full deduction assumed within limit

  // Total itemized
  const itemizedTotal = saltDeducted + allowedMedical + allowedMortgageInterest +
    allowedCharitableCash + allowedCharitableProperty + allowedGamblingLoss + otherItemized;

  // Choose the better deduction
  const deductionMethod = itemizedTotal > standardDeduction ? 'itemized' : 'standard';
  const deductionAmount = deductionMethod === 'itemized' ? itemizedTotal : standardDeduction;

  if (deductionMethod === 'itemized') formsGenerated.push('Schedule A');

  if (itemizedTotal > 0 && itemizedTotal < standardDeduction) {
    suggestions.push(`Standard deduction ($${standardDeduction.toLocaleString()}) saves $${(standardDeduction - itemizedTotal).toLocaleString()} vs. itemizing`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // STEP 6: QBI Deduction §199A (Line 13)
  // ═══════════════════════════════════════════════════════════════════

  let qbiDeduction = 0;
  if (businessIncome > 0) {
    const qbiThreshold = QBI_THRESHOLD_2025[filingStatus] || 191950;
    const qbiPhaseRange = filingStatus === 'mfj' || filingStatus === 'qss' ? 100000 : 50000;

    if (agi <= qbiThreshold) {
      // Full 20% deduction below threshold
      qbiDeduction = businessIncome * 0.20;
    } else if (agi < qbiThreshold + qbiPhaseRange) {
      // Phase-out range: W-2/UBIA limitations phase in
      const phaseRatio = (agi - qbiThreshold) / qbiPhaseRange;
      qbiDeduction = businessIncome * 0.20 * (1 - phaseRatio);
    }
    // Above threshold+range: W-2/UBIA limits fully apply (would need W-2/UBIA data)

    // QBI deduction cannot exceed 20% of taxable income before QBI
    const taxableBeforeQBI = Math.max(0, agi - deductionAmount);
    qbiDeduction = Math.min(qbiDeduction, taxableBeforeQBI * 0.20);

    if (qbiDeduction > 0) formsGenerated.push('Form 8995');
  }

  // ═══════════════════════════════════════════════════════════════════
  // STEP 7: Taxable Income (Line 15)
  // ═══════════════════════════════════════════════════════════════════

  const taxableIncome = Math.max(0, agi - deductionAmount - qbiDeduction);

  // ═══════════════════════════════════════════════════════════════════
  // STEP 8: Income Tax — Capital Gains Stacking (Line 16)
  // ═══════════════════════════════════════════════════════════════════

  // Separate preferential income (LTCG + qualified dividends) for stacking
  const effectiveLTCG = Math.max(0, capitalGainsLong); // Only gains, not losses
  const ordinaryTaxableIncome = Math.max(0, taxableIncome - effectiveLTCG - qualifiedDividends);

  let ordinaryTax: number;
  let capitalGainsTax: number;
  let incomeTax: number;
  let marginalRate: number;

  if (effectiveLTCG > 0 || qualifiedDividends > 0) {
    // Use QDCG worksheet (stacking algorithm)
    const result = computeCapitalGainsTax(
      taxableIncome, ordinaryTaxableIncome, effectiveLTCG, qualifiedDividends, filingStatus
    );
    ordinaryTax = result.ordinaryTax;
    capitalGainsTax = result.capGainsTax;
    incomeTax = result.totalTax;
    const bracketResult = computeBracketTax(taxableIncome, BRACKETS_2025[filingStatus] || BRACKETS_2025.single);
    marginalRate = bracketResult.marginalRate;
  } else {
    const result = computeBracketTax(taxableIncome, BRACKETS_2025[filingStatus] || BRACKETS_2025.single);
    ordinaryTax = result.tax;
    capitalGainsTax = 0;
    incomeTax = result.tax;
    marginalRate = result.marginalRate;
  }

  // ═══════════════════════════════════════════════════════════════════
  // STEP 9: AMT (Form 6251)
  // ═══════════════════════════════════════════════════════════════════

  const amtResult = computeAMT(taxableIncome, incomeTax, saltDeducted, deductionMethod, filingStatus);
  const amt = amtResult.amt;
  if (amt > 0) {
    formsGenerated.push('Form 6251');
    warnings.push(`AMT of $${amt.toLocaleString()} applies — SALT add-back triggers Alternative Minimum Tax`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // STEP 10: NIIT (Form 8960)
  // ═══════════════════════════════════════════════════════════════════

  let niit = 0;
  const niitThreshold = NIIT_THRESHOLDS[filingStatus] || 200000;
  const totalNII = interestIncome + ordinaryDividends + Math.max(0, capitalGainsShort) +
    Math.max(0, capitalGainsLong) + rentalIncome + cryptoIncome;

  if (agi > niitThreshold && totalNII > 0) {
    const excessAGI = agi - niitThreshold;
    niit = Math.min(totalNII, excessAGI) * NIIT_RATE;
    formsGenerated.push('Form 8960');
  }

  // ═══════════════════════════════════════════════════════════════════
  // STEP 11: Total Tax Before Credits
  // ═══════════════════════════════════════════════════════════════════

  const totalTaxBeforeCredits = incomeTax + selfEmploymentTax + amt + niit + additionalMedicareTaxWages;

  // ═══════════════════════════════════════════════════════════════════
  // STEP 12: Nonrefundable Credits
  // ═══════════════════════════════════════════════════════════════════

  // --- Child Tax Credit (Schedule 8812) ---
  let childTaxCredit = 0;
  let otherDependentCredit = 0;
  const ctcPhaseout = filingStatus === 'mfj' || filingStatus === 'qss' ? CTC_PHASEOUT_MFJ : CTC_PHASEOUT_SINGLE;

  for (const dep of dependents) {
    if (dep.qualifies_ctc) {
      let ctc = CTC_AMOUNT;
      if (agi > ctcPhaseout) {
        // Reduce by $50 for each $1,000 (or fraction) above phaseout
        const reduction = Math.ceil((agi - ctcPhaseout) / 1000) * 50;
        ctc = Math.max(0, ctc - reduction);
      }
      childTaxCredit += ctc;
    } else if (dep.qualifies_odc) {
      otherDependentCredit += ODC_AMOUNT;
    }
  }

  if (childTaxCredit > 0 || otherDependentCredit > 0) {
    formsGenerated.push('Schedule 8812');
  }

  // --- Education Credits (Form 8863) ---
  let educationCredits = 0;
  const educationExpenses = deductionItems
    .filter(d => d.category === 'other_above_line' && d.subcategory === 'education')
    .reduce((sum, d) => sum + d.amount, 0);

  if (educationExpenses > 0) {
    // AOTC: 100% of first $2K + 25% of next $2K = max $2,500
    const aotcBase = Math.min(educationExpenses, AOTC_EXPENSES_FULL) +
      Math.min(Math.max(0, educationExpenses - AOTC_EXPENSES_FULL), AOTC_EXPENSES_PARTIAL - AOTC_EXPENSES_FULL) * 0.25;
    const aotcRaw = Math.min(aotcBase, AOTC_MAX);
    const aotcPhaseout = AOTC_PHASEOUT[filingStatus] || AOTC_PHASEOUT.single;
    const aotc = applyPhaseout(aotcRaw, agi, aotcPhaseout);

    // LLC: 20% of first $10K = max $2,000
    const llcRaw = Math.min(educationExpenses * 0.20, LLC_MAX);
    const llcPhaseout = LLC_PHASEOUT[filingStatus] || LLC_PHASEOUT.single;
    const llc = applyPhaseout(llcRaw, agi, llcPhaseout);

    // Take the better credit (can't claim both for same student)
    educationCredits = Math.max(aotc, llc);
    if (educationCredits > 0) formsGenerated.push('Form 8863');
  }

  // --- Child and Dependent Care Credit (Form 2441) ---
  let childCareCredit = 0;
  const qualifyingCareDeps = dependents.filter(d => d.qualifies_dependent_care).length;
  if (qualifyingCareDeps > 0) {
    const careExpenses = deductionItems
      .filter(d => d.category === 'other_above_line' && d.subcategory === 'dependent_care')
      .reduce((sum, d) => sum + d.amount, 0);

    if (careExpenses > 0) {
      const maxExpenses = qualifyingCareDeps >= 2 ? DEPENDENT_CARE_MAX_2PLUS : DEPENDENT_CARE_MAX_1;
      const allowedExpenses = Math.min(careExpenses, maxExpenses);
      const rateEntry = DEPENDENT_CARE_RATE_TABLE.find(r => agi <= r.agiMax) || { rate: 0.20 };
      childCareCredit = allowedExpenses * rateEntry.rate;
      formsGenerated.push('Form 2441');
    }
  }

  // --- Saver's Credit (Form 8880) ---
  let saversCredit = 0;
  if (iraDeduction > 0 || deductionItems.some(d => d.subcategory === '401k')) {
    const retirementContributions = iraDeduction +
      deductionItems.filter(d => d.subcategory === '401k').reduce((sum, d) => sum + d.amount, 0);
    const maxContrib = Math.min(retirementContributions, filingStatus === 'mfj' ? 4000 : 2000);
    const rates = SAVERS_CREDIT_RATES[filingStatus] || SAVERS_CREDIT_RATES.single;
    const rateEntry = rates.find(r => agi <= r.agiMax);
    if (rateEntry && rateEntry.rate > 0) {
      saversCredit = maxContrib * rateEntry.rate;
      formsGenerated.push('Form 8880');
    }
  }

  // --- Foreign Tax Credit (Form 1116) ---
  let foreignTaxCredit = 0;
  if (foreignTaxPaid > 0) {
    // Simplified: credit = lesser of foreign tax paid or (foreign income / worldwide income) * US tax
    if (foreignIncome > 0 && totalIncome > 0) {
      const foreignRatio = foreignIncome / totalIncome;
      const maxCredit = incomeTax * foreignRatio;
      foreignTaxCredit = Math.min(foreignTaxPaid, maxCredit);
    } else {
      foreignTaxCredit = Math.min(foreignTaxPaid, 300); // $300/$600 direct credit election
    }
    formsGenerated.push('Form 1116');
  }

  // --- Energy Credits (§25C, §25D, §30D) ---
  let energyCredits = 0;
  let cleanVehicleCredit = 0;
  let residentialEnergyCredit = 0;
  let energyEfficientHomeCredit = 0;

  // Clean Vehicle Credit (§30D / §25E)
  const cleanVehicleItems = deductionItems.filter(
    d => d.category === 'other_above_line' && d.subcategory === 'clean_vehicle'
  );
  if (cleanVehicleItems.length > 0) {
    const agiLimit = CLEAN_VEHICLE_AGI_LIMITS[filingStatus] || CLEAN_VEHICLE_AGI_LIMITS.single;
    if (agi <= agiLimit) {
      for (const item of cleanVehicleItems) {
        // Use item description/metadata to distinguish new vs used (default: new)
        const isUsed = (item as Record<string, unknown>).description?.toString().toLowerCase().includes('used');
        const maxCredit = isUsed ? CLEAN_VEHICLE_CREDIT_USED : CLEAN_VEHICLE_CREDIT_NEW;
        cleanVehicleCredit += Math.min(item.amount, maxCredit);
      }
      formsGenerated.push('Form 8936');
    } else {
      warnings.push(`Clean Vehicle Credit not available — AGI ($${round2(agi).toLocaleString()}) exceeds $${agiLimit.toLocaleString()} limit`);
    }
  }

  // Residential Clean Energy Credit (§25D) — 30% of cost, no cap
  const residentialEnergyItems = deductionItems.filter(
    d => d.category === 'other_above_line' && d.subcategory === 'residential_energy'
  );
  if (residentialEnergyItems.length > 0) {
    const totalCost = residentialEnergyItems.reduce((sum, d) => sum + d.amount, 0);
    residentialEnergyCredit = totalCost * RESIDENTIAL_ENERGY_RATE;
    formsGenerated.push('Form 5695');
  }

  // Energy Efficient Home Improvement Credit (§25C) — 30% of cost, $3,200 cap
  const energyEfficientItems = deductionItems.filter(
    d => d.category === 'other_above_line' && d.subcategory === 'energy_efficient_home'
  );
  if (energyEfficientItems.length > 0) {
    const totalCost = energyEfficientItems.reduce((sum, d) => sum + d.amount, 0);
    energyEfficientHomeCredit = Math.min(totalCost * ENERGY_EFFICIENT_HOME_RATE, ENERGY_EFFICIENT_HOME_CAP);
    if (!formsGenerated.includes('Form 5695')) formsGenerated.push('Form 5695');
  }

  energyCredits = cleanVehicleCredit + residentialEnergyCredit + energyEfficientHomeCredit;

  // Total nonrefundable credits (capped at tax liability)
  const totalNonrefundable = childTaxCredit + otherDependentCredit + educationCredits +
    childCareCredit + saversCredit + foreignTaxCredit + energyCredits;
  const nonrefundableCapped = Math.min(totalNonrefundable, totalTaxBeforeCredits);

  // ═══════════════════════════════════════════════════════════════════
  // STEP 13: Tax After Nonrefundable Credits
  // ═══════════════════════════════════════════════════════════════════

  const taxAfterNonrefundable = Math.max(0, totalTaxBeforeCredits - nonrefundableCapped);

  // ═══════════════════════════════════════════════════════════════════
  // STEP 14: Refundable Credits
  // ═══════════════════════════════════════════════════════════════════

  // --- EIC (Earned Income Credit) ---
  const earnedIncome = wageIncome + Math.max(0, businessIncome);
  const eicChildren = dependents.filter(d => d.qualifies_eic).length;
  const earnedIncomeCredit = computeEIC(earnedIncome, agi, eicChildren, filingStatus);
  if (earnedIncomeCredit > 0) formsGenerated.push('Schedule EIC');

  // --- Additional Child Tax Credit (refundable portion of CTC) ---
  let additionalCTC = 0;
  const ctcUsed = Math.min(childTaxCredit, totalTaxBeforeCredits);
  const ctcExcess = childTaxCredit - ctcUsed;
  if (ctcExcess > 0) {
    // Refundable ACTC: up to $1,700 per qualifying child
    const qualifyingCTCKids = dependents.filter(d => d.qualifies_ctc).length;
    const actcMax = qualifyingCTCKids * CTC_REFUNDABLE_MAX;
    additionalCTC = Math.min(ctcExcess, actcMax);
  }

  // --- AOTC Refundable portion (40% of AOTC is refundable) ---
  let refundableEducation = 0;
  if (educationCredits > 0 && educationExpenses > 0) {
    // 40% of AOTC is refundable
    const aotcPhaseout = AOTC_PHASEOUT[filingStatus] || AOTC_PHASEOUT.single;
    const aotcBase = Math.min(educationExpenses, AOTC_EXPENSES_FULL) +
      Math.min(Math.max(0, educationExpenses - AOTC_EXPENSES_FULL), AOTC_EXPENSES_PARTIAL - AOTC_EXPENSES_FULL) * 0.25;
    const aotcRaw = Math.min(aotcBase, AOTC_MAX);
    const aotc = applyPhaseout(aotcRaw, agi, aotcPhaseout);
    refundableEducation = aotc * 0.40;
  }

  const totalRefundable = earnedIncomeCredit + additionalCTC + refundableEducation;

  // ═══════════════════════════════════════════════════════════════════
  // STEP 15: Total Credits
  // ═══════════════════════════════════════════════════════════════════

  const totalCredits = nonrefundableCapped + totalRefundable;

  // ═══════════════════════════════════════════════════════════════════
  // STEP 16: Total Tax (Line 24)
  // ═══════════════════════════════════════════════════════════════════

  const totalTax = taxAfterNonrefundable;

  // ═══════════════════════════════════════════════════════════════════
  // STEP 17: Payments, Withholding & Refund (Lines 25-37)
  // ═══════════════════════════════════════════════════════════════════

  // Pull estimated payments from return data
  const estimatedPayments = (taxReturn.estimated_payments as number) || 0;
  const totalPayments = totalWithholding + estimatedPayments;

  // Net result: payments + refundable credits - total tax
  const refundOrOwed = totalPayments + totalRefundable - totalTax;

  const effectiveRate = totalIncome > 0 ? totalTaxBeforeCredits / totalIncome : 0;

  // ═══════════════════════════════════════════════════════════════════
  // STEP 17B: Estimated Tax Penalty (Form 2210)
  // ═══════════════════════════════════════════════════════════════════

  let estimatedTaxPenalty = 0;
  const amountOwed = totalTax - totalPayments - totalRefundable;
  const priorYearTax = (taxReturn.prior_year_tax as number) || 0;

  if (amountOwed > UNDERPAYMENT_THRESHOLD) {
    const currentYearSafeHarbor = totalTax * SAFE_HARBOR_PERCENT;
    const priorYearSafeHarbor = priorYearTax * (agi > PRIOR_YEAR_HIGH_AGI ? PRIOR_YEAR_HIGH_PERCENT : PRIOR_YEAR_PERCENT);

    // Penalty applies if payments < 90% of current year AND < 100%/110% of prior year
    const meetsCurrentYearException = totalPayments >= currentYearSafeHarbor;
    const meetsPriorYearException = priorYearTax > 0 && totalPayments >= priorYearSafeHarbor;

    if (!meetsCurrentYearException && !meetsPriorYearException) {
      // Simplified penalty: annualized rate on the underpayment amount
      const underpayment = Math.max(0, Math.min(currentYearSafeHarbor, totalTax) - totalPayments);
      estimatedTaxPenalty = round2(underpayment * UNDERPAYMENT_PENALTY_RATE);

      if (estimatedTaxPenalty > 0) {
        warnings.push(`Estimated tax penalty of $${estimatedTaxPenalty.toLocaleString()} may apply (Form 2210) — underpayment of $${round2(underpayment).toLocaleString()}`);
        formsGenerated.push('Form 2210');
      }
    }
  }

  // Adjust final refund/owed to include penalty
  const finalRefundOrOwed = refundOrOwed - estimatedTaxPenalty;

  // ═══════════════════════════════════════════════════════════════════
  // STEP 18: Optimization Suggestions
  // ═══════════════════════════════════════════════════════════════════

  if (businessIncome > 50000 && qbiDeduction > 0) {
    suggestions.push(`QBI deduction saving $${Math.round(qbiDeduction * marginalRate).toLocaleString()} in taxes`);
  }

  if (businessIncome > 40000) {
    suggestions.push('Consider S-Corp election to reduce SE tax on income above reasonable compensation');
  }

  if (finalRefundOrOwed > 2000) {
    suggestions.push(`Large refund of $${Math.round(finalRefundOrOwed).toLocaleString()} — consider reducing withholding to increase take-home pay`);
  }

  if (finalRefundOrOwed < -1000) {
    suggestions.push(`Underpayment of $${Math.abs(Math.round(finalRefundOrOwed)).toLocaleString()} — consider making estimated payments to avoid penalty`);
  }

  if (saltTotal > saltCap && mortgageInterest === 0) {
    suggestions.push('High SALT but no mortgage interest — SALT cap limits deduction benefit');
  }

  if (agi > 200000 && iraDeduction === 0) {
    suggestions.push('Consider backdoor Roth IRA contribution (no income limit for conversions)');
  }

  if (businessIncome > 0 && hsaDeduction === 0) {
    suggestions.push('Self-employed? HSA contributions reduce AGI and grow tax-free');
  }

  if (capitalLossCarryforward > 0) {
    suggestions.push(`$${capitalLossCarryforward.toLocaleString()} capital loss carries forward — track for next year's Schedule D`);
  }

  if (charitableCarryover > 0) {
    suggestions.push(`$${charitableCarryover.toLocaleString()} charitable deduction carries forward (5-year carryover period)`);
  }

  if (passiveLossSuspended > 0) {
    suggestions.push(`$${round2(passiveLossSuspended).toLocaleString()} passive loss suspended — deductible when property is disposed of or AGI drops below $${PASSIVE_LOSS_PHASEOUT_END.toLocaleString()}`);
  }

  if (amt > 0) {
    suggestions.push('AMT triggered — consider spreading large itemized deductions across tax years');
  }

  if (qualifiedDividends > 0 || effectiveLTCG > 0) {
    suggestions.push(`Preferential rates on $${(qualifiedDividends + effectiveLTCG).toLocaleString()} of qualified dividends/LTCG — tax-efficient positioning`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // STEP 19: Store Results & Return
  // ═══════════════════════════════════════════════════════════════════

  const latency = Date.now() - startMs;
  log.info({
    returnId, latencyMs: latency,
    agi: round2(agi), taxableIncome: round2(taxableIncome),
    totalTax: round2(totalTaxBeforeCredits), refundOrOwed: round2(finalRefundOrOwed),
  }, 'Tax calculation complete');

  return {
    total_income: round2(adjustedTotalIncome),
    adjustments: round2(adjustments),
    adjusted_gross_income: round2(agi),
    deduction_method: deductionMethod as 'standard' | 'itemized',
    deduction_amount: round2(deductionAmount),
    qbi_deduction: round2(qbiDeduction),
    taxable_income: round2(taxableIncome),
    ordinary_tax: round2(ordinaryTax),
    capital_gains_tax: round2(capitalGainsTax),
    self_employment_tax: round2(selfEmploymentTax),
    amt: round2(amt),
    niit: round2(niit),
    total_tax: round2(totalTaxBeforeCredits),
    credits: {
      child_tax_credit: round2(childTaxCredit),
      other_dependent_credit: round2(otherDependentCredit),
      earned_income_credit: round2(earnedIncomeCredit),
      education_credits: round2(educationCredits),
      child_care_credit: round2(childCareCredit),
      saver_credit: round2(saversCredit),
      foreign_tax_credit: round2(foreignTaxCredit),
      energy_credits: round2(energyCredits),
      clean_vehicle_credit: round2(cleanVehicleCredit),
      residential_energy_credit: round2(residentialEnergyCredit),
      energy_efficient_home_credit: round2(energyEfficientHomeCredit),
      other_credits: 0,
      total: round2(totalCredits),
    },
    total_credits: round2(totalCredits),
    total_payments: round2(totalPayments),
    estimated_tax_penalty: round2(estimatedTaxPenalty),
    passive_loss_suspended: round2(passiveLossSuspended),
    additional_standard_deduction: round2(additionalStdDed),
    refund_or_owed: round2(finalRefundOrOwed),
    effective_rate: Math.round(effectiveRate * 10000) / 100,
    marginal_rate: Math.round(marginalRate * 100),
    forms_generated: [...new Set(formsGenerated)],
    warnings,
    optimization_suggestions: suggestions,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
