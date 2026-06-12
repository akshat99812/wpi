/**
 * Tests for the shared web-mercator foundation (mercator.ts).
 *
 * Anchor values come from the Phase 0 probe record (VERIFIED.md):
 * Muppandal (77.55 E, 8.26 N) sits in z10 tile x=732 y=488 — the same tile
 * the power-decode probe verified — and the analysis zoom is pinned to 10.
 */
import { describe, expect, test } from "bun:test";
import { area } from "@turf/area";
import { ANALYSIS_ZOOM } from "./constants";
import {
  haversineKm,
  latToTileY,
  lngToTileX,
  squareRingAround,
  tileCountOf,
  tileCoverForBbox,
  tileXToLng,
  tileYToLat,
} from "./mercator";

const Z10 = ANALYSIS_ZOOM;
const MUPPANDAL = { lon: 77.55, lat: 8.26 } as const;
const BHADLA = { lon: 71.92, lat: 27.53 } as const;
const SQUARE_M2_PER_KM2 = 1_000_000;
/** Float tolerance for transcendental round trips (degrees). */
const ROUND_TRIP_DECIMALS = 9;

describe("lng/lat ↔ tile-space round trips", () => {
  test("tileXToLng inverts lngToTileX across longitudes and zooms", () => {
    // Arrange
    const lngs = [-179.9, -77.3, 0, MUPPANDAL.lon, 179.9];
    const zooms = [0, 5, Z10];

    // Act + Assert
    for (const z of zooms) {
      for (const lng of lngs) {
        expect(tileXToLng(lngToTileX(lng, z), z)).toBeCloseTo(
          lng,
          ROUND_TRIP_DECIMALS,
        );
      }
    }
  });

  test("tileYToLat inverts latToTileY across latitudes and zooms", () => {
    // Arrange
    const lats = [-60, -MUPPANDAL.lat, 0, MUPPANDAL.lat, BHADLA.lat, 60];
    const zooms = [0, 5, Z10];

    // Act + Assert
    for (const z of zooms) {
      for (const lat of lats) {
        expect(tileYToLat(latToTileY(lat, z), z)).toBeCloseTo(
          lat,
          ROUND_TRIP_DECIMALS,
        );
      }
    }
  });

  test("Muppandal lands in z10 tile x=732 y=488 (Phase 0 power probe)", () => {
    // Act
    const tileX = Math.floor(lngToTileX(MUPPANDAL.lon, Z10));
    const tileY = Math.floor(latToTileY(MUPPANDAL.lat, Z10));

    // Assert
    expect(tileX).toBe(732);
    expect(tileY).toBe(488);
  });
});

describe("tileCoverForBbox", () => {
  test("degenerate bbox (single point) yields a single tile", () => {
    // Arrange
    const bbox = [
      MUPPANDAL.lon,
      MUPPANDAL.lat,
      MUPPANDAL.lon,
      MUPPANDAL.lat,
    ] as const;

    // Act
    const cover = tileCoverForBbox(bbox, Z10);

    // Assert
    expect(cover.minX).toBe(732);
    expect(cover.maxX).toBe(732);
    expect(cover.minY).toBe(488);
    expect(cover.maxY).toBe(488);
    expect(tileCountOf(cover)).toBe(1);
  });

  test("east edge exactly on a tile seam includes the seam-owning tile", () => {
    // Arrange: x=733's west edge is an exactly representable longitude
    // (733/1024 · 360 − 180 = 77.6953125), so lngToTileX returns exactly 733.
    const seamLng = tileXToLng(733, Z10);

    // Act
    const cover = tileCoverForBbox([77.6, 8.2, seamLng, 8.3], Z10);

    // Assert: the seam belongs to tile 733 (its west edge) — inclusive cover.
    expect(cover.minX).toBe(732);
    expect(cover.maxX).toBe(733);
  });

  test("west edge exactly on a tile seam starts at the seam-owning tile", () => {
    // Arrange
    const seamLng = tileXToLng(733, Z10);

    // Act
    const cover = tileCoverForBbox([seamLng, 8.2, 77.75, 8.3], Z10);

    // Assert
    expect(cover.minX).toBe(733);
    expect(cover.maxX).toBeGreaterThanOrEqual(733);
  });

  test("north latitude maps to minY and south to maxY (inclusive rows)", () => {
    // Arrange
    const south = 8.0;
    const north = 8.5;

    // Act
    const cover = tileCoverForBbox([77.5, south, 77.6, north], Z10);

    // Assert: y grows southward in tile space.
    expect(cover.minY).toBe(Math.floor(latToTileY(north, Z10)));
    expect(cover.maxY).toBe(Math.floor(latToTileY(south, Z10)));
    expect(cover.minY).toBeLessThan(cover.maxY);
  });

  test("world-spanning bbox clamps to the valid tile range", () => {
    // Arrange
    const z = 2;
    const tilesPerSide = 2 ** z;

    // Act
    const cover = tileCoverForBbox([-180, -85, 180, 85], z);

    // Assert: lng 180 maps to tile index 4, which must clamp to 3.
    expect(cover.minX).toBe(0);
    expect(cover.maxX).toBe(tilesPerSide - 1);
    expect(cover.minY).toBe(0);
    expect(cover.maxY).toBe(tilesPerSide - 1);
    expect(tileCountOf(cover)).toBe(tilesPerSide * tilesPerSide);
  });

  test("tileCountOf multiplies inclusive ranges", () => {
    // Arrange
    const cover = { z: Z10, minX: 2, maxX: 4, minY: 1, maxY: 2 };

    // Act + Assert: 3 columns × 2 rows.
    expect(tileCountOf(cover)).toBe(6);
  });
});

