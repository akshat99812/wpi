/**
 * Integration tests for AOI → policy context (policyContext.ts, PR3).
 *
 * Live DB only (needs the seeded wce.jurisdiction + wce.policy_value from
 * migration 004 / seed-policy.ts). Mirrors validation.test.ts: skipped unless
 * DATABASE_URL is set and SKIP_LIVE !== "1".
 */

import { describe, expect, test } from "bun:test";

import { getPolicyContext } from "./policyContext";
import type { GeoJsonPolygon } from "./types";

const isLiveDb = Boolean(process.env.DATABASE_URL) && process.env.SKIP_LIVE !== "1";
const liveTest = isLiveDb ? test : test.skip;

// Interior Tamil Nadu (Madurai ≈ 9.93°N, 78.12°E) — solidly inside the TN polygon.
const TN_AOI: GeoJsonPolygon = {
  type: "Polygon",
  coordinates: [
    [
      [78.05, 9.85],
      [78.15, 9.85],
      [78.15, 9.95],
      [78.05, 9.95],
      [78.05, 9.85],
    ],
  ],
};

// Open Indian Ocean (~4°N, 73°E) — intersects no Indian state.
const OCEAN_AOI: GeoJsonPolygon = {
  type: "Polygon",
  coordinates: [
    [
      [73.0, 4.0],
      [73.1, 4.0],
      [73.1, 4.1],
      [73.0, 4.1],
      [73.0, 4.0],
    ],
  ],
};

describe("getPolicyContext against the live policy DB", () => {
  liveTest("an interior-TN AOI resolves Tamil Nadu + national policy", async () => {
    const ctx = await getPolicyContext(TN_AOI);
    expect(ctx).not.toBeNull();
    expect(ctx!.stateCodes).toContain("TN");
    expect(ctx!.compare.jurisdictions).toContain("national");
    expect(ctx!.compare.jurisdictions).toContain("TN");
    expect(Object.keys(ctx!.compare.matrix).length).toBeGreaterThan(0);
  });

  liveTest("an offshore AOI degrades to national-only", async () => {
    const ctx = await getPolicyContext(OCEAN_AOI);
    expect(ctx).not.toBeNull();
    expect(ctx!.stateCodes).toEqual([]);
    expect(ctx!.compare.jurisdictions).toEqual(["national"]);
  });

  liveTest("asOf is an ISO date (YYYY-MM-DD) or null", async () => {
    const ctx = await getPolicyContext(TN_AOI);
    if (ctx!.asOf !== null) {
      expect(ctx!.asOf).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });

  liveTest("the column order is national-first, matching the codes passed", async () => {
    const ctx = await getPolicyContext(TN_AOI);
    expect(ctx!.compare.jurisdictions[0]).toBe("national");
  });
});
