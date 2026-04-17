// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — State Income Tax Calculation Engine (STE)
// All 50 states + DC | Progressive, flat, and no-tax states
// Real 2024-2025 brackets, deductions, exemptions, and local surcharges
// ═══════════════════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger';

const log = createLogger('state-tax-engine');

// ─── Types ─────────────────────────────────────────────────────────────

export interface StateBracket {
  min: number;
  max: number;
  rate: number;
}

export interface StateDeductions {
  single: number;
  mfj: number;
  mfs: number;
  hoh: number;
}

export interface StateExemptions {
  personal: number;
  dependent: number;
}

export type StateTaxType = 'none' | 'flat' | 'progressive' | 'interest_dividends_only';

export interface StateTaxConfig {
  code: string;
  name: string;
  type: StateTaxType;
  flat_rate?: number;
  brackets_single?: StateBracket[];
  brackets_mfj?: StateBracket[];
  brackets_mfs?: StateBracket[];
  brackets_hoh?: StateBracket[];
  standard_deduction?: StateDeductions;
  personal_exemption?: StateExemptions;
  allows_federal_deduction?: boolean;
  conforms_to_federal_agi?: boolean;
  special_rules?: string[];
  notes?: string[];
}

export interface StateCalculationResult {
  state: string;
  state_name: string;
  taxable_income: number;
  state_tax: number;
  effective_rate: number;
  marginal_rate: number;
  standard_deduction: number;
  personal_exemption: number;
  brackets_used: Array<{ rate: number; amount: number; tax: number }>;
  credits: number;
  local_tax?: number;
  notes: string[];
}

export interface StateCalculationOptions {
  locality?: string;
  itemizedDeductions?: number;
  dependents?: number;
}

// ─── Filing Status Normalization ───────────────────────────────────────

type NormalizedStatus = 'single' | 'mfj' | 'mfs' | 'hoh';

