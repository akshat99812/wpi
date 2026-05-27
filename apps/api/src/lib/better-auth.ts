// Better Auth server instance. Lives only in the API — Next.js talks to it
// over HTTP via the auth-client. Same DB, same secret, one source of truth.
//
// Email OTP / verification / forgot-password are intentionally DISABLED.
// Re-add the `emailOTP` plugin + `requireEmailVerification: true` once the
// email-delivery strategy is decided.

import { betterAuth } from "better-auth";
import { Database } from "bun:sqlite";
import path, { dirname } from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath =
  process.env.AUTH_DB_PATH ||
  path.resolve(__dirname, "../../data/auth.sqlite");

const dbDir = dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const sqlite = new Database(dbPath, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL;");

const trustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const auth = betterAuth({
  database: sqlite,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
  },
  user: {
    additionalFields: {
      tier: {
        type: "string",
        defaultValue: "FREE",
        input: false,
      },
    },
  },
  advanced: {
    cookiePrefix: "wpi",
    crossSubDomainCookies: process.env.AUTH_COOKIE_DOMAIN
      ? { enabled: true, domain: process.env.AUTH_COOKIE_DOMAIN }
      : undefined,
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  },
});

export type Session = typeof auth.$Infer.Session;
