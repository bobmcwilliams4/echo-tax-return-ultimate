import { auth } from '@/auth';
import { NextResponse } from 'next/server';

const PUBLIC_PATHS = [
  '/',
  '/signin',
  '/signup',
  '/about',
  '/pricing',
  '/terms',
  '/privacy',
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/api/otp/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/public/') ||
    PUBLIC_PATHS.includes(pathname)
  ) {
    return NextResponse.next();
  }

  if (!req.auth) {
    const url = new URL('/signin', req.url);
    url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
