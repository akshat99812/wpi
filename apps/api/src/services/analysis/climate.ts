/**
 * Climate section (plan §4 Phase 2): one year of hourly 100 m reanalysis wind
 * at the AOI centroid → 16-sector rose + 12 monthly means + 24 diurnal means.
 *
 * LICENSING GATE — the load-bearing part (plan §2.9 + §6, VERIFIED.md §3):
 *   The keyless Open-Meteo tier is non-commercial; this is a commercial Pro
 *   feature. This module therefore only ever targets the COMMERCIAL endpoint
 *   (customer-archive-api.open-meteo.com) and only when BOTH
 *   `CLIMATE_SECTION_ENABLED` is true AND `OPEN_METEO_API_KEY` is present.
 *   Either gate failing throws ClimateDisabledError synchronously, before any
 *   network or disk activity. There is deliberately NO keyless fallback path
 *   anywhere in this file. The integrator maps ClimateDisabledError to
 *   section status "unavailable" silently.
 *
 * Model note (VERIFIED.md §3): no `models=` pin — the default best_match for
 * 100 m wind is empirically ECMWF IFS 9 km; pinning `models=era5` reads ~40%
 * low at terrain-accelerated sites. Output is for direction/seasonality SHAPE
 * only, never resource magnitude.
 *
 * Year is pinned via LAST_COMPLETE_YEAR, never derived from Date.now():
 * determinism (same input → same output forever) and stable cache keys.
 *
 * Disk cache — FOREVER, namespace "climate" (plan: "Disk-cached forever,
 * key = centroid rounded to 0.05° + analysisVersion. No TTL."):
 *   - What is cached: the AGGREGATED ClimateData, not the raw hourly arrays.
 *     Aggregation is deterministic and ANALYSIS_VERSION is in the key, so
 *     caching post-aggregation loses nothing — and the entry is ~1.3 KB
 *     instead of ~600 KB of hourly JSON.
 *   - The upstream fetch is made AT the rounded bucket coordinates, so the
 *     cached value is identical no matter which point inside a 0.05° bucket
 *     populated it first (fetching at the exact centroid would make entries
 *     first-writer-wins nondeterministic; 0.05° ≈ 5.5 km sits below the
 *     ~9 km model grid, so nothing real is lost).
 *   - Keyspace is finite (~400k buckets over the India bbox × ~1.3 KB), so
 *     no size ledger is needed — unlike resultCache.ts, whose geometry
 *     keyspace is unbounded.
 *   - Same cache-root resolution as tiles.ts / resultCache.ts; temp+rename
 *     writes; a corrupt entry is deleted and treated as a miss.
 */

import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { ANALYSIS_VERSION, CLIMATE_SECTION_ENABLED } from "./constants";
import type { ClimateData, ClimateRoseSector } from "./types";

/** Pinned data year (leap → 8784 hours). Bump deliberately, never compute. */
export const LAST_COMPLETE_YEAR = 2024;

/** Commercial endpoint ONLY — the keyless host must never appear here. */
const OPEN_METEO_COMMERCIAL_BASE =
  "https://customer-archive-api.open-meteo.com/v1/archive";
const CLIMATE_FETCH_TIMEOUT_MS = 20_000;
const CLIMATE_TIMEZONE = "Asia/Kolkata"; // monthly/diurnal are local-time
const CLIMATE_USER_AGENT = "wce-analysis";
/** A full non-leap year of hours — the strict lower bound on the response. */
const MIN_HOURS_PER_YEAR = 8_760;

// ── Gating ──────────────────────────────────────────────────────────────────

/** Thrown when the climate section must not run. Integrator contract: map to
 *  section status "unavailable" with NO server-side error log. */
export class ClimateDisabledError extends Error {
  constructor(reason: string) {
    super(`climate section disabled: ${reason}`);
    this.name = "ClimateDisabledError";
  }
}

export interface ClimateGateInput {
  isFlagEnabled: boolean;
  apiKey: string | undefined;
}

/**
 * Both gates, in order, fully synchronous. Returns the API key on success so
 * callers cannot accidentally proceed without one. Defense in depth: even
 * with the flag on, a missing key refuses to run rather than ever reaching
 * a keyless request (plan §6 hard rule).
 */
