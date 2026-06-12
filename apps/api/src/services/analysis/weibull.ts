/**
 * Area-mean Weibull A/k over an AOI, read from the local GWA combined-Weibull
 * country COGs (250 m grid, float32, NaN nodata, EPSG:4326 — VERIFIED.md §2).
 *
 * The COGs are fetched once by `scripts/fetch-weibull-cogs.ts` into
 * WEIBULL_COG_DIR. When they are absent or unreadable this module degrades
 * gracefully: `aoiWeibullMeans` resolves null (logged once at first use, not
 * per call) and the resource section ships without a distribution.
 *
 * Point-in-ring note: mask.ts (built in parallel) targets stitched
 * web-mercator LayerPatch grids at ANALYSIS_ZOOM (see types.ts AoiMask) — its
 * API does not fit the COGs' plain lon/lat grid, so a tiny local ray-cast
 * helper is the deliberate DRY tradeoff here.
 */

import { fromFile, type GeoTIFF, type GeoTIFFImage } from "geotiff";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WEIBULL_A_FILE,
  WEIBULL_COG_DIR,
  WEIBULL_K_FILE,
} from "./constants";

// ── Paths (shared with scripts/fetch-weibull-cogs.ts and the tests) ────────

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
/** apps/api root, independent of process.cwd(). */
const API_ROOT = join(MODULE_DIR, "..", "..", "..");

export const WEIBULL_COG_PATHS = {
  a: join(API_ROOT, WEIBULL_COG_DIR, WEIBULL_A_FILE),
  k: join(API_ROOT, WEIBULL_COG_DIR, WEIBULL_K_FILE),
} as const;

// ── Geotransform / pixel-window math (pure, unit-tested) ───────────────────

/** North-up affine geotransform of a COG, read from its image metadata. */
export interface GeoTransform {
  /** Lon of the LEFT edge of pixel column 0 (degrees). */
  originX: number;
  /** Lat of the TOP edge of pixel row 0 (degrees). */
  originY: number;
  /** Degrees per pixel eastward (> 0). */
  pixelWidth: number;
  /** Degrees per pixel southward (< 0 for north-up rasters). */
  pixelHeight: number;
  widthPx: number;
  heightPx: number;
}

/** Half-open pixel window [x0, x1) × [y0, y1) in full-image coordinates. */
export interface PixelWindow {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Defensive cap on a single window read. The 2,500 km² AOI cap is ~40k pixels
 * on the 250 m grid; anything near this limit signals a bbox bug upstream.
 */
export const MAX_WINDOW_PIXELS = 4_000_000;

const TRANSFORM_MATCH_EPSILON_DEG = 1e-9;

/**
 * Pixel window covering a lon/lat bbox [W, S, E, N] at native resolution,
 * expanded outward to whole pixels and clamped to the image. Returns null
 * when the bbox does not overlap the raster; throws when the window would
 * exceed MAX_WINDOW_PIXELS (upstream bbox bug, never a data condition).
 */
export function bboxPixelWindow(
  transform: GeoTransform,
  bbox: readonly [number, number, number, number],
): PixelWindow | null {
  const { originX, originY, pixelWidth, pixelHeight, widthPx, heightPx } =
    transform;
  if (!(pixelWidth > 0) || !(pixelHeight < 0)) {
    throw new Error(
      `bboxPixelWindow: expected north-up transform (pixelWidth>0, pixelHeight<0), got ${pixelWidth}/${pixelHeight}`,
    );
  }
  const [west, south, east, north] = bbox;
  const x0 = Math.max(0, Math.floor((west - originX) / pixelWidth));
  const x1 = Math.min(widthPx, Math.ceil((east - originX) / pixelWidth));
  // North (larger lat) maps to the SMALLER row index because pixelHeight < 0.
  const y0 = Math.max(0, Math.floor((north - originY) / pixelHeight));
  const y1 = Math.min(heightPx, Math.ceil((south - originY) / pixelHeight));
  if (x1 <= x0 || y1 <= y0) return null;

  const pixelCount = (x1 - x0) * (y1 - y0);
  if (pixelCount > MAX_WINDOW_PIXELS) {
    throw new Error(
      `bboxPixelWindow: window of ${pixelCount} px exceeds cap ${MAX_WINDOW_PIXELS} — bbox bug upstream (bbox=${bbox.join(",")})`,
    );
  }
  return { x0, y0, x1, y1 };
}

/** Lon/lat of the CENTER of pixel (col, row) in full-image coordinates. */
export function pixelCenterLngLat(
  transform: GeoTransform,
  col: number,
  row: number,
): [number, number] {
  return [
    transform.originX + (col + 0.5) * transform.pixelWidth,
    transform.originY + (row + 0.5) * transform.pixelHeight,
  ];
}

// ── Point-in-ring (even-odd ray cast) ───────────────────────────────────────

/** True when [lon, lat] falls inside the closed lon/lat ring (even-odd). */
export function isInsideRing(
  lon: number,
  lat: number,
  ring: readonly (readonly [number, number])[],
): boolean {
  let isInside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const crossesRay =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crossesRay) isInside = !isInside;
  }
  return isInside;
}

