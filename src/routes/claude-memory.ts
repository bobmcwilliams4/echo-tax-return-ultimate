import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import crypto from 'node:crypto';
import { verifySessionJwt } from '../services/auth-service';

const MemoryCreateSchema = z.object({
  return_id: z.string().optional(),
  kind: z.enum(['conversation', 'decision', 'fact', 'preference', 'document_summary', 'answer', 'reasoning']),
  content: z.string().min(1).max(32_000),
  importance: z.number().int().min(1).max(10).default(5),
  tags: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export function claudeMemoryRoutes(db: Database) {
  const router = new Hono();

  router.use('*', async (c, next) => {
    const authz = c.req.header('authorization') || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : null;
    if (!token) return c.json({ success: false, error: 'Not authenticated' }, 401);
    const payload = verifySessionJwt(token);
    if (!payload) return c.json({ success: false, error: 'Invalid token' }, 401);
    c.set('userId', payload.sub as unknown as string);
    await next();
  });

  router.post('/', async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json().catch(() => ({}));
    const parsed = MemoryCreateSchema.safeParse(body);
    if (!parsed.success) return c.json({ success: false, error: 'Invalid payload', details: parsed.error.flatten() }, 400);
    const id = crypto.randomUUID().replace(/-/g, '');
    db.prepare(`
      INSERT INTO claude_memory (id, user_id, return_id, kind, content, importance, tags, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, userId,
      parsed.data.return_id ?? null,
      parsed.data.kind,
      parsed.data.content,
      parsed.data.importance,
      parsed.data.tags ?? null,
      parsed.data.metadata ? JSON.stringify(parsed.data.metadata) : null,
    );
    const row = db.prepare('SELECT * FROM claude_memory WHERE id = ?').get(id);
    return c.json({ success: true, data: row }, 201);
  });

  router.get('/', (c) => {
    const userId = c.get('userId') as string;
    const kind = c.req.query('kind');
    const returnId = c.req.query('return_id');
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 500);

    const where: string[] = ['user_id = ?'];
    const args: unknown[] = [userId];
    if (kind) { where.push('kind = ?'); args.push(kind); }
    if (returnId) { where.push('return_id = ?'); args.push(returnId); }

    const rows = db.prepare(
      `SELECT * FROM claude_memory WHERE ${where.join(' AND ')} ORDER BY importance DESC, created_at DESC LIMIT ?`
    ).all(...args, limit);
    return c.json({ success: true, data: rows });
  });

  router.get('/search', (c) => {
    const userId = c.get('userId') as string;
    const q = (c.req.query('q') || '').trim();
    const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
    if (!q) return c.json({ success: true, data: [] });

    const rows = db.prepare(`
      SELECT cm.*, bm25(claude_memory_fts) AS rank
      FROM claude_memory_fts
      JOIN claude_memory cm ON cm.rowid = claude_memory_fts.rowid
      WHERE claude_memory_fts MATCH ? AND cm.user_id = ?
      ORDER BY rank ASC, cm.importance DESC
      LIMIT ?
    `).all(q, userId, limit);
    return c.json({ success: true, data: rows });
  });

  router.delete('/:id', (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const r = db.prepare('DELETE FROM claude_memory WHERE id = ? AND user_id = ?').run(id, userId);
    if (r.changes === 0) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true });
  });

  return router;
}
