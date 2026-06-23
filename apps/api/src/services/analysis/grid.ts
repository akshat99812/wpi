/**
 * grid.ts — Section D (grid infrastructure) of the Wind Site Analysis.
 *
 * Decodes OpenInfraMap MVT power tiles (OSM-derived) in an expanding ring
 * around the AOI and reports the nearest substation / transmission line plus
 * EHV proximity (plan.md §4 Phase 2, §3 contract).
 *
 * Decode semantics are pinned by VERIFIED.md §4 — the source of truth:
 *   - z10 ONLY: z7 silently drops minor substations (27→7) and ALL untagged
 *     lines, so the expanding-ring search always runs on z10 tiles.
 *   - `power_substation_point` is the canonical substation layer (the polygon
 *     `power_substation` layer appears at neither z7 nor z10).
 *   - `power_generator` (~3k individual turbines per tile) is NEVER decoded.
 *   - Tile voltages are ALREADY kV (raw OSM is volts — do not divide):
 *     numbers on lines, float-noise strings on substations. Multi-voltage
 *     arrives as `voltage_2`/`voltage_3` props (semicolon strings handled
 *     defensively too).
 *   - Missing-voltage features are KEPT with voltageKv null (plan hard rule:
 *     never drop a grid feature for a missing voltage tag).
 *
 * Distance anchor: every distance is measured from the AOI CENTROID — a
 * screening-grade anchor, consistent with point-mode (whose centroid IS the
 * clicked point). For large drawn AOIs the true edge-to-feature distance can
 * be somewhat shorter; acceptable at screening grade and stated in dataNote.
 *
 * Disk cache mirrors tiles.ts conventions (same root resolution, temp-file +
 * rename writes) under its own namespace, but with a FINITE 7-day TTL — OSM
 * data changes, unlike the fixed GWA climatology. A stale entry is refetched;
 * if the refetch fails the stale copy is served. One bad tile never fails the
 * section; only a first search ring that fails ENTIRELY (no fetch, no cache)
 * throws, so the section can degrade to status "unavailable".
 */

import { promises as fs } from "fs";
import path from "path";
// pbf v5 has no default export — the reader class is `PbfReader` (VERIFIED §4).
import { PbfReader } from "pbf";
import { VectorTile, type VectorTileLayer } from "@mapbox/vector-tile";

import { ANALYSIS_ZOOM } from "./constants";
import { haversineKm, tileCoverForBbox } from "./mercator";
import type { TileFetchImpl, TileFetchOptions } from "./tiles";
import type { GridData, ValidatedAoi } from "./types";

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * Expanding-ring search pads (km) around the AOI bbox (plan §4 Phase 2:
 * start at +10 km, expand until hit or the 100 km cap).
 */
export const GRID_SEARCH_PADS_KM = [10, 25, 50, 100] as const;

/**
 * India EHV convention: ≥220 kV is extra-high-voltage transmission — the
 * interconnection class a utility-scale wind farm needs (66–132 kV is
 * sub-transmission). Drives both `ehvWithin25Km` and `nearestEhvKm`.
 */
export const EHV_MIN_KV = 220;

/** Radius for the `ehvWithin25Km` flag (plan §3 contract). */
const EHV_PROXIMITY_KM = 25;

/** VERIFIED.md §4: decode at z10 only. Same zoom the GWA sampling is pinned to. */
const POWER_DECODE_ZOOM = ANALYSIS_ZOOM;

const POWER_UPSTREAM_BASE = "https://openinframap.org/map/power";
const POWER_TILE_TIMEOUT_MS = 5_000;
/** OSM-derived tiles go stale — unlike the infinite-TTL GWA cache. */
const POWER_TILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const POWER_TILE_FETCH_CONCURRENCY = 4;
const POWER_TILE_USER_AGENT = "wce-analysis";
const CACHE_NAMESPACE = "power-mvt";

const LINE_LAYER = "power_line";
const SUBSTATION_LAYER = "power_substation_point";

const GRID_DATA_NOTE = "OSM-derived; may be incomplete";