export function assertClimateEnabled(gate: ClimateGateInput): string {
  if (!gate.isFlagEnabled) {
    throw new ClimateDisabledError("CLIMATE_SECTION_ENABLED is off");
  }
  if (gate.apiKey === undefined || gate.apiKey.length === 0) {
    console.warn(
      "[climate] CLIMATE_SECTION_ENABLED=true but OPEN_METEO_API_KEY is missing — " +
        "refusing to run (the keyless endpoint is non-commercial; plan §6)",
    );
    throw new ClimateDisabledError("OPEN_METEO_API_KEY missing");
  }
  return gate.apiKey;
}

// ── Fetch seam (mirrors tiles.ts TileFetchImpl) ─────────────────────────────

export type ClimateFetchImpl = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;

export interface ClimateOptions {
  fetchImpl?: ClimateFetchImpl;
}

// ── Hourly sample model ─────────────────────────────────────────────────────

/** One hour of the archive response, local time (Asia/Kolkata). */
export interface ClimateHourSample {
  /** "YYYY-MM-DDTHH:MM" — month/hour are parsed positionally from this. */
  time: string;
  /** m/s at 100 m; null = missing upstream. */
  speed: number | null;
  /** Degrees the wind comes FROM (meteorological); null = missing. */
  direction: number | null;
}

// ── Aggregation (pure) ──────────────────────────────────────────────────────

/** 16-wind compass, index 0 = N, clockwise. Exact contract order. */
export const ROSE_SECTOR_NAMES = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;

const SECTOR_WIDTH_DEG = 22.5;
const ROUND_1DP = 10;
const ROUND_2DP = 100;

/**
 * Compass sector for a from-direction: sectors are CENTERED on the compass
 * points (N spans 348.75–11.25). Index = Math.round(dir/22.5) % 16. JS
 * Math.round rounds .5 halves UP, so each sector's upper edge belongs to the
 * NEXT sector: 11.24° → N, 11.25° → NNE, 348.75° → N (16 % 16 wraps to 0).
 * Directions are normalized into [0, 360) first as a defensive guard.
 */
export function sectorIndexFor(direction: number): number {
  const normalized = ((direction % 360) + 360) % 360;
  return Math.round(normalized / SECTOR_WIDTH_DEG) % ROSE_SECTOR_NAMES.length;
}

function round1(value: number): number {
  return Math.round(value * ROUND_1DP) / ROUND_1DP;
}

function round2(value: number): number {
  return Math.round(value * ROUND_2DP) / ROUND_2DP;
}

