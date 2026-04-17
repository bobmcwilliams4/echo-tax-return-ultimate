// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — OCR / Document Extraction Service
// Pattern-based tax document field extraction for W-2, 1099-INT/DIV/NEC/MISC
// ═══════════════════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger';

const log = createLogger('ocr-service');

// ─── Extracted Data Type Definitions ──────────────────────────────────────

export interface W2Data {
  form_type: 'W-2';
  employer_ein: string | null;
  employer_name: string | null;
  employer_address: string | null;
  employee_ssn: string | null;
  employee_name: string | null;
  employee_address: string | null;
  box1_wages: number | null;
  box2_federal_tax_withheld: number | null;
  box3_ss_wages: number | null;
  box4_ss_tax_withheld: number | null;
  box5_medicare_wages: number | null;
  box6_medicare_tax_withheld: number | null;
  box12: Box12Entry[];
  box14_other: string | null;
  box15_state: string | null;
  box16_state_wages: number | null;
  box17_state_tax: number | null;
}

export interface Box12Entry {
  code: string;
  amount: number | null;
}

export interface Form1099IntData {
  form_type: '1099-INT';
  payer_name: string | null;
  payer_tin: string | null;
  recipient_name: string | null;
  recipient_tin: string | null;
  box1_interest_income: number | null;
  box2_early_withdrawal_penalty: number | null;
  box3_us_savings_bond_interest: number | null;
  box4_federal_tax_withheld: number | null;
}

export interface Form1099DivData {
  form_type: '1099-DIV';
  payer_name: string | null;
  payer_tin: string | null;
  recipient_name: string | null;
  recipient_tin: string | null;
  box1a_ordinary_dividends: number | null;
  box1b_qualified_dividends: number | null;
  box2a_capital_gain_distributions: number | null;
  box4_federal_tax_withheld: number | null;
}

export interface Form1099NecData {
  form_type: '1099-NEC';
  payer_name: string | null;
  payer_tin: string | null;
  recipient_name: string | null;
  recipient_tin: string | null;
  box1_nonemployee_compensation: number | null;
  box4_federal_tax_withheld: number | null;
}

export interface Form1099MiscData {
  form_type: '1099-MISC';
  payer_name: string | null;
  payer_tin: string | null;
  recipient_name: string | null;
  recipient_tin: string | null;
  box1_rents: number | null;
  box2_royalties: number | null;
  box3_other_income: number | null;
  box4_federal_tax_withheld: number | null;
}

export type ExtractedTaxDocument = W2Data | Form1099IntData | Form1099DivData | Form1099NecData | Form1099MiscData;

export type SupportedFormType = 'W-2' | '1099-INT' | '1099-DIV' | '1099-NEC' | '1099-MISC';

export interface ExtractionResult {
  success: boolean;
  form_type: SupportedFormType | 'unknown';
  confidence: number;
  data: ExtractedTaxDocument | null;
  warnings: string[];
  raw_fields_found: number;
}

// ─── Currency Parsing ─────────────────────────────────────────────────────

function parseCurrency(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, '').replace(/[()]/g, '-');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : Math.round(num * 100) / 100;
}

// ─── SSN / EIN Extraction ─────────────────────────────────────────────────

const SSN_PATTERN = /\b(\d{3}[-\s]?\d{2}[-\s]?\d{4})\b/;
const EIN_PATTERN = /\b(\d{2}[-\s]?\d{7})\b/;
const CURRENCY_PATTERN = /\$?\s*[\d,]+\.\d{2}/;

function extractSSN(text: string, context?: RegExp): string | null {
  if (context) {
    const block = context.exec(text);
    if (block) {
      const match = SSN_PATTERN.exec(block[0]);
      return match ? match[1].replace(/\s/g, '') : null;
    }
  }
  const match = SSN_PATTERN.exec(text);
  return match ? match[1].replace(/\s/g, '') : null;
}

function extractEIN(text: string, context?: RegExp): string | null {
  if (context) {
    const block = context.exec(text);
    if (block) {
      const match = EIN_PATTERN.exec(block[0]);
      return match ? match[1].replace(/\s/g, '') : null;
    }
  }
  const match = EIN_PATTERN.exec(text);
  return match ? match[1].replace(/\s/g, '') : null;
}

