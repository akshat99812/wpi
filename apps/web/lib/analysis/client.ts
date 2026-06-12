import type { AnalysisErrorBody, AnalysisResponse } from "./types";

/**
 * POST /api/analyze client. Pro-gated on the server; the session cookie rides
 * on credentials: "include" like every other API fetch on the Pro map.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3005";

export class AnalyzeRequestError extends Error {
  constructor(
    message: string,
    /** Machine-readable code from the 400 body, when the server sent one. */
    public readonly code: string | null,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AnalyzeRequestError";
  }
}

/** User-facing messages for the known auth/rate states. */
function messageForStatus(status: number): string {
  if (status === 401 || status === 403) {
    return "Your Pro session ended — please sign in again.";
  }
  if (status === 429) return "Slow down a bit — too many analyses.";
  return `Analysis failed (${status})`;
}

export async function postAnalyze(
  ring: [number, number][],
  signal: AbortSignal,
): Promise<AnalysisResponse> {
  const res = await fetch(`${API_URL}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    signal,
    body: JSON.stringify({
      geometry: { type: "Polygon", coordinates: [ring] },
    }),
  });

  if (!res.ok) {
    let body: AnalysisErrorBody | null = null;
    try {
      body = (await res.json()) as AnalysisErrorBody;
    } catch {
      // Non-JSON error body (proxy page, etc.) — fall through to status text.
    }
    throw new AnalyzeRequestError(
      body?.error || messageForStatus(res.status),
      body?.code ?? null,
      res.status,
    );
  }

  return (await res.json()) as AnalysisResponse;
}
