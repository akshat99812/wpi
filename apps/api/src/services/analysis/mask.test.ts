/**
 * Tests for buildAoiMask (AOI polygon → pixel-center mask).
 *
 * Geometric fixtures are built in continuous tile space and converted to
 * lon/lat with the shared mercator helpers, so the expected pixel counts are
 * exact by construction: pixel centers sit at (i + 0.5)/256 tile units and
 * the fixtures' edges sit at .25/.75 tile units — never on a center.
 */
import { describe, expect, test } from "bun:test";
import { ANALYSIS_ZOOM } from "./constants";
import { buildAoiMask } from "./mask";
import {
  TILE_SIZE,
  squareRingAround,
  tileCoverForBbox,
  tileXToLng,
  tileYToLat,
} from "./mercator";
import { GeometryError } from "./types";

const Z = ANALYSIS_ZOOM;
/** Muppandal's z10 tile (VERIFIED.md / Phase 0 power probe). */
const TILE_X = 732;
const TILE_Y = 488;
/** A rect spanning tile units .25→.75 covers exactly 128 pixel centers/axis. */
const INNER_RECT_SIDE_PX = TILE_SIZE / 2;
const INNER_RECT_PX = INNER_RECT_SIDE_PX * INNER_RECT_SIDE_PX;

interface PatchFrame {
  zoom: number;
  minTileX: number;
  minTileY: number;
  widthPx: number;
  heightPx: number;
}

function makePatch(tilesX: number, tilesY: number): PatchFrame {
  return {
    zoom: Z,
    minTileX: TILE_X,
    minTileY: TILE_Y,
    widthPx: tilesX * TILE_SIZE,
    heightPx: tilesY * TILE_SIZE,
  };
}

