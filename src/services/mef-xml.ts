// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — MeF XML Generation Service
// IRS Modernized e-File (MeF) XML document generation
// ═══════════════════════════════════════════════════════════════════════════

import { Database } from 'bun:sqlite';
import { getById } from './database';
import { createLogger } from '../utils/logger';

const log = createLogger('mef-xml');

const MEF_NAMESPACE = 'http://www.irs.gov/efile';
const RETURN_VERSION = '2025v1.0';
const SOFTWARE_ID = 'ETRU';
const SOFTWARE_VERSION = '1.0.0';

// ─── XML Escaping ──────────────────────────────────────────────────────

export function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── Filing Status Mapping ─────────────────────────────────────────────

export function filingStatusToCode(status: string): string {
  const map: Record<string, string> = {
    single: '1',
    mfj: '2',
    married_filing_jointly: '2',
    mfs: '3',
    married_filing_separately: '3',
    hoh: '4',
    head_of_household: '4',
    qss: '5',
    qualifying_surviving_spouse: '5',
  };
  return map[status?.toLowerCase()] || '1';
}

// ─── Helper: Format Amount ─────────────────────────────────────────────

function amt(value: unknown): string {
  const num = Number(value) || 0;
  return Math.round(num).toString();
}

function formatSSN(ssn: string): string {
  if (!ssn) return '000-00-0000';
  const digits = ssn.replace(/\D/g, '');
  if (digits.length !== 9) return escapeXml(ssn);
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return escapeXml(dateStr || '');
  return d.toISOString().split('T')[0];
}

// ─── IRS 1040 XML Generation ──────────────────────────────────────────

export function generateIRS1040XML(
  returnData: Record<string, unknown>,
  clientData: Record<string, unknown>,
  incomeItems: Record<string, unknown>[],
  deductions: Record<string, unknown>[],
  dependents: Record<string, unknown>[],
): string {
  // Aggregate income by type
  const incomeByType: Record<string, number> = {};
  for (const item of incomeItems) {
    const type = (item.category as string) || 'other';
    incomeByType[type] = (incomeByType[type] || 0) + (Number(item.amount) || 0);
  }

  const wages = incomeByType['w2'] || incomeByType['wages'] || 0;
  const taxExemptInterest = incomeByType['tax_exempt_interest'] || 0;
  const taxableInterest = incomeByType['interest'] || incomeByType['1099_int'] || 0;
  const qualifiedDividends = incomeByType['qualified_dividends'] || 0;
  const ordinaryDividends = incomeByType['dividends'] || incomeByType['1099_div'] || 0;
  const capitalGains = incomeByType['capital_gains'] || incomeByType['1099_b'] || 0;
  const businessIncome = incomeByType['self_employment'] || incomeByType['1099_nec'] || incomeByType['schedule_c'] || 0;
  const otherIncome = incomeByType['other'] || 0;

  const totalIncome = Number(returnData.total_income) || 0;
  const agi = Number(returnData.adjusted_gross_income) || 0;
  const standardOrItemized = Number(returnData.standard_or_itemized_deduction) || Number(returnData.total_deductions) || 0;
  const qbiDeduction = Number(returnData.qbi_deduction) || 0;
  const taxableIncome = Number(returnData.taxable_income) || 0;
  const taxAmount = Number(returnData.tax_amount) || Number(returnData.total_tax) || 0;
  const totalCredits = Number(returnData.total_credits) || 0;
  const totalTax = Number(returnData.total_tax) || 0;
  const totalPayments = Number(returnData.total_payments) || 0;
  const refundOrOwed = Number(returnData.refund_or_owed) || 0;

  const overpaid = refundOrOwed > 0 ? refundOrOwed : 0;
  const owed = refundOrOwed < 0 ? Math.abs(refundOrOwed) : 0;
  const refund = overpaid;

  // Dependents XML
  let dependentsXml = '';
  if (dependents.length > 0) {
    dependentsXml = '\n      <efile:DependentDetail>';
    for (const dep of dependents) {
      dependentsXml += `
        <efile:DependentInformation>
          <efile:DependentFirstNm>${escapeXml(dep.first_name as string || '')}</efile:DependentFirstNm>
          <efile:DependentLastNm>${escapeXml(dep.last_name as string || '')}</efile:DependentLastNm>
          <efile:DependentSSN>${formatSSN(dep.ssn_encrypted as string || '')}</efile:DependentSSN>
          <efile:DependentRelationshipCd>${escapeXml(dep.relationship as string || 'DAUGHTER')}</efile:DependentRelationshipCd>
          <efile:EligibleForChildTaxCreditInd>${dep.eligible_child_tax_credit ? 'X' : ''}</efile:EligibleForChildTaxCreditInd>
        </efile:DependentInformation>`;
    }
    dependentsXml += '\n      </efile:DependentDetail>';
  }

  return `    <efile:IRS1040>
      <efile:IndividualReturnFilingStatusCd>${filingStatusToCode(clientData.filing_status as string)}</efile:IndividualReturnFilingStatusCd>${dependentsXml}
      <efile:WagesSalariesAndTipsAmt>${amt(wages)}</efile:WagesSalariesAndTipsAmt>
      <efile:TaxExemptInterestAmt>${amt(taxExemptInterest)}</efile:TaxExemptInterestAmt>
      <efile:TaxableInterestAmt>${amt(taxableInterest)}</efile:TaxableInterestAmt>
      <efile:QualifiedDividendsAmt>${amt(qualifiedDividends)}</efile:QualifiedDividendsAmt>
      <efile:OrdinaryDividendsAmt>${amt(ordinaryDividends)}</efile:OrdinaryDividendsAmt>
      <efile:CapitalGainOrLossAmt>${amt(capitalGains)}</efile:CapitalGainOrLossAmt>
      <efile:OtherIncomeAmt>${amt(otherIncome)}</efile:OtherIncomeAmt>
      <efile:TotalIncomeAmt>${amt(totalIncome)}</efile:TotalIncomeAmt>
      <efile:AdjustedGrossIncomeAmt>${amt(agi)}</efile:AdjustedGrossIncomeAmt>
      <efile:TotalItemizedOrStandardDedAmt>${amt(standardOrItemized)}</efile:TotalItemizedOrStandardDedAmt>
      <efile:QualifiedBusinessIncomeDedAmt>${amt(qbiDeduction)}</efile:QualifiedBusinessIncomeDedAmt>
      <efile:TaxableIncomeAmt>${amt(taxableIncome)}</efile:TaxableIncomeAmt>
      <efile:TaxAmt>${amt(taxAmount)}</efile:TaxAmt>
      <efile:TotalCreditsAmt>${amt(totalCredits)}</efile:TotalCreditsAmt>
      <efile:TotalTaxAmt>${amt(totalTax)}</efile:TotalTaxAmt>
      <efile:TotalPaymentsAmt>${amt(totalPayments)}</efile:TotalPaymentsAmt>
      <efile:OverpaidAmt>${amt(overpaid)}</efile:OverpaidAmt>
      <efile:OwedAmt>${amt(owed)}</efile:OwedAmt>
      <efile:RefundAmt>${amt(refund)}</efile:RefundAmt>
    </efile:IRS1040>`;
}

