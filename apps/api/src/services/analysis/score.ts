/**
 * Wind Site Analysis — Screening Score (plan §2.6).
 *
 * Pure function from section stats to the 0–100 score with full per-component
 * breakdown. No I/O, no clock, no randomness — fully unit-tested in
 * ./score.test.ts.
 *
 * Rounding decision (documented per plan §3):
 * - Per component: `points` = weight · normalized, rounded to 1 decimal place
 *   for display.
 * - Headline `value` = Math.round(Σ UNROUNDED weight · normalized), so the
 *   headline is exact and never drifts from per-component display rounding by
 *   more than the rounding slack. Golden tests recompute value from
 *   `components[]` within ±0.5.
 * - The plan §3 example inputs (7.4 m/s, cf 0.34, 8.2 km, 3.1°) yield value
 *   95 under the v2 India-calibrated breakpoints below (resource 43.5 + cf
 *   21.2 + grid 20 + terrain 10). Under the original v1 breakpoints the same
 *   inputs gave 73; the recalibration (see below) is the only change.
 *
 * Missing data decision: a null (or non-finite) raw input → normalized 0,
 * points 0, raw null. Conservative screening default when a data section is
 * unavailable; the UI shows the zero row transparently.
 *
 * Hard rule (plan §6): validation confidence is passed through verbatim into
 * `score.confidence` and NEVER feeds the arithmetic.
 */

import { SCORE_WEIGHTS } from "./constants";
import type { AnalysisScore, ScoreComponent } from "./types";

/** Raw stats feeding the score; null = that section was unavailable. */
export interface ScoreInputs {
  /** AOI mean wind speed @100 m, m/s (section A). */
  meanSpeed: number | null;
  /** AOI mean IEC-III capacity factor, fraction 0–1 (section A). */
  cfIec3: number | null;
  /** Distance to nearest EHV grid feature, km (section D). */
  nearestEhvKm: number | null;
  /** 90th-percentile terrain slope across the AOI, degrees (section E). */
  slope90thDeg: number | null;
}

export type ScoreConfidence = AnalysisScore["confidence"];

// ── Normalization breakpoints (plan §2.6, v2 — calibrated to India) ────────
//
// v1 anchored "full credit" to offshore-class wind (9 m/s, CF 0.45). Against
// the real India ws@100m distribution (data/analysis/india-ws100-cdf.json)
// that ceiling sits beyond the 99.5th percentile — median 4.5, q90 6.0,
// q95 6.5, q98 7.4, q99 8.2 m/s — so even genuine top sites saturated near
// the middle of the scale. v2 re-anchors the curve to the achievable Indian
// onshore range so the windiest ~2% of sites approach full marks, matching
// the codebase's own SITE_CLASS_BANDS (excellent ≥8, good ≥7, moderate ≥6).

/** Resource: 0 at ≤4.5 m/s (India median), 1 at ≥7.5 m/s (≈q98). */
const RESOURCE_ZERO_SPEED_MS = 4.5;
const RESOURCE_FULL_SPEED_MS = 7.5;

/** CF: 0 at ≤0.12, 1 at ≥0.38 (best Indian onshore IEC-III), linear between. */
const CF_ZERO_FRACTION = 0.12;
const CF_FULL_FRACTION = 0.38;

/** Grid: 1 at ≤10 km from EHV, 0 at ≥50 km, linear between. */
const GRID_FULL_DISTANCE_KM = 10;
const GRID_ZERO_DISTANCE_KM = 50;

/** Terrain: 1 at ≤5° slope (90th percentile), 0 at ≥20°, linear between. */
const TERRAIN_FULL_SLOPE_DEG = 5;
const TERRAIN_ZERO_SLOPE_DEG = 20;

/** Component points display precision: one decimal place. */
const POINTS_DECIMAL_FACTOR = 10;

// ── Pure helpers ────────────────────────────────────────────────────────────

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

const roundToOneDecimal = (x: number): number =>
  Math.round(x * POINTS_DECIMAL_FACTOR) / POINTS_DECIMAL_FACTOR;

const normalizeResource = (meanSpeed: number): number =>
  clamp01(
    (meanSpeed - RESOURCE_ZERO_SPEED_MS) /
      (RESOURCE_FULL_SPEED_MS - RESOURCE_ZERO_SPEED_MS),
  );

const normalizeCf = (cf: number): number =>
  clamp01((cf - CF_ZERO_FRACTION) / (CF_FULL_FRACTION - CF_ZERO_FRACTION));

const normalizeGrid = (distanceKm: number): number =>
  clamp01(
    (GRID_ZERO_DISTANCE_KM - distanceKm) /
      (GRID_ZERO_DISTANCE_KM - GRID_FULL_DISTANCE_KM),
  );

const normalizeTerrain = (slopeDeg: number): number =>
  clamp01(
    (TERRAIN_ZERO_SLOPE_DEG - slopeDeg) /
      (TERRAIN_ZERO_SLOPE_DEG - TERRAIN_FULL_SLOPE_DEG),
  );

/** Build one component row; null/non-finite raw → conservative zero row. */
function buildComponent(
  key: ScoreComponent["key"],
  weight: number,
  raw: number | null,
  normalize: (value: number) => number,
): ScoreComponent {
  if (raw === null || !Number.isFinite(raw)) {
    return { key, weight, raw: null, normalized: 0, points: 0 };
  }
  const normalized = normalize(raw);
  return {
    key,
    weight,
    raw,
    normalized,
    points: roundToOneDecimal(weight * normalized),
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute the Screening Score (plan §2.6): Resource 45 · CF 25 · Grid 20 ·
 * Terrain 10. `confidence` is attached verbatim and never affects `value`
 * or `components`.
 */
export function computeScore(
  inputs: ScoreInputs,
  confidence: ScoreConfidence,
): AnalysisScore {
  const components: ScoreComponent[] = [
    buildComponent(
      "resource",
      SCORE_WEIGHTS.resource,
      inputs.meanSpeed,
      normalizeResource,
    ),
    buildComponent("cf", SCORE_WEIGHTS.cf, inputs.cfIec3, normalizeCf),
    buildComponent("grid", SCORE_WEIGHTS.grid, inputs.nearestEhvKm, normalizeGrid),
    buildComponent(
      "terrain",
      SCORE_WEIGHTS.terrain,
      inputs.slope90thDeg,
      normalizeTerrain,
    ),
  ];

  // Headline from UNROUNDED weight·normalized (components keep `normalized`
  // unrounded, so the exact total is recoverable from the breakdown).
  const exactTotal = components.reduce(
    (sum, component) => sum + component.weight * component.normalized,
    0,
  );

  return { value: Math.round(exactTotal), confidence, components };
}
