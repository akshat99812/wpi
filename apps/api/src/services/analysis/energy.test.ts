import { describe, expect, test } from "bun:test";
import {
  IEC_POWER_CURVES,
  computePowerCurveCfs,
  grossCapacityFactor,
  interpNormalizedPower,
  weibullPdf,
} from "./energy";

describe("interpNormalizedPower", () => {
  const curve = IEC_POWER_CURVES.iec3;

  test("zero below cut-in and above cut-out", () => {
    expect(interpNormalizedPower(curve, 0)).toBe(0);
    expect(interpNormalizedPower(curve, 2.9)).toBe(0);
    expect(interpNormalizedPower(curve, 25.1)).toBe(0);
    expect(interpNormalizedPower(curve, 100)).toBe(0);
  });

  test("hits tabulated points exactly", () => {
    expect(interpNormalizedPower(curve, 6)).toBeCloseTo(0.34, 5);
    expect(interpNormalizedPower(curve, 12)).toBeCloseTo(1.0, 5);
  });

  test("linearly interpolates between points", () => {
    // 6→0.34, 7→0.52, midpoint 6.5 → 0.43
    expect(interpNormalizedPower(curve, 6.5)).toBeCloseTo(0.43, 5);
  });

  test("holds rated between last point and cut-out", () => {
    expect(interpNormalizedPower(curve, 20)).toBeCloseTo(1.0, 5);
  });
});

describe("weibullPdf", () => {
  test("integrates to ~1 over the support", () => {
    let area = 0;
    for (let v = 0.005; v < 40; v += 0.01) area += weibullPdf(v, 7, 2) * 0.01;
    expect(area).toBeCloseTo(1, 2);
  });

  test("zero for non-positive scale/shape", () => {
    expect(weibullPdf(5, 0, 2)).toBe(0);
    expect(weibullPdf(5, 7, 0)).toBe(0);
  });
});

describe("grossCapacityFactor", () => {
  const curve = IEC_POWER_CURVES.iec3;

  test("returns a fraction in [0,1]", () => {
    const cf = grossCapacityFactor(7, 2, curve);
    expect(cf).toBeGreaterThan(0);
    expect(cf).toBeLessThanOrEqual(1);
  });

  test("rises monotonically with the Weibull scale (windier site)", () => {
    expect(grossCapacityFactor(8, 2, curve)).toBeGreaterThan(
      grossCapacityFactor(6, 2, curve),
    );
  });

  test("air-density correction reduces CF below sea level", () => {
    const sea = grossCapacityFactor(7, 2, curve, 1.0);
    const altitude = grossCapacityFactor(7, 2, curve, 0.85); // ~1500 m
    expect(altitude).toBeLessThan(sea);
  });

  test("low-wind class (IEC-III) beats high-wind class (IEC-I) at a modest site", () => {
    expect(grossCapacityFactor(6.5, 2, IEC_POWER_CURVES.iec3)).toBeGreaterThan(
      grossCapacityFactor(6.5, 2, IEC_POWER_CURVES.iec1),
    );
  });

  test("zero for a degenerate distribution", () => {
    expect(grossCapacityFactor(0, 2, curve)).toBe(0);
  });

  test("plausible Indian benchmark range (§11 guardrail)", () => {
    // A good Indian site (A≈8, k≈2 → mean ≈7.1 m/s) IEC-III should land in a
    // bankable onshore band, not absurdly high/low.
    const cf = grossCapacityFactor(8, 2, IEC_POWER_CURVES.iec3);
    expect(cf).toBeGreaterThan(0.25);
    expect(cf).toBeLessThan(0.55);
  });
});

describe("computePowerCurveCfs", () => {
  test("null Weibull → null", () => {
    expect(computePowerCurveCfs(null, 1.225)).toBeNull();
  });

  test("returns all three classes, descending I < III at a modest site", () => {
    const cfs = computePowerCurveCfs({ A: 6.5, k: 2 }, 1.225);
    expect(cfs).not.toBeNull();
    expect(cfs!.iec3).toBeGreaterThan(cfs!.iec1);
    for (const v of [cfs!.iec1, cfs!.iec2, cfs!.iec3]) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
