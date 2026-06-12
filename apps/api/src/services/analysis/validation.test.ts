/**
 * Tests for the mast-validation section (plan §2.3).
 *
 * Pure helpers (shear adjustment, delta, confidence badge) are tested
 * exhaustively offline. The full computeValidation path needs the live
 * PostGIS masts DB + GWA tiler and is skipped unless DATABASE_URL is set
 * (and not overridden with SKIP_LIVE=1).
 */

import { afterAll, describe, expect, test } from "bun:test";

import { pool } from "../../lib/db";
import { validateAoi } from "./geometry";
import { squareRingAround } from "./mercator";
import { computeValidation, confidenceFrom, deltaPct, shearAdjustSpeed } from "./validation";

const FLOAT_PRECISION_DIGITS = 12;

const isLiveDb = Boolean(process.env.DATABASE_URL) && process.env.SKIP_LIVE !== "1";
const liveTest = isLiveDb ? test : test.skip;
const LIVE_TEST_TIMEOUT_MS = 60_000;

/** Muppandal golden point (VERIFIED.md) + the AOI α measured there. */
const MUPPANDAL_LON = 77.55;
const MUPPANDAL_LAT = 8.26;
const MUPPANDAL_SHEAR_ALPHA = 0.2315;

// ── shearAdjustSpeed ────────────────────────────────────────────────────────

describe("shearAdjustSpeed", () => {
  test("returns v100 unchanged when mast height is the 100 m reference", () => {
    // Arrange
    const v100 = 9.4894;

    // Act
    const adjusted = shearAdjustSpeed(v100, 100, 0.2315);

    // Assert
    expect(adjusted).toBeCloseTo(v100, FLOAT_PRECISION_DIGITS);
  });

  test("scales speed up for a 120 m mast with alpha 0.2", () => {
    // Arrange
    const v100 = 8;

    // Act
    const adjusted = shearAdjustSpeed(v100, 120, 0.2);

    // Assert — v_mastH = 8 · (120/100)^0.2
    expect(adjusted).toBeCloseTo(8 * 1.2 ** 0.2, FLOAT_PRECISION_DIGITS);
    expect(adjusted).toBeGreaterThan(v100);
  });

  test("scales speed down for an 80 m mast with alpha 0.2", () => {
    // Arrange
    const v100 = 8;

    // Act
    const adjusted = shearAdjustSpeed(v100, 80, 0.2);

    // Assert — v_mastH = 8 · (80/100)^0.2
    expect(adjusted).toBeCloseTo(8 * 0.8 ** 0.2, FLOAT_PRECISION_DIGITS);
    expect(adjusted).toBeLessThan(v100);
  });

  test("alpha 0 is the identity at any mast height", () => {
    // Arrange + Act + Assert
    expect(shearAdjustSpeed(7.3, 50, 0)).toBeCloseTo(7.3, FLOAT_PRECISION_DIGITS);
    expect(shearAdjustSpeed(7.3, 150, 0)).toBeCloseTo(7.3, FLOAT_PRECISION_DIGITS);
  });

  test("throws when mast height is zero or negative", () => {
    expect(() => shearAdjustSpeed(8, 0, 0.2)).toThrow("mastHeightM");
    expect(() => shearAdjustSpeed(8, -50, 0.2)).toThrow("mastHeightM");
  });

  test("throws when v100 is negative or non-finite", () => {
    expect(() => shearAdjustSpeed(-1, 100, 0.2)).toThrow("v100");
    expect(() => shearAdjustSpeed(Number.NaN, 100, 0.2)).toThrow("v100");
  });

  test("throws when alpha is non-finite", () => {
    expect(() => shearAdjustSpeed(8, 100, Number.POSITIVE_INFINITY)).toThrow("alpha");
  });
});

// ── deltaPct ────────────────────────────────────────────────────────────────