const EARTH_RADIUS_KM = 6371.0088;
const DEG = Math.PI / 180;
/** Same flat-earth pad factors squareRingAround uses (mercator.ts). */
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_EQUATOR = 111.32;

// Cache root resolution intentionally mirrors tiles.ts (private there; a
// shared util would touch a file this module does not own).
const PROD_CACHE_DIR = "/var/cache/tiles";
const API_ROOT_DIR = path.resolve(import.meta.dir, "..", "..", "..");
const DEV_CACHE_DIR = path.join(API_ROOT_DIR, ".cache", "tiles");

// ── Public types ────────────────────────────────────────────────────────────

/** computeGrid result: the GridData contract + the score's grid input. */
export type GridResult = GridData & { nearestEhvKm: number | null };

export interface PowerLineFeature {
  /** MVT feature id (cross-tile dedupe key); null when the tile omits ids. */
  id: number | null;
  /** Primary `voltage` prop — the value REPORTED as voltageKv. */
  voltageKv: number | null;
  /** max(voltage, voltage_2, voltage_3) — used ONLY for EHV classification. */
  maxVoltageKv: number | null;
  /** Line parts as [lon, lat] vertex runs (LineString → 1 part). */
  parts: [number, number][][];
}

export interface SubstationFeature {
  id: number | null;
  name: string | null;
  voltageKv: number | null;
  maxVoltageKv: number | null;
  lon: number;
  lat: number;
}

// ── Voltage parsing (semantics per VERIFIED.md §4) ──────────────────────────

/**
 * Parse one voltage prop into kV. Numbers pass through; float-noise strings
 * ("110.0000000000000000") parse cleanly; semicolon-joined multi-voltage
 * strings ("220;400") take the max (defensive — VERIFIED §4 says
 * multi-voltage normally arrives as voltage_2/voltage_3 props instead).
 * Not finite or ≤0 → null. The FEATURE is always kept either way.
 */
export function parseVoltageKv(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const parts = String(raw)
    .split(";")
    .map((part) => Number.parseFloat(part))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (parts.length === 0) return null;
  return Math.max(...parts);
}

/**
 * Highest voltage across `voltage`, `voltage_2`, `voltage_3` — the EHV
 * classification value. The primary `voltage` is still what gets reported
 * as voltageKv in the response.
 */
export function maxVoltageKvOf(props: Record<string, unknown>): number | null {
  const candidates = [props.voltage, props.voltage_2, props.voltage_3]
    .map(parseVoltageKv)
    .filter((v): v is number => v !== null);
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

// ── Distance helpers ────────────────────────────────────────────────────────

/**
 * Point-to-segment distance in km. Projects both endpoints onto a local
 * tangent plane about the reference point (equirectangular — accurate to
 * meters at the <100 km scales this search operates at), clamps the
 * projection parameter to the segment, and measures planar distance.
 * Degenerate zero-length segments collapse to point distance.
 */
export function pointToSegmentKm(
  refLat: number,
  refLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const cosRef = Math.cos(refLat * DEG);
  const ax = (aLon - refLon) * DEG * cosRef * EARTH_RADIUS_KM;
  const ay = (aLat - refLat) * DEG * EARTH_RADIUS_KM;
  const bx = (bLon - refLon) * DEG * cosRef * EARTH_RADIUS_KM;
  const by = (bLat - refLat) * DEG * EARTH_RADIUS_KM;
  const dx = bx - ax;
  const dy = by - ay;
  const segLenSq = dx * dx + dy * dy;
  const t =
    segLenSq === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx - ay * dy) / segLenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.sqrt(cx * cx + cy * cy);
}

/** Min distance from (lat, lon) to any segment of the line; ∞ if degenerate. */
function minLineDistanceKm(lat: number, lon: number, line: PowerLineFeature): number {
  let best = Infinity;
  for (const part of line.parts) {
    for (let i = 0; i < part.length - 1; i += 1) {
      const a = part[i];
      const b = part[i + 1];
      if (!a || !b) continue;
      const d = pointToSegmentKm(lat, lon, a[1], a[0], b[1], b[0]);
      if (d < best) best = d;
    }
  }
  return best;
}

