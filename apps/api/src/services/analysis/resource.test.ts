import { describe, expect, test } from "bun:test";
import {
  airDensityAtElevation,
  classifySite,
  collectInsideFinite,
  computeResource,
  fitShearAlpha,
  meanOf,
  percentileOfSorted,
  roundTo,
  type ResourcePatches,
} from "./resource";
import type { AoiMask, LayerPatch } from "./types";

/** 2×2 patch with the given pixel values (row-major). */
function patchOf(values: number[]): LayerPatch {
  return {
    zoom: 10,
    minTileX: 0,
    minTileY: 0,
    widthPx: 2,
    heightPx: 2,
    data: Float32Array.from(values),
  };
}

function maskAllInside(): AoiMask {
  return {
    widthPx: 2,
    heightPx: 2,
    inside: Uint8Array.from([1, 1, 1, 1]),
    insideCount: 4,
  };
}

/** Synthetic but physically coherent AOI: shear-consistent speeds. */
function syntheticPatches(overrides: Partial<ResourcePatches> = {}): ResourcePatches {
  const ws100 = [8, 9, 10, 11];
  const alpha = 0.2;
  return {
    ws100: patchOf(ws100),
    ws50: patchOf(ws100.map((v) => v * 0.5 ** alpha)),
    ws150: patchOf(ws100.map((v) => v * 1.5 ** alpha)),
    pd100: patchOf([400, 400, 400, 400]),
    elevation: patchOf([1500, 1500, 1500, 1500]),
    cfIec3: patchOf([0.4, 0.45, 0.5, 0.55]),
    cfIec2: patchOf([0.35, 0.4, 0.45, 0.5]),
    ...overrides,
  };
}

describe("roundTo", () => {
  test("rounds to the requested decimals", () => {
    expect(roundTo(1.23456, 2)).toBe(1.23);
    expect(roundTo(1.235, 2)).toBe(1.24);
  });

  test("passes non-finite values through unchanged", () => {
    expect(roundTo(Number.NaN, 2)).toBeNaN();
    expect(roundTo(Infinity, 2)).toBe(Infinity);
  });
});

describe("meanOf", () => {
  test("returns NaN for empty input", () => {
    expect(meanOf([])).toBeNaN();
  });

  test("computes the arithmetic mean", () => {
    expect(meanOf([2, 4, 6])).toBe(4);
  });
});

