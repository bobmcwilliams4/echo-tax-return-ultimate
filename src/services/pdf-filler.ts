// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — PDF Form Generator
// Generates professional tax return PDFs from scratch using pdf-lib
// ═══════════════════════════════════════════════════════════════════════════

import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from 'pdf-lib';
import { Database } from 'bun:sqlite';
import { getById } from './database';
import { createLogger } from '../utils/logger';

const log = createLogger('pdf-filler');

// ─── Constants ──────────────────────────────────────────────────────────

const PAGE_WIDTH = 612;   // 8.5" in points
const PAGE_HEIGHT = 792;  // 11" in points
const MARGIN_LEFT = 50;
const MARGIN_RIGHT = 50;
const MARGIN_TOP = 50;
const MARGIN_BOTTOM = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

const COLOR_BLACK = rgb(0, 0, 0);
const COLOR_DARK_GRAY = rgb(0.2, 0.2, 0.2);
const COLOR_GRAY = rgb(0.45, 0.45, 0.45);
const COLOR_LIGHT_GRAY = rgb(0.85, 0.85, 0.85);
const COLOR_HEADER_BG = rgb(0.12, 0.12, 0.18);
const COLOR_HEADER_TEXT = rgb(1, 1, 1);
const COLOR_ACCENT = rgb(0.18, 0.42, 0.72);
const COLOR_RED = rgb(0.72, 0.12, 0.12);
const COLOR_GREEN = rgb(0.1, 0.55, 0.15);

const FONT_SIZE_TITLE = 16;
const FONT_SIZE_SECTION = 11;
const FONT_SIZE_BODY = 9;
const FONT_SIZE_SMALL = 7.5;
const LINE_HEIGHT = 14;
const SECTION_GAP = 8;

// ─── Formatting Helpers ─────────────────────────────────────────────────

function fmt(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '$0.00';
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return negative ? `($${formatted})` : `$${formatted}`;
}

function fmtPct(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return '0.00%';
  return `${(rate * 100).toFixed(2)}%`;
}

function maskSSN(ssn: string | null | undefined): string {
  if (!ssn) return 'XXX-XX-XXXX';
  const last4 = ssn.slice(-4);
  return `XXX-XX-${last4}`;
}

function filingStatusLabel(status: string | null | undefined): string {
  const labels: Record<string, string> = {
    single: 'Single',
    mfj: 'Married Filing Jointly',
    mfs: 'Married Filing Separately',
    hoh: 'Head of Household',
    qss: 'Qualifying Surviving Spouse',
  };
  return labels[status || ''] || status || 'Not specified';
}

// ─── PDF Drawing Utilities ──────────────────────────────────────────────

interface DrawContext {
  page: PDFPage;
  font: PDFFont;
  fontBold: PDFFont;
  y: number;
}

function drawHeader(ctx: DrawContext, title: string, subtitle: string): void {
  const { page, fontBold, font } = ctx;

  // Dark header band
  page.drawRectangle({
    x: 0, y: PAGE_HEIGHT - 72,
    width: PAGE_WIDTH, height: 72,
    color: COLOR_HEADER_BG,
  });

  page.drawText(title, {
    x: MARGIN_LEFT, y: PAGE_HEIGHT - 35,
    size: FONT_SIZE_TITLE, font: fontBold, color: COLOR_HEADER_TEXT,
  });

  page.drawText(subtitle, {
    x: MARGIN_LEFT, y: PAGE_HEIGHT - 52,
    size: FONT_SIZE_BODY, font: font, color: rgb(0.7, 0.7, 0.7),
  });

  // Branding
  page.drawText('Echo Tax Return Ultimate', {
    x: PAGE_WIDTH - MARGIN_RIGHT - fontBold.widthOfTextAtSize('Echo Tax Return Ultimate', FONT_SIZE_SMALL),
    y: PAGE_HEIGHT - 35,
    size: FONT_SIZE_SMALL, font: fontBold, color: rgb(0.6, 0.75, 1),
  });

  ctx.y = PAGE_HEIGHT - 72 - 20;
}

function drawSectionTitle(ctx: DrawContext, title: string): void {
  const { page, fontBold } = ctx;
  ctx.y -= SECTION_GAP;

  // Section background bar
  page.drawRectangle({
    x: MARGIN_LEFT - 4, y: ctx.y - 3,
    width: CONTENT_WIDTH + 8, height: 16,
    color: rgb(0.92, 0.94, 0.97),
  });

  // Left accent line
  page.drawRectangle({
    x: MARGIN_LEFT - 4, y: ctx.y - 3,
    width: 3, height: 16,
    color: COLOR_ACCENT,
  });

  page.drawText(title.toUpperCase(), {
    x: MARGIN_LEFT + 4, y: ctx.y,
    size: FONT_SIZE_SECTION, font: fontBold, color: COLOR_ACCENT,
  });

  ctx.y -= LINE_HEIGHT + 6;
}

