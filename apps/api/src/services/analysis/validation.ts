/**
 * Section C — mast validation against WRA met masts (plan §2.3, Phase 2).
 *
 * Delta methodology (EXACT per plan §2.3; hard rules in plan §6):
 *   - The GWA model speed is sampled AT THE MAST'S OWN COORDINATES
 *     (ws_mean_hgt100m, one pixel through the shared disk cache in tiles.ts).
 *     NEVER compared against the AOI-average GWA speed.
 *   - The 100 m value is shear-adjusted to the mast's measurement height
 *     with the AOI's α:  v_mastH = v100 · (mastH / 100)^α.
 *   - modelDeltaPct = ((mast.maws_ms − v_mastH) / v_mastH) · 100, 1 dp.
 *     Sign convention: POSITIVE = measurement above model (model runs low);
 *     negative = model runs high. The UI renders the magnitude as
 *     "Model runs ±X% vs measurement near this site".
 *   - Delta is SUPPRESSED (null) when the nearest mast is farther than
 *     MAST_DELTA_MAX_KM (25 km). Suppression compares the UNROUNDED distance.
 *   - GWA pixel nodata/missing at the mast coords → delta null (warn logged).
 *
 * nearestMast vs delta suppression (documented decision):
 *   nearestMast is returned whenever a delta-eligible mast exists within
 *   MAST_NEAREST_SEARCH_KM (100 km) of the AOI centroid — the row is useful
 *   context beyond 25 km; only the DELTA is suppressed past 25 km. Beyond
 *   100 km nearestMast is null (a mast that far says nothing about the site).
 *
 * Candidate filtering (documented decision):
 *   Masts with NULL maws_ms or NULL/0 mast_height_m cannot produce a delta,
 *   so they are excluded from nearest-mast candidacy AND from the 20/25 km
 *   confidence counts (otherwise the badge could read "medium" while
 *   nearestMast is null — incoherent). They DO count in mastCountInAoi,
 *   which is the plain "how many masts sit inside the AOI" fact.
 *
 * Confidence badge (plan §2.3): high = ≥MAST_CONFIDENCE_HIGH_COUNT
 * delta-eligible masts within MAST_CONFIDENCE_HIGH_KM of the centroid ·
 * medium = ≥1 within MAST_DELTA_MAX_KM (25 km doubles as the medium radius
 * by design — same constant as delta suppression) · low = none within 25 km.
 */

import { dbAvailable, pool } from "../../lib/db";
import {
  GWA_LAYERS,
  MAST_CONFIDENCE_HIGH_COUNT,
  MAST_CONFIDENCE_HIGH_KM,
  MAST_DELTA_MAX_KM,
} from "./constants";
import { roundTo } from "./resource";
import { fetchPointValue, type TileFetchOptions } from "./tiles";
import type { ValidatedAoi, ValidationData } from "./types";

// ── Local constants ─────────────────────────────────────────────────────────

/** KNN sanity cap: nearestMast is null beyond this centroid distance. */
const MAST_NEAREST_SEARCH_KM = 100;
const METERS_PER_KM = 1_000;
/** Height of the GWA mean-speed layer the delta is shear-adjusted from. */
const SHEAR_REFERENCE_HEIGHT_M = 100;
const DISTANCE_DECIMALS = 1;
const DELTA_DECIMALS = 1;

/** Static SQL fragment (no user input): a mast that can produce a delta. */
const DELTA_ELIGIBLE_SQL =
  "w.maws_ms IS NOT NULL AND w.mast_height_m IS NOT NULL AND w.mast_height_m > 0";

// ── Pure helpers (exported for tests) ───────────────────────────────────────

/**
 * Power-law shear adjustment from the 100 m GWA reference height to the
 * mast's measurement height: v_mastH = v100 · (mastH / 100)^α.
 */
export function shearAdjustSpeed(
  v100: number,
  mastHeightM: number,
  alpha: number,
): number {
  if (!Number.isFinite(v100) || v100 < 0) {
    throw new Error(`shearAdjustSpeed: v100 must be a finite speed ≥ 0, got ${v100}`);
  }
  if (!Number.isFinite(mastHeightM) || mastHeightM <= 0) {
    throw new Error(
      `shearAdjustSpeed: mastHeightM must be a finite height > 0, got ${mastHeightM}`,
    );
  }
  if (!Number.isFinite(alpha)) {
    throw new Error(`shearAdjustSpeed: alpha must be finite, got ${alpha}`);
  }
  return v100 * (mastHeightM / SHEAR_REFERENCE_HEIGHT_M) ** alpha;
}

