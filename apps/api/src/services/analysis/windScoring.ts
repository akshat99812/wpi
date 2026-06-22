/**
 * Wind Site Suitability Score — Methodology PART A.
 *
 * A 0–100 normalised index, resource-weighted 72/28. Two sub-scores:
 *   • resource — anchored to CUF (windCuf, §A1), so the score tracks the
 *     economics: a real ~38% CUF site reads as "strong commercial".
 *   • grid     — line + substation proximity, each saturating with distance
 *     and blended 0.6/0.4 (§A2). A missing distance defaults to 0.15.
 *
 * Pure: no I/O, no clock, no randomness. The score is INDEPENDENT of the
 * financial screening (windFinance.ts) — they share only the CUF (windCuf.ts)
 * and never read each other (methodology rule §5).
 *
 * Worked example (methodology): ws 7.2 m/s, line 4 km, sub 9 km →
 *   cuf 0.434 · res 0.916 · grid 0.947 · score 92 (Excellent).
 */

import { windCuf } from "./windCuf";
import type { AnalysisScore, ScoreComponent, ScoreRating } from "./types";

// ── Resource anchors (§A1): cuf → resource sub-score (0–1) ───────────────────
// Clamp to the first anchor's value below the range, to 1.0 above.
const WIND_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0.28, 0.12],
  [0.34, 0.42],
  [0.38, 0.62],
  [0.4, 0.76],
  [0.42, 0.86],
  [0.44, 0.94],
  [0.46, 1.0],
];

// ── Grid-access breakpoints (§A2) ────────────────────────────────────────────
const GRID_LINE_FULL_KM = 2; // ≤2 km from a line → 1.0
const GRID_LINE_ZERO_KM = 40; // ≥40 km → 0
const GRID_SUB_FULL_KM = 5; // ≤5 km from a substation → 1.0
const GRID_SUB_ZERO_KM = 80; // ≥80 km → 0
const GRID_LINE_BLEND = 0.6;
const GRID_SUB_BLEND = 0.4;
const GRID_MISSING_DEFAULT = 0.15; // a null distance scores this

// ── Composite weights (§A3) on a 100-pt budget ───────────────────────────────
const RESOURCE_WEIGHT = 72;
const GRID_WEIGHT = 28;

// ── Rating bands (§A3) ───────────────────────────────────────────────────────
const RATING_EXCELLENT = 75;
const RATING_GOOD = 60;
const RATING_MODERATE = 45;
const RATING_MARGINAL = 30;

const POINTS_DECIMAL_FACTOR = 10;

// ── Pure helpers ─────────────────────────────────────────────────────────────

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const round1 = (x: number): number =>
  Math.round(x * POINTS_DECIMAL_FACTOR) / POINTS_DECIMAL_FACTOR;

/** Resource sub-score from CUF via the anchor table (§A1). */
function resourceSubScore(cuf: number): number {
  const a = WIND_ANCHORS;
  const first = a[0]!;
  const last = a[a.length - 1]!;
  if (cuf <= first[0]) return first[1];
  if (cuf >= last[0]) return last[1];
  for (let i = 0; i < a.length - 1; i++) {
    const lo = a[i]!;
    const hi = a[i + 1]!;
    if (lo[0] <= cuf && cuf <= hi[0]) {
      return lo[1] + (hi[1] - lo[1]) * ((cuf - lo[0]) / (hi[0] - lo[0]));
    }
  }
  return last[1];
}

/** One saturating proximity term: full at `fullKm`, 0 at `zeroKm` (§A2). */
const proximityTerm = (km: number, fullKm: number, zeroKm: number): number =>
  clamp01(1 - (km - fullKm) / (zeroKm - fullKm));

/** Grid-access sub-score (§A2). A null/non-finite distance → 0.15. */
function gridSubScore(lineKm: number | null, subKm: number | null): number {
  const ln =
    lineKm === null || !Number.isFinite(lineKm)
      ? GRID_MISSING_DEFAULT
      : proximityTerm(lineKm, GRID_LINE_FULL_KM, GRID_LINE_ZERO_KM);
  const sb =
    subKm === null || !Number.isFinite(subKm)
      ? GRID_MISSING_DEFAULT
      : proximityTerm(subKm, GRID_SUB_FULL_KM, GRID_SUB_ZERO_KM);
  return GRID_LINE_BLEND * ln + GRID_SUB_BLEND * sb;
}

function ratingFor(score: number): ScoreRating {
  if (score >= RATING_EXCELLENT) return "Excellent";
  if (score >= RATING_GOOD) return "Good";
  if (score >= RATING_MODERATE) return "Moderate";
  if (score >= RATING_MARGINAL) return "Marginal";
  return "Poor";
}

// ── Public API ───────────────────────────────────────────────────────────────

export type ScoreConfidence = AnalysisScore["confidence"];

/** Part A result: the headline 0–100 score plus the sub-scores and the CUF. */
export interface WindScore {
  score: number; // 0–100
  res: number; // resource sub-score (0–1)
  grid: number; // grid sub-score (0–1)
  cuf: number; // the shared capacity factor used
  rating: ScoreRating;
}

/**
 * Compute the suitability score (§A). Returns null when `ws` is null/non-finite
 * — without a CUF there is no resource term, so there is no score (rule §5:
 * handle null, never coerce to 0 here; the response layer decides the display).
 */
export function windScore(
  ws: number | null,
  lineKm: number | null,
  subKm: number | null,
): WindScore | null {
  const cuf = windCuf(ws);
  if (cuf === null) return null;
  const res = resourceSubScore(cuf);
  const grid = gridSubScore(lineKm, subKm);
  const score = Math.round(RESOURCE_WEIGHT * res + GRID_WEIGHT * grid);
  return { score, res, grid, cuf, rating: ratingFor(score) };
}

/**
 * Map a WindScore into the response-contract AnalysisScore, attaching the mast
 * `confidence` badge verbatim (it NEVER feeds the arithmetic — rule §5). A null
 * WindScore (no CUF) becomes a transparent zero score with null cuf.
 */
export function toAnalysisScore(
  s: WindScore | null,
  confidence: ScoreConfidence,
): AnalysisScore {
  if (s === null) {
    return {
      value: 0,
      rating: "Poor",
      cuf: null,
      confidence,
      components: [
        { key: "resource", weight: RESOURCE_WEIGHT, raw: null, normalized: 0, points: 0 },
        { key: "grid", weight: GRID_WEIGHT, raw: null, normalized: 0, points: 0 },
      ],
    };
  }
  const components: ScoreComponent[] = [
    {
      key: "resource",
      weight: RESOURCE_WEIGHT,
      raw: s.cuf,
      normalized: s.res,
      points: round1(RESOURCE_WEIGHT * s.res),
    },
    {
      key: "grid",
      weight: GRID_WEIGHT,
      raw: s.grid,
      normalized: s.grid,
      points: round1(GRID_WEIGHT * s.grid),
    },
  ];
  return { value: s.score, rating: s.rating, cuf: s.cuf, confidence, components };
}
