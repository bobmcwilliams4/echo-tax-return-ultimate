// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Federal Tax Calculation Engine (FIE)
// Line-by-line 1040 calculation | 2025 tax year (adjustable)
// ═══════════════════════════════════════════════════════════════════════════

import { Database } from 'bun:sqlite';
import { createLogger } from '../utils/logger';
import type { TaxCalculationResult, FilingStatus, IncomeItem, Deduction, Dependent } from '../types/tax';

const log = createLogger('tax-calculator');

// ─── 2025 Tax Tables ────────────────────────────────────────────────────

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
  qss: [], // Same as MFJ — populated below
};
BRACKETS_2025.qss = BRACKETS_2025.mfj;

const STANDARD_DEDUCTION_2025: Record<string, number> = {
  single: 15700,
  mfj: 31400,
  mfs: 15700,
  hoh: 23500,
  qss: 31400,
};

const ADDITIONAL_STD_DED_2025 = { single_over65: 2000, married_over65: 1600 };

const FICA_2025 = {
  social_security_rate: 0.062,
  social_security_wage_base: 176100,
  medicare_rate: 0.0145,
  additional_medicare_rate: 0.009,
  additional_medicare_threshold_single: 200000,
  additional_medicare_threshold_mfj: 250000,
};

const SE_TAX_RATE = 0.153; // 12.4% SS + 2.9% Medicare
const SE_TAX_DEDUCTION_RATE = 0.5; // Deduct 50% of SE tax

const NIIT_RATE = 0.038;
const NIIT_THRESHOLDS: Record<string, number> = {
  single: 200000, mfj: 250000, mfs: 125000, hoh: 200000, qss: 250000,
};

const SALT_CAP = 10000;

const CTC_AMOUNT = 2000;
const CTC_REFUNDABLE_MAX = 1700;
const CTC_PHASEOUT_SINGLE = 200000;
const CTC_PHASEOUT_MFJ = 400000;
const ODC_AMOUNT = 500;

// ─── Main Calculation ───────────────────────────────────────────────────