describe("percentileOfSorted", () => {
  test("throws on empty input", () => {
    expect(() => percentileOfSorted([], 0.5)).toThrow("empty");
  });

  test("throws on q outside [0, 1]", () => {
    expect(() => percentileOfSorted([1], 1.5)).toThrow("[0, 1]");
    expect(() => percentileOfSorted([1], -0.1)).toThrow("[0, 1]");
  });

  test("single element returns that element at any q", () => {
    expect(percentileOfSorted([7], 0)).toBe(7);
    expect(percentileOfSorted([7], 0.5)).toBe(7);
    expect(percentileOfSorted([7], 1)).toBe(7);
  });

  test("interpolates linearly between bracketing elements", () => {
    // position = q·(n−1): q=0.25 on [0,10] → 2.5
    expect(percentileOfSorted([0, 10], 0.25)).toBe(2.5);
    // q=0.5 on 5 elements lands exactly on index 2.
    expect(percentileOfSorted([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });

  test("q=0 and q=1 hit the extremes exactly", () => {
    expect(percentileOfSorted([3, 5, 9], 0)).toBe(3);
    expect(percentileOfSorted([3, 5, 9], 1)).toBe(9);
  });
});

describe("collectInsideFinite", () => {
  test("skips masked-out pixels and non-finite values", () => {
    // Arrange: pixel 1 masked out, pixel 2 is NaN.
    const patch = patchOf([1, 2, Number.NaN, 4]);
    const mask: AoiMask = {
      widthPx: 2,
      heightPx: 2,
      inside: Uint8Array.from([1, 0, 1, 1]),
      insideCount: 3,
    };

    // Act
    const values = collectInsideFinite(patch, mask);

    // Assert
    expect(values).toEqual([1, 4]);
  });
});

describe("fitShearAlpha", () => {
  test("recovers the exponent of a clean power-law profile", () => {
    // Arrange: v(h) = 8·(h/100)^0.3
    const alpha = 0.3;
    const speeds: [number, number, number] = [
      8 * 0.5 ** alpha,
      8,
      8 * 1.5 ** alpha,
    ];

    // Act + Assert
    expect(fitShearAlpha(speeds)).toBeCloseTo(alpha, 6);
  });

  test("returns NaN when any height's mean is non-positive", () => {
    expect(fitShearAlpha([0, 8, 9])).toBeNaN();
    expect(fitShearAlpha([Number.NaN, 8, 9])).toBeNaN();
  });
});

describe("airDensityAtElevation", () => {
  test("sea level is the ISA reference density", () => {
    expect(airDensityAtElevation(0)).toBeCloseTo(1.225, 6);
  });

  test("1500 m matches the barometric formula", () => {
    // 1.225·(1 − 2.2558e-5·1500)^5.256 — computed independently.
    expect(airDensityAtElevation(1500)).toBeCloseTo(1.0222, 3);
  });
});

describe("classifySite", () => {
  test("bands exactly per the plan contract", () => {
    expect(classifySite(8)).toBe("excellent");
    expect(classifySite(7.99)).toBe("good");
    expect(classifySite(7)).toBe("good");
    expect(classifySite(6.99)).toBe("moderate");
    expect(classifySite(6)).toBe("moderate");
    expect(classifySite(5.99)).toBe("marginal");
  });
});

describe("computeResource", () => {
  test("computes the full section from coherent synthetic patches", () => {
    // Arrange
    const patches = syntheticPatches();
    const mask = maskAllInside();

    // Act
    const result = computeResource(patches, mask, { A: 10.2, k: 2.4 });

    // Assert — speeds (ws100 = [8, 9, 10, 11])
    expect(result.meanSpeed).toBe(9.5);
    expect(result.minSpeed).toBe(8);
    expect(result.maxSpeed).toBe(11);
    expect(result.p25Speed).toBe(8.75);
    expect(result.p50Speed).toBe(9.5);
    expect(result.p75Speed).toBe(10.25);
    expect(result.areaExceedance90).toBe(8.3); // 10th percentile, LOW tail
    // Shear recovered from the synthetic 0.2 profile.
    expect(result.shearAlpha).toBeCloseTo(0.2, 3);
    // Power density corrected DOWN at 1500 m: 400·(1.0222/1.225) ≈ 334.
    expect(result.airDensity).toBeCloseTo(1.022, 3);
    expect(result.powerDensityRaw).toBe(400);
    expect(result.powerDensity).toBe(334);
    // CF means.
    expect(result.cfIec3).toBeCloseTo(0.475, 4);
    expect(result.cfIec2).toBeCloseTo(0.425, 4);
    // Pass-throughs and banding.
    expect(result.weibull).toEqual({ A: 10.2, k: 2.4 });
    expect(result.siteClass).toBe("excellent");
    // 9.5 m/s is near the top of the India distribution (committed artifact).
    expect(result.indiaPercentile).toBeGreaterThanOrEqual(90);
    expect(result.indiaPercentile).toBeLessThanOrEqual(100);
  });

  test("clamps a negative CF mean (resampling artifact) to 0", () => {
    const patches = syntheticPatches({
      cfIec3: patchOf([-0.02, -0.01, -0.03, -0.02]),
    });

    const result = computeResource(patches, maskAllInside(), null);

    expect(result.cfIec3).toBe(0);
  });

  test("returns null CF/power fields when those layers are empty in-mask", () => {
    const nanPatch = patchOf([Number.NaN, Number.NaN, Number.NaN, Number.NaN]);
    const patches = syntheticPatches({
      cfIec3: nanPatch,
      cfIec2: nanPatch,
      pd100: nanPatch,
    });

    const result = computeResource(patches, maskAllInside(), null);

    expect(result.cfIec3).toBeNull();
    expect(result.cfIec2).toBeNull();
    expect(result.powerDensity).toBeNull();
    expect(result.powerDensityRaw).toBeNull();
    // Speeds still computed — the section itself stays usable.
    expect(result.meanSpeed).toBe(9.5);
  });

  test("throws when ws100 has zero valid in-mask pixels", () => {
    const patches = syntheticPatches({
      ws100: patchOf([Number.NaN, Number.NaN, Number.NaN, Number.NaN]),
    });

    expect(() => computeResource(patches, maskAllInside(), null)).toThrow(
      "zero valid",
    );
  });

  test("throws on patch/mask dimension mismatch", () => {
    const patches = syntheticPatches();
    const mask: AoiMask = {
      widthPx: 3,
      heightPx: 3,
      inside: new Uint8Array(9).fill(1),
      insideCount: 9,
    };

    expect(() => computeResource(patches, mask, null)).toThrow("mask is 3×3");
  });
});