describe("deltaPct", () => {
  test("is positive when measurement runs above the model", () => {
    // Arrange + Act
    const delta = deltaPct(7.7, 7.0);

    // Assert — (7.7 − 7.0) / 7.0 = +10%
    expect(delta).toBe(10);
  });

  test("is negative when measurement runs below the model", () => {
    // Arrange + Act
    const delta = deltaPct(6.3, 7.0);

    // Assert — (6.3 − 7.0) / 7.0 = −10%
    expect(delta).toBe(-10);
  });

  test("is zero when measurement equals the model", () => {
    expect(deltaPct(7.0, 7.0)).toBe(0);
  });

  test("rounds to one decimal place", () => {
    // (7.1 − 7.0) / 7.0 · 100 = 1.42857… → 1.4
    expect(deltaPct(7.1, 7.0)).toBe(1.4);
  });

  test("throws when the model speed is zero, negative, or non-finite", () => {
    expect(() => deltaPct(7, 0)).toThrow("model speed");
    expect(() => deltaPct(7, -2)).toThrow("model speed");
    expect(() => deltaPct(7, Number.NaN)).toThrow("model speed");
  });

  test("throws when the measured speed is non-finite", () => {
    expect(() => deltaPct(Number.NaN, 7)).toThrow("measured");
  });
});

// ── confidenceFrom ──────────────────────────────────────────────────────────

describe("confidenceFrom", () => {
  test("returns high at exactly 2 masts within 20 km (boundary)", () => {
    expect(confidenceFrom(2, 2)).toBe("high");
  });

  test("returns high when many masts are within 20 km", () => {
    expect(confidenceFrom(5, 9)).toBe("high");
  });

  test("returns medium with exactly 1 mast within 25 km (boundary)", () => {
    expect(confidenceFrom(1, 1)).toBe("medium");
  });

  test("returns medium when the only mast is between 20 and 25 km out", () => {
    expect(confidenceFrom(0, 1)).toBe("medium");
  });

  test("returns low when nothing is within 25 km", () => {
    expect(confidenceFrom(0, 0)).toBe("low");
  });

  test("throws on negative or non-integer counts", () => {
    expect(() => confidenceFrom(-1, 0)).toThrow("countWithin20");
    expect(() => confidenceFrom(0, 1.5)).toThrow("countWithin25");
  });
});

// ── computeValidation (live DB + GWA tiles) ─────────────────────────────────

describe("computeValidation against the live masts DB", () => {
  liveTest(
    "validates the Muppandal 5×5 km square with plausible mast facts",
    async () => {
      // Arrange — point-mode square at the Muppandal golden point.
      const ring = squareRingAround(MUPPANDAL_LON, MUPPANDAL_LAT, 5);
      const aoi = validateAoi({ type: "Polygon", coordinates: [ring] });

      // Act
      const data = await computeValidation(aoi, MUPPANDAL_SHEAR_ALPHA);

      // Assert — structural sanity per the contract.
      expect(data.mastCountInAoi).toBeGreaterThanOrEqual(0);
      expect(["high", "medium", "low"]).toContain(data.confidence);
      const mast = data.nearestMast;
      if (mast === null) {
        throw new Error("expected a nearest WRA mast near Muppandal (Tamil Nadu has many)");
      }
      expect(mast.station.length).toBeGreaterThan(0);
      expect(mast.distanceKm).toBeGreaterThanOrEqual(0);
      expect(mast.maws).toBeGreaterThan(0);
      expect(mast.heightM).toBeGreaterThan(0);

      // Suppression rule: no delta when the nearest mast is >25 km out.
      if (mast.distanceKm > 25) {
        expect(data.modelDeltaPct).toBeNull();
      }
      // Loose sanity band on the model-vs-measurement delta.
      if (data.modelDeltaPct !== null) {
        expect(Math.abs(data.modelDeltaPct)).toBeLessThan(60);
      }

      // Recorded for Phase 6 (expected-range capture).
      console.log("[validation live] Muppandal 5×5 km:", JSON.stringify(data));
    },
    LIVE_TEST_TIMEOUT_MS,
  );
});

afterAll(async () => {
  // No other test file touches lib/db's pool (verified), so it is safe to
  // close it here; without this the pg pool can hold the runner open.
  if (isLiveDb) await pool.end();
});
