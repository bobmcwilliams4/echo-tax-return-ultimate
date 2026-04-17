// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Tax Planning Routes
// 10-year projections, Roth ladders, multi-year optimization
// ═══════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { getById, logAudit } from '../services/database';
import { createLogger } from '../utils/logger';

const log = createLogger('planning');

// ─── Inflation Assumptions ─────────────────────────────────────────────
const DEFAULT_INFLATION_RATE = 0.025; // 2.5% annual
const DEFAULT_INCOME_GROWTH_RATE = 0.03; // 3% annual
const DEFAULT_INVESTMENT_RETURN = 0.07; // 7% annual
const RMD_BEGINNING_AGE = 73;

// ─── Tax Brackets (simplified for projections) ────────────────────────
function getEffectiveRate(taxableIncome: number, filingStatus: string): number {
  // Simplified effective rate estimation for multi-year projections
  const brackets: Record<string, Array<[number, number]>> = {
    single: [[11_925, 0.10], [48_475, 0.12], [103_350, 0.22], [197_300, 0.24], [250_525, 0.32], [626_350, 0.35], [Infinity, 0.37]],
    mfj: [[23_850, 0.10], [96_950, 0.12], [206_700, 0.22], [394_600, 0.24], [501_050, 0.32], [751_600, 0.35], [Infinity, 0.37]],
    mfs: [[11_925, 0.10], [48_475, 0.12], [103_350, 0.22], [197_300, 0.24], [250_525, 0.32], [375_800, 0.35], [Infinity, 0.37]],
    hoh: [[17_000, 0.10], [64_850, 0.12], [103_350, 0.22], [197_300, 0.24], [250_500, 0.32], [626_350, 0.35], [Infinity, 0.37]],
    qss: [[23_850, 0.10], [96_950, 0.12], [206_700, 0.22], [394_600, 0.24], [501_050, 0.32], [751_600, 0.35], [Infinity, 0.37]],
  };

  const statusBrackets = brackets[filingStatus] || brackets.single;
  let tax = 0;
  let remaining = taxableIncome;
  let prevLimit = 0;

  for (const [limit, rate] of statusBrackets) {
    const bracketWidth = limit - prevLimit;
    const taxableInBracket = Math.min(remaining, bracketWidth);
    tax += taxableInBracket * rate;
    remaining -= taxableInBracket;
    prevLimit = limit;
    if (remaining <= 0) break;
  }

  return taxableIncome > 0 ? tax / taxableIncome : 0;
}

function getMarginalRate(taxableIncome: number, filingStatus: string): number {
  const brackets: Record<string, Array<[number, number]>> = {
    single: [[11_925, 0.10], [48_475, 0.12], [103_350, 0.22], [197_300, 0.24], [250_525, 0.32], [626_350, 0.35], [Infinity, 0.37]],
    mfj: [[23_850, 0.10], [96_950, 0.12], [206_700, 0.22], [394_600, 0.24], [501_050, 0.32], [751_600, 0.35], [Infinity, 0.37]],
    mfs: [[11_925, 0.10], [48_475, 0.12], [103_350, 0.22], [197_300, 0.24], [250_525, 0.32], [375_800, 0.35], [Infinity, 0.37]],
    hoh: [[17_000, 0.10], [64_850, 0.12], [103_350, 0.22], [197_300, 0.24], [250_500, 0.32], [626_350, 0.35], [Infinity, 0.37]],
    qss: [[23_850, 0.10], [96_950, 0.12], [206_700, 0.22], [394_600, 0.24], [501_050, 0.32], [751_600, 0.35], [Infinity, 0.37]],
  };

  const statusBrackets = brackets[filingStatus] || brackets.single;
  for (const [limit, rate] of statusBrackets) {
    if (taxableIncome <= limit) return rate;
  }
  return 0.37;
}

// ─── RMD Factors (Uniform Lifetime Table) ──────────────────────────────
const RMD_FACTORS: Record<number, number> = {
  73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1,
  80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2,
  87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1,
  94: 9.5, 95: 8.9, 96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4,
};

