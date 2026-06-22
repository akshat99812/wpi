import { describe, expect, test } from "bun:test";
import {
  computeContext,
  computeSizing,
  farmOverlap,
  joinStateCapacities,
  pointInGeometry,
  statesForAoi,
  terrainStats,
  type CapacityRow,
} from "./context";
import { developableFraction } from "./developable";
import { buildAoiMask, type PatchFrame } from "./mask";
import { patchPixelCenterLngLat } from "./mercator";
import type { AoiMask, LayerPatch, ValidatedAoi } from "./types";

// Muppandal's z10 tile — keeps synthetic geometry on a realistic latitude.
const FRAME: PatchFrame = {
  zoom: 10,
  minTileX: 732,
  minTileY: 488,
  widthPx: 8,
  heightPx: 8,
};

const MERCATOR_M_PER_PX_Z0 = 156_543.033_92;
const DEG = Math.PI / 180;

/** Ring covering all pixel centers of FRAME cols [c0..c1] × all rows. */
function ringOverCols(c0: number, c1: number): [number, number][] {
  const [lonW] = patchPixelCenterLngLat(FRAME.minTileX, FRAME.minTileY, c0, 0, FRAME.zoom);
  const [lonE] = patchPixelCenterLngLat(FRAME.minTileX, FRAME.minTileY, c1, 0, FRAME.zoom);
  const [, latN] = patchPixelCenterLngLat(FRAME.minTileX, FRAME.minTileY, 0, 0, FRAME.zoom);
  const [, latS] = patchPixelCenterLngLat(
    FRAME.minTileX, FRAME.minTileY, 0, FRAME.heightPx - 1, FRAME.zoom,
  );
  // Half-pixel margin so every center in range is strictly inside.
  const dLon = (lonE - lonW) / Math.max(1, 2 * (c1 - c0));
  const dLat = (latN - latS) / Math.max(1, 2 * (FRAME.heightPx - 1));
  const w = lonW - dLon;
  const e = lonE + dLon;
  const s = latS - dLat;
  const n = latN + dLat;
  return [[w, s], [e, s], [e, n], [w, n], [w, s]];
}

function bboxOfRing(ring: [number, number][]): [number, number, number, number] {
  const lons = ring.map((v) => v[0]);
  const lats = ring.map((v) => v[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

function aoiOver(ring: [number, number][]): ValidatedAoi {
  const bbox = bboxOfRing(ring);
  return {
    ring,
    areaKm2: 25,
    centroid: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
    bbox,
    isPointMode: false,
  };
}

const SQUARE_GEOMETRY = {
  type: "Polygon" as const,
  coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
};

describe("pointInGeometry", () => {
  test("classifies inside/outside a simple square", () => {
    expect(pointInGeometry(5, 5, SQUARE_GEOMETRY)).toBe(true);
    expect(pointInGeometry(15, 5, SQUARE_GEOMETRY)).toBe(false);
  });

  test("a hole excludes points by even-odd parity", () => {
    const withHole = {
      type: "Polygon" as const,
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
      ],
    };
    expect(pointInGeometry(5, 5, withHole)).toBe(false);
    expect(pointInGeometry(2, 2, withHole)).toBe(true);
  });

  test("MultiPolygon checks every part", () => {
    const multi = {
      type: "MultiPolygon" as const,
      coordinates: [
        [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]],
      ],
    };
    expect(pointInGeometry(5.5, 5.5, multi)).toBe(true);
    expect(pointInGeometry(3, 3, multi)).toBe(false);
  });
});

describe("statesForAoi", () => {
  const states = {
    features: [
      { properties: { ST_NM: "Alpha" }, geometry: SQUARE_GEOMETRY },
      {
        properties: { ST_NM: "Beta" },
        geometry: {
          type: "Polygon" as const,
          coordinates: [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]],
        },
      },
    ],
  };

  test("returns the states hit by centroid or vertices, sorted", () => {
    const aoi = {
      ring: [[8, 2], [12, 2], [12, 4], [8, 4], [8, 2]] as [number, number][],
      centroid: [9.5, 3] as [number, number],
    };

    expect(statesForAoi(aoi, states)).toEqual(["Alpha", "Beta"]);
  });

  test("returns [] when nothing is hit", () => {
    const aoi = {
      ring: [[30, 30], [31, 30], [31, 31], [30, 31], [30, 30]] as [number, number][],
      centroid: [30.5, 30.5] as [number, number],
    };

    expect(statesForAoi(aoi, states)).toEqual([]);
  });
});