// ── Gamma (Lanczos g=7) — for the Weibull mean A·Γ(1+1/k) ──────────────────

const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
] as const;

/** Gamma function via the Lanczos approximation (g=7, 9 coefficients). */
export function gammaFn(x: number): number {
  if (x < 0.5) {
    // Reflection formula for the left half-plane.
    return Math.PI / (Math.sin(Math.PI * x) * gammaFn(1 - x));
  }
  const z = x - 1;
  let sum = LANCZOS_COEFFICIENTS[0];
  for (let i = 1; i < LANCZOS_COEFFICIENTS.length; i++) {
    sum += LANCZOS_COEFFICIENTS[i]! / (z + i);
  }
  const t = z + LANCZOS_G + 0.5;
  return Math.sqrt(2 * Math.PI) * t ** (z + 0.5) * Math.exp(-t) * sum;
}

// ── COG handles (opened once, lazily; null = degraded mode) ────────────────

interface OpenCog {
  /** Kept so the OS file descriptor can be closed (tests, graceful shutdown). */
  tiff: GeoTIFF;
  image: GeoTIFFImage;
  transform: GeoTransform;
}

interface WeibullCogs {
  a: OpenCog;
  k: OpenCog;
}

let cogsPromise: Promise<WeibullCogs | null> | null = null;

function loadWeibullCogs(): Promise<WeibullCogs | null> {
  // The cached promise must NEVER be rejected — a rejected singleton would
  // throw on every subsequent call instead of degrading to null.
  cogsPromise ??= openBothCogs().catch((err) => {
    console.error(
      "[analysis/weibull] unexpected COG load failure — Weibull means degrade to null:",
      err,
    );
    return null;
  });
  return cogsPromise;
}

/** Best-effort close of COG file descriptors; logs, never throws. */
async function closeTiffHandles(tiffs: readonly GeoTIFF[]): Promise<void> {
  for (const tiff of tiffs) {
    try {
      const pending = tiff.close(); // false when not file-backed
      if (pending !== false) await pending;
    } catch (err) {
      console.warn("[analysis/weibull] failed to close COG handle:", err);
    }
  }
}

async function openCog(path: string): Promise<OpenCog> {
  const tiff = await fromFile(path);
  try {
    const image = await tiff.getImage(0); // index 0 = full-resolution IFD
    const transform: GeoTransform = {
      originX: image.getOrigin()[0] ?? Number.NaN,
      originY: image.getOrigin()[1] ?? Number.NaN,
      pixelWidth: image.getResolution()[0] ?? Number.NaN,
      pixelHeight: image.getResolution()[1] ?? Number.NaN,
      widthPx: image.getWidth(),
      heightPx: image.getHeight(),
    };
    const fields = [
      transform.originX,
      transform.originY,
      transform.pixelWidth,
      transform.pixelHeight,
    ];
    if (!fields.every(Number.isFinite)) {
      throw new Error(`Weibull COG ${path}: malformed geotransform`);
    }
    return { tiff, image, transform };
  } catch (err) {
    // Never strand the fd when metadata reads fail mid-open.
    await closeTiffHandles([tiff]);
    throw err;
  }
}

const isFulfilled = <T>(
  result: PromiseSettledResult<T>,
): result is PromiseFulfilledResult<T> => result.status === "fulfilled";

/** A and k must share one grid or pixel pairing would silently misalign. */
function isSameGrid(a: GeoTransform, b: GeoTransform): boolean {
  return (
    a.widthPx === b.widthPx &&
    a.heightPx === b.heightPx &&
    Math.abs(a.originX - b.originX) < TRANSFORM_MATCH_EPSILON_DEG &&
    Math.abs(a.originY - b.originY) < TRANSFORM_MATCH_EPSILON_DEG &&
    Math.abs(a.pixelWidth - b.pixelWidth) < TRANSFORM_MATCH_EPSILON_DEG &&
    Math.abs(a.pixelHeight - b.pixelHeight) < TRANSFORM_MATCH_EPSILON_DEG
  );
}