export function calculateReturn(db: Database, returnId: string): TaxCalculationResult {
  const startMs = Date.now();

  // Load return data
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

  // ─── Step 1: Total Income ─────────────────────────────────────────

  let totalIncome = 0;
  let totalWithholding = 0;
  let wageIncome = 0;
  let businessIncome = 0;
  let capitalGainsShort = 0;
  let capitalGainsLong = 0;
  let investmentIncome = 0;
  let rentalIncome = 0;

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
      case 'interest': case 'dividends': case 'qualified_dividends':
        investmentIncome += item.amount;
        break;
      case 'rental':
        rentalIncome += item.amount;
        formsGenerated.push('Schedule E');
        break;
    }
  }

  if (capitalGainsShort !== 0 || capitalGainsLong !== 0) {
    formsGenerated.push('Schedule D', 'Form 8949');
  }

  // ─── Step 2: Self-Employment Tax ──────────────────────────────────

  let selfEmploymentTax = 0;
  let seDeduction = 0;

  if (businessIncome > 0) {
    const netSE = businessIncome * 0.9235; // 92.35% of net SE income
    const ssTax = Math.min(netSE, FICA_2025.social_security_wage_base) * FICA_2025.social_security_rate * 2;
    const medicareTax = netSE * FICA_2025.medicare_rate * 2;
    selfEmploymentTax = ssTax + medicareTax;
    seDeduction = selfEmploymentTax * SE_TAX_DEDUCTION_RATE;
    formsGenerated.push('Schedule SE');
  }

  // ─── Step 3: Adjustments (Above-the-Line Deductions) ──────────────

  let adjustments = seDeduction;

  for (const ded of deductionItems) {
    if (['student_loan_interest', 'educator_expense', 'hsa_contribution', 'ira_contribution',
         'self_employment_health', 'self_employment_tax_deduction', 'penalty_early_withdrawal',
         'alimony_paid', 'moving_expense_military', 'other_above_line'].includes(ded.category)) {
      adjustments += ded.amount;
    }
  }

  const agi = totalIncome - adjustments;

  // ─── Step 4: Deduction (Standard vs. Itemized) ────────────────────

  const standardDeduction = STANDARD_DEDUCTION_2025[filingStatus] || 15700;

  // Calculate itemized total
  let itemizedTotal = 0;
  let saltTotal = 0;
  let medicalTotal = 0;
  const medicalFloor = agi * 0.075;

  for (const ded of deductionItems) {
    switch (ded.category) {
      case 'state_local_taxes': case 'property_taxes':
        saltTotal += ded.amount;
        break;
      case 'medical':
        medicalTotal += ded.amount;
        break;
      case 'mortgage_interest':
      case 'charitable_cash': case 'charitable_noncash':
      case 'casualty_loss': case 'gambling_loss':
      case 'other_itemized':
        itemizedTotal += ded.amount;
        break;
    }
  }

  // Apply SALT cap
  itemizedTotal += Math.min(saltTotal, SALT_CAP);
  if (saltTotal > SALT_CAP) {
    warnings.push(`SALT deduction capped at $${SALT_CAP.toLocaleString()} (you claimed $${saltTotal.toLocaleString()})`);
  }

  // Apply medical floor
  const allowedMedical = Math.max(0, medicalTotal - medicalFloor);
  itemizedTotal += allowedMedical;

  if (medicalTotal > 0 && allowedMedical === 0) {
    warnings.push(`Medical expenses ($${medicalTotal.toLocaleString()}) below 7.5% AGI floor ($${Math.round(medicalFloor).toLocaleString()})`);
  }

  // Choose better deduction method
  const deductionMethod = itemizedTotal > standardDeduction ? 'itemized' : 'standard';
  const deductionAmount = deductionMethod === 'itemized' ? itemizedTotal : standardDeduction;

  if (deductionMethod === 'itemized') {
    formsGenerated.push('Schedule A');
  }

  if (itemizedTotal > 0 && itemizedTotal < standardDeduction) {
    suggestions.push(`Standard deduction ($${standardDeduction.toLocaleString()}) saves you $${(standardDeduction - itemizedTotal).toLocaleString()} vs. itemizing`);
  }

  // ─── Step 5: QBI Deduction (§199A) ────────────────────────────────

  let qbiDeduction = 0;
  if (businessIncome > 0) {
    const qbiThreshold = filingStatus === 'mfj' || filingStatus === 'qss' ? 383900 : 191950;
    if (agi <= qbiThreshold) {
      qbiDeduction = businessIncome * 0.20; // Full 20% below threshold
    }
    // Above threshold: W-2/UBIA limitations apply (simplified here)
    const taxableBeforeQBI = agi - deductionAmount;
    qbiDeduction = Math.min(qbiDeduction, taxableBeforeQBI * 0.20);
  }

  // ─── Step 6: Taxable Income ───────────────────────────────────────

  const taxableIncome = Math.max(0, agi - deductionAmount - qbiDeduction);

  // ─── Step 7: Ordinary Tax (from brackets) ─────────────────────────

  const brackets = BRACKETS_2025[filingStatus] || BRACKETS_2025.single;
  let ordinaryTax = 0;
  let marginalRate = 0;

  // Separate long-term capital gains for preferential rates
  const ordinaryTaxableIncome = Math.max(0, taxableIncome - capitalGainsLong);

  for (const bracket of brackets) {
    if (ordinaryTaxableIncome > bracket.min) {
      const amountInBracket = Math.min(ordinaryTaxableIncome, bracket.max) - bracket.min;
      ordinaryTax = bracket.baseTax + amountInBracket * bracket.rate;
      marginalRate = bracket.rate;
    }
  }

  // Long-term capital gains tax (0% / 15% / 20%)
  let capitalGainsTax = 0;
  if (capitalGainsLong > 0) {
    const ltcgThresholds = filingStatus === 'single' ? [47025, 518900] :
                           filingStatus === 'mfj' || filingStatus === 'qss' ? [94050, 583750] :
                           filingStatus === 'hoh' ? [63000, 551350] : [47025, 291850];

    if (taxableIncome <= ltcgThresholds[0]) {
      capitalGainsTax = 0;
    } else if (taxableIncome <= ltcgThresholds[1]) {
      capitalGainsTax = capitalGainsLong * 0.15;
    } else {
      capitalGainsTax = capitalGainsLong * 0.20;
    }
  }

  // ─── Step 8: AMT ──────────────────────────────────────────────────

  // Simplified AMT (full implementation in calculations.ts)
  let amt = 0;
  if (agi > 250000) {
    // Flag for detailed AMT calculation
    warnings.push('AMT may apply — run detailed AMT calculation via /calc/amt endpoint');
  }

  // ─── Step 9: NIIT ─────────────────────────────────────────────────

  let niit = 0;
  const niitThreshold = NIIT_THRESHOLDS[filingStatus] || 200000;
  const totalNII = investmentIncome + capitalGainsShort + capitalGainsLong + rentalIncome;
  if (agi > niitThreshold && totalNII > 0) {
    const excessAGI = agi - niitThreshold;
    niit = Math.min(totalNII, excessAGI) * NIIT_RATE;
    formsGenerated.push('Form 8960');
  }

  // ─── Step 10: Total Tax ───────────────────────────────────────────

  const totalTax = ordinaryTax + capitalGainsTax + selfEmploymentTax + amt + niit;

  // ─── Step 11: Credits ─────────────────────────────────────────────

  let childTaxCredit = 0;
  let otherDependentCredit = 0;
  let earnedIncomeCredit = 0;

  // CTC
  const ctcPhaseout = filingStatus === 'mfj' || filingStatus === 'qss' ? CTC_PHASEOUT_MFJ : CTC_PHASEOUT_SINGLE;
  for (const dep of dependents) {
    if (dep.qualifies_ctc) {
      let ctc = CTC_AMOUNT;
      if (agi > ctcPhaseout) {
        const reduction = Math.ceil((agi - ctcPhaseout) / 1000) * 50;
        ctc = Math.max(0, ctc - reduction);
      }
      childTaxCredit += ctc;
    } else if (dep.qualifies_odc) {
      otherDependentCredit += ODC_AMOUNT;
    }
  }

  // EIC (simplified — real EIC tables are complex)
  if (wageIncome > 0 && wageIncome < 60000 && filingStatus !== 'mfs') {
    const eicChildren = dependents.filter(d => d.qualifies_eic).length;
    // Approximate EIC — real calculation uses lookup tables
    if (eicChildren >= 3 && wageIncome < 59899) earnedIncomeCredit = Math.min(7830, wageIncome * 0.45);
    else if (eicChildren === 2 && wageIncome < 55768) earnedIncomeCredit = Math.min(6960, wageIncome * 0.40);
    else if (eicChildren === 1 && wageIncome < 49084) earnedIncomeCredit = Math.min(4213, wageIncome * 0.34);
    else if (eicChildren === 0 && wageIncome < 18591) earnedIncomeCredit = Math.min(632, wageIncome * 0.0765);

    if (earnedIncomeCredit > 0) formsGenerated.push('Schedule EIC');
  }

  const totalCredits = childTaxCredit + otherDependentCredit + earnedIncomeCredit;

  // ─── Step 12: Payments & Refund ───────────────────────────────────

  const estimatedPayments = 0; // Would come from client data
  const totalPayments = totalWithholding + estimatedPayments;
  const refundOrOwed = totalPayments + totalCredits - totalTax;

  const effectiveRate = totalIncome > 0 ? totalTax / totalIncome : 0;

  // ─── Step 13: Optimization Suggestions ────────────────────────────

  if (businessIncome > 50000 && qbiDeduction > 0) {
    suggestions.push(`QBI deduction saving you $${Math.round(qbiDeduction * marginalRate).toLocaleString()} in taxes`);
  }

  if (businessIncome > 40000) {
    suggestions.push('Consider S-Corp election to reduce SE tax on income above reasonable compensation');
  }

  if (refundOrOwed > 1000) {
    suggestions.push('Large refund detected — consider reducing withholding to increase take-home pay');
  }

  if (refundOrOwed < -1000) {
    suggestions.push('Underpayment detected — consider increasing withholding or making estimated payments');
  }

  const latency = Date.now() - startMs;
  log.info({ returnId, latencyMs: latency, refundOrOwed: Math.round(refundOrOwed) }, 'Tax calculation complete');

  return {
    total_income: round2(totalIncome),
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
    total_tax: round2(totalTax),
    credits: {
      child_tax_credit: round2(childTaxCredit),
      other_dependent_credit: round2(otherDependentCredit),
      earned_income_credit: round2(earnedIncomeCredit),
      education_credits: 0,
      child_care_credit: 0,
      saver_credit: 0,
      foreign_tax_credit: 0,
      energy_credits: 0,
      other_credits: 0,
      total: round2(totalCredits),
    },
    total_credits: round2(totalCredits),
    total_payments: round2(totalPayments),
    refund_or_owed: round2(refundOrOwed),
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