// ─── Schedule XML Generation ──────────────────────────────────────────

export function generateScheduleXML(scheduleName: string, data: Record<string, unknown>): string {
  const scheduleGenerators: Record<string, (d: Record<string, unknown>) => string> = {
    '1': generateSchedule1,
    '2': generateSchedule2,
    '3': generateSchedule3,
    'A': generateScheduleA,
    'B': generateScheduleB,
    'C': generateScheduleC,
    'D': generateScheduleD,
    'SE': generateScheduleSE,
  };

  const generator = scheduleGenerators[scheduleName.toUpperCase().replace('SCHEDULE_', '').replace('SCHEDULE', '')];
  if (!generator) {
    log.warn({ scheduleName }, 'Unknown schedule requested');
    return `    <!-- Schedule ${escapeXml(scheduleName)} not implemented -->`;
  }

  return generator(data);
}

function generateSchedule1(data: Record<string, unknown>): string {
  return `    <efile:IRS1040Schedule1>
      <efile:BusinessIncomeLossAmt>${amt(data.business_income)}</efile:BusinessIncomeLossAmt>
      <efile:RentalRealEstateIncomeLossAmt>${amt(data.rental_income)}</efile:RentalRealEstateIncomeLossAmt>
      <efile:FarmIncomeLossAmt>${amt(data.farm_income)}</efile:FarmIncomeLossAmt>
      <efile:UnemploymentCompAmt>${amt(data.unemployment_compensation)}</efile:UnemploymentCompAmt>
      <efile:SocialSecurityBenefitsAmt>${amt(data.social_security_benefits)}</efile:SocialSecurityBenefitsAmt>
      <efile:OtherIncomeAmt>${amt(data.other_income)}</efile:OtherIncomeAmt>
      <efile:TotalAdditionalIncomeAmt>${amt(data.total_additional_income)}</efile:TotalAdditionalIncomeAmt>
      <efile:EducatorExpensesAmt>${amt(data.educator_expenses)}</efile:EducatorExpensesAmt>
      <efile:DeductibleSelfEmploymentTaxAmt>${amt(data.self_employment_tax_deduction)}</efile:DeductibleSelfEmploymentTaxAmt>
      <efile:SelfEmpldHealthInsDedAmt>${amt(data.self_employed_health_insurance)}</efile:SelfEmpldHealthInsDedAmt>
      <efile:IRADeductionAmt>${amt(data.ira_deduction)}</efile:IRADeductionAmt>
      <efile:StudentLoanInterestDedAmt>${amt(data.student_loan_interest)}</efile:StudentLoanInterestDedAmt>
      <efile:HsaDeductionAmt>${amt(data.hsa_deduction)}</efile:HsaDeductionAmt>
      <efile:TotalAdjustmentsAmt>${amt(data.total_adjustments)}</efile:TotalAdjustmentsAmt>
    </efile:IRS1040Schedule1>`;
}