describe("joinStateCapacities", () => {
  const rows: CapacityRow[] = [
    { state: "Tamil Nadu", installedMw: 11740, potentialMw: 95100 },
  ];

  test("joins matching rows and nulls the misses", () => {
    const joined = joinStateCapacities(["Tamil Nadu", "Goa"], rows);

    expect(joined).toEqual([
      { name: "Tamil Nadu", installedMw: 11740, potentialMw: 95100 },
      { name: "Goa", installedMw: null, potentialMw: null },
    ]);
  });

  test("null rows (DB down) → all capacities null, names kept", () => {
    const joined = joinStateCapacities(["Tamil Nadu"], null);

    expect(joined).toEqual([
      { name: "Tamil Nadu", installedMw: null, potentialMw: null },
    ]);
  });
});

describe("farmOverlap", () => {
  const aoiRing = ringOverCols(0, FRAME.widthPx - 1);
  const aoiMask = buildAoiMask(aoiRing, FRAME);
  const aoi = { bbox: bboxOfRing(aoiRing) };

  test("identical farm covers the whole AOI (overlap ≈ 1, count 1)", () => {
    const farms = {
      features: [{ geometry: { type: "Polygon" as const, coordinates: [aoiRing] } }],
    };

    const result = farmOverlap(aoi, farms, FRAME, aoiMask);

    expect(result.count).toBe(1);
    expect(result.overlapFraction).toBeCloseTo(1, 2);
  });

  test("half-width farm yields ~0.5 overlap", () => {
    const halfRing = ringOverCols(0, FRAME.widthPx / 2 - 1);
    const farms = {
      features: [{ geometry: { type: "Polygon" as const, coordinates: [halfRing] } }],
    };

    const result = farmOverlap(aoi, farms, FRAME, aoiMask);

    expect(result.count).toBe(1);
    expect(result.overlapFraction).toBeGreaterThan(0.3);
    expect(result.overlapFraction).toBeLessThan(0.7);
  });

  test("far-away farm is bbox-filtered out (count 0, overlap 0)", () => {
    const farms = {
      features: [
        {
          geometry: {
            type: "Polygon" as const,
            coordinates: [[[70, 20], [70.1, 20], [70.1, 20.1], [70, 20.1], [70, 20]]],
          },
        },
      ],
    };

    const result = farmOverlap(aoi, farms, FRAME, aoiMask);

    expect(result).toEqual({ count: 0, overlapFraction: 0 });
  });
});

describe("terrainStats", () => {
  function maskAll(): AoiMask {
    const total = FRAME.widthPx * FRAME.heightPx;
    return {
      widthPx: FRAME.widthPx,
      heightPx: FRAME.heightPx,
      inside: new Uint8Array(total).fill(1),
      insideCount: total,
    };
  }

  function elevationPatch(fill: (row: number, col: number) => number): LayerPatch {
    const data = new Float32Array(FRAME.widthPx * FRAME.heightPx);
    for (let r = 0; r < FRAME.heightPx; r++) {
      for (let c = 0; c < FRAME.widthPx; c++) {
        data[r * FRAME.widthPx + c] = fill(r, c);
      }
    }
    return { ...FRAME, data };
  }

  test("flat plane → zero slope, exact elevation stats", () => {
    const patch = elevationPatch(() => 250);

    const { terrain, slope90thDeg } = terrainStats(patch, maskAll());

    expect(terrain).not.toBeNull();
    expect(terrain!.elevMean).toBe(250);
    expect(terrain!.elevMin).toBe(250);
    expect(terrain!.elevMax).toBe(250);
    expect(terrain!.slopeMeanDeg).toBe(0);
    expect(terrain!.slopeSteep10Deg).toBe(0);
    expect(slope90thDeg).toBe(0);
  });

  test("east-west ramp rising one pixel-size per pixel → ≈45°", () => {
    // Build the ramp with the SAME per-row pixel size the implementation
    // derives, so dz/dx is exactly 1 on every row.
    const patch = elevationPatch((row, col) => {
      const [, lat] = patchPixelCenterLngLat(
        FRAME.minTileX, FRAME.minTileY, 0, row, FRAME.zoom,
      );
      const pixelMeters = (MERCATOR_M_PER_PX_Z0 * Math.cos(lat * DEG)) / 2 ** FRAME.zoom;
      return col * pixelMeters;
    });

    const { terrain, slope90thDeg } = terrainStats(patch, maskAll());

    expect(terrain).not.toBeNull();
    expect(terrain!.slopeMeanDeg).toBeCloseTo(45, 0);
    expect(slope90thDeg).toBeCloseTo(45, 0);
  });

  test("all-NaN elevation → terrain null", () => {
    const patch = elevationPatch(() => Number.NaN);

    const { terrain, slope90thDeg } = terrainStats(patch, maskAll());

    expect(terrain).toBeNull();
    expect(slope90thDeg).toBeNull();
  });
});