function isFiniteValue(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/**
 * 16-sector rose. An hour counts only when BOTH speed and direction are
 * finite (a direction without a speed cannot contribute a mean; a speed
 * without a direction cannot be placed). freqPct is relative to the VALID
 * hour count (sums to ~100 regardless of upstream gaps), 1 dp. Per-sector
 * meanSpeed 2 dp; empty sectors report 0/0 (probe convention).
 */
export function aggregateRose(
  samples: readonly ClimateHourSample[],
): ClimateRoseSector[] {
  const counts = new Array<number>(ROSE_SECTOR_NAMES.length).fill(0);
  const speedSums = new Array<number>(ROSE_SECTOR_NAMES.length).fill(0);
  let validCount = 0;
  for (const sample of samples) {
    if (!isFiniteValue(sample.speed) || !isFiniteValue(sample.direction)) continue;
    const idx = sectorIndexFor(sample.direction);
    counts[idx] = (counts[idx] ?? 0) + 1;
    speedSums[idx] = (speedSums[idx] ?? 0) + sample.speed;
    validCount += 1;
  }
  return ROSE_SECTOR_NAMES.map((sector, i) => {
    const count = counts[i] ?? 0;
    const speedSum = speedSums[i] ?? 0;
    return {
      sector,
      freqPct: validCount === 0 ? 0 : round1((100 * count) / validCount),
      meanSpeed: count === 0 ? 0 : round2(speedSum / count),
    };
  });
}

/** Mean speed per slot (month or local hour). Hours with a null/non-finite
 *  speed are skipped; direction is irrelevant here. Empty slot → 0 (mirrors
 *  the empty-sector rose convention; cannot occur on a full healthy year). */
function meansBySlot(
  samples: readonly ClimateHourSample[],
  slotCount: number,
  slotOf: (time: string) => number,
): number[] {
  const sums = new Array<number>(slotCount).fill(0);
  const counts = new Array<number>(slotCount).fill(0);
  for (const sample of samples) {
    if (!isFiniteValue(sample.speed)) continue;
    const slot = slotOf(sample.time);
    if (!Number.isInteger(slot) || slot < 0 || slot >= slotCount) continue;
    sums[slot] = (sums[slot] ?? 0) + sample.speed;
    counts[slot] = (counts[slot] ?? 0) + 1;
  }
  return sums.map((sum, i) => {
    const count = counts[i] ?? 0;
    return count === 0 ? 0 : round2(sum / count);
  });
}

const MONTH_SLOT_COUNT = 12;
const HOUR_SLOT_COUNT = 24;

/** 12 monthly mean speeds (2 dp), Jan..Dec, local time. */
export function aggregateMonthly(
  samples: readonly ClimateHourSample[],
): number[] {
  return meansBySlot(samples, MONTH_SLOT_COUNT, (time) =>
    Number.parseInt(time.slice(5, 7), 10) - 1,
  );
}

/** 24 diurnal mean speeds (2 dp) by local hour 00..23 (Asia/Kolkata). */
export function aggregateDiurnal(
  samples: readonly ClimateHourSample[],
): number[] {
  return meansBySlot(samples, HOUR_SLOT_COUNT, (time) =>
    Number.parseInt(time.slice(11, 13), 10),
  );
}

/** Full ClimateData from one year of hourly samples. Pure. */
export function aggregateClimate(
  samples: readonly ClimateHourSample[],
): ClimateData {
  return {
    rose: aggregateRose(samples),
    monthly: aggregateMonthly(samples),
    diurnal: aggregateDiurnal(samples),
  };
}

// ── Response validation (strict — fail loud on surprises) ──────────────────

/** Local-time stamps as served with `timezone=` set: "2024-01-01T00:00". */
const TIME_PATTERN =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/;

function assertTimeSeries(series: unknown): string[] {
  if (!Array.isArray(series)) {
    throw new Error("open-meteo response: hourly.time is not an array");
  }
  for (let i = 0; i < series.length; i++) {
    const value: unknown = series[i];
    if (typeof value !== "string" || !TIME_PATTERN.test(value)) {
      throw new Error(
        `open-meteo response: hourly.time[${i}] is not a local-time stamp: ${String(value)}`,
      );
    }
  }
  return series as string[];
}

function assertFiniteOrNullSeries(
  name: string,
  series: unknown,
): (number | null)[] {
  if (!Array.isArray(series)) {
    throw new Error(`open-meteo response: hourly.${name} is not an array`);
  }
  for (let i = 0; i < series.length; i++) {
    const value: unknown = series[i];
    if (value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(
        `open-meteo response: hourly.${name}[${i}] is not finite-or-null: ${String(value)}`,
      );
    }
  }
  return series as (number | null)[];
}

/**
 * Strictly validate the archive payload and flatten it into hourly samples.
 * Throws (→ section "unavailable" + server-side error log) on ANY surprise:
 * error envelope, missing arrays, length mismatch, short year, non-finite
 * non-null values, malformed timestamps.
 */
export function parseHourlySamples(payload: unknown): ClimateHourSample[] {
  if (payload === null || typeof payload !== "object") {
    throw new Error("open-meteo response: body is not a JSON object");
  }
  const body = payload as Record<string, unknown>;
  if (body.error) {
    throw new Error(
      `open-meteo response: API error: ${String(body.reason ?? "no reason given")}`,
    );
  }
  if (body.hourly === null || typeof body.hourly !== "object") {
    throw new Error("open-meteo response: missing hourly block");
  }
  const hourly = body.hourly as Record<string, unknown>;
  const times = assertTimeSeries(hourly.time);
  const speeds = assertFiniteOrNullSeries("wind_speed_100m", hourly.wind_speed_100m);
  const directions = assertFiniteOrNullSeries(
    "wind_direction_100m",
    hourly.wind_direction_100m,
  );
  if (times.length !== speeds.length || times.length !== directions.length) {
    throw new Error(
      "open-meteo response: hourly array length mismatch " +
        `(time=${times.length}, speed=${speeds.length}, direction=${directions.length})`,
    );
  }
  if (times.length < MIN_HOURS_PER_YEAR) {
    throw new Error(
      `open-meteo response: ${times.length} hours is short of a full year (≥ ${MIN_HOURS_PER_YEAR})`,
    );
  }
  return times.map((time, i) => ({
    time,
    speed: speeds[i] ?? null,
    direction: directions[i] ?? null,
  }));
}

// ── Disk cache (forever, namespace "climate") ───────────────────────────────

const CACHE_NAMESPACE = "climate";
const PROD_CACHE_DIR = "/var/cache/tiles";
/** apps/api root = three levels up from src/services/analysis/. */
const API_ROOT_DIR = path.resolve(import.meta.dir, "..", "..", "..");
const DEV_CACHE_DIR = path.join(API_ROOT_DIR, ".cache", "tiles");
/** Shard fanout, same convention as resultCache.ts ({key[0:2]}/). */
const SHARD_PREFIX_LENGTH = 2;
/** 0.05° bucket (plan: "centroid rounded to 0.05°"). */
const CACHE_COORD_BUCKET_DEG = 0.05;

/** Resolved per call (not at module load) so tests can point TILE_CACHE_DIR
 *  at a tmp dir after import — same seam as tiles.ts / resultCache.ts. */
function resolveCacheBaseDir(): string {
  const fromEnv = process.env.TILE_CACHE_DIR;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return process.env.NODE_ENV === "production" ? PROD_CACHE_DIR : DEV_CACHE_DIR;
}

/**
 * Snap one coordinate to its 0.05° bucket center, as a stable 2-dp string
 * (every multiple of 0.05 has ≤ 2 decimals, so toFixed(2) erases float
 * noise). Half-up at bucket edges: 77.575 → "77.60". Two points belong to
 * the same bucket iff they are within ±0.025° of the same multiple of 0.05.
 */
export function roundCoordToBucket(value: number): string {
  return (Math.round(value / CACHE_COORD_BUCKET_DEG) * CACHE_COORD_BUCKET_DEG).toFixed(2);
}

/** md5(`${lonBucket}_${latBucket}_${ANALYSIS_VERSION}`) — plan cache rule. */
export function climateCacheKey(centroid: readonly [number, number]): string {
  const [lon, lat] = centroid;
  return createHash("md5")
    .update(`${roundCoordToBucket(lon)}_${roundCoordToBucket(lat)}_${ANALYSIS_VERSION}`)
    .digest("hex");
}

function entryPathFor(key: string): string {
  return path.join(
    resolveCacheBaseDir(),
    CACHE_NAMESPACE,
    key.slice(0, SHARD_PREFIX_LENGTH),
    `${key}.json`,
  );
}

function isRoseSector(value: unknown): value is ClimateRoseSector {
  if (value === null || typeof value !== "object") return false;
  const sector = value as Partial<ClimateRoseSector>;
  return (
    typeof sector.sector === "string" &&
    Number.isFinite(sector.freqPct) &&
    Number.isFinite(sector.meanSpeed)
  );
}

function isNumberArrayOfLength(value: unknown, length: number): boolean {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((entry) => Number.isFinite(entry))
  );
}