// ── Expanding-ring tile-set helpers (pure) ──────────────────────────────────

/** Bbox grown by `padKm` on every side (flat-earth degrees at the mid-lat). */
export function padBboxKm(
  bbox: readonly [number, number, number, number],
  padKm: number,
): [number, number, number, number] {
  const [west, south, east, north] = bbox;
  const midLat = (south + north) / 2;
  const dLat = padKm / KM_PER_DEG_LAT;
  const dLon = padKm / (KM_PER_DEG_LON_EQUATOR * Math.cos(midLat * DEG));
  return [west - dLon, south - dLat, east + dLon, north + dLat];
}

export function tileKey(x: number, y: number): string {
  return `${x}/${y}`;
}

/**
 * z-cover of `bbox` MINUS tiles already in `seen` — each expansion round
 * fetches only its NEW tiles. Pure: never mutates `seen`.
 */
export function newTileCoords(
  bbox: readonly [number, number, number, number],
  z: number,
  seen: ReadonlySet<string>,
): { x: number; y: number }[] {
  const cover = tileCoverForBbox(bbox, z);
  const coords: { x: number; y: number }[] = [];
  for (let y = cover.minY; y <= cover.maxY; y += 1) {
    for (let x = cover.minX; x <= cover.maxX; x += 1) {
      if (!seen.has(tileKey(x, y))) coords.push({ x, y });
    }
  }
  return coords;
}

// ── Disk cache (namespace "power-mvt", 7-day TTL) ───────────────────────────

/** Same resolution order as tiles.ts: env override → prod path → dev path. */
function resolveTileCacheDir(): string {
  const fromEnv = process.env.TILE_CACHE_DIR;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return process.env.NODE_ENV === "production" ? PROD_CACHE_DIR : DEV_CACHE_DIR;
}

function powerTileCachePath(baseDir: string, x: number, y: number): string {
  return path.join(
    baseDir,
    CACHE_NAMESPACE,
    String(POWER_DECODE_ZOOM),
    String(x),
    `${y}.pbf`,
  );
}

interface CachedPowerTile {
  bytes: Buffer;
  /** Within the 7-day TTL. Stale entries are refetch-then-fallback. */
  isFresh: boolean;
}

async function readCachedPowerTile(filePath: string): Promise<CachedPowerTile | null> {
  try {
    const [bytes, info] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)]);
    return { bytes, isFresh: Date.now() - info.mtimeMs <= POWER_TILE_TTL_MS };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[power-tiles] cache read failed; treating as miss", {
        filePath,
        err: (err as Error).message,
      });
    }
    return null;
  }
}

/** Temp-file + rename (no torn reads); a failed write never fails the
 *  analysis — log and continue (convention copied from tiles.ts). */
async function writeCachedPowerTile(filePath: string, bytes: Uint8Array): Promise<void> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmpPath, bytes);
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    console.warn("[power-tiles] cache write failed", {
      filePath,
      err: (err as Error).message,
    });
  }
}

// ── Fetch + decode ──────────────────────────────────────────────────────────

/**
 * Fetch one power tile from upstream. 404/204 (and empty 200 bodies) return
 * a zero-length array — the cached "empty tile" marker, same convention as
 * the tile bake flow. Any other failure throws; the caller decides whether a
 * stale cached copy can stand in.
 */
async function fetchPowerTileBytes(
  x: number,
  y: number,
  fetchImpl: TileFetchImpl,
): Promise<Uint8Array> {
  const url = `${POWER_UPSTREAM_BASE}/${POWER_DECODE_ZOOM}/${x}/${y}.pbf`;
  const res = await fetchImpl(url, {
    headers: { "User-Agent": POWER_TILE_USER_AGENT },
    signal: AbortSignal.timeout(POWER_TILE_TIMEOUT_MS),
  });
  if (res.status === 404 || res.status === 204) return new Uint8Array(0);
  if (!res.ok) throw new Error(`upstream HTTP ${res.status} for ${url}`);
  // Bun's fetch auto-decompresses the gzip body → identity-encoded protobuf.
  return new Uint8Array(await res.arrayBuffer());
}

