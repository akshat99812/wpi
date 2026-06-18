/**
 * Thin HTTP client for the internal FastAPI site-analysis service (RUNBOOK_v3
 * §5). Express stays the public, auth'd front door; this proxies an already-
 * authorized, already-validated request to the internal service and returns its
 * response verbatim. The service is internal-only (no auth of its own).
 *
 * fetchImpl is injectable so tests can run without a live service.
 */
import type { AnalysisResponse, GeoJsonPolygon } from "./types";

const SERVICE_URL = process.env.SITE_ANALYSIS_SERVICE_URL ?? "http://127.0.0.1:8000";
const TIMEOUT_MS = Number(process.env.SITE_ANALYSIS_SERVICE_TIMEOUT_MS ?? 20_000);

export class ServiceUnavailableError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = "ServiceUnavailableError";
  }
}

/**
 * POST { geometry } to the service's /analyze and return the parsed
 * AnalysisResponse. Throws ServiceUnavailableError on transport failure,
 * timeout, or a non-2xx status — the caller decides whether to fall back to the
 * in-process engine (cutover) or just log (shadow).
 */
export async function analyzeViaService(
  geometry: GeoJsonPolygon,
  fetchImpl: typeof fetch = fetch,
): Promise<AnalysisResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${SERVICE_URL}/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ geometry }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new ServiceUnavailableError(`site-analysis service returned ${res.status}`);
    }
    return (await res.json()) as AnalysisResponse;
  } catch (err) {
    if (err instanceof ServiceUnavailableError) throw err;
    throw new ServiceUnavailableError("site-analysis service request failed", err);
  } finally {
    clearTimeout(timer);
  }
}
