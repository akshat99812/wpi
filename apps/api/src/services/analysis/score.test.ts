/**
 * Unit tests for the Screening Score (plan §2.6 normalizations).
 *
 * Covers every breakpoint of every normalization (below floor, at floor,
 * mid, at ceiling, above ceiling), null/non-finite inputs, the plan §3
 * example reproduction, confidence pass-through independence (plan §6 hard
 * rule), points-sum-vs-value consistency, and input immutability.
 */

import { describe, expect, test } from "bun:test";

import { SCORE_WEIGHTS } from "./constants";
import { computeScore } from "./score";
import type { ScoreConfidence, ScoreInputs } from "./score";
import type { AnalysisScore, ScoreComponent } from "./types";

/** Plan §3 example inputs — also a convenient "all sections present" base. */
const BASE_INPUTS: ScoreInputs = {
  meanSpeed: 7.4,
  cfIec3: 0.34,
  nearestEhvKm: 8.2,
  slope90thDeg: 3.1,
};

const FLOAT_PRECISION_DIGITS = 12;

function scoreWith(overrides: Partial<ScoreInputs>): AnalysisScore {
  return computeScore({ ...BASE_INPUTS, ...overrides }, "high");
}

function componentByKey(
  score: AnalysisScore,
  key: ScoreComponent["key"],
): ScoreComponent {
  const component = score.components.find((c) => c.key === key);
  if (!component) throw new Error(`missing score component: ${key}`);
  return component;
}

// ── Resource normalization: clamp((meanSpeed − 4.5) / 3) ───────────────────

describe("resource normalization breakpoints", () => {
  const cases: { label: string; meanSpeed: number; normalized: number }[] = [
    { label: "below floor (4 m/s)", meanSpeed: 4, normalized: 0 },
    { label: "at floor (4.5 m/s)", meanSpeed: 4.5, normalized: 0 },
    { label: "midpoint (6 m/s)", meanSpeed: 6, normalized: 0.5 },
    { label: "at ceiling (7.5 m/s)", meanSpeed: 7.5, normalized: 1 },
    { label: "above ceiling (9 m/s)", meanSpeed: 9, normalized: 1 },
  ];

  for (const { label, meanSpeed, normalized } of cases) {
    test(`normalizes mean speed ${label} to ${normalized}`, () => {
      // Arrange + Act
      const resource = componentByKey(scoreWith({ meanSpeed }), "resource");

      // Assert
      expect(resource.normalized).toBeCloseTo(normalized, FLOAT_PRECISION_DIGITS);
      expect(resource.raw).toBe(meanSpeed);
      expect(resource.points).toBeCloseTo(
        Math.round(SCORE_WEIGHTS.resource * normalized * 10) / 10,
        FLOAT_PRECISION_DIGITS,
      );
    });
  }
});

// ── CF normalization: clamp((cfIec3 − 0.12) / 0.26) ────────────────────────

describe("cf normalization breakpoints", () => {
  const cases: { label: string; cfIec3: number; normalized: number }[] = [
    { label: "below floor (0.10)", cfIec3: 0.1, normalized: 0 },
    { label: "at floor (0.12)", cfIec3: 0.12, normalized: 0 },
    { label: "midpoint (0.25)", cfIec3: 0.25, normalized: 0.5 },
    { label: "at ceiling (0.38)", cfIec3: 0.38, normalized: 1 },
    { label: "above ceiling (0.50)", cfIec3: 0.5, normalized: 1 },
  ];

  for (const { label, cfIec3, normalized } of cases) {
    test(`normalizes capacity factor ${label} to ${normalized}`, () => {
      // Arrange + Act
      const cf = componentByKey(scoreWith({ cfIec3 }), "cf");

      // Assert
      expect(cf.normalized).toBeCloseTo(normalized, FLOAT_PRECISION_DIGITS);
      expect(cf.raw).toBe(cfIec3);
      expect(cf.points).toBeCloseTo(
        Math.round(SCORE_WEIGHTS.cf * normalized * 10) / 10,
        FLOAT_PRECISION_DIGITS,
      );
    });
  }
});

// ── Grid normalization: 1 at ≤10 km, clamp((50 − d) / 40), 0 at ≥50 km ─────

