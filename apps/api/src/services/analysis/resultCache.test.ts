/**
 * resultCache.ts tests — key determinism, round-trip, corrupt-entry
 * self-healing, and fire-and-forget write resilience. Each test runs against
 * an isolated tmp TILE_CACHE_DIR (same seam tiles.test.ts uses).
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { ANALYSIS_VERSION } from "./constants";
import { getCachedResult, putCachedResult, resultCacheKey } from "./resultCache";
import type { AnalysisResponse, ValidatedAoi } from "./types";

const MD5_HEX_LENGTH = 32;

function makeAoi(overrides: Partial<ValidatedAoi> = {}): ValidatedAoi {
  return {
    ring: [
      [77.5, 8.2],
      [77.6, 8.2],
      [77.6, 8.3],
      [77.5, 8.3],
      [77.5, 8.2],
    ],
    areaKm2: 25,
    centroid: [77.55, 8.25],
    bbox: [77.5, 8.2, 77.6, 8.3],
    isPointMode: false,
    ...overrides,
  };
}

function makeResponse(): AnalysisResponse {
  return {
    analysisVersion: ANALYSIS_VERSION,
    aoi: { areaKm2: 25, centroid: [77.55, 8.25], isPointMode: false },
    score: { value: 0, rating: "Poor", cuf: null, confidence: "low", components: [] },
    financials: null,
    irrBand: null,
    sections: {
      resource: { status: "unavailable", data: null },
      climate: { status: "unavailable", data: null },
      validation: { status: "unavailable", data: null },
      grid: { status: "unavailable", data: null },
      context: { status: "unavailable", data: null },
    },
  };
}

let cacheDir = "";
let savedCacheDirEnv: string | undefined;
let savedMaxMbEnv: string | undefined;

beforeEach(async () => {
  savedCacheDirEnv = process.env.TILE_CACHE_DIR;
  savedMaxMbEnv = process.env.RESULT_CACHE_MAX_MB;
  cacheDir = await mkdtemp(path.join(tmpdir(), "analysis-cache-test-"));
  process.env.TILE_CACHE_DIR = cacheDir;
});

afterEach(async () => {
  if (savedCacheDirEnv === undefined) delete process.env.TILE_CACHE_DIR;
  else process.env.TILE_CACHE_DIR = savedCacheDirEnv;
  if (savedMaxMbEnv === undefined) delete process.env.RESULT_CACHE_MAX_MB;
  else process.env.RESULT_CACHE_MAX_MB = savedMaxMbEnv;
  await rm(cacheDir, { recursive: true, force: true });
});

test("resultCacheKey is a stable md5 hex for identical AOIs", () => {
  // Arrange
  const aoiA = makeAoi();
  const aoiB = makeAoi();

  // Act
  const keyA = resultCacheKey(aoiA);
  const keyB = resultCacheKey(aoiB);

  // Assert
  expect(keyA).toBe(keyB);
  expect(keyA).toMatch(new RegExp(`^[0-9a-f]{${MD5_HEX_LENGTH}}$`));
});

test("resultCacheKey changes when the ring changes", () => {
  // Arrange
  const base = makeAoi();
  const shifted = makeAoi({
    ring: base.ring.map(([lon, lat]) => [lon + 0.01, lat] as [number, number]),
  });

  // Act / Assert
  expect(resultCacheKey(shifted)).not.toBe(resultCacheKey(base));
});

test("returns null on a cold miss", async () => {
  // Arrange
  const key = resultCacheKey(makeAoi());

  // Act / Assert
  expect(await getCachedResult(key)).toBeNull();
});

test("round-trips a response through put + get", async () => {
  // Arrange
  const key = resultCacheKey(makeAoi());
  const response = makeResponse();

  // Act
  await putCachedResult(key, response);
  const cached = await getCachedResult(key);

  // Assert
  expect(cached).toEqual(response);
});

test("treats unparseable JSON as a miss and deletes the file", async () => {
  // Arrange: hand-plant garbage where the entry would live.
  const key = resultCacheKey(makeAoi());
  const entryDir = path.join(cacheDir, "analysis", key.slice(0, 2));
  const entryPath = path.join(entryDir, `${key}.json`);
  await mkdir(entryDir, { recursive: true });
  await writeFile(entryPath, "{ not json", "utf8");

  // Act
  const cached = await getCachedResult(key);

  // Assert: miss, and the corrupt file is gone.
  expect(cached).toBeNull();
  expect(await readdir(entryDir)).toEqual([]);
});

test("treats valid JSON with the wrong shape as a miss and deletes it", async () => {
  // Arrange
  const key = resultCacheKey(makeAoi());
  const entryDir = path.join(cacheDir, "analysis", key.slice(0, 2));
  const entryPath = path.join(entryDir, `${key}.json`);
  await mkdir(entryDir, { recursive: true });
  await writeFile(entryPath, JSON.stringify({ hello: "world" }), "utf8");

  // Act
  const cached = await getCachedResult(key);

  // Assert
  expect(cached).toBeNull();
  expect(await readdir(entryDir)).toEqual([]);
});

test("refuses new writes when the namespace size cap is already exceeded", async () => {
  // Arrange — cap (~105 bytes) smaller than any serialized response
  process.env.RESULT_CACHE_MAX_MB = "0.0001";
  const key = resultCacheKey(makeAoi());

  // Act
  await putCachedResult(key, makeResponse());

  // Assert — write skipped, so the entry never lands on disk
  expect(await getCachedResult(key)).toBeNull();
});

test("counts pre-existing entries on disk toward the size cap", async () => {
  // Arrange — cap ≈1049 bytes; pre-plant a 1000-byte foreign entry so the
  // seeding scan pushes the ledger near the cap before the first write.
  process.env.RESULT_CACHE_MAX_MB = "0.001";
  const plantedDir = path.join(cacheDir, "analysis", "aa");
  await mkdir(plantedDir, { recursive: true });
  await writeFile(path.join(plantedDir, "planted.json"), "x".repeat(1000), "utf8");
  const key = resultCacheKey(makeAoi());

  // Act
  await putCachedResult(key, makeResponse());

  // Assert
  expect(await getCachedResult(key)).toBeNull();
});

test("writes normally when the namespace is under the size cap", async () => {
  // Arrange — generous cap
  process.env.RESULT_CACHE_MAX_MB = "10";
  const key = resultCacheKey(makeAoi());
  const response = makeResponse();

  // Act
  await putCachedResult(key, response);

  // Assert
  expect(await getCachedResult(key)).toEqual(response);
});

test("putCachedResult never rejects even when the cache dir is unwritable", async () => {
  // Arrange: point the cache at a path that is a FILE, so mkdir fails.
  const blockerPath = path.join(cacheDir, "blocker");
  await writeFile(blockerPath, "x", "utf8");
  process.env.TILE_CACHE_DIR = blockerPath;

  // Act / Assert: resolves (logged internally), never throws.
  await expect(
    putCachedResult(resultCacheKey(makeAoi()), makeResponse()),
  ).resolves.toBeUndefined();
});
