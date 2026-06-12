/**
 * tiles.ts tests.
 *
 * Offline tests inject a synthetic fetcher (options.fetchImpl) serving
 * real float32 GeoTIFF bytes encoded with geotiff's writeArrayBuffer, and
 * point TILE_CACHE_DIR at a per-test tmp dir.
 *
 * The LIVE suite at the bottom (skipped when SKIP_LIVE=1) is the Phase-1
 * risk-item proof that geotiff@3 decodes real GWA tiler tiles under Bun,
 * asserted against the exact pixel values pinned in VERIFIED.md.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { writeArrayBuffer } from "geotiff";
import {
  fetchLayerPatch,
  fetchPointValue,
  stitchTiles,
  type TileFetchImpl,
} from "./tiles";
import { ANALYSIS_ZOOM, GWA_LAYERS, GWA_TILER_BASE } from "./constants";
import {
  TILE_SIZE,
  latToTileY,
  lngToTileX,
  squareRingAround,
  tileCoverForBbox,
  tileXToLng,
  tileYToLat,
  type TileCover,
} from "./mercator";
import type { LayerPatch } from "./types";

const TILE_PIXELS = TILE_SIZE * TILE_SIZE;

// ── Helpers ─────────────────────────────────────────────────────────────────

async function encodeFloat32Tile(values: Float32Array): Promise<ArrayBuffer> {
  const metadata = {
    width: TILE_SIZE,
    height: TILE_SIZE,
    BitsPerSample: [32],
    SampleFormat: [3], // IEEE float
    SamplesPerPixel: 1,
    PhotometricInterpretation: 1,
    PlanarConfiguration: 1,
  };
  return (await writeArrayBuffer(
    values as unknown as number[],
    metadata as never,
  )) as ArrayBuffer;
}

function constantTile(value: number): Float32Array {
  return new Float32Array(TILE_PIXELS).fill(value);
}

/** Fetcher serving encodeFloat32Tile(tileFor(x, y)); records every call. */
function makeTileFetcher(tileFor: (x: number, y: number) => Float32Array | null) {
  const calls: { url: string; userAgent: string | undefined }[] = [];
  const fetchImpl: TileFetchImpl = async (url, init) => {
    calls.push({ url, userAgent: init.headers["User-Agent"] });
    const match = url.match(/\/tiles\/(\d+)\/(\d+)\/(\d+)\.tif$/);
    if (!match) return new Response("bad url", { status: 400 });
    const tile = tileFor(Number(match[2]), Number(match[3]));
    if (tile === null) return new Response("not found", { status: 404 });
    return new Response(await encodeFloat32Tile(tile), { status: 200 });
  };
  return { fetchImpl, calls };
}

function patchPixel(patch: LayerPatch, row: number, col: number): number {
  return patch.data[row * patch.widthPx + col] as number;
}

function countFinite(patch: LayerPatch): number {
  return patch.data.reduce((n, v) => (Number.isFinite(v) ? n + 1 : n), 0);
}

function bboxOfRing(ring: [number, number][]): [number, number, number, number] {
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return [
    Math.min(...lons),
    Math.min(...lats),
    Math.max(...lons),
    Math.max(...lats),
  ];
}

// A bbox chosen to span 2 tiles wide × 1 tile tall at z10 (tile x boundary
// at lng 77.6953125 ≈ tile 733; y stays in tile 488).
const TWO_TILE_BBOX: [number, number, number, number] = [77.6, 8.25, 77.8, 8.3];

// ── Cache dir isolation ─────────────────────────────────────────────────────

let cacheDir = "";
let savedCacheDirEnv: string | undefined;

beforeEach(async () => {
  savedCacheDirEnv = process.env.TILE_CACHE_DIR;
  cacheDir = await mkdtemp(path.join(tmpdir(), "gwa-tiles-test-"));
  process.env.TILE_CACHE_DIR = cacheDir;
});

