import { describe, expect, test } from "bun:test";
import {
  computeGrid,
  EHV_MIN_KV,
  GRID_SEARCH_PADS_KM,
  maxVoltageKvOf,
  newTileCoords,
  padBboxKm,
  parseVoltageKv,
  pointToSegmentKm,
  summarizeGridFeatures,
  tileKey,
  type PowerLineFeature,
  type SubstationFeature,
} from "./grid";
import { squareRingAround } from "./mercator";
import { validateAoi } from "./geometry";

const KM_PER_DEG = 111.195; // EARTH_RADIUS_KM · π/180

function lineOf(
  parts: [number, number][][],
  voltageKv: number | null,
  maxVoltageKv: number | null = voltageKv,
): PowerLineFeature {
  return { id: null, voltageKv, maxVoltageKv, parts };
}

function substationOf(
  lon: number,
  lat: number,
  voltageKv: number | null,
  name: string | null = null,
  maxVoltageKv: number | null = voltageKv,
): SubstationFeature {
  return { id: null, name, voltageKv, maxVoltageKv, lon, lat };
}

describe("parseVoltageKv", () => {
  test("passes numeric kV through", () => {
    expect(parseVoltageKv(400)).toBe(400);
  });

  test("parses float-noise substation strings", () => {
    expect(parseVoltageKv("110.0000000000000000")).toBe(110);
  });

  test("takes the max of semicolon-joined multi-voltage strings", () => {
    expect(parseVoltageKv("220;400")).toBe(400);
  });

  test("returns null for garbage, zero, negative, empty, null", () => {
    expect(parseVoltageKv("substation")).toBeNull();
    expect(parseVoltageKv(0)).toBeNull();
    expect(parseVoltageKv(-5)).toBeNull();
    expect(parseVoltageKv("")).toBeNull();
    expect(parseVoltageKv(null)).toBeNull();
  });
});

describe("maxVoltageKvOf", () => {
  test("takes the max across voltage, voltage_2, voltage_3", () => {
    expect(maxVoltageKvOf({ voltage: 110, voltage_2: "220", voltage_3: 66 })).toBe(220);
  });

  test("returns null when no prop parses", () => {
    expect(maxVoltageKvOf({})).toBeNull();
    expect(maxVoltageKvOf({ voltage: "?" })).toBeNull();
  });
});

describe("pointToSegmentKm", () => {
  test("point abeam the segment measures perpendicular distance", () => {
    // Segment along lat=0.1° from lon −1…1; ref at the origin sits abeam.
    const d = pointToSegmentKm(0, 0, 0.1, -1, 0.1, 1);
    expect(d).toBeCloseTo(0.1 * KM_PER_DEG, 1);
  });

  test("point beyond an endpoint measures distance to that endpoint", () => {
    // Segment receding to the northeast; nearest point is endpoint A (1,1).
    const d = pointToSegmentKm(0, 0, 1, 1, 2, 1);
    expect(d).toBeCloseTo(Math.SQRT2 * KM_PER_DEG, 0);
  });

  test("degenerate zero-length segment collapses to point distance", () => {
    const d = pointToSegmentKm(0, 0, 0.5, 0, 0.5, 0);
    expect(d).toBeCloseTo(0.5 * KM_PER_DEG, 1);
  });
});

describe("padBboxKm", () => {
  test("grows every side by the pad in flat-earth degrees at the mid-lat", () => {
    const [w, s, e, n] = padBboxKm([77, 8, 78, 9], 10);
    const dLat = 10 / 110.574;
    const dLon = 10 / (111.32 * Math.cos((8.5 * Math.PI) / 180));
    expect(w).toBeCloseTo(77 - dLon, 6);
    expect(s).toBeCloseTo(8 - dLat, 6);
    expect(e).toBeCloseTo(78 + dLon, 6);
    expect(n).toBeCloseTo(9 + dLat, 6);
  });
});

describe("newTileCoords", () => {
  test("returns only tiles not in `seen` and never mutates it", () => {
    // Arrange: cover a small bbox, mark one tile as seen.
    const bbox: [number, number, number, number] = [77.5, 8.2, 77.6, 8.3];
    const first = newTileCoords(bbox, 10, new Set());
    expect(first.length).toBeGreaterThan(0);
    const seen = new Set([tileKey(first[0]!.x, first[0]!.y)]);

    // Act
    const rest = newTileCoords(bbox, 10, seen);

    // Assert
    expect(rest.length).toBe(first.length - 1);
    expect(rest.some((c) => tileKey(c.x, c.y) === tileKey(first[0]!.x, first[0]!.y))).toBe(false);
    expect(seen.size).toBe(1);
  });
});

