/**
 * GWA float32 tile fetch + decode + stitched patches, disk-cached.
 *
 * Fetches raw float32 GeoTIFF XYZ tiles from the GWA TiTiler (VERIFIED.md §1:
 * EPSG:3857, 256×256, single band, NaN nodata, maxzoom exactly 10), decodes
 * them with geotiff, and stitches the AOI's tile cover into one row-major
 * Float32Array patch (LayerPatch).
 *
 * Disk cache — INFINITE TTL, active in dev too:
 *   Unlike middleware/tileCache.ts (a deliberate passthrough in dev so local
 *   re-ingestion workflows aren't poisoned by stale entries), this cache runs
 *   in EVERY environment with no TTL: GWA layers are a fixed 2008–2017
 *   climatology, so a cached tile can never go stale. "Serve cache on
 *   upstream failure" therefore needs no special path — a cached tile always
 *   wins before the network is touched.
 *
 *   Layout: {cacheDir}/gwa/{layer}/{z}/{x}/{y}.tif — RAW tif bytes (bytes are
 *   canonical; decode on read is fast). Writes are temp-file + rename so a
 *   concurrent reader never sees a torn body (pattern copied from
 *   middleware/tileCache.ts).
 *
 * Testability: every public function accepts an optional `options.fetchImpl`
 * (same signature as global fetch). Tests inject a synthetic fetcher; prod
 * callers omit it.
 */

import { promises as fs } from "fs";
import path from "path";
import { fromArrayBuffer } from "geotiff";
import {
  ANALYSIS_ZOOM,
  GWA_TILER_BASE,
  GWA_TILE_TIMEOUT_MS,
  type GwaLayer,
} from "./constants";
import type { LayerPatch } from "./types";
import {
  TILE_SIZE,
  latToTileY,
  lngToTileX,
  tileCoverForBbox,
  type TileCover,
} from "./mercator";

/** Max simultaneous upstream tile fetches PER LAYER (simple semaphore, no
 *  deps). Kept low on purpose: 7 layers fetch in parallel per analysis, so
 *  per-request upstream fan-out is 7×this — see also the route-level
 *  MAX_CONCURRENT_ANALYSES gate that bounds requests in flight. */
const TILE_FETCH_CONCURRENCY = 4;
const TILE_PIXELS = TILE_SIZE * TILE_SIZE;
const TILE_USER_AGENT = "wce-analysis";
const CACHE_NAMESPACE = "gwa";
const PROD_CACHE_DIR = "/var/cache/tiles";

/** apps/api root = three levels up from src/services/analysis/. */
const API_ROOT_DIR = path.resolve(import.meta.dir, "..", "..", "..");
const DEV_CACHE_DIR = path.join(API_ROOT_DIR, ".cache", "tiles");

/**
 * Injectable fetch seam for tests. The global `fetch` satisfies it; mocks
 * only need to honor (url, { headers, signal }) → Response.
 */
export type TileFetchImpl = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;

export interface TileFetchOptions {
  fetchImpl?: TileFetchImpl;
}

/** Resolved per call (not at module load) so tests can point TILE_CACHE_DIR
 *  at a tmp dir after import. */
export function resolveTileCacheDir(): string {
  const fromEnv = process.env.TILE_CACHE_DIR;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return process.env.NODE_ENV === "production" ? PROD_CACHE_DIR : DEV_CACHE_DIR;
}

export function tileCachePath(
  baseDir: string,
  layer: GwaLayer,
  z: number,
  x: number,
  y: number,
): string {
  return path.join(baseDir, CACHE_NAMESPACE, layer, String(z), String(x), `${y}.tif`);
}

async function readCachedTileBytes(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn("[gwa-tiles] cache read failed; treating as miss", {
        filePath,
        err: (err as Error).message,
      });
    }
    return null;
  }
}