export function planningRoutes(db: Database) {
  const router = new Hono();

  // POST /10-year/:clientId — 10-year tax projection
  router.post('/10-year/:clientId', async (c) => {
    const clientId = c.req.param('clientId');
    const client = getById(db, 'clients', clientId) as Record<string, unknown> | undefined;
    if (!client) return c.json({ success: false, error: 'Client not found' }, 404);

    const body = await c.req.json();
    const filingStatus = (client.filing_status as string) || (body.filing_status as string) || 'single';
    const currentYear = new Date().getFullYear();

    // Get most recent return data as baseline
    const latestReturn = db.prepare(`
      SELECT * FROM tax_returns WHERE client_id = ? ORDER BY tax_year DESC LIMIT 1
    `).get(clientId) as Record<string, unknown> | undefined;

    // Base parameters
    const baseIncome = (body.base_income as number) || (latestReturn?.total_income as number) || 75_000;
    const baseDeductions = (body.base_deductions as number) || (latestReturn?.standard_deduction_amount as number) || 15_000;
    const incomeGrowthRate = (body.income_growth_rate as number) || DEFAULT_INCOME_GROWTH_RATE;
    const inflationRate = (body.inflation_rate as number) || DEFAULT_INFLATION_RATE;
    const retirementAge = (body.retirement_age as number) || 65;
    const currentAge = (body.current_age as number) || (client.dob ? currentYear - new Date(client.dob as string).getFullYear() : 40);
    const retirementIncomePct = (body.retirement_income_pct as number) || 0.70; // 70% of pre-retirement income
    const traditionalIraBalance = (body.traditional_ira_balance as number) || 0;
    const rothIraBalance = (body.roth_ira_balance as number) || 0;
    const annualContribution = (body.annual_contribution as number) || 7_000;

    const projections: Array<Record<string, unknown>> = [];
    let cumulativeTax = 0;
    let iraBalance = traditionalIraBalance;
    let rothBalance = rothIraBalance;

    for (let i = 0; i < 10; i++) {
      const year = currentYear + i;
      const age = currentAge + i;
      const isRetired = age >= retirementAge;

      // Project income
      let projectedIncome: number;
      if (!isRetired) {
        projectedIncome = baseIncome * Math.pow(1 + incomeGrowthRate, i);
      } else {
        // Retirement income: Social Security + pension + withdrawals
        projectedIncome = baseIncome * retirementIncomePct * Math.pow(1 + inflationRate, i);
      }

      // Project deductions (inflate standard deduction)
      const projectedDeduction = baseDeductions * Math.pow(1 + inflationRate, i);
      // Over 65 additional deduction
      const additionalDeduction = age >= 65 ? (filingStatus === 'single' || filingStatus === 'hoh' ? 2_000 : 1_600) : 0;
      const totalDeduction = projectedDeduction + additionalDeduction;

      const taxableIncome = Math.max(0, projectedIncome - totalDeduction);
      const effectiveRate = getEffectiveRate(taxableIncome, filingStatus);
      const marginalRate = getMarginalRate(taxableIncome, filingStatus);
      const estimatedTax = taxableIncome * effectiveRate;

      // RMD calculation
      let rmdAmount = 0;
      if (age >= RMD_BEGINNING_AGE && iraBalance > 0) {
        const factor = RMD_FACTORS[Math.min(age, 100)] || 6.4;
        rmdAmount = iraBalance / factor;
      }

      // IRA growth
      if (!isRetired) {
        iraBalance = (iraBalance + annualContribution) * (1 + DEFAULT_INVESTMENT_RETURN);
        rothBalance = (rothBalance + (body.roth_contribution || 0)) * (1 + DEFAULT_INVESTMENT_RETURN);
      } else {
        iraBalance = Math.max(0, (iraBalance - rmdAmount) * (1 + DEFAULT_INVESTMENT_RETURN));
        rothBalance = rothBalance * (1 + DEFAULT_INVESTMENT_RETURN);
      }

      cumulativeTax += estimatedTax;

      projections.push({
        year,
        age,
        is_retired: isRetired,
        projected_income: Math.round(projectedIncome),
        total_deduction: Math.round(totalDeduction),
        taxable_income: Math.round(taxableIncome),
        effective_rate: Math.round(effectiveRate * 10000) / 100,
        marginal_rate: marginalRate * 100,
        estimated_tax: Math.round(estimatedTax),
        cumulative_tax: Math.round(cumulativeTax),
        traditional_ira_balance: Math.round(iraBalance),
        roth_ira_balance: Math.round(rothBalance),
        rmd_amount: Math.round(rmdAmount),
        rmd_required: age >= RMD_BEGINNING_AGE,
      });
    }

    // Optimization suggestions
    const suggestions: string[] = [];
    const yearsToRetirement = Math.max(0, retirementAge - currentAge);

    if (yearsToRetirement > 0 && yearsToRetirement <= 10) {
      const currentRate = getMarginalRate(baseIncome - baseDeductions, filingStatus);
      const retiredRate = getMarginalRate(baseIncome * retirementIncomePct - baseDeductions, filingStatus);
      if (retiredRate < currentRate) {
        suggestions.push('Consider maximizing traditional IRA/401k contributions now — current marginal rate exceeds projected retirement rate.');
      } else {
        suggestions.push('Consider Roth contributions — projected retirement tax rate equals or exceeds current rate.');
      }
    }

    if (traditionalIraBalance > 500_000) {
      suggestions.push('Large traditional IRA balance detected. Consider Roth conversion ladder before RMD age to reduce future forced distributions.');
    }

    const highTaxYears = projections.filter(p => (p.effective_rate as number) > 25);
    if (highTaxYears.length > 0) {
      suggestions.push(`${highTaxYears.length} year(s) projected above 25% effective rate — consider income shifting strategies.`);
    }

    logAudit(db, {
      client_id: clientId,
      user_id: c.get('userId'),
      action: 'planning_10year',
      entity_type: 'planning',
      entity_id: clientId,
      details: { years: 10, base_income: baseIncome },
    });

    return c.json({
      success: true,
      data: {
        client_id: clientId,
        filing_status: filingStatus,
        current_age: currentAge,
        retirement_age: retirementAge,
        assumptions: {
          income_growth_rate: incomeGrowthRate,
          inflation_rate: inflationRate,
          investment_return: DEFAULT_INVESTMENT_RETURN,
          retirement_income_pct: retirementIncomePct,
        },
        projections,
        summary: {
          total_10year_tax: Math.round(cumulativeTax),
          avg_annual_tax: Math.round(cumulativeTax / 10),
          avg_effective_rate: Math.round(projections.reduce((sum, p) => sum + (p.effective_rate as number), 0) / 10 * 100) / 100,
          ira_balance_year_10: Math.round(iraBalance),
          roth_balance_year_10: Math.round(rothBalance),
          total_retirement_savings_year_10: Math.round(iraBalance + rothBalance),
        },
        suggestions,
      },
    });
  });

  // POST /roth-ladder/:clientId — Roth conversion ladder analysis
  router.post('/roth-ladder/:clientId', async (c) => {
    const clientId = c.req.param('clientId');
    const client = getById(db, 'clients', clientId) as Record<string, unknown> | undefined;
    if (!client) return c.json({ success: false, error: 'Client not found' }, 404);

    const body = await c.req.json();
    const filingStatus = (client.filing_status as string) || (body.filing_status as string) || 'single';
    const currentYear = new Date().getFullYear();
    const currentAge = (body.current_age as number) || (client.dob ? currentYear - new Date(client.dob as string).getFullYear() : 40);
    const traditionalBalance = (body.traditional_balance as number) || 0;
    const annualIncome = (body.annual_income as number) || 0;
    const standardDeduction = (body.standard_deduction as number) || 15_000;
    const targetConversionYears = (body.conversion_years as number) || 5;
    const maxAnnualConversion = (body.max_annual_conversion as number) || 50_000;

    if (traditionalBalance <= 0) {
      return c.json({ success: false, error: 'traditional_balance must be greater than 0' }, 400);
    }

    // Simulate conversion scenarios
    const scenarios: Array<{
      name: string;
      annual_conversion: number;
      years: Array<Record<string, unknown>>;
      total_conversion_tax: number;
      ending_traditional: number;
      ending_roth: number;
      tax_savings_vs_rmd: number;
    }> = [];

    // Scenario 1: No conversion (baseline — let RMDs happen)
    const baselineYears: Array<Record<string, unknown>> = [];
    let baseIra = traditionalBalance;
    let baseTotalTax = 0;
    for (let i = 0; i < targetConversionYears; i++) {
      const age = currentAge + i;
      const rmd = age >= RMD_BEGINNING_AGE ? baseIra / (RMD_FACTORS[Math.min(age, 100)] || 6.4) : 0;
      const taxableIncome = annualIncome + rmd - standardDeduction;
      const tax = taxableIncome > 0 ? taxableIncome * getEffectiveRate(taxableIncome, filingStatus) : 0;
      baseTotalTax += tax;
      baseIra = (baseIra - rmd) * (1 + DEFAULT_INVESTMENT_RETURN);
      baselineYears.push({
        year: currentYear + i, age, rmd: Math.round(rmd), taxable_income: Math.round(taxableIncome),
        tax: Math.round(tax), ira_balance: Math.round(baseIra),
      });
    }
    scenarios.push({
      name: 'No Conversion (Baseline)',
      annual_conversion: 0,
      years: baselineYears,
      total_conversion_tax: Math.round(baseTotalTax),
      ending_traditional: Math.round(baseIra),
      ending_roth: 0,
      tax_savings_vs_rmd: 0,
    });

    // Scenario 2-4: Various conversion amounts
    for (const conversionAmount of [maxAnnualConversion * 0.5, maxAnnualConversion, maxAnnualConversion * 1.5]) {
      const years: Array<Record<string, unknown>> = [];
      let ira = traditionalBalance;
      let roth = 0;
      let totalConversionTax = 0;

      for (let i = 0; i < targetConversionYears; i++) {
        const age = currentAge + i;
        const actualConversion = Math.min(conversionAmount, ira);
        const rmd = age >= RMD_BEGINNING_AGE ? ira / (RMD_FACTORS[Math.min(age, 100)] || 6.4) : 0;
        const totalWithdrawal = actualConversion + rmd;
        const taxableIncome = annualIncome + totalWithdrawal - standardDeduction;
        const tax = taxableIncome > 0 ? taxableIncome * getEffectiveRate(taxableIncome, filingStatus) : 0;
        const conversionTax = actualConversion > 0
          ? actualConversion * getMarginalRate(Math.max(0, annualIncome + rmd - standardDeduction + actualConversion), filingStatus)
          : 0;
        totalConversionTax += conversionTax;

        ira = Math.max(0, (ira - actualConversion - rmd) * (1 + DEFAULT_INVESTMENT_RETURN));
        roth = (roth + actualConversion) * (1 + DEFAULT_INVESTMENT_RETURN);

        years.push({
          year: currentYear + i, age, conversion: Math.round(actualConversion), rmd: Math.round(rmd),
          taxable_income: Math.round(taxableIncome), tax: Math.round(tax),
          conversion_tax: Math.round(conversionTax),
          traditional_balance: Math.round(ira), roth_balance: Math.round(roth),
        });
      }

      scenarios.push({
        name: `$${Math.round(conversionAmount).toLocaleString()}/year Conversion`,
        annual_conversion: Math.round(conversionAmount),
        years,
        total_conversion_tax: Math.round(totalConversionTax),
        ending_traditional: Math.round(ira),
        ending_roth: Math.round(roth),
        tax_savings_vs_rmd: Math.round(baseTotalTax - totalConversionTax),
      });
    }

    // Find optimal scenario
    const optimal = scenarios.reduce((best, current) => {
      if (current.annual_conversion === 0) return best; // Skip baseline
      const totalWealth = current.ending_traditional + current.ending_roth - current.total_conversion_tax;
      const bestWealth = best.ending_traditional + best.ending_roth - best.total_conversion_tax;
      return totalWealth > bestWealth ? current : best;
    }, scenarios[1]);

    logAudit(db, {
      client_id: clientId,
      user_id: c.get('userId'),
      action: 'planning_roth_ladder',
      entity_type: 'planning',
      entity_id: clientId,
      details: { traditional_balance: traditionalBalance, conversion_years: targetConversionYears },
    });

    return c.json({
      success: true,
      data: {
        client_id: clientId,
        filing_status: filingStatus,
        current_age: currentAge,
        traditional_balance: traditionalBalance,
        conversion_years: targetConversionYears,
        assumptions: {
          investment_return: DEFAULT_INVESTMENT_RETURN,
          inflation_rate: DEFAULT_INFLATION_RATE,
          annual_income: annualIncome,
          standard_deduction: standardDeduction,
        },
        scenarios,
        optimal_scenario: optimal.name,
        key_insight: optimal.tax_savings_vs_rmd > 0
          ? `Converting $${optimal.annual_conversion.toLocaleString()}/year could save approximately $${optimal.tax_savings_vs_rmd.toLocaleString()} in total taxes over ${targetConversionYears} years compared to waiting for RMDs.`
          : 'RMDs may result in lower total taxes than proactive conversion at current income levels. Consider conversion during lower-income years.',
        warnings: [
          'Projections are estimates based on current tax law and assumed rates.',
          'TCJA provisions may sunset after 2025, potentially changing brackets.',
          'Roth conversions are irrevocable — cannot be recharacterized after 2017 TCJA.',
          'Consider Medicare IRMAA surcharges when planning large conversions.',
          'State taxes are not included in this analysis.',
        ],
      },
    });
  });

  return router;
}
