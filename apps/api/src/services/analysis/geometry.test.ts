/**
 * Tests for geometry.ts — request-geometry validation + canonicalization.
 * Covers every GeometryErrorCode, the point-mode fingerprint, auto-closing,
 * dedupe, holes, and cache-key canonicalization stability.
 */

import { describe, expect, test } from "bun:test";

import {
  analyzeRequestSchema,
  canonicalGeometryString,
  geoJsonPolygonSchema,
  validateAoi,
} from "./geometry";
import { squareRingAround } from "./mercator";
import {
  GeometryError,
  type GeoJsonPolygon,
  type GeometryErrorCode,
} from "./types";

// ── Fixtures + helpers ──────────────────────────────────────────────────────

const MUPPANDAL_LON = 77.55;
const MUPPANDAL_LAT = 8.26;
const KARACHI_LON = 67.0011;
const KARACHI_LAT = 24.8607;

function polygonOf(ring: [number, number][]): GeoJsonPolygon {
  return { type: "Polygon", coordinates: [ring.map(([lon, lat]) => [lon, lat])] };
}

/** Closed circle-ish ring with `vertexCount` DISTINCT vertices. */
function circleRing(
  centerLon: number,
  centerLat: number,
  radiusDeg: number,
  vertexCount: number,
): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < vertexCount; i++) {
    const angle = (2 * Math.PI * i) / vertexCount;
    ring.push([
      centerLon + radiusDeg * Math.cos(angle),
      centerLat + radiusDeg * Math.sin(angle),
    ]);
  }
  const first = ring[0];
  if (first === undefined) throw new Error("circleRing fixture needs vertexCount >= 1");
  return [...ring, [first[0], first[1]]];
}

