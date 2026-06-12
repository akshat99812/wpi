/**
 * Web-mercator tile/pixel math for the analysis pipeline. Pure functions.
 *
 * Mirrors the conventions of build_wind_atlas.py (XYZ tiles, 256 px,
 * EPSG:3857) so values sampled here line up with the baked atlas pixels.
 */

export const TILE_SIZE = 256;

/** Continuous tile-space X for a longitude at zoom n=2^z. */
export function lngToTileX(lng: number, z: number): number {
  return ((lng + 180) / 360) * 2 ** z;
}

/** Continuous tile-space Y for a latitude at zoom n=2^z. */
export function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

/** Longitude of a continuous tile-space X. */
export function tileXToLng(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

/** Latitude of a continuous tile-space Y. */
export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export interface TileCover {
  z: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Tiles covering a lon/lat bbox [W, S, E, N] at zoom z (inclusive ranges). */
export function tileCoverForBbox(
  bbox: readonly [number, number, number, number],
  z: number,
): TileCover {
  const n = 2 ** z;
  const clamp = (v: number) => Math.min(n - 1, Math.max(0, Math.floor(v)));
  return {
    z,
    minX: clamp(lngToTileX(bbox[0], z)),
    maxX: clamp(lngToTileX(bbox[2], z)),
    // bbox N (max lat) maps to the SMALLER tile Y.
    minY: clamp(latToTileY(bbox[3], z)),
    maxY: clamp(latToTileY(bbox[1], z)),
  };
}

export function tileCountOf(cover: TileCover): number {
  return (cover.maxX - cover.minX + 1) * (cover.maxY - cover.minY + 1);
}

/**
 * Lon/lat of a pixel CENTER in a stitched patch whose top-left pixel is the
 * top-left of tile (minTileX, minTileY). col/row are patch-pixel indices.
 */
export function patchPixelCenterLngLat(
  minTileX: number,
  minTileY: number,
  col: number,
  row: number,
  z: number,
): [number, number] {
  const tx = minTileX + (col + 0.5) / TILE_SIZE;
  const ty = minTileY + (row + 0.5) / TILE_SIZE;
  return [tileXToLng(tx, z), tileYToLat(ty, z)];
}

const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle distance in km. */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Axis-aligned square of `sideKm` centered on [lon, lat], as a closed
 * GeoJSON-style ring. Used by point mode (5×5 km) on both client and server.
 */
export function squareRingAround(
  lon: number,
  lat: number,
  sideKm: number,
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
