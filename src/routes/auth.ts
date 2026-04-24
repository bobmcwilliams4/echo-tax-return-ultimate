import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import { pino } from 'pino';
import {
  sendEmailOtp, sendSmsOtp, verifyOtp,
  upsertUserFromGoogle, issueSessionJwt, verifySessionJwt,
  logAuthEvent, normalizeEmail, normalizePhone,
} from '../services/auth-service';

const log = pino({ name: 'auth-routes' });

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.AUTH_GOOGLE_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET || '';

const SendEmailOtpSchema = z.object({ email: z.string().email() });
const SendSmsOtpSchema = z.object({ phone: z.string().min(7) });
const VerifyOtpSchema = z.object({
  identifier: z.string().min(3),
  channel: z.enum(['email', 'sms']),
  code: z.string().regex(/^\d{6}$/),
});
const GoogleCallbackSchema = z.object({
  provider_account_id: z.string().min(1),
  email: z.string().email(),
  name: z.string().optional(),
  image_url: z.string().url().optional(),
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  token_expires_at: z.string().optional(),
  scope: z.string().optional(),
});

export function authRoutes(db: Database) {
  const router = new Hono();

  router.post('/otp/email', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = SendEmailOtpSchema.safeParse(body);
    if (!parsed.success) return c.json({ success: false, error: 'Invalid email' }, 400);
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || undefined;
    const ua = c.req.header('user-agent') || undefined;
    try {
      const r = await sendEmailOtp(db, parsed.data.email, ip, ua);
      logAuthEvent(db, { event: 'otp_sent', channel: 'email', identifier: normalizeEmail(parsed.data.email), ip, ua });
      return c.json({ success: true, data: r });
    } catch (e) {
      log.error({ err: e }, 'email otp send failed');
      logAuthEvent(db, { event: 'otp_send_error', channel: 'email', identifier: parsed.data.email, ip, ua, success: false, error: String(e) });
      return c.json({ success: false, error: 'Failed to send email' }, 500);
    }
  });

  router.post('/otp/sms', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = SendSmsOtpSchema.safeParse(body);
    if (!parsed.success) return c.json({ success: false, error: 'Invalid phone' }, 400);
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || undefined;
    const ua = c.req.header('user-agent') || undefined;
    try {
      const r = await sendSmsOtp(db, parsed.data.phone, ip, ua);
      logAuthEvent(db, { event: 'otp_sent', channel: 'sms', identifier: normalizePhone(parsed.data.phone), ip, ua });
      return c.json({ success: true, data: r });
    } catch (e) {
      log.error({ err: e }, 'sms otp send failed');
      logAuthEvent(db, { event: 'otp_send_error', channel: 'sms', identifier: parsed.data.phone, ip, ua, success: false, error: String(e) });
      return c.json({ success: false, error: 'Failed to send SMS' }, 500);
    }
  });

  router.post('/otp/verify', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = VerifyOtpSchema.safeParse(body);
    if (!parsed.success) return c.json({ success: false, error: 'Invalid payload' }, 400);
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || undefined;
    const ua = c.req.header('user-agent') || undefined;

    const r = verifyOtp(db, parsed.data.identifier, parsed.data.channel, parsed.data.code);
    if (!r.ok) {
      logAuthEvent(db, { event: 'otp_verify_failed', channel: parsed.data.channel, identifier: parsed.data.identifier, ip, ua, success: false, error: r.error });
      const map: Record<string, number> = { no_code: 404, expired: 410, locked: 429, mismatch: 401 };
      return c.json({ success: false, error: r.error }, (map[r.error] || 401) as any);
    }

    const user = r.user as Record<string, unknown>;
    const token = issueSessionJwt(user.id as string);
    logAuthEvent(db, { event: 'login_success', channel: parsed.data.channel, identifier: parsed.data.identifier, ip, ua, user_id: user.id as string });
    return c.json({ success: true, data: { token, user: publicUser(user) } });
  });

  router.post('/oauth/google/callback', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = GoogleCallbackSchema.safeParse(body);
    if (!parsed.success) return c.json({ success: false, error: 'Invalid payload', details: parsed.error.flatten() }, 400);
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || undefined;
    const ua = c.req.header('user-agent') || undefined;

    try {
      const user = upsertUserFromGoogle(db, parsed.data) as Record<string, unknown>;
      const token = issueSessionJwt(user.id as string);
      logAuthEvent(db, { event: 'login_success', channel: 'google', identifier: parsed.data.email, ip, ua, user_id: user.id as string });
      return c.json({ success: true, data: { token, user: publicUser(user) } });
    } catch (e) {
      log.error({ err: e }, 'google oauth upsert failed');
      logAuthEvent(db, { event: 'oauth_error', channel: 'google', identifier: parsed.data.email, ip, ua, success: false, error: String(e) });
      return c.json({ success: false, error: 'Failed to create session' }, 500);
    }
  });

  router.get('/me', (c) => {
    const authz = c.req.header('authorization') || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : null;
    if (!token) return c.json({ success: false, error: 'Not authenticated' }, 401);

    const payload = verifySessionJwt(token);
    if (!payload) return c.json({ success: false, error: 'Invalid token' }, 401);

    const user = db.prepare('SELECT * FROM user_accounts WHERE id = ? AND status = "active"').get(payload.sub);
    if (!user) return c.json({ success: false, error: 'User not found' }, 404);
    return c.json({ success: true, data: publicUser(user as Record<string, unknown>) });
  });

  router.get('/config', (c) => {
    return c.json({
      success: true,
      data: {
        google_client_id: GOOGLE_CLIENT_ID || null,
        google_configured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
        email_configured: Boolean(process.env.ZOHO_EMAIL && process.env.ZOHO_PASSWORD),
        sms_configured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
      },
    });
  });

  return router;
}

function publicUser(u: Record<string, unknown>) {
  return {
    id: u.id,
    email: u.email,
    email_verified: Boolean(u.email_verified_at),
    phone: u.phone,
    phone_verified: Boolean(u.phone_verified_at),
    name: u.name,
    image_url: u.image_url,
    role: u.role,
    created_at: u.created_at,
    last_login_at: u.last_login_at,
  };
}
