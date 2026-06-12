/**
 * context.ts — Section E (site context & sizing) of the Wind Site Analysis.
 *
 * states        — which states the AOI touches (centroid + ring vertices vs
 *                 the India states GeoJSON; screening-grade sampling — a
 *                 sliver of a state crossing between two vertices can be
 *                 missed, acceptable) joined to StateCapacity numbers.
 * windfarms     — proprietary farm boundaries rasterized onto the SAME z10
 *                 pixel grid as the AOI mask (reuses buildAoiMask), so
 *                 overlapFraction needs no polygon-clipping dependency.
 * terrain       — elevation stats + per-pixel slope (central differences on
 *                 the elevation patch; ground pixel size derived per row from
 *                 the web-mercator scale at that latitude).
 * sizing        — plan §2.5 EXACT: usable = area × (1 − overlap) × 0.7;
 *                 capacity = usable × 5 MW/km²; energy = MW × 8.76 × cfIec3.
 *                 An AOI fully inside existing farms yields ~0 MW with the
 *                 overlap shown — a valid result, never an error.
 *
 * Degradation rules: DB down → states keep null capacity numbers; farms file
 * absent → {count: 0, overlapFraction: 0} (warn); states GeoJSON
 * undownloadable → [] (warn); all-NaN elevation → terrain null. Only a
 * truly unexpected fault escapes to the section wrapper.
 */

import { promises as fs } from "fs";
import path from "path";
import { pool, dbAvailable } from "../../lib/db";
import {
  SIZING_ASSUMPTIONS,
  SIZING_MW_PER_KM2,
  SIZING_USABLE_LAND_FRACTION,
} from "./constants";
import { patchPixelCenterLngLat } from "./mercator";
import { buildAoiMask, type PatchFrame } from "./mask";
import type { AoiMask, ContextData, LayerPatch, ValidatedAoi } from "./types";

// ── Constants ───────────────────────────────────────────────────────────────

/** Same India states source the wind-atlas bake uses (build_wind_atlas.py —
 *  post-2014 boundaries incl. J&K + Ladakh; property ST_NM). */
const STATES_GEOJSON_URL =
  "https://gist.githubusercontent.com/jbrobst/56c13bbbf9d97d187fea01ca62ea5112/" +
  "raw/e388c4cae20aa53cb5090210a42ebb9b765c0a36/india_states.geojson";
const STATES_DOWNLOAD_TIMEOUT_MS = 30_000;

const API_ROOT_DIR = path.resolve(import.meta.dir, "..", "..", "..");
const STATES_CACHE_PATH = path.join(API_ROOT_DIR, "data", "cache", "india_states.geojson");
const FARMS_GEOJSON_PATH = path.join(API_ROOT_DIR, "data", "private", "boundaries.geojson");

/** Web-mercator ground resolution at the equator, z0, meters per pixel. */
const MERCATOR_M_PER_PX_Z0 = 156_543.033_92;
const DEG = Math.PI / 180;

/** MW × 8.76 × CF = GWh/yr (8,760 h / 1,000). */
const HOURS_PER_YEAR_OVER_1000 = 8.76;

const SLOPE_90TH_QUANTILE = 0.9;

// ── Types ───────────────────────────────────────────────────────────────────

type LngLat = [number, number];

interface GeoJsonRingGeometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
}

interface StatesFeature {
  properties?: { ST_NM?: string };
  geometry?: GeoJsonRingGeometry;
}

interface FarmsFeature {
  geometry?: GeoJsonRingGeometry;
}

interface FeatureCollection<F> {
  features: F[];
}

export interface CapacityRow {
  state: string;
  installedMw: number | null;
  potentialMw: number | null;
}

/** Injectable loaders so tests never touch network/DB/disk. */
export interface ContextDeps {
  loadStatesGeo?: () => Promise<FeatureCollection<StatesFeature> | null>;
  loadCapacityRows?: () => Promise<CapacityRow[] | null>;
  loadFarmsGeo?: () => Promise<FeatureCollection<FarmsFeature> | null>;
}

export interface ContextInputs {
  elevation: LayerPatch;
  aoiMask: AoiMask;
  cfIec3: number | null;
}

export type ContextResult = ContextData & { slope90thDeg: number | null };

// ── Pure helpers (exported for tests) ───────────────────────────────────────

/** Even-odd ray cast over Polygon/MultiPolygon rings (holes handled by
 *  even-odd parity). */
