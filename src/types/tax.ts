// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Core Type Definitions
// ═══════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

// ─── Filing Status ──────────────────────────────────────────────────────

export const FilingStatus = z.enum(['single', 'mfj', 'mfs', 'hoh', 'qss']);
export type FilingStatus = z.infer<typeof FilingStatus>;

export const ReturnType = z.enum(['1040', '1040SR', '1040NR', '1040X', '1120', '1120S', '1065', '1041', '990']);
export type ReturnType = z.infer<typeof ReturnType>;

export const ReturnStatus = z.enum([
  'draft', 'in_progress', 'review', 'calculated', 'locked', 'filed', 'accepted', 'rejected', 'amended',
]);
export type ReturnStatus = z.infer<typeof ReturnStatus>;

export const ConfidenceLevel = z.enum(['DEFENSIBLE', 'AGGRESSIVE', 'DISCLOSURE', 'HIGH_RISK']);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevel>;

export const SubscriptionTier = z.enum(['free', 'pro', 'business', 'professional', 'enterprise']);
export type SubscriptionTier = z.infer<typeof SubscriptionTier>;

// ─── Client ─────────────────────────────────────────────────────────────

export const CreateClientSchema = z.object({
  user_id: z.string().min(1),
  email: z.string().email().optional(),
  first_name: z.string().min(1),
  middle_name: z.string().optional(),
  last_name: z.string().min(1),
  suffix: z.string().optional(),
  ssn: z.string().regex(/^\d{9}$/).optional(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  phone: z.string().optional(),
  address_street: z.string().optional(),
  address_city: z.string().optional(),
  address_state: z.string().length(2).optional(),
  address_zip: z.string().regex(/^\d{5}(-\d{4})?$/).optional(),
  filing_status: FilingStatus.optional(),
  occupation: z.string().optional(),
  spouse_first_name: z.string().optional(),
  spouse_last_name: z.string().optional(),
  spouse_ssn: z.string().regex(/^\d{9}$/).optional(),
  spouse_dob: z.string().optional(),
  spouse_occupation: z.string().optional(),
  ip_pin: z.string().length(6).optional(),
});
export type CreateClientInput = z.infer<typeof CreateClientSchema>;

export interface Client {
  id: string;
  user_id: string;
  email: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  suffix: string | null;
  ssn_last4: string | null;
  dob: string | null;
  phone: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  filing_status: FilingStatus | null;
  occupation: string | null;
  spouse_first_name: string | null;
  spouse_last_name: string | null;
  spouse_ssn_last4: string | null;
  spouse_dob: string | null;
  spouse_occupation: string | null;
  ip_pin: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Tax Return ─────────────────────────────────────────────────────────

export const CreateReturnSchema = z.object({
  client_id: z.string().min(1),
  tax_year: z.number().int().min(2020).max(2030),
  return_type: ReturnType.default('1040'),
});
export type CreateReturnInput = z.infer<typeof CreateReturnSchema>;

export interface TaxReturn {
  id: string;
  client_id: string;
  tax_year: number;
  status: ReturnStatus;
  return_type: ReturnType;
  total_income: number;
  adjusted_gross_income: number;
  total_adjustments: number;
  taxable_income: number;
  total_tax: number;
  total_credits: number;
  total_payments: number;
  total_withholding: number;
  estimated_payments: number;
  refund_or_owed: number;
  effective_rate: number;
  marginal_rate: number;
  deduction_method: 'standard' | 'itemized' | null;
  standard_deduction_amount: number;
  itemized_deduction_amount: number;
  self_employment_tax: number;
  amt_amount: number;
  niit_amount: number;
  qbi_deduction: number;
  preparer_ptin: string | null;
  preparer_name: string | null;
  firm_ein: string | null;
  firm_name: string | null;
  efile_submission_id: string | null;
  efile_status: string | null;
  efile_accepted_at: string | null;
  efile_rejection_codes: string | null;
  self_select_pin: string | null;
  form_8879_signed: boolean;
  locked_at: string | null;
  filed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Income ─────────────────────────────────────────────────────────────

export const IncomeCategory = z.enum([
  'wages', 'salary', 'tips', 'interest', 'dividends', 'qualified_dividends',
  'business', 'capital_gains', 'capital_gains_short', 'capital_gains_long',
  'rental', 'royalty', 'partnership', 's_corp', 'trust', 'farm',
  'unemployment', 'social_security', 'pension', 'annuity', 'ira_distribution',
  'alimony', 'gambling', 'other', 'crypto', 'staking', 'mining',
  'nec_1099', 'misc_1099', 'state_refund', 'foreign',
]);
export type IncomeCategory = z.infer<typeof IncomeCategory>;

export const CreateIncomeSchema = z.object({
  category: IncomeCategory,
  subcategory: z.string().optional(),
  description: z.string().optional(),
  payer_name: z.string().optional(),
  payer_ein: z.string().optional(),
  amount: z.number(),
  tax_withheld: z.number().default(0),
  state_withheld: z.number().default(0),
  local_withheld: z.number().default(0),
  form_type: z.string().optional(),
  state: z.string().length(2).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type CreateIncomeInput = z.infer<typeof CreateIncomeSchema>;

export interface IncomeItem {
  id: string;
  return_id: string;
  category: IncomeCategory;
  subcategory: string | null;
  description: string | null;
  payer_name: string | null;
  payer_ein: string | null;
  amount: number;
  tax_withheld: number;
  state_withheld: number;
  local_withheld: number;
  form_type: string | null;
  form_line: string | null;
  state: string | null;
  document_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ─── Deductions ─────────────────────────────────────────────────────────

export const DeductionCategory = z.enum([
  'mortgage_interest', 'state_local_taxes', 'property_taxes', 'charitable_cash',
  'charitable_noncash', 'medical', 'student_loan_interest', 'educator_expense',
  'hsa_contribution', 'ira_contribution', 'self_employment_tax_deduction',
  'self_employment_health', 'home_office', 'vehicle', 'depreciation',
  'business_expense', 'investment_expense', 'casualty_loss', 'gambling_loss',
  'alimony_paid', 'moving_expense_military', 'penalty_early_withdrawal',
  'other_itemized', 'other_above_line',
]);
export type DeductionCategory = z.infer<typeof DeductionCategory>;

export const CreateDeductionSchema = z.object({
  category: DeductionCategory,
  subcategory: z.string().optional(),
  description: z.string().optional(),
  amount: z.number().min(0),
  schedule: z.string().optional(),
  carryover_amount: z.number().default(0),
  carryover_year: z.number().int().optional(),
});
export type CreateDeductionInput = z.infer<typeof CreateDeductionSchema>;

export interface Deduction {
  id: string;
  return_id: string;
  category: DeductionCategory;
  subcategory: string | null;
  description: string | null;
  amount: number;
  limited_amount: number | null;
  schedule: string | null;
  form_line: string | null;
  carryover_amount: number;
  carryover_year: number | null;
  document_id: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Dependents ─────────────────────────────────────────────────────────

export const CreateDependentSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  ssn: z.string().regex(/^\d{9}$/).optional(),
  relationship: z.string().min(1),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  months_lived: z.number().int().min(0).max(12).default(12),
  student: z.boolean().default(false),
  disabled: z.boolean().default(false),
  gross_income: z.number().default(0),
});
export type CreateDependentInput = z.infer<typeof CreateDependentSchema>;

export interface Dependent {
  id: string;
  return_id: string;
  first_name: string | null;
  last_name: string | null;
  ssn_last4: string | null;
  relationship: string | null;
  dob: string | null;
  months_lived: number;
  student: boolean;
  disabled: boolean;
  gross_income: number;
  qualifies_ctc: boolean;
  qualifies_odc: boolean;
  qualifies_eic: boolean;
  qualifies_dependent_care: boolean;
  created_at: string;
}

// ─── Engine Types ───────────────────────────────────────────────────────

export const EngineId = z.enum([
  'TIE', 'PIE', 'ARCS', 'FIE', 'STE', 'BIE', 'CRE', 'DEP',
  'EST', 'CRY', 'INT', 'AUD', 'PLN', 'LEG', 'RET',
]);
export type EngineId = z.infer<typeof EngineId>;

export const EngineQuerySchema = z.object({
  query: z.string().min(1),
  engine_id: EngineId.optional(),
  return_id: z.string().optional(),
  context: z.record(z.unknown()).optional(),
  force_claude: z.boolean().default(false),
});
export type EngineQueryInput = z.infer<typeof EngineQuerySchema>;

export interface EngineResponse {
  engine_id: EngineId;
  analysis: string;
  citations: string[];
  confidence: ConfidenceLevel;
  authority: string[];
  risk_level: number;
  reasoning_chain: string[];
  counter_arguments: string[];
  documentation_needed: string[];
  response_layer: 'doctrine_cache' | 'semantic' | 'claude_deep';
  latency_ms: number;
}

export interface DoctrineBlock {
  id: string;
  engine_id: EngineId;
  topic: string;
  keywords: string[];
  conclusion_template: string[];
  reasoning_framework: string[];
  key_factors: string[];
  primary_authority: string[];
  burden_holder: string;
  adversary_position: string;
  counter_arguments: string[];
  resolution_strategy: string;
  entity_scope: string;
  confidence: ConfidenceLevel;
  confidence_stratification: string;
  controlling_precedent: string;
}

// ─── Tax Calculation Types ──────────────────────────────────────────────

export interface TaxBracket {
  min: number;
  max: number;
  rate: number;
  base_tax: number;
}

export interface TaxCalculationResult {
  total_income: number;
  adjustments: number;
  adjusted_gross_income: number;
  deduction_method: 'standard' | 'itemized';
  deduction_amount: number;
  qbi_deduction: number;
  taxable_income: number;
  ordinary_tax: number;
  capital_gains_tax: number;
  self_employment_tax: number;
  amt: number;
  niit: number;
  total_tax: number;
  credits: CreditSummary;
  total_credits: number;
  total_payments: number;
  refund_or_owed: number;
  effective_rate: number;
  marginal_rate: number;
  forms_generated: string[];
  warnings: string[];
  optimization_suggestions: string[];
}

export interface CreditSummary {
  child_tax_credit: number;
  other_dependent_credit: number;
  earned_income_credit: number;
  education_credits: number;
  child_care_credit: number;
  saver_credit: number;
  foreign_tax_credit: number;
  energy_credits: number;
  other_credits: number;
  total: number;
}

// ─── API Response Types ─────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    latency_ms?: number;
  };
}

export interface PaginationParams {
  page: number;
  limit: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime_seconds: number;
  services: {
    database: 'up' | 'down';
    cache: 'up' | 'down';
    engines: Record<string, 'up' | 'down'>;
    claude: 'up' | 'down';
    storage: 'up' | 'down';
  };
  timestamp: string;
}