type DecodedGeometry = { type: string; coordinates: unknown };

function geometryLineParts(geometry: DecodedGeometry): [number, number][][] {
  if (geometry.type === "LineString") {
    return [geometry.coordinates as [number, number][]];
  }
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates as [number, number][][];
  }
  return [];
}

function geometryPoint(geometry: DecodedGeometry): [number, number] | null {
  if (geometry.type === "Point") return geometry.coordinates as [number, number];
  if (geometry.type === "MultiPoint") {
    return (geometry.coordinates as [number, number][])[0] ?? null;
  }
  return null;
}

function extractLines(layer: VectorTileLayer, x: number, y: number): PowerLineFeature[] {
  const lines: PowerLineFeature[] = [];
  for (let i = 0; i < layer.length; i += 1) {
    const feature = layer.feature(i);
    const geometry = feature.toGeoJSON(x, y, POWER_DECODE_ZOOM)
      .geometry as DecodedGeometry;
    const parts = geometryLineParts(geometry);
    if (parts.length === 0) continue;
    const props = feature.properties as Record<string, unknown>;
    lines.push({
      id: typeof feature.id === "number" ? feature.id : null,
      voltageKv: parseVoltageKv(props.voltage),
      maxVoltageKv: maxVoltageKvOf(props),
      parts,
    });
  }
  return lines;
}

function extractSubstations(
  layer: VectorTileLayer,
  x: number,
  y: number,
): SubstationFeature[] {
  const substations: SubstationFeature[] = [];
  for (let i = 0; i < layer.length; i += 1) {
    const feature = layer.feature(i);
    const geometry = feature.toGeoJSON(x, y, POWER_DECODE_ZOOM)
      .geometry as DecodedGeometry;
    const point = geometryPoint(geometry);
    if (!point) continue;
    const props = feature.properties as Record<string, unknown>;
    substations.push({
      id: typeof feature.id === "number" ? feature.id : null,
      name: typeof props.name === "string" && props.name.length > 0 ? props.name : null,
      voltageKv: parseVoltageKv(props.voltage),
      maxVoltageKv: maxVoltageKvOf(props),
      lon: point[0],
      lat: point[1],
    });
  }
  return substations;
}

interface DecodedPowerTile {
  lines: PowerLineFeature[];
  substations: SubstationFeature[];
}

/** Zero-length bytes = the cached empty marker. Decode failures → null
 *  (never throws — one bad tile must never fail the section). */
function decodePowerTile(bytes: Uint8Array, x: number, y: number): DecodedPowerTile | null {
  if (bytes.length === 0) return { lines: [], substations: [] };
  try {
    const vt = new VectorTile(new PbfReader(bytes));
    const lineLayer = vt.layers[LINE_LAYER];
    const subLayer = vt.layers[SUBSTATION_LAYER];
    return {
      lines: lineLayer ? extractLines(lineLayer, x, y) : [],
      substations: subLayer ? extractSubstations(subLayer, x, y) : [],
    };
  } catch (err) {
    console.warn("[power-tiles] tile decode failed", {
      tile: `${POWER_DECODE_ZOOM}/${x}/${y}`,
      err: (err as Error).message,
    });
    return null;
  }
}

type TileLoadResult = { ok: true; decoded: DecodedPowerTile } | { ok: false };

/**
 * One tile through the cache: fresh cache wins; TTL miss refetches; on
 * upstream failure a stale cached copy is served; otherwise the tile is
 * skipped with a warning (ok:false). Never throws.
 */