export function pointInGeometry(
  lon: number,
  lat: number,
  geometry: GeoJsonRingGeometry,
): boolean {
  const polygons: number[][][][] =
    geometry.type === "Polygon"
      ? [geometry.coordinates as number[][][]]
      : (geometry.coordinates as number[][][][]);
  let inside = false;
  for (const rings of polygons) {
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i]?.[0] ?? Number.NaN;
        const yi = ring[i]?.[1] ?? Number.NaN;
        const xj = ring[j]?.[0] ?? Number.NaN;
        const yj = ring[j]?.[1] ?? Number.NaN;
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
    }
  }
  return inside;
}

/** State names (ST_NM) hit by the AOI centroid or any ring vertex. */
export function statesForAoi(
  aoi: Pick<ValidatedAoi, "ring" | "centroid">,
  states: FeatureCollection<StatesFeature>,
): string[] {
  const samples: readonly LngLat[] = [aoi.centroid, ...aoi.ring];
  const hits = new Set<string>();
  for (const feature of states.features) {
    const name = feature.properties?.ST_NM;
    const geometry = feature.geometry;
    if (!name || !geometry) continue;
    if (samples.some(([lon, lat]) => pointInGeometry(lon, lat, geometry))) {
      hits.add(name);
    }
  }
  return [...hits].sort();
}

/** Join sampled state names to capacity rows (null rows → null numbers). */
export function joinStateCapacities(
  names: readonly string[],
  rows: readonly CapacityRow[] | null,
): ContextData["states"] {
  const byState = new Map((rows ?? []).map((r) => [r.state, r]));
  return names.map((name) => {
    const row = byState.get(name);
    if (!row && rows !== null) {
      console.warn(`[context] no StateCapacity row for state "${name}"`);
    }
    return {
      name,
      installedMw: row?.installedMw ?? null,
      potentialMw: row?.potentialMw ?? null,
    };
  });
}

/**
 * Farm count + overlap fraction by rasterizing each candidate farm's rings
 * onto the AOI's own patch grid. A farm counts when it shares ≥1 pixel with
 * the AOI mask; overlapFraction = |union of farm pixels ∩ AOI| / |AOI|.
 */
export function farmOverlap(
  aoi: Pick<ValidatedAoi, "bbox">,
  farms: FeatureCollection<FarmsFeature>,
  frame: PatchFrame,
  aoiMask: AoiMask,
): { count: number; overlapFraction: number } {
  const totalPixels = aoiMask.widthPx * aoiMask.heightPx;
  const union = new Uint8Array(totalPixels);
  let count = 0;

  for (const feature of farms.features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const outerRings: number[][][] =
      geometry.type === "Polygon"
        ? [(geometry.coordinates as number[][][])[0] ?? []]
        : (geometry.coordinates as number[][][][]).map((poly) => poly[0] ?? []);

    let farmTouchesAoi = false;
    for (const outer of outerRings) {
      if (outer.length < 4 || !ringBboxIntersects(outer, aoi.bbox)) continue;
      let farmMask: AoiMask;
      try {
        farmMask = buildAoiMask(outer as unknown as LngLat[], frame);
      } catch (err) {
        console.warn("[context] skipping malformed farm ring", (err as Error).message);
        continue;
      }
      for (let i = 0; i < totalPixels; i++) {
        if (farmMask.inside[i] === 1 && aoiMask.inside[i] === 1) {
          farmTouchesAoi = true;
          union[i] = 1;
        }
      }
    }
    if (farmTouchesAoi) count += 1;
  }

  let overlapPixels = 0;
  for (let i = 0; i < totalPixels; i++) {
    if (union[i] === 1) overlapPixels += 1;
  }
  const overlapFraction =
    aoiMask.insideCount === 0
      ? 0
      : Math.round((overlapPixels / aoiMask.insideCount) * 10_000) / 10_000;
  return { count, overlapFraction };
}

function ringBboxIntersects(
  ring: number[][],
  bbox: readonly [number, number, number, number],
): boolean {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const v of ring) {
    const lon = v?.[0];
    const lat = v?.[1];
    if (typeof lon !== "number" || typeof lat !== "number") continue;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return west <= bbox[2] && east >= bbox[0] && south <= bbox[3] && north >= bbox[1];
}

/**
 * Elevation stats + slope over in-mask pixels. Slope uses central
 * differences; a pixel needs all four finite neighbors (edge / nodata-
 * adjacent pixels are skipped). Ground pixel size is identical in x and y
 * at a given latitude (web-mercator scales both axes by 1/cos φ):
 * dx = dy = 156543.03392 · cos(lat) / 2^zoom meters, evaluated per row.
 */