/** Closed lon/lat ring for an axis-aligned rect given in tile-space coords. */
function tileRectRing(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [number, number][] {
  const west = tileXToLng(x0, Z);
  const east = tileXToLng(x1, Z);
  const north = tileYToLat(y0, Z);
  const south = tileYToLat(y1, Z);
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

/** Lon/lat point for a tile-space coordinate. */
function tilePoint(tx: number, ty: number): [number, number] {
  return [tileXToLng(tx, Z), tileYToLat(ty, Z)];
}

function countOnes(mask: Uint8Array): number {
  return mask.reduce((acc, v) => acc + v, 0);
}

function bboxOfRing(
  ring: [number, number][],
): [number, number, number, number] {
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return [
    Math.min(...lons),
    Math.min(...lats),
    Math.max(...lons),
    Math.max(...lats),
  ];
}

function patchForRing(ring: [number, number][]): PatchFrame {
  const cover = tileCoverForBbox(bboxOfRing(ring), Z);
  return {
    zoom: Z,
    minTileX: cover.minX,
    minTileY: cover.minY,
    widthPx: (cover.maxX - cover.minX + 1) * TILE_SIZE,
    heightPx: (cover.maxY - cover.minY + 1) * TILE_SIZE,
  };
}

describe("buildAoiMask — squares vs tile geometry", () => {
  test("marks exactly the pixel centers inside a square fully inside one tile", () => {
    // Arrange: rect over the middle half of the tile → 128×128 centers.
    const patch = makePatch(1, 1);
    const ring = tileRectRing(
      TILE_X + 0.25,
      TILE_Y + 0.25,
      TILE_X + 0.75,
      TILE_Y + 0.75,
    );

    // Act
    const mask = buildAoiMask(ring, patch);

    // Assert
    expect(mask.widthPx).toBe(TILE_SIZE);
    expect(mask.heightPx).toBe(TILE_SIZE);
    expect(mask.insideCount).toBe(INNER_RECT_PX);
    expect(countOnes(mask.inside)).toBe(mask.insideCount);
    // Spot checks: dead center is in, the NW corner pixel is out.
    expect(mask.inside[128 * TILE_SIZE + 128]).toBe(1);
    expect(mask.inside[10 * TILE_SIZE + 10]).toBe(0);
  });

  test("returns an all-zero mask when the square lies entirely outside the patch", () => {
    // Arrange: same-size rect two tiles to the west.
    const patch = makePatch(1, 1);
    const ring = tileRectRing(
      TILE_X - 1.75,
      TILE_Y + 0.25,
      TILE_X - 1.25,
      TILE_Y + 0.75,
    );

    // Act
    const mask = buildAoiMask(ring, patch);

    // Assert
    expect(mask.insideCount).toBe(0);
    expect(mask.inside.some((v) => v === 1)).toBe(false);
  });

  test("counts pixels on both sides of an internal tile seam", () => {
    // Arrange: 2×1-tile patch, rect centered on the seam (x .75 → 1.25).
    const patch = makePatch(2, 1);
    const ring = tileRectRing(
      TILE_X + 0.75,
      TILE_Y + 0.25,
      TILE_X + 1.25,
      TILE_Y + 0.75,
    );

    // Act
    const mask = buildAoiMask(ring, patch);

    // Assert: still exactly 128×128 centers, half per tile.
    expect(mask.insideCount).toBe(INNER_RECT_PX);
    const midRowOffset = 128 * patch.widthPx;
    expect(mask.inside[midRowOffset + 255]).toBe(1); // last col of west tile
    expect(mask.inside[midRowOffset + 256]).toBe(1); // first col of east tile
    expect(mask.inside[midRowOffset + 191]).toBe(0); // west of the rect
  });

  test("clips a square straddling the patch's west edge to in-patch pixels", () => {
    // Arrange: rect x −.25 → +.25 — only its eastern half is on the patch.
    const patch = makePatch(1, 1);
    const ring = tileRectRing(
      TILE_X - 0.25,
      TILE_Y + 0.25,
      TILE_X + 0.25,
      TILE_Y + 0.75,
    );

    // Act
    const mask = buildAoiMask(ring, patch);

    // Assert: 64 columns (centers .5/256 … 63.5/256) × 128 rows.
    expect(mask.insideCount).toBe((INNER_RECT_SIDE_PX / 2) * INNER_RECT_SIDE_PX);
  });

  test("accepts an open (unclosed) ring identically to the closed one", () => {
    // Arrange
    const patch = makePatch(1, 1);
    const closed = tileRectRing(
      TILE_X + 0.25,
      TILE_Y + 0.25,
      TILE_X + 0.75,
      TILE_Y + 0.75,
    );
    const open = closed.slice(0, -1);

    // Act
    const maskClosed = buildAoiMask(closed, patch);
    const maskOpen = buildAoiMask(open, patch);

    // Assert
    expect(maskOpen.insideCount).toBe(maskClosed.insideCount);
    expect(maskOpen.inside).toEqual(maskClosed.inside);
  });
});

describe("buildAoiMask — triangle (winding / asymmetry)", () => {
  // NW-half right triangle of the .25→.75 rect: A=NW, B=NE, C=SW corners.
  const triangle = (): [number, number][] => [
    tilePoint(TILE_X + 0.25, TILE_Y + 0.25),
    tilePoint(TILE_X + 0.75, TILE_Y + 0.25),
    tilePoint(TILE_X + 0.25, TILE_Y + 0.75),
    tilePoint(TILE_X + 0.25, TILE_Y + 0.25),
  ];

  test("covers ≈half the rect and only its own half (asymmetry)", () => {
    // Arrange: exact tile-space lattice count for i+j ≤ 126 is 8128; the
    // hypotenuse is straight in lon/lat (not tile space) so allow a small
    // bow tolerance — sub-pixel per row at z10, ±150 px is generous.
    const patch = makePatch(1, 1);
    const expectedPx = 8128;
    const tolerancePx = 150;

    // Act
    const mask = buildAoiMask(triangle(), patch);

    // Assert
    expect(Math.abs(mask.insideCount - expectedPx)).toBeLessThanOrEqual(
      tolerancePx,
    );
    // Near the right-angle (NW) corner → inside; mirrored spot → outside.
    expect(mask.inside[70 * TILE_SIZE + 70]).toBe(1);
    expect(mask.inside[180 * TILE_SIZE + 180]).toBe(0);
  });

  test("reversed winding produces the identical mask", () => {
    // Arrange
    const patch = makePatch(1, 1);
    const cw = triangle();
    const ccw = [...cw].reverse();

    // Act
    const maskCw = buildAoiMask(cw, patch);
    const maskCcw = buildAoiMask(ccw, patch);

    // Assert
    expect(maskCcw.insideCount).toBe(maskCw.insideCount);
    expect(maskCcw.inside).toEqual(maskCw.inside);
  });
});

describe("buildAoiMask — Muppandal golden geometry (pure math, no network)", () => {
  test("5×5 km square at z10 covers ≈1089 pixel centers", () => {
    // VERIFIED.md §5 counted 1089 VALID ws_mean_hgt100m pixels for this exact
    // square at z10. The Aralvaimozhi corridor has full data coverage there,
    // so the geometric inside-count is the same neighborhood as the
    // valid-data count. Tolerance ±70 (~6%): the square is ~33 px per side,
    // so ±1 row/col of boundary quantization is ±33 px, plus a little drift
    // from squareRingAround's flat-earth degree conversion.
    const expectedPx = 1089;
    const tolerancePx = 70;

    // Arrange
    const ring = squareRingAround(77.55, 8.26, 5);
    const patch = patchForRing(ring);

    // Act
    const mask = buildAoiMask(ring, patch);

    // Assert
    expect(Math.abs(mask.insideCount - expectedPx)).toBeLessThanOrEqual(
      tolerancePx,
    );
    expect(mask.insideCount).toBe(countOnes(mask.inside));
  });
});

describe("buildAoiMask — robustness", () => {
  test("throws GeometryError(INVALID_GEOMETRY) for a degenerate ring", () => {
    // Arrange: closed 2-distinct-vertex "ring".
    const patch = makePatch(1, 1);
    const degenerate: [number, number][] = [
      [77.0, 8.0],
      [78.0, 9.0],
      [77.0, 8.0],
    ];

    // Act
    let caught: unknown;
    try {
      buildAoiMask(degenerate, patch);
    } catch (error) {
      caught = error;
    }

    // Assert
    expect(caught).toBeInstanceOf(GeometryError);
    expect((caught as GeometryError).code).toBe("INVALID_GEOMETRY");
  });

  test("does not mutate the input ring", () => {
    // Arrange
    const patch = makePatch(1, 1);
    const ring = tileRectRing(
      TILE_X + 0.25,
      TILE_Y + 0.25,
      TILE_X + 0.75,
      TILE_Y + 0.75,
    );
    const snapshot = ring.map((p) => [...p] as [number, number]);

    // Act
    buildAoiMask(ring, patch);

    // Assert
    expect(ring).toEqual(snapshot);
  });

  test("masks a 50×50 km AOI (the 2,500 km² cap) well under budget", () => {
    // Arrange: worst-case draw cap. The bbox pre-pass keeps the hot loop to
    // ~331×331 ≈ 110k ray casts instead of the full 768×768 patch.
    const timingBudgetMs = 1_500;
    const ring = squareRingAround(77.55, 8.26, 50);
    const patch = patchForRing(ring);

    // Act
    const startedAt = performance.now();
    const mask = buildAoiMask(ring, patch);
    const elapsedMs = performance.now() - startedAt;

    // Assert: ~(50 km / 0.1513 km-per-px)² ≈ 109k inside pixels.
    expect(mask.insideCount).toBeGreaterThan(100_000);
    expect(mask.insideCount).toBeLessThan(120_000);
    expect(elapsedMs).toBeLessThan(timingBudgetMs);
    console.info(
      `[mask.test] 50×50 km @z${Z}: patch ${patch.widthPx}×${patch.heightPx}px, ` +
        `inside=${mask.insideCount}, built in ${elapsedMs.toFixed(1)} ms`,
    );
  });
});
