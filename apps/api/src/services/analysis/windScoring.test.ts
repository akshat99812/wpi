/**
 * Unit tests for the suitability score — Methodology PART A (windScoring.ts).
 *
 * Golden-files the worked example (ws 7.2, line 4, sub 9 → score 92 Excellent,
 * res 0.916, grid 0.947), exercises the CUF anchor table and grid blend
 * breakpoints, the rating bands, null propagation, and the AnalysisScore
 * mapping (points/value consistency, confidence pass-through).
 */

import { describe, expect, test } from "bun:test";

import { toAnalysisScore, windScore } from "./windScoring";

const PRECISION = 10;

describe("worked example (methodology §A)", () => {
  test("ws 7.2, line 4 km, sub 9 km → score 92 (Excellent)", () => {
    const s = windScore(7.2, 4, 9)!;
    expect(s.cuf).toBeCloseTo(0.434, PRECISION);
    expect(s.res).toBeCloseTo(0.916, PRECISION);
    expect(s.grid).toBeCloseTo(0.947, 3);
    expect(s.score).toBe(92);
    expect(s.rating).toBe("Excellent");
  });
});

describe("resource sub-score from CUF anchors (§A1)", () => {
  // ws chosen so windCuf(ws) lands on a known anchor.
  test("cuf 0.38 (ws 5.5) → res 0.62", () => {
    expect(windScore(5.5, 2, 5)!.res).toBeCloseTo(0.62, PRECISION);
  });
  test("cuf 0.40 (ws 6.0) → res 0.76", () => {
    expect(windScore(6.0, 2, 5)!.res).toBeCloseTo(0.76, PRECISION);
  });
  test("cuf 0.46 (ws 9.0) → res 1.0 (top anchor)", () => {
    expect(windScore(9.0, 2, 5)!.res).toBeCloseTo(1.0, PRECISION);
  });
  test("cuf 0.25 (ws 4.0) is below the first anchor → clamps to 0.12", () => {
    expect(windScore(4.0, 2, 5)!.res).toBeCloseTo(0.12, PRECISION);
  });
});

describe("grid sub-score blend + saturation (§A2)", () => {
  test("line ≤2 km and sub ≤5 km → grid 1.0", () => {
    expect(windScore(7, 2, 5)!.grid).toBeCloseTo(1.0, PRECISION);
  });
  test("line ≥40 km and sub ≥80 km → grid 0", () => {
    expect(windScore(7, 40, 80)!.grid).toBeCloseTo(0, PRECISION);
  });
  test("both at their midpoints → grid 0.5", () => {
    // line: 1−(21−2)/38 = 0.5 ; sub: 1−(42.5−5)/75 = 0.5
    expect(windScore(7, 21, 42.5)!.grid).toBeCloseTo(0.5, PRECISION);
  });
  test("both distances missing → 0.15 each → grid 0.15", () => {
    expect(windScore(7, null, null)!.grid).toBeCloseTo(0.15, PRECISION);
  });
  test("missing line only → 0.6·0.15 + 0.4·1.0 = 0.49", () => {
    expect(windScore(7, null, 5)!.grid).toBeCloseTo(0.49, PRECISION);
  });
});

describe("rating bands (§A3)", () => {
  test("≥75 Excellent", () => {
    expect(windScore(7.2, 4, 9)!.rating).toBe("Excellent"); // 92
  });
  test("≥60 Good", () => {
    expect(windScore(5.5, 2, 5)!.rating).toBe("Good"); // 73
  });
  test("≥45 Moderate", () => {
    expect(windScore(5.0, 2, 5)!.rating).toBe("Moderate"); // 58
  });
  test("≥30 Marginal", () => {
    expect(windScore(5.0, null, null)!.rating).toBe("Marginal"); // 34
  });
  test("else Poor", () => {
    expect(windScore(4.0, null, null)!.rating).toBe("Poor"); // 13
  });
});

describe("null propagation (rule §5)", () => {
  test("null ws → null score (never coerced to 0)", () => {
    expect(windScore(null, 4, 9)).toBeNull();
  });
  test("non-finite ws → null score", () => {
    expect(windScore(Number.NaN, 4, 9)).toBeNull();
  });
});

describe("toAnalysisScore mapping", () => {
  test("carries value/rating/cuf + the two components for the worked example", () => {
    const as = toAnalysisScore(windScore(7.2, 4, 9), "high");
    expect(as.value).toBe(92);
    expect(as.rating).toBe("Excellent");
    expect(as.cuf).toBeCloseTo(0.434, PRECISION);
    expect(as.confidence).toBe("high");
    expect(as.components.map((c) => c.key)).toEqual(["resource", "grid"]);

    const resource = as.components.find((c) => c.key === "resource")!;
    expect(resource.weight).toBe(72);
    expect(resource.raw).toBeCloseTo(0.434, PRECISION); // raw = the CUF used
    expect(resource.normalized).toBeCloseTo(0.916, PRECISION);
    expect(resource.points).toBe(66.0); // round1(72·0.916)

    const grid = as.components.find((c) => c.key === "grid")!;
    expect(grid.weight).toBe(28);
    expect(grid.normalized).toBeCloseTo(0.947, 3);
    expect(grid.points).toBe(26.5); // round1(28·0.947)
  });

  test("null score → value 0, rating Poor, cuf null, transparent zero rows", () => {
    const as = toAnalysisScore(null, "low");
    expect(as.value).toBe(0);
    expect(as.rating).toBe("Poor");
    expect(as.cuf).toBeNull();
    expect(as.confidence).toBe("low");
    expect(as.components).toHaveLength(2);
    expect(as.components.every((c) => c.raw === null && c.points === 0)).toBe(true);
  });

  test("confidence is pass-through only — never feeds value/components", () => {
    const high = toAnalysisScore(windScore(7.2, 4, 9), "high");
    const low = toAnalysisScore(windScore(7.2, 4, 9), "low");
    expect(low.value).toBe(high.value);
    expect(low.components).toEqual(high.components);
    expect(low.confidence).toBe("low");
  });

  test("component points reproduce the headline within 0.5", () => {
    const cases: Array<[number | null, number | null, number | null]> = [
      [7.2, 4, 9],
      [6.3, 22, 31],
      [8.85, 12, 3],
      [5.4, 49, 60],
      [7.1, null, 18],
    ];
    for (const [ws, lineKm, subKm] of cases) {
      const as = toAnalysisScore(windScore(ws, lineKm, subKm), "medium");
      const sum = as.components.reduce((acc, c) => acc + c.points, 0);
      expect(Math.abs(sum - as.value)).toBeLessThanOrEqual(0.5);
      expect(as.value).toBeGreaterThanOrEqual(0);
      expect(as.value).toBeLessThanOrEqual(100);
      expect(Number.isInteger(as.value)).toBe(true);
    }
  });
});