function generateSchedule2(data: Record<string, unknown>): string {
  return `    <efile:IRS1040Schedule2>
      <efile:AMTAmt>${amt(data.amt_amount)}</efile:AMTAmt>
      <efile:ExcessPremiumTaxCreditAmt>${amt(data.excess_ptc_repayment)}</efile:ExcessPremiumTaxCreditAmt>
      <efile:SelfEmploymentTaxAmt>${amt(data.self_employment_tax)}</efile:SelfEmploymentTaxAmt>
      <efile:UnreportedSocSecAndMedicareTaxAmt>${amt(data.unreported_ss_medicare)}</efile:UnreportedSocSecAndMedicareTaxAmt>
      <efile:AdditionalTaxOnIRAAmt>${amt(data.additional_tax_ira)}</efile:AdditionalTaxOnIRAAmt>
      <efile:HouseholdEmploymentTaxAmt>${amt(data.household_employment_tax)}</efile:HouseholdEmploymentTaxAmt>
      <efile:FirstTimePenaltyAmt>${amt(data.first_time_penalty)}</efile:FirstTimePenaltyAmt>
      <efile:TotalAdditionalTaxAmt>${amt(data.total_additional_tax)}</efile:TotalAdditionalTaxAmt>
    </efile:IRS1040Schedule2>`;
}

function generateSchedule3(data: Record<string, unknown>): string {
  return `    <efile:IRS1040Schedule3>
      <efile:ForeignTaxCreditAmt>${amt(data.foreign_tax_credit)}</efile:ForeignTaxCreditAmt>
      <efile:ChildDependentCareCreditAmt>${amt(data.child_dependent_care_credit)}</efile:ChildDependentCareCreditAmt>
      <efile:EducationCreditAmt>${amt(data.education_credit)}</efile:EducationCreditAmt>
      <efile:RetirementSavingsContCreditAmt>${amt(data.retirement_savings_credit)}</efile:RetirementSavingsContCreditAmt>
      <efile:ResidentialEnergyCreditsAmt>${amt(data.residential_energy_credit)}</efile:ResidentialEnergyCreditsAmt>
      <efile:OtherCreditsAmt>${amt(data.other_credits)}</efile:OtherCreditsAmt>
      <efile:TotalCreditsAmt>${amt(data.total_credits)}</efile:TotalCreditsAmt>
      <efile:EstimatedTaxPaymentsAmt>${amt(data.estimated_tax_payments)}</efile:EstimatedTaxPaymentsAmt>
      <efile:NetPremiumTaxCreditAmt>${amt(data.net_premium_tax_credit)}</efile:NetPremiumTaxCreditAmt>
      <efile:AmtPaidWithExtensionAmt>${amt(data.amount_paid_with_extension)}</efile:AmtPaidWithExtensionAmt>
      <efile:ExcessSocSecTaxWithheldAmt>${amt(data.excess_ss_tax_withheld)}</efile:ExcessSocSecTaxWithheldAmt>
      <efile:TotalOtherPaymentsAmt>${amt(data.total_other_payments)}</efile:TotalOtherPaymentsAmt>
    </efile:IRS1040Schedule3>`;
}

function generateScheduleA(data: Record<string, unknown>): string {
  return `    <efile:IRS1040ScheduleA>
      <efile:MedicalAndDentalExpensesAmt>${amt(data.medical_dental_expenses)}</efile:MedicalAndDentalExpensesAmt>
      <efile:AGIForMedicalAndDentalAmt>${amt(data.agi_for_medical)}</efile:AGIForMedicalAndDentalAmt>
      <efile:CalculatedMedicalAndDentalAmt>${amt(data.calculated_medical)}</efile:CalculatedMedicalAndDentalAmt>
      <efile:StateAndLocalTaxesAmt>${amt(data.state_local_taxes)}</efile:StateAndLocalTaxesAmt>
      <efile:RealEstateTaxesAmt>${amt(data.real_estate_taxes)}</efile:RealEstateTaxesAmt>
      <efile:PersonalPropertyTaxesAmt>${amt(data.personal_property_taxes)}</efile:PersonalPropertyTaxesAmt>
      <efile:TotalTaxesPaidAmt>${amt(data.total_taxes_paid)}</efile:TotalTaxesPaidAmt>
      <efile:SALTCapAmt>${amt(data.salt_cap || 10000)}</efile:SALTCapAmt>
      <efile:HomeMortgageInterestAmt>${amt(data.home_mortgage_interest)}</efile:HomeMortgageInterestAmt>
      <efile:InvestmentInterestAmt>${amt(data.investment_interest)}</efile:InvestmentInterestAmt>
      <efile:TotalInterestPaidAmt>${amt(data.total_interest_paid)}</efile:TotalInterestPaidAmt>
      <efile:CashCharitableContributionsAmt>${amt(data.cash_charitable)}</efile:CashCharitableContributionsAmt>
      <efile:NonCashCharitableContributionsAmt>${amt(data.noncash_charitable)}</efile:NonCashCharitableContributionsAmt>
      <efile:CarryoverCharitableContributionsAmt>${amt(data.carryover_charitable)}</efile:CarryoverCharitableContributionsAmt>
      <efile:TotalCharitableContributionsAmt>${amt(data.total_charitable)}</efile:TotalCharitableContributionsAmt>
      <efile:CasualtyAndTheftLossesAmt>${amt(data.casualty_theft_losses)}</efile:CasualtyAndTheftLossesAmt>
      <efile:OtherItemizedDeductionsAmt>${amt(data.other_itemized)}</efile:OtherItemizedDeductionsAmt>
      <efile:TotalItemizedDeductionsAmt>${amt(data.total_itemized_deductions)}</efile:TotalItemizedDeductionsAmt>
    </efile:IRS1040ScheduleA>`;
}

