// Better Auth React client. Talks to the Bun API at NEXT_PUBLIC_API_URL.
// Cookies are scoped to host (not port), so they flow between :3001 and the
// Next.js dev port fine in development.

import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";

const baseURL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export const authClient = createAuthClient({
  baseURL,
  plugins: [
    // Mirror server-side User.additionalFields so the typed session
    // exposes `user.tier` without importing server code into the client.
    inferAdditionalFields({
      user: { tier: { type: "string", input: false } },
    }),
  ],
});

export const { useSession, signIn, signUp, signOut } = authClient;