describe("grid normalization breakpoints", () => {
  const cases: { label: string; nearestEhvKm: number; normalized: number }[] = [
    { label: "closer than full-credit distance (5 km)", nearestEhvKm: 5, normalized: 1 },
    { label: "at full-credit distance (10 km)", nearestEhvKm: 10, normalized: 1 },
    { label: "midpoint (30 km)", nearestEhvKm: 30, normalized: 0.5 },
    { label: "at zero-credit distance (50 km)", nearestEhvKm: 50, normalized: 0 },
    { label: "beyond zero-credit distance (80 km)", nearestEhvKm: 80, normalized: 0 },
  ];

  for (const { label, nearestEhvKm, normalized } of cases) {
    test(`normalizes EHV distance ${label} to ${normalized}`, () => {
      // Arrange + Act
      const grid = componentByKey(scoreWith({ nearestEhvKm }), "grid");

      // Assert
      expect(grid.normalized).toBeCloseTo(normalized, FLOAT_PRECISION_DIGITS);
      expect(grid.raw).toBe(nearestEhvKm);
      expect(grid.points).toBeCloseTo(
        Math.round(SCORE_WEIGHTS.grid * normalized * 10) / 10,
        FLOAT_PRECISION_DIGITS,
      );
    });
  }
});

// ── Terrain normalization: 1 at ≤5°, clamp((20 − s) / 15), 0 at ≥20° ───────

describe("terrain normalization breakpoints", () => {
  const cases: { label: string; slope90thDeg: number; normalized: number }[] = [
    { label: "below full-credit slope (2°)", slope90thDeg: 2, normalized: 1 },
    { label: "at full-credit slope (5°)", slope90thDeg: 5, normalized: 1 },
    { label: "midpoint (12.5°)", slope90thDeg: 12.5, normalized: 0.5 },
    { label: "at zero-credit slope (20°)", slope90thDeg: 20, normalized: 0 },
    { label: "above zero-credit slope (25°)", slope90thDeg: 25, normalized: 0 },
  ];

  for (const { label, slope90thDeg, normalized } of cases) {
    test(`normalizes slope ${label} to ${normalized}`, () => {
      // Arrange + Act
      const terrain = componentByKey(scoreWith({ slope90thDeg }), "terrain");

      // Assert
      expect(terrain.normalized).toBeCloseTo(normalized, FLOAT_PRECISION_DIGITS);
      expect(terrain.raw).toBe(slope90thDeg);
      expect(terrain.points).toBeCloseTo(
        Math.round(SCORE_WEIGHTS.terrain * normalized * 10) / 10,
        FLOAT_PRECISION_DIGITS,
      );
    });
  }
});

// ── Plan §3 example reproduction ────────────────────────────────────────────

describe("plan §3 example reproduction", () => {
  test("computes 43.5 / 21.2 / 20 / 10 points and value 95 for the example inputs", () => {
    // Arrange — plan §3 example: 7.4 m/s, cf 0.34, EHV 8.2 km, slope 3.1°.
    // Under the v2 India-calibrated breakpoints:
    //   resource (7.4−4.5)/3 = 0.9667 → 43.5 · cf (0.34−0.12)/0.26 = 0.8462
    //   → 21.2 · grid 20 · terrain 10 → round(94.65) = 95.

    // Act
    const score = computeScore(BASE_INPUTS, "high");

    // Assert — per-component breakdown
    const resource = componentByKey(score, "resource");
    expect(resource.normalized).toBeCloseTo(0.9666666667, 8);
    expect(resource.points).toBe(43.5);

    const cf = componentByKey(score, "cf");
    expect(cf.normalized).toBeCloseTo(0.8461538462, 8);
    expect(cf.points).toBe(21.2);

    const grid = componentByKey(score, "grid");
    expect(grid.normalized).toBe(1);
    expect(grid.points).toBe(20);

    const terrain = componentByKey(score, "terrain");
    expect(terrain.normalized).toBe(1);
    expect(terrain.points).toBe(10);

    // Assert — headline rounds the unrounded total (94.65… → 95)
    expect(score.value).toBe(95);
  });

  test("echoes weights from SCORE_WEIGHTS in contract order", () => {
    // Arrange + Act
    const score = computeScore(BASE_INPUTS, "medium");

    // Assert
    expect(score.components.map((c) => c.key)).toEqual([
      "resource",
      "cf",
      "grid",
      "terrain",
    ]);
    expect(score.components.map((c) => c.weight)).toEqual([
      SCORE_WEIGHTS.resource,
      SCORE_WEIGHTS.cf,
      SCORE_WEIGHTS.grid,
      SCORE_WEIGHTS.terrain,
    ]);
  });
});

// ── Null / non-finite inputs ────────────────────────────────────────────────

