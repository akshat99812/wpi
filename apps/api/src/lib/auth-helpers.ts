import { auth } from "./better-auth";

const allowlist = (process.env.PRO_ALLOWLIST_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function isPro(user: { tier?: string | null; email: string }): boolean {
  if (user.tier === "PREMIUM") return true;
  return allowlist.includes(user.email.toLowerCase());
}

export type SessionPayload = Awaited<ReturnType<typeof auth.api.getSession>>;
export type AuthedUser = NonNullable<SessionPayload>["user"];