function normalizeStatus(status: string): NormalizedStatus {
  const s = status.toLowerCase().replace(/[^a-z]/g, '');
  if (s === 'mfj' || s.includes('marriedfiling') && s.includes('joint') || s === 'married' || s === 'qss') return 'mfj';
  if (s === 'mfs' || s.includes('marriedfiling') && s.includes('separate')) return 'mfs';
  if (s === 'hoh' || s.includes('headof')) return 'hoh';
  return 'single';
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE TAX DATA — ALL 50 STATES + DC (2024-2025 Tax Year)
// ═══════════════════════════════════════════════════════════════════════════

const STATE_TAX_DATA: Record<string, StateTaxConfig> = {

  // ─── No Income Tax States ────────────────────────────────────────────

  AK: {
    code: 'AK', name: 'Alaska', type: 'none',
    notes: ['No state income tax', 'Permanent Fund Dividend may be taxable federally'],
  },
  FL: {
    code: 'FL', name: 'Florida', type: 'none',
    notes: ['No state income tax', 'No estate/inheritance tax'],
  },
  NV: {
    code: 'NV', name: 'Nevada', type: 'none',
    notes: ['No state income tax', 'Commerce Tax on businesses over $4M gross revenue'],
  },
  SD: {
    code: 'SD', name: 'South Dakota', type: 'none',
    notes: ['No state income tax', 'No corporate income tax'],
  },
  TX: {
    code: 'TX', name: 'Texas', type: 'none',
    notes: ['No state income tax', 'Franchise (margin) tax on businesses'],
  },
  WA: {
    code: 'WA', name: 'Washington', type: 'none',
    notes: ['No state income tax', '7% capital gains tax on gains over $262,000 (2025)'],
  },
  WY: {
    code: 'WY', name: 'Wyoming', type: 'none',
    notes: ['No state income tax', 'No corporate income tax'],
  },

  // ─── Interest/Dividends Only States ──────────────────────────────────

  NH: {
    code: 'NH', name: 'New Hampshire', type: 'interest_dividends_only',
    flat_rate: 0.03, // 3% in 2025 (was 4% in 2024, 5% before that, phasing out)
    notes: [
      'Tax on interest and dividends only (3% in 2025)',
      'Phasing out: was 5%, then 4% (2024), 3% (2025), 0% starting 2027',
      'No tax on wages, salaries, or business income',
      '$2,400 exemption single / $4,800 MFJ',
    ],
  },
  TN: {
    code: 'TN', name: 'Tennessee', type: 'none',
    notes: [
      'No state income tax',
      'Hall Income Tax on interest/dividends ended January 1, 2021',
    ],
  },

  // ─── Flat Tax States ─────────────────────────────────────────────────

  AZ: {
    code: 'AZ', name: 'Arizona', type: 'flat',
    flat_rate: 0.025,
    standard_deduction: { single: 14_600, mfj: 29_200, mfs: 14_600, hoh: 21_900 },
    personal_exemption: { personal: 0, dependent: 100 },
    conforms_to_federal_agi: true,
    notes: ['Flat 2.5% rate effective 2023+', 'Conforms to federal standard deduction amounts'],
  },
  CO: {
    code: 'CO', name: 'Colorado', type: 'flat',
    flat_rate: 0.044,
    standard_deduction: { single: 14_600, mfj: 29_200, mfs: 14_600, hoh: 21_900 },
    conforms_to_federal_agi: true,
    notes: ['Flat 4.4% rate (reduced from 4.55% in 2024)', 'Uses federal taxable income as starting point'],
  },
  GA: {
    code: 'GA', name: 'Georgia', type: 'flat',
    flat_rate: 0.0549,
    standard_deduction: { single: 12_000, mfj: 24_000, mfs: 12_000, hoh: 18_000 },
    personal_exemption: { personal: 2_700, dependent: 3_000 },
    notes: ['5.49% flat rate (2025, transitioning from progressive)', 'Moving to 5.39% in 2026'],
  },
  ID: {
    code: 'ID', name: 'Idaho', type: 'flat',
    flat_rate: 0.05695,
    standard_deduction: { single: 14_600, mfj: 29_200, mfs: 14_600, hoh: 21_900 },
    conforms_to_federal_agi: true,
    notes: ['Flat 5.695% rate effective 2023+', 'Conforms to federal standard deduction'],
  },
  IL: {
    code: 'IL', name: 'Illinois', type: 'flat',
    flat_rate: 0.0495,
    personal_exemption: { personal: 2_425, dependent: 2_425 },
    notes: ['Flat 4.95% rate', 'No standard deduction — uses personal exemption of $2,425', 'Starts from federal AGI'],
  },
  IN: {
    code: 'IN', name: 'Indiana', type: 'flat',
    flat_rate: 0.0305,
    personal_exemption: { personal: 1_000, dependent: 1_500 },
    notes: ['Flat 3.05% rate (2025)', 'County income taxes range 0.5%-2.9% additional', 'Uses federal AGI as starting point'],
  },
  IA: {
    code: 'IA', name: 'Iowa', type: 'flat',
    flat_rate: 0.038,
    standard_deduction: { single: 2_210, mfj: 5_450, mfs: 2_210, hoh: 5_450 },
    allows_federal_deduction: false,
    notes: ['Flat 3.8% rate (2025, was progressive before 2023)', 'Federal tax deduction eliminated with flat tax transition'],
  },
  KY: {
    code: 'KY', name: 'Kentucky', type: 'flat',
    flat_rate: 0.04,
    standard_deduction: { single: 3_160, mfj: 3_160, mfs: 3_160, hoh: 3_160 },
    notes: ['Flat 4.0% rate (2025)', 'Was 4.5% in 2024, reducing over time'],
  },
  MA: {
    code: 'MA', name: 'Massachusetts', type: 'flat',
    flat_rate: 0.05,
    notes: [
      'Flat 5.0% on Part A income (wages, interest, dividends)',
      'Additional 4% surtax on income over $1M (Millionaire Tax, effective 2023)',
      '12% on short-term capital gains',
      'No standard deduction — uses personal exemption ($4,400 single / $8,800 MFJ)',
    ],
    personal_exemption: { personal: 4_400, dependent: 1_000 },
  },
  MI: {
    code: 'MI', name: 'Michigan', type: 'flat',
    flat_rate: 0.0425,
    personal_exemption: { personal: 5_600, dependent: 5_600 },
    notes: ['Flat 4.25% rate', 'Personal exemption $5,600 per person (2025)', 'Some cities levy additional income tax (Detroit 2.4%)'],
  },
  MS: {
    code: 'MS', name: 'Mississippi', type: 'flat',
    flat_rate: 0.05,
    standard_deduction: { single: 2_300, mfj: 4_600, mfs: 2_300, hoh: 3_400 },
    personal_exemption: { personal: 6_000, dependent: 1_500 },
    notes: ['5% flat rate on income over $10,000 (2025)', 'First $10,000 exempt', 'Moving to full flat tax by 2026'],
    special_rules: ['ms_first_10k_exempt'],
  },
  NC: {
    code: 'NC', name: 'North Carolina', type: 'flat',
    flat_rate: 0.045,
    standard_deduction: { single: 12_750, mfj: 25_500, mfs: 12_750, hoh: 19_125 },
    notes: ['Flat 4.5% rate (2025)', 'Was 4.75% in 2024, decreasing annually'],
  },
  PA: {
    code: 'PA', name: 'Pennsylvania', type: 'flat',
    flat_rate: 0.0307,
    notes: [
      'Flat 3.07% rate on all taxable income',
      'No standard deduction or personal exemption',
      'Local Earned Income Tax (EIT) varies by municipality (typically 1%-3.8712%)',
      'Philadelphia wage tax: 3.75% residents / 3.44% non-residents (2025)',
    ],
  },
  UT: {
    code: 'UT', name: 'Utah', type: 'flat',
    flat_rate: 0.0465,
    notes: [
      'Flat 4.65% rate (2025)',
      'Taxpayer tax credit effectively creates a 0% bracket on lower income',
      'Credit = 6% of (federal standard/itemized deduction + personal exemption amounts)',
    ],
    personal_exemption: { personal: 1_846, dependent: 1_846 },
  },

  // ─── Progressive Tax States ──────────────────────────────────────────

  AL: {
    code: 'AL', name: 'Alabama', type: 'progressive',
    brackets_single: [
      { min: 0, max: 500, rate: 0.02 },
      { min: 500, max: 3_000, rate: 0.04 },
      { min: 3_000, max: Infinity, rate: 0.05 },
    ],
    brackets_mfj: [
      { min: 0, max: 1_000, rate: 0.02 },
      { min: 1_000, max: 6_000, rate: 0.04 },
      { min: 6_000, max: Infinity, rate: 0.05 },
    ],
    standard_deduction: { single: 3_000, mfj: 8_500, mfs: 4_250, hoh: 5_250 },
    personal_exemption: { personal: 1_500, dependent: 1_000 },
    allows_federal_deduction: true,
    notes: ['Allows full federal income tax deduction', 'Dependent exemption $1,000 per dependent'],
  },
  AR: {
    code: 'AR', name: 'Arkansas', type: 'progressive',
    brackets_single: [
      { min: 0, max: 4_400, rate: 0.02 },
      { min: 4_400, max: 8_800, rate: 0.04 },
      { min: 8_800, max: 24_300, rate: 0.044 },
      { min: 24_300, max: Infinity, rate: 0.047 },
    ],
    standard_deduction: { single: 2_340, mfj: 4_680, mfs: 2_340, hoh: 2_340 },
    personal_exemption: { personal: 29, dependent: 29 },
    notes: ['Top rate 4.7% (2025)', 'Tax credit of $29 per exemption'],
  },
  CA: {
    code: 'CA', name: 'California', type: 'progressive',
    brackets_single: [
      { min: 0, max: 10_756, rate: 0.01 },
      { min: 10_756, max: 25_499, rate: 0.02 },
      { min: 25_499, max: 40_245, rate: 0.04 },
      { min: 40_245, max: 55_866, rate: 0.06 },
      { min: 55_866, max: 70_606, rate: 0.08 },
      { min: 70_606, max: 360_659, rate: 0.093 },
      { min: 360_659, max: 432_787, rate: 0.103 },
      { min: 432_787, max: 721_314, rate: 0.113 },
      { min: 721_314, max: 1_000_000, rate: 0.123 },
      { min: 1_000_000, max: Infinity, rate: 0.133 },
    ],
    brackets_mfj: [
      { min: 0, max: 21_512, rate: 0.01 },
      { min: 21_512, max: 50_998, rate: 0.02 },
      { min: 50_998, max: 80_490, rate: 0.04 },
      { min: 80_490, max: 111_732, rate: 0.06 },
      { min: 111_732, max: 141_212, rate: 0.08 },
      { min: 141_212, max: 721_318, rate: 0.093 },
      { min: 721_318, max: 865_574, rate: 0.103 },
      { min: 865_574, max: 1_000_000, rate: 0.113 },
      { min: 1_000_000, max: 1_442_628, rate: 0.123 },
      { min: 1_442_628, max: Infinity, rate: 0.133 },
    ],
    standard_deduction: { single: 5_540, mfj: 11_080, mfs: 5_540, hoh: 11_080 },
    personal_exemption: { personal: 144, dependent: 446 },
    special_rules: ['ca_mental_health_surcharge'],
    notes: [
      'Mental Health Services Tax: additional 1% on income over $1,000,000',
      'Top marginal rate effectively 13.3% (12.3% + 1% MHS)',
      'SDI (State Disability Insurance) 1.1% on wages up to $153,164',
      'Does NOT conform to many federal provisions',
    ],
  },
  CT: {
    code: 'CT', name: 'Connecticut', type: 'progressive',
    brackets_single: [
      { min: 0, max: 10_000, rate: 0.02 },
      { min: 10_000, max: 50_000, rate: 0.045 },
      { min: 50_000, max: 100_000, rate: 0.055 },
      { min: 100_000, max: 200_000, rate: 0.06 },
      { min: 200_000, max: 250_000, rate: 0.065 },
      { min: 250_000, max: 500_000, rate: 0.069 },
      { min: 500_000, max: Infinity, rate: 0.0699 },
    ],
    brackets_mfj: [
      { min: 0, max: 20_000, rate: 0.02 },
      { min: 20_000, max: 100_000, rate: 0.045 },
      { min: 100_000, max: 200_000, rate: 0.055 },
      { min: 200_000, max: 400_000, rate: 0.06 },
      { min: 400_000, max: 500_000, rate: 0.065 },
      { min: 500_000, max: 1_000_000, rate: 0.069 },
      { min: 1_000_000, max: Infinity, rate: 0.0699 },
    ],
    personal_exemption: { personal: 15_000, dependent: 0 },
    notes: [
      'Personal exemption phases out for higher incomes',
      'CT has a "tax recapture" that can increase effective rates',
      '6.99% top rate',
    ],
  },
  DE: {
    code: 'DE', name: 'Delaware', type: 'progressive',
    brackets_single: [
      { min: 0, max: 2_000, rate: 0.00 },
      { min: 2_000, max: 5_000, rate: 0.022 },
      { min: 5_000, max: 10_000, rate: 0.039 },
      { min: 10_000, max: 20_000, rate: 0.048 },
      { min: 20_000, max: 25_000, rate: 0.052 },
      { min: 25_000, max: 60_000, rate: 0.0555 },
      { min: 60_000, max: Infinity, rate: 0.066 },
    ],
    standard_deduction: { single: 3_250, mfj: 6_500, mfs: 3_250, hoh: 3_250 },
    personal_exemption: { personal: 110, dependent: 110 },
    notes: ['Top rate 6.6%', 'Credit of $110 per exemption', 'No local income taxes'],
  },
  DC: {
    code: 'DC', name: 'District of Columbia', type: 'progressive',
    brackets_single: [
      { min: 0, max: 10_000, rate: 0.04 },
      { min: 10_000, max: 40_000, rate: 0.06 },
      { min: 40_000, max: 60_000, rate: 0.065 },
      { min: 60_000, max: 250_000, rate: 0.085 },
      { min: 250_000, max: 500_000, rate: 0.0925 },
      { min: 500_000, max: 1_000_000, rate: 0.0975 },
      { min: 1_000_000, max: Infinity, rate: 0.1075 },
    ],
    standard_deduction: { single: 14_600, mfj: 29_200, mfs: 14_600, hoh: 21_900 },
    personal_exemption: { personal: 4_050, dependent: 4_050 },
    notes: ['Top rate 10.75%', 'Conforms to federal standard deduction amounts'],
  },
  HI: {
    code: 'HI', name: 'Hawaii', type: 'progressive',
    brackets_single: [
      { min: 0, max: 2_400, rate: 0.014 },
      { min: 2_400, max: 4_800, rate: 0.032 },
      { min: 4_800, max: 9_600, rate: 0.055 },
      { min: 9_600, max: 14_400, rate: 0.064 },
      { min: 14_400, max: 19_200, rate: 0.068 },
      { min: 19_200, max: 24_000, rate: 0.072 },
      { min: 24_000, max: 36_000, rate: 0.076 },
      { min: 36_000, max: 48_000, rate: 0.079 },
      { min: 48_000, max: 150_000, rate: 0.0825 },
      { min: 150_000, max: 175_000, rate: 0.09 },
      { min: 175_000, max: 200_000, rate: 0.10 },
      { min: 200_000, max: Infinity, rate: 0.11 },
    ],
    brackets_mfj: [
      { min: 0, max: 4_800, rate: 0.014 },
      { min: 4_800, max: 9_600, rate: 0.032 },
      { min: 9_600, max: 19_200, rate: 0.055 },
      { min: 19_200, max: 28_800, rate: 0.064 },
      { min: 28_800, max: 38_400, rate: 0.068 },
      { min: 38_400, max: 48_000, rate: 0.072 },
      { min: 48_000, max: 72_000, rate: 0.076 },
      { min: 72_000, max: 96_000, rate: 0.079 },
      { min: 96_000, max: 300_000, rate: 0.0825 },
      { min: 300_000, max: 350_000, rate: 0.09 },
      { min: 350_000, max: 400_000, rate: 0.10 },
      { min: 400_000, max: Infinity, rate: 0.11 },
    ],
    standard_deduction: { single: 2_200, mfj: 4_400, mfs: 2_200, hoh: 3_212 },
    personal_exemption: { personal: 1_144, dependent: 1_144 },
    notes: ['12 brackets, top rate 11%', 'One of the most progressive state tax systems'],
  },
  KS: {
    code: 'KS', name: 'Kansas', type: 'progressive',
    brackets_single: [
      { min: 0, max: 15_000, rate: 0.031 },
      { min: 15_000, max: 30_000, rate: 0.0525 },
      { min: 30_000, max: Infinity, rate: 0.057 },
    ],
    brackets_mfj: [
      { min: 0, max: 30_000, rate: 0.031 },
      { min: 30_000, max: 60_000, rate: 0.0525 },
      { min: 60_000, max: Infinity, rate: 0.057 },
    ],
    standard_deduction: { single: 3_500, mfj: 8_000, mfs: 4_000, hoh: 6_000 },
    personal_exemption: { personal: 2_250, dependent: 2_250 },
    notes: ['3 brackets, top rate 5.7%'],
  },
  LA: {
    code: 'LA', name: 'Louisiana', type: 'progressive',
    brackets_single: [
      { min: 0, max: 12_500, rate: 0.0185 },
      { min: 12_500, max: 50_000, rate: 0.035 },
      { min: 50_000, max: Infinity, rate: 0.0425 },
    ],
    brackets_mfj: [
      { min: 0, max: 25_000, rate: 0.0185 },
      { min: 25_000, max: 100_000, rate: 0.035 },
      { min: 100_000, max: Infinity, rate: 0.0425 },
    ],
    standard_deduction: { single: 12_500, mfj: 25_000, mfs: 12_500, hoh: 12_500 },
    personal_exemption: { personal: 4_500, dependent: 1_000 },
    allows_federal_deduction: true,
    notes: ['Top rate 4.25% (2025, reformed from 2024)', 'Allows federal income tax deduction (limited)'],
  },
  ME: {
    code: 'ME', name: 'Maine', type: 'progressive',
    brackets_single: [
      { min: 0, max: 26_050, rate: 0.058 },
      { min: 26_050, max: 61_600, rate: 0.0675 },
      { min: 61_600, max: Infinity, rate: 0.0715 },
    ],
    brackets_mfj: [
      { min: 0, max: 52_100, rate: 0.058 },
      { min: 52_100, max: 123_250, rate: 0.0675 },
      { min: 123_250, max: Infinity, rate: 0.0715 },
    ],
    standard_deduction: { single: 14_600, mfj: 29_200, mfs: 14_600, hoh: 21_900 },
    personal_exemption: { personal: 4_900, dependent: 4_900 },
    notes: ['3 brackets, top rate 7.15%', 'Conforms to federal standard deduction'],
  },
  MD: {
    code: 'MD', name: 'Maryland', type: 'progressive',
    brackets_single: [
      { min: 0, max: 1_000, rate: 0.02 },
      { min: 1_000, max: 2_000, rate: 0.03 },
      { min: 2_000, max: 3_000, rate: 0.04 },
      { min: 3_000, max: 100_000, rate: 0.0475 },
      { min: 100_000, max: 125_000, rate: 0.05 },
      { min: 125_000, max: 150_000, rate: 0.0525 },
      { min: 150_000, max: 250_000, rate: 0.055 },
      { min: 250_000, max: Infinity, rate: 0.0575 },
    ],
    standard_deduction: { single: 2_550, mfj: 5_150, mfs: 2_550, hoh: 5_150 },
    personal_exemption: { personal: 3_200, dependent: 3_200 },
    notes: [
      'Top rate 5.75%',
      'County income tax additional 2.25%-3.2% (most counties ~3.2%)',
      'Standard deduction is 15% of AGI, min $1,800, max $2,550 (single)',
    ],
  },
  MN: {
    code: 'MN', name: 'Minnesota', type: 'progressive',
    brackets_single: [
      { min: 0, max: 31_690, rate: 0.0535 },
      { min: 31_690, max: 104_090, rate: 0.068 },
      { min: 104_090, max: 193_240, rate: 0.0785 },
      { min: 193_240, max: Infinity, rate: 0.0985 },
    ],
    brackets_mfj: [
      { min: 0, max: 46_330, rate: 0.0535 },
      { min: 46_330, max: 184_040, rate: 0.068 },
      { min: 184_040, max: 321_450, rate: 0.0785 },
      { min: 321_450, max: Infinity, rate: 0.0985 },
    ],
    standard_deduction: { single: 14_575, mfj: 29_200, mfs: 14_575, hoh: 21_900 },
    personal_exemption: { personal: 4_950, dependent: 4_950 },
    notes: ['4 brackets, top rate 9.85%', 'Uses federal conformity for AGI'],
  },
  MO: {
    code: 'MO', name: 'Missouri', type: 'progressive',
    brackets_single: [
      { min: 0, max: 1_207, rate: 0.00 },
      { min: 1_207, max: 2_414, rate: 0.02 },
      { min: 2_414, max: 3_621, rate: 0.025 },
      { min: 3_621, max: 4_828, rate: 0.03 },
      { min: 4_828, max: 6_035, rate: 0.035 },
      { min: 6_035, max: 7_242, rate: 0.04 },
      { min: 7_242, max: 8_449, rate: 0.045 },
      { min: 8_449, max: Infinity, rate: 0.048 },
    ],
    standard_deduction: { single: 14_600, mfj: 29_200, mfs: 14_600, hoh: 21_900 },
    personal_exemption: { personal: 0, dependent: 0 },
    allows_federal_deduction: true,
    notes: ['Top rate 4.8% (2025)', 'Allows federal tax deduction (limited to $5,000 single / $10,000 MFJ)'],
  },
  MT: {
    code: 'MT', name: 'Montana', type: 'progressive',
    brackets_single: [
      { min: 0, max: 20_500, rate: 0.047 },
      { min: 20_500, max: Infinity, rate: 0.059 },
    ],
    standard_deduction: { single: 14_600, mfj: 29_200, mfs: 14_600, hoh: 21_900 },
    personal_exemption: { personal: 3_000, dependent: 3_000 },
    allows_federal_deduction: false,
    notes: ['2 brackets, top rate 5.9% (2025, reformed)', 'Federal tax deduction eliminated in 2024 reform'],
  },
  NE: {
    code: 'NE', name: 'Nebraska', type: 'progressive',
    brackets_single: [
      { min: 0, max: 3_700, rate: 0.0246 },
      { min: 3_700, max: 22_170, rate: 0.0351 },
      { min: 22_170, max: 35_730, rate: 0.0501 },
      { min: 35_730, max: Infinity, rate: 0.0584 },
    ],
    brackets_mfj: [
      { min: 0, max: 7_390, rate: 0.0246 },
      { min: 7_390, max: 44_350, rate: 0.0351 },
      { min: 44_350, max: 71_460, rate: 0.0501 },
      { min: 71_460, max: Infinity, rate: 0.0584 },
    ],
    standard_deduction: { single: 8_000, mfj: 16_100, mfs: 8_000, hoh: 11_600 },
    personal_exemption: { personal: 163, dependent: 163 },
    notes: ['Top rate 5.84% (2025, declining)', 'Credit of $163 per exemption'],
  },
  NJ: {
    code: 'NJ', name: 'New Jersey', type: 'progressive',
    brackets_single: [
      { min: 0, max: 20_000, rate: 0.014 },
      { min: 20_000, max: 35_000, rate: 0.0175 },
      { min: 35_000, max: 40_000, rate: 0.035 },
      { min: 40_000, max: 75_000, rate: 0.05525 },
      { min: 75_000, max: 500_000, rate: 0.0637 },
      { min: 500_000, max: 1_000_000, rate: 0.0897 },
      { min: 1_000_000, max: Infinity, rate: 0.1075 },
    ],
    brackets_mfj: [
      { min: 0, max: 20_000, rate: 0.014 },
      { min: 20_000, max: 50_000, rate: 0.0175 },
      { min: 50_000, max: 70_000, rate: 0.035 },
      { min: 70_000, max: 80_000, rate: 0.05525 },
      { min: 80_000, max: 150_000, rate: 0.0637 },
      { min: 150_000, max: 500_000, rate: 0.0897 },
      { min: 500_000, max: 1_000_000, rate: 0.1075 },
      { min: 1_000_000, max: Infinity, rate: 0.1075 },
    ],
    personal_exemption: { personal: 1_000, dependent: 1_500 },
    notes: [
      'Top rate 10.75%',
      'Property tax deduction up to $15,000',
      'No standard deduction — uses personal exemptions',
    ],
    special_rules: ['nj_property_tax_deduction'],
  },
  NM: {
    code: 'NM', name: 'New Mexico', type: 'progressive',
    brackets_single: [
      { min: 0, max: 5_500, rate: 0.017 },
      { min: 5_500, max: 11_000, rate: 0.032 },
      { min: 11_000, max: 16_000, rate: 0.047 },
      { min: 16_000, max: 210_000, rate: 0.049 },
      { min: 210_000, max: Infinity, rate: 0.059 },
    ],
    brackets_mfj: [
      { min: 0, max: 8_000, rate: 0.017 },
      { min: 8_000, max: 16_000, rate: 0.032 },
      { min: 16_000, max: 24_000, rate: 0.047 },
      { min: 24_000, max: 315_000, rate: 0.049 },
      { min: 315_000, max: Infinity, rate: 0.059 },
    ],
    standard_deduction: { single: 14_600, mfj: 29_200, mfs: 14_600, hoh: 21_900 },
    personal_exemption: { personal: 0, dependent: 4_000 },
    notes: ['Top rate 5.9%', 'Low-income comprehensive tax rebate available'],
  },
  NY: {
    code: 'NY', name: 'New York', type: 'progressive',
    brackets_single: [
      { min: 0, max: 8_500, rate: 0.04 },
      { min: 8_500, max: 11_700, rate: 0.045 },
      { min: 11_700, max: 13_900, rate: 0.0525 },
      { min: 13_900, max: 80_650, rate: 0.0585 },
      { min: 80_650, max: 215_400, rate: 0.0625 },
      { min: 215_400, max: 1_077_550, rate: 0.0685 },
      { min: 1_077_550, max: 5_000_000, rate: 0.0965 },
      { min: 5_000_000, max: 25_000_000, rate: 0.103 },
      { min: 25_000_000, max: Infinity, rate: 0.109 },
    ],
    brackets_mfj: [
      { min: 0, max: 17_150, rate: 0.04 },
      { min: 17_150, max: 23_600, rate: 0.045 },
      { min: 23_600, max: 27_900, rate: 0.0525 },
      { min: 27_900, max: 161_550, rate: 0.0585 },
      { min: 161_550, max: 323_200, rate: 0.0625 },
      { min: 323_200, max: 2_155_350, rate: 0.0685 },
      { min: 2_155_350, max: 5_000_000, rate: 0.0965 },
      { min: 5_000_000, max: 25_000_000, rate: 0.103 },
      { min: 25_000_000, max: Infinity, rate: 0.109 },
    ],
    standard_deduction: { single: 8_000, mfj: 16_050, mfs: 8_000, hoh: 11_200 },
    personal_exemption: { personal: 0, dependent: 1_000 },
    special_rules: ['ny_nyc_local_tax', 'ny_yonkers_surcharge'],
    notes: [
      'Top rate 10.9% (9 brackets)',
      'NYC local tax: 3.078%-3.876% additional',
      'Yonkers surcharge: 16.75% of state tax (residents) / 0.5% of wages (nonresidents)',
    ],
  },
  ND: {
    code: 'ND', name: 'North Dakota', type: 'progressive',
    brackets_single: [
      { min: 0, max: 44_725, rate: 0.0195 },
      { min: 44_725, max: Infinity, rate: 0.0295 },
    ],
    standard_deduction: { single: 14_600, mfj: 29_200, mfs: 14_600, hoh: 21_900 },
    personal_exemption: { personal: 0, dependent: 0 },
    notes: ['2 brackets after 2024 reform, top rate 2.95%', 'One of the lowest progressive rates'],
  },
  OH: {
    code: 'OH', name: 'Ohio', type: 'progressive',
    brackets_single: [
      { min: 0, max: 26_050, rate: 0.00 },
      { min: 26_050, max: 100_000, rate: 0.02745 },
      { min: 100_000, max: Infinity, rate: 0.0349 },
    ],
    personal_exemption: { personal: 2_400, dependent: 2_400 },
    special_rules: ['oh_no_tax_first_26050'],
    notes: [
      'No tax on first $26,050 of income',
      'Top rate 3.49% (2025)',
      'No standard deduction — uses personal exemption credits',
      'School district income taxes additional 0.5%-2%',
    ],
  },
  OK: {
    code: 'OK', name: 'Oklahoma', type: 'progressive',
    brackets_single: [
      { min: 0, max: 1_000, rate: 0.0025 },
      { min: 1_000, max: 2_500, rate: 0.0075 },
      { min: 2_500, max: 3_750, rate: 0.0175 },
      { min: 3_750, max: 4_900, rate: 0.0275 },
      { min: 4_900, max: 7_200, rate: 0.0375 },
      { min: 7_200, max: Infinity, rate: 0.0475 },
    ],
    brackets_mfj: [
      { min: 0, max: 2_000, rate: 0.0025 },
      { min: 2_000, max: 5_000, rate: 0.0075 },
      { min: 5_000, max: 7_500, rate: 0.0175 },
      { min: 7_500, max: 9_800, rate: 0.0275 },
      { min: 9_800, max: 12_200, rate: 0.0375 },
      { min: 12_200, max: Infinity, rate: 0.0475 },
    ],
    standard_deduction: { single: 6_350, mfj: 12_700, mfs: 6_350, hoh: 9_350 },
    personal_exemption: { personal: 1_000, dependent: 1_000 },
    notes: ['Top rate 4.75%', '6 brackets'],
  },
  OR: {
    code: 'OR', name: 'Oregon', type: 'progressive',
    brackets_single: [
      { min: 0, max: 4_300, rate: 0.0475 },
      { min: 4_300, max: 10_750, rate: 0.0675 },
      { min: 10_750, max: 125_000, rate: 0.0875 },
      { min: 125_000, max: Infinity, rate: 0.099 },
    ],
    brackets_mfj: [
      { min: 0, max: 8_600, rate: 0.0475 },
      { min: 8_600, max: 21_500, rate: 0.0675 },
      { min: 21_500, max: 250_000, rate: 0.0875 },
      { min: 250_000, max: Infinity, rate: 0.099 },
    ],
    standard_deduction: { single: 2_745, mfj: 5_495, mfs: 2_745, hoh: 4_420 },
    personal_exemption: { personal: 236, dependent: 236 },
    allows_federal_deduction: true,
    notes: [
      'Top rate 9.9%',
      'Allows federal income tax deduction (limited to $7,250 single / $14,500 MFJ)',
      'No sales tax — relies heavily on income tax',
      'Credit of $236 per exemption',
    ],
  },
  RI: {
    code: 'RI', name: 'Rhode Island', type: 'progressive',
    brackets_single: [
      { min: 0, max: 77_450, rate: 0.0375 },
      { min: 77_450, max: 176_050, rate: 0.0475 },
      { min: 176_050, max: Infinity, rate: 0.0599 },
    ],
    standard_deduction: { single: 10_550, mfj: 21_150, mfs: 10_550, hoh: 15_850 },
    personal_exemption: { personal: 4_700, dependent: 4_700 },
    notes: ['3 brackets, top rate 5.99%', 'Exemption phases out at higher incomes'],
  },
  SC: {
    code: 'SC', name: 'South Carolina', type: 'progressive',
    brackets_single: [
      { min: 0, max: 3_460, rate: 0.00 },
      { min: 3_460, max: 17_330, rate: 0.03 },
      { min: 17_330, max: Infinity, rate: 0.064 },
    ],
    standard_deduction: { single: 14_600, mfj: 29_200, mfs: 14_600, hoh: 21_900 },
    personal_exemption: { personal: 0, dependent: 4_610 },
    notes: ['Top rate 6.4% (2025)', 'First $3,460 exempt', 'Conforms to federal standard deduction'],
  },
  VA: {
    code: 'VA', name: 'Virginia', type: 'progressive',
    brackets_single: [
      { min: 0, max: 3_000, rate: 0.02 },
      { min: 3_000, max: 5_000, rate: 0.03 },
      { min: 5_000, max: 17_000, rate: 0.05 },
      { min: 17_000, max: Infinity, rate: 0.0575 },
    ],
    standard_deduction: { single: 8_000, mfj: 16_000, mfs: 8_000, hoh: 8_000 },
    personal_exemption: { personal: 930, dependent: 930 },
    notes: ['Top rate 5.75%', '4 brackets'],
  },
  VT: {
    code: 'VT', name: 'Vermont', type: 'progressive',
    brackets_single: [
      { min: 0, max: 45_400, rate: 0.0335 },
      { min: 45_400, max: 110_050, rate: 0.066 },
      { min: 110_050, max: 229_550, rate: 0.076 },
      { min: 229_550, max: Infinity, rate: 0.0875 },
    ],
    brackets_mfj: [
      { min: 0, max: 75_850, rate: 0.0335 },
      { min: 75_850, max: 183_400, rate: 0.066 },
      { min: 183_400, max: 279_450, rate: 0.076 },
      { min: 279_450, max: Infinity, rate: 0.0875 },
    ],
    standard_deduction: { single: 7_250, mfj: 14_550, mfs: 7_250, hoh: 12_100 },
    personal_exemption: { personal: 4_850, dependent: 4_850 },
    notes: ['4 brackets, top rate 8.75%'],
  },
  WV: {
    code: 'WV', name: 'West Virginia', type: 'progressive',
    brackets_single: [
      { min: 0, max: 10_000, rate: 0.0236 },
      { min: 10_000, max: 25_000, rate: 0.0315 },
      { min: 25_000, max: 40_000, rate: 0.0354 },
      { min: 40_000, max: 60_000, rate: 0.0472 },
      { min: 60_000, max: Infinity, rate: 0.0512 },
    ],
    personal_exemption: { personal: 2_000, dependent: 2_000 },
    notes: ['5 brackets, top rate 5.12% (2025)', 'Rates being reduced annually'],
  },
  WI: {
    code: 'WI', name: 'Wisconsin', type: 'progressive',
    brackets_single: [
      { min: 0, max: 14_320, rate: 0.0354 },
      { min: 14_320, max: 28_640, rate: 0.0465 },
      { min: 28_640, max: 315_310, rate: 0.053 },
      { min: 315_310, max: Infinity, rate: 0.0765 },
    ],
    brackets_mfj: [
      { min: 0, max: 19_090, rate: 0.0354 },
      { min: 19_090, max: 38_190, rate: 0.0465 },
      { min: 38_190, max: 420_420, rate: 0.053 },
      { min: 420_420, max: Infinity, rate: 0.0765 },
    ],
    standard_deduction: { single: 12_760, mfj: 23_620, mfs: 11_060, hoh: 16_390 },
    personal_exemption: { personal: 700, dependent: 700 },
    notes: ['4 brackets, top rate 7.65%', 'Standard deduction phases out at higher incomes'],
  },
};

// ─── Fill in MFS/HOH brackets for progressive states ───────────────────
// Many progressive states use single brackets for MFS and HOH with slight adjustments.
// We default MFS to single and HOH to single if not explicitly set.
for (const [code, config] of Object.entries(STATE_TAX_DATA)) {
  if (config.type === 'progressive') {
    if (!config.brackets_mfs) {
      config.brackets_mfs = config.brackets_single;
    }
    if (!config.brackets_hoh) {
      config.brackets_hoh = config.brackets_mfj || config.brackets_single;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// NYC LOCAL TAX BRACKETS
// ═══════════════════════════════════════════════════════════════════════════

const NYC_BRACKETS_SINGLE: StateBracket[] = [
  { min: 0, max: 12_000, rate: 0.03078 },
  { min: 12_000, max: 25_000, rate: 0.03762 },
  { min: 25_000, max: 50_000, rate: 0.03819 },
  { min: 50_000, max: Infinity, rate: 0.03876 },
];

const NYC_BRACKETS_MFJ: StateBracket[] = [
  { min: 0, max: 21_600, rate: 0.03078 },
  { min: 21_600, max: 45_000, rate: 0.03762 },
  { min: 45_000, max: 90_000, rate: 0.03819 },
  { min: 90_000, max: Infinity, rate: 0.03876 },
];

// ═══════════════════════════════════════════════════════════════════════════
// CORE CALCULATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate tax using progressive brackets.
 * Returns breakdown of each bracket applied.
 */
function calculateProgressiveTax(
  taxableIncome: number,
  brackets: StateBracket[],
): { tax: number; marginalRate: number; bracketsUsed: Array<{ rate: number; amount: number; tax: number }> } {
  let tax = 0;
  let marginalRate = 0;
  const bracketsUsed: Array<{ rate: number; amount: number; tax: number }> = [];

  for (const bracket of brackets) {
    if (taxableIncome <= bracket.min) break;

    const taxableInBracket = Math.min(taxableIncome, bracket.max) - bracket.min;
    const bracketTax = taxableInBracket * bracket.rate;

    bracketsUsed.push({
      rate: bracket.rate,
      amount: Math.round(taxableInBracket * 100) / 100,
      tax: Math.round(bracketTax * 100) / 100,
    });

    tax += bracketTax;
    marginalRate = bracket.rate;
  }

  return { tax: Math.round(tax * 100) / 100, marginalRate, bracketsUsed };
}

/**
 * Get the appropriate brackets for a given state and filing status.
 */
function getBracketsForStatus(config: StateTaxConfig, status: NormalizedStatus): StateBracket[] | undefined {
  switch (status) {
    case 'mfj': return config.brackets_mfj || config.brackets_single;
    case 'mfs': return config.brackets_mfs || config.brackets_single;
    case 'hoh': return config.brackets_hoh || config.brackets_mfj || config.brackets_single;
    default: return config.brackets_single;
  }
}

/**
 * Get the standard deduction for a given state and filing status.
 */
function getStandardDeduction(config: StateTaxConfig, status: NormalizedStatus): number {
  if (!config.standard_deduction) return 0;
  return config.standard_deduction[status] ?? config.standard_deduction.single ?? 0;
}

/**
 * Get the personal exemption total for a given state, including dependents.
 */
function getPersonalExemptionTotal(config: StateTaxConfig, status: NormalizedStatus, dependents: number): number {
  if (!config.personal_exemption) return 0;
  const { personal, dependent } = config.personal_exemption;

  // Number of personal exemptions (1 for single/hoh, 2 for mfj, 1 for mfs)
  const personalCount = status === 'mfj' ? 2 : 1;

  return (personal * personalCount) + (dependent * dependents);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN CALCULATION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

export function calculateStateTax(
  state: string,
  federalAGI: number,
  filingStatus: string,
  federalTaxableIncome: number,
  wages: number,
  options?: StateCalculationOptions,
): StateCalculationResult {
  const stateCode = state.toUpperCase();
  const config = STATE_TAX_DATA[stateCode];
  const status = normalizeStatus(filingStatus);

  if (!config) {
    log.warn({ state: stateCode }, 'Unknown state code');
    return {
      state: stateCode,
      state_name: 'Unknown',
      taxable_income: 0,
      state_tax: 0,
      effective_rate: 0,
      marginal_rate: 0,
      standard_deduction: 0,
      personal_exemption: 0,
      brackets_used: [],
      credits: 0,
      notes: [`Unknown state code: ${stateCode}`],
    };
  }

  const notes: string[] = [];
  const dependents = options?.dependents ?? 0;
  let credits = 0;
  let localTax: number | undefined;

  // ─── No Income Tax States ──────────────────────────────────────────

  if (config.type === 'none') {
    log.debug({ state: stateCode }, 'No income tax state');
    return {
      state: stateCode,
      state_name: config.name,
      taxable_income: 0,
      state_tax: 0,
      effective_rate: 0,
      marginal_rate: 0,
      standard_deduction: 0,
      personal_exemption: 0,
      brackets_used: [],
      credits: 0,
      notes: config.notes || ['No state income tax'],
    };
  }

  // ─── Interest/Dividends Only (NH) ──────────────────────────────────

  if (config.type === 'interest_dividends_only') {
    // NH taxes only interest and dividends — wages are not taxed
    // For simplicity, we apply the rate to (AGI - wages) as a proxy for investment income
    const investmentIncome = Math.max(0, federalAGI - wages);
    const nhExemption = status === 'mfj' ? 4_800 : 2_400;
    const nhTaxable = Math.max(0, investmentIncome - nhExemption);
    const rate = config.flat_rate || 0.03;
    const tax = Math.round(nhTaxable * rate * 100) / 100;

    notes.push(...(config.notes || []));
    notes.push(`Investment income estimate: $${investmentIncome.toLocaleString()}`);
    notes.push(`NH exemption applied: $${nhExemption.toLocaleString()}`);

    return {
      state: stateCode,
      state_name: config.name,
      taxable_income: nhTaxable,
      state_tax: tax,
      effective_rate: federalAGI > 0 ? Math.round((tax / federalAGI) * 10000) / 10000 : 0,
      marginal_rate: rate,
      standard_deduction: 0,
      personal_exemption: nhExemption,
      brackets_used: nhTaxable > 0 ? [{ rate, amount: nhTaxable, tax }] : [],
      credits: 0,
      notes,
    };
  }

  // ─── Determine Starting Income ─────────────────────────────────────

  let startingIncome = config.conforms_to_federal_agi ? federalAGI : federalAGI;
  notes.push(`Starting from federal AGI: $${federalAGI.toLocaleString()}`);

  // ─── Federal Tax Deduction (AL, LA, MO, OR) ────────────────────────

  if (config.allows_federal_deduction) {
    // Estimate federal tax liability for deduction purposes
    // Use a simplified approach — in production this would use actual federal tax
    const estimatedFederalTax = Math.max(0, federalTaxableIncome * 0.22); // rough estimate
    let federalDeduction = estimatedFederalTax;

    // MO limits to $5,000 single / $10,000 MFJ
    if (stateCode === 'MO') {
      const moLimit = status === 'mfj' ? 10_000 : 5_000;
      federalDeduction = Math.min(federalDeduction, moLimit);
    }
    // OR limits to $7,250 single / $14,500 MFJ
    if (stateCode === 'OR') {
      const orLimit = status === 'mfj' ? 14_500 : 7_250;
      federalDeduction = Math.min(federalDeduction, orLimit);
    }

    startingIncome -= federalDeduction;
    notes.push(`Federal tax deduction: -$${Math.round(federalDeduction).toLocaleString()}`);
  }

  // ─── Standard Deduction vs Itemized ────────────────────────────────

  const stdDed = getStandardDeduction(config, status);
  const itemized = options?.itemizedDeductions ?? 0;
  const deductionUsed = Math.max(stdDed, itemized);

  // ─── Personal Exemption ────────────────────────────────────────────

  const personalExemption = getPersonalExemptionTotal(config, status, dependents);

  // ─── Taxable Income ────────────────────────────────────────────────

  let taxableIncome = Math.max(0, startingIncome - deductionUsed - personalExemption);

  // ─── State-Specific Adjustments ────────────────────────────────────

  // MS: First $10,000 exempt
  if (config.special_rules?.includes('ms_first_10k_exempt')) {
    taxableIncome = Math.max(0, taxableIncome - 10_000);
    notes.push('Mississippi: First $10,000 exempt from tax');
  }

  // OH: No tax on first $26,050
  if (config.special_rules?.includes('oh_no_tax_first_26050')) {
    notes.push('Ohio: No tax on first $26,050 of income');
    // This is handled by the brackets having 0% on first $26,050
  }

  // ─── Calculate Tax ─────────────────────────────────────────────────

  let stateTax = 0;
  let marginalRate = 0;
  let bracketsUsed: Array<{ rate: number; amount: number; tax: number }> = [];

  if (config.type === 'flat') {
    const rate = config.flat_rate || 0;
    stateTax = Math.round(taxableIncome * rate * 100) / 100;
    marginalRate = rate;
    if (taxableIncome > 0) {
      bracketsUsed = [{ rate, amount: taxableIncome, tax: stateTax }];
    }
  } else if (config.type === 'progressive') {
    const brackets = getBracketsForStatus(config, status);
    if (brackets) {
      const result = calculateProgressiveTax(taxableIncome, brackets);
      stateTax = result.tax;
      marginalRate = result.marginalRate;
      bracketsUsed = result.bracketsUsed;
    }
  }

  // ─── CA Mental Health Services Tax ─────────────────────────────────

  if (config.special_rules?.includes('ca_mental_health_surcharge')) {
    if (taxableIncome > 1_000_000) {
      const mhsTax = Math.round((taxableIncome - 1_000_000) * 0.01 * 100) / 100;
      stateTax += mhsTax;
      notes.push(`CA Mental Health Services Tax (1% over $1M): +$${mhsTax.toLocaleString()}`);
    }
  }

  // ─── MA Millionaire Surtax ─────────────────────────────────────────

  if (stateCode === 'MA' && taxableIncome > 1_000_000) {
    const surtax = Math.round((taxableIncome - 1_000_000) * 0.04 * 100) / 100;
    stateTax += surtax;
    notes.push(`MA Millionaire Surtax (4% over $1M): +$${surtax.toLocaleString()}`);
  }

  // ─── NYC Local Tax ─────────────────────────────────────────────────

  if (config.special_rules?.includes('ny_nyc_local_tax') && options?.locality?.toUpperCase() === 'NYC') {
    const nycBrackets = status === 'mfj' ? NYC_BRACKETS_MFJ : NYC_BRACKETS_SINGLE;
    const nycResult = calculateProgressiveTax(taxableIncome, nycBrackets);
    localTax = nycResult.tax;
    notes.push(`NYC local income tax: +$${nycResult.tax.toLocaleString()}`);
  }

  // ─── NY Yonkers Surcharge ──────────────────────────────────────────

  if (config.special_rules?.includes('ny_yonkers_surcharge') && options?.locality?.toUpperCase() === 'YONKERS') {
    const yonkersSurcharge = Math.round(stateTax * 0.1675 * 100) / 100;
    localTax = yonkersSurcharge;
    notes.push(`Yonkers surcharge (16.75% of state tax): +$${yonkersSurcharge.toLocaleString()}`);
  }

  // ─── PA Local EIT ──────────────────────────────────────────────────

  if (stateCode === 'PA' && options?.locality) {
    const locality = options.locality.toUpperCase();
    let localRate = 0.01; // default 1% for most PA municipalities
    if (locality === 'PHILADELPHIA' || locality === 'PHL') {
      localRate = 0.0375; // Philadelphia wage tax for residents
    } else if (locality === 'PITTSBURGH' || locality === 'PGH') {
      localRate = 0.03;
    }
    localTax = Math.round(wages * localRate * 100) / 100;
    notes.push(`PA local EIT (${options.locality}, ${(localRate * 100).toFixed(2)}%): +$${localTax.toLocaleString()}`);
  }

  // ─── IN County Tax ─────────────────────────────────────────────────

  if (stateCode === 'IN' && options?.locality) {
    // Indiana county taxes range from 0.5% to 2.9%
    // Use a default of 1.5% unless specified
    const countyRate = 0.015;
    localTax = Math.round(taxableIncome * countyRate * 100) / 100;
    notes.push(`IN county tax estimate (${options.locality}, 1.5%): +$${localTax.toLocaleString()}`);
  }

  // ─── MD County Tax ─────────────────────────────────────────────────

  if (stateCode === 'MD') {
    // Most MD counties ~3.2%, apply by default
    const countyRate = 0.032;
    localTax = Math.round(taxableIncome * countyRate * 100) / 100;
    notes.push(`MD county tax estimate (3.2%): +$${localTax.toLocaleString()}`);
  }

  // ─── IL personal exemption is a credit, not deduction ──────────────

  if (stateCode === 'IL') {
    // IL exemption: recalculate since IL has no standard deduction
    // The personal exemption reduces AGI, which we already handled
    notes.push(`IL personal exemption: $${personalExemption.toLocaleString()} per person`);
  }

  // ─── NJ Property Tax Deduction ─────────────────────────────────────

  if (config.special_rules?.includes('nj_property_tax_deduction')) {
    notes.push('NJ: Property tax deduction up to $15,000 available (not calculated — requires property tax input)');
  }

  // ─── UT Taxpayer Tax Credit ────────────────────────────────────────

  if (stateCode === 'UT') {
    // UT credit = 6% of (federal std deduction + personal exemption amounts)
    const fedStdDed = status === 'mfj' ? 29_200 : status === 'hoh' ? 21_900 : 15_700;
    const fedExemptions = (status === 'mfj' ? 2 : 1) + dependents;
    const utCredit = Math.round((fedStdDed + fedExemptions * 4_300) * 0.06 * 100) / 100;
    credits += utCredit;
    notes.push(`UT taxpayer tax credit: -$${utCredit.toLocaleString()}`);
  }

  // ─── Final tax (apply credits) ─────────────────────────────────────

  stateTax = Math.max(0, Math.round((stateTax - credits) * 100) / 100);

  // ─── Effective Rate ────────────────────────────────────────────────

  const effectiveRate = federalAGI > 0 ? Math.round((stateTax / federalAGI) * 10000) / 10000 : 0;

  notes.push(...(config.notes || []));

  log.info({
    state: stateCode,
    filingStatus: status,
    federalAGI,
    taxableIncome,
    stateTax,
    effectiveRate,
  }, 'State tax calculated');

  return {
    state: stateCode,
    state_name: config.name,
    taxable_income: Math.round(taxableIncome * 100) / 100,
    state_tax: stateTax,
    effective_rate: effectiveRate,
    marginal_rate: marginalRate,
    standard_deduction: deductionUsed,
    personal_exemption: personalExemption,
    brackets_used: bracketsUsed,
    credits,
    local_tax: localTax,
    notes: [...new Set(notes)], // deduplicate
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// INFO AND LISTING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

export interface StateInfo {
  code: string;
  name: string;
  type: StateTaxType;
  flat_rate?: number;
  top_rate: number;
  brackets_count: number;
  standard_deduction: StateDeductions | null;
  personal_exemption: StateExemptions | null;
  allows_federal_deduction: boolean;
  has_local_taxes: boolean;
  special_rules: string[];
  notes: string[];
}

export function getStateInfo(state: string): StateInfo | null {
  const config = STATE_TAX_DATA[state.toUpperCase()];
  if (!config) return null;

  let topRate = 0;
  let bracketsCount = 0;

  if (config.type === 'flat') {
    topRate = config.flat_rate || 0;
    bracketsCount = 1;
  } else if (config.type === 'progressive' && config.brackets_single) {
    topRate = Math.max(...config.brackets_single.map((b) => b.rate));
    bracketsCount = config.brackets_single.length;
  } else if (config.type === 'interest_dividends_only') {
    topRate = config.flat_rate || 0;
    bracketsCount = 1;
  }

  const hasLocalTaxes = ['NY', 'PA', 'OH', 'IN', 'MD', 'MI', 'KY', 'AL'].includes(config.code);

  return {
    code: config.code,
    name: config.name,
    type: config.type,
    flat_rate: config.flat_rate,
    top_rate: topRate,
    brackets_count: bracketsCount,
    standard_deduction: config.standard_deduction || null,
    personal_exemption: config.personal_exemption || null,
    allows_federal_deduction: config.allows_federal_deduction || false,
    has_local_taxes: hasLocalTaxes,
    special_rules: config.special_rules || [],
    notes: config.notes || [],
  };
}

export interface StateListItem {
  code: string;
  name: string;
  type: StateTaxType;
  top_rate: number;
}

export function listAllStates(): StateListItem[] {
  return Object.values(STATE_TAX_DATA)
    .map((config) => {
      let topRate = 0;
      if (config.type === 'flat') {
        topRate = config.flat_rate || 0;
      } else if (config.type === 'progressive' && config.brackets_single) {
        topRate = Math.max(...config.brackets_single.map((b) => b.rate));
      } else if (config.type === 'interest_dividends_only') {
        topRate = config.flat_rate || 0;
      }
      return {
        code: config.code,
        name: config.name,
        type: config.type,
        top_rate: Math.round(topRate * 10000) / 10000,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}
