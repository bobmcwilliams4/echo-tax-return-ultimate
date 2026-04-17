// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Database Seeder
// Seeds 2025 tax tables, IRC authority, and initial doctrine blocks
// ═══════════════════════════════════════════════════════════════════════════

import { Database } from 'bun:sqlite';
import { join } from 'path';
import { readFileSync, mkdirSync } from 'fs';

const DB_PATH = process.env.DATABASE_PATH || join(process.cwd(), 'data', 'returns.db');
mkdirSync(join(DB_PATH, '..'), { recursive: true });

const db = new Database(DB_PATH, { create: true });
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const schema = readFileSync(join(process.cwd(), 'db', 'schema.sql'), 'utf-8');
db.exec(schema);
console.log('Schema applied. Seeding data...');

// ─── 2025 Federal Tax Brackets ─────────────────────────────────────────

const brackets2025: Record<string, { min: number; max: number; rate: number }[]> = {
  single: [
    { min: 0, max: 11925, rate: 0.10 },
    { min: 11925, max: 48475, rate: 0.12 },
    { min: 48475, max: 103350, rate: 0.22 },
    { min: 103350, max: 197300, rate: 0.24 },
    { min: 197300, max: 250525, rate: 0.32 },
    { min: 250525, max: 626350, rate: 0.35 },
    { min: 626350, max: 999999999, rate: 0.37 },
  ],
  mfj: [
    { min: 0, max: 23850, rate: 0.10 },
    { min: 23850, max: 96950, rate: 0.12 },
    { min: 96950, max: 206700, rate: 0.22 },
    { min: 206700, max: 394600, rate: 0.24 },
    { min: 394600, max: 501050, rate: 0.32 },
    { min: 501050, max: 751600, rate: 0.35 },
    { min: 751600, max: 999999999, rate: 0.37 },
  ],
  mfs: [
    { min: 0, max: 11925, rate: 0.10 },
    { min: 11925, max: 48475, rate: 0.12 },
    { min: 48475, max: 103350, rate: 0.22 },
    { min: 103350, max: 197300, rate: 0.24 },
    { min: 197300, max: 250525, rate: 0.32 },
    { min: 250525, max: 375800, rate: 0.35 },
    { min: 375800, max: 999999999, rate: 0.37 },
  ],
  hoh: [
    { min: 0, max: 17000, rate: 0.10 },
    { min: 17000, max: 64850, rate: 0.12 },
    { min: 64850, max: 103350, rate: 0.22 },
    { min: 103350, max: 197300, rate: 0.24 },
    { min: 197300, max: 250500, rate: 0.32 },
    { min: 250500, max: 626350, rate: 0.35 },
    { min: 626350, max: 999999999, rate: 0.37 },
  ],
  qss: [
    { min: 0, max: 23850, rate: 0.10 },
    { min: 23850, max: 96950, rate: 0.12 },
    { min: 96950, max: 206700, rate: 0.22 },
    { min: 206700, max: 394600, rate: 0.24 },
    { min: 394600, max: 501050, rate: 0.32 },
    { min: 501050, max: 751600, rate: 0.35 },
    { min: 751600, max: 999999999, rate: 0.37 },
  ],
};

const insertTaxTable = db.prepare(`
  INSERT OR REPLACE INTO tax_tables (tax_year, table_type, filing_status, data, source)
  VALUES (?, ?, ?, ?, ?)
`);

// Wrap all inserts in a transaction
db.exec('BEGIN');

for (const [status, brackets] of Object.entries(brackets2025)) {
  insertTaxTable.run(2025, 'income_brackets', status, JSON.stringify(brackets), 'Rev. Proc. 2024-40');
}

// Standard deductions 2025
const standardDeductions: Record<string, number> = { single: 15000, mfj: 30000, mfs: 15000, hoh: 22500, qss: 30000 };
for (const [status, amount] of Object.entries(standardDeductions)) {
  insertTaxTable.run(2025, 'standard_deduction', status, JSON.stringify({
    amount, additional_65: status === 'single' || status === 'hoh' ? 2000 : 1600,
    additional_blind: status === 'single' || status === 'hoh' ? 2000 : 1600,
  }), 'Rev. Proc. 2024-40');
}

// Capital gains rates 2025
const capitalGains: Record<string, { zero_max: number; fifteen_max: number }> = {
  single: { zero_max: 48350, fifteen_max: 533400 },
  mfj: { zero_max: 96700, fifteen_max: 600050 },
  mfs: { zero_max: 48350, fifteen_max: 300025 },
  hoh: { zero_max: 64750, fifteen_max: 566700 },
  qss: { zero_max: 96700, fifteen_max: 600050 },
};
for (const [status, thresholds] of Object.entries(capitalGains)) {
  insertTaxTable.run(2025, 'capital_gains', status, JSON.stringify(thresholds), 'Rev. Proc. 2024-40');
}

