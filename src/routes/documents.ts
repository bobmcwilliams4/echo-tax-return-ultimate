// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Document Routes
// ═══════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { getById, listPaginated, remove, logAudit } from '../services/database';
import { createLogger } from '../utils/logger';
import { z } from 'zod';

const log = createLogger('documents');

// ─── Document Type Definitions ─────────────────────────────────────────
const DocType = z.enum([
  'W-2', '1099-INT', '1099-DIV', '1099-MISC', '1099-NEC', '1099-B', '1099-R',
  '1099-G', '1099-S', '1099-K', '1099-SA', '1098', '1098-T', '1098-E',
  'K-1', '5498', '5498-SA', '1095-A', '1095-B', '1095-C',
  'SSA-1099', 'RRB-1099',
  'receipt', 'bank_statement', 'brokerage_statement', 'property_tax_bill',
  'mortgage_statement', 'charitable_receipt', 'medical_receipt',
  'business_license', 'mileage_log', 'home_office_measurement',
  'prior_return', 'identity_document', 'other',
]);

const CreateDocumentSchema = z.object({
  return_id: z.string().min(1),
  doc_type: DocType,
  issuer_name: z.string().optional(),
  file_path: z.string().optional(),
  file_size: z.number().int().optional(),
  file_hash: z.string().optional(),
  mime_type: z.string().optional(),
  status: z.enum(['uploaded', 'verified', 'rejected']).default('uploaded'),
});

// ─── Required Document Checklist ───────────────────────────────────────
interface ChecklistItem {
  doc_type: string;
  description: string;
  required: boolean;
  condition?: string;
}

const BASE_CHECKLIST: ChecklistItem[] = [
  { doc_type: 'identity_document', description: 'Government-issued photo ID', required: true },
  { doc_type: 'prior_return', description: 'Prior year tax return (for AGI verification)', required: true },
];

const INCOME_DOC_MAP: Record<string, ChecklistItem> = {
  wages: { doc_type: 'W-2', description: 'W-2 Wage and Tax Statement', required: true },
  salary: { doc_type: 'W-2', description: 'W-2 Wage and Tax Statement', required: true },
  tips: { doc_type: 'W-2', description: 'W-2 showing tip income', required: true },
  interest: { doc_type: '1099-INT', description: '1099-INT Interest Income', required: true },
  dividends: { doc_type: '1099-DIV', description: '1099-DIV Dividend Income', required: true },
  qualified_dividends: { doc_type: '1099-DIV', description: '1099-DIV (Qualified Dividends)', required: true },
  capital_gains: { doc_type: '1099-B', description: '1099-B Proceeds from Broker', required: true },
  capital_gains_short: { doc_type: '1099-B', description: '1099-B (Short-term gains)', required: true },
  capital_gains_long: { doc_type: '1099-B', description: '1099-B (Long-term gains)', required: true },
  business: { doc_type: '1099-NEC', description: '1099-NEC or business income records', required: true, condition: 'If self-employed' },
  nec_1099: { doc_type: '1099-NEC', description: '1099-NEC Nonemployee Compensation', required: true },
  misc_1099: { doc_type: '1099-MISC', description: '1099-MISC Miscellaneous Income', required: true },
  rental: { doc_type: 'bank_statement', description: 'Rental income records', required: true },
  partnership: { doc_type: 'K-1', description: 'Schedule K-1 (Form 1065)', required: true },
  s_corp: { doc_type: 'K-1', description: 'Schedule K-1 (Form 1120-S)', required: true },
  trust: { doc_type: 'K-1', description: 'Schedule K-1 (Form 1041)', required: true },
  pension: { doc_type: '1099-R', description: '1099-R Retirement Distributions', required: true },
  annuity: { doc_type: '1099-R', description: '1099-R Annuity Distribution', required: true },
  ira_distribution: { doc_type: '1099-R', description: '1099-R IRA Distribution', required: true },
  social_security: { doc_type: 'SSA-1099', description: 'SSA-1099 Social Security Benefits', required: true },
  unemployment: { doc_type: '1099-G', description: '1099-G Unemployment Compensation', required: true },
  state_refund: { doc_type: '1099-G', description: '1099-G State/Local Tax Refund', required: true },
  crypto: { doc_type: '1099-B', description: '1099-B or exchange transaction history', required: true },
};

