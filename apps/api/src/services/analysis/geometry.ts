/**
 * Request-geometry validation + canonicalization for POST /api/analyze.
 *
 * Pipeline (order is load-bearing — see plan.md §4 Phase 1 and §2.7):
 *   structure → outer ring only (holes ignored) → closure → vertex cap →
 *   canonical 6-dp rounding → consecutive-duplicate dedupe →
 *   self-intersection → geodesic area caps → India bbox →
 *   centroid / bbox / point-mode fingerprint.
 *
 * Everything downstream of canonicalization (kinks, area, centroid, bbox,
 * point-mode detection, the result-cache key) operates on the ROUNDED
 * coordinates. Plan hard rule: never hash — or analyze — unrounded geometry.
 *
 * Exports:
 *   - `analyzeRequestSchema` / `geoJsonPolygonSchema` — zod boundary validation
 *   - `validateAoi(geometry)` — full pipeline, throws GeometryError with a
 *     machine-readable code on every failure
 *   - `canonicalGeometryString(aoi)` — deterministic ring JSON for cache keys
 */

import { area as turfArea } from "@turf/area";
import { centroid as turfCentroid } from "@turf/centroid";
import { kinks as turfKinks } from "@turf/kinks";
import { z } from "zod";

import {
  AOI_MAX_KM2,
  AOI_MAX_VERTICES,
  AOI_MIN_KM2,
  GEOMETRY_HASH_DECIMALS,
  INDIA_BBOX,
} from "./constants";
import { GeometryError, type GeoJsonPolygon, type ValidatedAoi } from "./types";

// ── Local constants ─────────────────────────────────────────────────────────

/** A closed linear ring needs at least 4 points (triangle + closing repeat). */
const MIN_CLOSED_RING_POINTS = 4;
/** Same bound expressed on the OPEN ring (closing repeat stripped). */
const MIN_OPEN_RING_VERTICES = MIN_CLOSED_RING_POINTS - 1;

const SQUARE_METERS_PER_KM2 = 1_000_000;

/**
 * Point-mode fingerprint: the client converts a map click into
 * squareRingAround(lon, lat, 5) — an axis-aligned 4-corner rectangle whose
 * geodesic area lands within ~1 km² of 25 km² at any Indian latitude.
 */
const POINT_MODE_CORNER_COUNT = 4;
const POINT_MODE_AREA_MIN_KM2 = 24;
const POINT_MODE_AREA_MAX_KM2 = 26;
/** Tolerance (degrees) when grouping lons/lats for axis-alignment checks. */
const AXIS_ALIGNED_TOLERANCE_DEG = 1e-9;

// ── Zod boundary schema ─────────────────────────────────────────────────────

const finiteCoordinate = z
  .number()
  .refine(Number.isFinite, "coordinate must be a finite number");

/** One vertex: exactly [lon, lat], both finite. */
const vertexSchema = z.tuple([finiteCoordinate, finiteCoordinate]);

/** Structural GeoJSON Polygon: ≥1 ring of [lon, lat] vertices. */
export const geoJsonPolygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(vertexSchema)).min(1),
});

/** Request body for POST /api/analyze. */
export const analyzeRequestSchema = z.object({
  geometry: geoJsonPolygonSchema,
});

export type AnalyzeRequestBody = z.infer<typeof analyzeRequestSchema>;

// ── Internal helpers ────────────────────────────────────────────────────────

type Vertex = [number, number];

/** Round one coordinate to GEOMETRY_HASH_DECIMALS, normalizing -0 to 0. */
function roundCoordinate(value: number): number {
  const factor = 10 ** GEOMETRY_HASH_DECIMALS;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

function isSameVertex(a: Vertex, b: Vertex): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Pull the OUTER ring out of the polygon, re-checking structure defensively
 * (validateAoi must be safe even for callers that skipped the zod schema).
 * Holes (rings at index ≥1) are intentionally IGNORED: screening operates on
 * the outer footprint only; a donut AOI is analyzed as its full outer shape.
 */
function extractOuterRing(geometry: GeoJsonPolygon): Vertex[] {
  if (
    geometry === null ||
    typeof geometry !== "object" ||
    geometry.type !== "Polygon" ||
    !Array.isArray(geometry.coordinates)
  ) {
    throw new GeometryError("INVALID_GEOMETRY", "geometry must be a GeoJSON Polygon");
  }
  const outer = geometry.coordinates[0];
  if (!Array.isArray(outer) || outer.length === 0) {
    throw new GeometryError("INVALID_GEOMETRY", "Polygon has no outer ring");
  }
  return outer.map((position) => {
    if (!Array.isArray(position) || position.length < 2) {
      throw new GeometryError("INVALID_GEOMETRY", "every vertex must be a [lon, lat] pair");
    }
    const lon = position[0];
    const lat = position[1];
    if (
      typeof lon !== "number" ||
      typeof lat !== "number" ||
      !Number.isFinite(lon) ||
      !Number.isFinite(lat)
    ) {
      throw new GeometryError("INVALID_GEOMETRY", "vertex coordinates must be finite numbers");
    }
    return [lon, lat];
  });
}

/**
 * Strip the closing repeat if the ring arrived closed; unclosed rings are
 * accepted as-is (auto-close contract — we always re-close after dedupe).
 * Returns a new array; never mutates the input.
 */
function toOpenRing(ring: readonly Vertex[]): Vertex[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 1 && first !== undefined && last !== undefined && isSameVertex(first, last)) {
    return ring.slice(0, -1);
  }
  return [...ring];
}