// AMT exemptions 2025
const amtExemptions: Record<string, { exemption: number; phaseout_start: number }> = {
  single: { exemption: 88100, phaseout_start: 626350 },
  mfj: { exemption: 137000, phaseout_start: 1252700 },
  mfs: { exemption: 68500, phaseout_start: 626350 },
  hoh: { exemption: 88100, phaseout_start: 626350 },
  qss: { exemption: 137000, phaseout_start: 1252700 },
};
for (const [status, data] of Object.entries(amtExemptions)) {
  insertTaxTable.run(2025, 'amt_exemption', status, JSON.stringify(data), 'Rev. Proc. 2024-40');
}

// Contribution limits 2025
const contributionLimits: Record<string, Record<string, number>> = {
  '401k': { limit: 23500, catch_up_50: 7500, catch_up_60_63: 11250 },
  ira: { limit: 7000, catch_up_50: 1000 },
  hsa_self: { limit: 4300, catch_up_55: 1000 },
  hsa_family: { limit: 8550, catch_up_55: 1000 },
  simple_ira: { limit: 16500, catch_up_50: 3500 },
  sep_ira: { limit: 70000, pct: 0.25 },
  fsa_health: { limit: 3300 },
  fsa_dependent_care: { limit: 5000 },
};
for (const [type, data] of Object.entries(contributionLimits)) {
  insertTaxTable.run(2025, 'contribution_limit', type, JSON.stringify(data), 'Rev. Proc. 2024-40');
}

// FICA / SE rates 2025
insertTaxTable.run(2025, 'fica', null, JSON.stringify({
  social_security_rate: 0.062, social_security_wage_base: 176100,
  medicare_rate: 0.0145, additional_medicare_rate: 0.009,
  additional_medicare_threshold_single: 200000, additional_medicare_threshold_mfj: 250000,
  se_tax_rate: 0.153, se_deductible_pct: 0.9235,
}), 'SSA / IRS');

// NIIT thresholds
insertTaxTable.run(2025, 'niit', null, JSON.stringify({
  rate: 0.038, threshold_single: 200000, threshold_mfj: 250000, threshold_mfs: 125000,
}), 'IRC §1411');

// EIC parameters 2025
const eicParams: Record<string, Record<string, number>> = {
  no_children: { max_credit: 649, phaseout_start_single: 10620, phaseout_start_mfj: 17610, max_income_single: 19104, max_income_mfj: 26214 },
  one_child: { max_credit: 4328, phaseout_start_single: 22820, phaseout_start_mfj: 29810, max_income_single: 53865, max_income_mfj: 60955 },
  two_children: { max_credit: 7152, phaseout_start_single: 22820, phaseout_start_mfj: 29810, max_income_single: 59899, max_income_mfj: 66989 },
  three_plus: { max_credit: 8046, phaseout_start_single: 22820, phaseout_start_mfj: 29810, max_income_single: 63398, max_income_mfj: 70488 },
};
for (const [children, data] of Object.entries(eicParams)) {
  insertTaxTable.run(2025, 'eic', children, JSON.stringify(data), 'Rev. Proc. 2024-40');
}

// CTC 2025
insertTaxTable.run(2025, 'ctc', null, JSON.stringify({
  credit_per_child: 2000, refundable_max: 1700, odc_credit: 500,
  phaseout_start_single: 200000, phaseout_start_mfj: 400000, phaseout_rate: 0.05, qualifying_age_max: 16,
}), 'IRC §24');

// Mileage rates 2025
insertTaxTable.run(2025, 'mileage_rates', null, JSON.stringify({
  business: 0.70, medical: 0.21, charity: 0.14, moving_military: 0.21,
}), 'IRS Notice 2024-XX');

// QBI deduction 2025
insertTaxTable.run(2025, 'qbi', null, JSON.stringify({
  deduction_rate: 0.20, taxable_income_threshold_single: 191950, taxable_income_threshold_mfj: 383900,
  phaseout_range_single: 50000, phaseout_range_mfj: 100000, sstb_phaseout: true,
}), 'IRC §199A');

// SALT cap
insertTaxTable.run(2025, 'salt_cap', null, JSON.stringify({ cap: 10000, cap_mfs: 5000 }), 'IRC §164(b)(6)');

console.log('  ✓ Tax tables seeded (2025)');