function drawLine(ctx: DrawContext, label: string, value: string, options?: {
  bold?: boolean; indent?: number; color?: typeof COLOR_BLACK; lineRef?: string;
}): void {
  const { page, font, fontBold } = ctx;
  const indent = options?.indent || 0;
  const useBold = options?.bold || false;
  const color = options?.color || COLOR_DARK_GRAY;
  const activeFont = useBold ? fontBold : font;

  // Line reference number (like IRS form line numbers)
  if (options?.lineRef) {
    page.drawText(options.lineRef, {
      x: MARGIN_LEFT + indent, y: ctx.y,
      size: FONT_SIZE_SMALL, font: font, color: COLOR_GRAY,
    });
  }

  const labelX = MARGIN_LEFT + indent + (options?.lineRef ? 24 : 0);

  page.drawText(label, {
    x: labelX, y: ctx.y,
    size: FONT_SIZE_BODY, font: activeFont, color,
  });

  // Right-align value
  const valueWidth = activeFont.widthOfTextAtSize(value, FONT_SIZE_BODY);
  page.drawText(value, {
    x: PAGE_WIDTH - MARGIN_RIGHT - valueWidth, y: ctx.y,
    size: FONT_SIZE_BODY, font: activeFont, color,
  });

  // Dotted leader line
  const labelEnd = labelX + activeFont.widthOfTextAtSize(label, FONT_SIZE_BODY) + 4;
  const valueStart = PAGE_WIDTH - MARGIN_RIGHT - valueWidth - 4;
  if (valueStart - labelEnd > 20) {
    const dots = '.'.repeat(Math.floor((valueStart - labelEnd) / 3.5));
    page.drawText(dots, {
      x: labelEnd, y: ctx.y,
      size: FONT_SIZE_SMALL, font: font, color: COLOR_LIGHT_GRAY,
    });
  }

  ctx.y -= LINE_HEIGHT;
}

function drawSeparator(ctx: DrawContext): void {
  ctx.page.drawLine({
    start: { x: MARGIN_LEFT, y: ctx.y + 4 },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: ctx.y + 4 },
    thickness: 0.5, color: COLOR_LIGHT_GRAY,
  });
  ctx.y -= 4;
}

function drawTotalLine(ctx: DrawContext, label: string, value: string, options?: { color?: typeof COLOR_BLACK }): void {
  const { page, fontBold } = ctx;
  const color = options?.color || COLOR_BLACK;

  // Double line above totals
  page.drawLine({
    start: { x: PAGE_WIDTH - MARGIN_RIGHT - 120, y: ctx.y + 8 },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: ctx.y + 8 },
    thickness: 0.5, color: COLOR_DARK_GRAY,
  });
  page.drawLine({
    start: { x: PAGE_WIDTH - MARGIN_RIGHT - 120, y: ctx.y + 6 },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: ctx.y + 6 },
    thickness: 0.5, color: COLOR_DARK_GRAY,
  });

  page.drawText(label, {
    x: MARGIN_LEFT, y: ctx.y,
    size: FONT_SIZE_BODY + 1, font: fontBold, color,
  });

  const valueWidth = fontBold.widthOfTextAtSize(value, FONT_SIZE_BODY + 1);
  page.drawText(value, {
    x: PAGE_WIDTH - MARGIN_RIGHT - valueWidth, y: ctx.y,
    size: FONT_SIZE_BODY + 1, font: fontBold, color,
  });

  ctx.y -= LINE_HEIGHT + 4;
}

function drawFooter(ctx: DrawContext, pageNum: number, totalPages: number, disclaimer?: string): void {
  const { page, font } = ctx;
  const footY = MARGIN_BOTTOM - 10;

  page.drawLine({
    start: { x: MARGIN_LEFT, y: footY + 14 },
    end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: footY + 14 },
    thickness: 0.5, color: COLOR_LIGHT_GRAY,
  });

  const discText = disclaimer || 'CONFIDENTIAL — For taxpayer use only. Not for submission to the IRS.';
  page.drawText(discText, {
    x: MARGIN_LEFT, y: footY,
    size: FONT_SIZE_SMALL, font, color: COLOR_GRAY,
  });

  const pageText = `Page ${pageNum} of ${totalPages}`;
  const pageTextWidth = font.widthOfTextAtSize(pageText, FONT_SIZE_SMALL);
  page.drawText(pageText, {
    x: PAGE_WIDTH - MARGIN_RIGHT - pageTextWidth, y: footY,
    size: FONT_SIZE_SMALL, font, color: COLOR_GRAY,
  });
}

function checkPageBreak(ctx: DrawContext, pdfDoc: PDFDocument, needed: number): PDFPage {
  if (ctx.y - needed < MARGIN_BOTTOM + 20) {
    const newPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    ctx.page = newPage;
    ctx.y = PAGE_HEIGHT - MARGIN_TOP - 10;
    return newPage;
  }
  return ctx.page;
}

// ═══════════════════════════════════════════════════════════════════════════
// FORM 1040 — U.S. Individual Income Tax Return Summary
// ═══════════════════════════════════════════════════════════════════════════