describe("computeSizing (CF-engine Phase A developable model)", () => {
  test("no exclusions/slope → packing-only developable fraction (0.85)", () => {
    // 100 · (1 − 0.18) · [(1−0)·(1−0)·0.85] = 69.7 km² → 348.5 MW →
    // 348.5 · 8.76 · 0.34 ≈ 1038.2
    const sizing = computeSizing(100, 0.18, 0.34, null, null);

    expect(sizing.developableFraction).toBeCloseTo(0.85, 3);
    expect(sizing.usableKm2).toBeCloseTo(69.7, 1);
    expect(sizing.capacityMw).toBeCloseTo(348.5, 0);
    expect(sizing.energyGwh).toBeCloseTo(1038.2, 0);
    expect(sizing.excludedFraction).toBeNull();
    expect(sizing.steepFraction).toBeNull();
    expect(sizing.assumptions).toContain("5 MW/km² density");
    expect(sizing.assumptions).toContain("legal exclusions unavailable (not subtracted)");
  });

  test("exclusions + slope shrink the developable fraction", () => {
    // devFrac = (1−0.2)·(1−0.1)·0.85 = 0.612 → usable 61.2 → 306 MW
    const sizing = computeSizing(100, 0, 0.34, 0.2, 0.1);

    expect(sizing.developableFraction).toBeCloseTo(0.612, 3);
    expect(sizing.capacityMw).toBeCloseTo(306, 0);
    expect(sizing.excludedFraction).toBe(0.2);
    expect(sizing.steepFraction).toBe(0.1);
    expect(sizing.assumptions).toContain("hard (red) legal exclusions removed");
  });

  test("AOI fully inside existing farms → ~0 MW, not an error", () => {
    const sizing = computeSizing(25, 1, 0.6, 0.3, 0.05);

    expect(sizing.capacityMw).toBe(0);
    expect(sizing.energyGwh).toBe(0);
  });

  test("null cfIec3 → zero energy, capacity unaffected", () => {
    const sizing = computeSizing(100, 0, null, null, null);

    expect(sizing.capacityMw).toBe(425); // 100 · 0.85 · 5
    expect(sizing.energyGwh).toBe(0);
  });
});

describe("developableFraction (CF-engine Phase A)", () => {
  test("null inputs degrade to packing-only (DB down / no slope)", () => {
    expect(developableFraction(null, null)).toBeCloseTo(0.85, 5);
  });

  test("exclusion + slope compound multiplicatively", () => {
    expect(developableFraction(0.5, 0.5)).toBeCloseTo(0.5 * 0.5 * 0.85, 5);
  });

  test("clamps out-of-range inputs", () => {
    expect(developableFraction(1.5, -0.2)).toBe(0); // excl≥1 → 0 developable
    expect(developableFraction(0, 0)).toBeCloseTo(0.85, 5);
  });
});

