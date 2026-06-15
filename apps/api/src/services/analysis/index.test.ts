/**
 * analyzeAoi orchestration tests — synthetic tile fetcher, isolated tmp
 * cache dir. Verifies the plan §3 envelope shape, score wiring, and the
 * hard degrade rules: a thrown or over-budget section yields
 * { status: "unavailable", data: null } while the response still resolves.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { writeArrayBuffer } from "geotiff";
import { analyzeAoi } from "./index";
import { ANALYSIS_VERSION } from "./constants";
import { validateAoi } from "./geometry";
import { TILE_SIZE, squareRingAround } from "./mercator";
import type { TileFetchImpl } from "./tiles";

const TILE_PIXELS = TILE_SIZE * TILE_SIZE;

/** Constant value served per GWA layer name (plausible good-site numbers). */
const LAYER_VALUES: Record<string, number> = {
  cf_iec3: 0.5,
  cf_iec2: 0.45,
  ws_mean_hgt50m: 7.0,
  ws_mean_hgt100m: 8.0,
  ws_mean_hgt150m: 8.7,
  pd_mean_hgt100m: 500,
  elevation: 100,
};

/** Score expected from LAYER_VALUES with the 404-for-power fetcher:
 *  resource (8−4.5)/3 = 1.167 → clamp 1 → 45 · cf clamp((0.5−0.12)/0.26)=1
 *  → 25 · grid raw null (no power features) → 0 · terrain: flat constant
 *  elevation → slope 0° ≤ 5° → normalized 1 → 10 → round(80) = 80. */
const EXPECTED_SCORE = 80;

async function encodeFloat32Tile(value: number): Promise<ArrayBuffer> {
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
    new Float32Array(TILE_PIXELS).fill(value) as unknown as number[],
    metadata as never,
  )) as ArrayBuffer;
}

/** Fetcher serving the constant LAYER_VALUES tile for whatever layer the URL
 *  names. Unknown layer → 404 (exercises the all-NaN path). */
