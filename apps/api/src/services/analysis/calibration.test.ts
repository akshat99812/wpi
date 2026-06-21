import { describe, expect, test } from "bun:test";
import {
  STATE_CALIBRATION,
  applyCalibration,
  calibrationFactorForStates,
} from "./calibration";

describe("calibration (identity until CEA/SLDC ingest)", () => {
  test("unknown states → identity factor, isCalibrated false", () => {
    const r = calibrationFactorForStates(["Nowhere", "Elsewhere"]);
    expect(r.factor).toBe(1);
    expect(r.isCalibrated).toBe(false);
    expect(r.basis).toBe("uncalibrated");
  });

  test("empty states → identity", () => {
    expect(calibrationFactorForStates([]).factor).toBe(1);
  });

  test("applyCalibration is a no-op while the table is empty", () => {
    const r = applyCalibration(0.31, ["Gujarat"]);
    expect(r.calibratedCf).toBeCloseTo(0.31, 6);
    expect(r.isCalibrated).toBe(false);
  });

  test("applies + averages known factors, clamps to [0,1]", () => {
    // Inject a temporary factor table to exercise the active path without
    // shipping fabricated numbers in STATE_CALIBRATION.
    const table = STATE_CALIBRATION as Record<string, number>;
    table.TestA = 0.9;
    table.TestB = 1.1;
    try {
      const single = applyCalibration(0.4, ["TestA"]);
      expect(single.factor).toBeCloseTo(0.9, 6);
      expect(single.calibratedCf).toBeCloseTo(0.36, 6);
      expect(single.isCalibrated).toBe(true);

      const avg = calibrationFactorForStates(["TestA", "TestB"]);
      expect(avg.factor).toBeCloseTo(1.0, 6);

      expect(applyCalibration(0.95, ["TestB"]).calibratedCf).toBeLessThanOrEqual(1);
    } finally {
      delete table.TestA;
      delete table.TestB;
    }
  });
});