async function loadPowerTile(
  x: number,
  y: number,
  fetchImpl: TileFetchImpl,
): Promise<TileLoadResult> {
  const filePath = powerTileCachePath(resolveTileCacheDir(), x, y);
  const cached = await readCachedPowerTile(filePath);
  if (cached?.isFresh) {
    const decoded = decodePowerTile(cached.bytes, x, y);
    if (decoded) return { ok: true, decoded };
    console.warn("[power-tiles] fresh cached tile corrupt; refetching", { filePath });
  }
  let fetchedBytes: Uint8Array | null = null;
  try {
    fetchedBytes = await fetchPowerTileBytes(x, y, fetchImpl);
  } catch (err) {
    console.warn("[power-tiles] upstream fetch failed", {
      tile: `${POWER_DECODE_ZOOM}/${x}/${y}`,
      err: (err as Error).message,
    });
  }
  if (fetchedBytes !== null) {
    const decoded = decodePowerTile(fetchedBytes, x, y);
    if (decoded) {
      await writeCachedPowerTile(filePath, fetchedBytes);
      return { ok: true, decoded };
    }
  }
  if (cached) {
    const decoded = decodePowerTile(cached.bytes, x, y);
    if (decoded) {
      console.warn("[power-tiles] serving stale cached tile after upstream failure", {
        filePath,
      });
      return { ok: true, decoded };
    }
  }
  return { ok: false };
}

// ── Cross-tile feature accumulation ─────────────────────────────────────────

interface FeatureAccumulator {
  linesById: Map<number, PowerLineFeature>;
  looseLines: PowerLineFeature[];
  subsById: Map<number, SubstationFeature>;
  looseSubs: SubstationFeature[];
}

function newAccumulator(): FeatureAccumulator {
  return { linesById: new Map(), looseLines: [], subsById: new Map(), looseSubs: [] };
}

/**
 * Dedupe across tiles by MVT feature id:
 *   - lines: the same id in adjacent tiles carries DIFFERENT clipped
 *     geometry, so parts are UNIONED (a plain drop could discard the closer
 *     clip). The merge builds a new object — never mutates a stored feature.
 *   - substations: identical point in every tile → first wins.
 *   - id-less features are kept as-is; duplicates are harmless because every
 *     consumer is a min()/any() — both idempotent.
 */
function accumulateTile(acc: FeatureAccumulator, decoded: DecodedPowerTile): void {
  for (const line of decoded.lines) {
    if (line.id === null) {
      acc.looseLines.push(line);
      continue;
    }
    const existing = acc.linesById.get(line.id);
    acc.linesById.set(
      line.id,
      existing ? { ...existing, parts: [...existing.parts, ...line.parts] } : line,
    );
  }
  for (const sub of decoded.substations) {
    if (sub.id === null) {
      acc.looseSubs.push(sub);
      continue;
    }
    if (!acc.subsById.has(sub.id)) acc.subsById.set(sub.id, sub);
  }
}

function allLines(acc: FeatureAccumulator): PowerLineFeature[] {
  return [...acc.linesById.values(), ...acc.looseLines];
}

function allSubstations(acc: FeatureAccumulator): SubstationFeature[] {
  return [...acc.subsById.values(), ...acc.looseSubs];
}