const DEDUCTION_DOC_MAP: Record<string, ChecklistItem> = {
  mortgage_interest: { doc_type: '1098', description: 'Form 1098 Mortgage Interest Statement', required: true },
  student_loan_interest: { doc_type: '1098-E', description: 'Form 1098-E Student Loan Interest', required: true },
  property_taxes: { doc_type: 'property_tax_bill', description: 'Property tax bill/receipt', required: true },
  charitable_cash: { doc_type: 'charitable_receipt', description: 'Charitable donation receipts', required: true, condition: 'For donations over $250' },
  charitable_noncash: { doc_type: 'charitable_receipt', description: 'Noncash donation appraisal/receipt', required: true, condition: 'For noncash donations over $500' },
  medical: { doc_type: 'medical_receipt', description: 'Medical expense receipts/statements', required: true },
  hsa_contribution: { doc_type: '5498-SA', description: 'Form 5498-SA HSA Contributions', required: true },
  ira_contribution: { doc_type: '5498', description: 'Form 5498 IRA Contributions', required: true },
  home_office: { doc_type: 'home_office_measurement', description: 'Home office square footage documentation', required: true },
  vehicle: { doc_type: 'mileage_log', description: 'Mileage log for business use', required: true },
  business_expense: { doc_type: 'receipt', description: 'Business expense receipts', required: true },
};

