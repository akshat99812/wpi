/**
 * India-wide ws@100m percentile context — "this site's mean speed beats X%
 * of India". Backed by a tiny committed artifact of 101 quantiles
 * (q0..q100 of all valid India ws@100m grid cells) built by
 * scripts/build-india-cdf.ts from the baked wind-atlas cursor grid.
 *
 * Loading is lazy, happens once, and NEVER throws: a missing or corrupt
 * artifact logs one warning and indiaPercentileOf returns null thereafter
 * (section A simply omits the stat).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CDF_ARTIFACT_URL = new URL(
  "../../../data/analysis/india-ws100-cdf.json",
  import.meta.url,
);
const EXPECTED_QUANTILE_COUNT = 101;
const MAX_PERCENTILE = 100;

/** undefined = load not attempted yet; null = attempted and unavailable. */
let cachedQuantiles: readonly number[] | null | undefined;

/**
 * Percentile rank of `speed` against a sorted (non-decreasing) quantile
 * array, linearly interpolated between bracketing quantiles. Clamps to 0
 * below the first quantile and 100 above the last. Flat (duplicate) runs
 * resolve to the upper edge of the run — deterministic by construction.
 *
 * Generic over array length: with N quantiles, index i maps to percentile
 * i·(100/(N−1)); the production artifact has 101, so index == percentile.
 */
export function percentileFromCdf(
  quantiles: readonly number[],
  speed: number,
): number {
  if (quantiles.length < 2) {
    throw new Error(
      `percentileFromCdf: need at least 2 quantiles, got ${quantiles.length}`,
    );
  }
  const first = quantiles[0] ?? Number.NaN;
  const last = quantiles[quantiles.length - 1] ?? Number.NaN;
  if (speed <= first) return 0;
  if (speed >= last) return MAX_PERCENTILE;
  const step = MAX_PERCENTILE / (quantiles.length - 1);
  for (let i = 0; i < quantiles.length - 1; i++) {
    const lower = quantiles[i] ?? Number.NaN;
    const upper = quantiles[i + 1] ?? Number.NaN;
    if (speed < upper) {
      // Invariants here: lower <= speed < upper, hence upper > lower.
      return (i + (speed - lower) / (upper - lower)) * step;
    }
  }
  // Unreachable: speed < last guarantees a bracket above.
  return MAX_PERCENTILE;
}

/** Parses + validates the artifact JSON; throws with a precise reason. */
function parseQuantiles(rawJson: string): readonly number[] {
  const parsed: unknown = JSON.parse(rawJson);
  const quantiles = (parsed as { quantiles?: unknown }).quantiles;
  if (!Array.isArray(quantiles) || quantiles.length !== EXPECTED_QUANTILE_COUNT) {
    const got = Array.isArray(quantiles) ? `length ${quantiles.length}` : typeof quantiles;
    throw new Error(`expected ${EXPECTED_QUANTILE_COUNT} quantiles, got ${got}`);
  }
  for (let i = 0; i < quantiles.length; i++) {
    const q: unknown = quantiles[i];
    if (typeof q !== "number" || !Number.isFinite(q)) {
      throw new Error(`quantile[${i}] is not a finite number`);
    }
    if (i > 0 && q < (quantiles[i - 1] as number)) {
      throw new Error(`quantiles are not non-decreasing at index ${i}`);
    }
  }
  return quantiles as number[];
}

function loadQuantilesOnce(): readonly number[] | null {
  if (cachedQuantiles !== undefined) return cachedQuantiles;
  try {
    const rawJson = readFileSync(fileURLToPath(CDF_ARTIFACT_URL), "utf8");
    cachedQuantiles = parseQuantiles(rawJson);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `[indiaCdf] India ws100 CDF artifact unavailable (${reason}); ` +
        "indiaPercentile will be null. Regenerate with: bun run scripts/build-india-cdf.ts",
    );
    cachedQuantiles = null;
  }
  return cachedQuantiles;
}

/**
 * Percentile rank (0–100, unrounded) of a mean speed within the all-India
 * ws@100m distribution, or null when the artifact is absent/unreadable or
 * the input is not finite. Never throws.
 */
export function indiaPercentileOf(speed: number): number | null {
  if (!Number.isFinite(speed)) return null;
  const quantiles = loadQuantilesOnce();
  if (quantiles === null) return null;
  return percentileFromCdf(quantiles, speed);
}