describe("missing inputs", () => {
  test("returns value 0 with four transparent zero rows when every input is null", () => {
    // Arrange
    const allNull: ScoreInputs = {
      meanSpeed: null,
      cfIec3: null,
      nearestEhvKm: null,
      slope90thDeg: null,
    };

    // Act
    const score = computeScore(allNull, "low");

    // Assert
    expect(score.value).toBe(0);
    expect(score.components).toHaveLength(4);
    for (const component of score.components) {
      expect(component.raw).toBeNull();
      expect(component.normalized).toBe(0);
      expect(component.points).toBe(0);
    }
  });

  test("zeroes only the cf component when cfIec3 is null", () => {
    // Arrange + Act
    const score = scoreWith({ cfIec3: null });

    // Assert — cf is a zero row; the other three still score normally
    const cf = componentByKey(score, "cf");
    expect(cf.raw).toBeNull();
    expect(cf.normalized).toBe(0);
    expect(cf.points).toBe(0);
    expect(score.value).toBe(74); // round(43.5 + 0 + 20 + 10)
  });

  test("treats a non-finite input as missing (raw null, zero points)", () => {
    // Arrange + Act
    const score = scoreWith({ meanSpeed: Number.NaN });

    // Assert
    const resource = componentByKey(score, "resource");
    expect(resource.raw).toBeNull();
    expect(resource.normalized).toBe(0);
    expect(resource.points).toBe(0);
    expect(Number.isFinite(score.value)).toBe(true);
  });
});

// ── Confidence pass-through (plan §6 hard rule) ─────────────────────────────

describe("confidence independence", () => {
  test("same inputs with different confidence produce identical value and components", () => {
    // Arrange
    const confidences: ScoreConfidence[] = ["high", "medium", "low"];

    // Act
    const [high, medium, low] = confidences.map((confidence) =>
      computeScore(BASE_INPUTS, confidence),
    ) as [AnalysisScore, AnalysisScore, AnalysisScore];

    // Assert — confidence NEVER feeds the arithmetic
    expect(medium.value).toBe(high.value);
    expect(low.value).toBe(high.value);
    expect(medium.components).toEqual(high.components);
    expect(low.components).toEqual(high.components);
  });

  test("passes confidence through verbatim for all three levels", () => {
    // Arrange
    const confidences: ScoreConfidence[] = ["high", "medium", "low"];

    // Act + Assert
    for (const confidence of confidences) {
      expect(computeScore(BASE_INPUTS, confidence).confidence).toBe(confidence);
    }
  });
});

// ── Points-sum vs headline value consistency ────────────────────────────────

describe("component points sum vs headline value", () => {
  const inputSets: { label: string; inputs: ScoreInputs }[] = [
    { label: "plan §3 example", inputs: BASE_INPUTS },
    {
      label: "mid-range site",
      inputs: { meanSpeed: 6.3, cfIec3: 0.22, nearestEhvKm: 37.2, slope90thDeg: 9.7 },
    },
    {
      label: "strong site",
      inputs: { meanSpeed: 8.85, cfIec3: 0.41, nearestEhvKm: 12.3, slope90thDeg: 17.2 },
    },
    {
      label: "weak site",
      inputs: { meanSpeed: 5.4, cfIec3: 0.17, nearestEhvKm: 48.9, slope90thDeg: 19.4 },
    },
    {
      label: "partially missing data",
      inputs: { meanSpeed: 7.1, cfIec3: null, nearestEhvKm: 22.6, slope90thDeg: null },
    },
    {
      label: "all data missing",
      inputs: { meanSpeed: null, cfIec3: null, nearestEhvKm: null, slope90thDeg: null },
    },
  ];

  for (const { label, inputs } of inputSets) {
    test(`rounded points sum stays within 0.5 of value for ${label}`, () => {
      // Arrange + Act
      const score = computeScore(inputs, "medium");
      const pointsSum = score.components.reduce((sum, c) => sum + c.points, 0);

      // Assert — golden-test recompute rule: components reproduce the headline
      expect(Math.abs(pointsSum - score.value)).toBeLessThanOrEqual(0.5);
      expect(score.value).toBeGreaterThanOrEqual(0);
      expect(score.value).toBeLessThanOrEqual(100);
      expect(Number.isInteger(score.value)).toBe(true);
    });
  }

  test("value equals the rounded sum of unrounded weight·normalized from components", () => {
    // Arrange + Act
    const score = computeScore(BASE_INPUTS, "high");
    const exactTotal = score.components.reduce(
      (sum, c) => sum + c.weight * c.normalized,
      0,
    );

    // Assert — headline is exactly the rounded unrounded total
    expect(score.value).toBe(Math.round(exactTotal));
  });
});

// ── Immutability ────────────────────────────────────────────────────────────

describe("input immutability", () => {
  test("does not mutate the inputs object (frozen inputs do not throw)", () => {
    // Arrange — strict mode makes any mutation of a frozen object throw
    const frozenInputs: ScoreInputs = Object.freeze({ ...BASE_INPUTS });
    const snapshot = { ...frozenInputs };

    // Act
    const score = computeScore(frozenInputs, "high");

    // Assert
    expect(score.value).toBe(95);
    expect(frozenInputs).toEqual(snapshot);
  });
});
