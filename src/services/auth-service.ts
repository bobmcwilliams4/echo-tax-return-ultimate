import type { Database } from 'bun:sqlite';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import twilio from 'twilio';
import jwt from 'jsonwebtoken';
import { pino } from 'pino';

const log = pino({ name: 'auth-service' });

const OTP_TTL_MIN = 10;
const SESSION_TTL_DAYS = 30;

const JWT_SECRET = process.env.AUTH_JWT_SECRET || 'etru-dev-jwt-secret-change-me';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'Echo Tax <no-reply@echo-op.com>';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || process.env.ZOHO_EMAIL || '';
const SMTP_PASS = process.env.SMTP_PASS || process.env.ZOHO_PASSWORD || '';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_API_KEY_SID = process.env.TWILIO_API_KEY_SID || '';
const TWILIO_API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM = process.env.TWILIO_FROM_PHONE || '';

async function sendViaResend(to: string, subject: string, text: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, text, html }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend ${res.status}: ${err}`);
  }
  return res.json();
}

let mailer: nodemailer.Transporter | null = null;
function getMailer() {
  if (mailer) return mailer;
  if (!SMTP_USER || !SMTP_PASS) return null;
  mailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return mailer;
}

let twilioClient: ReturnType<typeof twilio> | null = null;
function getTwilio() {
  if (twilioClient) return twilioClient;
  // Prefer API key auth (more secure, rotatable)
  if (TWILIO_API_KEY_SID && TWILIO_API_KEY_SECRET && TWILIO_ACCOUNT_SID) {
    twilioClient = twilio(TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, { accountSid: TWILIO_ACCOUNT_SID });
    return twilioClient;
  }
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    return twilioClient;
  }
  log.warn('Twilio not configured — SMS OTP will fail');
  return null;
}

function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function generateCode(): string {
  const buf = crypto.randomBytes(4).readUInt32BE(0);
  return String(buf % 1_000_000).padStart(6, '0');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  let p = phone.replace(/[^\d+]/g, '');
  if (!p.startsWith('+')) {
    if (p.length === 10) p = '+1' + p;
    else if (p.length === 11 && p.startsWith('1')) p = '+' + p;
    else p = '+' + p;
  }
  return p;
}

export async function sendEmailOtp(db: Database, email: string, ip?: string, ua?: string) {
  const identifier = normalizeEmail(email);
  const code = generateCode();
  const codeHash = sha256(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString();

  db.prepare(`
    INSERT INTO otp_codes (identifier, channel, code_hash, expires_at, ip_address, user_agent)
    VALUES (?, 'email', ?, ?, ?, ?)
  `).run(identifier, codeHash, expiresAt, ip ?? null, ua ?? null);

  const subject = `Your Echo Tax login code: ${code}`;
  const text = `Your one-time login code is ${code}. It expires in ${OTP_TTL_MIN} minutes.\n\nIf you didn't request this, ignore this email.`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 12px">Echo Tax Return Ultimate</h2>
      <p>Your one-time login code:</p>
      <div style="font-size:36px;font-weight:700;letter-spacing:8px;padding:16px;background:#0f172a;color:#fff;border-radius:8px;text-align:center">${code}</div>
      <p style="color:#64748b;margin-top:16px">Expires in ${OTP_TTL_MIN} minutes. If you didn't request this, ignore this email.</p>
    </div>
  `;

  const transport = getMailer();
  if (transport) {
    try {
      await transport.sendMail({ from: MAIL_FROM || `"Echo Tax" <${SMTP_USER}>`, to: identifier, subject, text, html });
      log.info({ identifier, via: 'smtp' }, 'Email OTP sent via SMTP');
      return { sent: true, expires_at: expiresAt };
    } catch (e) {
      log.warn({ err: (e as Error).message }, 'SMTP failed, trying Resend');
    }
  }
  if (RESEND_API_KEY) {
    await sendViaResend(identifier, subject, text, html);
    log.info({ identifier, via: 'resend' }, 'Email OTP sent via Resend');
  } else if (!transport) {
    log.warn({ identifier, code }, 'Email OTP (dry-run, no mail provider)');
  }

  return { sent: true, expires_at: expiresAt };
}

export async function sendSmsOtp(db: Database, phone: string, ip?: string, ua?: string) {
  const identifier = normalizePhone(phone);
  const code = generateCode();
  const codeHash = sha256(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString();

  db.prepare(`
    INSERT INTO otp_codes (identifier, channel, code_hash, expires_at, ip_address, user_agent)
    VALUES (?, 'sms', ?, ?, ?, ?)
  `).run(identifier, codeHash, expiresAt, ip ?? null, ua ?? null);

  const client = getTwilio();
  if (client && TWILIO_FROM) {
    await client.messages.create({
      from: TWILIO_FROM,
      to: identifier,
      body: `Echo Tax login code: ${code}. Expires in ${OTP_TTL_MIN} min.`,
    });
    log.info({ identifier }, 'SMS OTP sent');
  } else {
    log.warn({ identifier, code }, 'SMS OTP (dry-run, no Twilio)');
  }

  return { sent: true, expires_at: expiresAt };
}

export function verifyOtp(db: Database, identifier: string, channel: 'email' | 'sms', code: string) {
  const ident = channel === 'email' ? normalizeEmail(identifier) : normalizePhone(identifier);
  const codeHash = sha256(code);

  const row = db.prepare(`
    SELECT id, code_hash, expires_at, consumed_at, attempts, max_attempts
    FROM otp_codes
    WHERE identifier = ? AND channel = ? AND consumed_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `).get(ident, channel) as Record<string, unknown> | undefined;

  if (!row) return { ok: false, error: 'no_code' as const };
  if (new Date(row.expires_at as string).getTime() < Date.now()) return { ok: false, error: 'expired' as const };
  if ((row.attempts as number) >= (row.max_attempts as number)) return { ok: false, error: 'locked' as const };

  if ((row.code_hash as string) !== codeHash) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    return { ok: false, error: 'mismatch' as const };
  }

  db.prepare("UPDATE otp_codes SET consumed_at = datetime('now') WHERE id = ?").run(row.id);

  const user = upsertUserByIdentifier(db, ident, channel);
  return { ok: true as const, user };
}

export function upsertUserByIdentifier(db: Database, identifier: string, channel: 'email' | 'sms') {
  const col = channel === 'email' ? 'email' : 'phone';
  const verifiedCol = channel === 'email' ? 'email_verified_at' : 'phone_verified_at';

  let user = db.prepare(`SELECT * FROM user_accounts WHERE ${col} = ?`).get(identifier) as Record<string, unknown> | undefined;
  if (!user) {
    const id = crypto.randomUUID().replace(/-/g, '');
    db.prepare(`
      INSERT INTO user_accounts (id, ${col}, ${verifiedCol}, last_login_at, login_count)
      VALUES (?, ?, datetime('now'), datetime('now'), 1)
    `).run(id, identifier);
    user = db.prepare('SELECT * FROM user_accounts WHERE id = ?').get(id) as Record<string, unknown>;
    log.info({ userId: id, channel }, 'New user created');
  } else {
    db.prepare(`
      UPDATE user_accounts
      SET ${verifiedCol} = COALESCE(${verifiedCol}, datetime('now')),
          last_login_at = datetime('now'),
          login_count = login_count + 1,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(user.id);
    user = db.prepare('SELECT * FROM user_accounts WHERE id = ?').get(user.id) as Record<string, unknown>;
  }
  return user;
}

