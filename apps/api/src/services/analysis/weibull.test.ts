/**
 * weibull.ts tests.
 *
 * Pure tests: geotransform→window math with synthetic transforms, ray-cast
 * point-in-ring, Lanczos gamma. Live test (needs the COGs on disk and
 * SKIP_LIVE !== "1"): Muppandal 5×5 km area means vs VERIFIED.md §2 truth.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { squareRingAround } from "./mercator";
import {
  aoiWeibullMeans,
  bboxPixelWindow,
  gammaFn,
  isInsideRing,
  MAX_WINDOW_PIXELS,
  pixelCenterLngLat,
  resetWeibullCogs,
  WEIBULL_COG_PATHS,
  type GeoTransform,
} from "./weibull";

/** Synthetic north-up transform: lon 70–80, lat 20–30, 0.01° pixels. */
const SYNTH_TRANSFORM: GeoTransform = {
  originX: 70,
  originY: 30,
  pixelWidth: 0.01,
  pixelHeight: -0.01,
  widthPx: 1000,
  heightPx: 1000,
};

describe("bboxPixelWindow", () => {
  test("maps a pixel-aligned interior bbox to the exact pixel range", () => {
    // Arrange
    const bbox: [number, number, number, number] = [72, 27, 73, 28];

    // Act
    const window = bboxPixelWindow(SYNTH_TRANSFORM, bbox);

    // Assert
    expect(window).toEqual({ x0: 200, y0: 200, x1: 300, y1: 300 });
  });

  test("expands a fractional bbox outward to whole covering pixels", () => {
    // Arrange — bbox straddles pixel edges by half a pixel on every side
    const bbox: [number, number, number, number] = [
      72.005, 27.995, 72.015, 28.005,
    ];

    // Act
    const window = bboxPixelWindow(SYNTH_TRANSFORM, bbox);

    // Assert
    expect(window).toEqual({ x0: 200, y0: 199, x1: 202, y1: 201 });
  });

  test("clamps a bbox overhanging the north-west corner to the image", () => {
    // Arrange
    const bbox: [number, number, number, number] = [69, 29.5, 70.5, 31];

    // Act
    const window = bboxPixelWindow(SYNTH_TRANSFORM, bbox);

    // Assert
    expect(window).toEqual({ x0: 0, y0: 0, x1: 50, y1: 50 });
  });

  test("returns null when the bbox lies entirely off the raster", () => {
    // Arrange
    const bbox: [number, number, number, number] = [81, 20, 82, 21];

    // Act
    const window = bboxPixelWindow(SYNTH_TRANSFORM, bbox);

    // Assert
    expect(window).toBeNull();
  });

  test("throws when the window would exceed the defensive pixel cap", () => {
    // Arrange — a country-sized raster with a bbox covering all of it
    const hugeTransform: GeoTransform = {
      ...SYNTH_TRANSFORM,
      widthPx: 10_000,
      heightPx: 10_000,
      pixelWidth: 0.001,
      pixelHeight: -0.001,
    };
    const bbox: [number, number, number, number] = [70, 20, 80, 30];

    // Act + Assert
    expect(() => bboxPixelWindow(hugeTransform, bbox)).toThrow(
      String(MAX_WINDOW_PIXELS),
    );
  });

  test("throws on a transform that is not north-up", () => {
    // Arrange
    const southUp: GeoTransform = { ...SYNTH_TRANSFORM, pixelHeight: 0.01 };

    // Act + Assert
    expect(() => bboxPixelWindow(southUp, [72, 27, 73, 28])).toThrow(
      "north-up",
    );
  });
});