/** Temp-file + rename so a concurrent reader never sees a torn tif. A failed
 *  cache write must never fail the analysis — log and continue (same
 *  convention as middleware/tileCache.ts). */
async function writeCachedTileBytes(
  filePath: string,
  bytes: Uint8Array,
): Promise<void> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmpPath, bytes);
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    console.warn("[gwa-tiles] cache write failed", {
      filePath,
      err: (err as Error).message,
    });
  }
}

function bufferToArrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/** Decode one GWA tile: single-band 256×256 float32 (VERIFIED.md §1). If the
 *  decoder hands back a different TypedArray, convert — NaN nodata survives
 *  only in float output. */
async function decodeTile(
  bytes: ArrayBuffer,
  context: string,
): Promise<Float32Array> {
  const tiff = await fromArrayBuffer(bytes);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const rasters = (await image.readRasters()) as unknown as ReadonlyArray<
    ArrayLike<number>
  >;
  const band = rasters[0];
  if (width !== TILE_SIZE || height !== TILE_SIZE || !band || band.length !== TILE_PIXELS) {
    throw new Error(
      `GWA tile decode failed for ${context}: expected ${TILE_SIZE}×${TILE_SIZE} ` +
        `single-band raster, got ${width}×${height}, band length ${band?.length ?? "none"}`,
    );
  }
  return band instanceof Float32Array ? band : Float32Array.from(band);
}

/** Fetch one tile from the tiler. 404 → null (GWA serves global coverage, so
 *  a missing tile is rare and means "no data here", not an error). Any other
 *  failure throws — callers reach here only after a cache miss, so there is
 *  no stale copy to fall back on. */
async function fetchTileBytes(
  layer: GwaLayer,
  x: number,
  y: number,
  fetchImpl: TileFetchImpl,
): Promise<ArrayBuffer | null> {
  const url = `${GWA_TILER_BASE}/${layer}/tiles/${ANALYSIS_ZOOM}/${x}/${y}.tif`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { "User-Agent": TILE_USER_AGENT },
      signal: AbortSignal.timeout(GWA_TILE_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(
      `GWA tile fetch failed for ${url} with no cached copy: ${(err as Error).message}`,
      { cause: err },
    );
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `GWA tile fetch for ${url} returned HTTP ${res.status} with no cached copy`,
    );
  }
  return await res.arrayBuffer();
}

/** One tile through the cache: cached bytes always win (infinite TTL); a
 *  corrupt cached file is logged and refetched; freshly fetched bytes are
 *  cached only after they decode cleanly. null = 404 (all-NaN tile). */
export async function loadTile(
  layer: GwaLayer,
  x: number,
  y: number,
  fetchImpl: TileFetchImpl,
): Promise<Float32Array | null> {
  const cachePath = tileCachePath(resolveTileCacheDir(), layer, ANALYSIS_ZOOM, x, y);
  const cached = await readCachedTileBytes(cachePath);
  if (cached) {
    try {
      return await decodeTile(
        bufferToArrayBuffer(cached),
        `${layer}/${ANALYSIS_ZOOM}/${x}/${y} (cached)`,
      );
    } catch (err) {
      console.warn("[gwa-tiles] cached tile corrupt; refetching", {
        cachePath,
        err: (err as Error).message,
      });
    }
  }
  const bytes = await fetchTileBytes(layer, x, y, fetchImpl);
  if (bytes === null) return null;
  const decoded = await decodeTile(bytes, `${layer}/${ANALYSIS_ZOOM}/${x}/${y}`);
  await writeCachedTileBytes(cachePath, new Uint8Array(bytes));
  return decoded;
}

/** Run `fn` over `items` with at most `limit` in flight. Order-preserving. */
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
 * Pure stitcher: tiles (row-major over the cover, null = missing/404) → one
 * LayerPatch. Missing tiles stay NaN. Exported for direct unit testing.
 */
