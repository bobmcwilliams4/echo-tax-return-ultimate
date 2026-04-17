// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Interactive Return Preparer Service
// Claude Opus 4.7 Subprocess + Engine Runtime Integration + DB Operations
// ═══════════════════════════════════════════════════════════════════════════

import { Database } from 'bun:sqlite';
import { spawn } from 'child_process';
import { createLogger } from '../utils/logger';
import { encryptField, extractLast4 } from '../utils/encryption';
import { calculateReturn } from './tax-calculator';
import { logAudit } from './database';

const log = createLogger('return-preparer');

// ─── Constants ─────────────────────────────────────────────────────────

const ENGINE_RUNTIME_URL = process.env.ENGINE_RUNTIME_URL || 'https://echo-engine-runtime.bmcii1976.workers.dev';
const ENGINE_RUNTIME_KEY = process.env.ENGINE_RUNTIME_KEY || 'echo-omega-prime-forge-x-2026';
const CLAUDE_MODEL = process.env.CLAUDE_PREPARER_MODEL || 'claude-opus-4-7';
const CLAUDE_TIMEOUT_MS = 120_000;

// Tax engines relevant for return preparation
const TAX_ENGINES = {
  TIE: 'TIE',   // Tax Intelligence Engine — general tax knowledge
  FIE: 'FIE',   // Federal Income Engine — federal calculations
  STE: 'STE',   // State Tax Engine — state filing
  CRE: 'CRE',   // Credits Engine — tax credits
  DEP: 'DEP',   // Dependents Engine — dependent rules
  BIE: 'BIE',   // Business Income Engine — self-employment / Sched C
  PIE: 'PIE',   // Planning & Investment Engine — investment income
  INT: 'INT',   // International Engine — foreign income
  CRY: 'CRY',   // Crypto Engine — digital asset reporting
  EST: 'EST',   // Estate Engine — trust & estate
} as const;

// ─── Interview Phase Definitions ───────────────────────────────────────

export enum InterviewPhase {
  PERSONAL_INFO = 1,
  INCOME = 2,
  DEDUCTIONS = 3,
  DEPENDENTS = 4,
  CREDITS = 5,
  PAYMENTS = 6,
  STATE_FILING = 7,
  REVIEW_CALCULATE = 8,
}

interface InterviewQuestion {
  phase: InterviewPhase;
  question_id: string;
  question: string;
  guidance?: string;
  input_type: 'text' | 'number' | 'select' | 'boolean' | 'date' | 'ssn' | 'multi';
  options?: string[];
  required: boolean;
  field_map: string;           // Dot-notation path in answers object
  validation?: string;         // Regex or validation hint
  engine_consult?: {           // Optional engine consultation on answer
    engine: string;
    query_template: string;    // {answer} will be replaced with user input
  };
  follow_up_condition?: string; // JSON path condition for showing this question
}

// ─── Session Types ─────────────────────────────────────────────────────

export type SessionStatus = 'interviewing' | 'reviewing' | 'calculating' | 'complete' | 'error';

export interface PrepareSession {
  id: string;
  status: SessionStatus;
  phase: number;
  current_question_index: number;
  client_id: string | null;
  return_id: string | null;
  answers: Record<string, unknown>;
  engine_consultations: EngineConsultation[];
  claude_interactions: ClaudeInteraction[];
  warnings: string[];
  created_at: string;
  updated_at: string;
}

interface EngineConsultation {
  engine: string;
  query: string;
  response: unknown;
  timestamp: string;
  latency_ms: number;
}

