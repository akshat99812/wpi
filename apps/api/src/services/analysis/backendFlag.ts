/**
 * Restart-free backend selector for the site-analysis migration (RUNBOOK_v3
 * §2.7). The route reads this PER REQUEST so ops can flip legacy↔service (or
 * toggle shadow comparison) without a redeploy.
 *
 * Resolution order (first hit wins), polled with a 1 s cache so the hot path
 * never pays an fs read per request:
 *   1. the flag FILE (SITE_ANALYSIS_BACKEND_FILE, default data/…flag) — the
 *      runtime, restart-free lever an operator edits.
 *   2. SITE_ANALYSIS_BACKEND env — the deploy-time default.
 *   3. "legacy" — the safe default (in-process engine, unchanged behaviour).
 */
import { readFileSync } from "fs";
import path from "path";

export type SiteAnalysisBackend = "legacy" | "service";

const FLAG_FILE =
  process.env.SITE_ANALYSIS_BACKEND_FILE ??
  path.join(process.cwd(), "data", "site-analysis-backend.flag");
const POLL_TTL_MS = 1_000;

let cache: { value: SiteAnalysisBackend; at: number } | null = null;

function readBackend(): SiteAnalysisBackend {
  let raw: string | undefined;
  try {
    raw = readFileSync(FLAG_FILE, "utf8").trim();
  } catch {
    raw = undefined; // missing flag file → fall through to env/default
  }
  const candidate = raw && raw.length > 0 ? raw : process.env.SITE_ANALYSIS_BACKEND;
  return candidate === "service" ? "service" : "legacy";
}

/** Current backend, cached for POLL_TTL_MS. `now` is injectable for tests. */
export function getSiteAnalysisBackend(now: number = Date.now()): SiteAnalysisBackend {
  if (cache !== null && now - cache.at < POLL_TTL_MS) return cache.value;
  const value = readBackend();
  cache = { value, at: now };
  return value;
}

/** Shadow mode: serve legacy, async-diff the service in the background
 *  (RUNBOOK_v3 §5). Independent of the backend selector. */
export function isShadowEnabled(): boolean {
  return process.env.SITE_ANALYSIS_SHADOW === "1";
}

/** Test-only: drop the poll cache. */
export function resetBackendFlagCache(): void {
  cache = null;
}
