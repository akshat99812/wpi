"""Parity tests for Section E site context & sizing (context.py).

Ported from apps/api/src/services/analysis/context.test.ts. The SAME cases and
anchor values are kept, with the SAME exact-vs-approx distinction the TS used:
``toBe`` -> exact ``==``; ``toBeCloseTo(x, d)`` -> ``pytest.approx(x, abs=...)``.

The injected loaders (loadStatesGeo / loadCapacityRows / loadFarmsGeo) keep the
module offline — mirroring exactly what context.test.ts injects. The states /
farms GeoJSON readers and the StateCapacity DB seam have default-loader paths
exercised separately (see the bottom describe-block analogues); the live PostGIS
read is deferred (no DB in the offline harness).

Run with ANALYSIS_DATA_DIR=apps/api/data so the default-loader reads resolve the
committed india_states.geojson / boundaries.geojson artifacts.
"""
from __future__ import annotations

import math

import numpy as np
import pytest

from app.engine.context import (
    compute_context,
    compute_sizing,
    farm_overlap,
    join_state_capacities,
    point_in_geometry,
    states_for_aoi,
    terrain_stats,
)
from app.engine.mask import build_aoi_mask
from app.engine.mercator import patch_pixel_center_lng_lat
from app.engine.types import AoiMask, LayerPatch, ValidatedAoi

# Muppandal's z10 tile — keeps synthetic geometry on a realistic latitude.
FRAME = LayerPatch(
    zoom=10,
    min_tile_x=732,
    min_tile_y=488,
    width_px=8,
    height_px=8,
    data=np.zeros(64, dtype=np.float32),
)

MERCATOR_M_PER_PX_Z0 = 156_543.033_92
DEG = math.pi / 180


def ring_over_cols(c0: int, c1: int) -> list[tuple[float, float]]:
    """Ring covering all pixel centers of FRAME cols [c0..c1] × all rows.
    (context.test.ts:29-44)"""
    lon_w = patch_pixel_center_lng_lat(
        FRAME.min_tile_x, FRAME.min_tile_y, c0, 0, FRAME.zoom
    )[0]
    lon_e = patch_pixel_center_lng_lat(
        FRAME.min_tile_x, FRAME.min_tile_y, c1, 0, FRAME.zoom
    )[0]
    lat_n = patch_pixel_center_lng_lat(
        FRAME.min_tile_x, FRAME.min_tile_y, 0, 0, FRAME.zoom
    )[1]
    lat_s = patch_pixel_center_lng_lat(
        FRAME.min_tile_x, FRAME.min_tile_y, 0, FRAME.height_px - 1, FRAME.zoom
    )[1]
    # Half-pixel margin so every center in range is strictly inside.
    d_lon = (lon_e - lon_w) / max(1, 2 * (c1 - c0))
    d_lat = (lat_n - lat_s) / max(1, 2 * (FRAME.height_px - 1))
    w = lon_w - d_lon
    e = lon_e + d_lon
    s = lat_s - d_lat
    n = lat_n + d_lat
    return [(w, s), (e, s), (e, n), (w, n), (w, s)]


def bbox_of_ring(ring):
    lons = [v[0] for v in ring]
    lats = [v[1] for v in ring]
    return (min(lons), min(lats), max(lons), max(lats))


