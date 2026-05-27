#!/usr/bin/env bun
/**
 * make-pro-user.ts — create (or upgrade) a Pro test account.
 *
 * Usage:
 *   bun run scripts/make-pro-user.ts                          # defaults: pro@test.com / TestPass123!
 *   bun run scripts/make-pro-user.ts <email> <password> [name]
 *
 * Idempotent: if the email already exists, we skip signup and just flip tier=PREMIUM.
 * Uses Better Auth's signUpEmail to hash the password correctly, then a direct
 * SQL update because `tier` is marked `input: false` (no public API to set it).
 */

import { Database } from "bun:sqlite";
import path from "node:path";
import { auth } from "../src/lib/better-auth";

const email = process.argv[2] || "pro@test.com";
const password = process.argv[3] || "TestPass123!";
const name = process.argv[4] || "Pro Test";

const dbPath =
  process.env.AUTH_DB_PATH ||
  path.resolve(import.meta.dir, "../data/auth.sqlite");

const db = new Database(dbPath);
const existing = db
  .query<{ id: string; tier: string | null }, [string]>(
    "SELECT id, tier FROM user WHERE email = ?",
  )
  .get(email);

if (existing) {
  console.log(`[make-pro] user ${email} already exists (tier=${existing.tier ?? "FREE"})`);
} else {
  console.log(`[make-pro] creating ${email}`);
  await auth.api.signUpEmail({ body: { email, password, name } });
}

db.run("UPDATE user SET tier = 'PREMIUM' WHERE email = ?", [email]);
const after = db
  .query<{ email: string; tier: string }, [string]>(
    "SELECT email, tier FROM user WHERE email = ?",
  )
  .get(email);

console.log(`[make-pro] done — ${after?.email} tier=${after?.tier}`);
console.log(`[make-pro] credentials: ${email} / ${password}`);
db.close();
