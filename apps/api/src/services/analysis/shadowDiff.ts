/**
 * Shadow comparison (RUNBOOK_v3 §5): serve the legacy result, then async-diff
 * the FastAPI service against it and log divergences. A functional divergence is
 * a port bug to investigate; this NEVER affects the response the user receives.
 *
 * The comparator mirrors MIGRATION/parity/run.py §4.2: structural deep-equality
 * with conditional numeric tolerance (score.value carries ±0.5 documented
 * rounding slack; other floats compare within abs/rel 1e-6).
 */
import { analyzeViaService } from "./serviceClient";
import type { AnalysisResponse, GeoJsonPolygon } from "./types";

export interface Divergence {
  path: string;
  legacy: unknown;
  service: unknown;
}

const ABS_TOL = 1e-6;
const REL_TOL = 1e-6;
const SCORE_VALUE_SLACK = 0.5;

function numbersMatch(path: string, a: number, b: number): boolean {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const delta = Math.abs(a - b);
  if (path.endsWith("score.value")) return delta <= SCORE_VALUE_SLACK;
  return delta <= Math.max(ABS_TOL, REL_TOL * Math.abs(a));
}

/** Deep structural diff of two response payloads. `legacy` is the reference. */
export function diffResponses(legacy: unknown, service: unknown, path = ""): Divergence[] {
  const out: Divergence[] = [];
  walk(path, legacy, service, out);
  return out;
}

function walk(path: string, a: unknown, b: unknown, out: Divergence[]): void {
  if (typeof a === "number" && typeof b === "number") {
    if (!numbersMatch(path, a, b)) out.push({ path, legacy: a, service: b });
    return;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) {
      out.push({ path: `${path} (len)`, legacy: lenOf(a), service: lenOf(b) });
      return;
    }
    for (let i = 0; i < a.length; i++) walk(`${path}[${i}]`, a[i], b[i], out);
    return;
  }
  if (a !== null && typeof a === "object") {
    if (b === null || typeof b !== "object" || Array.isArray(b)) {
      out.push({ path, legacy: a, service: b });
      return;
    }
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    for (const k of Object.keys(ao)) {
      walk(path === "" ? k : `${path}.${k}`, ao[k], k in bo ? bo[k] : "<MISSING>", out);
    }
    for (const k of Object.keys(bo)) {
      if (!(k in ao)) out.push({ path: path === "" ? k : `${path}.${k}`, legacy: "<ABSENT>", service: bo[k] });
    }
    return;
  }
  if (a !== b) out.push({ path, legacy: a, service: b });
}

function lenOf(v: unknown): unknown {
  return Array.isArray(v) ? v.length : `<${typeof v}>`;
}

/**
 * Fire-and-forget: compare the service against an already-computed legacy
 * result and log the outcome. Swallows every error — a shadow failure must
 * never touch the live response.
 */
export async function runShadowComparison(
  geometry: GeoJsonPolygon,
  legacyResult: AnalysisResponse,
  fetchImpl: typeof fetch = fetch,
): Promise<Divergence[]> {
  try {
    const serviceResult = await analyzeViaService(geometry, fetchImpl);
    const divergences = diffResponses(legacyResult, serviceResult);
    if (divergences.length > 0) {
      console.warn(
        `[analysis-shadow] ${divergences.length} divergence(s) legacy↔service`,
        divergences.slice(0, 20),
      );
    } else {
      console.log("[analysis-shadow] parity OK (legacy == service)");
    }
    return divergences;
  } catch (err) {
    console.warn("[analysis-shadow] comparison skipped (service error)", err);
    return [];
  }
}
