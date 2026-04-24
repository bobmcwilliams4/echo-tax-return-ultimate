'use client';

import { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';

type Tab = 'google' | 'email' | 'sms';

function SignInInner() {
  const params = useSearchParams();
  const callbackUrl = params.get('callbackUrl') || '/dashboard';
  const errorParam = params.get('error');

  const [tab, setTab] = useState<Tab>('email');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    errorParam === 'CredentialsSignin' ? 'Wrong or expired code' : errorParam,
  );

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);

  async function handleGoogle() {
    setLoading(true);
    setError(null);
    await signIn('google', { callbackUrl });
  }

  async function requestCode(channel: 'email' | 'sms') {
    setLoading(true);
    setError(null);
    setMessage(null);
    const identifier = channel === 'email' ? email : phone;
    try {
      const res = await fetch('/api/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, identifier }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'send_failed');
      setCodeSent(true);
      setMessage(`Code sent to ${identifier}`);
    } catch (e: any) {
      setError(e.message || 'Failed to send code');
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(channel: 'email' | 'sms') {
    setLoading(true);
    setError(null);
    const providerId = channel === 'email' ? 'email-otp' : 'sms-otp';
    const credentials =
      channel === 'email' ? { email, code } : { phone, code };
    const res = await signIn(providerId, { ...credentials, redirect: false, callbackUrl });
    setLoading(false);
    if (res?.error) {
      setError('Invalid or expired code');
    } else if (res?.ok) {
      window.location.href = callbackUrl;
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.brand}>
          <h1 style={styles.title}>Echo Tax Return Ultimate</h1>
          <p style={styles.subtitle}>Sign in to access your tax workspace</p>
        </div>

        <div style={styles.tabs}>
          {(['email', 'sms', 'google'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setCodeSent(false); setError(null); setMessage(null); }}
              style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }}
            >
              {t === 'email' ? 'Email' : t === 'sms' ? 'Phone' : 'Google'}
            </button>
          ))}
        </div>

        {tab === 'google' && (
          <button onClick={handleGoogle} disabled={loading} style={styles.googleBtn}>
            <svg width="18" height="18" viewBox="0 0 18 18" style={{ marginRight: 8 }}>
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            {loading ? 'Redirecting…' : 'Continue with Google'}
          </button>
        )}

        {tab === 'email' && (
          <div style={styles.form}>
            {!codeSent ? (
              <>
                <label style={styles.label}>Email address</label>
                <input
                  style={styles.input}
                  type="email"
                  autoFocus
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button
                  style={styles.primaryBtn}
                  onClick={() => requestCode('email')}
                  disabled={loading || !email.includes('@')}
                >
                  {loading ? 'Sending…' : 'Send code'}
                </button>
              </>
            ) : (
              <>
                <label style={styles.label}>6-digit code sent to {email}</label>
                <input
                  style={styles.input}
                  type="text"
                  autoFocus
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
                <button
                  style={styles.primaryBtn}
                  onClick={() => verifyCode('email')}
                  disabled={loading || code.length !== 6}
                >
                  {loading ? 'Verifying…' : 'Sign in'}
                </button>
                <button style={styles.linkBtn} onClick={() => { setCodeSent(false); setCode(''); }}>
                  Use a different email
                </button>
              </>
            )}
          </div>
        )}

        {tab === 'sms' && (
          <div style={styles.form}>
            {!codeSent ? (
              <>
                <label style={styles.label}>Phone number (US)</label>
                <input
                  style={styles.input}
                  type="tel"
                  autoFocus
                  placeholder="+1 555 123 4567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                <button
                  style={styles.primaryBtn}
                  onClick={() => requestCode('sms')}
                  disabled={loading || phone.length < 10}
                >
                  {loading ? 'Sending…' : 'Send code'}
                </button>
              </>
            ) : (
              <>
                <label style={styles.label}>6-digit code sent to {phone}</label>
                <input
                  style={styles.input}
                  type="text"
                  autoFocus
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
                <button
                  style={styles.primaryBtn}
                  onClick={() => verifyCode('sms')}
                  disabled={loading || code.length !== 6}
                >
                  {loading ? 'Verifying…' : 'Sign in'}
                </button>
                <button style={styles.linkBtn} onClick={() => { setCodeSent(false); setCode(''); }}>
                  Use a different phone
                </button>
              </>
            )}
          </div>
        )}

        {message && <div style={styles.info}>{message}</div>}
        {error && <div style={styles.err}>{error}</div>}

        <p style={styles.footer}>
          By signing in you agree to our terms. One-time codes expire in 10 minutes.
        </p>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div style={styles.page}>Loading…</div>}>
      <SignInInner />
    </Suspense>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #0b1120 0%, #1e293b 100%)',
    padding: '32px 16px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: 16,
    padding: 32,
    boxShadow: '0 25px 60px -15px rgba(0,0,0,0.4)',
  },
  brand: { marginBottom: 24, textAlign: 'center' as const },
  title: { fontSize: 22, fontWeight: 700, margin: '0 0 4px' },
  subtitle: { fontSize: 14, color: '#64748b', margin: 0 },
  tabs: {
    display: 'flex',
    gap: 4,
    background: '#f1f5f9',
    padding: 4,
    borderRadius: 10,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    border: 'none',
    background: 'transparent',
    padding: '8px 12px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
    color: '#64748b',
  },
  tabActive: {
    background: '#ffffff',
    color: '#0f172a',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  form: { display: 'flex', flexDirection: 'column' as const, gap: 10 },
  label: { fontSize: 13, fontWeight: 500, color: '#475569' },
  input: {
    padding: '12px 14px',
    border: '1px solid #cbd5e1',
    borderRadius: 10,
    fontSize: 15,
    outline: 'none',
  },
  primaryBtn: {
    background: '#0f172a',
    color: '#fff',
    border: 'none',
    padding: '12px 16px',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 4,
  },
  googleBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    background: '#ffffff',
    color: '#0f172a',
    border: '1px solid #cbd5e1',
    padding: '12px 16px',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 500,
    cursor: 'pointer',
  },
  linkBtn: {
    background: 'transparent',
    border: 'none',
    color: '#0f766e',
    fontSize: 13,
    cursor: 'pointer',
    padding: 8,
    marginTop: 4,
  },
  info: {
    marginTop: 12,
    padding: '10px 12px',
    background: '#ecfdf5',
    color: '#065f46',
    borderRadius: 8,
    fontSize: 13,
  },
  err: {
    marginTop: 12,
    padding: '10px 12px',
    background: '#fef2f2',
    color: '#991b1b',
    borderRadius: 8,
    fontSize: 13,
  },
  footer: {
    marginTop: 20,
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center' as const,
  },
};