/**
 * ((measured − model) / model) · 100, rounded to 1 dp.
 * Positive = measurement above model (model runs low).
 */
export function deltaPct(measured: number, modelAtMastHeight: number): number {
  if (!Number.isFinite(measured)) {
    throw new Error(`deltaPct: measured must be finite, got ${measured}`);
  }
  if (!Number.isFinite(modelAtMastHeight) || modelAtMastHeight <= 0) {
    throw new Error(
      `deltaPct: model speed must be a finite value > 0, got ${modelAtMastHeight}`,
    );
  }
  const pct = ((measured - modelAtMastHeight) / modelAtMastHeight) * 100;
  return roundTo(pct, DELTA_DECIMALS);
}

/** Badge per plan §2.3 — counts are of delta-eligible masts near the centroid. */
export function confidenceFrom(
  countWithin20: number,
  countWithin25: number,
): ValidationData["confidence"] {
  for (const [label, count] of [
    ["countWithin20", countWithin20],
    ["countWithin25", countWithin25],
  ] as const) {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`confidenceFrom: ${label} must be a non-negative integer, got ${count}`);
    }
  }
  if (countWithin20 >= MAST_CONFIDENCE_HIGH_COUNT) return "high";
  if (countWithin25 >= 1) return "medium";
  return "low";
}

// ── Row coercion (pg returns NUMERIC/bigint columns as strings) ────────────

function toFiniteNumber(value: unknown, label: string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new Error(`validation: column ${label} is not a finite number (got ${String(value)})`);
  }
  return parsed;
}

function toCount(value: unknown, label: string): number {
  const parsed = toFiniteNumber(value, label);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`validation: count ${label} is not a non-negative integer (got ${parsed})`);
  }
  return parsed;
}

function toNullableFiniteNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  return toFiniteNumber(value, label);
}

// ── DB queries (parameterized only) ─────────────────────────────────────────

interface MastCounts {
  mastCountInAoi: number;
  within20: number;
  within25: number;
}

/** All three counts in one indexed-friendly pass over the (small) mast table. */
async function queryMastCounts(aoi: ValidatedAoi): Promise<MastCounts> {
  const aoiGeoJson = JSON.stringify({ type: "Polygon", coordinates: [aoi.ring] });
  const [lon, lat] = aoi.centroid;
  const sql = `
    WITH p AS (SELECT ST_SetSRID(ST_MakePoint($2, $3), 4326) AS pt)
    SELECT
      COUNT(*) FILTER (WHERE ST_Intersects(w.geom, ST_GeomFromGeoJSON($1)))  AS in_aoi,
      COUNT(*) FILTER (WHERE ${DELTA_ELIGIBLE_SQL}
        AND ST_DWithin(w.geom::geography, p.pt::geography, $4))              AS within20,
      COUNT(*) FILTER (WHERE ${DELTA_ELIGIBLE_SQL}
        AND ST_DWithin(w.geom::geography, p.pt::geography, $5))              AS within25
    FROM windmills w CROSS JOIN p
  `;
  let rows: Record<string, unknown>[];
  try {
    const result = await pool.query(sql, [
      aoiGeoJson,
      lon,
      lat,
      MAST_CONFIDENCE_HIGH_KM * METERS_PER_KM,
      MAST_DELTA_MAX_KM * METERS_PER_KM,
    ]);
    rows = result.rows;
  } catch (err) {
    throw new Error(`validation: mast counts query failed: ${(err as Error).message}`, {
      cause: err,
    });
  }
  const row = rows[0];
  if (!row) throw new Error("validation: mast counts query returned no row");
  return {
    mastCountInAoi: toCount(row.in_aoi, "in_aoi"),
    within20: toCount(row.within20, "within20"),
    within25: toCount(row.within25, "within25"),
  };
}

/** Nearest delta-eligible mast to the centroid; unrounded km distance. */
interface NearestMastCandidate {
  id: string;
  station: string;
  heightM: number;
  maws: number;
  mawpd: number | null;
  lon: number;
  lat: number;
  distanceKm: number;
}

