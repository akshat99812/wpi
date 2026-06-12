import turfArea from "@turf/area";

/**
 * Client-side AOI geometry helpers. The 5×5 km square construction MUST stay
 * formula-identical to apps/api/src/services/analysis/mercator.ts
 * squareRingAround() — the server fingerprints point-mode squares (axis-
 * aligned, ~25 km²) to set aoi.isPointMode.
 */

export const POINT_MODE_SQUARE_KM = 5;
export const AOI_MAX_KM2 = 2_500;
export const AOI_MIN_KM2 = 1;

/** Axis-aligned square of `sideKm` centered on [lon, lat], closed ring. */
export function squareRingAround(
  lon: number,
  lat: number,
  sideKm: number = POINT_MODE_SQUARE_KM,
): [number, number][] {
  const halfKm = sideKm / 2;
  const dLat = halfKm / 110.574; // km per degree latitude
  const dLon = halfKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
    [lon - dLon, lat - dLat],
  ];
}

/** Geodesic area of a (closed or open) lon/lat ring, in km². */
export function ringAreaKm2(ring: [number, number][]): number {
  if (ring.length < 3) return 0;
  const closed =
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring
      : [...ring, ring[0]];
  if (closed.length < 4) return 0;
  const areaM2 = turfArea({
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [closed] },
  });
  return areaM2 / 1e6;
}

/** Close a ring if its last vertex differs from the first. */
export function closeRing(ring: [number, number][]): [number, number][] {
  if (ring.length === 0) return ring;
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  return fx === lx && fy === ly ? ring : [...ring, [fx, fy]];
}
