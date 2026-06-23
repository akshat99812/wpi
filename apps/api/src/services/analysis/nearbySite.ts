/**
 * Nearby better-site search (plan §1.3) — "is there a strictly better site
 * within N km at the same scale?" for the report's comparison figure.
 *
 * Bounded + batched, never N queries in a loop:
 *  - a hard-capped concentric-ring candidate set (≤ MAX_CANDIDATES),
 *  - power features fetched ONCE over the candidates' bbox (fetchPowerFeatures),
 *    then summarized per candidate (summarizeGridFeatures) — no per-candidate
 *    grid fetch,
 *  - ws sampled per candidate through the shared GWA tile cache (fetchPointValue),
 *  - scored with the SAME screenWind the headline uses, ranked, strictly-better
 *    kept,
 *  - wrapped in a hard timeout that degrades to {found:false} rather than failing
 *    the whole export.
 *
 * I/O is behind an injectable `CandidateSamplers` seam so the ranking core is
 * unit-testable with stubs (found + none paths) without any network.
 */

import { GWA_LAYERS } from "./constants";
import { fetchPowerFeatures, summarizeGridFeatures } from "./grid";
import { screenWind } from "./screenWind";
import { fetchPointValue, type TileFetchOptions } from "./tiles";

const KM_PER_DEG = 111.195; // EARTH_RADIUS_KM · π/180
const MAX_CANDIDATES = 24;
const DEFAULT_RADIUS_KM = 10;
const DEFAULT_RINGS = 3;
const DEFAULT_PER_RING = 8; // 3 × 8 = 24 = MAX_CANDIDATES
const DEFAULT_TIMEOUT_MS = 8_000;
/** A candidate must beat the selected composite score by this margin to count. */
const SCORE_EPSILON = 0.5;

export interface SelectedSite {
  ws: number;
  score: number; // 0–100 composite index (same scale as AnalysisScore.value)
  cuf: number | null;
  lineKm: number | null;
  subKm: number | null;
  equityIrr: number | null;
  npvCr: number | null;
  paybackYr: number | null;
}

export interface NearbyCandidate {
  lat: number;
  lon: number;
  distanceKm: number;
  ws: number;
  cuf: number | null;
  score: number;
  lineKm: number | null;
  subKm: number | null;
  equityIrr: number | null;
  npvCr: number | null;
  paybackYr: number | null;
}

type DeltaKey =
  | "ws"
  | "cuf"
  | "score"
  | "lineKm"
  | "subKm"
  | "equityIrr"
  | "npvCr"
  | "paybackYr";

export interface NearbySiteResult {
  found: boolean;
  candidate?: NearbyCandidate;
  deltas?: Partial<Record<DeltaKey, number>>;
  reason?: string;
}

/** Injectable I/O seam — real impl in buildRealSamplers; stubbed in tests. */
export interface CandidateSamplers {
  /** ws@100m at [lon,lat], or null when nodata / outside coverage. */
  sampleWs(lon: number, lat: number): Promise<number | null>;
  /** nearest line/substation km at [lon,lat]. */
  sampleGrid(
    lon: number,
    lat: number,
  ): Promise<{ lineKm: number | null; subKm: number | null }>;
}

/** Concentric-ring candidate points around `centroid` (pure, deterministic). */
export function candidatePoints(
  centroid: readonly [number, number],
  radiusKm: number,
  rings: number,
  perRing: number,
): { lon: number; lat: number; distanceKm: number }[] {
  const [lon0, lat0] = centroid;
  const cosLat = Math.cos((lat0 * Math.PI) / 180) || 1e-6;
  const pts: { lon: number; lat: number; distanceKm: number }[] = [];
  for (let r = 1; r <= rings; r++) {
    const distanceKm = (radiusKm * r) / rings;
    for (let j = 0; j < perRing; j++) {
      const angle = (2 * Math.PI * j) / perRing;
      const eastKm = distanceKm * Math.cos(angle);
      const northKm = distanceKm * Math.sin(angle);
      pts.push({
        lon: lon0 + eastKm / (KM_PER_DEG * cosLat),
        lat: lat0 + northKm / KM_PER_DEG,
        distanceKm,
      });
    }
  }
  return pts;
}

