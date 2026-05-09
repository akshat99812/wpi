import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://wpi-sjse.onrender.com';

const googleConfigured =
  !!process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_ID !== 'your-google-client-id' &&
  !!process.env.GOOGLE_CLIENT_SECRET &&
  process.env.GOOGLE_CLIENT_SECRET !== 'your-google-client-secret';

export const authOptions: NextAuthOptions = {
  providers: googleConfigured
    ? [
        GoogleProvider({
          clientId:     process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        }),
      ]
    : [],

  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== 'google') return false;
      try {
        await fetch(`${API_BASE}/api/users/upsert`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            googleId: account.providerAccountId,
            email:    user.email,
            name:     user.name,
            image:    user.image,
          }),
        });
      } catch {
        // allow sign-in even if backend is down
      }
      return true;
    },

    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.googleId = token.sub;
      }
      try {
        const res = await fetch(`${API_BASE}/api/users/${token.sub}`);
        if (res.ok) {
          const u = await res.json() as { id: string; tier: 'FREE' | 'PREMIUM' };
          session.user.tier = u.tier;
          session.user.id   = u.id;
        }
      } catch {
        session.user.tier = 'FREE';
      }
      return session;
    },

    async jwt({ token }) {
      return token;
    },
  },

  pages: {
    signIn: '/',
  },
};
