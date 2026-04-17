// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Client Management Routes
// ═══════════════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { CreateClientSchema } from '../types/tax';
import { getById, listPaginated, update, remove, logAudit } from '../services/database';
import { encryptField, extractLast4 } from '../utils/encryption';
import { createLogger } from '../utils/logger';

const log = createLogger('clients');

export function clientRoutes(db: Database) {
  const router = new Hono();

  // POST /clients — Create client
  router.post('/', async (c) => {
    const body = await c.req.json();
    const parsed = CreateClientSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const input = parsed.data;
    const id = crypto.randomUUID().replace(/-/g, '');

    // Encrypt PII
    const ssnEncrypted = input.ssn ? encryptField(input.ssn) : null;
    const ssnLast4 = input.ssn ? extractLast4(input.ssn) : null;
    const spouseSsnEncrypted = input.spouse_ssn ? encryptField(input.spouse_ssn) : null;
    const spouseSsnLast4 = input.spouse_ssn ? extractLast4(input.spouse_ssn) : null;

    db.prepare(`
      INSERT INTO clients (id, user_id, email, first_name, middle_name, last_name, suffix,
        ssn_encrypted, ssn_last4, dob, phone, address_street, address_city, address_state,
        address_zip, filing_status, occupation, spouse_first_name, spouse_last_name,
        spouse_ssn_encrypted, spouse_ssn_last4, spouse_dob, spouse_occupation, ip_pin)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.user_id, input.email || null, input.first_name, input.middle_name || null,
      input.last_name, input.suffix || null, ssnEncrypted, ssnLast4, input.dob || null,
      input.phone || null, input.address_street || null, input.address_city || null,
      input.address_state || null, input.address_zip || null, input.filing_status || null,
      input.occupation || null, input.spouse_first_name || null, input.spouse_last_name || null,
      spouseSsnEncrypted, spouseSsnLast4, input.spouse_dob || null, input.spouse_occupation || null,
      input.ip_pin || null,
    );

    logAudit(db, {
      client_id: id,
      user_id: c.get('userId'),
      action: 'client_created',
      entity_type: 'client',
      entity_id: id,
    });

    log.info({ clientId: id }, 'Client created');
    const client = getById(db, 'clients', id);
    return c.json({ success: true, data: client }, 201);
  });

  // GET /clients/:id — Get client
  router.get('/:id', (c) => {
    const client = getById(db, 'clients', c.req.param('id'));
    if (!client) return c.json({ success: false, error: 'Client not found' }, 404);
    return c.json({ success: true, data: client });
  });

  // GET /clients — List clients
  router.get('/', (c) => {
    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 100);
    const userId = c.req.query('user_id');

    const result = listPaginated(db, 'clients', {
      page,
      limit,
      where: userId ? 'user_id = ?' : undefined,
      args: userId ? [userId] : undefined,
    });

    return c.json({ success: true, ...result });
  });

  // PUT /clients/:id — Update client
  router.put('/:id', async (c) => {
    const id = c.req.param('id');
    const existing = getById(db, 'clients', id);
    if (!existing) return c.json({ success: false, error: 'Client not found' }, 404);

    const body = await c.req.json();
    // Handle SSN update
    if (body.ssn) {
      body.ssn_encrypted = encryptField(body.ssn);
      body.ssn_last4 = extractLast4(body.ssn);
      delete body.ssn;
    }
    if (body.spouse_ssn) {
      body.spouse_ssn_encrypted = encryptField(body.spouse_ssn);
      body.spouse_ssn_last4 = extractLast4(body.spouse_ssn);
      delete body.spouse_ssn;
    }

    update(db, 'clients', id, body);

    logAudit(db, {
      client_id: id,
      user_id: c.get('userId'),
      action: 'client_updated',
      entity_type: 'client',
      entity_id: id,
      details: { fields_updated: Object.keys(body) },
    });

    const updated = getById(db, 'clients', id);
    return c.json({ success: true, data: updated });
  });

  // DELETE /clients/:id — Delete client
  router.delete('/:id', (c) => {
    const id = c.req.param('id');
    const existing = getById(db, 'clients', id);
    if (!existing) return c.json({ success: false, error: 'Client not found' }, 404);

    remove(db, 'clients', id);

    logAudit(db, {
      client_id: id,
      user_id: c.get('userId'),
      action: 'client_deleted',
      entity_type: 'client',
      entity_id: id,
    });

    return c.json({ success: true, message: 'Client deleted' });
  });

  // GET /clients/:id/tax-history — Multi-year tax history
  router.get('/:id/tax-history', (c) => {
    const clientId = c.req.param('id');
    const returns = db.prepare(`
      SELECT tax_year, status, return_type, total_income, adjusted_gross_income,
             taxable_income, total_tax, refund_or_owed, effective_rate, filed_at
      FROM tax_returns WHERE client_id = ? ORDER BY tax_year DESC
    `).all(clientId);

    return c.json({ success: true, data: returns });
  });

  return router;
}
