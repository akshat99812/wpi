import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

const adminGoogleIds = (process.env.ADMIN_GOOGLE_IDS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export async function middleware(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token?.sub) {
    const signIn = new URL('/', req.url);
    signIn.searchParams.set('signin', '1');
    return NextResponse.redirect(signIn);
  }

  if (!adminGoogleIds.includes(token.sub)) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
