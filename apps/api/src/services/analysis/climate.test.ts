/**
 * climate.ts tests — NO network, ever: CLIMATE_SECTION_ENABLED is off in this
 * environment by design (VERIFIED.md §3), so computeClimate must reject
 * before any fetch. Everything network-shaped is exercised through the pure
 * exports (gate, aggregators, response validation, cache key, disk cache).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { CLIMATE_SECTION_ENABLED } from "./constants";
import {
  ClimateDisabledError,
  ROSE_SECTOR_NAMES,
  aggregateClimate,
  aggregateDiurnal,
  aggregateMonthly,
  aggregateRose,
  assertClimateEnabled,
  climateCacheKey,
  computeClimate,
  getCachedClimate,
  parseHourlySamples,
  putCachedClimate,
  roundCoordToBucket,
  sectorIndexFor,
  type ClimateFetchImpl,
  type ClimateHourSample,
} from "./climate";

const MD5_HEX_LENGTH = 32;
const HOURS_IN_2024 = 8784; // leap year
const DAYS_IN_MONTH_2024 = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

interface HourSpec {
  speed: number | null;
  direction: number | null;
}

/** Build a full synthetic 2024 of hourly samples (8784) without Date math. */
function buildYearSamples(
  make: (hourIndex: number, monthIdx: number, hour: number) => HourSpec,
): ClimateHourSample[] {
  const samples: ClimateHourSample[] = [];
  let hourIndex = 0;
  DAYS_IN_MONTH_2024.forEach((days, monthIdx) => {
    const mm = String(monthIdx + 1).padStart(2, "0");
    for (let day = 1; day <= days; day++) {
      const dd = String(day).padStart(2, "0");
      for (let hour = 0; hour < 24; hour++) {
        const hh = String(hour).padStart(2, "0");
        const spec = make(hourIndex, monthIdx, hour);
        samples.push({
          time: `2024-${mm}-${dd}T${hh}:00`,
          speed: spec.speed,
          direction: spec.direction,
        });
        hourIndex += 1;
      }
    }
  });
  return samples;
}

/** Tiny hand-built sample with a fixed timestamp (aggregator unit cases). */
function sampleAt(
  speed: number | null,
  direction: number | null,
  time = "2024-06-15T12:00",
): ClimateHourSample {
  return { time, speed, direction };
}

/** Open-Meteo-shaped payload from a sample array (parse round-trip tests). */
function payloadFromSamples(samples: readonly ClimateHourSample[]): unknown {
  return {
    latitude: 8.25,
    longitude: 77.55,
    timezone: "Asia/Kolkata",
    hourly: {
      time: samples.map((s) => s.time),
      wind_speed_100m: samples.map((s) => s.speed),
      wind_direction_100m: samples.map((s) => s.direction),
    },
  };
}

// ── Gating ──────────────────────────────────────────────────────────────────

test("environment precondition: the climate flag is off in tests", () => {
  // The whole no-network test strategy rests on this (VERIFIED.md §3).
  expect(CLIMATE_SECTION_ENABLED).toBe(false);
});

test("computeClimate rejects with ClimateDisabledError and never calls fetch when the flag is off", async () => {
  // Arrange
  let fetchCalls = 0;
  const fetchSpy: ClimateFetchImpl = async () => {
    fetchCalls += 1;
    return new Response("{}");
  };

  // Act / Assert
  await expect(
    computeClimate([77.55, 8.26], { fetchImpl: fetchSpy }),
  ).rejects.toBeInstanceOf(ClimateDisabledError);
  expect(fetchCalls).toBe(0);
});

test("assertClimateEnabled throws ClimateDisabledError when the flag is off", () => {
  expect(() =>
    assertClimateEnabled({ isFlagEnabled: false, apiKey: "key-present" }),
  ).toThrow(ClimateDisabledError);
});

test("assertClimateEnabled throws ClimateDisabledError when the flag is on but the key is missing", () => {
  expect(() =>
    assertClimateEnabled({ isFlagEnabled: true, apiKey: undefined }),
  ).toThrow(ClimateDisabledError);
});