afterEach(async () => {
  if (savedCacheDirEnv === undefined) delete process.env.TILE_CACHE_DIR;
  else process.env.TILE_CACHE_DIR = savedCacheDirEnv;
  await rm(cacheDir, { recursive: true, force: true });
});

// ── stitchTiles (pure) ──────────────────────────────────────────────────────

test("stitchTiles places a single tile verbatim in a 1x1 cover", () => {
  // Arrange
  const cover: TileCover = { z: 10, minX: 5, maxX: 5, minY: 7, maxY: 7 };
  const tile = new Float32Array(TILE_PIXELS).map((_, i) => i);

  // Act
  const patch = stitchTiles(cover, [tile]);

  // Assert
  expect(patch).toMatchObject({
    zoom: 10,
    minTileX: 5,
    minTileY: 7,
    widthPx: TILE_SIZE,
    heightPx: TILE_SIZE,
  });
  expect(patchPixel(patch, 0, 0)).toBe(0);
  expect(patchPixel(patch, 1, 0)).toBe(TILE_SIZE);
  expect(patchPixel(patch, 255, 255)).toBe(TILE_PIXELS - 1);
});

test("stitchTiles stitches a 2x2 cover row-major and leaves a missing tile as NaN", () => {
  // Arrange: row-major order is (x10,y20), (x11,y20), (x10,y21), missing.
  const cover: TileCover = { z: 10, minX: 10, maxX: 11, minY: 20, maxY: 21 };
  const tiles = [constantTile(1), constantTile(2), constantTile(3), null];

  // Act
  const patch = stitchTiles(cover, tiles);

  // Assert
  expect(patch.widthPx).toBe(2 * TILE_SIZE);
  expect(patch.heightPx).toBe(2 * TILE_SIZE);
  expect(patchPixel(patch, 0, 0)).toBe(1); // NW tile
  expect(patchPixel(patch, 0, TILE_SIZE)).toBe(2); // NE tile
  expect(patchPixel(patch, TILE_SIZE, 0)).toBe(3); // SW tile
  expect(Number.isNaN(patchPixel(patch, TILE_SIZE + 10, TILE_SIZE + 10))).toBe(true); // SE missing
});

test("stitchTiles throws when the tile count does not match the cover", () => {
  // Arrange
  const cover: TileCover = { z: 10, minX: 0, maxX: 1, minY: 0, maxY: 0 };

  // Act + Assert
  expect(() => stitchTiles(cover, [constantTile(1)])).toThrow(/needs 2 tiles/);
});