export function documentRoutes(db: Database) {
  const router = new Hono();

  // POST / — Upload document metadata
  router.post('/', async (c) => {
    const body = await c.req.json();
    const parsed = CreateDocumentSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const input = parsed.data;

    // Verify return exists
    const taxReturn = getById(db, 'tax_returns', input.return_id) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);

    const id = crypto.randomUUID().replace(/-/g, '');

    db.prepare(`
      INSERT INTO documents (id, return_id, doc_type, issuer_name, file_path, file_size, file_hash, mime_type, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.return_id, input.doc_type, input.issuer_name || null,
      input.file_path || null, input.file_size || null, input.file_hash || null,
      input.mime_type || null, input.status,
    );

    logAudit(db, {
      return_id: input.return_id,
      user_id: c.get('userId'),
      action: 'document_uploaded',
      entity_type: 'document',
      entity_id: id,
      details: { doc_type: input.doc_type, issuer: input.issuer_name },
    });

    log.info({ documentId: id, returnId: input.return_id, docType: input.doc_type }, 'Document metadata created');
    const doc = getById(db, 'documents', id);
    return c.json({ success: true, data: doc }, 201);
  });

  // GET /:returnId — List documents for return
  router.get('/:returnId', (c) => {
    const returnId = c.req.param('returnId');
    const docType = c.req.query('doc_type');
    const status = c.req.query('status');
    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 200);

    const conditions: string[] = ['return_id = ?'];
    const args: unknown[] = [returnId];

    if (docType) { conditions.push('doc_type = ?'); args.push(docType); }
    if (status) { conditions.push('status = ?'); args.push(status); }

    const result = listPaginated(db, 'documents', {
      page,
      limit,
      where: conditions.join(' AND '),
      args,
      orderBy: 'doc_type ASC, created_at DESC',
    });

    // Summary stats
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_documents,
        COUNT(CASE WHEN status = 'verified' THEN 1 END) as verified,
        COUNT(CASE WHEN status = 'uploaded' THEN 1 END) as pending_review,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
        COUNT(CASE WHEN ocr_status = 'complete' THEN 1 END) as ocr_complete,
        COUNT(CASE WHEN ocr_status = 'pending' THEN 1 END) as ocr_pending
      FROM documents WHERE return_id = ?
    `).get(returnId) as Record<string, number>;

    return c.json({ success: true, ...result, stats });
  });

  // DELETE /:docId — Delete document
  router.delete('/:docId', (c) => {
    const id = c.req.param('docId');
    const existing = getById(db, 'documents', id) as Record<string, unknown> | undefined;
    if (!existing) return c.json({ success: false, error: 'Document not found' }, 404);

    // Check if any income/deduction items reference this document
    const linkedIncome = db.prepare('SELECT COUNT(*) as count FROM income_items WHERE document_id = ?').get(id) as { count: number };
    const linkedDeduction = db.prepare('SELECT COUNT(*) as count FROM deductions WHERE document_id = ?').get(id) as { count: number };

    if (linkedIncome.count > 0 || linkedDeduction.count > 0) {
      return c.json({
        success: false,
        error: 'Document is linked to income/deduction items. Remove links first.',
        linked: { income_items: linkedIncome.count, deductions: linkedDeduction.count },
      }, 409);
    }

    remove(db, 'documents', id);

    logAudit(db, {
      return_id: existing.return_id as string,
      user_id: c.get('userId'),
      action: 'document_deleted',
      entity_type: 'document',
      entity_id: id,
      details: { doc_type: existing.doc_type },
    });

    return c.json({ success: true, message: 'Document deleted' });
  });

  // GET /:returnId/checklist — Missing document checklist
  router.get('/:returnId/checklist', (c) => {
    const returnId = c.req.param('returnId');
    const taxReturn = getById(db, 'tax_returns', returnId) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);

    // Get existing documents
    const existingDocs = db.prepare('SELECT doc_type, status, COUNT(*) as count FROM documents WHERE return_id = ? GROUP BY doc_type').all(returnId) as Record<string, unknown>[];
    const existingDocTypes = new Set(existingDocs.map(d => d.doc_type as string));

    // Get income categories
    const incomeCategories = db.prepare('SELECT DISTINCT category FROM income_items WHERE return_id = ?').all(returnId) as { category: string }[];

    // Get deduction categories
    const deductionCategories = db.prepare('SELECT DISTINCT category FROM deductions WHERE return_id = ?').all(returnId) as { category: string }[];

    // Build required documents list
    const required: Array<{ doc_type: string; description: string; status: 'have' | 'missing' | 'rejected'; condition?: string; source: string }> = [];

    // Base documents
    for (const item of BASE_CHECKLIST) {
      required.push({
        doc_type: item.doc_type,
        description: item.description,
        status: existingDocTypes.has(item.doc_type) ? 'have' : 'missing',
        source: 'base',
      });
    }

    // Income-based documents
    const seenDocTypes = new Set<string>();
    for (const { category } of incomeCategories) {
      const mapping = INCOME_DOC_MAP[category];
      if (mapping && !seenDocTypes.has(`income_${mapping.doc_type}_${category}`)) {
        seenDocTypes.add(`income_${mapping.doc_type}_${category}`);
        const docStatus = existingDocTypes.has(mapping.doc_type) ? 'have' : 'missing';
        required.push({
          doc_type: mapping.doc_type,
          description: mapping.description,
          status: docStatus,
          condition: mapping.condition,
          source: `income:${category}`,
        });
      }
    }

    // Deduction-based documents
    for (const { category } of deductionCategories) {
      const mapping = DEDUCTION_DOC_MAP[category];
      if (mapping && !seenDocTypes.has(`deduction_${mapping.doc_type}_${category}`)) {
        seenDocTypes.add(`deduction_${mapping.doc_type}_${category}`);
        const docStatus = existingDocTypes.has(mapping.doc_type) ? 'have' : 'missing';
        required.push({
          doc_type: mapping.doc_type,
          description: mapping.description,
          status: docStatus,
          condition: mapping.condition,
          source: `deduction:${category}`,
        });
      }
    }

    // Health insurance (ACA)
    required.push({
      doc_type: '1095-A',
      description: 'Form 1095-A Marketplace Insurance (if applicable)',
      status: existingDocTypes.has('1095-A') ? 'have' : 'missing',
      condition: 'If enrolled in Marketplace insurance',
      source: 'compliance',
    });

    const missing = required.filter(r => r.status === 'missing');
    const have = required.filter(r => r.status === 'have');

    return c.json({
      success: true,
      data: {
        total_required: required.length,
        total_have: have.length,
        total_missing: missing.length,
        completeness_pct: required.length > 0 ? Math.round((have.length / required.length) * 100) : 100,
        ready_for_filing: missing.filter(m => !m.condition).length === 0,
        checklist: required,
        missing_critical: missing.filter(m => !m.condition),
        missing_conditional: missing.filter(m => !!m.condition),
      },
    });
  });

  return router;
}
