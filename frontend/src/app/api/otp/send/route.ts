import { NextResponse } from 'next/server';

const API_BASE = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9000';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ success: false, error: 'bad_body' }, { status: 400 });

  const channel: 'email' | 'sms' = body.channel;
  const identifier: string = body.identifier;
  if (!channel || !identifier) {
    return NextResponse.json({ success: false, error: 'missing_fields' }, { status: 400 });
  }

  const target = channel === 'email'
    ? `${API_BASE}/api/auth/otp/email`
    : `${API_BASE}/api/auth/otp/sms`;
  const payload = channel === 'email' ? { email: identifier } : { phone: identifier };

  const res = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({ success: false }));
  return NextResponse.json(data, { status: res.status });
}