test("stitchTiles does not mutate its input tiles", () => {
  // Arrange
  const cover: TileCover = { z: 10, minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const tile = constantTile(4);
  const copyBefore = Float32Array.from(tile);

  // Act
  const patch = stitchTiles(cover, [tile]);
  patch.data.fill(99);

  // Assert
  expect(tile).toEqual(copyBefore);
});

// ── fetchLayerPatch (injected fetcher) ──────────────────────────────────────

test("fetchLayerPatch fetches, decodes and stitches tiles with correct URLs and User-Agent", async () => {
  // Arrange
  const layer = GWA_LAYERS.ws100;
  const cover = tileCoverForBbox(TWO_TILE_BBOX, ANALYSIS_ZOOM);
  expect((cover.maxX - cover.minX + 1) * (cover.maxY - cover.minY + 1)).toBe(2);
  const { fetchImpl, calls } = makeTileFetcher((x, y) => constantTile(x * 1000 + y));

  // Act
  const patch = await fetchLayerPatch(layer, TWO_TILE_BBOX, { fetchImpl });

  // Assert
  expect(patch.widthPx).toBe(2 * TILE_SIZE);
  expect(patch.heightPx).toBe(TILE_SIZE);
  expect(patchPixel(patch, 10, 10)).toBe(cover.minX * 1000 + cover.minY);
  expect(patchPixel(patch, 10, TILE_SIZE + 10)).toBe((cover.minX + 1) * 1000 + cover.minY);
  expect(calls).toHaveLength(2);
  const expectedUrls = [
    `${GWA_TILER_BASE}/${layer}/tiles/${ANALYSIS_ZOOM}/${cover.minX}/${cover.minY}.tif`,
    `${GWA_TILER_BASE}/${layer}/tiles/${ANALYSIS_ZOOM}/${cover.minX + 1}/${cover.minY}.tif`,
  ];
  expect(calls.map((c) => c.url).sort()).toEqual(expectedUrls.sort());
  expect(calls.every((c) => c.userAgent === "wce-analysis")).toBe(true);
});

test("fetchLayerPatch writes raw tif bytes to {dir}/gwa/{layer}/{z}/{x}/{y}.tif", async () => {
  // Arrange
  const layer = GWA_LAYERS.cfIec3;
  const cover = tileCoverForBbox(TWO_TILE_BBOX, ANALYSIS_ZOOM);
  const { fetchImpl } = makeTileFetcher(() => constantTile(0.5));

  // Act
  await fetchLayerPatch(layer, TWO_TILE_BBOX, { fetchImpl });

  // Assert
  for (const x of [cover.minX, cover.minX + 1]) {
    const filePath = path.join(
      cacheDir,
      "gwa",
      layer,
      String(ANALYSIS_ZOOM),
      String(x),
      `${cover.minY}.tif`,
    );
    const info = await stat(filePath);
    expect(info.size).toBeGreaterThan(TILE_PIXELS * 4); // raw float32 + tif headers
  }
});

test("fetchLayerPatch serves cached tiles without calling the fetcher again", async () => {
  // Arrange: warm the cache, then hand over a fetcher that always fails.
  const layer = GWA_LAYERS.ws100;
  const warm = makeTileFetcher(() => constantTile(7.5));
  await fetchLayerPatch(layer, TWO_TILE_BBOX, { fetchImpl: warm.fetchImpl });
  const cold = makeTileFetcher(() => {
    throw new Error("network down");
  });

  // Act
  const patch = await fetchLayerPatch(layer, TWO_TILE_BBOX, {
    fetchImpl: cold.fetchImpl,
  });

  // Assert
  expect(cold.calls).toHaveLength(0);
  expect(patchPixel(patch, 0, 0)).toBe(7.5);
  expect(countFinite(patch)).toBe(2 * TILE_PIXELS);
});

test("fetchLayerPatch treats upstream 404 as an all-NaN tile, not an error", async () => {
  // Arrange
  const layer = GWA_LAYERS.rix;
  const { fetchImpl } = makeTileFetcher(() => null); // every tile 404s

  // Act
  const patch = await fetchLayerPatch(layer, TWO_TILE_BBOX, { fetchImpl });

  // Assert
  expect(countFinite(patch)).toBe(0);
  // No bytes were cached for 404s.
  await expect(stat(path.join(cacheDir, "gwa", layer))).rejects.toThrow();
});

test("fetchLayerPatch throws a descriptive error on upstream 500 with no cached copy", async () => {
  // Arrange
  const fetchImpl: TileFetchImpl = async () =>
    new Response("boom", { status: 500 });

  // Act + Assert
  await expect(
    fetchLayerPatch(GWA_LAYERS.ws100, TWO_TILE_BBOX, { fetchImpl }),
  ).rejects.toThrow(/HTTP 500.*no cached copy/);
});

test("fetchLayerPatch throws a descriptive error when the fetch itself rejects", async () => {
  // Arrange
  const fetchImpl: TileFetchImpl = async () => {
    throw new Error("socket reset");
  };

  // Act + Assert
  await expect(
    fetchLayerPatch(GWA_LAYERS.ws100, TWO_TILE_BBOX, { fetchImpl }),
  ).rejects.toThrow(/GWA tile fetch failed.*socket reset/);
});

// ── fetchPointValue (injected fetcher) ──────────────────────────────────────

test("fetchPointValue returns the exact pixel containing the coordinate", async () => {
  // Arrange: one marked pixel; query the lon/lat of that pixel's center.
  const layer = GWA_LAYERS.ws100;
  const tileX = 732;
  const tileY = 488;
  const markedCol = 100;
  const markedRow = 50;
  const markedValue = 9.4894;
  const tile = constantTile(1);
  tile[markedRow * TILE_SIZE + markedCol] = markedValue;
  const { fetchImpl } = makeTileFetcher((x, y) =>
    x === tileX && y === tileY ? tile : null,
  );
  const lon = tileXToLng(tileX + (markedCol + 0.5) / TILE_SIZE, ANALYSIS_ZOOM);
  const lat = tileYToLat(tileY + (markedRow + 0.5) / TILE_SIZE, ANALYSIS_ZOOM);

  // Act
  const value = await fetchPointValue(layer, lon, lat, { fetchImpl });

  // Assert
  expect(value).toBeCloseTo(markedValue, 4);
});

test("fetchPointValue returns null for a nodata (NaN) pixel", async () => {
  // Arrange
  const { fetchImpl } = makeTileFetcher(() => constantTile(Number.NaN));

  // Act
  const value = await fetchPointValue(GWA_LAYERS.rix, 77.55, 8.26, { fetchImpl });

  // Assert
  expect(value).toBeNull();
});

test("fetchPointValue returns null when the containing tile is missing (404)", async () => {
  // Arrange
  const { fetchImpl } = makeTileFetcher(() => null);

  // Act
  const value = await fetchPointValue(GWA_LAYERS.ws100, 77.55, 8.26, { fetchImpl });

  // Assert
  expect(value).toBeNull();
});

test("fetchPointValue throws on non-finite coordinates", async () => {
  // Act + Assert
  await expect(fetchPointValue(GWA_LAYERS.ws100, Number.NaN, 8.26)).rejects.toThrow(
    /non-finite coordinates/,
  );
});

// ── LIVE integration (Phase-1 risk item: geotiff@3 vs real GWA tiles in Bun) ─

const liveTest = process.env.SKIP_LIVE === "1" ? test.skip : test;
const LIVE_TIMEOUT_MS = 60_000;

liveTest(
  "LIVE: fetchPointValue at Muppandal matches the VERIFIED.md exact pixel",
  async () => {
    // Act
    const value = await fetchPointValue(GWA_LAYERS.ws100, 77.55, 8.26);

    // Assert: VERIFIED.md §1 pins ws_mean_hgt100m = 9.4894 at this pixel.
    console.log("[live] Muppandal ws_mean_hgt100m point value:", value);
    expect(value).not.toBeNull();
    expect(Math.abs((value as number) - 9.4894)).toBeLessThanOrEqual(0.02);
  },
  LIVE_TIMEOUT_MS,
);

liveTest(
  "LIVE: fetchLayerPatch over the Muppandal 5x5 km bbox yields >=300 finite pixels",
  async () => {
    // Arrange
    const bbox = bboxOfRing(squareRingAround(77.55, 8.26, 5));

    // Act
    const patch = await fetchLayerPatch(GWA_LAYERS.ws100, bbox);

    // Assert
    const finite = countFinite(patch);
    console.log("[live] Muppandal patch:", {
      widthPx: patch.widthPx,
      heightPx: patch.heightPx,
      finitePixels: finite,
    });
    expect(patch.zoom).toBe(ANALYSIS_ZOOM);
    expect(finite).toBeGreaterThanOrEqual(300);
  },
  LIVE_TIMEOUT_MS,
);

liveTest(
  "LIVE: a second point read is served from the disk cache",
  async () => {
    // Arrange: first read warms the tmp cache dir.
    const first = await fetchPointValue(GWA_LAYERS.ws100, 77.55, 8.26);
    const failingFetch: TileFetchImpl = async () => {
      throw new Error("network must not be hit");
    };

    // Act
    const second = await fetchPointValue(GWA_LAYERS.ws100, 77.55, 8.26, {
      fetchImpl: failingFetch,
    });

    // Assert
    expect(second).toBe(first);
  },
  LIVE_TIMEOUT_MS,
);
