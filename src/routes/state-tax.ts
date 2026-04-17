// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — State Tax Routes
// Calculate, compare, and query state income tax across all 50 states + DC
// ═══════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { getById } from '../services/database';
import { createLogger } from '../utils/logger';
import {
  calculateStateTax,
  getStateInfo,
  listAllStates,
} from '../services/state-tax-engine';

const log = createLogger('state-tax');

export function stateTaxRoutes(db: Database) {
  const router = new Hono();

  // ─── POST /calculate — Calculate state tax for a return ──────────────

  router.post('/calculate', async (c) => {
    try {
      const body = await c.req.json();
      const { return_id, state, locality } = body;

      if (!return_id || !state) {
        return c.json({ success: false, error: 'return_id and state are required' }, 400);
      }

      // Load return
      const taxReturn = getById(db, 'tax_returns', return_id) as Record<string, unknown> | undefined;
      if (!taxReturn) {
        return c.json({ success: false, error: 'Return not found' }, 404);
      }

      // Load client for filing status
      const client = getById(db, 'clients', taxReturn.client_id as string) as Record<string, unknown> | undefined;
      const filingStatus = (client?.filing_status as string) || 'single';

      // Pull financial data from return
      const federalAGI = (taxReturn.adjusted_gross_income as number) || (taxReturn.agi as number) || 0;
      const federalTaxableIncome = (taxReturn.taxable_income as number) || 0;

      // Sum wages from income items
      const wageRow = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM income_items WHERE return_id = ? AND category IN ('wages', 'salary', 'w2')
      `).get(return_id) as { total: number };
      const wages = wageRow.total;

      // Count dependents
      const depRow = db.prepare(`
        SELECT COUNT(*) as count FROM dependents WHERE return_id = ?
      `).get(return_id) as { count: number };
      const dependents = depRow.count;

      // Itemized deductions total
      const itemizedRow = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total FROM deductions WHERE return_id = ?
      `).get(return_id) as { total: number };

      const result = calculateStateTax(
        state,
        federalAGI,
        filingStatus,
        federalTaxableIncome,
        wages,
        {
          locality,
          itemizedDeductions: itemizedRow.total,
          dependents,
        },
      );

      log.info({ return_id, state, tax: result.state_tax }, 'State tax calculated');

      return c.json({
        success: true,
        data: result,
        meta: {
          return_id,
          tax_year: taxReturn.tax_year || 2025,
          filing_status: filingStatus,
          federal_agi: federalAGI,
          wages,
          dependents,
        },
      });
    } catch (err) {
      log.error({ err }, 'State tax calculation failed');
      return c.json({ success: false, error: (err as Error).message }, 500);
    }
  });

  // ─── GET /info/:state — Get state tax info ──────────────────────────

  router.get('/info/:state', (c) => {
    const stateCode = c.req.param('state').toUpperCase();
    const info = getStateInfo(stateCode);

    if (!info) {
      return c.json({ success: false, error: `Unknown state: ${stateCode}` }, 404);
    }

    log.debug({ state: stateCode }, 'State info requested');

    return c.json({
      success: true,
      data: info,
    });
  });

  // ─── GET /states — List all states with tax type and top rate ────────

  router.get('/states', (c) => {
    const states = listAllStates();

    // Optional filtering
    const typeFilter = c.req.query('type'); // none, flat, progressive
    const filtered = typeFilter
      ? states.filter((s) => s.type === typeFilter)
      : states;

    return c.json({
      success: true,
      data: filtered,
      total: filtered.length,
    });
  });

  // ─── POST /compare — Compare tax across multiple states ─────────────

  router.post('/compare', async (c) => {
    try {
      const body = await c.req.json();
      const { return_id, states } = body;

      if (!return_id || !states || !Array.isArray(states) || states.length === 0) {
        return c.json({ success: false, error: 'return_id and states[] are required' }, 400);
      }

      if (states.length > 52) {
        return c.json({ success: false, error: 'Maximum 52 states for comparison' }, 400);
      }

      // Load return data once
      const taxReturn = getById(db, 'tax_returns', return_id) as Record<string, unknown> | undefined;
      if (!taxReturn) {
        return c.json({ success: false, error: 'Return not found' }, 404);
      }

      const client = getById(db, 'clients', taxReturn.client_id as string) as Record<string, unknown> | undefined;
      const filingStatus = (client?.filing_status as string) || 'single';
      const federalAGI = (taxReturn.adjusted_gross_income as number) || (taxReturn.agi as number) || 0;
      const federalTaxableIncome = (taxReturn.taxable_income as number) || 0;

      const wageRow = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM income_items WHERE return_id = ? AND category IN ('wages', 'salary', 'w2')
      `).get(return_id) as { total: number };
      const wages = wageRow.total;

      const depRow = db.prepare(`
        SELECT COUNT(*) as count FROM dependents WHERE return_id = ?
      `).get(return_id) as { count: number };

      const itemizedRow = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total FROM deductions WHERE return_id = ?
      `).get(return_id) as { total: number };

      // Calculate for each state
      const results = states.map((stateCode: string) =>
        calculateStateTax(
          stateCode,
          federalAGI,
          filingStatus,
          federalTaxableIncome,
          wages,
          {
            itemizedDeductions: itemizedRow.total,
            dependents: depRow.count,
          },
        ),
      );

      // Sort by total tax ascending (cheapest first)
      const sorted = [...results].sort((a, b) => a.state_tax - b.state_tax);

      // Calculate savings vs highest tax state
      const highestTax = sorted[sorted.length - 1]?.state_tax || 0;
      const comparison = sorted.map((r) => ({
        state: r.state,
        state_name: r.state_name,
        state_tax: r.state_tax,
        effective_rate: r.effective_rate,
        local_tax: r.local_tax || 0,
        total_state_local: r.state_tax + (r.local_tax || 0),
        savings_vs_highest: Math.round((highestTax - r.state_tax) * 100) / 100,
      }));

      log.info({ return_id, states_compared: states.length }, 'State tax comparison completed');

      return c.json({
        success: true,
        data: {
          comparison,
          details: results,
        },
        meta: {
          return_id,
          states_compared: states.length,
          federal_agi: federalAGI,
          filing_status: filingStatus,
          cheapest: sorted[0]?.state || null,
          most_expensive: sorted[sorted.length - 1]?.state || null,
        },
      });
    } catch (err) {
      log.error({ err }, 'State tax comparison failed');
      return c.json({ success: false, error: (err as Error).message }, 500);
    }
  });

  return router;
}