export function terrainStats(
  elevation: LayerPatch,
  mask: AoiMask,
): { terrain: ContextData["terrain"]; slope90thDeg: number | null } {
  const { widthPx, heightPx, data } = elevation;
  const elevations: number[] = [];
  const slopes: number[] = [];

  for (let row = 0; row < heightPx; row++) {
    const rowLat = patchPixelCenterLngLat(
      elevation.minTileX,
      elevation.minTileY,
      0,
      row,
      elevation.zoom,
    )[1];
    const pixelMeters =
      (MERCATOR_M_PER_PX_Z0 * Math.cos(rowLat * DEG)) / 2 ** elevation.zoom;

    for (let col = 0; col < widthPx; col++) {
      const i = row * widthPx + col;
      if (mask.inside[i] !== 1) continue;
      const center = data[i];
      if (center === undefined || !Number.isFinite(center)) continue;
      elevations.push(center);

      if (col < 1 || col >= widthPx - 1 || row < 1 || row >= heightPx - 1) continue;
      const west = data[i - 1];
      const east = data[i + 1];
      const north = data[i - widthPx];
      const south = data[i + widthPx];
      if (
        west === undefined || east === undefined ||
        north === undefined || south === undefined ||
        !Number.isFinite(west) || !Number.isFinite(east) ||
        !Number.isFinite(north) || !Number.isFinite(south)
      ) {
        continue;
      }
      const dzdx = (east - west) / (2 * pixelMeters);
      const dzdy = (south - north) / (2 * pixelMeters);
      slopes.push(Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI));
    }
  }

  if (elevations.length === 0) {
    console.warn("[context] elevation layer empty in-mask; terrain unavailable");
    return { terrain: null, slope90thDeg: null };
  }

  const sortedSlopes = [...slopes].sort((a, b) => a - b);
  const slope90th =
    sortedSlopes.length === 0 ? null : quantileSorted(sortedSlopes, SLOPE_90TH_QUANTILE);
  const meanSlope =
    slopes.length === 0 ? 0 : slopes.reduce((a, b) => a + b, 0) / slopes.length;

  return {
    terrain: {
      elevMean: Math.round(elevations.reduce((a, b) => a + b, 0) / elevations.length),
      elevMin: Math.round(Math.min(...elevations)),
      elevMax: Math.round(Math.max(...elevations)),
      slopeMeanDeg: Math.round(meanSlope * 10) / 10,
      slopeSteep10Deg: slope90th === null ? 0 : Math.round(slope90th * 10) / 10,
    },
    slope90thDeg: slope90th === null ? null : Math.round(slope90th * 10) / 10,
  };
}

function quantileSorted(sorted: readonly number[], q: number): number {
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  const loV = sorted[lo] ?? 0;
  const hiV = sorted[hi] ?? loV;
  return loV + (hiV - loV) * (pos - lo);
}

/** Plan §2.5, verbatim formulas. cfIec3 null → 0 GWh (no CF, no energy). */
export function computeSizing(
  areaKm2: number,
  overlapFraction: number,
  cfIec3: number | null,
): ContextData["sizing"] {
  const usableKm2 = areaKm2 * (1 - overlapFraction) * SIZING_USABLE_LAND_FRACTION;
  const capacityMw = Math.round(usableKm2 * SIZING_MW_PER_KM2 * 10) / 10;
  const energyGwh =
    Math.round(capacityMw * HOURS_PER_YEAR_OVER_1000 * (cfIec3 ?? 0) * 10) / 10;
  return { capacityMw, energyGwh, assumptions: [...SIZING_ASSUMPTIONS] };
}

// ── Default loaders (disk / network / DB) ───────────────────────────────────

let statesGeoPromise: Promise<FeatureCollection<StatesFeature> | null> | null = null;