describe("pixelCenterLngLat", () => {
  test("returns the half-pixel-offset center of a full-image pixel", () => {
    // Act
    const [lon, lat] = pixelCenterLngLat(SYNTH_TRANSFORM, 200, 200);

    // Assert
    expect(lon).toBeCloseTo(72.005, 10);
    expect(lat).toBeCloseTo(27.995, 10);
  });

  test("returns the center of pixel (0,0) just inside the origin corner", () => {
    // Act
    const [lon, lat] = pixelCenterLngLat(SYNTH_TRANSFORM, 0, 0);

    // Assert
    expect(lon).toBeCloseTo(70.005, 10);
    expect(lat).toBeCloseTo(29.995, 10);
  });
});

describe("isInsideRing", () => {
  const unitSquare: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ];

  test("returns true for a point inside the ring", () => {
    expect(isInsideRing(0.5, 0.5, unitSquare)).toBe(true);
  });

  test("returns false for a point outside the ring", () => {
    expect(isInsideRing(1.5, 0.5, unitSquare)).toBe(false);
    expect(isInsideRing(-0.2, 0.5, unitSquare)).toBe(false);
    expect(isInsideRing(0.5, 2, unitSquare)).toBe(false);
  });

  test("handles a non-convex ring correctly", () => {
    // Arrange — an L-shape with the notch at the top-right
    const lShape: [number, number][] = [
      [0, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [1, 2],
      [0, 2],
      [0, 0],
    ];

    // Act + Assert
    expect(isInsideRing(0.5, 1.5, lShape)).toBe(true); // in the upright part
    expect(isInsideRing(1.5, 0.5, lShape)).toBe(true); // in the base
    expect(isInsideRing(1.5, 1.5, lShape)).toBe(false); // in the notch
  });
});

describe("gammaFn (Lanczos)", () => {
  test("matches Γ(1.5) = √π/2", () => {
    expect(gammaFn(1.5)).toBeCloseTo(0.886227, 5);
  });

  test("matches Γ(2) = 1", () => {
    expect(gammaFn(2)).toBeCloseTo(1, 10);
  });

  test("matches Γ(1.349) ≈ 0.8911 (Muppandal 1 + 1/k)", () => {
    expect(gammaFn(1.349)).toBeCloseTo(0.8911, 3);
  });
});

describe("resetWeibullCogs", () => {
  test("resolves cleanly when no COG load has happened yet", async () => {
    // Act + Assert — must be safe to call on a cold module
    await expect(resetWeibullCogs()).resolves.toBeUndefined();
  });

  test("is idempotent — back-to-back resets never throw", async () => {
    // Act + Assert
    await resetWeibullCogs();
    await expect(resetWeibullCogs()).resolves.toBeUndefined();
  });
});

// ── Live test against the local COGs (VERIFIED.md §2 ground truth) ─────────

const MUPPANDAL_LON = 77.55;
const MUPPANDAL_LAT = 8.26;
const POINT_SQUARE_KM = 5;

/** Point truth at the exact Muppandal pixel (VERIFIED.md §2). */
const MUPPANDAL_POINT_A = 10.65;
const MUPPANDAL_POINT_K = 2.87;
/** GWA ws_mean_hgt100m at the same pixel — A·Γ(1+1/k) matches it exactly. */
const MUPPANDAL_MEAN_SPEED = 9.49;
/** Area mean vs point value: the corridor gradient justifies wide bands. */
const AREA_MEAN_A_TOLERANCE = 0.8;
const AREA_MEAN_K_TOLERANCE = 0.25;
const IMPLIED_MEAN_REL_TOLERANCE = 0.05;

const LIVE_TIMEOUT_MS = 60_000;

const isLiveDisabled = process.env.SKIP_LIVE === "1";
const areCogsPresent =
  existsSync(WEIBULL_COG_PATHS.a) && existsSync(WEIBULL_COG_PATHS.k);
if (!isLiveDisabled && !areCogsPresent) {
  console.log(
    "[weibull.test] Weibull COGs absent — skipping live test. Run `bun scripts/fetch-weibull-cogs.ts` to enable it.",
  );
}

