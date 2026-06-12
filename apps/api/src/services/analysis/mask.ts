/**
 * AOI polygon → pixel-center mask over a stitched LayerPatch grid.
 *
 * Marks every patch pixel whose CENTER (web-mercator, ANALYSIS_ZOOM tile
 * space — see mercator.ts) falls inside the AOI's outer ring, via an
 * even-odd ray cast. AOIs are small at z10 (≤ 2,500 km² ≈ 110k pixels), so
 * per-pixel point-in-polygon is plenty fast; a bbox pre-pass keeps the hot
 * loop off the patch pixels that cannot possibly be inside.
 *
 * Winding-agnostic and accepts open or closed rings (the closing repeat is
 * stripped before testing). Never mutates its inputs.
 *
 * NOTE: weibull.ts carries its own tiny ray-cast for the plain lon/lat COG
 * grid — a deliberate, documented DRY tradeoff (its grid model does not fit
 * LayerPatch); keep the two in sync if the predicate ever changes.
 */

import { TILE_SIZE, latToTileY, lngToTileX, tileXToLng, tileYToLat } from "./mercator";
import { GeometryError, type AoiMask, type LayerPatch } from "./types";

/** The grid placement of a patch — everything buildAoiMask needs; callers may
 *  pass a full LayerPatch (structural subset). */
export type PatchFrame = Pick<
  LayerPatch,
  "zoom" | "minTileX" | "minTileY" | "widthPx" | "heightPx"
>;

/** A ring must keep ≥3 distinct vertices once the closing repeat is gone. */
const MIN_DISTINCT_RING_VERTICES = 3;

type LngLat = readonly [number, number];

/**
 * Validate the ring and strip the closing repeat(s). Returns NEW flat
 * coordinate arrays (xs/ys) for the cast loop. Throws GeometryError —
 * the same machine-readable contract the rest of the pipeline uses.
 */
function toOpenRingCoords(ring: readonly LngLat[]): { xs: number[]; ys: number[] } {
  for (const vertex of ring) {
    const lon = vertex?.[0];
    const lat = vertex?.[1];
    if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new GeometryError("INVALID_GEOMETRY", "mask ring vertices must be finite [lon, lat] pairs");
    }
  }
  let end = ring.length;
  const first = ring[0];
  while (end > 1) {
    const last = ring[end - 1];
    if (first === undefined || last === undefined) break;
    if (last[0] !== first[0] || last[1] !== first[1]) break;
    end -= 1;
  }
  if (end < MIN_DISTINCT_RING_VERTICES) {
    throw new GeometryError(
      "INVALID_GEOMETRY",
      `mask ring has ${end} distinct vertex/vertices (need ≥${MIN_DISTINCT_RING_VERTICES})`,
    );
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < end; i++) {
    const vertex = ring[i] as LngLat;
    xs.push(vertex[0]);
    ys.push(vertex[1]);
  }
  return { xs, ys };
}

/** Even-odd ray cast over the flat ring arrays (implicitly closed). */
function isInsideRing(lon: number, lat: number, xs: readonly number[], ys: readonly number[]): boolean {
  let isInside = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    const xi = xs[i] as number;
    const yi = ys[i] as number;
    const xj = xs[j] as number;
    const yj = ys[j] as number;
    const crossesRay = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crossesRay) isInside = !isInside;
  }
  return isInside;
}

/** Inclusive patch-pixel index range whose centers fall within [min, max]
 *  along one axis, clamped to [0, sizePx). Centers sit at
 *  origin + (index + 0.5)/TILE_SIZE in continuous tile space. */
function centerIndexRange(
  minTileCoord: number,
  contMin: number,
  contMax: number,
  sizePx: number,
): { start: number; end: number } {
  const start = Math.max(0, Math.ceil((contMin - minTileCoord) * TILE_SIZE - 0.5));
  const end = Math.min(sizePx - 1, Math.floor((contMax - minTileCoord) * TILE_SIZE - 0.5));
  return { start, end };
}

/**
 * Build the AOI pixel mask for `patch`: inside[row·widthPx + col] = 1 when
 * that pixel's center lies inside `ring`. Pixels outside the patch (or the
 * ring) stay 0; a ring entirely off-patch yields an all-zero mask.
 */
export function buildAoiMask(ring: readonly LngLat[], patch: PatchFrame): AoiMask {
  const { zoom, minTileX, minTileY, widthPx, heightPx } = patch;
  if (
    !Number.isInteger(widthPx) ||
    !Number.isInteger(heightPx) ||
    widthPx <= 0 ||
    heightPx <= 0 ||
    !Number.isFinite(zoom)
  ) {
    throw new Error(
      `buildAoiMask: malformed patch frame (zoom=${zoom}, ${widthPx}×${heightPx}px)`,
    );
  }
  const { xs, ys } = toOpenRingCoords(ring);

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    west = Math.min(west, xs[i] as number);
    east = Math.max(east, xs[i] as number);
    south = Math.min(south, ys[i] as number);
    north = Math.max(north, ys[i] as number);
  }

  // Bbox pre-pass in continuous tile space (north = smaller tile Y).
  const cols = centerIndexRange(minTileX, lngToTileX(west, zoom), lngToTileX(east, zoom), widthPx);
  const rows = centerIndexRange(minTileY, latToTileY(north, zoom), latToTileY(south, zoom), heightPx);

  const inside = new Uint8Array(widthPx * heightPx);
  let insideCount = 0;

  if (cols.start <= cols.end && rows.start <= rows.end) {
    // Lon depends only on the column — compute each once.
    const lonByCol = new Float64Array(cols.end - cols.start + 1);
    for (let col = cols.start; col <= cols.end; col++) {
      lonByCol[col - cols.start] = tileXToLng(minTileX + (col + 0.5) / TILE_SIZE, zoom);
    }
    for (let row = rows.start; row <= rows.end; row++) {
      const lat = tileYToLat(minTileY + (row + 0.5) / TILE_SIZE, zoom);
      const rowOffset = row * widthPx;
      for (let col = cols.start; col <= cols.end; col++) {
        if (isInsideRing(lonByCol[col - cols.start] as number, lat, xs, ys)) {
          inside[rowOffset + col] = 1;
          insideCount += 1;
        }
      }
    }
  }

  return { widthPx, heightPx, inside, insideCount };
}