def aoi_over(ring) -> ValidatedAoi:
    bbox = bbox_of_ring(ring)
    return ValidatedAoi(
        ring=ring,
        area_km2=25,
        centroid=((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2),
        bbox=bbox,
        is_point_mode=False,
    )


SQUARE_GEOMETRY = {
    "type": "Polygon",
    "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
}


# ── pointInGeometry (context.test.ts:68-97) ─────────────────────────────────


def test_point_in_geometry_classifies_inside_outside_a_simple_square():
    assert point_in_geometry(5, 5, SQUARE_GEOMETRY) is True
    assert point_in_geometry(15, 5, SQUARE_GEOMETRY) is False


def test_point_in_geometry_hole_excludes_points_by_even_odd_parity():
    with_hole = {
        "type": "Polygon",
        "coordinates": [
            [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
            [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
        ],
    }
    assert point_in_geometry(5, 5, with_hole) is False
    assert point_in_geometry(2, 2, with_hole) is True


def test_point_in_geometry_multipolygon_checks_every_part():
    multi = {
        "type": "MultiPolygon",
        "coordinates": [
            [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
            [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]],
        ],
    }
    assert point_in_geometry(5.5, 5.5, multi) is True
    assert point_in_geometry(3, 3, multi) is False


# ── statesForAoi (context.test.ts:99-130) ───────────────────────────────────

_STATES = {
    "features": [
        {"properties": {"ST_NM": "Alpha"}, "geometry": SQUARE_GEOMETRY},
        {
            "properties": {"ST_NM": "Beta"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]],
            },
        },
    ],
}


def test_states_for_aoi_returns_states_hit_by_centroid_or_vertices_sorted():
    aoi = {
        "ring": [(8, 2), (12, 2), (12, 4), (8, 4), (8, 2)],
        "centroid": (9.5, 3),
    }
    assert states_for_aoi(aoi, _STATES) == ["Alpha", "Beta"]


def test_states_for_aoi_returns_empty_when_nothing_is_hit():
    aoi = {
        "ring": [(30, 30), (31, 30), (31, 31), (30, 31), (30, 30)],
        "centroid": (30.5, 30.5),
    }
    assert states_for_aoi(aoi, _STATES) == []


# ── joinStateCapacities (context.test.ts:132-153) ───────────────────────────

_ROWS = [{"state": "Tamil Nadu", "installedMw": 11740, "potentialMw": 95100}]


def test_join_state_capacities_joins_matching_rows_and_nulls_the_misses():
    joined = join_state_capacities(["Tamil Nadu", "Goa"], _ROWS)
    assert joined == [
        {"name": "Tamil Nadu", "installedMw": 11740, "potentialMw": 95100},
        {"name": "Goa", "installedMw": None, "potentialMw": None},
    ]


def test_join_state_capacities_null_rows_all_capacities_null_names_kept():
    joined = join_state_capacities(["Tamil Nadu"], None)
    assert joined == [{"name": "Tamil Nadu", "installedMw": None, "potentialMw": None}]


# ── farmOverlap (context.test.ts:155-200) ───────────────────────────────────


def test_farm_overlap_identical_farm_covers_whole_aoi():
    aoi_ring = ring_over_cols(0, FRAME.width_px - 1)
    aoi_mask = build_aoi_mask(aoi_ring, FRAME)
    aoi = {"bbox": bbox_of_ring(aoi_ring)}

    farms = {
        "features": [{"geometry": {"type": "Polygon", "coordinates": [aoi_ring]}}]
    }

    result = farm_overlap(aoi, farms, FRAME, aoi_mask)

    assert result["count"] == 1
    assert result["overlapFraction"] == pytest.approx(1, abs=5e-3)


def test_farm_overlap_half_width_farm_yields_about_half():
    aoi_ring = ring_over_cols(0, FRAME.width_px - 1)
    aoi_mask = build_aoi_mask(aoi_ring, FRAME)
    aoi = {"bbox": bbox_of_ring(aoi_ring)}

    half_ring = ring_over_cols(0, FRAME.width_px // 2 - 1)
    farms = {
        "features": [{"geometry": {"type": "Polygon", "coordinates": [half_ring]}}]
    }

    result = farm_overlap(aoi, farms, FRAME, aoi_mask)

    assert result["count"] == 1
    assert result["overlapFraction"] > 0.3
    assert result["overlapFraction"] < 0.7


def test_farm_overlap_far_away_farm_is_bbox_filtered_out():
    aoi_ring = ring_over_cols(0, FRAME.width_px - 1)
    aoi_mask = build_aoi_mask(aoi_ring, FRAME)
    aoi = {"bbox": bbox_of_ring(aoi_ring)}

    farms = {
        "features": [
            {
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [[70, 20], [70.1, 20], [70.1, 20.1], [70, 20.1], [70, 20]]
                    ],
                }
            }
        ]
    }

    result = farm_overlap(aoi, farms, FRAME, aoi_mask)

    assert result == {"count": 0, "overlapFraction": 0}


# ── terrainStats (context.test.ts:202-263) ──────────────────────────────────


def _mask_all() -> AoiMask:
    total = FRAME.width_px * FRAME.height_px
    return AoiMask(
        width_px=FRAME.width_px,
        height_px=FRAME.height_px,
        inside=np.ones(total, dtype=np.uint8),
        inside_count=total,
    )


def _elevation_patch(fill) -> LayerPatch:
    data = np.zeros(FRAME.width_px * FRAME.height_px, dtype=np.float32)
    for r in range(FRAME.height_px):
        for c in range(FRAME.width_px):
            data[r * FRAME.width_px + c] = fill(r, c)
    return LayerPatch(
        zoom=FRAME.zoom,
        min_tile_x=FRAME.min_tile_x,
        min_tile_y=FRAME.min_tile_y,
        width_px=FRAME.width_px,
        height_px=FRAME.height_px,
        data=data,
    )


def test_terrain_stats_flat_plane_zero_slope_exact_elevation_stats():
    patch = _elevation_patch(lambda r, c: 250)

    result = terrain_stats(patch, _mask_all())
    terrain = result["terrain"]
    slope90th_deg = result["slope90thDeg"]

    assert terrain is not None
    assert terrain["elevMean"] == 250
    assert terrain["elevMin"] == 250
    assert terrain["elevMax"] == 250
    assert terrain["slopeMeanDeg"] == 0
    assert terrain["slopeSteep10Deg"] == 0
    assert slope90th_deg == 0