interface ClaudeInteraction {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface NextQuestionResult {
  session_id: string;
  status: SessionStatus;
  phase: number;
  phase_name: string;
  question: InterviewQuestion | null;
  guidance: string | null;
  progress: {
    current_phase: number;
    total_phases: number;
    questions_answered: number;
    percent_complete: number;
  };
  engine_insight: string | null;
}

interface SmartPrepareInput {
  taxpayer: {
    first_name: string;
    last_name: string;
    middle_name?: string;
    ssn?: string;
    dob?: string;
    filing_status: string;
    occupation?: string;
    address_street?: string;
    address_city?: string;
    address_state?: string;
    address_zip?: string;
    phone?: string;
    email?: string;
  };
  spouse?: {
    first_name: string;
    last_name: string;
    ssn?: string;
    dob?: string;
    occupation?: string;
  };
  income?: Array<{
    type: string;
    payer?: string;
    amount: number;
    withholding?: number;
    state_withholding?: number;
    ein?: string;
    description?: string;
  }>;
  deductions?: Array<{
    type: string;
    amount: number;
    description?: string;
  }>;
  dependents?: Array<{
    first_name: string;
    last_name: string;
    ssn?: string;
    dob?: string;
    relationship?: string;
    months_lived?: number;
    student?: boolean;
    disabled?: boolean;
  }>;
  estimated_payments?: number;
  prior_year_data?: Record<string, unknown>;
}

// ─── Interview Question Bank ───────────────────────────────────────────

function buildQuestionBank(): InterviewQuestion[] {
  return [
    // ── Phase 1: Personal Information ───────────────────────────────
    {
      phase: InterviewPhase.PERSONAL_INFO,
      question_id: 'first_name',
      question: 'What is the taxpayer\'s legal first name?',
      input_type: 'text',
      required: true,
      field_map: 'personal.first_name',
    },
    {
      phase: InterviewPhase.PERSONAL_INFO,
      question_id: 'middle_name',
      question: 'Middle name or initial (leave blank if none)',
      input_type: 'text',
      required: false,
      field_map: 'personal.middle_name',
    },
    {
      phase: InterviewPhase.PERSONAL_INFO,
      question_id: 'last_name',
      question: 'Last name',
      input_type: 'text',
      required: true,
      field_map: 'personal.last_name',
    },
    {
      phase: InterviewPhase.PERSONAL_INFO,
      question_id: 'ssn',
      question: 'Social Security Number (9 digits, no dashes)',
      input_type: 'ssn',
      required: true,
      field_map: 'personal.ssn',
      validation: '^\\d{9}$',
    },
    {
      phase: InterviewPhase.PERSONAL_INFO,
      question_id: 'dob',
      question: 'Date of birth (YYYY-MM-DD)',
      input_type: 'date',
      required: true,
      field_map: 'personal.dob',
      validation: '^\\d{4}-\\d{2}-\\d{2}$',
    },
    {
      phase: InterviewPhase.PERSONAL_INFO,
      question_id: 'filing_status',
      question: 'Filing status for this tax year?',
      guidance: 'Single, Married Filing Jointly (MFJ), Married Filing Separately (MFS), Head of Household (HOH), or Qualifying Surviving Spouse (QSS)',
      input_type: 'select',
      options: ['single', 'mfj', 'mfs', 'hoh', 'qss'],
      required: true,
      field_map: 'personal.filing_status',
      engine_consult: {
        engine: TAX_ENGINES.TIE,
        query_template: 'What are the requirements and benefits of {answer} filing status for 2025?',
      },
    },
    {
      phase: InterviewPhase.PERSONAL_INFO,
      question_id: 'occupation',
      question: 'Occupation / job title',
      input_type: 'text',
      required: false,
      field_map: 'personal.occupation',
    },
    {
      phase: InterviewPhase.PERSONAL_INFO,
      question_id: 'phone',
      question: 'Phone number',
      input_type: 'text',
      required: false,
      field_map: 'personal.phone',
    },
    {
      phase: InterviewPhase.PERSONAL_INFO,
      question_id: 'email',
      question: 'Email address',
      input_type: 'text',
      required: false,
      field_map: 'personal.email',
      validation: '^[^@]+@[^@]+\\.[^@]+$',
    },
    {
      phase: InterviewPhase.PERSONAL_INFO,
      question_id: 'address_street',
      question: 'Street address',
      input_type: 'text',
      required: true,
      field_map: 'personal.address_street',
    },
    {
      phase: InterviewPhase.PERSONAL_INFO,
      question_id: 'address_city',
      question: 'City',
      input_type: 'text',
      required: true,
      field_map: 'personal.address_city',
    },
    {
      phase: InterviewPhase.PERSONAL_INFO,
      question_id: 'address_state',
      question: 'State (2-letter code, e.g. TX)',
      input_type: 'text',
      required: true,
      field_map: 'personal.address_state',
      validation: '^[A-Z]{2}$',
    },
    {
      phase: InterviewPhase.PERSONAL_INFO,
      question_id: 'address_zip',
      question: 'ZIP code',
      input_type: 'text',
      required: true,
      field_map: 'personal.address_zip',
      validation: '^\\d{5}(-\\d{4})?$',
    },
    {
      phase: InterviewPhase.PERSONAL_INFO,
      question_id: 'has_spouse_info',
      question: 'Are you filing jointly or do you need to enter spouse information?',
      input_type: 'boolean',
      required: true,
      field_map: 'personal.has_spouse_info',
      follow_up_condition: 'personal.filing_status === "mfj" || personal.filing_status === "mfs"',
    },
    {
      phase: InterviewPhase.PERSONAL_INFO,
      question_id: 'spouse_first_name',
      question: 'Spouse\'s first name',
      input_type: 'text',
      required: false,
      field_map: 'personal.spouse_first_name',
      follow_up_condition: 'personal.has_spouse_info === true',
    },
    {
      phase: InterviewPhase.PERSONAL_INFO,
      question_id: 'spouse_last_name',
      question: 'Spouse\'s last name',
      input_type: 'text',
      required: false,
      field_map: 'personal.spouse_last_name',
      follow_up_condition: 'personal.has_spouse_info === true',
    },
    {
      phase: InterviewPhase.PERSONAL_INFO,
      question_id: 'spouse_ssn',
      question: 'Spouse\'s SSN (9 digits)',
      input_type: 'ssn',
      required: false,
      field_map: 'personal.spouse_ssn',
      validation: '^\\d{9}$',
      follow_up_condition: 'personal.has_spouse_info === true',
    },
    {
      phase: InterviewPhase.PERSONAL_INFO,
      question_id: 'spouse_dob',
      question: 'Spouse\'s date of birth (YYYY-MM-DD)',
      input_type: 'date',
      required: false,
      field_map: 'personal.spouse_dob',
      follow_up_condition: 'personal.has_spouse_info === true',
    },
    {
      phase: InterviewPhase.PERSONAL_INFO,
      question_id: 'spouse_occupation',
      question: 'Spouse\'s occupation',
      input_type: 'text',
      required: false,
      field_map: 'personal.spouse_occupation',
      follow_up_condition: 'personal.has_spouse_info === true',
    },

    // ── Phase 2: Income ─────────────────────────────────────────────
    {
      phase: InterviewPhase.INCOME,
      question_id: 'has_w2',
      question: 'Did you receive any W-2 wages from an employer?',
      input_type: 'boolean',
      required: true,
      field_map: 'income.has_w2',
    },
    {
      phase: InterviewPhase.INCOME,
      question_id: 'w2_count',
      question: 'How many W-2 forms do you have?',
      input_type: 'number',
      required: true,
      field_map: 'income.w2_count',
      follow_up_condition: 'income.has_w2 === true',
    },
    {
      phase: InterviewPhase.INCOME,
      question_id: 'w2_data',
      question: 'Enter W-2 details. For each W-2 provide: employer name, wages (Box 1), federal tax withheld (Box 2), state (Box 15), state tax withheld (Box 17). Format as JSON array: [{"employer":"Acme","wages":50000,"fed_withheld":8000,"state":"TX","state_withheld":0}]',
      input_type: 'multi',
      required: true,
      field_map: 'income.w2_data',
      follow_up_condition: 'income.has_w2 === true',
    },
    {
      phase: InterviewPhase.INCOME,
      question_id: 'has_1099_int',
      question: 'Did you receive any interest income (1099-INT)?',
      input_type: 'boolean',
      required: true,
      field_map: 'income.has_1099_int',
    },
    {
      phase: InterviewPhase.INCOME,
      question_id: '1099_int_data',
      question: 'Enter 1099-INT data. JSON array: [{"payer":"Bank of America","amount":1500,"tax_exempt":0}]',
      input_type: 'multi',
      required: true,
      field_map: 'income.int_data',
      follow_up_condition: 'income.has_1099_int === true',
    },
    {
      phase: InterviewPhase.INCOME,
      question_id: 'has_1099_div',
      question: 'Did you receive any dividend income (1099-DIV)?',
      input_type: 'boolean',
      required: true,
      field_map: 'income.has_1099_div',
    },
    {
      phase: InterviewPhase.INCOME,
      question_id: '1099_div_data',
      question: 'Enter 1099-DIV data. JSON array: [{"payer":"Vanguard","ordinary":2000,"qualified":1500,"capital_gains_dist":500}]',
      input_type: 'multi',
      required: true,
      field_map: 'income.div_data',
      follow_up_condition: 'income.has_1099_div === true',
    },
    {
      phase: InterviewPhase.INCOME,
      question_id: 'has_business_income',
      question: 'Did you have any self-employment or business income (1099-NEC, 1099-MISC, Schedule C)?',
      input_type: 'boolean',
      required: true,
      field_map: 'income.has_business',
      engine_consult: {
        engine: TAX_ENGINES.BIE,
        query_template: 'What are the self-employment tax implications and common deductions for a self-employed individual in 2025?',
      },
    },
    {
      phase: InterviewPhase.INCOME,
      question_id: 'business_data',
      question: 'Enter business/self-employment income. JSON array: [{"name":"Consulting LLC","gross_income":80000,"expenses":20000,"ein":"12-3456789"}]',
      input_type: 'multi',
      required: true,
      field_map: 'income.business_data',
      follow_up_condition: 'income.has_business === true',
    },
    {
      phase: InterviewPhase.INCOME,
      question_id: 'has_investment_income',
      question: 'Did you sell any stocks, bonds, or other investments (1099-B)?',
      input_type: 'boolean',
      required: true,
      field_map: 'income.has_investments',
    },
    {
      phase: InterviewPhase.INCOME,
      question_id: 'investment_data',
      question: 'Enter investment sales. JSON array: [{"description":"AAPL 100 shares","proceeds":15000,"cost_basis":10000,"date_acquired":"2020-01-15","date_sold":"2025-06-01","long_term":true}]',
      input_type: 'multi',
      required: true,
      field_map: 'income.investment_data',
      follow_up_condition: 'income.has_investments === true',
    },
    {
      phase: InterviewPhase.INCOME,
      question_id: 'has_rental',
      question: 'Did you have any rental property income or losses?',
      input_type: 'boolean',
      required: true,
      field_map: 'income.has_rental',
    },
    {
      phase: InterviewPhase.INCOME,
      question_id: 'rental_data',
      question: 'Enter rental property data. JSON array: [{"address":"123 Oak St","gross_rent":24000,"expenses":18000,"depreciation":5000}]',
      input_type: 'multi',
      required: true,
      field_map: 'income.rental_data',
      follow_up_condition: 'income.has_rental === true',
    },
    {
      phase: InterviewPhase.INCOME,
      question_id: 'has_crypto',
      question: 'Did you sell, exchange, or otherwise dispose of any digital assets (cryptocurrency)?',
      input_type: 'boolean',
      required: true,
      field_map: 'income.has_crypto',
      engine_consult: {
        engine: TAX_ENGINES.CRY,
        query_template: 'What are the 2025 IRS rules for reporting cryptocurrency transactions and digital asset dispositions?',
      },
    },
    {
      phase: InterviewPhase.INCOME,
      question_id: 'crypto_data',
      question: 'Enter crypto transaction summary. JSON array: [{"asset":"BTC","proceeds":25000,"cost_basis":15000,"long_term":false}]',
      input_type: 'multi',
      required: true,
      field_map: 'income.crypto_data',
      follow_up_condition: 'income.has_crypto === true',
    },
    {
      phase: InterviewPhase.INCOME,
      question_id: 'has_ss_income',
      question: 'Did you receive Social Security benefits (SSA-1099)?',
      input_type: 'boolean',
      required: true,
      field_map: 'income.has_ss',
    },
    {
      phase: InterviewPhase.INCOME,
      question_id: 'ss_gross',
      question: 'Total Social Security benefits received (Box 5 of SSA-1099)',
      input_type: 'number',
      required: true,
      field_map: 'income.ss_gross',
      follow_up_condition: 'income.has_ss === true',
    },
    {
      phase: InterviewPhase.INCOME,
      question_id: 'has_retirement_dist',
      question: 'Did you receive retirement distributions (1099-R from IRA, 401k, pension)?',
      input_type: 'boolean',
      required: true,
      field_map: 'income.has_retirement',
    },
    {
      phase: InterviewPhase.INCOME,
      question_id: 'retirement_data',
      question: 'Enter 1099-R data. JSON array: [{"payer":"Fidelity 401k","gross":30000,"taxable":30000,"fed_withheld":4500,"distribution_code":"7"}]',
      input_type: 'multi',
      required: true,
      field_map: 'income.retirement_data',
      follow_up_condition: 'income.has_retirement === true',
    },
    {
      phase: InterviewPhase.INCOME,
      question_id: 'has_other_income',
      question: 'Any other income? (gambling, alimony, prizes, K-1 partnership income, etc.)',
      input_type: 'boolean',
      required: true,
      field_map: 'income.has_other',
    },
    {
      phase: InterviewPhase.INCOME,
      question_id: 'other_income_data',
      question: 'Describe other income. JSON array: [{"type":"gambling","description":"Casino winnings","amount":5000,"withholding":1250}]',
      input_type: 'multi',
      required: true,
      field_map: 'income.other_data',
      follow_up_condition: 'income.has_other === true',
    },

    // ── Phase 3: Deductions ─────────────────────────────────────────
    {
      phase: InterviewPhase.DEDUCTIONS,
      question_id: 'deduction_preference',
      question: 'Would you like to itemize deductions or take the standard deduction? Select "auto" to let us determine the best option.',
      input_type: 'select',
      options: ['standard', 'itemized', 'auto'],
      required: true,
      field_map: 'deductions.preference',
      engine_consult: {
        engine: TAX_ENGINES.TIE,
        query_template: 'What is the 2025 standard deduction for {answer} filing status and when should a taxpayer consider itemizing?',
      },
    },
    {
      phase: InterviewPhase.DEDUCTIONS,
      question_id: 'has_mortgage_interest',
      question: 'Did you pay mortgage interest on your primary or secondary residence?',
      input_type: 'boolean',
      required: true,
      field_map: 'deductions.has_mortgage',
      follow_up_condition: 'deductions.preference !== "standard"',
    },
    {
      phase: InterviewPhase.DEDUCTIONS,
      question_id: 'mortgage_interest_amount',
      question: 'Total mortgage interest paid (from Form 1098, Box 1)',
      input_type: 'number',
      required: true,
      field_map: 'deductions.mortgage_interest',
      follow_up_condition: 'deductions.has_mortgage === true',
    },
    {
      phase: InterviewPhase.DEDUCTIONS,
      question_id: 'mortgage_principal',
      question: 'Outstanding mortgage principal balance',
      input_type: 'number',
      required: false,
      field_map: 'deductions.mortgage_principal',
      follow_up_condition: 'deductions.has_mortgage === true',
    },
    {
      phase: InterviewPhase.DEDUCTIONS,
      question_id: 'has_salt',
      question: 'Did you pay state and local taxes (income/sales tax and property tax)?',
      input_type: 'boolean',
      required: true,
      field_map: 'deductions.has_salt',
      follow_up_condition: 'deductions.preference !== "standard"',
    },
    {
      phase: InterviewPhase.DEDUCTIONS,
      question_id: 'state_local_income_tax',
      question: 'State and local income taxes paid (or sales tax if higher)',
      input_type: 'number',
      required: true,
      field_map: 'deductions.state_local_income_tax',
      follow_up_condition: 'deductions.has_salt === true',
    },
    {
      phase: InterviewPhase.DEDUCTIONS,
      question_id: 'property_tax',
      question: 'Real estate property taxes paid',
      input_type: 'number',
      required: true,
      field_map: 'deductions.property_tax',
      follow_up_condition: 'deductions.has_salt === true',
    },
    {
      phase: InterviewPhase.DEDUCTIONS,
      question_id: 'has_charitable',
      question: 'Did you make charitable contributions?',
      input_type: 'boolean',
      required: true,
      field_map: 'deductions.has_charitable',
      follow_up_condition: 'deductions.preference !== "standard"',
    },
    {
      phase: InterviewPhase.DEDUCTIONS,
      question_id: 'charitable_cash',
      question: 'Total cash charitable contributions',
      input_type: 'number',
      required: true,
      field_map: 'deductions.charitable_cash',
      follow_up_condition: 'deductions.has_charitable === true',
    },
    {
      phase: InterviewPhase.DEDUCTIONS,
      question_id: 'charitable_noncash',
      question: 'Total non-cash charitable contributions (FMV of donated property)',
      input_type: 'number',
      required: false,
      field_map: 'deductions.charitable_noncash',
      follow_up_condition: 'deductions.has_charitable === true',
    },
    {
      phase: InterviewPhase.DEDUCTIONS,
      question_id: 'has_medical',
      question: 'Did you have significant unreimbursed medical expenses (exceeding 7.5% of AGI)?',
      input_type: 'boolean',
      required: true,
      field_map: 'deductions.has_medical',
      follow_up_condition: 'deductions.preference !== "standard"',
    },
    {
      phase: InterviewPhase.DEDUCTIONS,
      question_id: 'medical_amount',
      question: 'Total unreimbursed medical and dental expenses',
      input_type: 'number',
      required: true,
      field_map: 'deductions.medical_amount',
      follow_up_condition: 'deductions.has_medical === true',
    },
    {
      phase: InterviewPhase.DEDUCTIONS,
      question_id: 'has_student_loan_interest',
      question: 'Did you pay student loan interest?',
      input_type: 'boolean',
      required: true,
      field_map: 'deductions.has_student_loan',
    },
    {
      phase: InterviewPhase.DEDUCTIONS,
      question_id: 'student_loan_interest',
      question: 'Student loan interest paid (max $2,500 above-the-line deduction)',
      input_type: 'number',
      required: true,
      field_map: 'deductions.student_loan_interest',
      follow_up_condition: 'deductions.has_student_loan === true',
    },
    {
      phase: InterviewPhase.DEDUCTIONS,
      question_id: 'has_hsa',
      question: 'Did you contribute to a Health Savings Account (HSA)?',
      input_type: 'boolean',
      required: true,
      field_map: 'deductions.has_hsa',
    },
    {
      phase: InterviewPhase.DEDUCTIONS,
      question_id: 'hsa_contributions',
      question: 'HSA contributions made (not through employer payroll)',
      input_type: 'number',
      required: true,
      field_map: 'deductions.hsa_contributions',
      follow_up_condition: 'deductions.has_hsa === true',
    },
    {
      phase: InterviewPhase.DEDUCTIONS,
      question_id: 'has_ira',
      question: 'Did you contribute to a traditional IRA?',
      input_type: 'boolean',
      required: true,
      field_map: 'deductions.has_ira',
    },
    {
      phase: InterviewPhase.DEDUCTIONS,
      question_id: 'ira_contributions',
      question: 'Traditional IRA contribution amount',
      input_type: 'number',
      required: true,
      field_map: 'deductions.ira_contributions',
      follow_up_condition: 'deductions.has_ira === true',
    },
    {
      phase: InterviewPhase.DEDUCTIONS,
      question_id: 'has_educator_expenses',
      question: 'Are you an eligible educator with unreimbursed classroom expenses?',
      input_type: 'boolean',
      required: true,
      field_map: 'deductions.has_educator',
    },
    {
      phase: InterviewPhase.DEDUCTIONS,
      question_id: 'educator_expenses',
      question: 'Educator expenses (max $300 per educator)',
      input_type: 'number',
      required: true,
      field_map: 'deductions.educator_expenses',
      follow_up_condition: 'deductions.has_educator === true',
    },

    // ── Phase 4: Dependents ─────────────────────────────────────────
    {
      phase: InterviewPhase.DEPENDENTS,
      question_id: 'has_dependents',
      question: 'Do you have any dependents to claim?',
      input_type: 'boolean',
      required: true,
      field_map: 'dependents.has_dependents',
      engine_consult: {
        engine: TAX_ENGINES.DEP,
        query_template: 'What are the 2025 IRS qualifying rules for claiming dependents including the relationship, residency, support, and age tests?',
      },
    },
    {
      phase: InterviewPhase.DEPENDENTS,
      question_id: 'dependent_count',
      question: 'How many dependents are you claiming?',
      input_type: 'number',
      required: true,
      field_map: 'dependents.count',
      follow_up_condition: 'dependents.has_dependents === true',
    },
    {
      phase: InterviewPhase.DEPENDENTS,
      question_id: 'dependent_data',
      question: 'Enter dependent information. JSON array: [{"first_name":"Jane","last_name":"Doe","ssn":"123456789","dob":"2015-03-22","relationship":"daughter","months_lived":12,"student":false,"disabled":false}]',
      input_type: 'multi',
      required: true,
      field_map: 'dependents.data',
      follow_up_condition: 'dependents.has_dependents === true',
    },

    // ── Phase 5: Credits ────────────────────────────────────────────
    {
      phase: InterviewPhase.CREDITS,
      question_id: 'has_education_expenses',
      question: 'Did you or a dependent have qualified education expenses (tuition, fees)?',
      input_type: 'boolean',
      required: true,
      field_map: 'credits.has_education',
      engine_consult: {
        engine: TAX_ENGINES.CRE,
        query_template: 'What education tax credits are available in 2025 — AOTC vs LLC — and what are the income limits?',
      },
    },
    {
      phase: InterviewPhase.CREDITS,
      question_id: 'education_data',
      question: 'Enter education expenses. JSON array: [{"student_name":"Jane Doe","institution":"State U","tuition":8000,"year_in_school":2,"form_1098T":true}]',
      input_type: 'multi',
      required: true,
      field_map: 'credits.education_data',
      follow_up_condition: 'credits.has_education === true',
    },
    {
      phase: InterviewPhase.CREDITS,
      question_id: 'has_child_care',
      question: 'Did you pay for child or dependent care so you (and your spouse) could work?',
      input_type: 'boolean',
      required: true,
      field_map: 'credits.has_child_care',
    },
    {
      phase: InterviewPhase.CREDITS,
      question_id: 'child_care_data',
      question: 'Enter child care expenses. JSON array: [{"provider":"Sunshine Daycare","ein":"98-7654321","amount":6000,"child_name":"Jane Doe"}]',
      input_type: 'multi',
      required: true,
      field_map: 'credits.child_care_data',
      follow_up_condition: 'credits.has_child_care === true',
    },
    {
      phase: InterviewPhase.CREDITS,
      question_id: 'has_ev_credit',
      question: 'Did you purchase a qualifying clean vehicle (electric/plug-in hybrid) in 2025?',
      input_type: 'boolean',
      required: true,
      field_map: 'credits.has_ev',
    },
    {
      phase: InterviewPhase.CREDITS,
      question_id: 'ev_data',
      question: 'Enter clean vehicle information: {"make":"Tesla","model":"Model 3","vin":"5YJ3E...","purchase_date":"2025-04-15","purchase_price":42000,"new_or_used":"new"}',
      input_type: 'multi',
      required: true,
      field_map: 'credits.ev_data',
      follow_up_condition: 'credits.has_ev === true',
    },
    {
      phase: InterviewPhase.CREDITS,
      question_id: 'has_energy_improvements',
      question: 'Did you make energy-efficient improvements to your home (solar panels, heat pumps, insulation, etc.)?',
      input_type: 'boolean',
      required: true,
      field_map: 'credits.has_energy',
    },
    {
      phase: InterviewPhase.CREDITS,
      question_id: 'energy_data',
      question: 'Enter energy improvement details. JSON array: [{"type":"solar_panels","cost":18000,"description":"Residential solar installation"}]',
      input_type: 'multi',
      required: true,
      field_map: 'credits.energy_data',
      follow_up_condition: 'credits.has_energy === true',
    },

    // ── Phase 6: Payments ───────────────────────────────────────────
    {
      phase: InterviewPhase.PAYMENTS,
      question_id: 'estimated_tax_payments',
      question: 'Did you make estimated tax payments (Form 1040-ES) for 2025?',
      input_type: 'boolean',
      required: true,
      field_map: 'payments.has_estimated',
    },
    {
      phase: InterviewPhase.PAYMENTS,
      question_id: 'estimated_amount',
      question: 'Total estimated tax payments made for 2025',
      input_type: 'number',
      required: true,
      field_map: 'payments.estimated_amount',
      follow_up_condition: 'payments.has_estimated === true',
    },
    {
      phase: InterviewPhase.PAYMENTS,
      question_id: 'prior_year_overpayment',
      question: 'Was any of your prior year refund applied to 2025 estimated taxes?',
      input_type: 'boolean',
      required: true,
      field_map: 'payments.has_prior_overpayment',
    },
    {
      phase: InterviewPhase.PAYMENTS,
      question_id: 'prior_overpayment_amount',
      question: 'Amount of prior year overpayment applied to 2025',
      input_type: 'number',
      required: true,
      field_map: 'payments.prior_overpayment_amount',
      follow_up_condition: 'payments.has_prior_overpayment === true',
    },
    {
      phase: InterviewPhase.PAYMENTS,
      question_id: 'extension_payment',
      question: 'Did you make a payment with a filing extension (Form 4868)?',
      input_type: 'boolean',
      required: true,
      field_map: 'payments.has_extension_payment',
    },
    {
      phase: InterviewPhase.PAYMENTS,
      question_id: 'extension_payment_amount',
      question: 'Amount paid with extension',
      input_type: 'number',
      required: true,
      field_map: 'payments.extension_amount',
      follow_up_condition: 'payments.has_extension_payment === true',
    },

    // ── Phase 7: State Filing ───────────────────────────────────────
    {
      phase: InterviewPhase.STATE_FILING,
      question_id: 'state_of_residence',
      question: 'What is your state of residence for 2025?',
      input_type: 'text',
      required: true,
      field_map: 'state.residence',
      validation: '^[A-Z]{2}$',
      engine_consult: {
        engine: TAX_ENGINES.STE,
        query_template: 'What are the state income tax rates and filing requirements for {answer} in 2025?',
      },
    },
    {
      phase: InterviewPhase.STATE_FILING,
      question_id: 'multi_state',
      question: 'Did you earn income in any state other than your state of residence?',
      input_type: 'boolean',
      required: true,
      field_map: 'state.multi_state',
    },
    {
      phase: InterviewPhase.STATE_FILING,
      question_id: 'other_states',
      question: 'List the other states where you earned income (comma-separated, e.g. "CA,NY")',
      input_type: 'text',
      required: true,
      field_map: 'state.other_states',
      follow_up_condition: 'state.multi_state === true',
    },
    {
      phase: InterviewPhase.STATE_FILING,
      question_id: 'moved_during_year',
      question: 'Did you move to a different state during 2025?',
      input_type: 'boolean',
      required: true,
      field_map: 'state.moved',
    },
    {
      phase: InterviewPhase.STATE_FILING,
      question_id: 'move_date',
      question: 'Date you moved (YYYY-MM-DD)',
      input_type: 'date',
      required: true,
      field_map: 'state.move_date',
      follow_up_condition: 'state.moved === true',
    },
    {
      phase: InterviewPhase.STATE_FILING,
      question_id: 'previous_state',
      question: 'Previous state of residence',
      input_type: 'text',
      required: true,
      field_map: 'state.previous_state',
      validation: '^[A-Z]{2}$',
      follow_up_condition: 'state.moved === true',
    },

    // ── Phase 8: Review & Calculate ─────────────────────────────────
    {
      phase: InterviewPhase.REVIEW_CALCULATE,
      question_id: 'review_confirm',
      question: 'Please review the information summary above. Is everything correct? Type "yes" to proceed with calculation or "edit" to go back and make changes.',
      input_type: 'select',
      options: ['yes', 'edit'],
      required: true,
      field_map: 'review.confirmed',
    },
    {
      phase: InterviewPhase.REVIEW_CALCULATE,
      question_id: 'direct_deposit',
      question: 'Would you like to set up direct deposit for any refund?',
      input_type: 'boolean',
      required: true,
      field_map: 'review.direct_deposit',
    },
    {
      phase: InterviewPhase.REVIEW_CALCULATE,
      question_id: 'bank_routing',
      question: 'Bank routing number (9 digits)',
      input_type: 'text',
      required: true,
      field_map: 'review.bank_routing',
      validation: '^\\d{9}$',
      follow_up_condition: 'review.direct_deposit === true',
    },
    {
      phase: InterviewPhase.REVIEW_CALCULATE,
      question_id: 'bank_account',
      question: 'Bank account number',
      input_type: 'text',
      required: true,
      field_map: 'review.bank_account',
      follow_up_condition: 'review.direct_deposit === true',
    },
    {
      phase: InterviewPhase.REVIEW_CALCULATE,
      question_id: 'bank_type',
      question: 'Account type',
      input_type: 'select',
      options: ['checking', 'savings'],
      required: true,
      field_map: 'review.bank_type',
      follow_up_condition: 'review.direct_deposit === true',
    },
  ];
}

// ─── Engine Runtime Integration ────────────────────────────────────────

export async function queryEngineRuntime(engineId: string, query: string): Promise<unknown> {
  const startMs = Date.now();
  const endpoints = [
    { method: 'POST', path: '/query', body: { engine_id: engineId, query } },
    { method: 'POST', path: '/api/v1/query', body: { engine_id: engineId, query } },
    { method: 'GET', path: `/doctrines?engine_id=${encodeURIComponent(engineId)}&topic=${encodeURIComponent(query)}`, body: null },
    { method: 'GET', path: `/api/v1/doctrines?engine_id=${encodeURIComponent(engineId)}&query=${encodeURIComponent(query)}`, body: null },
  ];

  for (const ep of endpoints) {
    try {
      const fetchOpts: RequestInit = {
        method: ep.method,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': ENGINE_RUNTIME_KEY,
        },
        signal: AbortSignal.timeout(15_000),
      };
      if (ep.body && ep.method === 'POST') {
        fetchOpts.body = JSON.stringify(ep.body);
      }

      const response = await fetch(`${ENGINE_RUNTIME_URL}${ep.path}`, fetchOpts);
      if (response.ok) {
        const data = await response.json();
        const latency = Date.now() - startMs;
        log.info({ engineId, endpoint: ep.path, latency }, 'Engine runtime query succeeded');
        return { success: true, data, latency_ms: latency, endpoint: ep.path };
      }
      // Non-200 — try next endpoint
      log.debug({ engineId, endpoint: ep.path, status: response.status }, 'Engine endpoint returned non-200, trying next');
    } catch (err) {
      log.debug({ engineId, endpoint: ep.path, err }, 'Engine endpoint failed, trying next');
    }
  }