function generateScheduleB(data: Record<string, unknown>): string {
  const interestItems = (data.interest_items as Array<Record<string, unknown>>) || [];
  const dividendItems = (data.dividend_items as Array<Record<string, unknown>>) || [];

  let interestXml = '';
  for (const item of interestItems) {
    interestXml += `
        <efile:InterestIncomeDetail>
          <efile:PayerName>${escapeXml(item.payer_name as string || '')}</efile:PayerName>
          <efile:InterestAmt>${amt(item.amount)}</efile:InterestAmt>
        </efile:InterestIncomeDetail>`;
  }

  let dividendXml = '';
  for (const item of dividendItems) {
    dividendXml += `
        <efile:OrdinaryDividendDetail>
          <efile:PayerName>${escapeXml(item.payer_name as string || '')}</efile:PayerName>
          <efile:OrdinaryDividendAmt>${amt(item.amount)}</efile:OrdinaryDividendAmt>
        </efile:OrdinaryDividendDetail>`;
  }

  return `    <efile:IRS1040ScheduleB>
      <efile:PartI_Interest>${interestXml}
        <efile:TotalInterestAmt>${amt(data.total_interest)}</efile:TotalInterestAmt>
      </efile:PartI_Interest>
      <efile:PartII_Dividends>${dividendXml}
        <efile:TotalOrdinaryDividendsAmt>${amt(data.total_dividends)}</efile:TotalOrdinaryDividendsAmt>
      </efile:PartII_Dividends>
      <efile:ForeignAccountsInd>${data.has_foreign_accounts ? 'true' : 'false'}</efile:ForeignAccountsInd>
      <efile:ForeignTrustInd>${data.has_foreign_trust ? 'true' : 'false'}</efile:ForeignTrustInd>
    </efile:IRS1040ScheduleB>`;
}

function generateScheduleC(data: Record<string, unknown>): string {
  return `    <efile:IRS1040ScheduleC>
      <efile:BusinessNameLine1Txt>${escapeXml(data.business_name as string || '')}</efile:BusinessNameLine1Txt>
      <efile:PrincipalBusinessActivityCd>${escapeXml(data.activity_code as string || '')}</efile:PrincipalBusinessActivityCd>
      <efile:BusinessActivityDesc>${escapeXml(data.business_description as string || '')}</efile:BusinessActivityDesc>
      <efile:EIN>${escapeXml(data.business_ein as string || '')}</efile:EIN>
      <efile:AccountingMethodCd>${escapeXml(data.accounting_method as string || 'Cash')}</efile:AccountingMethodCd>
      <efile:GrossReceiptsAmt>${amt(data.gross_receipts)}</efile:GrossReceiptsAmt>
      <efile:ReturnsAndAllowancesAmt>${amt(data.returns_allowances)}</efile:ReturnsAndAllowancesAmt>
      <efile:CostOfGoodsSoldAmt>${amt(data.cost_of_goods_sold)}</efile:CostOfGoodsSoldAmt>
      <efile:GrossProfitAmt>${amt(data.gross_profit)}</efile:GrossProfitAmt>
      <efile:OtherBusinessIncomeAmt>${amt(data.other_business_income)}</efile:OtherBusinessIncomeAmt>
      <efile:GrossBusinessIncomeAmt>${amt(data.gross_business_income)}</efile:GrossBusinessIncomeAmt>
      <efile:AdvertisingAmt>${amt(data.advertising)}</efile:AdvertisingAmt>
      <efile:CarAndTruckExpensesAmt>${amt(data.car_truck_expenses)}</efile:CarAndTruckExpensesAmt>
      <efile:CommissionsAndFeesAmt>${amt(data.commissions_fees)}</efile:CommissionsAndFeesAmt>
      <efile:ContractLaborAmt>${amt(data.contract_labor)}</efile:ContractLaborAmt>
      <efile:DepreciationAmt>${amt(data.depreciation)}</efile:DepreciationAmt>
      <efile:InsuranceAmt>${amt(data.insurance)}</efile:InsuranceAmt>
      <efile:InterestExpenseAmt>${amt(data.interest_expense)}</efile:InterestExpenseAmt>
      <efile:LegalAndProfessionalAmt>${amt(data.legal_professional)}</efile:LegalAndProfessionalAmt>
      <efile:OfficeExpenseAmt>${amt(data.office_expense)}</efile:OfficeExpenseAmt>
      <efile:RentOrLeaseAmt>${amt(data.rent_lease)}</efile:RentOrLeaseAmt>
      <efile:RepairsAndMaintenanceAmt>${amt(data.repairs_maintenance)}</efile:RepairsAndMaintenanceAmt>
      <efile:SuppliesAmt>${amt(data.supplies)}</efile:SuppliesAmt>
      <efile:TaxesAndLicensesAmt>${amt(data.taxes_licenses)}</efile:TaxesAndLicensesAmt>
      <efile:TravelAmt>${amt(data.travel)}</efile:TravelAmt>
      <efile:MealsAmt>${amt(data.meals)}</efile:MealsAmt>
      <efile:UtilitiesAmt>${amt(data.utilities)}</efile:UtilitiesAmt>
      <efile:WagesAmt>${amt(data.wages_paid)}</efile:WagesAmt>
      <efile:OtherExpensesAmt>${amt(data.other_expenses)}</efile:OtherExpensesAmt>
      <efile:TotalExpensesAmt>${amt(data.total_expenses)}</efile:TotalExpensesAmt>
      <efile:NetProfitOrLossAmt>${amt(data.net_profit_loss)}</efile:NetProfitOrLossAmt>
    </efile:IRS1040ScheduleC>`;
}

