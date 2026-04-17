// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Compliance Check Routes
// Pre-file validation, IRS rule enforcement, audit risk scoring
// ═══════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { getById, logAudit } from '../services/database';
import { createLogger } from '../utils/logger';

const log = createLogger('compliance');

// ─── Compliance Rule Definitions ───────────────────────────────────────
interface ComplianceRule {
  id: string;
  name: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  check: (db: Database, returnId: string, taxReturn: Record<string, unknown>, client: Record<string, unknown> | undefined) => { passed: boolean; details: string };
}

const COMPLIANCE_RULES: ComplianceRule[] = [
  {
    id: 'C001', name: 'SSN Present', description: 'Primary taxpayer must have SSN', severity: 'critical', category: 'identity',
    check: (_db, _rid, _ret, client) => ({
      passed: !!client?.ssn_encrypted,
      details: client?.ssn_encrypted ? 'SSN on file' : 'Primary SSN missing — required for e-filing',
    }),
  },
  {
    id: 'C002', name: 'Filing Status', description: 'Filing status must be selected', severity: 'critical', category: 'identity',
    check: (_db, _rid, _ret, client) => ({
      passed: !!client?.filing_status,
      details: client?.filing_status ? `Filing status: ${client.filing_status}` : 'Filing status not set',
    }),
  },
  {
    id: 'C003', name: 'Spouse SSN for MFJ', description: 'MFJ requires spouse SSN', severity: 'critical', category: 'identity',
    check: (_db, _rid, _ret, client) => {
      if (client?.filing_status !== 'mfj') return { passed: true, details: 'Not MFJ — spouse SSN not required' };
      return { passed: !!client?.spouse_ssn_encrypted, details: client?.spouse_ssn_encrypted ? 'Spouse SSN on file' : 'Spouse SSN missing for MFJ' };
    },
  },
  {
    id: 'C004', name: 'Address Complete', description: 'Mailing address must be complete', severity: 'high', category: 'identity',
    check: (_db, _rid, _ret, client) => {
      const hasAddr = !!(client?.address_street && client?.address_city && client?.address_state && client?.address_zip);
      return { passed: hasAddr, details: hasAddr ? 'Address complete' : 'Incomplete mailing address' };
    },
  },
  {
    id: 'C010', name: 'Income Present', description: 'At least one income item required', severity: 'high', category: 'income',
    check: (db, rid) => {
      const count = (db.prepare('SELECT COUNT(*) as c FROM income_items WHERE return_id = ?').get(rid) as { c: number }).c;
      return { passed: count > 0, details: count > 0 ? `${count} income item(s) present` : 'No income items entered' };
    },
  },
  {
    id: 'C011', name: 'Negative Income Check', description: 'Total income should not be negative without business losses', severity: 'medium', category: 'income',
    check: (_db, _rid, ret) => {
      const total = (ret.total_income as number) || 0;
      if (total >= 0) return { passed: true, details: `Total income: $${total.toLocaleString()}` };
      return { passed: false, details: `Negative total income ($${total.toLocaleString()}) — verify business losses or NOL` };
    },
  },
  {
    id: 'C020', name: 'Dependent SSN Required', description: 'All dependents need SSN for credits', severity: 'high', category: 'dependents',
    check: (db, rid) => {
      const missing = (db.prepare('SELECT COUNT(*) as c FROM dependents WHERE return_id = ? AND ssn_encrypted IS NULL').get(rid) as { c: number }).c;
      return { passed: missing === 0, details: missing === 0 ? 'All dependents have SSN' : `${missing} dependent(s) missing SSN` };
    },
  },
  {
    id: 'C021', name: 'Dependent Age Verification', description: 'Dependent ages must be consistent with claimed credits', severity: 'medium', category: 'dependents',
    check: (db, rid, ret) => {
      const taxYear = (ret.tax_year as number) || 2025;
      const deps = db.prepare('SELECT dob, qualifies_ctc FROM dependents WHERE return_id = ?').all(rid) as Record<string, unknown>[];
      for (const dep of deps) {
        if (dep.qualifies_ctc && dep.dob) {
          const age = taxYear - new Date(dep.dob as string).getFullYear();
          if (age >= 17) return { passed: false, details: `CTC claimed for dependent age ${age} — must be under 17` };
        }
      }
      return { passed: true, details: 'Dependent ages consistent with claimed credits' };
    },
  },
  {
    id: 'C030', name: 'Schedule C with No SE Tax', description: 'Self-employment income requires SE tax', severity: 'high', category: 'calculations',
    check: (db, rid, ret) => {
      const seIncome = (db.prepare("SELECT COALESCE(SUM(amount), 0) as t FROM income_items WHERE return_id = ? AND category IN ('business','nec_1099')").get(rid) as { t: number }).t;
      if (seIncome <= 0) return { passed: true, details: 'No self-employment income' };
      const seTax = (ret.self_employment_tax as number) || 0;
      if (seTax > 0) return { passed: true, details: `SE tax of $${seTax.toLocaleString()} computed on $${seIncome.toLocaleString()} SE income` };
      return { passed: false, details: `Self-employment income of $${seIncome.toLocaleString()} but no SE tax calculated` };
    },
  },
  {
    id: 'C031', name: 'EIC Income Limit', description: 'EIC claimed when AGI exceeds threshold', severity: 'high', category: 'credits',
    check: (db, rid, ret, client) => {
      const eicDeps = (db.prepare('SELECT COUNT(*) as c FROM dependents WHERE return_id = ? AND qualifies_eic = 1').get(rid) as { c: number }).c;
      if (eicDeps === 0) return { passed: true, details: 'No EIC qualifying dependents' };
      const agi = (ret.adjusted_gross_income as number) || 0;
      const fs = (client?.filing_status as string) || 'single';
      const limits: Record<string, number[]> = {
        single: [18_591, 49_084, 55_768, 59_899],
        mfj: [25_511, 56_004, 62_688, 66_819],
        mfs: [18_591, 49_084, 55_768, 59_899],
        hoh: [18_591, 49_084, 55_768, 59_899],
        qss: [25_511, 56_004, 62_688, 66_819],
      };
      const statusLimits = limits[fs] || limits.single;
      const children = Math.min(eicDeps, 3);
      const limit = statusLimits[children] || statusLimits[0];
      if (agi <= limit) return { passed: true, details: `AGI ($${agi.toLocaleString()}) within EIC limit ($${limit.toLocaleString()})` };
      return { passed: false, details: `AGI ($${agi.toLocaleString()}) exceeds EIC limit ($${limit.toLocaleString()}) for ${children} qualifying child(ren)` };
    },
  },
  {
    id: 'C040', name: 'SALT Cap Enforcement', description: 'SALT deductions must not exceed $10,000 cap', severity: 'medium', category: 'deductions',
    check: (db, rid, _ret, client) => {
      const salt = (db.prepare("SELECT COALESCE(SUM(amount), 0) as t FROM deductions WHERE return_id = ? AND category IN ('state_local_taxes','property_taxes')").get(rid) as { t: number }).t;
      const cap = (client?.filing_status as string) === 'mfs' ? 5_000 : 10_000;
      if (salt <= cap) return { passed: true, details: `SALT total $${salt.toLocaleString()} within $${cap.toLocaleString()} cap` };
      return { passed: false, details: `SALT total $${salt.toLocaleString()} exceeds $${cap.toLocaleString()} cap — must be limited` };
    },
  },
  {
    id: 'C050', name: 'Calculation Performed', description: 'Return must be calculated before filing', severity: 'critical', category: 'filing',
    check: (_db, _rid, ret) => {
      const status = ret.status as string;
      const calculated = ['calculated', 'locked', 'filed', 'accepted'].includes(status);
      return { passed: calculated, details: calculated ? `Return status: ${status}` : `Return is in ${status} — must be calculated first` };
    },
  },
  {
    id: 'C051', name: 'Reasonable Refund Check', description: 'Extremely large refunds trigger review', severity: 'low', category: 'audit_risk',
    check: (_db, _rid, ret) => {
      const refund = (ret.refund_or_owed as number) || 0;
      const income = (ret.total_income as number) || 1;
      if (refund <= 0) return { passed: true, details: 'No refund claimed' };
      const refundPct = (refund / income) * 100;
      if (refundPct > 50) return { passed: false, details: `Refund is ${refundPct.toFixed(1)}% of income — may trigger IRS review` };
      return { passed: true, details: `Refund is ${refundPct.toFixed(1)}% of income — within normal range` };
    },
  },
  {
    id: 'C060', name: 'Document Support', description: 'Key deductions should have supporting documents', severity: 'medium', category: 'documentation',
    check: (db, rid) => {
      const deds = (db.prepare('SELECT COUNT(*) as c FROM deductions WHERE return_id = ? AND amount > 500').get(rid) as { c: number }).c;
      const docs = (db.prepare("SELECT COUNT(*) as c FROM documents WHERE return_id = ? AND status = 'verified'").get(rid) as { c: number }).c;
      if (deds === 0) return { passed: true, details: 'No significant deductions requiring documentation' };
      if (docs >= deds) return { passed: true, details: `${docs} verified documents for ${deds} significant deductions` };
      return { passed: false, details: `${deds} deductions >$500 but only ${docs} verified documents` };
    },
  },
];

