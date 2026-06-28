import { featureCollectionFromFile, KmlParseError } from "./kml";
import {
  AOI_MAX_KM2,
  AOI_MIN_KM2,
  POINT_MODE_SQUARE_KM,
  centroidOf,
  closeRing,
  convexHull,
  haversineKm,
  ringAreaKm2,
  squareRingAround,
} from "./geometry";

/**
 * Client-side parsing of a "micro-sited" KML / KMZ — a file whose placemarks are
 * exact turbine POSITIONS (e.g. a 300-turbine layout), not a site boundary.
 *
 * Where `parseAoiFromFile` (kml.ts) collapses a file to one polygon AOI, this
 * keeps every point as an exact turbine and derives a screening FOOTPRINT (the
 * convex hull of the points) so the existing area-based site analysis can run
 * over the project's actual extent. Individual turbines are screened on demand
 * (a 5×5 km point analysis) when the user clicks one on the map.
 */

export interface TurbinePoint {
  /** Stable id within this layout (`t0`, `t1`, …) — used as the map feature id. */
  id: string;
  lon: number;
  lat: number;
  /** Placemark name from the KML, when present. */
  name?: string;
}

export interface TurbineLayout {
  points: TurbinePoint[];
  /** Closed lon/lat ring — the convex-hull footprint used for AOI screening. */
  footprintRing: [number, number][];
  areaKm2: number;
  /** [lon, lat] mean of the turbine positions — delivery destination + label. */
  centroid: [number, number];
}

/** Upper bound on placemarks. Matched to the logistics planner + server cap
 *  (1000) so an uploaded layout's count is never silently clamped downstream. */
const MAX_TURBINES = 1000;

/** Margin added around the points when falling back to a square footprint (km). */
const FOOTPRINT_MARGIN_KM = 0.5;

/** Build one turbine point from a coordinate, validating it is on Earth. */
function makePoint(
  coord: number[],
  name: string | undefined,
  index: number,
): TurbinePoint | null {
  const lon = coord[0];
  const lat = coord[1];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const trimmed = name?.trim();
  return { id: `t${index}`, lon, lat, name: trimmed ? trimmed : undefined };
}

/** Collect every Point / MultiPoint in the collection as a turbine position. */
function collectPoints(fc: GeoJSON.FeatureCollection): TurbinePoint[] {
  const out: TurbinePoint[] = [];
  const push = (coord: number[], name: string | undefined) => {
    const pt = makePoint(coord, name, out.length);
    if (pt) out.push(pt);
  };
  for (const feature of fc.features ?? []) {
    const name = (feature.properties?.name as string | undefined) ?? undefined;
    const g = feature.geometry;
    if (!g) continue;
    if (g.type === "Point") {
      push(g.coordinates, name);
    } else if (g.type === "MultiPoint") {
      for (const c of g.coordinates) push(c, name);
    } else if (g.type === "GeometryCollection") {
      for (const gg of g.geometries) {
        if (gg.type === "Point") push(gg.coordinates, name);
        else if (gg.type === "MultiPoint") for (const c of gg.coordinates) push(c, name);
      }
    }
  }
  return out;
}

/** Full side (km) of a square centred on the centroid that covers all points. */
function coveringSquareSideKm(
  coords: [number, number][],
  centroid: [number, number],
): number {
  let maxDistKm = 0;
  for (const c of coords) {
    const d = haversineKm(centroid, c);
    if (d > maxDistKm) maxDistKm = d;
  }
  // Side = diameter covering the farthest point + margin, floored at the
  // point-mode square so a lone turbine still screens a real area.
  return Math.max(POINT_MODE_SQUARE_KM, 2 * maxDistKm + 2 * FOOTPRINT_MARGIN_KM);
}

/**
 * Footprint AOI for screening: the convex hull when there are ≥3 points and it
 * encloses a usable area; otherwise a square covering all points (handles 1–2
 * points and degenerate/collinear layouts).
 */
function buildFootprint(points: TurbinePoint[]): {
  ring: [number, number][];
  areaKm2: number;
  centroid: [number, number];
} {
  const coords = points.map((p) => [p.lon, p.lat] as [number, number]);
  const centroid = centroidOf(coords);

  if (coords.length >= 3) {
    const hull = convexHull(coords);
    if (hull.length >= 3) {
      const ring = closeRing(hull);
      const areaKm2 = ringAreaKm2(ring);
      if (areaKm2 >= AOI_MIN_KM2) return { ring, areaKm2, centroid };
    }
  }

  const side = coveringSquareSideKm(coords, centroid);
  const ring = squareRingAround(centroid[0], centroid[1], side);
  return { ring, areaKm2: ringAreaKm2(ring), centroid };
}

/**
 * Parse a user-selected .kml / .kmz into a micro-sited turbine layout.
 * Throws KmlParseError when the file holds no points or the footprint is too
 * large for the analysis engine.
 */
export async function parseLayoutFromFile(file: File): Promise<TurbineLayout> {
  const fc = await featureCollectionFromFile(file);
  const points = collectPoints(fc);

  if (points.length === 0) {
    throw new KmlParseError(
      "No turbine points found — a micro-sited layout needs one placemark per turbine. " +
        "If this is a boundary, use “Upload site boundary” instead.",
    );
  }
  if (points.length > MAX_TURBINES) {
    throw new KmlParseError(
      `Too many points (${points.length.toLocaleString()}). The layout limit is ` +
        `${MAX_TURBINES.toLocaleString()} turbines — split the file.`,
    );
  }

  const { ring, areaKm2, centroid } = buildFootprint(points);
  if (areaKm2 > AOI_MAX_KM2) {
    throw new KmlParseError(
      `Layout footprint is too large (${Math.round(areaKm2).toLocaleString()} km²). ` +
        `The maximum is ${AOI_MAX_KM2.toLocaleString()} km² — upload a smaller layout.`,
    );
  }

  return { points, footprintRing: ring, areaKm2, centroid };
}