function generateScheduleD(data: Record<string, unknown>): string {
  return `    <efile:IRS1040ScheduleD>
      <efile:ShortTermTotalGainLossAmt>${amt(data.short_term_total)}</efile:ShortTermTotalGainLossAmt>
      <efile:ShortTermFromForm8949Amt>${amt(data.short_term_8949)}</efile:ShortTermFromForm8949Amt>
      <efile:ShortTermCapitalGainDistAmt>${amt(data.short_term_distributions)}</efile:ShortTermCapitalGainDistAmt>
      <efile:NetShortTermCapitalGainLossAmt>${amt(data.net_short_term)}</efile:NetShortTermCapitalGainLossAmt>
      <efile:LongTermTotalGainLossAmt>${amt(data.long_term_total)}</efile:LongTermTotalGainLossAmt>
      <efile:LongTermFromForm8949Amt>${amt(data.long_term_8949)}</efile:LongTermFromForm8949Amt>
      <efile:LongTermCapitalGainDistAmt>${amt(data.long_term_distributions)}</efile:LongTermCapitalGainDistAmt>
      <efile:NetLongTermCapitalGainLossAmt>${amt(data.net_long_term)}</efile:NetLongTermCapitalGainLossAmt>
      <efile:NetCapitalGainOrLossAmt>${amt(data.net_capital_gain_loss)}</efile:NetCapitalGainOrLossAmt>
    </efile:IRS1040ScheduleD>`;
}

function generateScheduleSE(data: Record<string, unknown>): string {
  const netEarnings = Number(data.net_earnings) || Number(data.net_profit_loss) || 0;
  const seTaxRate = 0.9235;
  const socialSecurityRate = 0.124;
  const medicareRate = 0.029;
  const socialSecurityWageBase = 168600; // 2025 wage base
  const seEarnings = Math.round(netEarnings * seTaxRate);
  const socialSecurityTax = Math.min(seEarnings, socialSecurityWageBase) * socialSecurityRate;
  const medicareTax = seEarnings * medicareRate;
  const totalSETax = Math.round(socialSecurityTax + medicareTax);
  const deductibleHalf = Math.round(totalSETax / 2);

  return `    <efile:IRS1040ScheduleSE>
      <efile:NetEarningsFromSelfEmplAmt>${amt(netEarnings)}</efile:NetEarningsFromSelfEmplAmt>
      <efile:SelfEmploymentEarningsAmt>${amt(seEarnings)}</efile:SelfEmploymentEarningsAmt>
      <efile:SocialSecurityTaxAmt>${amt(socialSecurityTax)}</efile:SocialSecurityTaxAmt>
      <efile:MedicareTaxAmt>${amt(medicareTax)}</efile:MedicareTaxAmt>
      <efile:SelfEmploymentTaxAmt>${amt(data.self_employment_tax || totalSETax)}</efile:SelfEmploymentTaxAmt>
      <efile:DeductibleSelfEmploymentTaxAmt>${amt(data.se_tax_deduction || deductibleHalf)}</efile:DeductibleSelfEmploymentTaxAmt>
    </efile:IRS1040ScheduleSE>`;
}

// ─── Determine Required Schedules ─────────────────────────────────────

function determineSchedules(
  returnData: Record<string, unknown>,
  incomeItems: Record<string, unknown>[],
  deductions: Record<string, unknown>[],
): string[] {
  const schedules: string[] = [];

  // Schedule 1: Additional income or adjustments
  const hasBusinessIncome = incomeItems.some(i =>
    ['self_employment', '1099_nec', 'schedule_c', 'rental', 'farm', 'unemployment'].includes(i.category as string),
  );
  const hasAdjustments = Number(returnData.total_adjustments) > 0 ||
    Number(returnData.student_loan_interest) > 0 ||
    Number(returnData.ira_deduction) > 0 ||
    Number(returnData.hsa_deduction) > 0;
  if (hasBusinessIncome || hasAdjustments) schedules.push('1');

  // Schedule 2: Additional taxes (AMT, SE tax, etc.)
  if (Number(returnData.self_employment_tax) > 0 || Number(returnData.amt_amount) > 0) {
    schedules.push('2');
  }

  // Schedule 3: Additional credits and payments
  if (Number(returnData.estimated_tax_payments) > 0 ||
    Number(returnData.foreign_tax_credit) > 0 ||
    Number(returnData.education_credit) > 0) {
    schedules.push('3');
  }

  // Schedule A: Itemized deductions
  const hasItemized = deductions.some(d => d.category === 'itemized') ||
    Number(returnData.total_itemized_deductions) > 0;
  if (hasItemized) schedules.push('A');

  // Schedule B: Interest and dividends over $1,500
  const totalInterest = incomeItems
    .filter(i => ['interest', '1099_int'].includes(i.category as string))
    .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  const totalDividends = incomeItems
    .filter(i => ['dividends', '1099_div'].includes(i.category as string))
    .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  if (totalInterest > 1500 || totalDividends > 1500) schedules.push('B');

  // Schedule C: Business income
  if (incomeItems.some(i => ['self_employment', '1099_nec', 'schedule_c'].includes(i.category as string))) {
    schedules.push('C');
  }

  // Schedule D: Capital gains
  if (incomeItems.some(i => ['capital_gains', '1099_b'].includes(i.category as string))) {
    schedules.push('D');
  }

  // Schedule SE: Self-employment tax
  if (incomeItems.some(i => ['self_employment', '1099_nec', 'schedule_c'].includes(i.category as string))) {
    schedules.push('SE');
  }

  return [...new Set(schedules)];
}

