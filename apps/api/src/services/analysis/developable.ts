/**
 * developable.ts — CF-engine Phase A: the real *developable* area of an AOI.
 *
 * The legacy sizing used a flat 0.7 "usable land" fudge (context.computeSizing).
 * This module replaces the land-use part of that fudge with the actual legal
 * exclusion footprint we already ship in PostGIS (`wce.excl_polygon` +
 * `wce.excl_buffer`, class='red' = hard legal exclusion — the same red the Pro
 * map paints), plus a steep-slope mask derived from the elevation patch the
 * resource section already fetched.
 *
 *   developableFraction = (1 − redExclusionFraction) · (1 − steepFraction) · PACKING
 *
 * Everything here degrades safely: DB down → excludedFraction null (treated as
 * 0, i.e. "no exclusions removed", and surfaced as null so the UI can say
 * "exclusions unavailable"); no slope → steepFraction null (treated as 0).
 * Reuses the same parameterized-GeoJSON PostGIS pattern as validation.ts.
 */

import { pool, dbAvailable } from "../../lib/db";
import { DEVELOPABLE_PACKING_FACTOR } from "./constants";
import type { ValidatedAoi } from "./types";

export interface ExclusionCoverage {
  /** Hard (red) exclusion area inside the AOI, in km². */
  excludedKm2: number;
  /** Excluded area ÷ AOI area, clamped to 0..1. */
  excludedFraction: number;
}

/** Injectable so context tests never touch the DB. */
export type LoadExclusionCoverage = (
  aoi: ValidatedAoi,
) => Promise<ExclusionCoverage | null>;

const KM2_PER_M2 = 1e-6;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * Area fraction of the AOI covered by hard (red) legal exclusions. Unions the
 * intersecting red polygons + buffers, intersects with the AOI, and measures on
 * the geography spheroid (true m²). Returns null when the DB is unavailable or
 * the query fails — the caller treats null as "exclusions not subtracted".
 */
export async function queryExclusionCoverageDefault(
  aoi: ValidatedAoi,
): Promise<ExclusionCoverage | null> {
  if (!dbAvailable()) return null;
  const aoiGeoJson = JSON.stringify({ type: "Polygon", coordinates: [aoi.ring] });
  // ST_MakeValid guards against self-touching source polygons; the GIST `&&`
  // prefilter keeps the ST_Union input to only the features that actually
  // overlap the (≤2,500 km²) AOI.
  const sql = `
    WITH aoi AS (
      SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) AS g
    ),
    hard AS (
      SELECT ST_MakeValid(e.geom) AS geom
        FROM wce.excl_polygon e, aoi
       WHERE e.class = 'red' AND e.geom && aoi.g AND ST_Intersects(e.geom, aoi.g)
      UNION ALL
      SELECT ST_MakeValid(b.geom) AS geom
        FROM wce.excl_buffer b, aoi
       WHERE b.class = 'red' AND b.geom && aoi.g AND ST_Intersects(b.geom, aoi.g)
    )
    SELECT
      (SELECT ST_Area(g::geography) FROM aoi) AS aoi_m2,
      COALESCE(
        ST_Area(
          ST_Intersection(ST_Union(hard.geom), (SELECT g FROM aoi))::geography
        ),
        0
      ) AS excluded_m2
    FROM hard
  `;
  try {
    const { rows } = await pool.query<{
      aoi_m2: string | number | null;
      excluded_m2: string | number | null;
    }>(sql, [aoiGeoJson]);
    const row = rows[0];
    if (!row) return { excludedKm2: 0, excludedFraction: 0 };
    const aoiM2 = toFinite(row.aoi_m2);
    const excludedM2 = toFinite(row.excluded_m2) ?? 0;
    if (aoiM2 === null || aoiM2 <= 0) return { excludedKm2: 0, excludedFraction: 0 };
    return {
      excludedKm2: Math.round(excludedM2 * KM2_PER_M2 * 100) / 100,
      excludedFraction: clamp01(excludedM2 / aoiM2),
    };
  } catch (err) {
    console.warn(
      "[developable] exclusion-coverage query failed; treating as 0:",
      (err as Error).message,
    );
    return null;
  }
}

/**
 * Combine exclusion + slope into the applied developable fraction. Null inputs
 * (DB down / no slope) are treated as 0 removed — never as a hard failure.
 */
export function developableFraction(
  excludedFraction: number | null,
  steepFraction: number | null,
): number {
  const excl = clamp01(excludedFraction ?? 0);
  const steep = clamp01(steepFraction ?? 0);
  return clamp01((1 - excl) * (1 - steep) * DEVELOPABLE_PACKING_FACTOR);
}

function toFinite(v: string | number | null): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