/** Round every vertex to the canonical decimal grid (new array). */
function canonicalizeRing(openRing: readonly Vertex[]): Vertex[] {
  return openRing.map(([lon, lat]) => [roundCoordinate(lon), roundCoordinate(lat)]);
}

/**
 * Drop consecutive duplicate vertices (zero-length edges — including ones
 * CREATED by canonical rounding), plus any trailing vertex that collapsed
 * onto the first (wrap-around duplicate). Returns a new array.
 */
function dedupeConsecutive(openRing: readonly Vertex[]): Vertex[] {
  const result: Vertex[] = [];
  for (const vertex of openRing) {
    const previous = result[result.length - 1];
    if (previous === undefined || !isSameVertex(previous, vertex)) {
      result.push([vertex[0], vertex[1]]);
    }
  }
  while (result.length > 1) {
    const first = result[0];
    const last = result[result.length - 1];
    if (first === undefined || last === undefined || !isSameVertex(first, last)) break;
    result.pop();
  }
  return result;
}

/** Plain GeoJSON Polygon geometry for the turf calls. */
function asPolygon(closedRing: readonly Vertex[]): { type: "Polygon"; coordinates: number[][][] } {
  return { type: "Polygon", coordinates: [closedRing.map(([lon, lat]) => [lon, lat])] };
}

function assertNotSelfIntersecting(closedRing: readonly Vertex[]): void {
  const kinkPoints = turfKinks(asPolygon(closedRing));
  if (kinkPoints.features.length > 0) {
    throw new GeometryError(
      "SELF_INTERSECTING",
      `polygon outer ring self-intersects (${kinkPoints.features.length} crossing point(s))`,
    );
  }
}

/** Every vertex must sit inside INDIA_BBOX — bbox check only, per plan §2.7. */
function assertInsideIndiaBbox(openRing: readonly Vertex[]): void {
  const [west, south, east, north] = INDIA_BBOX;
  for (const [lon, lat] of openRing) {
    if (lon < west || lon > east || lat < south || lat > north) {
      throw new GeometryError(
        "OUT_OF_INDIA",
        `vertex [${lon}, ${lat}] is outside the India bbox [${INDIA_BBOX.join(", ")}]`,
      );
    }
  }
}

function ringBbox(openRing: readonly Vertex[]): [number, number, number, number] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of openRing) {
    west = Math.min(west, lon);
    south = Math.min(south, lat);
    east = Math.max(east, lon);
    north = Math.max(north, lat);
  }
  return [west, south, east, north];
}

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= AXIS_ALIGNED_TOLERANCE_DEG;
}

/** Distinct values under the axis-alignment tolerance, in first-seen order. */
function distinctWithinTolerance(values: readonly number[]): number[] {
  const distinct: number[] = [];
  for (const value of values) {
    if (!distinct.some((seen) => approxEqual(seen, value))) {
      distinct.push(value);
    }
  }
  return distinct;
}

/**
 * Point-mode fingerprint: exactly 4 distinct corners forming an axis-aligned
 * rectangle (2 distinct lons × 2 distinct lats, all four combinations
 * present) AND geodesic area within 24–26 km². That uniquely matches the
 * client's 5×5 km squareRingAround square.
 *
 * Acceptable ambiguity (documented by design): a user who HAND-DRAWS a
 * perfectly axis-aligned rectangle of ~25 km² is indistinguishable from a
 * point-mode click and gets isPointMode=true. The flag only changes UI
 * presentation — the analysis math is identical for both entry modes — so a
 * rare false positive is harmless.
 */
