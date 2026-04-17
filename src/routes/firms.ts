// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Firm Management Routes
// Multi-firm, multi-preparer, workflow management
// ═══════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { getById, update, logAudit } from '../services/database';
import { createLogger } from '../utils/logger';
import { z } from 'zod';

const log = createLogger('firms');

const CreateFirmSchema = z.object({
  name: z.string().min(1),
  ein: z.string().regex(/^\d{9}$/).optional(),
  efin: z.string().optional(),
  ptin: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  subscription_tier: z.enum(['professional', 'enterprise']).default('professional'),
  branding_config: z.record(z.unknown()).optional(),
});

export function firmRoutes(db: Database) {
  const router = new Hono();

  // POST /create — Create new firm
  router.post('/create', async (c) => {
    const body = await c.req.json();
    const parsed = CreateFirmSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const input = parsed.data;
    const id = crypto.randomUUID().replace(/-/g, '');

    // Check for duplicate EIN
    if (input.ein) {
      const existing = db.prepare('SELECT id FROM firms WHERE ein = ? AND active = 1').get(input.ein) as Record<string, unknown> | undefined;
      if (existing) {
        return c.json({ success: false, error: 'A firm with this EIN already exists' }, 409);
      }
    }

    db.prepare(`
      INSERT INTO firms (id, name, ein, efin, ptin, address, phone, email, subscription_tier, branding_config)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.name, input.ein || null, input.efin || null, input.ptin || null,
      input.address || null, input.phone || null, input.email || null,
      input.subscription_tier, input.branding_config ? JSON.stringify(input.branding_config) : null,
    );

    logAudit(db, {
      user_id: c.get('userId'),
      action: 'firm_created',
      entity_type: 'firm',
      entity_id: id,
      details: { name: input.name },
    });

    log.info({ firmId: id, name: input.name }, 'Firm created');
    const firm = getById(db, 'firms', id);
    return c.json({ success: true, data: firm }, 201);
  });

  // GET /:firmId — Get firm details
  router.get('/:firmId', (c) => {
    const firmId = c.req.param('firmId');
    const firm = getById(db, 'firms', firmId) as Record<string, unknown> | undefined;
    if (!firm) return c.json({ success: false, error: 'Firm not found' }, 404);

    // Get preparers
    const preparers = db.prepare(`
      SELECT id, name, ptin, designation, hourly_rate, cpe_hours_ytd, active
      FROM preparers WHERE firm_id = ? ORDER BY name ASC
    `).all(firmId) as Record<string, unknown>[];

    // Parse branding config
    if (firm.branding_config && typeof firm.branding_config === 'string') {
      try { firm.branding_config = JSON.parse(firm.branding_config as string); } catch { /* keep as string */ }
    }

    return c.json({
      success: true,
      data: {
        ...firm,
        preparers,
        preparer_count: preparers.length,
        active_preparers: preparers.filter(p => p.active).length,
      },
    });
  });

  // GET /:firmId/dashboard — Firm dashboard with analytics
  router.get('/:firmId/dashboard', (c) => {
    const firmId = c.req.param('firmId');
    const firm = getById(db, 'firms', firmId) as Record<string, unknown> | undefined;
    if (!firm) return c.json({ success: false, error: 'Firm not found' }, 404);

    const currentYear = new Date().getFullYear();

    // Preparer stats
    const preparers = db.prepare(`
      SELECT p.id, p.name, p.designation, p.hourly_rate, p.cpe_hours_ytd,
        COUNT(ra.id) as assigned_returns,
        SUM(CASE WHEN ra.status = 'filed' THEN 1 ELSE 0 END) as filed_returns,
        SUM(ra.time_spent_minutes) as total_minutes
      FROM preparers p
      LEFT JOIN return_assignments ra ON ra.preparer_id = p.id
      WHERE p.firm_id = ? AND p.active = 1
      GROUP BY p.id ORDER BY filed_returns DESC
    `).all(firmId) as Record<string, unknown>[];

    // Return status breakdown
    const returnStats = db.prepare(`
      SELECT tr.status, COUNT(*) as count
      FROM tax_returns tr
      JOIN return_assignments ra ON ra.return_id = tr.id
      JOIN preparers p ON ra.preparer_id = p.id
      WHERE p.firm_id = ? AND tr.tax_year = ?
      GROUP BY tr.status
    `).all(firmId, currentYear) as Record<string, unknown>[];

    // Revenue metrics
    const totalReturns = db.prepare(`
      SELECT COUNT(*) as count FROM return_assignments ra
      JOIN preparers p ON ra.preparer_id = p.id WHERE p.firm_id = ?
    `).get(firmId) as { count: number };

    const filedThisYear = db.prepare(`
      SELECT COUNT(*) as count FROM return_assignments ra
      JOIN preparers p ON ra.preparer_id = p.id
      JOIN tax_returns tr ON ra.return_id = tr.id
      WHERE p.firm_id = ? AND tr.tax_year = ? AND ra.status = 'filed'
    `).get(firmId, currentYear) as { count: number };

    // Total billable hours
    const totalMinutes = db.prepare(`
      SELECT COALESCE(SUM(ra.time_spent_minutes), 0) as total FROM return_assignments ra
      JOIN preparers p ON ra.preparer_id = p.id WHERE p.firm_id = ?
    `).get(firmId) as { total: number };

    // E-file acceptance rate
    const efileStats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN es.status = 'accepted' THEN 1 ELSE 0 END) as accepted,
        SUM(CASE WHEN es.status = 'rejected' THEN 1 ELSE 0 END) as rejected
      FROM efile_submissions es
      JOIN tax_returns tr ON es.return_id = tr.id
      JOIN return_assignments ra ON ra.return_id = tr.id
      JOIN preparers p ON ra.preparer_id = p.id
      WHERE p.firm_id = ?
    `).get(firmId) as { total: number; accepted: number; rejected: number };

    // Average refund/owed
    const avgRefund = db.prepare(`
      SELECT AVG(tr.refund_or_owed) as avg_refund, MIN(tr.refund_or_owed) as min_refund, MAX(tr.refund_or_owed) as max_refund
      FROM tax_returns tr
      JOIN return_assignments ra ON ra.return_id = tr.id
      JOIN preparers p ON ra.preparer_id = p.id
      WHERE p.firm_id = ? AND tr.tax_year = ? AND tr.status IN ('calculated', 'locked', 'filed', 'accepted')
    `).get(firmId, currentYear) as Record<string, number | null>;

    // Compliance score across all firm returns
    const complianceStats = db.prepare(`
      SELECT
        COUNT(*) as total_checks,
        SUM(CASE WHEN cc.status = 'passed' THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN cc.status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM compliance_checks cc
      JOIN tax_returns tr ON cc.return_id = tr.id
      JOIN return_assignments ra ON ra.return_id = tr.id
      JOIN preparers p ON ra.preparer_id = p.id
      WHERE p.firm_id = ?
    `).get(firmId) as { total_checks: number; passed: number; failed: number };

    return c.json({
      success: true,
      data: {
        firm: { id: firm.id, name: firm.name, subscription_tier: firm.subscription_tier },
        metrics: {
          total_returns_all_time: totalReturns.count,
          filed_this_year: filedThisYear.count,
          total_billable_hours: Math.round((totalMinutes.total / 60) * 10) / 10,
          avg_hours_per_return: totalReturns.count > 0
            ? Math.round((totalMinutes.total / 60 / totalReturns.count) * 10) / 10
            : 0,
        },
        return_status_breakdown: Object.fromEntries(returnStats.map(r => [r.status, r.count])),
        efile: {
          total_submissions: efileStats.total,
          accepted: efileStats.accepted,
          rejected: efileStats.rejected,
          acceptance_rate: efileStats.total > 0
            ? Math.round((efileStats.accepted / efileStats.total) * 100 * 10) / 10
            : null,
        },
        financials: {
          avg_refund: avgRefund.avg_refund ? Math.round(avgRefund.avg_refund) : null,
          min_refund: avgRefund.min_refund,
          max_refund: avgRefund.max_refund,
        },
        compliance: {
          total_checks: complianceStats.total_checks,
          passed: complianceStats.passed,
          failed: complianceStats.failed,
          score: complianceStats.total_checks > 0
            ? Math.round((complianceStats.passed / complianceStats.total_checks) * 100)
            : null,
        },
        preparers: preparers.map(p => ({
          ...p,
          hours_worked: Math.round(((p.total_minutes as number) || 0) / 60 * 10) / 10,
        })),
        generated_at: new Date().toISOString(),
      },
    });
  });

  return router;
}
