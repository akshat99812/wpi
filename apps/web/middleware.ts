import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ADMIN_COOKIE_NAME, verifyAdminSession } from '@/lib/admin-auth';

const ADMIN_PUBLIC_PATHS = new Set([
  '/admin/login',
  '/api/admin/login',
  '/api/admin/logout',
]);

// Better Auth session cookie. With cookiePrefix="wpi" the name is
// "wpi.session_token". This is a UX-only presence check — the API
// always re-validates the cookie, so a forged value still gets 401'd there.
const USER_SESSION_COOKIE = 'wpi.session_token';

// Pro-gated UI routes. Real enforcement lives in the API (requirePro
// middleware); this just bounces unauthed visitors to /login first.
const PRO_PATHS = ['/chat', '/mast'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Admin area — unchanged JWT flow.
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    if (ADMIN_PUBLIC_PATHS.has(pathname)) return NextResponse.next();

    const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
    const session = token ? await verifyAdminSession(token) : null;

    if (!session) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const url = new URL('/admin/login', req.url);
      if (pathname && pathname !== '/admin') {
        url.searchParams.set('from', pathname);
      }
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Pro user area — redirect to /login if no session cookie.
  if (PRO_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const hasSession = req.cookies.get(USER_SESSION_COOKIE)?.value;
    if (!hasSession) {
      const url = new URL('/login', req.url);
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*', '/chat/:path*', '/mast/:path*'],
};