async function openBothCogs(): Promise<WeibullCogs | null> {
  const [hasA, hasK] = await Promise.all([
    Bun.file(WEIBULL_COG_PATHS.a).exists(),
    Bun.file(WEIBULL_COG_PATHS.k).exists(),
  ]);
  if (!hasA || !hasK) {
    console.warn(
      `[analysis/weibull] COG(s) missing under ${join(API_ROOT, WEIBULL_COG_DIR)} ` +
        `(A: ${hasA}, k: ${hasK}) — run \`bun scripts/fetch-weibull-cogs.ts\`. ` +
        `Weibull means degrade to null.`,
    );
    return null;
  }
  // allSettled so a half-open pair can be closed — Promise.all would strand
  // the fd of whichever COG opened successfully when the other one failed.
  const settled = await Promise.allSettled([
    openCog(WEIBULL_COG_PATHS.a),
    openCog(WEIBULL_COG_PATHS.k),
  ]);
  const opened = settled.filter(isFulfilled).map((result) => result.value);
  const failed = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failed !== undefined || opened.length !== 2) {
    await closeTiffHandles(opened.map((cog) => cog.tiff));
    console.error(
      "[analysis/weibull] failed to open COGs — Weibull means degrade to null:",
      failed?.reason,
    );
    return null;
  }
  const [a, k] = opened as [OpenCog, OpenCog];
  if (!isSameGrid(a.transform, k.transform)) {
    await closeTiffHandles([a.tiff, k.tiff]);
    console.error(
      "[analysis/weibull] A and k COGs have mismatched grids — refusing to pair pixels; Weibull means degrade to null.",
    );
    return null;
  }
  return { a, k };
}

/**
 * Close both COG file descriptors (if open) and clear the lazy singleton so
 * the next aoiWeibullMeans call re-opens from disk. For tests (isolation
 * between degraded/live paths) and graceful-shutdown hooks — production
 * request paths never call this.
 */
export async function resetWeibullCogs(): Promise<void> {
  const pending = cogsPromise;
  cogsPromise = null;
  if (pending === null) return;
  // openBothCogs resolves null on every failure path (never rejects), but a
  // defensive catch keeps reset itself unfailable.
  const cogs = await pending.catch((err) => {
    console.warn("[analysis/weibull] reset found a rejected COG load:", err);
    return null;
  });
  if (cogs !== null) {
    await closeTiffHandles([cogs.a.tiff, cogs.k.tiff]);
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

async function readWindowBand(
  image: GeoTIFFImage,
  window: PixelWindow,
): Promise<Float32Array> {
  const rasters = await image.readRasters({
    window: [window.x0, window.y0, window.x1, window.y1],
  });
  const band = rasters[0];
  if (!(band instanceof Float32Array)) {
    throw new Error("Weibull COG read returned a non-float32 band");
  }
  return band;
}

/**
 * Area-mean Weibull A and k over the AOI: native-resolution window read
 * covering `bbox`, then the mean of every finite, positive A/k pixel pair
 * whose center falls inside `ring`.
 *
 * Returns null when the COGs are unavailable (degraded mode), the bbox
 * misses the raster, the read fails, or zero in-ring pixels are valid.
 * Throws only for the MAX_WINDOW_PIXELS cap (upstream bbox bug).
 */
export async function aoiWeibullMeans(
  bbox: readonly [number, number, number, number],
  ring: readonly (readonly [number, number])[],
): Promise<{ A: number; k: number } | null> {
  const cogs = await loadWeibullCogs();
  if (!cogs) return null;

  // Grids verified identical at load time — one window serves both reads.
  const window = bboxPixelWindow(cogs.a.transform, bbox);
  if (!window) return null;

  let aBand: Float32Array;
  let kBand: Float32Array;
  try {
    [aBand, kBand] = await Promise.all([
      readWindowBand(cogs.a.image, window),
      readWindowBand(cogs.k.image, window),
    ]);
  } catch (err) {
    console.error("[analysis/weibull] window read failed — returning null:", err);
    return null;
  }

  const windowWidth = window.x1 - window.x0;
  let sumA = 0;
  let sumK = 0;
  let insideCount = 0;
  for (let row = window.y0; row < window.y1; row++) {
    for (let col = window.x0; col < window.x1; col++) {
      const i = (row - window.y0) * windowWidth + (col - window.x0);
      const aValue = aBand[i] ?? Number.NaN;
      const kValue = kBand[i] ?? Number.NaN;
      const isValidPair =
        Number.isFinite(aValue) && Number.isFinite(kValue) && aValue > 0 && kValue > 0;
      if (!isValidPair) continue;
      const [lon, lat] = pixelCenterLngLat(cogs.a.transform, col, row);
      if (!isInsideRing(lon, lat, ring)) continue;
      sumA += aValue;
      sumK += kValue;
      insideCount += 1;
    }
  }

  if (insideCount === 0) return null;
  return { A: sumA / insideCount, k: sumK / insideCount };
}