describe("haversineKm", () => {
  test("returns 0 for identical points", () => {
    expect(haversineKm(MUPPANDAL.lat, MUPPANDAL.lon, MUPPANDAL.lat, MUPPANDAL.lon)).toBe(0);
  });

  test("is symmetric in its endpoints", () => {
    // Act
    const ab = haversineKm(MUPPANDAL.lat, MUPPANDAL.lon, BHADLA.lat, BHADLA.lon);
    const ba = haversineKm(BHADLA.lat, BHADLA.lon, MUPPANDAL.lat, MUPPANDAL.lon);

    // Assert
    expect(ab).toBeCloseTo(ba, 9);
  });

  test("Muppandal→Bhadla matches an independent great-circle computation", () => {
    // Independent computation (done by hand before writing this test):
    // φ1=8.26°, φ2=27.53°, Δφ=19.27°, Δλ=−5.63°, R=6371.0088 km.
    //   a = sin²(Δφ/2) + cosφ1·cosφ2·sin²(Δλ/2)
    //     = 0.0280133 + 0.877540·0.0024119 = 0.0301298
    //   d = 2R·asin(√a) = 12742.0176 · 0.1744627 ≈ 2223.0 km
    // Cross-check via spherical law of cosines:
    //   acos(sinφ1·sinφ2 + cosφ1·cosφ2·cosΔλ)·R ≈ 2223.1 km.
    // NOTE: the task brief suggested ≈2214 km; the independent value is
    // 2223 km (still inside the brief's ±15 band, which spans 2199–2229).
    // Per instructions we trust the computation and assert around 2223.
    const independentKm = 2223;
    const toleranceKm = 15;

    // Act
    const d = haversineKm(MUPPANDAL.lat, MUPPANDAL.lon, BHADLA.lat, BHADLA.lon);

    // Assert
    expect(Math.abs(d - independentKm)).toBeLessThanOrEqual(toleranceKm);
  });
});

describe("squareRingAround", () => {
  test("returns a closed ring of exactly 5 points", () => {
    // Act
    const ring = squareRingAround(MUPPANDAL.lon, MUPPANDAL.lat, 5);

    // Assert
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]!);
  });

  test("5 km side encloses ≈25 km² of geodesic area", () => {
    // Arrange
    const sideKm = 5;
    const expectedKm2 = 25;
    const toleranceKm2 = 0.5;

    // Act
    const ring = squareRingAround(MUPPANDAL.lon, MUPPANDAL.lat, sideKm);
    const areaKm2 =
      area({ type: "Polygon", coordinates: [ring] }) / SQUARE_M2_PER_KM2;

    // Assert
    expect(Math.abs(areaKm2 - expectedKm2)).toBeLessThanOrEqual(toleranceKm2);
  });

  test("ring is centered on the requested point", () => {
    // Act
    const ring = squareRingAround(BHADLA.lon, BHADLA.lat, 5);
    const corners = ring.slice(0, 4);
    const meanLon = corners.reduce((acc, p) => acc + p[0], 0) / corners.length;
    const meanLat = corners.reduce((acc, p) => acc + p[1], 0) / corners.length;

    // Assert
    expect(meanLon).toBeCloseTo(BHADLA.lon, 9);
    expect(meanLat).toBeCloseTo(BHADLA.lat, 9);
  });
});
