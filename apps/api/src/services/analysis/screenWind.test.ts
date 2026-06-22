/**
 * Unit tests for the single-point entry point (screenWind.ts, methodology §6).
 * Confirms the three independent outputs come back together for the worked
 * example, the band is reproducible (fixed internal seed), and null ws
 * propagates to all three (rule §5).
 */

import { describe, expect, test } from "bun:test";

import { screenWind } from "./screenWind";

describe("screenWind worked example", () => {
  const r = screenWind(7.2, 4, 9);

  test("returns the Part A score (92, Excellent)", () => {
    expect(r.score?.score).toBe(92);
    expect(r.score?.rating).toBe("Excellent");
  });

  test("returns the Part B financials (equity IRR ~23%)", () => {
    expect(r.financials?.irr!).toBeCloseTo(0.23, 2);
    expect(r.financials?.payback).toBe(5);
  });

  test("returns a 4,000-run IRR band", () => {
    expect(r.irrBand?.n).toBe(4000);
  });

  test("the band is reproducible across calls (fixed internal seed)", () => {
    const again = screenWind(7.2, 4, 9);
    expect(again.irrBand).toEqual(r.irrBand);
  });
});

describe("null propagation", () => {
  test("null ws → all three outputs null", () => {
    const r = screenWind(null, 4, 9);
    expect(r.score).toBeNull();
    expect(r.financials).toBeNull();
    expect(r.irrBand).toBeNull();
  });

  test("financials ignore the grid inputs (no new inputs in Part B)", () => {
    // Same ws, different/absent distances → identical financials.
    const withGrid = screenWind(7.2, 4, 9).financials;
    const noGrid = screenWind(7.2, null, null).financials;
    expect(noGrid).toEqual(withGrid);
  });
});