export async function generateForm1040(
  returnData: any,
  clientData: any,
  incomeItems: any[],
  deductions: any[],
  dependents: any[],
): Promise<Uint8Array> {
  const t0 = Date.now();
  log.info({ returnId: returnData?.id }, 'Generating Form 1040 PDF');

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Form 1040 — Tax Year ${returnData?.tax_year || 2025}`);
  pdfDoc.setAuthor('Echo Tax Return Ultimate');
  pdfDoc.setSubject('U.S. Individual Income Tax Return');
  pdfDoc.setProducer('Echo Tax Return Ultimate v1.0');

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // ── PAGE 1 ──────────────────────────────────────────────────────────
  const page1 = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const ctx: DrawContext = { page: page1, font, fontBold, y: PAGE_HEIGHT - MARGIN_TOP };

  drawHeader(ctx, `Form 1040 — Tax Year ${returnData?.tax_year || 2025}`, 'U.S. Individual Income Tax Return Summary');

  // Filing Information
  drawSectionTitle(ctx, 'Filing Information');
  drawLine(ctx, 'Taxpayer Name', `${clientData?.first_name || ''} ${clientData?.middle_name ? clientData.middle_name + ' ' : ''}${clientData?.last_name || ''}`.trim() || 'N/A');
  if (clientData?.suffix) {
    drawLine(ctx, 'Suffix', clientData.suffix);
  }
  drawLine(ctx, 'SSN', maskSSN(clientData?.ssn_last4 ? `XXXXX${clientData.ssn_last4}` : clientData?.ssn));
  drawLine(ctx, 'Filing Status', filingStatusLabel(returnData?.filing_status || clientData?.filing_status));

  if (returnData?.filing_status === 'mfj' || clientData?.filing_status === 'mfj') {
    drawLine(ctx, 'Spouse Name', `${clientData?.spouse_first_name || ''} ${clientData?.spouse_last_name || ''}`.trim() || 'N/A', { indent: 12 });
    drawLine(ctx, 'Spouse SSN', maskSSN(clientData?.spouse_ssn_last4 ? `XXXXX${clientData.spouse_ssn_last4}` : null), { indent: 12 });
  }

  const addressParts = [clientData?.address_street, clientData?.address_city, clientData?.address_state, clientData?.address_zip].filter(Boolean);
  drawLine(ctx, 'Address', addressParts.join(', ') || 'N/A');
  drawLine(ctx, 'Occupation', clientData?.occupation || 'N/A');

  if (dependents.length > 0) {
    drawLine(ctx, 'Dependents', `${dependents.length}`);
    for (const dep of dependents) {
      const depName = `${dep.first_name || ''} ${dep.last_name || ''}`.trim();
      const depInfo = [dep.relationship, dep.dob].filter(Boolean).join(', ');
      const qualifications: string[] = [];
      if (dep.qualifies_ctc) qualifications.push('CTC');
      if (dep.qualifies_odc) qualifications.push('ODC');
      if (dep.qualifies_eic) qualifications.push('EIC');
      drawLine(ctx, `  ${depName}`, `${depInfo}${qualifications.length ? ' [' + qualifications.join(', ') + ']' : ''}`, { indent: 16 });
    }
  }

  drawSeparator(ctx);

  // Income Section
  drawSectionTitle(ctx, 'Income');

  // Group income by category
  const incomeByCategory: Record<string, { items: any[]; total: number }> = {};
  for (const item of incomeItems) {
    const cat = item.category || 'other';
    if (!incomeByCategory[cat]) incomeByCategory[cat] = { items: [], total: 0 };
    incomeByCategory[cat].items.push(item);
    incomeByCategory[cat].total += (item.amount || 0);
  }

  const categoryLabels: Record<string, string> = {
    wages: 'Wages, salaries, tips (W-2)', salary: 'Salary (W-2)', tips: 'Tips',
    interest: 'Taxable interest', dividends: 'Ordinary dividends',
    qualified_dividends: 'Qualified dividends', business: 'Business income (Sch C)',
    capital_gains_short: 'Short-term capital gains', capital_gains_long: 'Long-term capital gains',
    capital_gains: 'Capital gains', rental: 'Rental real estate income',
    partnership: 'Partnership income (K-1)', s_corp: 'S corporation income (K-1)',
    pension: 'Pensions and annuities', ira_distribution: 'IRA distributions',
    social_security: 'Social Security benefits', unemployment: 'Unemployment compensation',
    state_refund: 'State/local income tax refund', crypto: 'Cryptocurrency gains',
    nec_1099: 'Nonemployee compensation (1099-NEC)', misc_1099: 'Miscellaneous income (1099-MISC)',
    other: 'Other income',
  };

  let lineNum = 1;
  for (const [cat, data] of Object.entries(incomeByCategory)) {
    checkPageBreak(ctx, pdfDoc, LINE_HEIGHT * (data.items.length + 1));
    const label = categoryLabels[cat] || cat.replace(/_/g, ' ');

    if (data.items.length === 1) {
      const item = data.items[0];
      const payer = item.payer_name ? ` (${item.payer_name})` : '';
      drawLine(ctx, `${label}${payer}`, fmt(item.amount), { lineRef: `${lineNum}` });
    } else {
      drawLine(ctx, label, fmt(data.total), { lineRef: `${lineNum}`, bold: true });
      for (const item of data.items) {
        const payer = item.payer_name ? item.payer_name : (item.description || '');
        drawLine(ctx, payer || 'Item', fmt(item.amount), { indent: 28 });
      }
    }
    lineNum++;
  }

  drawSeparator(ctx);
  drawTotalLine(ctx, 'Total Income (Line 9)', fmt(returnData?.total_income));

  // Adjustments to Income
  checkPageBreak(ctx, pdfDoc, 80);
  drawSectionTitle(ctx, 'Adjustments to Income');

  const aboveLineDeductions = deductions.filter((d: any) =>
    ['student_loan_interest', 'educator_expense', 'hsa_contribution', 'ira_contribution',
     'self_employment_tax_deduction', 'self_employment_health', 'penalty_early_withdrawal',
     'alimony_paid', 'moving_expense_military', 'other_above_line'].includes(d.category)
  );

  const adjustmentLabels: Record<string, string> = {
    student_loan_interest: 'Student loan interest deduction',
    educator_expense: 'Educator expenses',
    hsa_contribution: 'Health savings account deduction',
    ira_contribution: 'IRA deduction',
    self_employment_tax_deduction: 'Deductible part of self-employment tax',
    self_employment_health: 'Self-employed health insurance deduction',
    penalty_early_withdrawal: 'Penalty on early withdrawal of savings',
    alimony_paid: 'Alimony paid',
    moving_expense_military: 'Moving expenses for Armed Forces',
    other_above_line: 'Other adjustments',
  };

  if (aboveLineDeductions.length > 0) {
    for (const adj of aboveLineDeductions) {
      const label = adjustmentLabels[adj.category] || adj.category.replace(/_/g, ' ');
      drawLine(ctx, label, fmt(adj.amount), { indent: 4 });
    }
  } else {
    drawLine(ctx, 'No adjustments to income', '$0.00');
  }

  const totalAdjustments = returnData?.total_adjustments || aboveLineDeductions.reduce((sum: number, d: any) => sum + (d.amount || 0), 0);
  drawSeparator(ctx);
  drawTotalLine(ctx, 'Total Adjustments (Line 10)', fmt(totalAdjustments));
  drawLine(ctx, 'Adjusted Gross Income (Line 11)', fmt(returnData?.adjusted_gross_income), { bold: true });

  // ── PAGE 2 ──────────────────────────────────────────────────────────
  checkPageBreak(ctx, pdfDoc, 200);

  // Deduction
  drawSectionTitle(ctx, 'Deductions');
  const method = returnData?.deduction_method || 'standard';
  drawLine(ctx, 'Deduction Method', method === 'itemized' ? 'Itemized Deductions (Schedule A)' : 'Standard Deduction');

  if (method === 'standard') {
    drawLine(ctx, 'Standard Deduction', fmt(returnData?.standard_deduction_amount), { indent: 4 });
  } else {
    drawLine(ctx, 'Itemized Deduction Total', fmt(returnData?.itemized_deduction_amount), { indent: 4 });
  }

  if (returnData?.qbi_deduction > 0) {
    drawLine(ctx, 'Qualified Business Income Deduction (Section 199A)', fmt(returnData.qbi_deduction), { indent: 4 });
  }

  const totalDeductions = (method === 'standard' ? (returnData?.standard_deduction_amount || 0) : (returnData?.itemized_deduction_amount || 0)) + (returnData?.qbi_deduction || 0);
  drawSeparator(ctx);
  drawTotalLine(ctx, 'Total Deductions (Line 14)', fmt(totalDeductions));

  // Taxable Income
  drawLine(ctx, 'Taxable Income (Line 15)', fmt(returnData?.taxable_income), { bold: true });
  ctx.y -= 4;

  // Tax and Credits
  checkPageBreak(ctx, pdfDoc, 160);
  drawSectionTitle(ctx, 'Tax Computation');
  drawLine(ctx, 'Tax (from tax table/computation)', fmt(returnData?.total_tax ? returnData.total_tax - (returnData?.self_employment_tax || 0) - (returnData?.amt_amount || 0) - (returnData?.niit_amount || 0) : 0));

  if (returnData?.self_employment_tax > 0) {
    drawLine(ctx, 'Self-employment tax', fmt(returnData.self_employment_tax), { indent: 4 });
  }
  if (returnData?.amt_amount > 0) {
    drawLine(ctx, 'Alternative minimum tax (Form 6251)', fmt(returnData.amt_amount), { indent: 4 });
  }
  if (returnData?.niit_amount > 0) {
    drawLine(ctx, 'Net investment income tax (Form 8960)', fmt(returnData.niit_amount), { indent: 4 });
  }

  drawSeparator(ctx);
  drawTotalLine(ctx, 'Total Tax (Line 24)', fmt(returnData?.total_tax));

  // Credits
  checkPageBreak(ctx, pdfDoc, 100);
  drawSectionTitle(ctx, 'Credits');
  if (returnData?.total_credits > 0) {
    // We display known credit categories from the calculation result
    drawLine(ctx, 'Total Nonrefundable + Refundable Credits', fmt(returnData.total_credits));
  } else {
    drawLine(ctx, 'Total Credits', '$0.00');
  }

  // Payments
  checkPageBreak(ctx, pdfDoc, 100);
  drawSectionTitle(ctx, 'Payments');
  const totalWithholding = returnData?.total_withholding || incomeItems.reduce((sum: number, i: any) => sum + (i.tax_withheld || 0), 0);
  drawLine(ctx, 'Federal income tax withheld (W-2s, 1099s)', fmt(totalWithholding));

  if (returnData?.estimated_payments > 0) {
    drawLine(ctx, 'Estimated tax payments (Form 1040-ES)', fmt(returnData.estimated_payments));
  }

  drawSeparator(ctx);
  drawTotalLine(ctx, 'Total Payments (Line 33)', fmt(returnData?.total_payments));

  // Refund or Amount Owed
  checkPageBreak(ctx, pdfDoc, 80);
  drawSectionTitle(ctx, 'Refund or Amount You Owe');

  const refundOrOwed = returnData?.refund_or_owed || 0;
  if (refundOrOwed > 0) {
    drawTotalLine(ctx, 'AMOUNT OVERPAID (Refund)', fmt(refundOrOwed), { color: COLOR_GREEN });
  } else if (refundOrOwed < 0) {
    drawTotalLine(ctx, 'AMOUNT YOU OWE', fmt(Math.abs(refundOrOwed)), { color: COLOR_RED });
  } else {
    drawTotalLine(ctx, 'Balance', '$0.00 (Even)');
  }

  // Tax Rates Summary
  checkPageBreak(ctx, pdfDoc, 60);
  drawSectionTitle(ctx, 'Rate Summary');
  drawLine(ctx, 'Effective Tax Rate', fmtPct(returnData?.effective_rate));
  drawLine(ctx, 'Marginal Tax Rate', fmtPct(returnData?.marginal_rate));

  // Preparer info
  if (returnData?.preparer_name) {
    checkPageBreak(ctx, pdfDoc, 60);
    drawSectionTitle(ctx, 'Paid Preparer');
    drawLine(ctx, 'Preparer Name', returnData.preparer_name);
    if (returnData.preparer_ptin) drawLine(ctx, 'PTIN', returnData.preparer_ptin);
    if (returnData.firm_name) drawLine(ctx, 'Firm Name', returnData.firm_name);
    if (returnData.firm_ein) drawLine(ctx, 'Firm EIN', returnData.firm_ein);
  }

  // Add footers to all pages
  const pages = pdfDoc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const footCtx: DrawContext = { page: pages[i], font, fontBold, y: 0 };
    drawFooter(footCtx, i + 1, pages.length);
  }

  const pdfBytes = await pdfDoc.save();
  log.info({ returnId: returnData?.id, pages: pages.length, bytes: pdfBytes.length, ms: Date.now() - t0 }, 'Form 1040 PDF generated');
  return pdfBytes;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULE C — Profit or Loss From Business
// ═══════════════════════════════════════════════════════════════════════════

export async function generateScheduleC(
  returnData: any,
  businessIncome: any[],
): Promise<Uint8Array> {
  const t0 = Date.now();
  log.info({ returnId: returnData?.id }, 'Generating Schedule C PDF');

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Schedule C — Tax Year ${returnData?.tax_year || 2025}`);
  pdfDoc.setAuthor('Echo Tax Return Ultimate');

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const ctx: DrawContext = { page, font, fontBold, y: PAGE_HEIGHT - MARGIN_TOP };

  drawHeader(ctx, `Schedule C — Tax Year ${returnData?.tax_year || 2025}`, 'Profit or Loss From Business (Sole Proprietorship)');

  // Part I: Income
  drawSectionTitle(ctx, 'Part I — Gross Income');

  const incomeEntries = businessIncome.filter((i: any) =>
    ['business', 'nec_1099', 'misc_1099'].includes(i.category) && (i.amount || 0) >= 0
  );

  let grossReceipts = 0;
  for (const item of incomeEntries) {
    const label = item.payer_name || item.description || item.category?.replace(/_/g, ' ') || 'Business income';
    drawLine(ctx, label, fmt(item.amount), { indent: 4 });
    grossReceipts += (item.amount || 0);
  }

  if (incomeEntries.length === 0) {
    drawLine(ctx, 'No business income reported', '$0.00');
  }

  drawSeparator(ctx);
  drawTotalLine(ctx, 'Gross Receipts or Sales (Line 1)', fmt(grossReceipts));
  drawLine(ctx, 'Returns and allowances', '$0.00', { lineRef: '2' });
  drawTotalLine(ctx, 'Gross Income (Line 7)', fmt(grossReceipts));

  // Part II: Expenses
  drawSectionTitle(ctx, 'Part II — Expenses');

  const expenseItems = businessIncome.filter((i: any) =>
    ['business_expense', 'home_office', 'vehicle', 'depreciation'].includes(i.category)
  );

  const expenseLabels: Record<string, string> = {
    business_expense: 'Other business expenses',
    home_office: 'Business use of home (Form 8829)',
    vehicle: 'Car and truck expenses',
    depreciation: 'Depreciation (Form 4562)',
  };

  let totalExpenses = 0;
  if (expenseItems.length > 0) {
    for (const exp of expenseItems) {
      const label = expenseLabels[exp.category] || exp.description || exp.category?.replace(/_/g, ' ');
      drawLine(ctx, label, fmt(exp.amount), { indent: 4 });
      totalExpenses += (exp.amount || 0);
    }
  } else {
    drawLine(ctx, 'No business expenses reported', '$0.00');
  }

  drawSeparator(ctx);
  drawTotalLine(ctx, 'Total Expenses (Line 28)', fmt(totalExpenses));

  // Net Profit
  ctx.y -= 6;
  const netProfit = grossReceipts - totalExpenses;
  drawTotalLine(ctx, 'Net Profit or (Loss) (Line 31)', fmt(netProfit), { color: netProfit >= 0 ? COLOR_GREEN : COLOR_RED });

  // Footer
  const pages = pdfDoc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const footCtx: DrawContext = { page: pages[i], font, fontBold, y: 0 };
    drawFooter(footCtx, i + 1, pages.length);
  }

  const pdfBytes = await pdfDoc.save();
  log.info({ returnId: returnData?.id, bytes: pdfBytes.length, ms: Date.now() - t0 }, 'Schedule C PDF generated');
  return pdfBytes;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULE A — Itemized Deductions
