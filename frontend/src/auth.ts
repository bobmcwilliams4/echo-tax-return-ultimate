import NextAuth, { type DefaultSession } from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';

const API_BASE = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9000';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      etruToken?: string;
      role?: string;
    } & DefaultSession['user'];
  }
}

async function callBackend(path: string, body: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({ success: false, error: 'bad_json' }));
  if (!res.ok || !data.success) {
    const err = data?.error || `backend_${res.status}`;
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }
  return data.data;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  trustHost: true,
  pages: {
    signIn: '/signin',
    error: '/signin',
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID || process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      authorization: { params: { prompt: 'consent', access_type: 'offline', response_type: 'code' } },
    }),
    Credentials({
      id: 'email-otp',
      name: 'Email code',
      credentials: {
        email: { label: 'Email', type: 'email' },
        code: { label: 'Code', type: 'text' },
      },
      async authorize(credentials) {
        const email = credentials?.email as string;
        const code = credentials?.code as string;
        if (!email || !code) return null;
        try {
          const data = await callBackend('/api/auth/otp/verify', {
            identifier: email, channel: 'email', code,
          });
          return {
            id: data.user.id,
            email: data.user.email,
            name: data.user.name ?? data.user.email,
            image: data.user.image_url ?? null,
            etruToken: data.token,
            role: data.user.role,
          } as any;
        } catch {
          return null;
        }
      },
    }),
    Credentials({
      id: 'sms-otp',
      name: 'SMS code',
      credentials: {
        phone: { label: 'Phone', type: 'tel' },
        code: { label: 'Code', type: 'text' },
      },
      async authorize(credentials) {
        const phone = credentials?.phone as string;
        const code = credentials?.code as string;
        if (!phone || !code) return null;
        try {
          const data = await callBackend('/api/auth/otp/verify', {
            identifier: phone, channel: 'sms', code,
          });
          return {
            id: data.user.id,
            phone: data.user.phone,
            name: data.user.name ?? data.user.phone,
            email: data.user.email ?? null,
            etruToken: data.token,
            role: data.user.role,
          } as any;
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile, user }) {
      if (account?.provider === 'google' && profile?.email) {
        try {
          const data = await callBackend('/api/auth/oauth/google/callback', {
            provider_account_id: account.providerAccountId,
            email: profile.email,
            name: (profile as any).name,
            image_url: (profile as any).picture,
            access_token: account.access_token,
            refresh_token: account.refresh_token,
            id_token: account.id_token,
            token_expires_at: account.expires_at
              ? new Date(account.expires_at * 1000).toISOString()
              : undefined,
            scope: account.scope,
          });
          (user as any).etruToken = data.token;
          (user as any).id = data.user.id;
          (user as any).role = data.user.role;
        } catch (e) {
          console.error('google upsert failed', e);
          return false;
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = (user as any).id || token.sub;
        token.etruToken = (user as any).etruToken;
        token.role = (user as any).role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.sub as string;
      session.user.etruToken = token.etruToken as string | undefined;
      session.user.role = token.role as string | undefined;
      return session;
    },
  },
});
