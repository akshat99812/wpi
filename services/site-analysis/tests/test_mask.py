"""Tests for build_aoi_mask (AOI polygon -> pixel-center mask).

Ported from mask.test.ts. Geometric fixtures are built in continuous tile space
and converted to lon/lat with the shared mercator helpers, so the expected pixel
counts are exact by construction: pixel centers sit at (i + 0.5)/256 tile units
and the fixtures' edges sit at .25/.75 tile units -- never on a center.
"""
from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np
import pytest

from app.config import ANALYSIS_ZOOM
from app.engine.mask import build_aoi_mask
from app.engine.mercator import (
    TILE_SIZE,
    square_ring_around,
    tile_cover_for_bbox,
    tile_x_to_lng,
    tile_y_to_lat,
)
from app.engine.types import GeometryError

Z = ANALYSIS_ZOOM
# Muppandal's z10 tile (VERIFIED.md / Phase 0 power probe).
TILE_X = 732
TILE_Y = 488
# A rect spanning tile units .25->.75 covers exactly 128 pixel centers/axis.
INNER_RECT_SIDE_PX = TILE_SIZE // 2
INNER_RECT_PX = INNER_RECT_SIDE_PX * INNER_RECT_SIDE_PX


@dataclass(frozen=True)
class PatchFrame:
    zoom: int
    min_tile_x: int
    min_tile_y: int
    width_px: int
    height_px: int


def make_patch(tiles_x: int, tiles_y: int) -> PatchFrame:
    return PatchFrame(
        zoom=Z,
        min_tile_x=TILE_X,
        min_tile_y=TILE_Y,
        width_px=tiles_x * TILE_SIZE,
        height_px=tiles_y * TILE_SIZE,
    )


def tile_rect_ring(
    x0: float, y0: float, x1: float, y1: float
) -> list[tuple[float, float]]:
    """Closed lon/lat ring for an axis-aligned rect given in tile-space coords."""
    west = tile_x_to_lng(x0, Z)
    east = tile_x_to_lng(x1, Z)
    north = tile_y_to_lat(y0, Z)
    south = tile_y_to_lat(y1, Z)
    return [
        (west, south),
        (east, south),
        (east, north),
        (west, north),
        (west, south),
    ]


def tile_point(tx: float, ty: float) -> tuple[float, float]:
    """Lon/lat point for a tile-space coordinate."""
    return (tile_x_to_lng(tx, Z), tile_y_to_lat(ty, Z))


def count_ones(mask: np.ndarray) -> int:
    return int(mask.sum())


def bbox_of_ring(
    ring: list[tuple[float, float]],
) -> tuple[float, float, float, float]:
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return (min(lons), min(lats), max(lons), max(lats))


def patch_for_ring(ring: list[tuple[float, float]]) -> PatchFrame:
    cover = tile_cover_for_bbox(bbox_of_ring(ring), Z)
    return PatchFrame(
        zoom=Z,
        min_tile_x=cover.min_x,
        min_tile_y=cover.min_y,
        width_px=(cover.max_x - cover.min_x + 1) * TILE_SIZE,
        height_px=(cover.max_y - cover.min_y + 1) * TILE_SIZE,
    )