async function queryNearestMast(
  lon: number,
  lat: number,
): Promise<NearestMastCandidate | null> {
  const sql = `
    WITH p AS (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326) AS pt)
    SELECT
      w.id::text                          AS id,
      w.station                           AS station,
      w.mast_height_m                     AS mast_height_m,
      w.maws_ms                           AS maws_ms,
      w.mawpd_wm2                         AS mawpd_wm2,
      ST_X(w.geom)                        AS lon,
      ST_Y(w.geom)                        AS lat,
      ST_DistanceSphere(w.geom, p.pt)     AS distance_m
    FROM windmills w CROSS JOIN p
    WHERE ${DELTA_ELIGIBLE_SQL}
      AND ST_DWithin(w.geom::geography, p.pt::geography, $3)
    ORDER BY w.geom <-> p.pt
    LIMIT 1
  `;
  let rows: Record<string, unknown>[];
  try {
    const result = await pool.query(sql, [lon, lat, MAST_NEAREST_SEARCH_KM * METERS_PER_KM]);
    rows = result.rows;
  } catch (err) {
    throw new Error(`validation: nearest mast query failed: ${(err as Error).message}`, {
      cause: err,
    });
  }
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    station: typeof row.station === "string" && row.station.length > 0 ? row.station : "Unknown",
    heightM: toFiniteNumber(row.mast_height_m, "mast_height_m"),
    maws: toFiniteNumber(row.maws_ms, "maws_ms"),
    mawpd: toNullableFiniteNumber(row.mawpd_wm2, "mawpd_wm2"),
    lon: toFiniteNumber(row.lon, "lon"),
    lat: toFiniteNumber(row.lat, "lat"),
    distanceKm: toFiniteNumber(row.distance_m, "distance_m") / METERS_PER_KM,
  };
}

// ── Delta computation ───────────────────────────────────────────────────────

/**
 * Sample GWA ws100 at the mast's own pixel and compute the delta. Returns
 * null (with a warn carrying full context — never silent) when the pixel is
 * nodata/missing or the tile fetch fails: the DB-derived facts in the rest
 * of the section stay useful even when GWA is briefly unreachable.
 */
async function computeModelDelta(
  mast: NearestMastCandidate,
  shearAlpha: number,
  options: TileFetchOptions,
): Promise<number | null> {
  let v100: number | null;
  try {
    v100 = await fetchPointValue(GWA_LAYERS.ws100, mast.lon, mast.lat, options);
  } catch (err) {
    console.warn("[validation] GWA fetch failed at mast coords; delta suppressed", {
      station: mast.station,
      lon: mast.lon,
      lat: mast.lat,
      err: (err as Error).message,
    });
    return null;
  }
  if (v100 === null || v100 <= 0) {
    console.warn("[validation] GWA ws100 pixel empty at mast coords; delta suppressed", {
      station: mast.station,
      lon: mast.lon,
      lat: mast.lat,
      v100,
    });
    return null;
  }
  const modelAtMastHeight = shearAdjustSpeed(v100, mast.heightM, shearAlpha);
  return deltaPct(mast.maws, modelAtMastHeight);
}

// ── Public entry point ──────────────────────────────────────────────────────

/**
 * Compute the validation section for an AOI. Throws when the masts DB is
 * unavailable or a query fails — the orchestrator maps rejections to
 * status "unavailable" (plan §3: a section failure never 500s the response).
 */
export async function computeValidation(
  aoi: ValidatedAoi,
  shearAlpha: number,
  options: TileFetchOptions = {},
): Promise<ValidationData> {
  if (!dbAvailable()) {
    throw new Error("validation: DATABASE_URL not set — masts DB unavailable");
  }
  if (!Number.isFinite(shearAlpha)) {
    throw new Error(`validation: shearAlpha must be finite, got ${shearAlpha}`);
  }

  const [lon, lat] = aoi.centroid;
  const [counts, nearest] = await Promise.all([
    queryMastCounts(aoi),
    queryNearestMast(lon, lat),
  ]);

  // Suppression compares the UNROUNDED distance against the 25 km rule.
  const isDeltaEligible = nearest !== null && nearest.distanceKm <= MAST_DELTA_MAX_KM;
  const modelDeltaPct =
    isDeltaEligible && nearest !== null
      ? await computeModelDelta(nearest, shearAlpha, options)
      : null;

  return {
    mastCountInAoi: counts.mastCountInAoi,
    nearestMast:
      nearest === null
        ? null
        : {
            station: nearest.station,
            distanceKm: roundTo(nearest.distanceKm, DISTANCE_DECIMALS),
            maws: nearest.maws,
            mawpd: nearest.mawpd,
            heightM: nearest.heightM,
            id: nearest.id,
          },
    modelDeltaPct,
    confidence: confidenceFrom(counts.within20, counts.within25),
  };
}