/** Shape guard so a foreign/truncated file can't masquerade as ClimateData. */
function isClimateData(value: unknown): value is ClimateData {
  if (value === null || typeof value !== "object") return false;
  const data = value as Partial<ClimateData>;
  return (
    Array.isArray(data.rose) &&
    data.rose.length === ROSE_SECTOR_NAMES.length &&
    data.rose.every(isRoseSector) &&
    isNumberArrayOfLength(data.monthly, MONTH_SLOT_COUNT) &&
    isNumberArrayOfLength(data.diurnal, HOUR_SLOT_COUNT)
  );
}

/** Best-effort delete of a corrupt entry; never throws. */
async function deleteCorruptEntry(entryPath: string, reason: string): Promise<void> {
  console.warn(`[climate-cache] corrupt entry treated as miss (${reason})`, { entryPath });
  try {
    await fs.unlink(entryPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn("[climate-cache] failed to delete corrupt entry", {
        entryPath,
        err: (err as Error).message,
      });
    }
  }
}

/** Cached ClimateData for `key`, or null on miss. Corrupt → delete + miss.
 *  Never throws. */
export async function getCachedClimate(key: string): Promise<ClimateData | null> {
  const entryPath = entryPathFor(key);
  let raw: string;
  try {
    raw = await fs.readFile(entryPath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn("[climate-cache] read failed; treating as miss", {
        entryPath,
        err: (err as Error).message,
      });
    }
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isClimateData(parsed)) {
      await deleteCorruptEntry(entryPath, "shape mismatch");
      return null;
    }
    return parsed;
  } catch (err) {
    await deleteCorruptEntry(entryPath, `unparseable JSON: ${(err as Error).message}`);
    return null;
  }
}

