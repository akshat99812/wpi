/**
 * turbinesInAoi.ts — count the INDIVIDUAL physical wind turbines that sit
 * inside an AOI (the `wind_turbines` PostGIS table — OSM/OpenInfraMap turbine
 * points, distinct from the `windmills` met-mast table).
 *
 * Surfaced in Section E (site context) so the analysis can say "N turbines
 * already stand here (~X MW where rated capacity is tagged)". Rated MW is a
 * best-effort sum over the subset that carries `rated_power_kw` — many OSM
 * turbines are untagged, so it is reported as a floor, never as truth.
 *
 * Degrades like the rest of context: DB down or query failure → null, and the
 * UI simply omits the turbine line. Mirrors developable.ts's parameterized-
 * GeoJSON + GIST-prefilter pattern.
 */

import { pool, dbAvailable } from "../../lib/db";
import type { ValidatedAoi } from "./types";

export interface TurbineInventory {
  /** Physical turbines whose point falls inside the AOI. */
  count: number;
  /** Σ rated_power_kw / 1000 over the tagged subset (MW); null when none of the
   *  in-AOI turbines carry a rated power. A floor, not the true installed MW. */
  ratedMw: number | null;
  /** How many of `count` carried a rated_power_kw (so the UI can caveat). */
  ratedCount: number;
}

/** Injectable so context tests never touch the DB. */
export type LoadTurbineInventory = (
  aoi: ValidatedAoi,
) => Promise<TurbineInventory | null>;

export async function queryTurbinesInAoiDefault(
  aoi: ValidatedAoi,
): Promise<TurbineInventory | null> {
  if (!dbAvailable()) return null;
  const aoiGeoJson = JSON.stringify({ type: "Polygon", coordinates: [aoi.ring] });
  // && uses the GIST index to shortlist tiles; ST_Contains is the exact
  // point-in-polygon. SUM/COUNT over the (small) shortlist is cheap.
  // ST_MakeValid mirrors developable.ts so a self-intersecting (but validated)
  // ring still returns a count instead of tripping a GEOS TopologyException.
  // rated_n uses the SAME `> 0` predicate as the SUM, so the "N of M tagged"
  // caveat can never disagree with the summed floor MW (a 0/negative rating
  // would otherwise be counted but not summed).
  const sql = `
    WITH aoi AS (
      SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) AS g
    )
    SELECT
      count(*)::int                                              AS n,
      count(*) FILTER (WHERE t.rated_power_kw > 0)::int          AS rated_n,
      COALESCE(SUM(t.rated_power_kw) FILTER (WHERE t.rated_power_kw > 0), 0) AS kw
      FROM wind_turbines t, aoi
     WHERE t.geom && aoi.g AND ST_Contains(aoi.g, t.geom)
  `;
  try {
    const { rows } = await pool.query<{
      n: number | string | null;
      rated_n: number | string | null;
      kw: number | string | null;
    }>(sql, [aoiGeoJson]);
    const row = rows[0];
    if (!row) return { count: 0, ratedMw: null, ratedCount: 0 };
    const count = toInt(row.n);
    const ratedCount = toInt(row.rated_n);
    const kw = toFinite(row.kw) ?? 0;
    return {
      count,
      ratedCount,
      ratedMw: ratedCount > 0 && kw > 0 ? Math.round((kw / 1000) * 10) / 10 : null,
    };
  } catch (err) {
    console.warn(
      "[turbines] in-AOI turbine count query failed; omitting:",
      (err as Error).message,
    );
    return null;
  }
}

function toInt(v: number | string | null): number {
  const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function toFinite(v: number | string | null): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