// ═══════════════════════════════════════════════════════════════════════════

export async function generateScheduleA(
  returnData: any,
  itemizedDeductions: any[],
): Promise<Uint8Array> {
  const t0 = Date.now();
  log.info({ returnId: returnData?.id }, 'Generating Schedule A PDF');

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Schedule A — Tax Year ${returnData?.tax_year || 2025}`);
  pdfDoc.setAuthor('Echo Tax Return Ultimate');

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const ctx: DrawContext = { page, font, fontBold, y: PAGE_HEIGHT - MARGIN_TOP };

  drawHeader(ctx, `Schedule A — Tax Year ${returnData?.tax_year || 2025}`, 'Itemized Deductions');

  // Group deductions by IRS Schedule A sections
  const sections: { title: string; categories: string[]; lineRef: string }[] = [
    { title: 'Medical and Dental Expenses', categories: ['medical'], lineRef: '1-4' },
    { title: 'Taxes You Paid', categories: ['state_local_taxes', 'property_taxes'], lineRef: '5-7' },
    { title: 'Interest You Paid', categories: ['mortgage_interest', 'investment_expense'], lineRef: '8-10' },
    { title: 'Gifts to Charity', categories: ['charitable_cash', 'charitable_noncash'], lineRef: '11-14' },
    { title: 'Casualty and Theft Losses', categories: ['casualty_loss'], lineRef: '15' },
    { title: 'Other Itemized Deductions', categories: ['gambling_loss', 'other_itemized'], lineRef: '16' },
  ];

  const deductionLabels: Record<string, string> = {
    medical: 'Medical and dental expenses (after AGI floor)',
    state_local_taxes: 'State and local income taxes (SALT)',
    property_taxes: 'Real estate taxes',
    mortgage_interest: 'Home mortgage interest (Form 1098)',
    investment_expense: 'Investment interest expense',
    charitable_cash: 'Gifts by cash or check',
    charitable_noncash: 'Gifts other than cash or check',
    casualty_loss: 'Casualty and theft losses',
    gambling_loss: 'Gambling losses (to extent of winnings)',
    other_itemized: 'Other itemized deductions',
  };

  let grandTotal = 0;

  for (const section of sections) {
    const sectionItems = itemizedDeductions.filter((d: any) => section.categories.includes(d.category));
    if (sectionItems.length === 0) continue;

    checkPageBreak(ctx, pdfDoc, LINE_HEIGHT * (sectionItems.length + 3));
    drawSectionTitle(ctx, `${section.title} (Lines ${section.lineRef})`);

    let sectionTotal = 0;
    for (const item of sectionItems) {
      const label = item.description || deductionLabels[item.category] || item.category?.replace(/_/g, ' ');
      const displayAmount = item.limited_amount !== null && item.limited_amount !== undefined ? item.limited_amount : item.amount;
      drawLine(ctx, label, fmt(displayAmount), { indent: 4 });

      if (item.limited_amount !== null && item.limited_amount !== undefined && item.limited_amount !== item.amount) {
        drawLine(ctx, `  (Claimed: ${fmt(item.amount)}, Limited to: ${fmt(item.limited_amount)})`, '', { indent: 20, color: COLOR_GRAY });
      }
      sectionTotal += (displayAmount || 0);
    }

    drawSeparator(ctx);
    drawLine(ctx, `Subtotal — ${section.title}`, fmt(sectionTotal), { bold: true });
    grandTotal += sectionTotal;
  }

  if (itemizedDeductions.length === 0) {
    drawLine(ctx, 'No itemized deductions reported', '$0.00');
  }

  // Total
  ctx.y -= 8;
  drawTotalLine(ctx, 'Total Itemized Deductions (Line 17)', fmt(grandTotal));

  // Comparison with standard deduction
  ctx.y -= 4;
  drawSectionTitle(ctx, 'Standard Deduction Comparison');
  drawLine(ctx, 'Standard deduction for filing status', fmt(returnData?.standard_deduction_amount));
  drawLine(ctx, 'Your itemized deductions', fmt(grandTotal));
  const benefit = grandTotal - (returnData?.standard_deduction_amount || 0);
  if (benefit > 0) {
    drawLine(ctx, 'Itemizing saves you', fmt(benefit), { bold: true, color: COLOR_GREEN });
  } else {
    drawLine(ctx, 'Standard deduction is better by', fmt(Math.abs(benefit)), { bold: true, color: COLOR_ACCENT });
  }

  // Footer
  const pages = pdfDoc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const footCtx: DrawContext = { page: pages[i], font, fontBold, y: 0 };
    drawFooter(footCtx, i + 1, pages.length);
  }

  const pdfBytes = await pdfDoc.save();
  log.info({ returnId: returnData?.id, bytes: pdfBytes.length, ms: Date.now() - t0 }, 'Schedule A PDF generated');
  return pdfBytes;
}

// ═══════════════════════════════════════════════════════════════════════════
// TAX SUMMARY — Executive One-Page Summary
// ═══════════════════════════════════════════════════════════════════════════

export async function generateTaxSummaryPDF(
  returnData: any,
  clientData: any,
  calculation: any,
): Promise<Uint8Array> {
  const t0 = Date.now();
  log.info({ returnId: returnData?.id }, 'Generating Tax Summary PDF');

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Tax Summary — ${returnData?.tax_year || 2025}`);
  pdfDoc.setAuthor('Echo Tax Return Ultimate');

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const ctx: DrawContext = { page, font, fontBold, y: PAGE_HEIGHT - MARGIN_TOP };

  const clientName = `${clientData?.first_name || ''} ${clientData?.last_name || ''}`.trim() || 'Taxpayer';
  drawHeader(ctx, `Tax Summary — ${returnData?.tax_year || 2025}`, `Prepared for ${clientName}`);

  // Key Numbers at a Glance
  drawSectionTitle(ctx, 'Key Numbers at a Glance');

  const calc = calculation || returnData || {};

  drawLine(ctx, 'Total Income', fmt(calc.total_income), { bold: true });
  drawLine(ctx, 'Adjusted Gross Income', fmt(calc.adjusted_gross_income));
  drawLine(ctx, 'Taxable Income', fmt(calc.taxable_income));
  drawLine(ctx, 'Total Tax', fmt(calc.total_tax), { bold: true });
  drawLine(ctx, 'Total Credits', fmt(calc.total_credits));
  drawLine(ctx, 'Total Payments & Withholding', fmt(calc.total_payments));

  ctx.y -= 4;
  const refund = calc.refund_or_owed || 0;
  if (refund > 0) {
    drawTotalLine(ctx, 'YOUR REFUND', fmt(refund), { color: COLOR_GREEN });
  } else if (refund < 0) {
    drawTotalLine(ctx, 'AMOUNT YOU OWE', fmt(Math.abs(refund)), { color: COLOR_RED });
  } else {
    drawTotalLine(ctx, 'BALANCE', '$0.00');
  }

  // Tax Rate Analysis
  drawSectionTitle(ctx, 'Tax Rate Analysis');
  drawLine(ctx, 'Effective Tax Rate', fmtPct(calc.effective_rate));
  drawLine(ctx, 'Marginal Tax Rate', fmtPct(calc.marginal_rate));

  // Tax Composition (text-based bar chart)
  drawSectionTitle(ctx, 'Tax Composition');
  const totalTax = calc.total_tax || 1;
  const ordinaryTax = calc.ordinary_tax || (totalTax - (calc.self_employment_tax || 0) - (calc.amt || calc.amt_amount || 0) - (calc.niit || calc.niit_amount || 0) - (calc.capital_gains_tax || 0));

  const components: { label: string; amount: number }[] = [
    { label: 'Ordinary Income Tax', amount: ordinaryTax },
    { label: 'Capital Gains Tax', amount: calc.capital_gains_tax || 0 },
    { label: 'Self-Employment Tax', amount: calc.self_employment_tax || 0 },
    { label: 'AMT', amount: calc.amt || calc.amt_amount || 0 },
    { label: 'NIIT', amount: calc.niit || calc.niit_amount || 0 },
  ].filter(c => c.amount > 0);

  const barWidth = 300;
  for (const comp of components) {
    const pct = totalTax > 0 ? comp.amount / totalTax : 0;
    const barLen = Math.max(1, Math.round(pct * barWidth / 4));

    // Draw bar
    page.drawRectangle({
      x: MARGIN_LEFT + 4, y: ctx.y - 2,
      width: barLen, height: 10,
      color: COLOR_ACCENT,
    });

    // Label to the right of bar
    const pctText = `${(pct * 100).toFixed(1)}%`;
    page.drawText(`${comp.label}: ${fmt(comp.amount)} (${pctText})`, {
      x: MARGIN_LEFT + barLen + 10, y: ctx.y,
      size: FONT_SIZE_BODY, font, color: COLOR_DARK_GRAY,
    });

    ctx.y -= LINE_HEIGHT + 2;
  }

  // Income Breakdown
  ctx.y -= 4;
  drawSectionTitle(ctx, 'Income Breakdown');
  drawLine(ctx, 'Filing Status', filingStatusLabel(returnData?.filing_status || clientData?.filing_status));
  drawLine(ctx, 'Deduction Method', (calc.deduction_method || returnData?.deduction_method || 'standard') === 'itemized' ? 'Itemized' : 'Standard');
  drawLine(ctx, 'Deduction Amount', fmt(calc.deduction_amount || (calc.deduction_method === 'itemized' ? calc.itemized_deduction_amount : calc.standard_deduction_amount)));

  if (calc.qbi_deduction > 0) {
    drawLine(ctx, 'QBI Deduction (Sec 199A)', fmt(calc.qbi_deduction));
  }

  // Warnings / Optimization
  const warnings = calc.warnings || [];
  const suggestions = calc.optimization_suggestions || [];

  if (warnings.length > 0) {
    checkPageBreak(ctx, pdfDoc, LINE_HEIGHT * (warnings.length + 2));
    drawSectionTitle(ctx, 'Warnings');
    for (const w of warnings) {
      drawLine(ctx, `  ${w}`, '', { color: COLOR_RED });
    }
  }

  if (suggestions.length > 0) {
    checkPageBreak(ctx, pdfDoc, LINE_HEIGHT * (suggestions.length + 2));
    drawSectionTitle(ctx, 'Optimization Opportunities');
    for (const s of suggestions) {
      drawLine(ctx, `  ${s}`, '', { color: COLOR_GREEN });
    }
  }

  // Forms Generated
  const forms = calc.forms_generated || [];
  if (forms.length > 0) {
    checkPageBreak(ctx, pdfDoc, LINE_HEIGHT * 3);
    drawSectionTitle(ctx, 'Forms Included');
    drawLine(ctx, forms.join(', '), '');
  }

  // Footer
  const pages = pdfDoc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const footCtx: DrawContext = { page: pages[i], font, fontBold, y: 0 };
    drawFooter(footCtx, i + 1, pages.length);
  }

  const pdfBytes = await pdfDoc.save();
  log.info({ returnId: returnData?.id, bytes: pdfBytes.length, ms: Date.now() - t0 }, 'Tax Summary PDF generated');
  return pdfBytes;
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERATE ALL FORMS — Builds complete PDF package for a return
// ═══════════════════════════════════════════════════════════════════════════