const constantLayerFetcher: TileFetchImpl = async (url) => {
  const match = url.match(/\/gwa4\/([^/]+)\/tiles\//);
  const layerValue = match ? LAYER_VALUES[match[1] as string] : undefined;
  if (layerValue === undefined) return new Response("not found", { status: 404 });
  return new Response(await encodeFloat32Tile(layerValue), { status: 200 });
};

function muppandalPointAoi() {
  return validateAoi({
    type: "Polygon",
    coordinates: [squareRingAround(77.55, 8.26, 5).map(([lon, lat]) => [lon, lat])],
  });
}

let cacheDir = "";
let savedCacheDirEnv: string | undefined;

beforeEach(async () => {
  savedCacheDirEnv = process.env.TILE_CACHE_DIR;
  cacheDir = await mkdtemp(path.join(tmpdir(), "analysis-index-test-"));
  process.env.TILE_CACHE_DIR = cacheDir;
});

afterEach(async () => {
  if (savedCacheDirEnv === undefined) delete process.env.TILE_CACHE_DIR;
  else process.env.TILE_CACHE_DIR = savedCacheDirEnv;
  await rm(cacheDir, { recursive: true, force: true });
});

test("returns the full plan §3 envelope; climate stays flag-off unavailable", async () => {
  // Arrange
  const aoi = muppandalPointAoi();

  // Act
  const response = await analyzeAoi(aoi, { fetchImpl: constantLayerFetcher });

  // Assert — envelope
  expect(response.analysisVersion).toBe(ANALYSIS_VERSION);
  expect(response.aoi).toEqual({
    areaKm2: aoi.areaKm2,
    centroid: aoi.centroid,
    isPointMode: true,
  });
  expect(Object.keys(response.sections).sort()).toEqual([
    "climate",
    "context",
    "grid",
    "resource",
    "validation",
  ]);
  // CLIMATE_SECTION_ENABLED is off in this environment (VERIFIED.md §3).
  expect(response.sections.climate).toEqual({ status: "unavailable", data: null });
  // The injected fetcher 404s every power-tile URL → grid completes with the
  // all-null degraded shape (an "ok" section: the search ran, found nothing).
  expect(response.sections.grid.status).toBe("ok");
  expect(response.sections.grid.data?.nearestSubstation).toBeNull();
  expect(response.sections.grid.data?.nearestLine).toBeNull();
  expect(response.sections.grid.data?.ehvWithin25Km).toBe(false);
  // Validation (live DB) and context (gist/DB loaders degrade internally)
  // depend on the environment — assert shape, not availability.
  expect(["ok", "unavailable"]).toContain(response.sections.validation.status);
  expect(["ok", "unavailable"]).toContain(response.sections.context.status);
  if (response.sections.context.status === "ok") {
    // Flat constant elevation → terrain present with zero slope.
    expect(response.sections.context.data?.terrain?.slopeMeanDeg).toBe(0);
    expect(response.sections.context.data?.sizing.assumptions.length).toBeGreaterThan(0);
  }
});

test("computes resource stats from the constant layers", async () => {
  // Arrange
  const aoi = muppandalPointAoi();

  // Act
  const response = await analyzeAoi(aoi, { fetchImpl: constantLayerFetcher });

  // Assert
  expect(response.sections.resource.status).toBe("ok");
  const data = response.sections.resource.data;
  if (data === null) throw new Error("resource data unexpectedly null");
  expect(data.meanSpeed).toBe(LAYER_VALUES.ws_mean_hgt100m as number);
  expect(data.minSpeed).toBe(data.maxSpeed); // constant field
  expect(data.cfIec3).toBe(LAYER_VALUES.cf_iec3 as number);
  expect(data.cfIec2).toBe(LAYER_VALUES.cf_iec2 as number);
  expect(data.siteClass).toBe("excellent");
});

test("wires resource, grid and terrain into the score; confidence mirrors validation", async () => {
  // Arrange
  const aoi = muppandalPointAoi();

  // Act
  const response = await analyzeAoi(aoi, { fetchImpl: constantLayerFetcher });

  // Assert — deterministic components first.
  const byKey = Object.fromEntries(response.score.components.map((c) => [c.key, c]));
  expect(byKey.resource?.raw).toBe(8);
  expect(byKey.resource?.points).toBeCloseTo(45, 1); // (8−4.5)/3 clamps to 1
  expect(byKey.cf?.raw).toBe(0.5);
  expect(byKey.cf?.points).toBe(25);
  // 404-everywhere power fetcher → no EHV anywhere → conservative 0.
  expect(byKey.grid).toEqual({ key: "grid", weight: 20, raw: null, normalized: 0, points: 0 });
  // Terrain depends on the context section completing (env loaders degrade
  // internally but never throw): flat elevation → slope 0 → full points.
  if (response.sections.context.status === "ok") {
    expect(byKey.terrain).toEqual({
      key: "terrain", weight: 10, raw: 0, normalized: 1, points: 10,
    });
    expect(response.score.value).toBe(EXPECTED_SCORE);
  } else {
    expect(byKey.terrain?.raw).toBeNull();
  }
  // Confidence mirrors the validation badge (or "low" when unavailable) and
  // NEVER feeds the arithmetic (plan §6).
  const expectedConfidence =
    response.sections.validation.status === "ok"
      ? response.sections.validation.data!.confidence
      : "low";
  expect(response.score.confidence).toBe(expectedConfidence);
});

test("degrades resource to unavailable (not a rejection) when every fetch fails", async () => {
  // Arrange
  const aoi = muppandalPointAoi();
  const failingFetcher: TileFetchImpl = async () =>
    new Response("upstream broken", { status: 503 });

  // Act
  const response = await analyzeAoi(aoi, { fetchImpl: failingFetcher });

  // Assert — section degraded, response intact, score conservatively null-fed.
  expect(response.sections.resource).toEqual({ status: "unavailable", data: null });
  expect(response.score.value).toBe(0);
  expect(response.score.components.every((c) => c.raw === null)).toBe(true);
});

test("degrades resource to unavailable when the section exceeds the budget", async () => {
  // Arrange: fetcher slower than the (tiny) test budget.
  const aoi = muppandalPointAoi();
  const slowFetcher: TileFetchImpl = async (url, init) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return constantLayerFetcher(url, init);
  };

  // Act
  const response = await analyzeAoi(aoi, { fetchImpl: slowFetcher, budgetMs: 20 });

  // Assert
  expect(response.sections.resource).toEqual({ status: "unavailable", data: null });
  expect(response.score.value).toBe(0);
});