test("assertClimateEnabled treats an empty-string key as missing", () => {
  expect(() => assertClimateEnabled({ isFlagEnabled: true, apiKey: "" })).toThrow(
    ClimateDisabledError,
  );
});

test("assertClimateEnabled returns the key when flag on and key present", () => {
  expect(assertClimateEnabled({ isFlagEnabled: true, apiKey: "om-key" })).toBe(
    "om-key",
  );
});

// ── Sector convention ───────────────────────────────────────────────────────

test("ROSE_SECTOR_NAMES is the exact 16-wind compass in order", () => {
  expect([...ROSE_SECTOR_NAMES]).toEqual([
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
  ]);
});

test("sectorIndexFor centers sectors on compass points with half-up edges", () => {
  // N spans 348.75–11.25; JS Math.round(.5) rounds UP, so the upper edge
  // of every sector belongs to the NEXT sector.
  expect(sectorIndexFor(0)).toBe(0); // N center
  expect(sectorIndexFor(11.24)).toBe(0); // just under the edge → N
  expect(sectorIndexFor(11.25)).toBe(1); // edge itself → NNE (round half up)
  expect(sectorIndexFor(348.74)).toBe(15); // NNW side of the wrap
  expect(sectorIndexFor(348.75)).toBe(0); // wraps via % 16 → N
  expect(sectorIndexFor(360)).toBe(0);
  expect(sectorIndexFor(270)).toBe(12); // W center
  expect(sectorIndexFor(281.24)).toBe(12); // W upper interior
  expect(sectorIndexFor(281.25)).toBe(13); // → WNW
});

test("sectorIndexFor normalizes out-of-range directions defensively", () => {
  expect(sectorIndexFor(-90)).toBe(12); // -90 ≡ 270 → W
  expect(sectorIndexFor(630)).toBe(12); // 630 ≡ 270 → W
});

// ── aggregateRose ───────────────────────────────────────────────────────────

test("a full year all from 270° at 8 m/s gives W=100% mean 8 and empty elsewhere", () => {
  // Arrange
  const samples = buildYearSamples(() => ({ speed: 8, direction: 270 }));
  expect(samples.length).toBe(HOURS_IN_2024);

  // Act
  const rose = aggregateRose(samples);

  // Assert
  expect(rose.length).toBe(16);
  const west = rose[12];
  expect(west?.sector).toBe("W");
  expect(west?.freqPct).toBe(100);
  expect(west?.meanSpeed).toBe(8);
  rose.forEach((sector, i) => {
    if (i === 12) return;
    expect(sector.freqPct).toBe(0);
    expect(sector.meanSpeed).toBe(0);
  });
});

test("a two-lobed year splits 50/50 with per-sector means", () => {
  // Arrange: alternate E @ 4 m/s and W @ 8 m/s (bimodal monsoon shape —
  // golden expectations must never assume a single lobe, VERIFIED.md §3).
  const samples = buildYearSamples((i) =>
    i % 2 === 0 ? { speed: 4, direction: 90 } : { speed: 8, direction: 270 },
  );

  // Act
  const rose = aggregateRose(samples);

  // Assert
  expect(rose[4]?.sector).toBe("E");
  expect(rose[4]?.freqPct).toBe(50);
  expect(rose[4]?.meanSpeed).toBe(4);
  expect(rose[12]?.freqPct).toBe(50);
  expect(rose[12]?.meanSpeed).toBe(8);
});

test("freqPct is relative to VALID hours — null-speed and null-direction hours are excluded", () => {
  // Arrange: 2 valid N hours + 1 null-speed + 1 null-direction.
  const samples = [
    sampleAt(5, 0),
    sampleAt(7, 359),
    sampleAt(null, 0),
    sampleAt(6, null),
  ];

  // Act
  const rose = aggregateRose(samples);

  // Assert: denominator is 2, not 4.
  expect(rose[0]?.freqPct).toBe(100);
  expect(rose[0]?.meanSpeed).toBe(6);
});