export function stitchTiles(
  cover: TileCover,
  tiles: ReadonlyArray<Float32Array | null>,
): LayerPatch {
  const tilesX = cover.maxX - cover.minX + 1;
  const tilesY = cover.maxY - cover.minY + 1;
  const expectedCount = tilesX * tilesY;
  if (tiles.length !== expectedCount) {
    throw new Error(
      `stitchTiles: cover needs ${expectedCount} tiles (${tilesX}×${tilesY}), got ${tiles.length}`,
    );
  }
  const widthPx = tilesX * TILE_SIZE;
  const heightPx = tilesY * TILE_SIZE;
  const data = new Float32Array(widthPx * heightPx).fill(Number.NaN);
  tiles.forEach((tile, i) => {
    if (tile === null) return;
    if (tile.length !== TILE_PIXELS) {
      throw new Error(
        `stitchTiles: tile ${i} has length ${tile.length}, expected ${TILE_PIXELS}`,
      );
    }
    const tileCol = i % tilesX;
    const tileRow = Math.floor(i / tilesX);
    for (let row = 0; row < TILE_SIZE; row++) {
      const src = tile.subarray(row * TILE_SIZE, (row + 1) * TILE_SIZE);
      const destOffset = (tileRow * TILE_SIZE + row) * widthPx + tileCol * TILE_SIZE;
      data.set(src, destOffset);
    }
  });
  return {
    zoom: cover.z,
    minTileX: cover.minX,
    minTileY: cover.minY,
    widthPx,
    heightPx,
    data,
  };
}

/**
 * Fetch + decode + stitch every tile covering `bbox` ([W, S, E, N]) at
 * ANALYSIS_ZOOM into one LayerPatch. 404 tiles become all-NaN regions; any
 * other upstream failure on an uncached tile rejects (the section layer above
 * maps that to status "unavailable").
 */
export async function fetchLayerPatch(
  layer: GwaLayer,
  bbox: readonly [number, number, number, number],
  options: TileFetchOptions = {},
): Promise<LayerPatch> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cover = tileCoverForBbox(bbox, ANALYSIS_ZOOM);
  const coords: { x: number; y: number }[] = [];
  for (let y = cover.minY; y <= cover.maxY; y++) {
    for (let x = cover.minX; x <= cover.maxX; x++) {
      coords.push({ x, y });
    }
  }
  const tiles = await mapWithConcurrency(coords, TILE_FETCH_CONCURRENCY, (c) =>
    loadTile(layer, c.x, c.y, fetchImpl),
  );
  return stitchTiles(cover, tiles);
}

/**
 * Single-pixel convenience (Phase 2 mast validation): the exact pixel value
 * of `layer` at [lon, lat] through the same tile cache. null when the pixel
 * is nodata (NaN) or its tile is missing (404).
 */
export async function fetchPointValue(
  layer: GwaLayer,
  lon: number,
  lat: number,
  options: TileFetchOptions = {},
): Promise<number | null> {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error(`fetchPointValue: non-finite coordinates lon=${lon} lat=${lat}`);
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxTileIndex = 2 ** ANALYSIS_ZOOM - 1;
  const xCont = lngToTileX(lon, ANALYSIS_ZOOM);
  const yCont = latToTileY(lat, ANALYSIS_ZOOM);
  const tileX = Math.min(maxTileIndex, Math.max(0, Math.floor(xCont)));
  const tileY = Math.min(maxTileIndex, Math.max(0, Math.floor(yCont)));
  const tile = await loadTile(layer, tileX, tileY, fetchImpl);
  if (tile === null) return null;
  const lastPixel = TILE_SIZE - 1;
  const px = Math.min(lastPixel, Math.max(0, Math.floor((xCont - tileX) * TILE_SIZE)));
  const py = Math.min(lastPixel, Math.max(0, Math.floor((yCont - tileY) * TILE_SIZE)));
  const value = tile[py * TILE_SIZE + px];
  return value !== undefined && Number.isFinite(value) ? value : null;
}
