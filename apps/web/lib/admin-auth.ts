// JWT-backed admin session. Used from:
//   - middleware.ts (Edge runtime) → verifyAdminSession
//   - /api/admin/login (Node runtime) → signAdminSession
// `jose` is the only crypto library that works in both Edge and Node here.

import { SignJWT, jwtVerify } from 'jose';

export const ADMIN_COOKIE_NAME = 'wpi_admin_session';
export const ADMIN_SESSION_TTL_S = 7 * 24 * 60 * 60;

const ALG = 'HS256';
const ISSUER = 'wpi-admin';

function getSecret(): Uint8Array {
  const s = process.env.ADMIN_JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('ADMIN_JWT_SECRET must be set and at least 32 characters.');
  }
  return new TextEncoder().encode(s);
}

export async function signAdminSession(username: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: ALG })
    .setSubject(username)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_TTL_S}s`)
    .sign(getSecret());
}

export async function verifyAdminSession(token: string): Promise<{ sub: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { issuer: ISSUER });
    if (typeof payload.sub === 'string') return { sub: payload.sub };
    return null;
  } catch {
    return null;
  }
}