export function upsertUserFromGoogle(db: Database, profile: {
  provider_account_id: string;
  email: string;
  name?: string;
  image_url?: string;
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  token_expires_at?: string;
  scope?: string;
}) {
  const email = normalizeEmail(profile.email);

  let user = db.prepare('SELECT * FROM user_accounts WHERE email = ?').get(email) as Record<string, unknown> | undefined;
  if (!user) {
    const id = crypto.randomUUID().replace(/-/g, '');
    db.prepare(`
      INSERT INTO user_accounts (id, email, email_verified_at, name, image_url, last_login_at, login_count)
      VALUES (?, ?, datetime('now'), ?, ?, datetime('now'), 1)
    `).run(id, email, profile.name ?? null, profile.image_url ?? null);
    user = db.prepare('SELECT * FROM user_accounts WHERE id = ?').get(id) as Record<string, unknown>;
  } else {
    db.prepare(`
      UPDATE user_accounts
      SET email_verified_at = COALESCE(email_verified_at, datetime('now')),
          name = COALESCE(?, name),
          image_url = COALESCE(?, image_url),
          last_login_at = datetime('now'),
          login_count = login_count + 1,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(profile.name ?? null, profile.image_url ?? null, user.id);
    user = db.prepare('SELECT * FROM user_accounts WHERE id = ?').get(user.id) as Record<string, unknown>;
  }

  const existing = db.prepare(
    'SELECT id FROM oauth_accounts WHERE provider = ? AND provider_account_id = ?'
  ).get('google', profile.provider_account_id) as { id: string } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE oauth_accounts
      SET access_token = ?, refresh_token = COALESCE(?, refresh_token), id_token = ?,
          token_expires_at = ?, scope = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      profile.access_token ?? null,
      profile.refresh_token ?? null,
      profile.id_token ?? null,
      profile.token_expires_at ?? null,
      profile.scope ?? null,
      existing.id,
    );
  } else {
    db.prepare(`
      INSERT INTO oauth_accounts (user_id, provider, provider_account_id, access_token, refresh_token, id_token, token_expires_at, scope)
      VALUES (?, 'google', ?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      profile.provider_account_id,
      profile.access_token ?? null,
      profile.refresh_token ?? null,
      profile.id_token ?? null,
      profile.token_expires_at ?? null,
      profile.scope ?? null,
    );
  }

  return user;
}

export function issueSessionJwt(userId: string) {
  const payload = { sub: userId, iat: Math.floor(Date.now() / 1000) };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: `${SESSION_TTL_DAYS}d` });
}

export function verifySessionJwt(token: string): { sub: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { sub: string };
  } catch {
    return null;
  }
}

export function logAuthEvent(db: Database, args: {
  user_id?: string | null;
  event: string;
  channel?: string;
  identifier?: string;
  ip?: string;
  ua?: string;
  success?: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}) {
  db.prepare(`
    INSERT INTO auth_audit_log (user_id, event, channel, identifier, ip_address, user_agent, success, error, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    args.user_id ?? null,
    args.event,
    args.channel ?? null,
    args.identifier ?? null,
    args.ip ?? null,
    args.ua ?? null,
    args.success === false ? 0 : 1,
    args.error ?? null,
    args.metadata ? JSON.stringify(args.metadata) : null,
  );
}