// ─── IRC Authority Sections ────────────────────────────────────────────

const insertIRC = db.prepare(`
  INSERT OR REPLACE INTO irc_authority (section, title, full_text, regulations, authority_weight, notes)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const sections = [
  { section: '§1', title: 'Tax Imposed — Individual Rates', text: 'Seven brackets for 2025: 10%, 12%, 22%, 24%, 32%, 35%, 37%. TCJA rates expire after 2025.', regs: 'Treas. Reg. §1.1-1', weight: 100, notes: 'Foundation of individual income tax' },
  { section: '§11', title: 'Tax Imposed on Corporations', text: 'Flat 21% tax on corporate taxable income effective for tax years beginning after December 31, 2017.', regs: 'Treas. Reg. §1.11-1', weight: 95, notes: 'TCJA flat corporate rate' },
  { section: '§24', title: 'Child Tax Credit', text: '$2,000 per qualifying child under 17. Up to $1,700 refundable as ACTC. Phase-out at $200K/$400K.', regs: 'Treas. Reg. §1.24-1', weight: 90, notes: 'Major family credit' },
  { section: '§32', title: 'Earned Income Credit', text: 'Refundable credit for low-to-moderate income workers based on earned income, filing status, and qualifying children.', regs: 'Treas. Reg. §1.32-1 through §1.32-3', weight: 90, notes: 'Largest refundable credit' },
  { section: '§61', title: 'Gross Income Defined', text: 'All income from whatever source derived including compensation, business income, gains, interest, rents, royalties, dividends.', regs: 'Treas. Reg. §1.61-1 through §1.61-22', weight: 100, notes: 'Commissioner v. Glenshaw Glass (1955)' },
  { section: '§62', title: 'Adjusted Gross Income Defined', text: 'Above-the-line deductions: trade/business, educator, HSA, SE tax, IRA, student loan interest.', regs: 'Treas. Reg. §1.62-1', weight: 95, notes: 'AGI is gateway to many phase-outs' },
  { section: '§63', title: 'Taxable Income Defined', text: 'AGI minus greater of standard or itemized deductions, minus QBI deduction.', regs: 'Treas. Reg. §1.63-1', weight: 95, notes: 'Standard vs itemized choice' },
  { section: '§162', title: 'Trade or Business Expenses', text: 'Ordinary and necessary expenses for carrying on trade or business.', regs: 'Treas. Reg. §1.162-1 through §1.162-33', weight: 100, notes: 'Welch v. Helvering ordinary/necessary test' },
  { section: '§163', title: 'Interest Deduction', text: 'Qualified residence interest limited to $750K acquisition debt. Home equity not deductible 2018-2025 unless buy/build/improve.', regs: 'Treas. Reg. §1.163-1 through §1.163-15', weight: 90, notes: 'TCJA reduced mortgage limit' },
  { section: '§164', title: 'Taxes (SALT)', text: 'State/local income, property, foreign taxes. SALT capped at $10,000 ($5,000 MFS) 2018-2025.', regs: 'Treas. Reg. §1.164-1 through §1.164-6', weight: 90, notes: 'SALT cap §164(b)(6)' },
  { section: '§170', title: 'Charitable Contributions', text: 'Cash limited to 60% AGI. Non-cash 30% or 50%. Carryover 5 years. $250+ needs acknowledgment. $5,000+ needs appraisal.', regs: 'Treas. Reg. §1.170A-1 through §1.170A-18', weight: 85, notes: '60% AGI limit for cash post-TCJA' },
  { section: '§179', title: 'Section 179 Expensing', text: '2025 limit: $1,250,000 with $3,130,000 phase-out. Immediate expensing of tangible personal property.', regs: 'Treas. Reg. §1.179-1 through §1.179-6', weight: 85, notes: 'Inflation-adjusted annually' },
  { section: '§199A', title: 'QBI Deduction', text: '20% deduction of qualified business income. W-2/UBIA limits above $191,950/$383,900. SSTBs phased out.', regs: 'Treas. Reg. §1.199A-1 through §1.199A-6', weight: 95, notes: 'Expires after 2025 unless extended' },
  { section: '§401(k)', title: 'Cash or Deferred Arrangements', text: '2025: $23,500 limit ($31,000 age 50+, $34,750 ages 60-63 super catch-up).', regs: 'Treas. Reg. §1.401(k)-1 through §1.401(k)-6', weight: 85, notes: 'SECURE Act 2.0 super catch-up' },
  { section: '§408', title: 'Individual Retirement Accounts', text: 'Traditional IRA: $7,000 ($8,000 age 50+). Deductibility phase-out if covered by employer plan.', regs: 'Treas. Reg. §1.408-1 through §1.408-11', weight: 80, notes: 'Phase-out if employer plan coverage' },
  { section: '§1401', title: 'Self-Employment Tax', text: '12.4% SS (up to $176,100) + 2.9% Medicare + 0.9% Additional Medicare above $200K/$250K. 92.35% of SE income subject.', regs: 'Treas. Reg. §1.1401-1', weight: 90, notes: 'SE deduction = 50% of SE tax' },
  { section: '§1411', title: 'Net Investment Income Tax', text: '3.8% on NII for MAGI above $200K (single) or $250K (MFJ). Not indexed for inflation.', regs: 'Treas. Reg. §1.1411-1 through §1.1411-10', weight: 85, notes: 'Not indexed for inflation' },
];

for (const s of sections) {
  insertIRC.run(s.section, s.title, s.text, s.regs, s.weight, s.notes);
}
console.log('  ✓ IRC authority sections seeded (17 core sections)');

// Rebuild FTS5
db.exec("INSERT INTO irc_authority_fts(irc_authority_fts) VALUES('rebuild')");
console.log('  ✓ FTS5 index rebuilt');

// ─── Doctrine Blocks ───────────────────────────────────────────────────

const insertDoctrine = db.prepare(`
  INSERT OR REPLACE INTO doctrine_blocks (id, engine_id, topic, keywords, conclusion_template, reasoning_framework, key_factors, primary_authority, confidence)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const blocks = [
  { id: 'D001', engine: 'FIE', topic: 'Standard vs. Itemized Deduction Election', keywords: 'standard deduction,itemized,schedule a,deduction election,salt cap', conclusion: 'Taxpayer should elect the {method} deduction of ${amount}, resulting in {savings} additional tax savings.', framework: 'Compare total itemized (medical >7.5% AGI + SALT capped $10K + mortgage interest + charitable) against standard deduction for filing status. Consider state requirement. Factor bunching strategy.', factors: 'filing_status,total_itemized,standard_deduction_amount,salt_total,mortgage_interest,charitable,medical_expenses,agi', authority: 'IRC §63, Treas. Reg. §1.63-1, Rev. Proc. 2024-40', confidence: 'DEFENSIBLE' },
  { id: 'D002', engine: 'FIE', topic: 'Self-Employment Tax Calculation', keywords: 'self employment,schedule se,se tax,fica,social security,medicare,1099', conclusion: 'SE tax liability is ${amount}. The above-the-line deduction for 50% of SE tax is ${deduction}.', framework: 'Net SE income × 92.35% = SE tax base. Apply 12.4% SS (up to wage base) + 2.9% Medicare + 0.9% Additional Medicare if MAGI > threshold. Deduct 50% from gross income.', factors: 'net_se_income,w2_wages,filing_status,magi', authority: 'IRC §1401, §1402, §164(f)', confidence: 'DEFENSIBLE' },
  { id: 'D003', engine: 'FIE', topic: 'Child Tax Credit Qualification', keywords: 'child tax credit,ctc,additional child tax credit,actc,qualifying child', conclusion: 'CTC: ${total_ctc} for {count} qualifying children, ${refundable} refundable as ACTC.', framework: '$2,000 per child under 17. Phase-out 5% of MAGI above $200K/$400K. ACTC capped at $1,700, calculated as 15% of earned income over $2,500. ODC $500 for non-CTC dependents.', factors: 'num_children,child_ages,magi,filing_status,earned_income', authority: 'IRC §24, Schedule 8812', confidence: 'DEFENSIBLE' },
  { id: 'D004', engine: 'FIE', topic: 'Net Investment Income Tax (NIIT)', keywords: 'niit,net investment income,3.8%,passive income,medicare surtax', conclusion: 'NIIT liability is ${amount} (3.8% on ${taxable_nii}).', framework: 'NIIT = 3.8% × lesser of (NII, MAGI - threshold). NII = interest + dividends + cap gains + rents + royalties + passive income. Excludes wages, SE income, active business, distributions from qualified plans.', factors: 'magi,net_investment_income,filing_status', authority: 'IRC §1411, Treas. Reg. §1.1411-1 through §1.1411-10', confidence: 'DEFENSIBLE' },
  { id: 'D005', engine: 'FIE', topic: 'QBI Deduction — Section 199A', keywords: 'qbi,199a,qualified business income,pass-through,sstb', conclusion: 'QBI deduction is ${amount} (20% of qualified business income of ${qbi}).', framework: 'Below threshold: 20% of QBI, no limits. Above: lesser of 20% QBI or greater of (50% W-2, 25% W-2 + 2.5% UBIA). SSTBs phased out above threshold. Cannot exceed 20% of taxable income.', factors: 'qbi_amount,taxable_income,filing_status,w2_wages_paid,ubia,is_sstb', authority: 'IRC §199A, Treas. Reg. §1.199A-1 through §1.199A-6', confidence: 'DEFENSIBLE' },
  { id: 'D006', engine: 'CRE', topic: 'Earned Income Credit Calculation', keywords: 'earned income credit,eic,eitc,refundable credit', conclusion: 'EIC amount is ${amount} based on {children} qualifying children.', framework: 'Phase-in at credit rate, plateau, phase-out by rate × (greater of AGI or earned income minus threshold). Investment income ≤$11,600. Cannot file MFS. Must have valid SSN.', factors: 'earned_income,agi,num_children,filing_status,investment_income', authority: 'IRC §32, Rev. Proc. 2024-40', confidence: 'DEFENSIBLE' },
  { id: 'D007', engine: 'FIE', topic: 'Capital Gains Tax Rate Determination', keywords: 'capital gains,long term,short term,qualified dividends,netting', conclusion: 'Net LTCG of ${ltcg} taxed at {rate}%. Net STCG of ${stcg} taxed as ordinary income.', framework: 'STCG net STCL. LTCG net LTCL. Net STCL offsets LTCG. Excess loss deduct up to $3,000. Rates: 0%/15%/20% by income. 28% collectibles. 25% unrecaptured §1250.', factors: 'short_term_gains,short_term_losses,long_term_gains,long_term_losses,taxable_income,filing_status', authority: 'IRC §1(h), §1211, §1212', confidence: 'DEFENSIBLE' },
  { id: 'D008', engine: 'BIE', topic: 'Home Office Deduction', keywords: 'home office,8829,simplified method,business use of home', conclusion: 'Home office deduction is ${amount} using the {method} method for {sqft} sq ft.', framework: 'Regular: allocate actual expenses by business %. Simplified: $5/sq ft max 300 ($1,500). Requires regular and exclusive use as principal place of business. No employee home office 2018-2025 (TCJA).', factors: 'total_sqft,office_sqft,is_principal_place,total_expenses,is_employee', authority: 'IRC §280A, Rev. Proc. 2013-13', confidence: 'DEFENSIBLE' },
  { id: 'D009', engine: 'DEP', topic: 'Section 179 and Bonus Depreciation', keywords: 'section 179,bonus depreciation,macrs,expensing,equipment', conclusion: '§179 expense: ${sec179}. Bonus depreciation ({bonus_pct}%): ${bonus}. MACRS over {life} years: ${macrs}.', framework: '§179: $1,250,000 limit, $3,130,000 phase-out. Cannot create loss. Bonus: 40% for 2025. MACRS: 3/5/7/10/15/20/27.5/39 year classes. Luxury auto limits apply. SUV §179: $30,500.', factors: 'asset_cost,asset_type,date_placed,business_use_pct,net_income', authority: 'IRC §179, §168', confidence: 'DEFENSIBLE' },
  { id: 'D010', engine: 'AUD', topic: 'Audit Risk Assessment — DIF Score Factors', keywords: 'audit risk,dif score,examination,red flags', conclusion: 'Estimated audit risk: {risk_level}. Key factors: {factors}. Mitigation: {mitigation}.', framework: 'High-risk triggers: Schedule C losses >3 years, charitable >5% of income, large Schedule C deductions no employees, home office >30%, cash business, round numbers, crypto without reporting. Rates: <$25K 0.6%, $25K-$100K 0.4%, $500K-$1M 0.9%, >$5M 2.1%.', factors: 'total_income,schedule_c_losses,charitable_pct,home_office,cash_business,crypto_present', authority: 'IRM 4.1.3, IRM 4.10.2, GAO-22-104960', confidence: 'DEFENSIBLE' },
];

for (const b of blocks) {
  insertDoctrine.run(b.id, b.engine, b.topic, b.keywords, b.conclusion, b.framework, b.factors, b.authority, b.confidence);
}
console.log('  ✓ Doctrine blocks seeded (10 core doctrines)');

// Demo subscription
db.exec("INSERT OR IGNORE INTO subscriptions (id, user_id, tier, status) VALUES ('demo-sub-001', 'demo-user', 'professional', 'active')");
console.log('  ✓ Demo subscription created');

db.exec('COMMIT');
db.close();

console.log('\n✅ Database seeded successfully!');
console.log(`   Database: ${DB_PATH}`);