describe("summarizeGridFeatures", () => {
  const centroid: [number, number] = [77.55, 8.26];

  test("picks the nearest substation and line, reporting primary voltage", () => {
    // Arrange: near sub at ~1.1 km north; far sub at ~11 km.
    const subs = [
      substationOf(77.55, 8.27, 110, "Near"),
      substationOf(77.55, 8.36, 400, "Far"),
    ];
    // Line passing ~2.2 km east of the centroid, untagged voltage.
    const lines = [
      lineOf([[[77.57, 8.0], [77.57, 8.5]]], null),
    ];

    // Act
    const result = summarizeGridFeatures(centroid, lines, subs);

    // Assert
    expect(result.nearestSubstation?.name).toBe("Near");
    expect(result.nearestSubstation?.voltageKv).toBe(110);
    expect(result.nearestSubstation?.distanceKm).toBeCloseTo(1.1, 0);
    // Null-voltage line is KEPT and reported with voltageKv null.
    expect(result.nearestLine).not.toBeNull();
    expect(result.nearestLine?.voltageKv).toBeNull();
    expect(result.dataNote).toContain("OSM");
  });

  test("EHV classification uses maxVoltageKv (voltage_2/3), not the primary", () => {
    // Substation whose primary is 110 but voltage_2 carries 400 — EHV.
    const subs = [
      substationOf(77.55, 8.27, 110, "Dual", 400),
    ];

    const result = summarizeGridFeatures(centroid, [], subs);

    expect(result.nearestSubstation?.voltageKv).toBe(110);
    expect(result.ehvWithin25Km).toBe(true);
    expect(result.nearestEhvKm).toBeCloseTo(1.1, 0);
  });

  test("sub-EHV voltages never set the EHV flag", () => {
    const subs = [substationOf(77.55, 8.27, EHV_MIN_KV - 1, "SubEhv")];

    const result = summarizeGridFeatures(centroid, [], subs);

    expect(result.ehvWithin25Km).toBe(false);
    expect(result.nearestEhvKm).toBeNull();
  });

  test("EHV beyond 25 km reports distance but not the within-25 flag", () => {
    // ~55.6 km north — EHV exists, flag stays false.
    const subs = [substationOf(77.55, 8.76, 400, "FarEhv")];

    const result = summarizeGridFeatures(centroid, [], subs);

    expect(result.ehvWithin25Km).toBe(false);
    expect(result.nearestEhvKm).toBeCloseTo(55.6, 0);
  });

  test("empty inputs produce the all-null degraded shape", () => {
    const result = summarizeGridFeatures(centroid, [], []);

    expect(result.nearestSubstation).toBeNull();
    expect(result.nearestLine).toBeNull();
    expect(result.ehvWithin25Km).toBe(false);
    expect(result.nearestEhvKm).toBeNull();
  });
});

describe("constants", () => {
  test("search pads expand monotonically to the 100 km cap", () => {
    expect([...GRID_SEARCH_PADS_KM]).toEqual([10, 25, 50, 100]);
  });
});

describe("computeGrid (live)", () => {
  // VERIFIED.md §4: the "Muppandal" 110 kV substation sits ~0.45 km from the
  // reference point and 400 kV lines cross the same z10 tile.
  test.skipIf(process.env.SKIP_LIVE === "1")(
    "finds the Muppandal substation and a nearby line",
    async () => {
      const aoi = validateAoi({
        type: "Polygon",
        coordinates: [squareRingAround(77.55, 8.26, 5)],
      });

      const result = await computeGrid(aoi);

      expect(result.nearestSubstation).not.toBeNull();
      expect(result.nearestSubstation!.distanceKm).toBeLessThan(5);
      expect(result.nearestLine).not.toBeNull();
      expect(result.nearestLine!.distanceKm).toBeLessThan(5);
      console.log("[grid.live] Muppandal:", JSON.stringify(result));
    },
    30_000,
  );
});