/** Temp-file + rename write (no torn reads). A failed cache write must never
 *  fail the analysis — logged, never thrown. */
export async function putCachedClimate(key: string, data: ClimateData): Promise<void> {
  const entryPath = entryPathFor(key);
  try {
    await fs.mkdir(path.dirname(entryPath), { recursive: true });
    const tmpPath = `${entryPath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmpPath, JSON.stringify(data));
    await fs.rename(tmpPath, entryPath);
  } catch (err) {
    console.warn("[climate-cache] write failed", {
      entryPath,
      err: (err as Error).message,
    });
  }
}

// ── Fetch + orchestration ───────────────────────────────────────────────────

/** One year of hourly speed+direction from the COMMERCIAL archive endpoint.
 *  Errors never include the URL (it carries the API key). */
async function fetchArchiveYear(
  lonBucket: string,
  latBucket: string,
  apiKey: string,
  fetchImpl: ClimateFetchImpl,
): Promise<unknown> {
  const params = new URLSearchParams({
    apikey: apiKey,
    latitude: latBucket,
    longitude: lonBucket,
    start_date: `${LAST_COMPLETE_YEAR}-01-01`,
    end_date: `${LAST_COMPLETE_YEAR}-12-31`,
    hourly: "wind_speed_100m,wind_direction_100m",
    wind_speed_unit: "ms",
    timezone: CLIMATE_TIMEZONE,
  });
  let res: Response;
  try {
    res = await fetchImpl(`${OPEN_METEO_COMMERCIAL_BASE}?${params.toString()}`, {
      headers: { "User-Agent": CLIMATE_USER_AGENT },
      signal: AbortSignal.timeout(CLIMATE_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(
      `open-meteo archive fetch failed at ${latBucket},${lonBucket}: ${(err as Error).message}`,
      { cause: err },
    );
  }
  if (!res.ok) {
    throw new Error(
      `open-meteo archive returned HTTP ${res.status} at ${latBucket},${lonBucket}`,
    );
  }
  try {
    return await res.json();
  } catch (err) {
    throw new Error(
      `open-meteo archive returned unparseable JSON at ${latBucket},${lonBucket}`,
      { cause: err },
    );
  }
}

/**
 * Climate section entry point. Gating runs synchronously FIRST — when the
 * section is off (flag or key), this rejects with ClimateDisabledError
 * before touching cache, disk, or network. Real failures (fetch, shape,
 * empty year) reject with plain Errors for the integrator to log.
 */
export async function computeClimate(
  centroid: readonly [number, number],
  options: ClimateOptions = {},
): Promise<ClimateData> {
  const apiKey = assertClimateEnabled({
    isFlagEnabled: CLIMATE_SECTION_ENABLED,
    apiKey: process.env.OPEN_METEO_API_KEY,
  });
  const [lon, lat] = centroid;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error(`computeClimate: non-finite centroid lon=${lon} lat=${lat}`);
  }

  const key = climateCacheKey(centroid);
  const cached = await getCachedClimate(key);
  if (cached !== null) return cached;

  const lonBucket = roundCoordToBucket(lon);
  const latBucket = roundCoordToBucket(lat);
  const payload = await fetchArchiveYear(
    lonBucket,
    latBucket,
    apiKey,
    options.fetchImpl ?? fetch,
  );
  const samples = parseHourlySamples(payload);
  const data = aggregateClimate(samples);
  if (data.rose.every((sector) => sector.freqPct === 0)) {
    throw new Error(
      `open-meteo response: no valid speed+direction hours at ${latBucket},${lonBucket}`,
    );
  }
  await putCachedClimate(key, data);
  return data;
}