describe("computeContext (injected deps)", () => {
  const aoiRing = ringOverCols(0, FRAME.widthPx - 1);
  const aoi = aoiOver(aoiRing);
  const aoiMask = buildAoiMask(aoiRing, FRAME);
  const flatElevation: LayerPatch = {
    ...FRAME,
    data: new Float32Array(FRAME.widthPx * FRAME.heightPx).fill(100),
  };

  const statesGeo = {
    features: [
      {
        properties: { ST_NM: "Testland" },
        geometry: {
          type: "Polygon" as const,
          // Generously covers the FRAME neighborhood (around 77.3E, 8.3N).
          coordinates: [[[77, 8], [78, 8], [78, 9], [77, 9], [77, 8]]],
        },
      },
    ],
  };

  test("assembles all sub-results", async () => {
    const result = await computeContext(
      aoi,
      { elevation: flatElevation, aoiMask, cfIec3: 0.4 },
      {
        loadStatesGeo: async () => statesGeo,
        loadCapacityRows: async () => [
          { state: "Testland", installedMw: 1000, potentialMw: 5000 },
        ],
        loadFarmsGeo: async () => ({
          features: [
            { geometry: { type: "Polygon" as const, coordinates: [aoiRing] } },
          ],
        }),
        loadExclusionCoverage: async () => ({
          excludedKm2: 5,
          excludedFraction: 0.1,
          amberKm2: 2,
          amberFraction: 0.04,
          categories: [
            { layerCode: "forest_legal", cls: "red", km2: 5, fraction: 0.1 },
            { layerCode: "esz_default_10km", cls: "amber", km2: 2, fraction: 0.04 },
          ],
        }),
        loadTurbineInventory: async () => ({ count: 12, ratedMw: 18, ratedCount: 9 }),
      },
    );

    expect(result.states).toEqual([
      { name: "Testland", installedMw: 1000, potentialMw: 5000 },
    ]);
    expect(result.windfarms.count).toBe(1);
    expect(result.windfarms.overlapFraction).toBeCloseTo(1, 2);
    expect(result.terrain?.elevMean).toBe(100);
    expect(result.slope90thDeg).toBe(0);
    // Injected exclusion coverage flows through to sizing.
    expect(result.sizing.excludedFraction).toBe(0.1);
    // Full overlap → sizing collapses to ~0 (the §2.5 farm-covered case).
    expect(result.sizing.capacityMw).toBeCloseTo(0, 1);
    // Turbine inventory flows through verbatim.
    expect(result.turbines).toEqual({ count: 12, ratedMw: 18, ratedCount: 9 });
    // Exclusion breakdown is shaped: red/amber totals + per-kind categories.
    expect(result.exclusions).toEqual({
      redFraction: 0.1,
      amberFraction: 0.04,
      categories: [
        { layerCode: "forest_legal", cls: "red", fraction: 0.1, km2: 5 },
        { layerCode: "esz_default_10km", cls: "amber", fraction: 0.04, km2: 2 },
      ],
    });
  });

  test("exclusion coverage without breakdown fields → totals only, empty categories", async () => {
    // A legacy/partial coverage object (no amber, no categories) must still
    // shape into a valid `exclusions` block, not throw.
    const result = await computeContext(
      aoi,
      { elevation: flatElevation, aoiMask, cfIec3: 0.4 },
      {
        loadStatesGeo: async () => statesGeo,
        loadCapacityRows: async () => null,
        loadFarmsGeo: async () => null,
        loadExclusionCoverage: async () => ({ excludedKm2: 5, excludedFraction: 0.1 }),
        loadTurbineInventory: async () => null,
      },
    );
    expect(result.exclusions).toEqual({
      redFraction: 0.1,
      amberFraction: 0,
      categories: [],
    });
    expect(result.turbines).toBeNull();
  });

  test("degrades cleanly when every loader returns null", async () => {
    const result = await computeContext(
      aoi,
      { elevation: flatElevation, aoiMask, cfIec3: null },
      {
        loadStatesGeo: async () => null,
        loadCapacityRows: async () => null,
        loadFarmsGeo: async () => null,
        loadExclusionCoverage: async () => null,
        loadTurbineInventory: async () => null,
      },
    );

    expect(result.states).toEqual([]);
    expect(result.windfarms).toEqual({ count: 0, overlapFraction: 0 });
    expect(result.sizing.energyGwh).toBe(0);
    expect(result.sizing.capacityMw).toBeGreaterThan(0);
    // Null loaders → both new sections degrade to null, never throw.
    expect(result.turbines).toBeNull();
    expect(result.exclusions).toBeNull();
  });
});