test("freqPct rounds to 1 dp and meanSpeed to 2 dp", () => {
  // Arrange: 2 N hours (speeds 1, 2, 2 → one sector gets thirds).
  const samples = [sampleAt(1, 0), sampleAt(2, 0), sampleAt(2, 0), sampleAt(9, 90)];

  // Act
  const rose = aggregateRose(samples);

  // Assert: 3/4 = 75%, 1/4 = 25%; mean (1+2+2)/3 = 1.6667 → 1.67.
  expect(rose[0]?.freqPct).toBe(75);
  expect(rose[0]?.meanSpeed).toBe(1.67);
  expect(rose[4]?.freqPct).toBe(25);
  // Thirds case for freqPct 1 dp: 2 of 3 valid hours → 66.7.
  const thirds = aggregateRose([sampleAt(5, 0), sampleAt(5, 0), sampleAt(5, 90)]);
  expect(thirds[0]?.freqPct).toBe(66.7);
  expect(thirds[4]?.freqPct).toBe(33.3);
});

test("an all-invalid input yields an all-zero rose, never NaN", () => {
  const rose = aggregateRose([sampleAt(null, null), sampleAt(Number.NaN, 10)]);
  rose.forEach((sector) => {
    expect(sector.freqPct).toBe(0);
    expect(sector.meanSpeed).toBe(0);
  });
});

// ── aggregateMonthly / aggregateDiurnal ─────────────────────────────────────

