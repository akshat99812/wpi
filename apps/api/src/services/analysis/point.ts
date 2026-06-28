/**
 * point.ts — exact-point screening for ONE coordinate (a clicked turbine in an
 * uploaded micro-sited layout). Unlike index.ts (which grid-samples a polygon
 * AOI), this reads values AT the exact lon/lat:
 *   - resource: GWA ws50/100/150 + cf_iec3/2 + pd100 + elevation at the pixel
 *     (shear α fitted from the three speeds; power density air-density-corrected)
 *   - validation: nearest met mast + model delta (reuses validation.ts)
 *   - grid: nearest substation / line (reuses grid.ts off a degenerate bbox)
 *   - exclusion: which legal exclusion zones, if any, CONTAIN the point
 *
 * Every block degrades to null on failure (logged) — a point report never
 * throws for a section fault, mirroring the AOI pipeline's contract.
 */

import { pool, dbAvailable } from "../../lib/db";
import { GWA_LAYERS } from "./constants";
import {
  airDensityAtElevation,
  fitShearAlpha,
  roundTo,
  SHEAR_ALPHA_MAX,
  SHEAR_ALPHA_MIN,
} from "./resource";
import { fetchPointValue, type TileFetchOptions } from "./tiles";
import { fetchPowerFeatures, summarizeGridFeatures } from "./grid";
import { computePointValidation } from "./validation";
import type { GridData, ValidationData } from "./types";

// ── Rounding policy (mirrors resource.ts presentation grades) ───────────────
const SPEED_DECIMALS = 2;
const CF_DECIMALS = 3;
const POWER_DECIMALS = 1;
const AIR_DENSITY_DECIMALS = 3;
const SHEAR_DECIMALS = 3;
/** Sea-level air density (kg/m³) — airDensityAtElevation(0) === 1.225. */
const SEA_LEVEL_RHO = airDensityAtElevation(0);
/** 1/7 power law — only used to shear-adjust the mast delta when α is absent. */
const SHEAR_ALPHA_FALLBACK = 1 / 7;

export interface PointResourceData {
  /** Mean wind speed @100 m (m/s) — the headline resource value at the point. */
  meanSpeed: number;
  ws50: number | null;
  ws150: number | null;
  /** Power-law shear exponent fitted from the 50/100/150 m speeds; null if unfit. */
  shearAlpha: number | null;
  /** GWA gross capacity factor for an IEC-III / IEC-II reference turbine (0–1). */
  cfIec3: number | null;
  cfIec2: number | null;
  /** Air-density-corrected power density (W/m²) and its raw GWA value. */
  powerDensity: number | null;
  powerDensityRaw: number | null;
  airDensity: number | null;
  elevationM: number | null;
}

export interface ExclusionHit {
  layerCode: string;
  cls: "red" | "amber";
}

export interface PointExclusion {
  /** True when the point falls inside any red/amber exclusion zone. */
  inExclusion: boolean;
  /** True when at least one hit is a hard (red, no-go) exclusion. */
  hardHit: boolean;
  hits: ExclusionHit[];
}

export interface PointReport {
  point: { lon: number; lat: number };
  resource: PointResourceData | null;
  validation: {
    nearestMast: ValidationData["nearestMast"];
    modelDeltaPct: number | null;
  } | null;
  grid: GridData | null;
  exclusion: PointExclusion | null;
}

// ── Resource at the exact pixel ─────────────────────────────────────────────