function expectGeometryError(geometry: GeoJsonPolygon, code: GeometryErrorCode): void {
  let caught: unknown;
  try {
    validateAoi(geometry);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(GeometryError);
  expect((caught as GeometryError).code).toBe(code);
}

// ── Zod schema ──────────────────────────────────────────────────────────────

describe("analyzeRequestSchema", () => {
  test("accepts a valid polygon request body", () => {
    // Arrange
    const body = { geometry: polygonOf(squareRingAround(MUPPANDAL_LON, MUPPANDAL_LAT, 5)) };

    // Act
    const result = analyzeRequestSchema.safeParse(body);

    // Assert
    expect(result.success).toBe(true);
  });

  test("rejects a body without geometry", () => {
    expect(analyzeRequestSchema.safeParse({}).success).toBe(false);
  });

  test("rejects geometry whose type is not Polygon", () => {
    const body = { geometry: { type: "Point", coordinates: [77.55, 8.26] } };
    expect(analyzeRequestSchema.safeParse(body).success).toBe(false);
  });

  test("rejects a polygon with zero rings", () => {
    const body = { geometry: { type: "Polygon", coordinates: [] } };
    expect(analyzeRequestSchema.safeParse(body).success).toBe(false);
  });

  test("rejects vertices that are not [lon, lat] pairs", () => {
    const body = { geometry: { type: "Polygon", coordinates: [[[77.55], [77.6, 8.3]]] } };
    expect(analyzeRequestSchema.safeParse(body).success).toBe(false);
  });

  test("rejects non-finite coordinate values", () => {
    const infinityBody = {
      geometry: { type: "Polygon", coordinates: [[[77.55, Infinity], [77.6, 8.3], [77.6, 8.2], [77.55, 8.26]]] },
    };
    const nanBody = {
      geometry: { type: "Polygon", coordinates: [[[NaN, 8.26], [77.6, 8.3], [77.6, 8.2], [77.55, 8.26]]] },
    };
    expect(analyzeRequestSchema.safeParse(infinityBody).success).toBe(false);
    expect(analyzeRequestSchema.safeParse(nanBody).success).toBe(false);
  });

  test("rejects string coordinates", () => {
    const body = {
      geometry: { type: "Polygon", coordinates: [[["77.55", "8.26"], [77.6, 8.3], [77.6, 8.2]]] },
    };
    expect(geoJsonPolygonSchema.safeParse(body.geometry).success).toBe(false);
  });
});

// ── validateAoi happy paths ─────────────────────────────────────────────────

describe("validateAoi — happy paths", () => {
  test("validates a Muppandal 5x5 km point-mode square", () => {
    // Arrange
    const ring = squareRingAround(MUPPANDAL_LON, MUPPANDAL_LAT, 5);

    // Act
    const aoi = validateAoi(polygonOf(ring));

    // Assert — area ≈ 25 ± 1, fingerprinted as point mode
    expect(aoi.isPointMode).toBe(true);
    expect(aoi.areaKm2).toBeGreaterThanOrEqual(24);
    expect(aoi.areaKm2).toBeLessThanOrEqual(26);
    expect(aoi.centroid[0]).toBeCloseTo(MUPPANDAL_LON, 3);
    expect(aoi.centroid[1]).toBeCloseTo(MUPPANDAL_LAT, 3);
    // Ring is closed, canonical, 4 corners + closing repeat
    expect(aoi.ring).toHaveLength(5);
    expect(aoi.ring[0]).toEqual(aoi.ring[aoi.ring.length - 1] as [number, number]);
    // bbox is [W, S, E, N]
    const [west, south, east, north] = aoi.bbox;
    expect(west).toBeLessThan(east);
    expect(south).toBeLessThan(north);
    expect(west).toBeCloseTo(MUPPANDAL_LON - (east - MUPPANDAL_LON), 4);
  });

  test("marks a hand-drawn irregular polygon as not point mode", () => {
    // Arrange — irregular pentagon near Coimbatore
    const ring: [number, number][] = [
      [77.0, 11.0],
      [77.15, 11.02],
      [77.18, 11.15],
      [77.05, 11.2],
      [76.95, 11.1],
      [77.0, 11.0],
    ];

    // Act
    const aoi = validateAoi(polygonOf(ring));

    // Assert
    expect(aoi.isPointMode).toBe(false);
    expect(aoi.areaKm2).toBeGreaterThan(1);
    expect(aoi.areaKm2).toBeLessThan(2500);
  });

  test("auto-closes an unclosed ring", () => {
    // Arrange — drop the closing repeat from a valid square
    const closed = squareRingAround(MUPPANDAL_LON, MUPPANDAL_LAT, 5);
    const unclosed = closed.slice(0, -1);

    // Act
    const aoi = validateAoi(polygonOf(unclosed));

    // Assert — re-closed and otherwise identical to the closed version
    expect(aoi.ring).toHaveLength(5);
    expect(aoi.ring[0]).toEqual(aoi.ring[4] as [number, number]);
    expect(aoi.isPointMode).toBe(true);
  });

  test("dedupes consecutive duplicate vertices", () => {
    // Arrange — duplicate the first corner of a valid square
    const closed = squareRingAround(MUPPANDAL_LON, MUPPANDAL_LAT, 5);
    const corner = closed[0] as [number, number];
    const withDuplicate: [number, number][] = [[corner[0], corner[1]], ...closed];

    // Act
    const aoi = validateAoi(polygonOf(withDuplicate));

    // Assert — duplicate removed, square still fingerprints as point mode
    expect(aoi.ring).toHaveLength(5);
    expect(aoi.isPointMode).toBe(true);
  });

  test("ignores interior hole rings and analyzes the outer footprint", () => {
    // Arrange — 5x5 outer ring with a 1x1 hole
    const outer = squareRingAround(MUPPANDAL_LON, MUPPANDAL_LAT, 5);
    const hole = squareRingAround(MUPPANDAL_LON, MUPPANDAL_LAT, 1);
    const geometry: GeoJsonPolygon = {
      type: "Polygon",
      coordinates: [outer.map(([lon, lat]) => [lon, lat]), hole.map(([lon, lat]) => [lon, lat])],
    };

    // Act
    const aoi = validateAoi(geometry);

    // Assert — hole does not reduce the area
    expect(aoi.areaKm2).toBeGreaterThanOrEqual(24);
    expect(aoi.areaKm2).toBeLessThanOrEqual(26);
    expect(aoi.isPointMode).toBe(true);
  });

  test("accepts a ring with exactly 100 distinct vertices (cap boundary)", () => {
    // Arrange — closing repeat must NOT count against the cap
    const ring = circleRing(78.0, 15.0, 0.1, 100);

    // Act
    const aoi = validateAoi(polygonOf(ring));

    // Assert
    expect(aoi.isPointMode).toBe(false);
    expect(aoi.areaKm2).toBeGreaterThan(1);
  });
});

// ── validateAoi error codes ─────────────────────────────────────────────────

describe("validateAoi — error codes", () => {
  test("throws SELF_INTERSECTING for a bowtie ring", () => {
    const bowtie: [number, number][] = [
      [77.0, 15.0],
      [77.2, 15.2],
      [77.2, 15.0],
      [77.0, 15.2],
      [77.0, 15.0],
    ];
    expectGeometryError(polygonOf(bowtie), "SELF_INTERSECTING");
  });

  test("throws AREA_TOO_LARGE for an AOI above 2500 km2", () => {
    // 60x60 km square ≈ 3600 km²
    const ring = squareRingAround(76.5, 15.0, 60);
    expectGeometryError(polygonOf(ring), "AREA_TOO_LARGE");
  });

  test("throws AREA_TOO_SMALL for an AOI below 1 km2", () => {
    // 0.5x0.5 km square ≈ 0.25 km²
    const ring = squareRingAround(MUPPANDAL_LON, MUPPANDAL_LAT, 0.5);
    expectGeometryError(polygonOf(ring), "AREA_TOO_SMALL");
  });

  test("throws OUT_OF_INDIA for an AOI around Karachi", () => {
    const ring = squareRingAround(KARACHI_LON, KARACHI_LAT, 5);
    expectGeometryError(polygonOf(ring), "OUT_OF_INDIA");
  });

  test("throws TOO_MANY_VERTICES for a ring with 101 distinct vertices", () => {
    const ring = circleRing(78.0, 15.0, 0.1, 101);
    expectGeometryError(polygonOf(ring), "TOO_MANY_VERTICES");
  });

  test("throws INVALID_GEOMETRY when the ring has fewer than 4 points after closing", () => {
    const twoPoints: [number, number][] = [
      [77.0, 15.0],
      [77.1, 15.0],
    ];
    expectGeometryError(polygonOf(twoPoints), "INVALID_GEOMETRY");
  });

  test("throws INVALID_GEOMETRY when canonicalization collapses the ring to a point", () => {
    // All vertices differ only at the 7th decimal → identical after 6-dp rounding
    const collapsing: [number, number][] = [
      [77.0, 15.0],
      [77.0000001, 15.0],
      [77.0, 15.0000001],
      [77.0, 15.0],
    ];
    expectGeometryError(polygonOf(collapsing), "INVALID_GEOMETRY");
  });

  test("throws INVALID_GEOMETRY for a polygon with an empty outer ring", () => {
    const geometry = { type: "Polygon", coordinates: [[]] } as unknown as GeoJsonPolygon;
    expectGeometryError(geometry, "INVALID_GEOMETRY");
  });

  test("throws INVALID_GEOMETRY for a non-polygon geometry object", () => {
    const geometry = { type: "LineString", coordinates: [[77, 15], [78, 16]] } as unknown as GeoJsonPolygon;
    expectGeometryError(geometry, "INVALID_GEOMETRY");
  });
});

// ── Point-mode fingerprint edges ────────────────────────────────────────────

describe("validateAoi — point-mode fingerprint", () => {
  test("axis-aligned rectangle outside the 24-26 km2 band is not point mode", () => {
    // 6x6 km square ≈ 36 km² — axis-aligned but too big
    const ring = squareRingAround(77.5, 11.0, 6);
    const aoi = validateAoi(polygonOf(ring));
    expect(aoi.isPointMode).toBe(false);
  });

  test("rotated 25 km2 diamond is not point mode", () => {
    // Arrange — 4-corner diamond, half-diagonals ≈ 3.5355 km → area ≈ 25 km²
    const lon = 77.5;
    const lat = 11.0;
    const dLat = 3.5355 / 110.574;
    const dLon = 3.5355 / (111.32 * Math.cos((lat * Math.PI) / 180));
    const diamond: [number, number][] = [
      [lon - dLon, lat],
      [lon, lat - dLat],
      [lon + dLon, lat],
      [lon, lat + dLat],
      [lon - dLon, lat],
    ];

    // Act
    const aoi = validateAoi(polygonOf(diamond));

    // Assert — area in band but not axis-aligned → not point mode
    expect(aoi.areaKm2).toBeGreaterThanOrEqual(24);
    expect(aoi.areaKm2).toBeLessThanOrEqual(26);
    expect(aoi.isPointMode).toBe(false);
  });
});

// ── canonicalGeometryString ─────────────────────────────────────────────────

describe("canonicalGeometryString", () => {
  test("is stable across 9th-decimal coordinate jitter", () => {
    // Arrange — same square, jittered far below the 6-dp canonical grid
    const base = squareRingAround(MUPPANDAL_LON, MUPPANDAL_LAT, 5);
    const jittered = base.map(
      ([lon, lat]) => [lon + 1e-9, lat - 1e-9] as [number, number],
    );

    // Act
    const baseKey = canonicalGeometryString(validateAoi(polygonOf(base)));
    const jitteredKey = canonicalGeometryString(validateAoi(polygonOf(jittered)));

    // Assert
    expect(baseKey).toBe(jitteredKey);
  });

  test("emits compact JSON with no whitespace", () => {
    const aoi = validateAoi(polygonOf(squareRingAround(MUPPANDAL_LON, MUPPANDAL_LAT, 5)));
    const key = canonicalGeometryString(aoi);
    expect(key.includes(" ")).toBe(false);
    expect(key.includes("\n")).toBe(false);
    expect(key.startsWith("[[")).toBe(true);
  });

  test("differs for genuinely different geometry", () => {
    const a = canonicalGeometryString(
      validateAoi(polygonOf(squareRingAround(MUPPANDAL_LON, MUPPANDAL_LAT, 5))),
    );
    const b = canonicalGeometryString(
      validateAoi(polygonOf(squareRingAround(77.6, 8.3, 5))),
    );
    expect(a).not.toBe(b);
  });
});