test("monthly means follow the month of the local timestamp", () => {
  // Arrange: speed = monthIndex + 1 for every hour of that month.
  const samples = buildYearSamples((_, monthIdx) => ({
    speed: monthIdx + 1,
    direction: 270,
  }));

  // Act / Assert
  expect(aggregateMonthly(samples)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test("monthly means skip null-speed hours and report 0 for an empty month", () => {
  // Arrange: February entirely null; March mixes 4 and null (null skipped).
  const samples = buildYearSamples((i, monthIdx) => {
    if (monthIdx === 1) return { speed: null, direction: 270 };
    if (monthIdx === 2) return { speed: i % 2 === 0 ? 4 : null, direction: 270 };
    return { speed: 6, direction: 270 };
  });

  // Act
  const monthly = aggregateMonthly(samples);

  // Assert
  expect(monthly[0]).toBe(6);
  expect(monthly[1]).toBe(0); // empty slot convention — never NaN
  expect(monthly[2]).toBe(4); // nulls skipped, not averaged as zeros
});

test("monthly means round to 2 dp", () => {
  // Arrange: January hours alternate 1 and 2 with one extra 1 (odd count).
  const samples = [
    sampleAt(1, 0, "2024-01-01T00:00"),
    sampleAt(1, 0, "2024-01-01T01:00"),
    sampleAt(2, 0, "2024-01-01T02:00"),
  ];

  // Act / Assert: (1+1+2)/3 = 1.3333 → 1.33.
  expect(aggregateMonthly(samples)[0]).toBe(1.33);
});

test("diurnal means group by the local hour of the timestamp", () => {
  // Arrange: speed = hour × 0.5 (diurnal ramp).
  const samples = buildYearSamples((_, _m, hour) => ({
    speed: hour * 0.5,
    direction: 180,
  }));

  // Act
  const diurnal = aggregateDiurnal(samples);

  // Assert
  expect(diurnal.length).toBe(24);
  diurnal.forEach((mean, hour) => expect(mean).toBe(hour * 0.5));
});

test("aggregateClimate composes rose(16) + monthly(12) + diurnal(24)", () => {
  // Arrange
  const samples = buildYearSamples(() => ({ speed: 8, direction: 270 }));

  // Act
  const data = aggregateClimate(samples);

  // Assert
  expect(data.rose.length).toBe(16);
  expect(data.monthly.length).toBe(12);
  expect(data.diurnal.length).toBe(24);
  expect(data.rose[12]?.freqPct).toBe(100);
  expect(data.monthly.every((m) => m === 8)).toBe(true);
  expect(data.diurnal.every((h) => h === 8)).toBe(true);
});

// ── parseHourlySamples (strict response validation) ─────────────────────────

test("parses a healthy full-year payload, preserving nulls", () => {
  // Arrange
  const source = buildYearSamples((i) =>
    i === 100 ? { speed: null, direction: null } : { speed: 7.5, direction: 250 },
  );

  // Act
  const samples = parseHourlySamples(payloadFromSamples(source));

  // Assert
  expect(samples.length).toBe(HOURS_IN_2024);
  expect(samples[100]?.speed).toBeNull();
  expect(samples[100]?.direction).toBeNull();
  expect(samples[0]?.speed).toBe(7.5);
  expect(samples[0]?.time).toBe("2024-01-01T00:00");
});

test("throws on the Open-Meteo error envelope, surfacing the reason", () => {
  expect(() =>
    parseHourlySamples({ error: true, reason: "API key invalid" }),
  ).toThrow(/API key invalid/);
});

test("throws when the hourly block is missing", () => {
  expect(() => parseHourlySamples({ latitude: 8.25 })).toThrow(/hourly/);
});

test("throws on hourly array length mismatch", () => {
  // Arrange
  const source = buildYearSamples(() => ({ speed: 7, direction: 200 }));
  const payload = payloadFromSamples(source) as {
    hourly: { wind_speed_100m: (number | null)[] };
  };
  const truncated = {
    ...payload,
    hourly: {
      ...(payload.hourly as object),
      wind_speed_100m: payload.hourly.wind_speed_100m.slice(0, -1),
    },
  };

  // Act / Assert
  expect(() => parseHourlySamples(truncated)).toThrow(/length mismatch/);
});

test("throws when the year is short of 8760 hours", () => {
  const short = buildYearSamples(() => ({ speed: 7, direction: 200 })).slice(0, 8000);
  expect(() => parseHourlySamples(payloadFromSamples(short))).toThrow(/full year/);
});

test("throws on non-finite or non-numeric values", () => {
  // Arrange
  const source = buildYearSamples(() => ({ speed: 7, direction: 200 }));
  const base = payloadFromSamples(source) as {
    hourly: { time: string[]; wind_speed_100m: unknown[]; wind_direction_100m: unknown[] };
  };
  const withString = {
    hourly: { ...base.hourly, wind_speed_100m: ["7.0", ...base.hourly.wind_speed_100m.slice(1)] },
  };
  const withInfinity = {
    hourly: {
      ...base.hourly,
      wind_direction_100m: [Infinity, ...base.hourly.wind_direction_100m.slice(1)],
    },
  };

  // Act / Assert
  expect(() => parseHourlySamples(withString)).toThrow(/finite-or-null/);
  expect(() => parseHourlySamples(withInfinity)).toThrow(/finite-or-null/);
});

test("throws on malformed timestamps", () => {
  const source = buildYearSamples(() => ({ speed: 7, direction: 200 }));
  const base = payloadFromSamples(source) as { hourly: { time: string[] } };
  const badTime = {
    hourly: { ...(base.hourly as object), time: ["2024-13-01T00:00", ...base.hourly.time.slice(1)] },
  };
  expect(() => parseHourlySamples(badTime)).toThrow(/local-time stamp/);
});

test("throws when the body is not an object", () => {
  expect(() => parseHourlySamples("nope")).toThrow(/not a JSON object/);
});

// ── Cache key (0.05° bucketing) ─────────────────────────────────────────────

test("roundCoordToBucket snaps to the nearest 0.05° with stable 2-dp strings", () => {
  // 77.5499 and 77.5501 both sit within ±0.025 of 77.55 → SAME bucket.
  expect(roundCoordToBucket(77.5499)).toBe("77.55");
  expect(roundCoordToBucket(77.5501)).toBe("77.55");
  // Bucket edge is at 77.575: below stays at 77.55, at/above goes to 77.60.
  expect(roundCoordToBucket(77.5749)).toBe("77.55");
  expect(roundCoordToBucket(77.575)).toBe("77.60"); // half-up at the edge
  expect(roundCoordToBucket(77.5751)).toBe("77.60");
  expect(roundCoordToBucket(8.26)).toBe("8.25");
});

test("climateCacheKey is identical for 77.5499 and 77.5501 (same bucket)", () => {
  // Arrange / Act
  const keyA = climateCacheKey([77.5499, 8.26]);
  const keyB = climateCacheKey([77.5501, 8.26]);

  // Assert: stable md5 hex, equal across the bucket.
  expect(keyA).toBe(keyB);
  expect(keyA).toMatch(new RegExp(`^[0-9a-f]{${MD5_HEX_LENGTH}}$`));
  expect(climateCacheKey([77.5499, 8.26])).toBe(keyA); // deterministic
});

test("climateCacheKey differs across bucket edges and between lon/lat", () => {
  expect(climateCacheKey([77.5749, 8.26])).not.toBe(climateCacheKey([77.5751, 8.26]));
  expect(climateCacheKey([77.55, 8.25])).not.toBe(climateCacheKey([8.25, 77.55]));
});

// ── Disk cache (forever, namespace "climate") ───────────────────────────────

describe("disk cache", () => {
  let cacheDir = "";
  let savedCacheDirEnv: string | undefined;

  beforeEach(async () => {
    savedCacheDirEnv = process.env.TILE_CACHE_DIR;
    cacheDir = await mkdtemp(path.join(tmpdir(), "climate-cache-test-"));
    process.env.TILE_CACHE_DIR = cacheDir;
  });

  afterEach(async () => {
    if (savedCacheDirEnv === undefined) delete process.env.TILE_CACHE_DIR;
    else process.env.TILE_CACHE_DIR = savedCacheDirEnv;
    await rm(cacheDir, { recursive: true, force: true });
  });

  function makeData() {
    return aggregateClimate(buildYearSamples(() => ({ speed: 8, direction: 270 })));
  }

  test("cold miss returns null", async () => {
    expect(await getCachedClimate(climateCacheKey([77.55, 8.25]))).toBeNull();
  });

  test("round-trips aggregated ClimateData through put + get", async () => {
    // Arrange
    const key = climateCacheKey([77.55, 8.25]);
    const data = makeData();

    // Act
    await putCachedClimate(key, data);
    const cached = await getCachedClimate(key);

    // Assert
    expect(cached).toEqual(data);
  });

  test("treats unparseable JSON as a miss and deletes the file", async () => {
    // Arrange: hand-plant garbage where the entry would live.
    const key = climateCacheKey([77.55, 8.25]);
    const entryDir = path.join(cacheDir, "climate", key.slice(0, 2));
    await mkdir(entryDir, { recursive: true });
    await writeFile(path.join(entryDir, `${key}.json`), "{ not json", "utf8");

    // Act
    const cached = await getCachedClimate(key);

    // Assert: miss, and the corrupt file is gone.
    expect(cached).toBeNull();
    expect(await readdir(entryDir)).toEqual([]);
  });

  test("treats valid JSON with the wrong shape as a miss and deletes it", async () => {
    // Arrange
    const key = climateCacheKey([77.55, 8.25]);
    const entryDir = path.join(cacheDir, "climate", key.slice(0, 2));
    await mkdir(entryDir, { recursive: true });
    await writeFile(
      path.join(entryDir, `${key}.json`),
      JSON.stringify({ rose: [], monthly: [], diurnal: [] }),
      "utf8",
    );

    // Act
    const cached = await getCachedClimate(key);

    // Assert
    expect(cached).toBeNull();
    expect(await readdir(entryDir)).toEqual([]);
  });

  test("putCachedClimate never rejects even when the cache dir is unwritable", async () => {
    // Arrange: point the cache at a path that is a FILE, so mkdir fails.
    const blockerPath = path.join(cacheDir, "blocker");
    await writeFile(blockerPath, "x", "utf8");
    process.env.TILE_CACHE_DIR = blockerPath;

    // Act / Assert: resolves (logged internally), never throws.
    await expect(
      putCachedClimate(climateCacheKey([77.55, 8.25]), makeData()),
    ).resolves.toBeUndefined();
  });
});