function detectPointMode(openRing: readonly Vertex[], areaKm2: number): boolean {
  if (openRing.length !== POINT_MODE_CORNER_COUNT) return false;
  if (areaKm2 < POINT_MODE_AREA_MIN_KM2 || areaKm2 > POINT_MODE_AREA_MAX_KM2) return false;
  const lons = distinctWithinTolerance(openRing.map((vertex) => vertex[0]));
  const lats = distinctWithinTolerance(openRing.map((vertex) => vertex[1]));
  if (lons.length !== 2 || lats.length !== 2) return false;
  return lons.every((lon) =>
    lats.every((lat) =>
      openRing.some((vertex) => approxEqual(vertex[0], lon) && approxEqual(vertex[1], lat)),
    ),
  );
}

function computeCentroid(closedRing: readonly Vertex[]): [number, number] {
  const coordinates = turfCentroid(asPolygon(closedRing)).geometry.coordinates;
  const lon = coordinates[0];
  const lat = coordinates[1];
  if (lon === undefined || lat === undefined || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new GeometryError("INVALID_GEOMETRY", "could not compute a finite centroid for the AOI");
  }
  return [lon, lat];
}

// ── Public pipeline ─────────────────────────────────────────────────────────

/**
 * Validate + canonicalize the request polygon into a ValidatedAoi.
 *
 * Throws GeometryError with a machine-readable code (types.ts) on every
 * failure; the route maps those to 400 responses. Never mutates the input.
 *
 * Note on the vertex cap: "distinct vertices" means the closing repeat does
 * not count, and the cap applies to the ring AS SENT (before canonical
 * rounding) so oversized inputs fail fast.
 */
export function validateAoi(geometry: GeoJsonPolygon): ValidatedAoi {
  // 1. Outer ring only; auto-close; ≥4 points after closing.
  const rawOpenRing = toOpenRing(extractOuterRing(geometry));
  if (rawOpenRing.length < MIN_OPEN_RING_VERTICES) {
    throw new GeometryError(
      "INVALID_GEOMETRY",
      `outer ring has fewer than ${MIN_CLOSED_RING_POINTS} points after closing`,
    );
  }

  // 2. Vertex cap (closing repeat excluded).
  if (rawOpenRing.length > AOI_MAX_VERTICES) {
    throw new GeometryError(
      "TOO_MANY_VERTICES",
      `outer ring has ${rawOpenRing.length} vertices (max ${AOI_MAX_VERTICES})`,
    );
  }

  // 3. Canonicalize FIRST — all downstream math uses rounded coordinates.
  // 4a. Dedupe zero-length edges (incl. ones created by rounding).
  const openRing = dedupeConsecutive(canonicalizeRing(rawOpenRing));
  if (openRing.length < MIN_OPEN_RING_VERTICES) {
    throw new GeometryError(
      "INVALID_GEOMETRY",
      `outer ring degenerates to ${openRing.length} distinct point(s) after canonicalization`,
    );
  }
  const firstVertex = openRing[0];
  if (firstVertex === undefined) {
    throw new GeometryError("INVALID_GEOMETRY", "outer ring is empty after canonicalization");
  }
  const closedRing: [number, number][] = [...openRing, [firstVertex[0], firstVertex[1]]];

  // 4b. Self-intersection on the canonical, deduped ring.
  assertNotSelfIntersecting(closedRing);

  // 5. Geodesic area caps.
  const areaKm2 = turfArea(asPolygon(closedRing)) / SQUARE_METERS_PER_KM2;
  if (areaKm2 < AOI_MIN_KM2) {
    throw new GeometryError(
      "AREA_TOO_SMALL",
      `AOI is ${areaKm2.toFixed(3)} km² (min ${AOI_MIN_KM2} km²)`,
    );
  }
  if (areaKm2 > AOI_MAX_KM2) {
    throw new GeometryError(
      "AREA_TOO_LARGE",
      `AOI is ${areaKm2.toFixed(1)} km² (max ${AOI_MAX_KM2} km²)`,
    );
  }

  // 6. India bbox — every vertex (bbox check only, per plan).
  assertInsideIndiaBbox(openRing);

  // 7. Derived fields.
  return {
    ring: closedRing,
    areaKm2,
    centroid: computeCentroid(closedRing),
    bbox: ringBbox(openRing),
    isPointMode: detectPointMode(openRing, areaKm2),
  };
}

/**
 * Deterministic, whitespace-free JSON of the canonical closed ring — the
 * geometry half of the result-cache key (md5 with ANALYSIS_VERSION happens
 * in the cache layer). Determinism holds because the ring is already
 * canonical: 6-dp rounded, deduped, closed, in the vertex order sent. The
 * same drawn geometry (± float jitter below the 6th decimal) always maps to
 * the same string; an equivalent shape traced from a different start vertex
 * is a distinct string — that is only a cache miss, never a correctness bug.
 */
export function canonicalGeometryString(aoi: ValidatedAoi): string {
  return JSON.stringify(aoi.ring);
}