def test_terrain_stats_east_west_ramp_rising_one_pixel_size_per_pixel_about_45():
    # Build the ramp with the SAME per-row pixel size the implementation derives,
    # so dz/dx is exactly 1 on every row.
    def fill(row, col):
        lat = patch_pixel_center_lng_lat(
            FRAME.min_tile_x, FRAME.min_tile_y, 0, row, FRAME.zoom
        )[1]
        pixel_meters = (MERCATOR_M_PER_PX_Z0 * math.cos(lat * DEG)) / 2**FRAME.zoom
        return col * pixel_meters

    patch = _elevation_patch(fill)

    result = terrain_stats(patch, _mask_all())
    terrain = result["terrain"]
    slope90th_deg = result["slope90thDeg"]

    assert terrain is not None
    assert terrain["slopeMeanDeg"] == pytest.approx(45, abs=0.5)
    assert slope90th_deg == pytest.approx(45, abs=0.5)


def test_terrain_stats_all_nan_elevation_terrain_null():
    patch = _elevation_patch(lambda r, c: math.nan)

    result = terrain_stats(patch, _mask_all())

    assert result["terrain"] is None
    assert result["slope90thDeg"] is None


# ── computeSizing (context.test.ts:265-289) ─────────────────────────────────


def test_compute_sizing_plan_2_5_formulas_verbatim():
    # 100 km² · (1 − 0.18) · 0.7 = 57.4 km² → 287 MW → 287·8.76·0.34 ≈ 854.8
    sizing = compute_sizing(100, 0.18, 0.34)

    assert sizing["capacityMw"] == pytest.approx(287, abs=0.5)
    assert sizing["energyGwh"] == pytest.approx(854.8, abs=0.5)
    assert "5 MW/km² density" in sizing["assumptions"]
    assert "existing wind-farm area excluded" in sizing["assumptions"]


def test_compute_sizing_aoi_fully_inside_existing_farms_about_zero_not_error():
    sizing = compute_sizing(25, 1, 0.6)

    assert sizing["capacityMw"] == 0
    assert sizing["energyGwh"] == 0


def test_compute_sizing_null_cf_iec3_zero_energy_capacity_unaffected():
    sizing = compute_sizing(100, 0, None)

    assert sizing["capacityMw"] == 350
    assert sizing["energyGwh"] == 0


# ── computeContext (injected deps) (context.test.ts:291-357) ────────────────

_STATES_GEO = {
    "features": [
        {
            "properties": {"ST_NM": "Testland"},
            # Generously covers the FRAME neighborhood (around 77.3E, 8.3N).
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[77, 8], [78, 8], [78, 9], [77, 9], [77, 8]]],
            },
        }
    ]
}


def test_compute_context_assembles_all_sub_results():
    aoi_ring = ring_over_cols(0, FRAME.width_px - 1)
    aoi = aoi_over(aoi_ring)
    aoi_mask = build_aoi_mask(aoi_ring, FRAME)
    flat_elevation = LayerPatch(
        zoom=FRAME.zoom,
        min_tile_x=FRAME.min_tile_x,
        min_tile_y=FRAME.min_tile_y,
        width_px=FRAME.width_px,
        height_px=FRAME.height_px,
        data=np.full(FRAME.width_px * FRAME.height_px, 100, dtype=np.float32),
    )

    result = compute_context(
        aoi,
        {"elevation": flat_elevation, "aoiMask": aoi_mask, "cfIec3": 0.4},
        {
            "loadStatesGeo": lambda: _STATES_GEO,
            "loadCapacityRows": lambda: [
                {"state": "Testland", "installedMw": 1000, "potentialMw": 5000}
            ],
            "loadFarmsGeo": lambda: {
                "features": [
                    {"geometry": {"type": "Polygon", "coordinates": [aoi_ring]}}
                ]
            },
        },
    )

    assert result["states"] == [
        {"name": "Testland", "installedMw": 1000, "potentialMw": 5000}
    ]
    assert result["windfarms"]["count"] == 1
    assert result["windfarms"]["overlapFraction"] == pytest.approx(1, abs=5e-3)
    assert result["terrain"]["elevMean"] == 100
    assert result["slope90thDeg"] == 0
    # Full overlap → sizing collapses to ~0 (the §2.5 farm-covered case).
    assert result["sizing"]["capacityMw"] == pytest.approx(0, abs=0.1)


def test_compute_context_degrades_cleanly_when_every_loader_returns_null():
    aoi_ring = ring_over_cols(0, FRAME.width_px - 1)
    aoi = aoi_over(aoi_ring)
    aoi_mask = build_aoi_mask(aoi_ring, FRAME)
    flat_elevation = LayerPatch(
        zoom=FRAME.zoom,
        min_tile_x=FRAME.min_tile_x,
        min_tile_y=FRAME.min_tile_y,
        width_px=FRAME.width_px,
        height_px=FRAME.height_px,
        data=np.full(FRAME.width_px * FRAME.height_px, 100, dtype=np.float32),
    )

    result = compute_context(
        aoi,
        {"elevation": flat_elevation, "aoiMask": aoi_mask, "cfIec3": None},
        {
            "loadStatesGeo": lambda: None,
            "loadCapacityRows": lambda: None,
            "loadFarmsGeo": lambda: None,
        },
    )

    assert result["states"] == []
    assert result["windfarms"] == {"count": 0, "overlapFraction": 0}
    assert result["sizing"]["energyGwh"] == 0
    assert result["sizing"]["capacityMw"] > 0