test.skipIf(isLiveDisabled || !areCogsPresent)(
  "aoiWeibullMeans over the Muppandal 5×5 km square matches VERIFIED.md truth bands",
  async () => {
    // Arrange
    const ring = squareRingAround(MUPPANDAL_LON, MUPPANDAL_LAT, POINT_SQUARE_KM);
    const lons = ring.map(([lon]) => lon);
    const lats = ring.map(([, lat]) => lat);
    const bbox: [number, number, number, number] = [
      Math.min(...lons),
      Math.min(...lats),
      Math.max(...lons),
      Math.max(...lats),
    ];

    // Act
    const means = await aoiWeibullMeans(bbox, ring);

    // Assert
    expect(means).not.toBeNull();
    const { A, k } = means!;
    const impliedMean = A * gammaFn(1 + 1 / k);
    console.log(
      `[weibull.test] Muppandal 5×5 km area means: A=${A.toFixed(4)} ` +
        `k=${k.toFixed(4)} impliedMean=A·Γ(1+1/k)=${impliedMean.toFixed(4)} m/s ` +
        `(point truth A=${MUPPANDAL_POINT_A}, k=${MUPPANDAL_POINT_K}, mean=${MUPPANDAL_MEAN_SPEED})`,
    );
    expect(A).toBeGreaterThan(MUPPANDAL_POINT_A - AREA_MEAN_A_TOLERANCE);
    expect(A).toBeLessThan(MUPPANDAL_POINT_A + AREA_MEAN_A_TOLERANCE);
    expect(k).toBeGreaterThan(MUPPANDAL_POINT_K - AREA_MEAN_K_TOLERANCE);
    expect(k).toBeLessThan(MUPPANDAL_POINT_K + AREA_MEAN_K_TOLERANCE);
    expect(
      Math.abs(impliedMean - MUPPANDAL_MEAN_SPEED) / MUPPANDAL_MEAN_SPEED,
    ).toBeLessThan(IMPLIED_MEAN_REL_TOLERANCE);
  },
  LIVE_TIMEOUT_MS,
);

test.skipIf(isLiveDisabled || !areCogsPresent)(
  "aoiWeibullMeans returns null for an in-bounds bbox whose ring is outside the India mask",
  async () => {
    // Arrange — inside the COG raster bounds but all-NaN: Sri Lanka interior.
    // (Verified empirically 2026-06-11: the IND country COG covers India's
    // EEZ — the Lakshadweep Sea has DATA — but is NaN over Sri Lanka,
    // Pakistan, and open sea beyond the EEZ.)
    const ring = squareRingAround(80.64, 7.29, POINT_SQUARE_KM);
    const lons = ring.map(([lon]) => lon);
    const lats = ring.map(([, lat]) => lat);
    const bbox: [number, number, number, number] = [
      Math.min(...lons),
      Math.min(...lats),
      Math.max(...lons),
      Math.max(...lats),
    ];

    // Act
    const means = await aoiWeibullMeans(bbox, ring);

    // Assert — country COGs are NaN outside India's land/EEZ mask there
    expect(means).toBeNull();
  },
  LIVE_TIMEOUT_MS,
);

test.skipIf(isLiveDisabled || !areCogsPresent)(
  "resetWeibullCogs closes the handles and the next read reopens identically",
  async () => {
    // Arrange
    const ring = squareRingAround(MUPPANDAL_LON, MUPPANDAL_LAT, POINT_SQUARE_KM);
    const lons = ring.map(([lon]) => lon);
    const lats = ring.map(([, lat]) => lat);
    const bbox: [number, number, number, number] = [
      Math.min(...lons),
      Math.min(...lats),
      Math.max(...lons),
      Math.max(...lats),
    ];
    const before = await aoiWeibullMeans(bbox, ring);

    // Act — drop the singleton (closing both fds), then read again
    await resetWeibullCogs();
    const after = await aoiWeibullMeans(bbox, ring);

    // Assert — the reload must reproduce the pre-reset means exactly
    expect(before).not.toBeNull();
    expect(after).toEqual(before);
  },
  LIVE_TIMEOUT_MS,
);