export function complianceRoutes(db: Database) {
  const router = new Hono();

  // POST /check/:returnId — Run full compliance check
  router.post('/check/:returnId', async (c) => {
    const returnId = c.req.param('returnId');
    const taxReturn = getById(db, 'tax_returns', returnId) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);

    const client = getById(db, 'clients', taxReturn.client_id as string) as Record<string, unknown> | undefined;

    const results: Array<{
      rule_id: string;
      name: string;
      category: string;
      severity: string;
      passed: boolean;
      details: string;
    }> = [];

    // Clear previous compliance checks for this return
    db.prepare('DELETE FROM compliance_checks WHERE return_id = ?').run(returnId);

    const insertCheck = db.prepare(`
      INSERT INTO compliance_checks (id, return_id, check_type, rule_id, status, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const runChecks = db.transaction(() => {
      for (const rule of COMPLIANCE_RULES) {
        const result = rule.check(db, returnId, taxReturn, client);
        const checkId = crypto.randomUUID().replace(/-/g, '');

        insertCheck.run(
          checkId, returnId, rule.category, rule.id,
          result.passed ? 'passed' : (rule.severity === 'low' ? 'warning' : 'failed'),
          result.details,
        );

        results.push({
          rule_id: rule.id,
          name: rule.name,
          category: rule.category,
          severity: rule.severity,
          passed: result.passed,
          details: result.details,
        });
      }
    });

    runChecks();

    const passed = results.filter(r => r.passed);
    const failed = results.filter(r => !r.passed);
    const criticalFails = failed.filter(r => r.severity === 'critical');
    const highFails = failed.filter(r => r.severity === 'high');

    // Audit risk score (0-100, lower is better)
    let auditRiskScore = 0;
    for (const f of failed) {
      switch (f.severity) {
        case 'critical': auditRiskScore += 25; break;
        case 'high': auditRiskScore += 15; break;
        case 'medium': auditRiskScore += 8; break;
        case 'low': auditRiskScore += 3; break;
      }
    }
    auditRiskScore = Math.min(100, auditRiskScore);

    logAudit(db, {
      return_id: returnId,
      user_id: c.get('userId'),
      action: 'compliance_check',
      entity_type: 'compliance',
      entity_id: returnId,
      details: {
        total_rules: results.length,
        passed: passed.length,
        failed: failed.length,
        audit_risk_score: auditRiskScore,
      },
    });

    log.info({ returnId, passed: passed.length, failed: failed.length, auditRiskScore }, 'Compliance check completed');

    return c.json({
      success: true,
      data: {
        return_id: returnId,
        timestamp: new Date().toISOString(),
        summary: {
          total_rules: results.length,
          passed: passed.length,
          failed: failed.length,
          critical_failures: criticalFails.length,
          high_failures: highFails.length,
          ready_to_file: criticalFails.length === 0 && highFails.length === 0,
          audit_risk_score: auditRiskScore,
          audit_risk_level: auditRiskScore <= 10 ? 'low' : auditRiskScore <= 30 ? 'moderate' : auditRiskScore <= 60 ? 'elevated' : 'high',
        },
        results,
        critical_issues: criticalFails,
        high_issues: highFails,
      },
    });
  });

  // GET /report/:returnId — Get compliance report
  router.get('/report/:returnId', (c) => {
    const returnId = c.req.param('returnId');
    const taxReturn = getById(db, 'tax_returns', returnId) as Record<string, unknown> | undefined;
    if (!taxReturn) return c.json({ success: false, error: 'Return not found' }, 404);

    // Get latest compliance checks
    const checks = db.prepare(`
      SELECT rule_id, check_type, status, details, created_at
      FROM compliance_checks WHERE return_id = ? ORDER BY rule_id ASC
    `).all(returnId) as Record<string, unknown>[];

    if (checks.length === 0) {
      return c.json({
        success: true,
        data: {
          return_id: returnId,
          status: 'not_checked',
          message: 'No compliance checks have been run. POST /compliance/check/:returnId to run checks.',
          checks: [],
        },
      });
    }

    const passed = checks.filter(r => r.status === 'passed');
    const failed = checks.filter(r => r.status === 'failed');
    const warnings = checks.filter(r => r.status === 'warning');
    const overridden = checks.filter(r => r.status === 'overridden');

    // By category
    const byCategory: Record<string, { passed: number; failed: number; warning: number }> = {};
    for (const check of checks) {
      const cat = check.check_type as string;
      if (!byCategory[cat]) byCategory[cat] = { passed: 0, failed: 0, warning: 0 };
      if (check.status === 'passed') byCategory[cat].passed++;
      else if (check.status === 'failed') byCategory[cat].failed++;
      else if (check.status === 'warning') byCategory[cat].warning++;
    }

    return c.json({
      success: true,
      data: {
        return_id: returnId,
        last_checked: checks[0]?.created_at,
        summary: {
          total: checks.length,
          passed: passed.length,
          failed: failed.length,
          warnings: warnings.length,
          overridden: overridden.length,
          compliance_score: Math.round((passed.length / checks.length) * 100),
        },
        by_category: byCategory,
        checks,
        failed_details: failed,
        warning_details: warnings,
      },
    });
  });

  return router;
}
