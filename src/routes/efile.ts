// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — E-File Routes
// IRS MeF (Modernized e-File) integration
// ═══════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { getById, update, logAudit } from '../services/database';
import { createLogger } from '../utils/logger';

const log = createLogger('efile');

// ─── E-File Validation Rules ───────────────────────────────────────────
interface ValidationResult {
  valid: boolean;
  errors: Array<{ code: string; message: string; severity: 'critical' | 'high' | 'medium' | 'low' }>;
  warnings: string[];
}

function validateForEfile(db: Database, returnId: string): ValidationResult {
  const errors: Array<{ code: string; message: string; severity: 'critical' | 'high' | 'medium' | 'low' }> = [];
  const warnings: string[] = [];

  const taxReturn = getById(db, 'tax_returns', returnId) as Record<string, unknown> | undefined;
  if (!taxReturn) {
    return { valid: false, errors: [{ code: 'R0001', message: 'Return not found', severity: 'critical' }], warnings: [] };
  }

  const client = getById(db, 'clients', taxReturn.client_id as string) as Record<string, unknown> | undefined;

  // R0010: Return must be calculated
  if (taxReturn.status !== 'locked' && taxReturn.status !== 'calculated') {
    errors.push({ code: 'R0010', message: 'Return must be calculated and locked before e-filing', severity: 'critical' });
  }

  // R0020: SSN required
  if (!client?.ssn_encrypted) {
    errors.push({ code: 'R0020', message: 'Primary taxpayer SSN is required', severity: 'critical' });
  }

  // R0030: Filing status required
  if (!client?.filing_status) {
    errors.push({ code: 'R0030', message: 'Filing status is required', severity: 'critical' });
  }

  // R0040: Name required
  if (!client?.first_name || !client?.last_name) {
    errors.push({ code: 'R0040', message: 'Taxpayer name is required', severity: 'critical' });
  }

  // R0050: Address required
  if (!client?.address_street || !client?.address_city || !client?.address_state || !client?.address_zip) {
    errors.push({ code: 'R0050', message: 'Complete mailing address is required', severity: 'critical' });
  }

  // R0060: MFJ requires spouse SSN
  if (client?.filing_status === 'mfj' && !client?.spouse_ssn_encrypted) {
    errors.push({ code: 'R0060', message: 'Spouse SSN required for Married Filing Jointly', severity: 'critical' });
  }

  // R0070: Form 8879 must be signed
  if (!taxReturn.form_8879_signed) {
    errors.push({ code: 'R0070', message: 'Form 8879 (e-file signature) not yet signed', severity: 'critical' });
  }

  // R0080: Self-select PIN
  if (!taxReturn.self_select_pin) {
    errors.push({ code: 'R0080', message: 'Self-select PIN required for e-filing', severity: 'high' });
  }

  // R0090: Income items present
  const incomeCount = (db.prepare('SELECT COUNT(*) as count FROM income_items WHERE return_id = ?').get(returnId) as { count: number }).count;
  if (incomeCount === 0) {
    errors.push({ code: 'R0090', message: 'No income items — at least one required', severity: 'high' });
  }

  // R0100: Dependent SSN check
  const depsNoSsn = db.prepare('SELECT COUNT(*) as count FROM dependents WHERE return_id = ? AND ssn_encrypted IS NULL').get(returnId) as { count: number };
  if (depsNoSsn.count > 0) {
    errors.push({ code: 'R0100', message: `${depsNoSsn.count} dependent(s) missing SSN`, severity: 'high' });
  }

  // R0110: Negative total income check
  if ((taxReturn.total_income as number) < 0) {
    warnings.push('Total income is negative — verify all income entries');
  }

  // R0120: Refund/owed sanity check
  const refundOrOwed = (taxReturn.refund_or_owed as number) || 0;
  if (Math.abs(refundOrOwed) > 100_000) {
    warnings.push(`Large refund/balance due ($${Math.abs(refundOrOwed).toLocaleString()}) — verify calculations`);
  }

  // R0130: Preparer info for paid preparers
  if (taxReturn.preparer_ptin && !taxReturn.firm_ein) {
    warnings.push('Preparer PTIN provided but firm EIN missing');
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Generate MeF XML Skeleton ─────────────────────────────────────────
function generateSubmissionId(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase();
  return `ECHO-${timestamp}-${random}`;
}

export function efileRoutes(db: Database) {
  const router = new Hono();

  // POST /:returnId — Submit for e-filing
  router.post('/:returnId', async (c) => {
    const returnId = c.req.param('returnId');
    const taxReturn = getById(db, 'tax_returns', returnId) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);

    // Validate
    const validation = validateForEfile(db, returnId);
    if (!validation.valid) {
      return c.json({
        success: false,
        error: 'Return failed e-file validation',
        validation: {
          errors: validation.errors,
          warnings: validation.warnings,
          error_count: validation.errors.length,
        },
      }, 422);
    }

    // Check for existing pending submission
    const existing = db.prepare(`
      SELECT id, status FROM efile_submissions WHERE return_id = ? AND status IN ('pending', 'queued', 'transmitted')
    `).get(returnId) as Record<string, unknown> | undefined;

    if (existing) {
      return c.json({
        success: false,
        error: `Return already has a pending e-file submission (${existing.id}), status: ${existing.status}`,
      }, 409);
    }

    // Create e-file submission
    const submissionId = generateSubmissionId();
    const efileId = crypto.randomUUID().replace(/-/g, '');
    const now = new Date().toISOString();

    // Generate XML hash (simplified — real implementation would build full MeF XML)
    const xmlContent = `<!-- ECHO TAX RETURN ULTIMATE MeF Submission -->
<Return xmlns="http://www.irs.gov/efile" returnVersion="2025v1.0">
  <ReturnHeader>
    <Timestamp>${now}</Timestamp>
    <TaxYear>${taxReturn.tax_year}</TaxYear>
    <ReturnType>${taxReturn.return_type}</ReturnType>
    <SubmissionId>${submissionId}</SubmissionId>
  </ReturnHeader>
  <ReturnData>
    <TotalIncome>${taxReturn.total_income}</TotalIncome>
    <AGI>${taxReturn.adjusted_gross_income}</AGI>
    <TaxableIncome>${taxReturn.taxable_income}</TaxableIncome>
    <TotalTax>${taxReturn.total_tax}</TotalTax>
    <RefundOrOwed>${taxReturn.refund_or_owed}</RefundOrOwed>
  </ReturnData>
</Return>`;

    const xmlHash = new Bun.CryptoHasher('sha256').update(xmlContent).digest('hex');

    db.prepare(`
      INSERT INTO efile_submissions (id, return_id, submission_id, transmission_timestamp, status, xml_content, xml_hash)
      VALUES (?, ?, ?, ?, 'queued', ?, ?)
    `).run(efileId, returnId, submissionId, now, xmlContent, xmlHash);

    // Update return status
    update(db, 'tax_returns', returnId, {
      status: 'filed',
      filed_at: now,
      efile_submission_id: submissionId,
      efile_status: 'queued',
    });

    logAudit(db, {
      return_id: returnId,
      user_id: c.get('userId'),
      action: 'efile_submitted',
      entity_type: 'efile_submission',
      entity_id: efileId,
      details: { submission_id: submissionId, xml_hash: xmlHash },
    });

    log.info({ returnId, submissionId, efileId }, 'E-file submission created');

    return c.json({
      success: true,
      data: {
        efile_id: efileId,
        submission_id: submissionId,
        status: 'queued',
        xml_hash: xmlHash,
        transmission_timestamp: now,
        validation: { warnings: validation.warnings },
      },
    }, 201);
  });

  // GET /:returnId/status — E-file status
  router.get('/:returnId/status', (c) => {
    const returnId = c.req.param('returnId');

    const submissions = db.prepare(`
      SELECT id, submission_id, status, transmission_timestamp, ack_timestamp, ack_status,
             rejection_codes, rejection_details, retry_count, max_retries, xml_hash,
             is_state_return, state_code, created_at, updated_at
      FROM efile_submissions WHERE return_id = ? ORDER BY created_at DESC
    `).all(returnId) as Record<string, unknown>[];

    if (submissions.length === 0) {
      return c.json({
        success: true,
        data: { return_id: returnId, status: 'not_filed', submissions: [] },
      });
    }

    const latest = submissions[0];

    // Get rejections for latest submission
    let rejections: Record<string, unknown>[] = [];
    if (latest.status === 'rejected') {
      rejections = db.prepare(`
        SELECT error_code, error_description, severity, auto_fixable, auto_fix_action,
               user_action, irs_resolution_path, resolved, resolved_at
        FROM efile_rejections WHERE submission_id = ? ORDER BY severity ASC
      `).all(latest.id as string) as Record<string, unknown>[];
    }

    return c.json({
      success: true,
      data: {
        return_id: returnId,
        current_status: latest.status,
        latest_submission: latest,
        rejections,
        submission_history: submissions,
        can_resubmit: latest.status === 'rejected' && (latest.retry_count as number) < (latest.max_retries as number),
      },
    });
  });

  // POST /:returnId/extension — File extension (Form 4868)
  router.post('/:returnId/extension', async (c) => {
    const returnId = c.req.param('returnId');
    const taxReturn = getById(db, 'tax_returns', returnId) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);

    // Check if already filed
    if (taxReturn.status === 'accepted') {
      return c.json({ success: false, error: 'Return already accepted — extension not needed' }, 400);
    }

    const body = await c.req.json();
    const estimatedTaxLiability = body.estimated_tax_liability || (taxReturn.total_tax as number) || 0;
    const totalPayments = body.total_payments || (taxReturn.total_payments as number) || 0;
    const balanceDue = Math.max(0, estimatedTaxLiability - totalPayments);

    const client = getById(db, 'clients', taxReturn.client_id as string) as Record<string, unknown> | undefined;

    // Determine extension deadline
    const taxYear = taxReturn.tax_year as number;
    const originalDeadline = new Date(taxYear + 1, 3, 15); // April 15
    const extendedDeadline = new Date(taxYear + 1, 9, 15); // October 15

    // Extension submission
    const extensionId = crypto.randomUUID().replace(/-/g, '');
    const submissionId = generateSubmissionId();
    const now = new Date().toISOString();

    const extensionXml = `<!-- Form 4868 — Application for Extension -->
<Extension xmlns="http://www.irs.gov/efile" formVersion="4868-2025v1.0">
  <TaxYear>${taxYear}</TaxYear>
  <SubmissionId>${submissionId}</SubmissionId>
  <FilingStatus>${client?.filing_status || 'single'}</FilingStatus>
  <EstimatedTaxLiability>${estimatedTaxLiability}</EstimatedTaxLiability>
  <TotalPayments>${totalPayments}</TotalPayments>
  <BalanceDue>${balanceDue}</BalanceDue>
</Extension>`;

    const xmlHash = new Bun.CryptoHasher('sha256').update(extensionXml).digest('hex');

    db.prepare(`
      INSERT INTO efile_submissions (id, return_id, submission_id, transmission_timestamp, status, xml_content, xml_hash)
      VALUES (?, ?, ?, ?, 'queued', ?, ?)
    `).run(extensionId, returnId, submissionId, now, extensionXml, xmlHash);

    logAudit(db, {
      return_id: returnId,
      user_id: c.get('userId'),
      action: 'extension_filed',
      entity_type: 'efile_submission',
      entity_id: extensionId,
      details: {
        form: '4868',
        estimated_liability: estimatedTaxLiability,
        balance_due: balanceDue,
        extended_deadline: extendedDeadline.toISOString().split('T')[0],
      },
    });

    log.info({ returnId, extensionId, balanceDue }, 'Extension (Form 4868) submitted');

    return c.json({
      success: true,
      data: {
        extension_id: extensionId,
        submission_id: submissionId,
        status: 'queued',
        form: '4868',
        tax_year: taxYear,
        original_deadline: originalDeadline.toISOString().split('T')[0],
        extended_deadline: extendedDeadline.toISOString().split('T')[0],
        estimated_tax_liability: estimatedTaxLiability,
        total_payments: totalPayments,
        balance_due: balanceDue,
        note: balanceDue > 0
          ? `Payment of $${balanceDue.toLocaleString()} is still due by ${originalDeadline.toISOString().split('T')[0]} to avoid penalties.`
          : 'No balance due. Extension grants additional time to file.',
        xml_hash: xmlHash,
      },
    }, 201);
  });

  return router;
}
