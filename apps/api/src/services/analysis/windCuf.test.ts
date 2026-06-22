/**
 * Unit tests for windCuf — the shared ws→CUF lookup (methodology §2).
 * Covers curve knots, endpoint clamping, interpolation (incl. the worked
 * example 7.2 → 0.434), monotonicity, and null/non-finite handling.
 */

import { describe, expect, test } from "bun:test";

import { WIND_CUF_CURVE, windCuf } from "./windCuf";

const PRECISION = 12;

describe("windCuf endpoints and clamping", () => {
  test("clamps below the first knot to 0.25", () => {
    expect(windCuf(4)).toBe(0.25);
    expect(windCuf(3)).toBe(0.25);
    expect(windCuf(0)).toBe(0.25);
  });

  test("clamps above the last knot to 0.46", () => {
    expect(windCuf(9)).toBe(0.46);
    expect(windCuf(12)).toBe(0.46);
    expect(windCuf(25)).toBe(0.46);
  });

  test("returns exact knot values", () => {
    expect(windCuf(5.5)).toBe(0.38);
    expect(windCuf(6)).toBe(0.4);
    expect(windCuf(7)).toBe(0.43);
    expect(windCuf(8)).toBe(0.45);
  });
});

describe("windCuf interpolation", () => {
  test("worked example: 7.2 m/s → 0.434", () => {
    // 0.43 + (0.2/1.0)·(0.45 − 0.43) = 0.434
    expect(windCuf(7.2)!).toBeCloseTo(0.434, PRECISION);
  });

  test("interpolates the 4.0–4.5 segment at its midpoint", () => {
    // 0.25 + 0.5·(0.30 − 0.25) = 0.275
    expect(windCuf(4.25)!).toBeCloseTo(0.275, PRECISION);
  });

  test("interpolates the 8–9 segment at its midpoint", () => {
    // 0.45 + 0.5·(0.46 − 0.45) = 0.455
    expect(windCuf(8.5)!).toBeCloseTo(0.455, PRECISION);
  });
});

describe("windCuf null / non-finite", () => {
  test("null in → null out", () => {
    expect(windCuf(null)).toBeNull();
  });

  test("NaN / ±Infinity → null (not coerced)", () => {
    expect(windCuf(Number.NaN)).toBeNull();
    expect(windCuf(Number.POSITIVE_INFINITY)).toBeNull();
    expect(windCuf(Number.NEGATIVE_INFINITY)).toBeNull();
  });
});

describe("WIND_CUF_CURVE shape", () => {
  test("is strictly increasing in speed and non-decreasing in CUF", () => {
    for (let i = 1; i < WIND_CUF_CURVE.length; i++) {
      const prev = WIND_CUF_CURVE[i - 1]!;
      const cur = WIND_CUF_CURVE[i]!;
      expect(cur[0]).toBeGreaterThan(prev[0]);
      expect(cur[1]).toBeGreaterThanOrEqual(prev[1]);
    }
  });
});