function loadStatesGeoDefault(): Promise<FeatureCollection<StatesFeature> | null> {
  statesGeoPromise ??= (async () => {
    try {
      const cached = await fs.readFile(STATES_CACHE_PATH, "utf8").catch(() => null);
      if (cached) return JSON.parse(cached) as FeatureCollection<StatesFeature>;
      const res = await fetch(STATES_GEOJSON_URL, {
        headers: { "User-Agent": "wce-analysis" },
        signal: AbortSignal.timeout(STATES_DOWNLOAD_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`states geojson HTTP ${res.status}`);
      const body = await res.text();
      const parsed = JSON.parse(body) as FeatureCollection<StatesFeature>;
      if (!Array.isArray(parsed.features)) throw new Error("not a FeatureCollection");
      await fs.mkdir(path.dirname(STATES_CACHE_PATH), { recursive: true });
      const tmp = `${STATES_CACHE_PATH}.tmp-${process.pid}`;
      await fs.writeFile(tmp, body);
      await fs.rename(tmp, STATES_CACHE_PATH);
      return parsed;
    } catch (err) {
      console.warn("[context] states geojson unavailable:", (err as Error).message);
      return null;
    }
  })();
  return statesGeoPromise;
}

/**
 * Mirror of the web app's STATE_DATA (components/Map/constants.ts) — the
 * plan §4 Phase 2 "STATE_DATA join". Used when the StateCapacity table is
 * absent (local dev DB carries only PostGIS + windmills) or empty.
 * installedMw = MNRE installed base; potentialMw = NIWE @120 m, in MW.
 */
const STATE_CAPACITY_FALLBACK: readonly CapacityRow[] = [
  { state: "Gujarat", installedMw: 12677, potentialMw: 180800 },
  { state: "Tamil Nadu", installedMw: 11740, potentialMw: 95100 },
  { state: "Karnataka", installedMw: 7351, potentialMw: 169300 },
  { state: "Maharashtra", installedMw: 5285, potentialMw: 173900 },
  { state: "Rajasthan", installedMw: 5209, potentialMw: 284200 },
  { state: "Andhra Pradesh", installedMw: 4377, potentialMw: 123300 },
  { state: "Madhya Pradesh", installedMw: 3195, potentialMw: 55400 },
  { state: "Telangana", installedMw: 128, potentialMw: 54700 },
  { state: "Kerala", installedMw: 71, potentialMw: 3000 },
];

async function loadCapacityRowsDefault(): Promise<CapacityRow[] | null> {
  if (!dbAvailable()) {
    console.warn("[context] DB unavailable; using STATE_DATA fallback capacities");
    return [...STATE_CAPACITY_FALLBACK];
  }
  try {
    const { rows } = await pool.query<{
      state: string;
      installedMw: string | number | null;
      potentialMw120m: string | number | null;
      potentialMw150m: string | number | null;
    }>(
      'SELECT state, "installedMw", "potentialMw120m", "potentialMw150m" FROM "StateCapacity"',
    );
    if (rows.length === 0) {
      console.warn("[context] StateCapacity table empty; using STATE_DATA fallback");
      return [...STATE_CAPACITY_FALLBACK];
    }
    return rows.map((r) => ({
      state: r.state,
      installedMw: toFinite(r.installedMw),
      // NIWE @120 m is the standard reference; 150 m only as fallback.
      potentialMw: toFinite(r.potentialMw120m) ?? toFinite(r.potentialMw150m),
    }));
  } catch (err) {
    console.warn(
      "[context] StateCapacity query failed; using STATE_DATA fallback:",
      (err as Error).message,
    );
    return [...STATE_CAPACITY_FALLBACK];
  }
}

function toFinite(v: string | number | null): number | null {
  if (v === null) return null;
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

let farmsGeoPromise: Promise<FeatureCollection<FarmsFeature> | null> | null = null;

function loadFarmsGeoDefault(): Promise<FeatureCollection<FarmsFeature> | null> {
  farmsGeoPromise ??= (async () => {
    try {
      const body = await fs.readFile(FARMS_GEOJSON_PATH, "utf8");
      const parsed = JSON.parse(body) as FeatureCollection<FarmsFeature>;
      if (!Array.isArray(parsed.features)) throw new Error("not a FeatureCollection");
      return parsed;
    } catch (err) {
      console.warn(
        "[context] farm boundaries unavailable (windfarms degrade to 0):",
        (err as Error).message,
      );
      return null;
    }
  })();
  return farmsGeoPromise;
}

/** Test hook: drop the module-level lazy caches. */
export function resetContextCachesForTesting(): void {
  statesGeoPromise = null;
  farmsGeoPromise = null;
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function computeContext(
  aoi: ValidatedAoi,
  inputs: ContextInputs,
  deps: ContextDeps = {},
): Promise<ContextResult> {
  const loadStates = deps.loadStatesGeo ?? loadStatesGeoDefault;
  const loadCapacity = deps.loadCapacityRows ?? loadCapacityRowsDefault;
  const loadFarms = deps.loadFarmsGeo ?? loadFarmsGeoDefault;

  const [statesGeo, capacityRows, farmsGeo] = await Promise.all([
    loadStates(),
    loadCapacity(),
    loadFarms(),
  ]);

  const stateNames = statesGeo ? statesForAoi(aoi, statesGeo) : [];
  if (!statesGeo) console.warn("[context] states list degraded to []");

  const windfarms = farmsGeo
    ? farmOverlap(aoi, farmsGeo, inputs.elevation, inputs.aoiMask)
    : { count: 0, overlapFraction: 0 };

  const { terrain, slope90thDeg } = terrainStats(inputs.elevation, inputs.aoiMask);

  return {
    states: joinStateCapacities(stateNames, capacityRows),
    windfarms,
    terrain,
    sizing: computeSizing(aoi.areaKm2, windfarms.overlapFraction, inputs.cfIec3),
    slope90thDeg,
  };
}