// ── Summary (pure) ──────────────────────────────────────────────────────────

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Index of the smallest finite value; -1 when none (empty / all ∞). */
function indexOfMin(values: readonly number[]): number {
  let bestIndex = -1;
  let best = Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v !== undefined && v < best) {
      best = v;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function isEhv(maxKv: number | null): boolean {
  return maxKv !== null && maxKv >= EHV_MIN_KV;
}

/** Unrounded distance to the nearest ≥EHV_MIN_KV feature; null if none. */
function nearestEhvDistanceKm(
  lines: readonly PowerLineFeature[],
  lineDistances: readonly number[],
  substations: readonly SubstationFeature[],
  subDistances: readonly number[],
): number | null {
  let best = Infinity;
  lines.forEach((line, i) => {
    const d = lineDistances[i];
    if (isEhv(line.maxVoltageKv) && d !== undefined && d < best) best = d;
  });
  substations.forEach((sub, i) => {
    const d = subDistances[i];
    if (isEhv(sub.maxVoltageKv) && d !== undefined && d < best) best = d;
  });
  return Number.isFinite(best) ? best : null;
}

/**
 * Pure reduction of the accumulated features to the GridData contract.
 * Reported distances are rounded to 1 dp; the ehvWithin25Km flag and the
 * EHV minimum are decided on UNROUNDED distances. EHV classification uses
 * maxVoltageKv (voltage_2/voltage_3 promoted); the REPORTED voltageKv stays
 * the primary `voltage` prop.
 */
export function summarizeGridFeatures(
  centroid: readonly [number, number],
  lines: readonly PowerLineFeature[],
  substations: readonly SubstationFeature[],
): GridResult {
  const [lon, lat] = centroid;
  const subDistances = substations.map((s) => haversineKm(lat, lon, s.lat, s.lon));
  const lineDistances = lines.map((l) => minLineDistanceKm(lat, lon, l));
  const subIndex = indexOfMin(subDistances);
  const lineIndex = indexOfMin(lineDistances);
  const nearestSub = subIndex >= 0 ? substations[subIndex] : undefined;
  const nearestLn = lineIndex >= 0 ? lines[lineIndex] : undefined;
  const ehvKm = nearestEhvDistanceKm(lines, lineDistances, substations, subDistances);
  return {
    nearestSubstation: nearestSub
      ? {
          name: nearestSub.name,
          voltageKv: nearestSub.voltageKv,
          distanceKm: round1(subDistances[subIndex] as number),
        }
      : null,
    nearestLine: nearestLn
      ? {
          voltageKv: nearestLn.voltageKv,
          distanceKm: round1(lineDistances[lineIndex] as number),
        }
      : null,
    ehvWithin25Km: ehvKm !== null && ehvKm <= EHV_PROXIMITY_KM,
    nearestEhvKm: ehvKm === null ? null : round1(ehvKm),
    dataNote: GRID_DATA_NOTE,
  };
}

// ── Orchestration ───────────────────────────────────────────────────────────

/** Run `fn` over `items` with at most `limit` in flight (pattern shared with
 *  tiles.ts, where the helper is private). Order-preserving. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const i = nextIndex;
      nextIndex += 1;
      results[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Section D entry point: expanding-ring power-tile search around the AOI.
 *
 * Each round pads the AOI bbox (10 → 25 → 50 → 100 km), fetches only the
 * tiles NOT already seen, and stops at the first round after which at least
 * one line AND one substation have been accumulated — or at the 100 km cap,
 * returning whatever was found (fields null when truly nothing).
 *
 * Error contract: a failed tile is skipped with a warning; the ONLY throwing
 * path is the first ring failing entirely (no fetchable tile, no cached
 * copy), which the section layer maps to status "unavailable".
 *
 * `options.fetchImpl` is the same injectable test seam tiles.ts uses.
 */
export async function fetchPowerFeatures(
  bbox: readonly [number, number, number, number],
  options: TileFetchOptions = {},
): Promise<{ lines: PowerLineFeature[]; substations: SubstationFeature[] }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const acc = newAccumulator();
  const seen = new Set<string>();
  for (const [round, padKm] of GRID_SEARCH_PADS_KM.entries()) {
    const coords = newTileCoords(padBboxKm(bbox, padKm), POWER_DECODE_ZOOM, seen);
    for (const c of coords) seen.add(tileKey(c.x, c.y));
    const results = await mapWithConcurrency(
      coords,
      POWER_TILE_FETCH_CONCURRENCY,
      (c) => loadPowerTile(c.x, c.y, fetchImpl),
    );
    let okCount = 0;
    for (const result of results) {
      if (!result.ok) continue;
      okCount += 1;
      accumulateTile(acc, result.decoded);
    }
    if (round === 0 && okCount === 0 && coords.length > 0) {
      throw new Error(
        `grid: first search ring (${padKm} km pad, ${coords.length} power tiles) ` +
          "failed entirely with no cached fallback",
      );
    }
    if (allLines(acc).length > 0 && allSubstations(acc).length > 0) break;
  }
  return { lines: allLines(acc), substations: allSubstations(acc) };
}

export async function computeGrid(
  aoi: ValidatedAoi,
  options: TileFetchOptions = {},
): Promise<GridResult> {
  const { lines, substations } = await fetchPowerFeatures(aoi.bbox, options);
  return summarizeGridFeatures(aoi.centroid, lines, substations);
}