async function computePointResource(
  lon: number,
  lat: number,
  options: TileFetchOptions,
): Promise<PointResourceData | null> {
  const [ws50, ws100, ws150, cfIec3, cfIec2, pd100, elevation] = await Promise.all([
    fetchPointValue(GWA_LAYERS.ws50, lon, lat, options),
    fetchPointValue(GWA_LAYERS.ws100, lon, lat, options),
    fetchPointValue(GWA_LAYERS.ws150, lon, lat, options),
    fetchPointValue(GWA_LAYERS.cfIec3, lon, lat, options),
    fetchPointValue(GWA_LAYERS.cfIec2, lon, lat, options),
    fetchPointValue(GWA_LAYERS.pd100, lon, lat, options),
    fetchPointValue(GWA_LAYERS.elevation, lon, lat, options),
  ]);

  // No wind value at the point ⇒ the whole resource block is unavailable.
  if (ws100 === null || !(ws100 > 0)) return null;

  const canFitShear = ws50 !== null && ws50 > 0 && ws150 !== null && ws150 > 0;
  const rawAlpha = canFitShear ? fitShearAlpha([ws50, ws100, ws150]) : Number.NaN;
  // Clamp into the physical sanity band — same invariant as the AOI path
  // (resource.ts). A single noisy pixel can fit a negative or >0.6 slope, which
  // would otherwise both display implausibly and skew the mast delta below.
  const shearAlpha = Number.isFinite(rawAlpha)
    ? roundTo(Math.min(SHEAR_ALPHA_MAX, Math.max(SHEAR_ALPHA_MIN, rawAlpha)), SHEAR_DECIMALS)
    : null;

  const elevationM =
    elevation !== null && Number.isFinite(elevation) ? Math.round(elevation) : null;
  const airDensity =
    elevationM !== null ? roundTo(airDensityAtElevation(elevationM), AIR_DENSITY_DECIMALS) : null;

  const powerDensityRaw = pd100 !== null && pd100 > 0 ? roundTo(pd100, POWER_DECIMALS) : null;
  const powerDensity =
    powerDensityRaw !== null && airDensity !== null
      ? roundTo(powerDensityRaw * (airDensity / SEA_LEVEL_RHO), POWER_DECIMALS)
      : powerDensityRaw;

  // GWA capacity-factor layers carry tiny negatives in nodata fringes — clamp ≥0.
  const cf = (v: number | null): number | null =>
    v !== null && Number.isFinite(v) ? roundTo(Math.max(0, v), CF_DECIMALS) : null;

  return {
    meanSpeed: roundTo(ws100, SPEED_DECIMALS),
    ws50: ws50 !== null ? roundTo(ws50, SPEED_DECIMALS) : null,
    ws150: ws150 !== null ? roundTo(ws150, SPEED_DECIMALS) : null,
    shearAlpha,
    cfIec3: cf(cfIec3),
    cfIec2: cf(cfIec2),
    powerDensity,
    powerDensityRaw,
    airDensity,
    elevationM,
  };
}

// ── Grid at the exact point (degenerate bbox → expanding-ring search) ────────

async function computePointGrid(
  lon: number,
  lat: number,
  options: TileFetchOptions,
): Promise<GridData> {
  const { lines, substations } = await fetchPowerFeatures([lon, lat, lon, lat], options);
  const g = summarizeGridFeatures([lon, lat], lines, substations);
  return {
    nearestSubstation: g.nearestSubstation,
    nearestLine: g.nearestLine,
    ehvWithin25Km: g.ehvWithin25Km,
    dataNote: g.dataNote,
  };
}

// ── Exclusion zones containing the point ────────────────────────────────────

async function computePointExclusion(lon: number, lat: number): Promise<PointExclusion> {
  const sql = `
    WITH pt AS (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326) AS g)
    SELECT DISTINCT layer_code, cls FROM (
      SELECT e.layer_code AS layer_code, e.class AS cls
        FROM wce.excl_polygon e, pt
       WHERE e.geom && pt.g AND ST_Intersects(e.geom, pt.g)
      UNION ALL
      SELECT b.layer_code AS layer_code, b.class AS cls
        FROM wce.excl_buffer b, pt
       WHERE b.geom && pt.g AND ST_Intersects(b.geom, pt.g)
    ) f
  `;
  const result = await pool.query(sql, [lon, lat]);
  const hits: ExclusionHit[] = result.rows
    .filter((r) => r.cls === "red" || r.cls === "amber")
    .map((r) => ({ layerCode: String(r.layer_code), cls: r.cls as "red" | "amber" }));
  return {
    inExclusion: hits.length > 0,
    hardHit: hits.some((h) => h.cls === "red"),
    hits,
  };
}

// ── Public entry point ──────────────────────────────────────────────────────

/**
 * Build the exact-point report for one coordinate. Each block degrades to null
 * on failure (logged); the function only throws on a non-finite coordinate.
 */
export async function computePointReport(
  lon: number,
  lat: number,
  options: TileFetchOptions = {},
): Promise<PointReport> {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error(`computePointReport: non-finite coordinates lon=${lon} lat=${lat}`);
  }

  // Grid + exclusion are independent of resource — start them immediately.
  const gridPromise = computePointGrid(lon, lat, options).catch((err) => {
    console.error("[point] grid section failed", err);
    return null;
  });
  const exclusionPromise = dbAvailable()
    ? computePointExclusion(lon, lat).catch((err) => {
        console.error("[point] exclusion section failed", err);
        return null;
      })
    : Promise.resolve(null);

  // Validation needs the point's shear α, so it waits on resource.
  const resource = await computePointResource(lon, lat, options).catch((err) => {
    console.error("[point] resource section failed", err);
    return null;
  });

  const shearForDelta = resource?.shearAlpha ?? SHEAR_ALPHA_FALLBACK;
  const validationPromise = dbAvailable()
    ? computePointValidation(lon, lat, shearForDelta, options).catch((err) => {
        console.error("[point] validation section failed", err);
        return null;
      })
    : Promise.resolve(null);

  const [grid, exclusion, validation] = await Promise.all([
    gridPromise,
    exclusionPromise,
    validationPromise,
  ]);

  return { point: { lon, lat }, resource, validation, grid, exclusion };
}