/** AOI-free bbox covering all candidates (centroid ± radius), for the one grid fetch. */
function candidatesBbox(
  centroid: readonly [number, number],
  radiusKm: number,
): [number, number, number, number] {
  const [lon, lat] = centroid;
  const cosLat = Math.cos((lat * Math.PI) / 180) || 1e-6;
  const dLat = radiusKm / KM_PER_DEG;
  const dLon = radiusKm / (KM_PER_DEG * cosLat);
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

/** Real samplers: one power-feature fetch + cached-tile ws point reads. */
export async function buildRealSamplers(
  bbox: readonly [number, number, number, number],
  options: TileFetchOptions = {},
): Promise<CandidateSamplers> {
  const { lines, substations } = await fetchPowerFeatures(bbox, options);
  return {
    sampleWs: (lon, lat) => fetchPointValue(GWA_LAYERS.ws100, lon, lat, options),
    sampleGrid: async (lon, lat) => {
      const g = summarizeGridFeatures([lon, lat], lines, substations);
      return {
        lineKm: g.nearestLine?.distanceKm ?? null,
        subKm: g.nearestSubstation?.distanceKm ?? null,
      };
    },
  };
}

async function screenCandidate(
  pt: { lon: number; lat: number; distanceKm: number },
  samplers: CandidateSamplers,
): Promise<NearbyCandidate | null> {
  const ws = await samplers.sampleWs(pt.lon, pt.lat);
  if (ws === null || !Number.isFinite(ws)) return null;
  const { lineKm, subKm } = await samplers.sampleGrid(pt.lon, pt.lat);
  const s = screenWind(ws, lineKm, subKm);
  if (!s.score) return null;
  return {
    lat: pt.lat,
    lon: pt.lon,
    distanceKm: pt.distanceKm,
    ws,
    cuf: s.score.cuf,
    score: s.score.score,
    lineKm,
    subKm,
    equityIrr: s.financials?.irr ?? null,
    npvCr: s.financials?.npvCr ?? null,
    paybackYr: s.financials?.payback ?? null,
  };
}

/** Strictly-better = composite score beats selected by > SCORE_EPSILON. */
function pickBest(
  cands: readonly NearbyCandidate[],
  selected: SelectedSite,
): NearbyCandidate | null {
  const better = cands.filter((c) => c.score > selected.score + SCORE_EPSILON);
  if (better.length === 0) return null;
  return [...better].sort(
    (a, b) =>
      b.score - a.score ||
      (b.equityIrr ?? -Infinity) - (a.equityIrr ?? -Infinity),
  )[0]!;
}

function computeDeltas(
  c: NearbyCandidate,
  sel: SelectedSite,
): Partial<Record<DeltaKey, number>> {
  const out: Partial<Record<DeltaKey, number>> = {};
  const set = (k: DeltaKey, a: number | null, b: number | null) => {
    if (a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b)) {
      out[k] = a - b;
    }
  };
  set("ws", c.ws, sel.ws);
  set("cuf", c.cuf, sel.cuf);
  set("score", c.score, sel.score);
  set("lineKm", c.lineKm, sel.lineKm);
  set("subKm", c.subKm, sel.subKm);
  set("equityIrr", c.equityIrr, sel.equityIrr);
  set("npvCr", c.npvCr, sel.npvCr);
  set("paybackYr", c.paybackYr, sel.paybackYr);
  return out;
}

export interface FindNearbyArgs {
  centroid: readonly [number, number];
  areaKm2: number;
  selected: SelectedSite;
  radiusKm?: number;
  options?: TileFetchOptions;
  /** Inject for tests; defaults to the real GWA/power samplers. */
  samplers?: CandidateSamplers;
  timeoutMs?: number;
}

/**
 * Find the best strictly-better candidate site near the AOI, or {found:false}.
 * Never throws: any failure (timeout, fetch error) degrades to found:false so it
 * cannot break the PDF export.
 */
export async function findNearbyBetterSite(
  args: FindNearbyArgs,
): Promise<NearbySiteResult> {
  const radiusKm = args.radiusKm ?? DEFAULT_RADIUS_KM;
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pts = candidatePoints(
    args.centroid,
    radiusKm,
    DEFAULT_RINGS,
    DEFAULT_PER_RING,
  ).slice(0, MAX_CANDIDATES);

  const search = (async (): Promise<NearbySiteResult> => {
    const samplers =
      args.samplers ??
      (await buildRealSamplers(
        candidatesBbox(args.centroid, radiusKm),
        args.options,
      ));
    const screened = await Promise.all(
      pts.map((p) => screenCandidate(p, samplers).catch(() => null)),
    );
    const cands = screened.filter((c): c is NearbyCandidate => c !== null);
    const best = pickBest(cands, args.selected);
    if (!best) {
      return {
        found: false,
        reason: `no higher-scoring site within ${radiusKm} km`,
      };
    }
    return { found: true, candidate: best, deltas: computeDeltas(best, args.selected) };
  })().catch(
    (): NearbySiteResult => ({ found: false, reason: "nearby-site search failed" }),
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<NearbySiteResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ found: false, reason: "nearby-site search timed out" }),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([search, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
