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

/** One exclusion category's footprint inside the AOI, keyed by the raw
 *  `layer_code` (the UI maps it to a human label). `cls` is the legal class:
 *  'red' = hard exclusion, 'amber' = verify-before-use. */
export interface ExclusionCategory {
  layerCode: string;
  cls: "red" | "amber";
  /** This category ∩ AOI, in km². */
  km2: number;
  /** This category ∩ AOI ÷ AOI area, clamped to 0..1. */
  fraction: number;
}

export interface ExclusionCoverage {
  /** Hard (red) exclusion area inside the AOI, in km² (deduped union). */
  excludedKm2: number;
  /** Red excluded area ÷ AOI area, clamped to 0..1. Drives sizing. */
  excludedFraction: number;
  /** Amber (verify) exclusion area inside the AOI, in km² (deduped union).
   *  Optional so legacy/injected coverage objects stay valid; the display
   *  degrades to 0 when absent. */
  amberKm2?: number;
  /** Amber excluded area ÷ AOI area, clamped to 0..1. */
  amberFraction?: number;
  /** Per-`layer_code` breakdown ("for what"), each ∩ AOI, sorted by area desc.
   *  Categories may overlap, so their fractions can sum to MORE than the
   *  deduped red/amber totals — they answer "what kinds", not a partition. */
  categories?: ExclusionCategory[];
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
  // prefilter keeps the union input to only the features that actually overlap
  // the (≤2,500 km²) AOI. CLIP FIRST: each intersecting feature is clipped to
  // the AOI (ST_Intersection) before the dissolve, so ST_Union dissolves small
  // in-AOI fragments instead of full-size source polygons that sprawl far
  // outside the AOI — a ~3× speedup on dense AOIs (5.5 s → ~2 s), which keeps
  // the query inside the context section's remaining wall-clock budget so the
  // exclusion % stops degrading to "unavailable" on large/dense sites.
  // ST_CollectionExtract(…, 3) keeps only polygonal parts of the clip (boundary
  // touches can yield line/point slivers that ST_Union would choke on, and
  // which carry no area anyway). area(∪ clip(fᵢ, A)) == area((∪ fᵢ) ∩ A), so
  // the red/amber totals are identical to the legacy query — just faster.
  // `nz` drops empty clips; per_class keeps the deduped class totals (the red
  // number that drives sizing), while per_cat answers "for what".
  const sql = `
    WITH aoi AS (
      SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) AS g
    ),
    feat AS (
      SELECT e.layer_code AS layer_code, e.class AS cls,
             ST_CollectionExtract(ST_Intersection(ST_MakeValid(e.geom), aoi.g), 3) AS clipped
        FROM wce.excl_polygon e, aoi
       WHERE e.geom && aoi.g AND ST_Intersects(e.geom, aoi.g)
      UNION ALL
      SELECT b.layer_code, b.class,
             ST_CollectionExtract(ST_Intersection(ST_MakeValid(b.geom), aoi.g), 3)
        FROM wce.excl_buffer b, aoi
       WHERE b.geom && aoi.g AND ST_Intersects(b.geom, aoi.g)
    ),
    nz AS (
      SELECT layer_code, cls, clipped
        FROM feat
       WHERE clipped IS NOT NULL AND NOT ST_IsEmpty(clipped)
    ),
    per_cat AS (
      SELECT layer_code, cls,
             ST_Area(ST_Union(clipped)::geography) AS m2
        FROM nz
       GROUP BY layer_code, cls
    ),
    per_class AS (
      SELECT cls,
             ST_Area(ST_Union(clipped)::geography) AS m2
        FROM nz
       GROUP BY cls
    )
    SELECT
      (SELECT ST_Area(g::geography) FROM aoi)                       AS aoi_m2,
      COALESCE((SELECT m2 FROM per_class WHERE cls = 'red'),   0)   AS red_m2,
      COALESCE((SELECT m2 FROM per_class WHERE cls = 'amber'), 0)   AS amber_m2,
      COALESCE(
        (SELECT json_agg(
                  json_build_object('layer_code', layer_code, 'cls', cls, 'm2', m2)
                  ORDER BY m2 DESC
                )
           FROM per_cat WHERE m2 > 0),
        '[]'::json
      ) AS cats
  `;
  try {
    const { rows } = await pool.query<{
      aoi_m2: string | number | null;
      red_m2: string | number | null;
      amber_m2: string | number | null;
      cats: Array<{ layer_code: string; cls: string; m2: string | number | null }> | string | null;
    }>(sql, [aoiGeoJson]);
    const row = rows[0];
    if (!row) return { excludedKm2: 0, excludedFraction: 0 };
    const aoiM2 = toFinite(row.aoi_m2);
    if (aoiM2 === null || aoiM2 <= 0) return { excludedKm2: 0, excludedFraction: 0 };

    const redM2 = toFinite(row.red_m2) ?? 0;
    const amberM2 = toFinite(row.amber_m2) ?? 0;
    const categories = shapeCategories(row.cats, aoiM2);

    return {
      excludedKm2: Math.round(redM2 * KM2_PER_M2 * 100) / 100,
      excludedFraction: clamp01(redM2 / aoiM2),
      amberKm2: Math.round(amberM2 * KM2_PER_M2 * 100) / 100,
      amberFraction: clamp01(amberM2 / aoiM2),
      categories,
    };
  } catch (err) {
    console.warn(
      "[developable] exclusion-coverage query failed; treating as 0:",
      (err as Error).message,
    );
    return null;
  }
}

/** Normalize the json_agg'd per-category rows (pg may hand back a parsed array
 *  or a json string depending on driver) into typed ExclusionCategory[]. Only
 *  rows with a finite positive area and a valid class survive. */
function shapeCategories(
  raw: Array<{ layer_code: string; cls: string; m2: string | number | null }> | string | null,
  aoiM2: number,
): ExclusionCategory[] {
  if (raw == null) return [];
  let arr: Array<{ layer_code: string; cls: string; m2: string | number | null }>;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  } else {
    arr = raw;
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((r) => {
      const m2 = toFinite(r.m2) ?? 0;
      const cls = r.cls === "red" || r.cls === "amber" ? r.cls : null;
      if (cls === null || m2 <= 0 || typeof r.layer_code !== "string") return null;
      return {
        layerCode: r.layer_code,
        cls,
        km2: Math.round(m2 * KM2_PER_M2 * 100) / 100,
        fraction: clamp01(m2 / aoiM2),
      } satisfies ExclusionCategory;
    })
    .filter((c): c is ExclusionCategory => c !== null);
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