class TestSquaresVsTileGeometry:
    def test_marks_exactly_pixel_centers_inside_square_in_one_tile(self):
        # Arrange: rect over the middle half of the tile -> 128x128 centers.
        patch = make_patch(1, 1)
        ring = tile_rect_ring(
            TILE_X + 0.25, TILE_Y + 0.25, TILE_X + 0.75, TILE_Y + 0.75
        )

        # Act
        mask = build_aoi_mask(ring, patch)

        # Assert
        assert mask.width_px == TILE_SIZE
        assert mask.height_px == TILE_SIZE
        assert mask.inside_count == INNER_RECT_PX
        assert count_ones(mask.inside) == mask.inside_count
        # Spot checks: dead center is in, the NW corner pixel is out.
        assert mask.inside[128 * TILE_SIZE + 128] == 1
        assert mask.inside[10 * TILE_SIZE + 10] == 0

    def test_all_zero_mask_when_square_entirely_outside_patch(self):
        # Arrange: same-size rect two tiles to the west.
        patch = make_patch(1, 1)
        ring = tile_rect_ring(
            TILE_X - 1.75, TILE_Y + 0.25, TILE_X - 1.25, TILE_Y + 0.75
        )

        # Act
        mask = build_aoi_mask(ring, patch)

        # Assert
        assert mask.inside_count == 0
        assert not bool((mask.inside == 1).any())

    def test_counts_pixels_on_both_sides_of_internal_tile_seam(self):
        # Arrange: 2x1-tile patch, rect centered on the seam (x .75 -> 1.25).
        patch = make_patch(2, 1)
        ring = tile_rect_ring(
            TILE_X + 0.75, TILE_Y + 0.25, TILE_X + 1.25, TILE_Y + 0.75
        )

        # Act
        mask = build_aoi_mask(ring, patch)

        # Assert: still exactly 128x128 centers, half per tile.
        assert mask.inside_count == INNER_RECT_PX
        mid_row_offset = 128 * patch.width_px
        assert mask.inside[mid_row_offset + 255] == 1  # last col of west tile
        assert mask.inside[mid_row_offset + 256] == 1  # first col of east tile
        assert mask.inside[mid_row_offset + 191] == 0  # west of the rect

    def test_clips_square_straddling_west_edge_to_in_patch_pixels(self):
        # Arrange: rect x -.25 -> +.25 -- only its eastern half is on the patch.
        patch = make_patch(1, 1)
        ring = tile_rect_ring(
            TILE_X - 0.25, TILE_Y + 0.25, TILE_X + 0.25, TILE_Y + 0.75
        )

        # Act
        mask = build_aoi_mask(ring, patch)

        # Assert: 64 columns (centers .5/256 ... 63.5/256) x 128 rows.
        assert mask.inside_count == (INNER_RECT_SIDE_PX // 2) * INNER_RECT_SIDE_PX

    def test_accepts_open_ring_identically_to_closed(self):
        # Arrange
        patch = make_patch(1, 1)
        closed = tile_rect_ring(
            TILE_X + 0.25, TILE_Y + 0.25, TILE_X + 0.75, TILE_Y + 0.75
        )
        opened = closed[:-1]

        # Act
        mask_closed = build_aoi_mask(closed, patch)
        mask_open = build_aoi_mask(opened, patch)

        # Assert
        assert mask_open.inside_count == mask_closed.inside_count
        assert np.array_equal(mask_open.inside, mask_closed.inside)


def _triangle() -> list[tuple[float, float]]:
    # NW-half right triangle of the .25->.75 rect: A=NW, B=NE, C=SW corners.
    return [
        tile_point(TILE_X + 0.25, TILE_Y + 0.25),
        tile_point(TILE_X + 0.75, TILE_Y + 0.25),
        tile_point(TILE_X + 0.25, TILE_Y + 0.75),
        tile_point(TILE_X + 0.25, TILE_Y + 0.25),
    ]


class TestTriangleWindingAsymmetry:
    def test_covers_about_half_the_rect_and_only_its_own_half(self):
        # Arrange: exact tile-space lattice count for i+j <= 126 is 8128; the
        # hypotenuse is straight in lon/lat (not tile space) so allow a small
        # bow tolerance -- sub-pixel per row at z10, +-150 px is generous.
        patch = make_patch(1, 1)
        expected_px = 8128
        tolerance_px = 150

        # Act
        mask = build_aoi_mask(_triangle(), patch)

        # Assert
        assert abs(mask.inside_count - expected_px) <= tolerance_px
        # Near the right-angle (NW) corner -> inside; mirrored spot -> outside.
        assert mask.inside[70 * TILE_SIZE + 70] == 1
        assert mask.inside[180 * TILE_SIZE + 180] == 0

    def test_reversed_winding_produces_identical_mask(self):
        # Arrange
        patch = make_patch(1, 1)
        cw = _triangle()
        ccw = list(reversed(cw))

        # Act
        mask_cw = build_aoi_mask(cw, patch)
        mask_ccw = build_aoi_mask(ccw, patch)

        # Assert
        assert mask_ccw.inside_count == mask_cw.inside_count
        assert np.array_equal(mask_ccw.inside, mask_cw.inside)


class TestMuppandalGoldenGeometry:
    def test_5x5_km_square_at_z10_covers_about_1089_pixel_centers(self):
        # VERIFIED.md S5 counted 1089 VALID ws_mean_hgt100m pixels for this exact
        # square at z10. The Aralvaimozhi corridor has full data coverage there,
        # so the geometric inside-count is the same neighborhood as the
        # valid-data count. Tolerance +-70 (~6%): the square is ~33 px per side,
        # so +-1 row/col of boundary quantization is +-33 px, plus a little drift
        # from square_ring_around's flat-earth degree conversion.
        expected_px = 1089
        tolerance_px = 70

        # Arrange
        ring = square_ring_around(77.55, 8.26, 5)
        patch = patch_for_ring(ring)

        # Act
        mask = build_aoi_mask(ring, patch)

        # Assert
        assert abs(mask.inside_count - expected_px) <= tolerance_px
        assert mask.inside_count == count_ones(mask.inside)


class TestRobustness:
    def test_throws_geometry_error_for_degenerate_ring(self):
        # Arrange: closed 2-distinct-vertex "ring".
        patch = make_patch(1, 1)
        degenerate = [
            (77.0, 8.0),
            (78.0, 9.0),
            (77.0, 8.0),
        ]

        # Act
        caught: object = None
        try:
            build_aoi_mask(degenerate, patch)
        except Exception as error:  # noqa: BLE001 -- mirror TS catch
            caught = error

        # Assert
        assert isinstance(caught, GeometryError)
        assert caught.code == "INVALID_GEOMETRY"

    def test_does_not_mutate_input_ring(self):
        # Arrange
        patch = make_patch(1, 1)
        ring = tile_rect_ring(
            TILE_X + 0.25, TILE_Y + 0.25, TILE_X + 0.75, TILE_Y + 0.75
        )
        snapshot = [tuple(p) for p in ring]

        # Act
        build_aoi_mask(ring, patch)

        # Assert
        assert ring == snapshot

    def test_masks_50x50_km_aoi_well_under_budget(self):
        # Arrange: worst-case draw cap. The bbox pre-pass keeps the hot loop to
        # ~331x331 ~= 110k ray casts instead of the full 768x768 patch.
        timing_budget_ms = 1_500
        ring = square_ring_around(77.55, 8.26, 50)
        patch = patch_for_ring(ring)

        # Act
        started_at = time.perf_counter()
        mask = build_aoi_mask(ring, patch)
        elapsed_ms = (time.perf_counter() - started_at) * 1000

        # Assert: ~(50 km / 0.1513 km-per-px)^2 ~= 109k inside pixels.
        assert mask.inside_count > 100_000
        assert mask.inside_count < 120_000
        assert elapsed_ms < timing_budget_ms
