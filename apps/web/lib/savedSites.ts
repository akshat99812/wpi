// Saved-sites API client (Pro). Mirrors the /api/saved-sites contract in
// apps/api/src/routes/savedSites.ts. Cookie-auth like every other Pro endpoint
// (credentials: "include"); never a bearer token.

import type { AnalysisResponse, Confidence, ScoreRating } from "@/lib/analysis/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

/** Compact, comparison-only snapshot stored with each saved site. */
export interface SavedSiteSummary {
  scoreValue: number;
  scoreRating: ScoreRating;
  cuf: number | null;
  confidence: Confidence;
  meanSpeedMs: number | null;
  cfIec3: number | null;
  powerDensity: number | null;
  siteClass: string | null;
  capacityMw: number | null;
  energyGwh: number | null;
  equityIrr: number | null;
  lcoe: number | null;
  payback: number | null;
  redExclusionFraction: number | null;
  amberExclusionFraction: number | null;
  farmOverlapFraction: number | null;
  ehvWithin25Km: boolean | null;
  nearestSubstationKm: number | null;
  state: string | null;
}

/** What the client POSTs to save a site. */
export interface SavedSitePayload {
  name: string;
  ring: [number, number][];
  centroid: [number, number];
  areaKm2: number;
  isPointMode: boolean;
  summary: SavedSiteSummary;
}

/** A saved site as returned by the API. */
export interface SavedSite {
  id: string;
  name: string;
  createdAt: string;
  ring: [number, number][];
  centroid: [number, number] | null;
  areaKm2: number | null;
  isPointMode: boolean;
  summary: SavedSiteSummary | null;
}

/** Thrown when the per-user 3-site cap is hit (HTTP 409) so the UI can react. */
export class SavedSiteLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavedSiteLimitError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
    };
    const message = body?.error || `${res.status} ${res.statusText}`;
    if (res.status === 409 || body?.code === "SAVED_SITE_LIMIT") {
      throw new SavedSiteLimitError(message);
    }
    throw new Error(message);
  }
  // 204 No Content (delete) has no body.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function fetchSavedSites(): Promise<{ sites: SavedSite[]; max: number }> {
  return request("/api/saved-sites");
}

export function createSavedSite(
  payload: SavedSitePayload,
): Promise<{ site: SavedSite }> {
  return request("/api/saved-sites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function renameSavedSite(
  id: string,
  name: string,
): Promise<{ site: SavedSite }> {
  return request(`/api/saved-sites/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function deleteSavedSite(id: string): Promise<void> {
  return request(`/api/saved-sites/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** Build the save payload from a completed analysis + its AOI ring. Pulls the
 *  comparison metrics out of the (possibly partial) section data. */
export function buildSavedSitePayload(
  name: string,
  ring: [number, number][],
  analysis: AnalysisResponse,
): SavedSitePayload {
  const r =
    analysis.sections.resource.status === "ok"
      ? analysis.sections.resource.data
      : null;
  const c =
    analysis.sections.context.status === "ok"
      ? analysis.sections.context.data
      : null;
  const g =
    analysis.sections.grid.status === "ok" ? analysis.sections.grid.data : null;
  const f = analysis.financials;
  return {
    name,
    ring,
    centroid: analysis.aoi.centroid,
    areaKm2: analysis.aoi.areaKm2,
    isPointMode: analysis.aoi.isPointMode,
    summary: {
      scoreValue: analysis.score.value,
      scoreRating: analysis.score.rating,
      cuf: analysis.score.cuf,
      confidence: analysis.score.confidence,
      meanSpeedMs: r?.meanSpeed ?? null,
      cfIec3: r?.cfIec3 ?? null,
      powerDensity: r?.powerDensity ?? null,
      siteClass: r?.siteClass ?? null,
      capacityMw: c?.sizing.capacityMw ?? null,
      energyGwh: c?.sizing.energyGwh ?? null,
      equityIrr: f?.irr ?? null,
      lcoe: f?.lcoe ?? null,
      payback: f?.payback ?? null,
      redExclusionFraction: c?.exclusions?.redFraction ?? null,
      amberExclusionFraction: c?.exclusions?.amberFraction ?? null,
      farmOverlapFraction: c?.windfarms.overlapFraction ?? null,
      ehvWithin25Km: g?.ehvWithin25Km ?? null,
      nearestSubstationKm: g?.nearestSubstation?.distanceKm ?? null,
      state: c?.states?.[0]?.name ?? null,
    },
  };
}