// ─── Generic Field Extraction ─────────────────────────────────────────────

function extractAmountNear(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      // Look for amount in the match groups or nearby text
      for (let i = 1; i < match.length; i++) {
        const val = parseCurrency(match[i]);
        if (val !== null) return val;
      }
      // If no group captured a currency, look for one right after the match
      const afterMatch = text.slice(match.index + match[0].length, match.index + match[0].length + 40);
      const currMatch = CURRENCY_PATTERN.exec(afterMatch);
      if (currMatch) return parseCurrency(currMatch[0]);
    }
  }
  return null;
}

function extractTextNear(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

// ─── Multi-line Name / Address Extraction ─────────────────────────────────

function extractNameBlock(text: string, label: RegExp): string | null {
  const match = label.exec(text);
  if (!match) return null;
  const after = text.slice(match.index + match[0].length, match.index + match[0].length + 200);
  // Grab the first non-empty line
  const lines = after.split(/\n/).map(l => l.trim()).filter(Boolean);
  return lines[0] || null;
}

function extractAddressBlock(text: string, label: RegExp): string | null {
  const match = label.exec(text);
  if (!match) return null;
  const after = text.slice(match.index + match[0].length, match.index + match[0].length + 300);
  const lines = after.split(/\n/).map(l => l.trim()).filter(Boolean);
  // Grab up to 3 lines for address (street, city/state/zip)
  return lines.slice(0, 3).join(', ') || null;
}

// ─── Auto-detect Form Type ───────────────────────────────────────────────

const FORM_SIGNATURES: Array<{ type: SupportedFormType; patterns: RegExp[]; weight: number }> = [
  {
    type: 'W-2',
    patterns: [
      /\bW-?2\b/i,
      /wage\s+and\s+tax\s+statement/i,
      /wages[\s,]+tips[\s,]+other\s+compensation/i,
      /social\s+security\s+wages/i,
      /medicare\s+wages/i,
      /employer['']?s?\s+(name|identification|EIN)/i,
    ],
    weight: 1,
  },
  {
    type: '1099-INT',
    patterns: [
      /1099-?\s*INT/i,
      /interest\s+income/i,
      /early\s+withdrawal\s+penalty/i,
      /interest\s+on\s+U\.?S\.?\s+savings\s+bonds/i,
    ],
    weight: 1,
  },
  {
    type: '1099-DIV',
    patterns: [
      /1099-?\s*DIV/i,
      /ordinary\s+dividends/i,
      /qualified\s+dividends/i,
      /capital\s+gain\s+distributions?/i,
    ],
    weight: 1,
  },
  {
    type: '1099-NEC',
    patterns: [
      /1099-?\s*NEC/i,
      /nonemployee\s+compensation/i,
      /non-?employee\s+compensation/i,
    ],
    weight: 1,
  },
  {
    type: '1099-MISC',
    patterns: [
      /1099-?\s*MISC/i,
      /miscellaneous\s+income/i,
      /miscellaneous\s+information/i,
      /rents\b.*\broyalties\b/i,
    ],
    weight: 1,
  },
];

export function autoDetectFormType(content: string): { type: SupportedFormType | 'unknown'; confidence: number } {
  const scores: Record<string, number> = {};

  for (const sig of FORM_SIGNATURES) {
    let hits = 0;
    for (const pat of sig.patterns) {
      if (pat.test(content)) hits++;
    }
    if (hits > 0) {
      scores[sig.type] = (hits / sig.patterns.length) * sig.weight;
    }
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) {
    log.warn('Could not detect form type from content');
    return { type: 'unknown', confidence: 0 };
  }

  const best = sorted[0];
  const confidence = Math.min(Math.round(best[1] * 100), 100);
  log.debug({ detectedType: best[0], confidence, allScores: scores }, 'Form type auto-detected');
  return { type: best[0] as SupportedFormType, confidence };
}

// ─── W-2 Extraction ──────────────────────────────────────────────────────

function extractW2(content: string): { data: W2Data; fieldsFound: number; warnings: string[] } {
  const warnings: string[] = [];
  let fieldsFound = 0;

  const employer_ein = extractEIN(content, /employer['']?s?\s+identification\s+number.*?(?:\n|$)/i)
    || extractEIN(content, /EIN.*?(?:\n|$)/i)
    || extractEIN(content);

  const employer_name = extractNameBlock(content, /employer['']?s?\s+name/i);
  const employer_address = extractAddressBlock(content, /employer['']?s?\s+address/i)
    || extractAddressBlock(content, /employer['']?s?\s+name.*?\n/i);

  const employee_ssn = extractSSN(content, /employee['']?s?\s+social\s+security/i)
    || extractSSN(content, /SSN/i)
    || extractSSN(content);

  const employee_name = extractNameBlock(content, /employee['']?s?\s+(first\s+)?name/i);
  const employee_address = extractAddressBlock(content, /employee['']?s?\s+address/i);

  const box1_wages = extractAmountNear(content, [
    /(?:box\s*1|wages[\s,]+tips[\s,]+other\s+compensation)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /1\s+wages.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  const box2_federal_tax_withheld = extractAmountNear(content, [
    /(?:box\s*2|federal\s+income\s+tax\s+withheld)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /2\s+federal\s+income\s+tax.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  const box3_ss_wages = extractAmountNear(content, [
    /(?:box\s*3|social\s+security\s+wages)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /3\s+social\s+security\s+wages.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  const box4_ss_tax_withheld = extractAmountNear(content, [
    /(?:box\s*4|social\s+security\s+tax\s+withheld)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /4\s+social\s+security\s+tax.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  const box5_medicare_wages = extractAmountNear(content, [
    /(?:box\s*5|medicare\s+wages)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /5\s+medicare\s+wages.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  const box6_medicare_tax_withheld = extractAmountNear(content, [
    /(?:box\s*6|medicare\s+tax\s+withheld)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /6\s+medicare\s+tax.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  // Box 12 codes (DD, W, E, etc.)
  const box12: Box12Entry[] = [];
  const box12Pattern = /(?:box\s*)?12[a-d]?\s*[:\-]?\s*(?:code\s*)?([A-Z]{1,3})\s+(\$?[\d,]+\.\d{2})/gi;
  let box12Match: RegExpExecArray | null;
  while ((box12Match = box12Pattern.exec(content)) !== null) {
    box12.push({ code: box12Match[1].toUpperCase(), amount: parseCurrency(box12Match[2]) });
  }
  // Fallback: look for common codes directly
  if (box12.length === 0) {
    const codePattern = /\b(DD|W|E|EE|G|AA|BB|CC|FF|GG|HH)\s+(\$?[\d,]+\.\d{2})/g;
    let codeMatch: RegExpExecArray | null;
    while ((codeMatch = codePattern.exec(content)) !== null) {
      box12.push({ code: codeMatch[1], amount: parseCurrency(codeMatch[2]) });
    }
  }

  const box14_other = extractTextNear(content, [
    /(?:box\s*14|other)[:\s]*([^\n]+)/i,
  ]);

  // State info (boxes 15-17)
  const box15_state = extractTextNear(content, [
    /(?:box\s*15|state)[:\s]*([A-Z]{2})\b/i,
    /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/,
  ]);

  const box16_state_wages = extractAmountNear(content, [
    /(?:box\s*16|state\s+wages)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /16\s+state\s+wages.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  const box17_state_tax = extractAmountNear(content, [
    /(?:box\s*17|state\s+income\s+tax)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /17\s+state\s+income\s+tax.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  // Count populated fields
  const fields = [
    employer_ein, employer_name, employer_address, employee_ssn, employee_name, employee_address,
    box1_wages, box2_federal_tax_withheld, box3_ss_wages, box4_ss_tax_withheld,
    box5_medicare_wages, box6_medicare_tax_withheld, box14_other,
    box15_state, box16_state_wages, box17_state_tax,
  ];
  fieldsFound = fields.filter(f => f !== null).length + box12.length;

  // Validation warnings
  if (box1_wages === null) warnings.push('Could not extract Box 1 (Wages)');
  if (box2_federal_tax_withheld === null) warnings.push('Could not extract Box 2 (Federal tax withheld)');
  if (employee_ssn === null) warnings.push('Could not extract Employee SSN');
  if (employer_ein === null) warnings.push('Could not extract Employer EIN');

  // Cross-validation: SS wages should not exceed the annual cap ($176,100 for 2025)
  if (box3_ss_wages !== null && box3_ss_wages > 176100) {
    warnings.push(`Box 3 Social Security wages ($${box3_ss_wages}) exceeds 2025 cap of $176,100`);
  }
  // Medicare wages should be >= SS wages
  if (box5_medicare_wages !== null && box3_ss_wages !== null && box5_medicare_wages < box3_ss_wages) {
    warnings.push('Box 5 Medicare wages is less than Box 3 SS wages (unusual)');
  }

  const data: W2Data = {
    form_type: 'W-2',
    employer_ein, employer_name, employer_address,
    employee_ssn, employee_name, employee_address,
    box1_wages, box2_federal_tax_withheld,
    box3_ss_wages, box4_ss_tax_withheld,
    box5_medicare_wages, box6_medicare_tax_withheld,
    box12, box14_other,
    box15_state, box16_state_wages, box17_state_tax,
  };

  return { data, fieldsFound, warnings };
}

// ─── 1099-INT Extraction ─────────────────────────────────────────────────

function extract1099Int(content: string): { data: Form1099IntData; fieldsFound: number; warnings: string[] } {
  const warnings: string[] = [];

  const payer_name = extractNameBlock(content, /payer['']?s?\s+name/i)
    || extractNameBlock(content, /(?:from|paid\s+by)[:\s]*/i);
  const payer_tin = extractEIN(content, /payer['']?s?\s+(?:TIN|EIN|identification)/i) || extractEIN(content);

  const recipient_name = extractNameBlock(content, /recipient['']?s?\s+name/i);
  const recipient_tin = extractSSN(content, /recipient['']?s?\s+(?:TIN|identification)/i);

  const box1_interest_income = extractAmountNear(content, [
    /(?:box\s*1|interest\s+income)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /1\s+interest\s+income.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  const box2_early_withdrawal_penalty = extractAmountNear(content, [
    /(?:box\s*2|early\s+withdrawal\s+penalty)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /2\s+early\s+withdrawal.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  const box3_us_savings_bond_interest = extractAmountNear(content, [
    /(?:box\s*3|interest\s+on\s+U\.?S\.?\s+savings\s+bonds?)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /3\s+interest\s+on\s+U\.?S.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  const box4_federal_tax_withheld = extractAmountNear(content, [
    /(?:box\s*4|federal\s+income\s+tax\s+withheld)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /4\s+federal\s+income\s+tax.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  const fields = [payer_name, payer_tin, recipient_name, recipient_tin, box1_interest_income, box2_early_withdrawal_penalty, box3_us_savings_bond_interest, box4_federal_tax_withheld];
  const fieldsFound = fields.filter(f => f !== null).length;

  if (box1_interest_income === null) warnings.push('Could not extract Box 1 (Interest income)');

  const data: Form1099IntData = {
    form_type: '1099-INT',
    payer_name, payer_tin, recipient_name, recipient_tin,
    box1_interest_income, box2_early_withdrawal_penalty,
    box3_us_savings_bond_interest, box4_federal_tax_withheld,
  };

  return { data, fieldsFound, warnings };
}

// ─── 1099-DIV Extraction ─────────────────────────────────────────────────

function extract1099Div(content: string): { data: Form1099DivData; fieldsFound: number; warnings: string[] } {
  const warnings: string[] = [];

  const payer_name = extractNameBlock(content, /payer['']?s?\s+name/i);
  const payer_tin = extractEIN(content, /payer['']?s?\s+(?:TIN|EIN|identification)/i) || extractEIN(content);

  const recipient_name = extractNameBlock(content, /recipient['']?s?\s+name/i);
  const recipient_tin = extractSSN(content, /recipient['']?s?\s+(?:TIN|identification)/i);

  const box1a_ordinary_dividends = extractAmountNear(content, [
    /(?:box\s*1a|total\s+ordinary\s+dividends?)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /1a\s+(?:total\s+)?ordinary\s+dividends.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  const box1b_qualified_dividends = extractAmountNear(content, [
    /(?:box\s*1b|qualified\s+dividends?)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /1b\s+qualified\s+dividends.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  const box2a_capital_gain_distributions = extractAmountNear(content, [
    /(?:box\s*2a|(?:total\s+)?capital\s+gain\s+distributions?)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /2a\s+(?:total\s+)?capital\s+gain.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  const box4_federal_tax_withheld = extractAmountNear(content, [
    /(?:box\s*4|federal\s+income\s+tax\s+withheld)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /4\s+federal\s+income\s+tax.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  const fields = [payer_name, payer_tin, recipient_name, recipient_tin, box1a_ordinary_dividends, box1b_qualified_dividends, box2a_capital_gain_distributions, box4_federal_tax_withheld];
  const fieldsFound = fields.filter(f => f !== null).length;

  if (box1a_ordinary_dividends === null) warnings.push('Could not extract Box 1a (Ordinary dividends)');
  // Qualified should not exceed ordinary
  if (box1a_ordinary_dividends !== null && box1b_qualified_dividends !== null && box1b_qualified_dividends > box1a_ordinary_dividends) {
    warnings.push('Box 1b (Qualified dividends) exceeds Box 1a (Ordinary dividends) — verify');
  }

  const data: Form1099DivData = {
    form_type: '1099-DIV',
    payer_name, payer_tin, recipient_name, recipient_tin,
    box1a_ordinary_dividends, box1b_qualified_dividends,
    box2a_capital_gain_distributions, box4_federal_tax_withheld,
  };

  return { data, fieldsFound, warnings };
}

// ─── 1099-NEC Extraction ─────────────────────────────────────────────────

function extract1099Nec(content: string): { data: Form1099NecData; fieldsFound: number; warnings: string[] } {
  const warnings: string[] = [];

  const payer_name = extractNameBlock(content, /payer['']?s?\s+name/i);
  const payer_tin = extractEIN(content, /payer['']?s?\s+(?:TIN|EIN|identification)/i) || extractEIN(content);

  const recipient_name = extractNameBlock(content, /recipient['']?s?\s+name/i);
  const recipient_tin = extractSSN(content, /recipient['']?s?\s+(?:TIN|identification)/i);

  const box1_nonemployee_compensation = extractAmountNear(content, [
    /(?:box\s*1|non-?employee\s+compensation)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /1\s+non-?employee\s+compensation.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  const box4_federal_tax_withheld = extractAmountNear(content, [
    /(?:box\s*4|federal\s+income\s+tax\s+withheld)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /4\s+federal\s+income\s+tax.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  const fields = [payer_name, payer_tin, recipient_name, recipient_tin, box1_nonemployee_compensation, box4_federal_tax_withheld];
  const fieldsFound = fields.filter(f => f !== null).length;

  if (box1_nonemployee_compensation === null) warnings.push('Could not extract Box 1 (Nonemployee compensation)');

  const data: Form1099NecData = {
    form_type: '1099-NEC',
    payer_name, payer_tin, recipient_name, recipient_tin,
    box1_nonemployee_compensation, box4_federal_tax_withheld,
  };

  return { data, fieldsFound, warnings };
}

// ─── 1099-MISC Extraction ────────────────────────────────────────────────

function extract1099Misc(content: string): { data: Form1099MiscData; fieldsFound: number; warnings: string[] } {
  const warnings: string[] = [];

  const payer_name = extractNameBlock(content, /payer['']?s?\s+name/i);
  const payer_tin = extractEIN(content, /payer['']?s?\s+(?:TIN|EIN|identification)/i) || extractEIN(content);

  const recipient_name = extractNameBlock(content, /recipient['']?s?\s+name/i);
  const recipient_tin = extractSSN(content, /recipient['']?s?\s+(?:TIN|identification)/i);

  const box1_rents = extractAmountNear(content, [
    /(?:box\s*1|rents)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /1\s+rents.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  const box2_royalties = extractAmountNear(content, [
    /(?:box\s*2|royalties)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /2\s+royalties.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  const box3_other_income = extractAmountNear(content, [
    /(?:box\s*3|other\s+income)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /3\s+other\s+income.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  const box4_federal_tax_withheld = extractAmountNear(content, [
    /(?:box\s*4|federal\s+income\s+tax\s+withheld)[:\s]*(\$?[\d,]+\.\d{2})/i,
    /4\s+federal\s+income\s+tax.*?(\$?[\d,]+\.\d{2})/i,
  ]);

  const fields = [payer_name, payer_tin, recipient_name, recipient_tin, box1_rents, box2_royalties, box3_other_income, box4_federal_tax_withheld];
  const fieldsFound = fields.filter(f => f !== null).length;

  const hasAnyIncome = box1_rents !== null || box2_royalties !== null || box3_other_income !== null;
  if (!hasAnyIncome) warnings.push('Could not extract any income boxes (1, 2, or 3)');

  const data: Form1099MiscData = {
    form_type: '1099-MISC',
    payer_name, payer_tin, recipient_name, recipient_tin,
    box1_rents, box2_royalties, box3_other_income, box4_federal_tax_withheld,
  };

  return { data, fieldsFound, warnings };
}

// ─── Main Extraction Function ─────────────────────────────────────────────

export function extractTaxDocument(content: string, formType?: string): ExtractionResult {
  if (!content || content.trim().length === 0) {
    log.warn('Empty content provided to extractTaxDocument');
    return { success: false, form_type: 'unknown', confidence: 0, data: null, warnings: ['No content provided'], raw_fields_found: 0 };
  }

  // Decode base64 if it looks like base64 (starts with common base64 chars, no spaces in first chunk)
  let textContent = content;
  if (/^[A-Za-z0-9+/=]{50,}$/.test(content.replace(/\s/g, '').slice(0, 100))) {
    try {
      const decoded = Buffer.from(content, 'base64').toString('utf-8');
      // Only use decoded if it looks like readable text
      if (/[a-zA-Z]{3,}/.test(decoded)) {
        textContent = decoded;
        log.debug('Decoded base64 content to text');
      }
    } catch {
      // Not valid base64, use raw content
    }
  }

  // Determine form type
  let detectedType: SupportedFormType | 'unknown';
  let confidence: number;

  if (formType) {
    const normalized = formType.toUpperCase().replace(/\s+/g, '-');
    const validTypes: SupportedFormType[] = ['W-2', '1099-INT', '1099-DIV', '1099-NEC', '1099-MISC'];
    const match = validTypes.find(t => t === normalized || t.replace('-', '') === normalized.replace('-', ''));
    if (match) {
      detectedType = match;
      confidence = 100;
    } else {
      log.warn({ providedType: formType }, 'Unrecognized form type provided, attempting auto-detect');
      const detected = autoDetectFormType(textContent);
      detectedType = detected.type;
      confidence = detected.confidence;
    }
  } else {
    const detected = autoDetectFormType(textContent);
    detectedType = detected.type;
    confidence = detected.confidence;
  }

  if (detectedType === 'unknown') {
    log.warn('Could not determine form type');
    return { success: false, form_type: 'unknown', confidence: 0, data: null, warnings: ['Unable to determine tax form type from content'], raw_fields_found: 0 };
  }

  // Extract based on type
  let result: { data: ExtractedTaxDocument; fieldsFound: number; warnings: string[] };

  switch (detectedType) {
    case 'W-2':
      result = extractW2(textContent);
      break;
    case '1099-INT':
      result = extract1099Int(textContent);
      break;
    case '1099-DIV':
      result = extract1099Div(textContent);
      break;
    case '1099-NEC':
      result = extract1099Nec(textContent);
      break;
    case '1099-MISC':
      result = extract1099Misc(textContent);
      break;
    default:
      return { success: false, form_type: detectedType, confidence, data: null, warnings: [`Extraction not implemented for ${detectedType}`], raw_fields_found: 0 };
  }

  const success = result.fieldsFound > 0;
  log.info({ formType: detectedType, fieldsFound: result.fieldsFound, warningCount: result.warnings.length, success }, 'Tax document extraction complete');

  return {
    success,
    form_type: detectedType,
    confidence,
    data: result.data,
    warnings: result.warnings,
    raw_fields_found: result.fieldsFound,
  };
}