  // All endpoints failed — return graceful fallback
  log.warn({ engineId, query }, 'All engine runtime endpoints failed');
  return { success: false, message: 'Engine runtime unavailable — proceeding with built-in knowledge', latency_ms: Date.now() - startMs };
}

// ─── Claude Subprocess Integration ─────────────────────────────────────

export async function askClaude(systemPrompt: string, userMessage: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fullPrompt = `<system>\n${systemPrompt}\n</system>\n\n${userMessage}`;
    const args = ['--model', CLAUDE_MODEL, '--print', '--max-turns', '1', '-p', fullPrompt];

    log.debug({ model: CLAUDE_MODEL, promptLength: fullPrompt.length }, 'Spawning Claude subprocess');

    const proc = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: CLAUDE_TIMEOUT_MS,
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      log.error({ err }, 'Claude subprocess spawn error');
      reject(new Error(`Claude subprocess failed to spawn: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        log.info({ responseLength: stdout.length }, 'Claude subprocess responded');
        resolve(stdout.trim());
      } else if (stdout.trim()) {
        // Non-zero exit but got output — use it
        log.warn({ code, stderrSnippet: stderr.slice(0, 200) }, 'Claude exited non-zero but produced output');
        resolve(stdout.trim());
      } else {
        log.error({ code, stderr: stderr.slice(0, 500) }, 'Claude subprocess failed');
        reject(new Error(`Claude subprocess exited with code ${code}: ${stderr.slice(0, 300)}`));
      }
    });
  });
}

// ─── Deep Answer Analysis via Claude ───────────────────────────────────

async function analyzeAnswerWithClaude(
  question: InterviewQuestion,
  answer: unknown,
  sessionAnswers: Record<string, unknown>,
): Promise<{ guidance: string; warnings: string[] }> {
  const systemPrompt = `You are an expert IRS Enrolled Agent and CPA specializing in individual tax return preparation for the 2025 tax year. You are reviewing answers provided during an interactive tax interview.

Your role:
- Provide brief, helpful guidance based on the taxpayer's answer
- Flag any potential issues, red flags, or optimization opportunities
- Be concise (2-4 sentences max)
- Reference specific IRS rules, forms, or schedules when relevant
- If the answer suggests a common mistake, politely note the correct approach

Known filing context:
${JSON.stringify(sessionAnswers, null, 2)}`;

  const userMsg = `The taxpayer answered the question "${question.question}" with: ${JSON.stringify(answer)}

Provide brief guidance and flag any warnings.`;

  try {
    const response = await askClaude(systemPrompt, userMsg);
    // Parse warnings from response
    const warnings: string[] = [];
    const warningMatches = response.match(/(?:Warning|Caution|Note|Important|Flag):\s*(.+?)(?:\n|$)/gi);
    if (warningMatches) {
      for (const m of warningMatches) {
        warnings.push(m.replace(/^(?:Warning|Caution|Note|Important|Flag):\s*/i, '').trim());
      }
    }
    return { guidance: response, warnings };
  } catch (err) {
    log.warn({ err, questionId: question.question_id }, 'Claude analysis failed, continuing without guidance');
    return { guidance: '', warnings: [] };
  }
}

// ─── Session Helpers ───────────────────────────────────────────────────

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in current) || typeof current[keys[i]] !== 'object' || current[keys[i]] === null) {
      current[keys[i]] = {};
    }
    current = current[keys[i]] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

function evaluateCondition(condition: string, answers: Record<string, unknown>): boolean {
  // Simple condition evaluator for follow_up_condition strings
  // Supports: path === "value", path === true/false, path !== "value"
  try {
    const eqMatch = condition.match(/^(.+?)\s*===\s*(.+)$/);
    if (eqMatch) {
      const path = eqMatch[1].trim();
      let expected: unknown = eqMatch[2].trim();
      if (expected === 'true') expected = true;
      else if (expected === 'false') expected = false;
      else if (expected.startsWith('"') && expected.endsWith('"')) expected = (expected as string).slice(1, -1);

      const actual = getNestedValue(answers, path);
      return actual === expected;
    }

    const neqMatch = condition.match(/^(.+?)\s*!==\s*(.+)$/);
    if (neqMatch) {
      const path = neqMatch[1].trim();
      let expected: unknown = neqMatch[2].trim();
      if (expected === 'true') expected = true;
      else if (expected === 'false') expected = false;
      else if (expected.startsWith('"') && expected.endsWith('"')) expected = (expected as string).slice(1, -1);

      const actual = getNestedValue(answers, path);
      return actual !== expected;
    }

    // OR conditions
    if (condition.includes('||')) {
      return condition.split('||').some(part => evaluateCondition(part.trim(), answers));
    }

    return true; // Default to showing the question
  } catch {
    return true;
  }
}

function getPhaseLabel(phase: InterviewPhase): string {
  const labels: Record<number, string> = {
    [InterviewPhase.PERSONAL_INFO]: 'Personal Information',
    [InterviewPhase.INCOME]: 'Income',
    [InterviewPhase.DEDUCTIONS]: 'Deductions',
    [InterviewPhase.DEPENDENTS]: 'Dependents',
    [InterviewPhase.CREDITS]: 'Credits',
    [InterviewPhase.PAYMENTS]: 'Payments & Withholding',
    [InterviewPhase.STATE_FILING]: 'State Filing',
    [InterviewPhase.REVIEW_CALCULATE]: 'Review & Calculate',
  };
  return labels[phase] || `Phase ${phase}`;
}

// ─── Return Preparer Class ─────────────────────────────────────────────

export class ReturnPreparer {
  private db: Database;
  private questions: InterviewQuestion[];

  constructor(db: Database) {
    this.db = db;
    this.questions = buildQuestionBank();
  }

  // ── Session CRUD ──────────────────────────────────────────────────

  createSession(userId: string): PrepareSession {
    const id = crypto.randomUUID().replace(/-/g, '');
    const now = new Date().toISOString();
    const session: PrepareSession = {
      id,
      status: 'interviewing',
      phase: InterviewPhase.PERSONAL_INFO,
      current_question_index: 0,
      client_id: null,
      return_id: null,
      answers: {},
      engine_consultations: [],
      claude_interactions: [],
      warnings: [],
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO preparer_sessions (id, user_id, status, phase, current_question_index, client_id, return_id, answers, engine_consultations, claude_interactions, warnings, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, userId, session.status, session.phase, session.current_question_index,
      null, null,
      JSON.stringify(session.answers),
      JSON.stringify(session.engine_consultations),
      JSON.stringify(session.claude_interactions),
      JSON.stringify(session.warnings),
      now, now,
    );

    logAudit(this.db, {
      user_id: userId,
      action: 'preparer_session_created',
      entity_type: 'preparer_session',
      entity_id: id,
    });

    log.info({ sessionId: id, userId }, 'Preparer session created');
    return session;
  }

  getSession(sessionId: string): PrepareSession | null {
    const row = this.db.prepare('SELECT * FROM preparer_sessions WHERE id = ?').get(sessionId) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      id: row.id as string,
      status: row.status as SessionStatus,
      phase: row.phase as number,
      current_question_index: row.current_question_index as number,
      client_id: row.client_id as string | null,
      return_id: row.return_id as string | null,
      answers: JSON.parse(row.answers as string || '{}'),
      engine_consultations: JSON.parse(row.engine_consultations as string || '[]'),
      claude_interactions: JSON.parse(row.claude_interactions as string || '[]'),
      warnings: JSON.parse(row.warnings as string || '[]'),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }

  private saveSession(session: PrepareSession): void {
    this.db.prepare(`
      UPDATE preparer_sessions SET
        status = ?, phase = ?, current_question_index = ?,
        client_id = ?, return_id = ?,
        answers = ?, engine_consultations = ?, claude_interactions = ?,
        warnings = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      session.status, session.phase, session.current_question_index,
      session.client_id, session.return_id,
      JSON.stringify(session.answers),
      JSON.stringify(session.engine_consultations),
      JSON.stringify(session.claude_interactions),
      JSON.stringify(session.warnings),
      session.id,
    );
  }

  // ── Question Navigation ───────────────────────────────────────────

  getNextQuestion(session: PrepareSession): NextQuestionResult {
    const applicableQuestions = this.getApplicableQuestions(session);

    // Find the next unanswered question
    let nextQuestion: InterviewQuestion | null = null;
    let questionsAnswered = 0;

    for (const q of applicableQuestions) {
      const existingAnswer = getNestedValue(session.answers, q.field_map);
      if (existingAnswer !== undefined && existingAnswer !== null) {
        questionsAnswered++;
      } else if (!nextQuestion) {
        nextQuestion = q;
      }
    }

    // If no more questions in current phase, advance to next phase
    if (!nextQuestion && session.phase < InterviewPhase.REVIEW_CALCULATE) {
      session.phase++;
      session.current_question_index = 0;
      this.saveSession(session);
      return this.getNextQuestion(session); // Recurse into next phase
    }

    // If we are in REVIEW phase and have finished all questions — mark reviewing
    if (!nextQuestion && session.phase === InterviewPhase.REVIEW_CALCULATE) {
      session.status = 'reviewing';
      this.saveSession(session);
    }

    const totalApplicable = this.getAllApplicableQuestions(session).length;

    return {
      session_id: session.id,
      status: session.status,
      phase: session.phase,
      phase_name: getPhaseLabel(session.phase),
      question: nextQuestion,
      guidance: null,
      progress: {
        current_phase: session.phase,
        total_phases: 8,
        questions_answered: this.countTotalAnswered(session),
        percent_complete: totalApplicable > 0 ? Math.round((this.countTotalAnswered(session) / totalApplicable) * 100) : 0,
      },
      engine_insight: null,
    };
  }

  private getApplicableQuestions(session: PrepareSession): InterviewQuestion[] {
    return this.questions.filter(q => {
      if (q.phase !== session.phase) return false;
      if (q.follow_up_condition) {
        return evaluateCondition(q.follow_up_condition, session.answers);
      }
      return true;
    });
  }

  private getAllApplicableQuestions(session: PrepareSession): InterviewQuestion[] {
    return this.questions.filter(q => {
      if (q.follow_up_condition) {
        return evaluateCondition(q.follow_up_condition, session.answers);
      }
      return true;
    });
  }

  private countTotalAnswered(session: PrepareSession): number {
    let count = 0;
    for (const q of this.questions) {
      if (q.follow_up_condition && !evaluateCondition(q.follow_up_condition, session.answers)) continue;
      const val = getNestedValue(session.answers, q.field_map);
      if (val !== undefined && val !== null) count++;
    }
    return count;
  }

  // ── Answer Processing ─────────────────────────────────────────────

  async processAnswer(
    session: PrepareSession,
    questionId: string,
    answer: unknown,
    userId: string,
  ): Promise<NextQuestionResult> {
    const question = this.questions.find(q => q.question_id === questionId);
    if (!question) {
      throw new Error(`Unknown question: ${questionId}`);
    }

    // Validate answer
    if (question.required && (answer === undefined || answer === null || answer === '')) {
      throw new Error(`Answer is required for: ${question.question}`);
    }

    if (question.validation && typeof answer === 'string') {
      const regex = new RegExp(question.validation);
      if (!regex.test(answer)) {
        throw new Error(`Invalid format for ${question.question_id}. Expected pattern: ${question.validation}`);
      }
    }

    // Coerce types
    let processedAnswer = answer;
    if (question.input_type === 'number' && typeof answer === 'string') {
      processedAnswer = parseFloat(answer);
      if (isNaN(processedAnswer as number)) throw new Error(`Invalid number for ${question.question_id}`);
    }
    if (question.input_type === 'boolean' && typeof answer === 'string') {
      processedAnswer = answer === 'true' || answer === 'yes' || answer === '1';
    }
    if (question.input_type === 'multi' && typeof answer === 'string') {
      try {
        processedAnswer = JSON.parse(answer);
      } catch {
        throw new Error(`Invalid JSON for multi-value question ${question.question_id}`);
      }
    }

    // Store answer
    setNestedValue(session.answers, question.field_map, processedAnswer);

    // Engine consultation if configured
    let engineInsight: string | null = null;
    if (question.engine_consult) {
      const queryText = question.engine_consult.query_template.replace('{answer}', String(processedAnswer));
      const engineResult = await queryEngineRuntime(question.engine_consult.engine, queryText);

      session.engine_consultations.push({
        engine: question.engine_consult.engine,
        query: queryText,
        response: engineResult,
        timestamp: new Date().toISOString(),
        latency_ms: (engineResult as Record<string, unknown>)?.latency_ms as number || 0,
      });

      // Store engine query in DB
      try {
        this.db.prepare(`
          INSERT INTO engine_queries (id, return_id, client_id, engine_id, query_text, response_json, response_layer, latency_ms, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'doctrine_cache', ?, datetime('now'))
        `).run(
          crypto.randomUUID().replace(/-/g, ''),
          session.return_id,
          session.client_id,
          question.engine_consult.engine,
          queryText,
          JSON.stringify(engineResult),
          (engineResult as Record<string, unknown>)?.latency_ms || 0,
        );
      } catch (err) {
        log.warn({ err }, 'Failed to log engine query to DB');
      }

      if ((engineResult as Record<string, unknown>)?.success) {
        engineInsight = `Engine ${question.engine_consult.engine} consulted for tax guidance.`;
      }
    }

    // Claude analysis for complex answers
    let claudeGuidance: string | null = null;
    const complexTypes = ['multi', 'number'];
    if (complexTypes.includes(question.input_type) || question.engine_consult) {
      try {
        const analysis = await analyzeAnswerWithClaude(question, processedAnswer, session.answers);
        claudeGuidance = analysis.guidance;
        if (analysis.warnings.length > 0) {
          session.warnings.push(...analysis.warnings);
        }
        session.claude_interactions.push({
          role: 'assistant',
          content: analysis.guidance,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // Continue without Claude guidance
      }
    }

    // Save session
    this.saveSession(session);

    logAudit(this.db, {
      user_id: userId,
      action: 'preparer_answer_submitted',
      entity_type: 'preparer_session',
      entity_id: session.id,
      details: { question_id: questionId, phase: session.phase },
    });

    // Get next question
    const result = this.getNextQuestion(session);
    result.guidance = claudeGuidance;
    result.engine_insight = engineInsight;
    return result;
  }

  // ── Build Return from Answers ─────────────────────────────────────

  async buildReturnFromAnswers(session: PrepareSession, userId: string): Promise<{
    client_id: string;
    return_id: string;
    income_count: number;
    deduction_count: number;
    dependent_count: number;
  }> {
    const answers = session.answers;
    const personal = (answers.personal || {}) as Record<string, unknown>;
    const income = (answers.income || {}) as Record<string, unknown>;
    const deductions = (answers.deductions || {}) as Record<string, unknown>;
    const dependentAnswers = (answers.dependents || {}) as Record<string, unknown>;
    const credits = (answers.credits || {}) as Record<string, unknown>;
    const payments = (answers.payments || {}) as Record<string, unknown>;

    // ── Create Client ──────────────────────────────────────────────
    const clientId = crypto.randomUUID().replace(/-/g, '');
    const ssnEncrypted = personal.ssn ? encryptField(personal.ssn as string) : null;
    const ssnLast4 = personal.ssn ? extractLast4(personal.ssn as string) : null;
    const spouseSsnEncrypted = personal.spouse_ssn ? encryptField(personal.spouse_ssn as string) : null;
    const spouseSsnLast4 = personal.spouse_ssn ? extractLast4(personal.spouse_ssn as string) : null;

    this.db.prepare(`
      INSERT INTO clients (id, user_id, email, first_name, middle_name, last_name,
        ssn_encrypted, ssn_last4, dob, phone, address_street, address_city,
        address_state, address_zip, filing_status, occupation,
        spouse_first_name, spouse_last_name, spouse_ssn_encrypted, spouse_ssn_last4,
        spouse_dob, spouse_occupation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      clientId, userId,
      personal.email || null,
      personal.first_name || null,
      personal.middle_name || null,
      personal.last_name || null,
      ssnEncrypted, ssnLast4,
      personal.dob || null,
      personal.phone || null,
      personal.address_street || null,
      personal.address_city || null,
      personal.address_state || null,
      personal.address_zip || null,
      personal.filing_status || null,
      personal.occupation || null,
      personal.spouse_first_name || null,
      personal.spouse_last_name || null,
      spouseSsnEncrypted, spouseSsnLast4,
      personal.spouse_dob || null,
      personal.spouse_occupation || null,
    );

    logAudit(this.db, {
      client_id: clientId,
      user_id: userId,
      action: 'client_created_via_preparer',
      entity_type: 'client',
      entity_id: clientId,
    });

    // ── Create Tax Return ──────────────────────────────────────────
    const returnId = crypto.randomUUID().replace(/-/g, '');
    const estimatedPayments = payments.estimated_amount ? Number(payments.estimated_amount) : 0;
    const priorOverpayment = payments.prior_overpayment_amount ? Number(payments.prior_overpayment_amount) : 0;
    const extensionPayment = payments.extension_amount ? Number(payments.extension_amount) : 0;

    this.db.prepare(`
      INSERT INTO tax_returns (id, client_id, tax_year, status, return_type, estimated_payments)
      VALUES (?, ?, 2025, 'in_progress', '1040', ?)
    `).run(returnId, clientId, estimatedPayments + priorOverpayment + extensionPayment);

    logAudit(this.db, {
      return_id: returnId,
      client_id: clientId,
      user_id: userId,
      action: 'return_created_via_preparer',
      entity_type: 'tax_return',
      entity_id: returnId,
    });

    // ── Add Income Items ───────────────────────────────────────────
    let incomeCount = 0;
    const insertIncome = this.db.prepare(`
      INSERT INTO income_items (id, return_id, category, subcategory, description, payer_name, payer_ein, amount, tax_withheld, state_withheld, form_type, state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // W-2 wages
    if (income.w2_data && Array.isArray(income.w2_data)) {
      for (const w2 of income.w2_data as Array<Record<string, unknown>>) {
        insertIncome.run(
          crypto.randomUUID().replace(/-/g, ''), returnId,
          'wages', 'w2', `W-2 from ${w2.employer || 'Unknown'}`,
          w2.employer || null, w2.ein || null,
          Number(w2.wages || 0), Number(w2.fed_withheld || 0), Number(w2.state_withheld || 0),
          'W-2', w2.state || null,
        );
        incomeCount++;
      }
    }

    // Interest income
    if (income.int_data && Array.isArray(income.int_data)) {
      for (const item of income.int_data as Array<Record<string, unknown>>) {
        insertIncome.run(
          crypto.randomUUID().replace(/-/g, ''), returnId,
          'interest', 'taxable', `Interest from ${item.payer || 'Unknown'}`,
          item.payer || null, null,
          Number(item.amount || 0), 0, 0,
          '1099-INT', null,
        );
        incomeCount++;
      }
    }

    // Dividend income
    if (income.div_data && Array.isArray(income.div_data)) {
      for (const item of income.div_data as Array<Record<string, unknown>>) {
        insertIncome.run(
          crypto.randomUUID().replace(/-/g, ''), returnId,
          'dividends', 'ordinary', `Dividends from ${item.payer || 'Unknown'}`,
          item.payer || null, null,
          Number(item.ordinary || 0), 0, 0,
          '1099-DIV', null,
        );
        if (Number(item.qualified || 0) > 0) {
          insertIncome.run(
            crypto.randomUUID().replace(/-/g, ''), returnId,
            'dividends', 'qualified', `Qualified dividends from ${item.payer || 'Unknown'}`,
            item.payer || null, null,
            Number(item.qualified || 0), 0, 0,
            '1099-DIV', null,
          );
          incomeCount++;
        }
        if (Number(item.capital_gains_dist || 0) > 0) {
          insertIncome.run(
            crypto.randomUUID().replace(/-/g, ''), returnId,
            'capital_gains', 'distribution', `Cap gain distribution from ${item.payer || 'Unknown'}`,
            item.payer || null, null,
            Number(item.capital_gains_dist || 0), 0, 0,
            '1099-DIV', null,
          );
          incomeCount++;
        }
        incomeCount++;
      }
    }

    // Business / self-employment income
    if (income.business_data && Array.isArray(income.business_data)) {
      for (const biz of income.business_data as Array<Record<string, unknown>>) {
        insertIncome.run(
          crypto.randomUUID().replace(/-/g, ''), returnId,
          'self_employment', 'schedule_c', `Business: ${biz.name || 'Self-Employment'}`,
          biz.name || null, biz.ein || null,
          Number(biz.gross_income || 0) - Number(biz.expenses || 0), 0, 0,
          'Schedule C', null,
        );
        incomeCount++;
      }
    }

    // Investment / capital gains
    if (income.investment_data && Array.isArray(income.investment_data)) {
      for (const inv of income.investment_data as Array<Record<string, unknown>>) {
        const gain = Number(inv.proceeds || 0) - Number(inv.cost_basis || 0);
        insertIncome.run(
          crypto.randomUUID().replace(/-/g, ''), returnId,
          'capital_gains', inv.long_term ? 'long_term' : 'short_term',
          inv.description || 'Investment sale',
          null, null,
          gain, 0, 0,
          '1099-B', null,
        );
        incomeCount++;
      }
    }

    // Rental income
    if (income.rental_data && Array.isArray(income.rental_data)) {
      for (const rental of income.rental_data as Array<Record<string, unknown>>) {
        const netRental = Number(rental.gross_rent || 0) - Number(rental.expenses || 0) - Number(rental.depreciation || 0);
        insertIncome.run(
          crypto.randomUUID().replace(/-/g, ''), returnId,
          'rental', 'schedule_e', `Rental: ${rental.address || 'Rental Property'}`,
          null, null,
          netRental, 0, 0,
          'Schedule E', null,
        );
        incomeCount++;
      }
    }

    // Crypto
    if (income.crypto_data && Array.isArray(income.crypto_data)) {
      for (const crypto_item of income.crypto_data as Array<Record<string, unknown>>) {
        const gain = Number(crypto_item.proceeds || 0) - Number(crypto_item.cost_basis || 0);
        insertIncome.run(
          crypto.randomUUID().replace(/-/g, ''), returnId,
          'capital_gains', crypto_item.long_term ? 'long_term_crypto' : 'short_term_crypto',
          `Crypto: ${crypto_item.asset || 'Digital Asset'}`,
          null, null,
          gain, 0, 0,
          'Form 8949', null,
        );
        incomeCount++;
      }
    }

    // Social Security
    if (income.ss_gross) {
      insertIncome.run(
        crypto.randomUUID().replace(/-/g, ''), returnId,
        'social_security', 'ssa_1099', 'Social Security Benefits',
        'Social Security Administration', null,
        Number(income.ss_gross), 0, 0,
        'SSA-1099', null,
      );
      incomeCount++;
    }

    // Retirement distributions
    if (income.retirement_data && Array.isArray(income.retirement_data)) {
      for (const ret of income.retirement_data as Array<Record<string, unknown>>) {
        insertIncome.run(
          crypto.randomUUID().replace(/-/g, ''), returnId,
          'retirement', `distribution_${ret.distribution_code || '7'}`,
          `Retirement from ${ret.payer || 'Unknown'}`,
          ret.payer || null, null,
          Number(ret.taxable || ret.gross || 0), Number(ret.fed_withheld || 0), 0,
          '1099-R', null,
        );
        incomeCount++;
      }
    }

    // Other income
    if (income.other_data && Array.isArray(income.other_data)) {
      for (const other of income.other_data as Array<Record<string, unknown>>) {
        insertIncome.run(
          crypto.randomUUID().replace(/-/g, ''), returnId,
          'other', other.type as string || 'misc',
          other.description as string || 'Other income',
          null, null,
          Number(other.amount || 0), Number(other.withholding || 0), 0,
          'Other', null,
        );
        incomeCount++;
      }
    }

    // ── Add Deductions ─────────────────────────────────────────────
    let deductionCount = 0;
    const insertDeduction = this.db.prepare(`
      INSERT INTO deductions (id, return_id, category, subcategory, description, amount, schedule, form_line)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    if (deductions.mortgage_interest) {
      insertDeduction.run(
        crypto.randomUUID().replace(/-/g, ''), returnId,
        'itemized', 'mortgage_interest', 'Home mortgage interest',
        Number(deductions.mortgage_interest), 'A', '8a',
      );
      deductionCount++;
    }

    if (deductions.state_local_income_tax) {
      insertDeduction.run(
        crypto.randomUUID().replace(/-/g, ''), returnId,
        'itemized', 'salt_income', 'State and local income taxes',
        Number(deductions.state_local_income_tax), 'A', '5a',
      );
      deductionCount++;
    }

    if (deductions.property_tax) {
      insertDeduction.run(
        crypto.randomUUID().replace(/-/g, ''), returnId,
        'itemized', 'salt_property', 'Real estate taxes',
        Number(deductions.property_tax), 'A', '5b',
      );
      deductionCount++;
    }

    if (deductions.charitable_cash) {
      insertDeduction.run(
        crypto.randomUUID().replace(/-/g, ''), returnId,
        'itemized', 'charitable_cash', 'Cash charitable contributions',
        Number(deductions.charitable_cash), 'A', '12',
      );
      deductionCount++;
    }

    if (deductions.charitable_noncash) {
      insertDeduction.run(
        crypto.randomUUID().replace(/-/g, ''), returnId,
        'itemized', 'charitable_noncash', 'Non-cash charitable contributions',
        Number(deductions.charitable_noncash), 'A', '12',
      );
      deductionCount++;
    }

    if (deductions.medical_amount) {
      insertDeduction.run(
        crypto.randomUUID().replace(/-/g, ''), returnId,
        'itemized', 'medical', 'Medical and dental expenses',
        Number(deductions.medical_amount), 'A', '1',
      );
      deductionCount++;
    }

    // Above-the-line deductions
    if (deductions.student_loan_interest) {
      insertDeduction.run(
        crypto.randomUUID().replace(/-/g, ''), returnId,
        'above_line', 'student_loan_interest', 'Student loan interest deduction',
        Math.min(Number(deductions.student_loan_interest), 2500), '1040', '21',
      );
      deductionCount++;
    }

    if (deductions.hsa_contributions) {
      insertDeduction.run(
        crypto.randomUUID().replace(/-/g, ''), returnId,
        'above_line', 'hsa', 'HSA contribution deduction',
        Number(deductions.hsa_contributions), '1040', '13',
      );
      deductionCount++;
    }

    if (deductions.ira_contributions) {
      insertDeduction.run(
        crypto.randomUUID().replace(/-/g, ''), returnId,
        'above_line', 'ira', 'IRA deduction',
        Number(deductions.ira_contributions), '1040', '20',
      );
      deductionCount++;
    }

    if (deductions.educator_expenses) {
      insertDeduction.run(
        crypto.randomUUID().replace(/-/g, ''), returnId,
        'above_line', 'educator', 'Educator expenses',
        Math.min(Number(deductions.educator_expenses), 300), '1040', '11',
      );
      deductionCount++;
    }

    // ── Add Dependents ─────────────────────────────────────────────
    let dependentCount = 0;
    if (dependentAnswers.data && Array.isArray(dependentAnswers.data)) {
      const insertDep = this.db.prepare(`
        INSERT INTO dependents (id, return_id, first_name, last_name, ssn_encrypted, ssn_last4, relationship, dob, months_lived, student, disabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const dep of dependentAnswers.data as Array<Record<string, unknown>>) {
        const depSsnEncrypted = dep.ssn ? encryptField(dep.ssn as string) : null;
        const depSsnLast4 = dep.ssn ? extractLast4(dep.ssn as string) : null;

        insertDep.run(
          crypto.randomUUID().replace(/-/g, ''), returnId,
          dep.first_name || null, dep.last_name || null,
          depSsnEncrypted, depSsnLast4,
          dep.relationship || null, dep.dob || null,
          dep.months_lived !== undefined ? Number(dep.months_lived) : 12,
          dep.student ? 1 : 0, dep.disabled ? 1 : 0,
        );
        dependentCount++;
      }
    }

    // Update session with IDs
    session.client_id = clientId;
    session.return_id = returnId;
    this.saveSession(session);

    log.info({
      sessionId: session.id, clientId, returnId,
      incomeCount, deductionCount, dependentCount,
    }, 'Return built from interview answers');

    return { client_id: clientId, return_id: returnId, income_count: incomeCount, deduction_count: deductionCount, dependent_count: dependentCount };
  }

  // ── Calculate Return ──────────────────────────────────────────────

  async runCalculation(session: PrepareSession, userId: string): Promise<{
    return_id: string;
    calculation: unknown;
  }> {
    if (!session.return_id) {
      // Build the return first
      await this.buildReturnFromAnswers(session, userId);
    }

    session.status = 'calculating';
    this.saveSession(session);

    try {
      const result = calculateReturn(this.db, session.return_id!);

      session.status = 'complete';
      this.saveSession(session);

      logAudit(this.db, {
        return_id: session.return_id!,
        client_id: session.client_id!,
        user_id: userId,
        action: 'return_calculated_via_preparer',
        entity_type: 'tax_return',
        entity_id: session.return_id!,
        details: {
          refund_or_owed: (result as Record<string, unknown>).refund_or_owed,
          effective_rate: (result as Record<string, unknown>).effective_rate,
        },
      });

      log.info({
        sessionId: session.id,
        returnId: session.return_id,
        refundOrOwed: (result as Record<string, unknown>).refund_or_owed,
      }, 'Return calculation complete');

      return { return_id: session.return_id!, calculation: result };
    } catch (err) {
      session.status = 'error';
      session.warnings.push(`Calculation error: ${(err as Error).message}`);
      this.saveSession(session);
      throw err;
    }
  }

  // ── Summary Builder ───────────────────────────────────────────────

  getReturnSummary(session: PrepareSession): Record<string, unknown> {
    if (!session.return_id) {
      return { error: 'Return not yet created. Complete the interview first.' };
    }

    const taxReturn = this.db.prepare('SELECT * FROM tax_returns WHERE id = ?').get(session.return_id) as Record<string, unknown> | undefined;
    const client = session.client_id
      ? this.db.prepare('SELECT * FROM clients WHERE id = ?').get(session.client_id) as Record<string, unknown> | undefined
      : null;
    const incomeItems = this.db.prepare('SELECT * FROM income_items WHERE return_id = ?').all(session.return_id);
    const deductionItems = this.db.prepare('SELECT * FROM deductions WHERE return_id = ?').all(session.return_id);
    const dependentItems = this.db.prepare('SELECT * FROM dependents WHERE return_id = ?').all(session.return_id);

    return {
      session_id: session.id,
      session_status: session.status,
      client: client ? {
        name: `${client.first_name} ${client.last_name}`,
        ssn_last4: client.ssn_last4,
        filing_status: client.filing_status,
        address: `${client.address_street}, ${client.address_city}, ${client.address_state} ${client.address_zip}`,
      } : null,
      tax_return: taxReturn ? {
        id: taxReturn.id,
        tax_year: taxReturn.tax_year,
        status: taxReturn.status,
        total_income: taxReturn.total_income,
        adjusted_gross_income: taxReturn.adjusted_gross_income,
        taxable_income: taxReturn.taxable_income,
        total_tax: taxReturn.total_tax,
        total_credits: taxReturn.total_credits,
        total_payments: taxReturn.total_payments,
        total_withholding: taxReturn.total_withholding,
        refund_or_owed: taxReturn.refund_or_owed,
        effective_rate: taxReturn.effective_rate,
        marginal_rate: taxReturn.marginal_rate,
        deduction_method: taxReturn.deduction_method,
      } : null,
      income_items: incomeItems,
      deductions: deductionItems,
      dependents: dependentItems,
      warnings: session.warnings,
      engine_consultations_count: session.engine_consultations.length,
      claude_interactions_count: session.claude_interactions.length,
    };
  }

  // ── Smart Prepare (One-Shot) ──────────────────────────────────────

  async smartPrepare(input: SmartPrepareInput, userId: string): Promise<{
    session_id: string;
    client_id: string;
    return_id: string;
    calculation: unknown;
    claude_analysis: string;
  }> {
    // Create session
    const session = this.createSession(userId);

    // Map input directly to answers structure
    const answers: Record<string, unknown> = {
      personal: {
        first_name: input.taxpayer.first_name,
        last_name: input.taxpayer.last_name,
        middle_name: input.taxpayer.middle_name,
        ssn: input.taxpayer.ssn,
        dob: input.taxpayer.dob,
        filing_status: input.taxpayer.filing_status,
        occupation: input.taxpayer.occupation,
        address_street: input.taxpayer.address_street,
        address_city: input.taxpayer.address_city,
        address_state: input.taxpayer.address_state,
        address_zip: input.taxpayer.address_zip,
        phone: input.taxpayer.phone,
        email: input.taxpayer.email,
        has_spouse_info: !!input.spouse,
        spouse_first_name: input.spouse?.first_name,
        spouse_last_name: input.spouse?.last_name,
        spouse_ssn: input.spouse?.ssn,
        spouse_dob: input.spouse?.dob,
        spouse_occupation: input.spouse?.occupation,
      },
      income: {} as Record<string, unknown>,
      deductions: { preference: 'auto' } as Record<string, unknown>,
      dependents: {} as Record<string, unknown>,
      credits: {} as Record<string, unknown>,
      payments: {} as Record<string, unknown>,
      state: { residence: input.taxpayer.address_state },
    };

    // Map income items
    if (input.income && input.income.length > 0) {
      const w2s = input.income.filter(i => i.type === 'w2' || i.type === 'wages');
      if (w2s.length > 0) {
        (answers.income as Record<string, unknown>).has_w2 = true;
        (answers.income as Record<string, unknown>).w2_count = w2s.length;
        (answers.income as Record<string, unknown>).w2_data = w2s.map(w => ({
          employer: w.payer || w.description,
          wages: w.amount,
          fed_withheld: w.withholding || 0,
          state: input.taxpayer.address_state,
          state_withheld: w.state_withholding || 0,
          ein: w.ein,
        }));
      }

      // Map other income types
      const bizItems = input.income.filter(i => ['business', 'self_employment', '1099-nec'].includes(i.type));
      if (bizItems.length > 0) {
        (answers.income as Record<string, unknown>).has_business = true;
        (answers.income as Record<string, unknown>).business_data = bizItems.map(b => ({
          name: b.payer || b.description || 'Self-Employment',
          gross_income: b.amount,
          expenses: 0,
          ein: b.ein,
        }));
      }

      const intItems = input.income.filter(i => i.type === 'interest' || i.type === '1099-int');
      if (intItems.length > 0) {
        (answers.income as Record<string, unknown>).has_1099_int = true;
        (answers.income as Record<string, unknown>).int_data = intItems.map(item => ({
          payer: item.payer, amount: item.amount,
        }));
      }

      const divItems = input.income.filter(i => i.type === 'dividends' || i.type === '1099-div');
      if (divItems.length > 0) {
        (answers.income as Record<string, unknown>).has_1099_div = true;
        (answers.income as Record<string, unknown>).div_data = divItems.map(item => ({
          payer: item.payer, ordinary: item.amount, qualified: 0,
        }));
      }
    }

    // Map deductions
    if (input.deductions && input.deductions.length > 0) {
      for (const ded of input.deductions) {
        const dedAnswers = answers.deductions as Record<string, unknown>;
        switch (ded.type) {
          case 'mortgage_interest':
            dedAnswers.has_mortgage = true;
            dedAnswers.mortgage_interest = ded.amount;
            break;
          case 'property_tax':
            dedAnswers.has_salt = true;
            dedAnswers.property_tax = ded.amount;
            break;
          case 'state_income_tax':
            dedAnswers.has_salt = true;
            dedAnswers.state_local_income_tax = ded.amount;
            break;
          case 'charitable':
          case 'charitable_cash':
            dedAnswers.has_charitable = true;
            dedAnswers.charitable_cash = ded.amount;
            break;
          case 'medical':
            dedAnswers.has_medical = true;
            dedAnswers.medical_amount = ded.amount;
            break;
          case 'student_loan':
            dedAnswers.has_student_loan = true;
            dedAnswers.student_loan_interest = ded.amount;
            break;
          case 'hsa':
            dedAnswers.has_hsa = true;
            dedAnswers.hsa_contributions = ded.amount;
            break;
          case 'ira':
            dedAnswers.has_ira = true;
            dedAnswers.ira_contributions = ded.amount;
            break;
        }
      }
    }

    // Map dependents
    if (input.dependents && input.dependents.length > 0) {
      (answers.dependents as Record<string, unknown>).has_dependents = true;
      (answers.dependents as Record<string, unknown>).count = input.dependents.length;
      (answers.dependents as Record<string, unknown>).data = input.dependents;
    }

    // Map estimated payments
    if (input.estimated_payments) {
      (answers.payments as Record<string, unknown>).has_estimated = true;
      (answers.payments as Record<string, unknown>).estimated_amount = input.estimated_payments;
    }

    session.answers = answers;
    session.phase = InterviewPhase.REVIEW_CALCULATE;
    session.status = 'reviewing';
    this.saveSession(session);

    // Build return from mapped answers
    await this.buildReturnFromAnswers(session, userId);

    // Run Claude analysis on the full return
    let claudeAnalysis = '';
    try {
      claudeAnalysis = await askClaude(
        `You are an expert CPA reviewing a completed tax return for accuracy and optimization opportunities. Provide a concise analysis covering:
1. Summary of the return
2. Any potential issues or red flags
3. Tax optimization suggestions
4. Filing recommendations`,
        `Tax return data:\n${JSON.stringify(answers, null, 2)}`,
      );
    } catch (err) {
      log.warn({ err }, 'Claude analysis failed for smart-prepare');
      claudeAnalysis = 'Claude analysis unavailable.';
    }

    // Calculate
    const calcResult = await this.runCalculation(session, userId);

    return {
      session_id: session.id,
      client_id: session.client_id!,
      return_id: calcResult.return_id,
      calculation: calcResult.calculation,
      claude_analysis: claudeAnalysis,
    };
  }

  // ── Ask Claude with Return Context ────────────────────────────────

  async askClaudeWithContext(
    session: PrepareSession,
    userQuestion: string,
  ): Promise<{ answer: string; engine_consulted: boolean }> {
    // Build context from session
    const context: Record<string, unknown> = {
      answers: session.answers,
      phase: session.phase,
      status: session.status,
      warnings: session.warnings,
    };

    if (session.return_id) {
      const taxReturn = this.db.prepare('SELECT * FROM tax_returns WHERE id = ?').get(session.return_id);
      const incomeItems = this.db.prepare('SELECT category, subcategory, amount FROM income_items WHERE return_id = ?').all(session.return_id);
      const deductionItems = this.db.prepare('SELECT category, subcategory, amount FROM deductions WHERE return_id = ?').all(session.return_id);
      context.tax_return = taxReturn;
      context.income_items = incomeItems;
      context.deductions = deductionItems;
    }

    // Consult relevant engine
    let engineConsulted = false;
    const engineResult = await queryEngineRuntime(TAX_ENGINES.TIE, userQuestion);
    if ((engineResult as Record<string, unknown>)?.success) {
      context.engine_guidance = engineResult;
      engineConsulted = true;
    }

    const answer = await askClaude(
      `You are an expert tax advisor with access to the taxpayer's return data and IRS doctrine engines. Answer the taxpayer's question accurately and helpfully, referencing their specific situation.

Return context:
${JSON.stringify(context, null, 2)}`,
      userQuestion,
    );

    session.claude_interactions.push(
      { role: 'user', content: userQuestion, timestamp: new Date().toISOString() },
      { role: 'assistant', content: answer, timestamp: new Date().toISOString() },
    );
    this.saveSession(session);

    return { answer, engine_consulted: engineConsulted };
  }

  // ── Consult Engine Directly ───────────────────────────────────────

  async consultEngine(
    session: PrepareSession,
    engineId: string,
    query: string,
  ): Promise<unknown> {
    const result = await queryEngineRuntime(engineId, query);

    session.engine_consultations.push({
      engine: engineId,
      query,
      response: result,
      timestamp: new Date().toISOString(),
      latency_ms: (result as Record<string, unknown>)?.latency_ms as number || 0,
    });
    this.saveSession(session);

    // Log to engine_queries table
    try {
      this.db.prepare(`
        INSERT INTO engine_queries (id, return_id, client_id, engine_id, query_text, response_json, response_layer, latency_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'doctrine_cache', ?, datetime('now'))
      `).run(
        crypto.randomUUID().replace(/-/g, ''),
        session.return_id,
        session.client_id,
        engineId,
        query,
        JSON.stringify(result),
        (result as Record<string, unknown>)?.latency_ms || 0,
      );
    } catch (err) {
      log.warn({ err }, 'Failed to log engine query');
    }

    return result;
  }
}
