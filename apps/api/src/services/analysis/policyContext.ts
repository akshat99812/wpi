/**
 * Policy context for the site report (plan §1.4) — AOI → state(s) → policy.
 *
 * REUSE, don't rebuild: the wind-policy-comparison feature already owns the
 * national + per-state policy dataset (wce.policy_dimension / wce.policy_value,
 * every cell sourced) and the rendering-ready query layer (services/policy).
 * This module only adds the spatial resolution — which seeded states the AOI
 * intersects — and delegates the policy values to `getCompare`. There is NO
 * duplicated policy data and no StaticPolicyProvider.
 *
 * Spatial query mirrors the canonical pattern in developable.ts: GIST `&&`
 * prefilter + ST_Intersects against ST_MakeValid(ST_SetSRID(GeomFromGeoJSON)).
 * Degrades to national-only when the AOI intersects no seeded state, and returns
 * null when the DB is offline (the report then renders policy as unavailable).
 */

import { dbAvailable, pool } from "../../lib/db";
import { getCompare, type CompareResult } from "../policy/query";
import type { GeoJsonPolygon } from "./types";

export interface PolicyContext {
  /** ISO date the dataset was last verified (max as_of_date over the cells), or null. */
  asOf: string | null;
  /** Seeded state codes the AOI intersects, e.g. ["TN"]; [] → national-only. */
  stateCodes: string[];
  /** National + per-state policy matrix, reusing the policy-comparison feature. */
  compare: CompareResult;
}

/** Seeded states whose geometry intersects the AOI (GIST-prefiltered). */
async function intersectingStateCodes(aoi: GeoJsonPolygon): Promise<string[]> {
  const { rows } = await pool.query<{ code: string }>(
    `WITH aoi AS (
       SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) AS g
     )
     SELECT j.state_code AS code
       FROM wce.jurisdiction j, aoi
      WHERE j.kind = 'state'
        AND j.state_code IS NOT NULL
        AND j.geom && aoi.g
        AND ST_Intersects(j.geom, aoi.g)
      ORDER BY j.name`,
    [JSON.stringify(aoi)],
  );
  return rows.map((r) => r.code);
}

/** Latest verification date across national + the matched states' cells. */
async function policyAsOf(codes: string[]): Promise<string | null> {
  const { rows } = await pool.query<{ as_of: string | null }>(
    `SELECT MAX(pv.as_of_date)::text AS as_of
       FROM wce.policy_value pv
       JOIN wce.jurisdiction j ON j.id = pv.jurisdiction_id
      WHERE COALESCE(j.state_code, 'national') = ANY($1::text[])`,
    [codes],
  );
  return rows[0]?.as_of ?? null;
}

/**
 * Resolve the report's policy context for an AOI. `year = null` → the latest
 * available value per cell. Returns null when the DB is unavailable.
 */
export async function getPolicyContext(
  aoi: GeoJsonPolygon,
  year: number | null = null,
): Promise<PolicyContext | null> {
  if (!dbAvailable()) return null;
  const stateCodes = await intersectingStateCodes(aoi);
  const codes = ["national", ...stateCodes];
  const [compare, asOf] = await Promise.all([
    getCompare(codes, year),
    policyAsOf(codes),
  ]);
  return { asOf, stateCodes, compare };
}