export async function generateAllForms(
  db: Database,
  returnId: string,
): Promise<{ name: string; data: Uint8Array }[]> {
  const t0 = Date.now();
  log.info({ returnId }, 'Generating all forms for return');

  const returnData = getById(db, 'tax_returns', returnId) as Record<string, any> | undefined;
  if (!returnData) {
    throw new Error(`Return not found: ${returnId}`);
  }

  const clientData = returnData.client_id
    ? getById(db, 'clients', returnData.client_id as string) as Record<string, any> | undefined
    : undefined;

  const incomeItems = db.prepare('SELECT * FROM income_items WHERE return_id = ? ORDER BY category, amount DESC').all(returnId) as any[];
  const deductions = db.prepare('SELECT * FROM deductions WHERE return_id = ? ORDER BY category, amount DESC').all(returnId) as any[];
  const dependents = db.prepare('SELECT * FROM dependents WHERE return_id = ? ORDER BY first_name').all(returnId) as any[];

  const forms: { name: string; data: Uint8Array }[] = [];

  // Always generate Form 1040
  const form1040 = await generateForm1040(returnData, clientData, incomeItems, deductions, dependents);
  forms.push({ name: 'Form1040', data: form1040 });

  // Always generate Tax Summary
  const summary = await generateTaxSummaryPDF(returnData, clientData, returnData);
  forms.push({ name: 'TaxSummary', data: summary });

  // Schedule C if business income exists
  const hasBusiness = incomeItems.some((i: any) => ['business', 'nec_1099'].includes(i.category));
  if (hasBusiness) {
    const schedC = await generateScheduleC(returnData, incomeItems);
    forms.push({ name: 'ScheduleC', data: schedC });
  }

  // Schedule A if itemizing
  if (returnData.deduction_method === 'itemized') {
    const itemizedDeductions = deductions.filter((d: any) =>
      ['medical', 'state_local_taxes', 'property_taxes', 'mortgage_interest',
       'charitable_cash', 'charitable_noncash', 'casualty_loss', 'gambling_loss',
       'investment_expense', 'other_itemized'].includes(d.category)
    );
    const schedA = await generateScheduleA(returnData, itemizedDeductions);
    forms.push({ name: 'ScheduleA', data: schedA });
  }

  log.info({ returnId, formCount: forms.length, totalBytes: forms.reduce((s, f) => s + f.data.length, 0), ms: Date.now() - t0 }, 'All forms generated');
  return forms;
}