// ─── MeF XML Structural Validation ───────────────────────────────────

export function validateMeFXML(xml: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // XML declaration
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) {
    errors.push('Missing or malformed XML declaration');
  }

  // Root element
  if (!xml.includes('<efile:Return')) {
    errors.push('Missing root <efile:Return> element');
  }
  if (!xml.includes('</efile:Return>')) {
    errors.push('Missing closing </efile:Return> element');
  }

  // Namespace
  if (!xml.includes(`xmlns:efile="${MEF_NAMESPACE}"`)) {
    errors.push(`Missing MeF namespace declaration (${MEF_NAMESPACE})`);
  }

  // Return version
  if (!xml.includes('returnVersion="')) {
    errors.push('Missing returnVersion attribute');
  }

  // Return header
  if (!xml.includes('<efile:ReturnHeader>')) {
    errors.push('Missing <efile:ReturnHeader> element');
  }
  if (!xml.includes('</efile:ReturnHeader>')) {
    errors.push('Missing closing </efile:ReturnHeader> element');
  }

  // Required header elements
  const requiredHeaderElements = [
    'ReturnTs', 'TaxYr', 'TaxPeriodBeginDt', 'TaxPeriodEndDt',
    'SoftwareId', 'SoftwareVersionNum', 'Filer',
  ];
  for (const el of requiredHeaderElements) {
    if (!xml.includes(`<efile:${el}>`) && !xml.includes(`<efile:${el} `)) {
      errors.push(`Missing required header element: <efile:${el}>`);
    }
  }

  // Filer sub-elements
  if (!xml.includes('<efile:PrimarySSN>')) {
    errors.push('Missing <efile:PrimarySSN> in Filer');
  }

  // Return data
  if (!xml.includes('<efile:ReturnData>')) {
    errors.push('Missing <efile:ReturnData> element');
  }
  if (!xml.includes('</efile:ReturnData>')) {
    errors.push('Missing closing </efile:ReturnData> element');
  }

  // IRS1040
  if (!xml.includes('<efile:IRS1040>')) {
    errors.push('Missing <efile:IRS1040> element in ReturnData');
  }

  // Filing status
  if (!xml.includes('<efile:FilingStatusCd>') && !xml.includes('<efile:IndividualReturnFilingStatusCd>')) {
    errors.push('Missing filing status code');
  }

  // Well-formed check: count opening vs closing tags
  const openTags = (xml.match(/<efile:\w+[^/]*>/g) || []).length;
  const closeTags = (xml.match(/<\/efile:\w+>/g) || []).length;
  const selfClosing = (xml.match(/<efile:\w+[^>]*\/>/g) || []).length;
  if (openTags !== closeTags + selfClosing) {
    errors.push(`Tag mismatch: ${openTags} opening vs ${closeTags} closing (${selfClosing} self-closing)`);
  }

  // Check for empty required amounts
  const emptyAmountPattern = /<efile:(TotalIncomeAmt|AdjustedGrossIncomeAmt|TaxableIncomeAmt)><\/efile:\1>/g;
  const emptyAmounts = xml.match(emptyAmountPattern);
  if (emptyAmounts) {
    for (const match of emptyAmounts) {
      errors.push(`Empty required amount field: ${match}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Main MeF Return Generation ──────────────────────────────────────

export async function generateMeFReturn(db: Database, returnId: string): Promise<string> {
  log.info({ returnId }, 'Generating MeF XML return');

  // Fetch return data
  const taxReturn = getById<Record<string, unknown>>(db, 'tax_returns', returnId);
  if (!taxReturn) {
    throw new Error(`Return not found: ${returnId}`);
  }

  // Fetch client data
  const client = getById<Record<string, unknown>>(db, 'clients', taxReturn.client_id as string);
  if (!client) {
    throw new Error(`Client not found for return: ${returnId}`);
  }

  // Fetch income items
  const incomeItems = db.prepare('SELECT * FROM income_items WHERE return_id = ? ORDER BY category').all(returnId) as Record<string, unknown>[];

  // Fetch deductions
  const deductions = db.prepare('SELECT * FROM deductions WHERE return_id = ? ORDER BY category').all(returnId) as Record<string, unknown>[];

  // Fetch dependents
  const dependents = db.prepare('SELECT * FROM dependents WHERE return_id = ? ORDER BY last_name').all(returnId) as Record<string, unknown>[];

  const taxYear = Number(taxReturn.tax_year) || 2025;
  const now = new Date().toISOString();

  // Build address XML
  const addressXml = `        <efile:USAddress>
          <efile:AddressLine1Txt>${escapeXml(client.address_street as string || '')}</efile:AddressLine1Txt>${client.address_street2 ? `
          <efile:AddressLine2Txt>${escapeXml(client.address_street2 as string)}</efile:AddressLine2Txt>` : ''}
          <efile:CityNm>${escapeXml(client.address_city as string || '')}</efile:CityNm>
          <efile:StateAbbreviationCd>${escapeXml(client.address_state as string || '')}</efile:StateAbbreviationCd>
          <efile:ZIPCd>${escapeXml(client.address_zip as string || '')}</efile:ZIPCd>
        </efile:USAddress>`;

  // Build filer XML
  let filerXml = `      <efile:Filer>
        <efile:PrimarySSN>${formatSSN(client.ssn_encrypted as string || '')}</efile:PrimarySSN>
        <efile:Name>
          <efile:PersonFirstNm>${escapeXml(client.first_name as string || '')}</efile:PersonFirstNm>
          <efile:PersonLastNm>${escapeXml(client.last_name as string || '')}</efile:PersonLastNm>
        </efile:Name>
${addressXml}
      </efile:Filer>`;

  // Spouse info for MFJ/MFS
  if (['mfj', 'married_filing_jointly', 'mfs', 'married_filing_separately'].includes((client.filing_status as string || '').toLowerCase())) {
    if (client.spouse_first_name || client.spouse_last_name) {
      filerXml += `
      <efile:SpouseSSN>${formatSSN(client.spouse_ssn_encrypted as string || '')}</efile:SpouseSSN>
      <efile:SpouseName>
        <efile:PersonFirstNm>${escapeXml(client.spouse_first_name as string || '')}</efile:PersonFirstNm>
        <efile:PersonLastNm>${escapeXml(client.spouse_last_name as string || '')}</efile:PersonLastNm>
      </efile:SpouseName>`;
    }
  }

  // Generate IRS1040 section
  const irs1040Xml = generateIRS1040XML(taxReturn, client, incomeItems, deductions, dependents);

  // Determine and generate schedules
  const requiredSchedules = determineSchedules(taxReturn, incomeItems, deductions);
  let schedulesXml = '';
  for (const sched of requiredSchedules) {
    const schedData = buildScheduleData(sched, taxReturn, incomeItems, deductions);
    schedulesXml += '\n' + generateScheduleXML(sched, schedData);
  }

  // Assemble the full MeF return
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<efile:Return xmlns:efile="${MEF_NAMESPACE}" returnVersion="${RETURN_VERSION}">
  <efile:ReturnHeader>
    <efile:ReturnTs>${now}</efile:ReturnTs>
    <efile:TaxYr>${taxYear}</efile:TaxYr>
    <efile:TaxPeriodBeginDt>${taxYear}-01-01</efile:TaxPeriodBeginDt>
    <efile:TaxPeriodEndDt>${taxYear}-12-31</efile:TaxPeriodEndDt>
    <efile:SoftwareId>${SOFTWARE_ID}</efile:SoftwareId>
    <efile:SoftwareVersionNum>${SOFTWARE_VERSION}</efile:SoftwareVersionNum>
${filerXml}
    <efile:FilingStatusCd>${filingStatusToCode(client.filing_status as string)}</efile:FilingStatusCd>
  </efile:ReturnHeader>
  <efile:ReturnData>
${irs1040Xml}${schedulesXml}
  </efile:ReturnData>
</efile:Return>`;

  log.info({ returnId, taxYear, schedules: requiredSchedules, xmlLength: xml.length }, 'MeF XML generated');
  return xml;
}

// ─── Build Schedule Data from DB Records ──────────────────────────────

function buildScheduleData(
  schedule: string,
  returnData: Record<string, unknown>,
  incomeItems: Record<string, unknown>[],
  deductions: Record<string, unknown>[],
): Record<string, unknown> {
  switch (schedule) {
    case '1':
      return {
        business_income: incomeItems
          .filter(i => ['self_employment', '1099_nec', 'schedule_c'].includes(i.category as string))
          .reduce((sum, i) => sum + (Number(i.amount) || 0), 0),
        rental_income: incomeItems
          .filter(i => i.category === 'rental')
          .reduce((sum, i) => sum + (Number(i.amount) || 0), 0),
        farm_income: incomeItems
          .filter(i => i.category === 'farm')
          .reduce((sum, i) => sum + (Number(i.amount) || 0), 0),
        unemployment_compensation: incomeItems
          .filter(i => i.category === 'unemployment')
          .reduce((sum, i) => sum + (Number(i.amount) || 0), 0),
        social_security_benefits: incomeItems
          .filter(i => i.category === 'social_security')
          .reduce((sum, i) => sum + (Number(i.amount) || 0), 0),
        other_income: incomeItems
          .filter(i => i.category === 'other')
          .reduce((sum, i) => sum + (Number(i.amount) || 0), 0),
        total_additional_income: returnData.additional_income || 0,
        educator_expenses: returnData.educator_expenses || 0,
        self_employment_tax_deduction: returnData.se_tax_deduction || 0,
        self_employed_health_insurance: returnData.self_employed_health_insurance || 0,
        ira_deduction: returnData.ira_deduction || 0,
        student_loan_interest: returnData.student_loan_interest || 0,
        hsa_deduction: returnData.hsa_deduction || 0,
        total_adjustments: returnData.total_adjustments || 0,
      };

    case '2':
      return {
        amt_amount: returnData.amt_amount || 0,
        excess_ptc_repayment: returnData.excess_ptc_repayment || 0,
        self_employment_tax: returnData.self_employment_tax || 0,
        unreported_ss_medicare: returnData.unreported_ss_medicare || 0,
        additional_tax_ira: returnData.additional_tax_ira || 0,
        household_employment_tax: returnData.household_employment_tax || 0,
        first_time_penalty: returnData.first_time_penalty || 0,
        total_additional_tax: returnData.total_additional_tax || 0,
      };

    case '3':
      return {
        foreign_tax_credit: returnData.foreign_tax_credit || 0,
        child_dependent_care_credit: returnData.child_dependent_care_credit || 0,
        education_credit: returnData.education_credit || 0,
        retirement_savings_credit: returnData.retirement_savings_credit || 0,
        residential_energy_credit: returnData.residential_energy_credit || 0,
        other_credits: returnData.other_credits || 0,
        total_credits: returnData.total_credits || 0,
        estimated_tax_payments: returnData.estimated_tax_payments || 0,
        net_premium_tax_credit: returnData.net_premium_tax_credit || 0,
        amount_paid_with_extension: returnData.amount_paid_with_extension || 0,
        excess_ss_tax_withheld: returnData.excess_ss_tax_withheld || 0,
        total_other_payments: returnData.total_other_payments || 0,
      };

    case 'A':
      return deductions.reduce((acc, d) => {
        const type = d.category as string;
        const amount = Number(d.amount) || 0;
        if (type === 'medical') acc.medical_dental_expenses = (acc.medical_dental_expenses as number || 0) + amount;
        if (type === 'state_tax' || type === 'local_tax') acc.state_local_taxes = (acc.state_local_taxes as number || 0) + amount;
        if (type === 'real_estate_tax') acc.real_estate_taxes = (acc.real_estate_taxes as number || 0) + amount;
        if (type === 'mortgage_interest') acc.home_mortgage_interest = (acc.home_mortgage_interest as number || 0) + amount;
        if (type === 'charitable') acc.total_charitable = (acc.total_charitable as number || 0) + amount;
        if (type === 'other_itemized') acc.other_itemized = (acc.other_itemized as number || 0) + amount;
        acc.total_itemized_deductions = (acc.total_itemized_deductions as number || 0) + amount;
        return acc;
      }, { salt_cap: 10000 } as Record<string, unknown>);

    case 'B':
      return {
        interest_items: incomeItems
          .filter(i => ['interest', '1099_int'].includes(i.category as string))
          .map(i => ({ payer_name: i.payer_name || i.source || '', amount: i.amount })),
        dividend_items: incomeItems
          .filter(i => ['dividends', '1099_div'].includes(i.category as string))
          .map(i => ({ payer_name: i.payer_name || i.source || '', amount: i.amount })),
        total_interest: incomeItems
          .filter(i => ['interest', '1099_int'].includes(i.category as string))
          .reduce((sum, i) => sum + (Number(i.amount) || 0), 0),
        total_dividends: incomeItems
          .filter(i => ['dividends', '1099_div'].includes(i.category as string))
          .reduce((sum, i) => sum + (Number(i.amount) || 0), 0),
        has_foreign_accounts: returnData.has_foreign_accounts || false,
        has_foreign_trust: returnData.has_foreign_trust || false,
      };

    case 'C': {
      const bizIncome = incomeItems.filter(i =>
        ['self_employment', '1099_nec', 'schedule_c'].includes(i.category as string),
      );
      const grossReceipts = bizIncome.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
      return {
        business_name: returnData.business_name || '',
        activity_code: returnData.activity_code || '',
        business_description: returnData.business_description || '',
        business_ein: returnData.business_ein || '',
        accounting_method: returnData.accounting_method || 'Cash',
        gross_receipts: grossReceipts,
        cost_of_goods_sold: returnData.cost_of_goods_sold || 0,
        gross_profit: grossReceipts - (Number(returnData.cost_of_goods_sold) || 0),
        total_expenses: returnData.total_business_expenses || 0,
        net_profit_loss: returnData.net_business_income || grossReceipts - (Number(returnData.total_business_expenses) || 0),
      };
    }

    case 'D': {
      const stGains = incomeItems
        .filter(i => i.category === 'capital_gains' && i.holding_period === 'short')
        .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
      const ltGains = incomeItems
        .filter(i => i.category === 'capital_gains' && i.holding_period !== 'short')
        .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
      return {
        net_short_term: stGains,
        net_long_term: ltGains,
        net_capital_gain_loss: stGains + ltGains,
      };
    }

    case 'SE': {
      const seIncome = incomeItems
        .filter(i => ['self_employment', '1099_nec', 'schedule_c'].includes(i.category as string))
        .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
      return {
        net_earnings: seIncome - (Number(returnData.total_business_expenses) || 0),
        self_employment_tax: returnData.self_employment_tax || 0,
        se_tax_deduction: returnData.se_tax_deduction || 0,
      };
    }

    default:
      return {};
  }
}
