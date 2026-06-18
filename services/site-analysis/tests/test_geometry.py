"""Parity tests for geometry.py — request-geometry validation + canonicalization.

Ported from apps/api/src/services/analysis/geometry.test.ts. Covers every
GeometryErrorCode, the point-mode fingerprint, auto-closing, dedupe, holes, and
cache-key canonicalization stability.

The zod-schema cases (analyzeRequestSchema) are mapped onto the function
equivalents validate_analyze_request / geo_json_polygon_schema_check.
"""
from __future__ import annotations

import math

import pytest

from app.engine.geometry import (
    canonical_geometry_string,
    geo_json_polygon_schema_check,
    validate_analyze_request,
    validate_aoi,
)
from app.engine.mercator import square_ring_around
from app.engine.types import GeometryError

# ── Fixtures + helpers ──────────────────────────────────────────────────────

MUPPANDAL_LON = 77.55
MUPPANDAL_LAT = 8.26
KARACHI_LON = 67.0011
KARACHI_LAT = 24.8607


def polygon_of(ring: list[tuple[float, float]]) -> dict:
    return {"type": "Polygon", "coordinates": [[[lon, lat] for lon, lat in ring]]}


def circle_ring(
    center_lon: float,
    center_lat: float,
    radius_deg: float,
    vertex_count: int,
) -> list[tuple[float, float]]:
    """Closed circle-ish ring with ``vertex_count`` DISTINCT vertices."""
    ring: list[tuple[float, float]] = []
    for i in range(vertex_count):
        angle = (2 * math.pi * i) / vertex_count
        ring.append(
            (
                center_lon + radius_deg * math.cos(angle),
                center_lat + radius_deg * math.sin(angle),
            )
        )
    first = ring[0]
    return [*ring, (first[0], first[1])]


def expect_geometry_error(geometry: dict, code: str) -> None:
    with pytest.raises(GeometryError) as exc_info:
        validate_aoi(geometry)
    assert exc_info.value.code == code


# ── Zod schema (mapped to function equivalents) ─────────────────────────────


class TestAnalyzeRequestSchema:
    def test_accepts_valid_polygon_request_body(self):
        body = {
            "geometry": polygon_of(square_ring_around(MUPPANDAL_LON, MUPPANDAL_LAT, 5))
        }
        assert validate_analyze_request(body) is True

    def test_rejects_body_without_geometry(self):
        assert validate_analyze_request({}) is False

    def test_rejects_geometry_whose_type_is_not_polygon(self):
        body = {"geometry": {"type": "Point", "coordinates": [77.55, 8.26]}}
        assert validate_analyze_request(body) is False

    def test_rejects_polygon_with_zero_rings(self):
        body = {"geometry": {"type": "Polygon", "coordinates": []}}
        assert validate_analyze_request(body) is False

    def test_rejects_vertices_that_are_not_lon_lat_pairs(self):
        body = {
            "geometry": {"type": "Polygon", "coordinates": [[[77.55], [77.6, 8.3]]]}
        }
        assert validate_analyze_request(body) is False

    def test_rejects_non_finite_coordinate_values(self):
        infinity_body = {
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [[77.55, math.inf], [77.6, 8.3], [77.6, 8.2], [77.55, 8.26]]
                ],
            }
        }
        nan_body = {
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [[math.nan, 8.26], [77.6, 8.3], [77.6, 8.2], [77.55, 8.26]]
                ],
            }
        }
        assert validate_analyze_request(infinity_body) is False
        assert validate_analyze_request(nan_body) is False

    def test_rejects_string_coordinates(self):
        geometry = {
            "type": "Polygon",
            "coordinates": [[["77.55", "8.26"], [77.6, 8.3], [77.6, 8.2]]],
        }
        assert geo_json_polygon_schema_check(geometry) is False


# ── validate_aoi happy paths ────────────────────────────────────────────────


class TestValidateAoiHappyPaths:
    def test_validates_muppandal_point_mode_square(self):
        ring = square_ring_around(MUPPANDAL_LON, MUPPANDAL_LAT, 5)
        aoi = validate_aoi(polygon_of(ring))

        # area ~= 25 +/- 1, fingerprinted as point mode
        assert aoi.is_point_mode is True
        assert aoi.area_km2 >= 24
        assert aoi.area_km2 <= 26
        # toBeCloseTo(x, p) passes when |actual - x| < 0.5 * 10**-p (Jest/bun).
        assert abs(aoi.centroid[0] - MUPPANDAL_LON) < 0.5e-3
        assert abs(aoi.centroid[1] - MUPPANDAL_LAT) < 0.5e-3
        # Ring is closed, canonical, 4 corners + closing repeat
        assert len(aoi.ring) == 5
        assert aoi.ring[0] == aoi.ring[len(aoi.ring) - 1]
        # bbox is [W, S, E, N]
        west, south, east, north = aoi.bbox
        assert west < east
        assert south < north
        assert abs(west - (MUPPANDAL_LON - (east - MUPPANDAL_LON))) < 0.5e-4

    def test_marks_irregular_polygon_as_not_point_mode(self):
        ring = [
            (77.0, 11.0),
            (77.15, 11.02),
            (77.18, 11.15),
            (77.05, 11.2),
            (76.95, 11.1),
            (77.0, 11.0),
        ]
        aoi = validate_aoi(polygon_of(ring))
        assert aoi.is_point_mode is False
        assert aoi.area_km2 > 1
        assert aoi.area_km2 < 2500

    def test_auto_closes_an_unclosed_ring(self):
        closed = square_ring_around(MUPPANDAL_LON, MUPPANDAL_LAT, 5)
        unclosed = closed[:-1]
        aoi = validate_aoi(polygon_of(unclosed))
        assert len(aoi.ring) == 5
        assert aoi.ring[0] == aoi.ring[4]
        assert aoi.is_point_mode is True

    def test_dedupes_consecutive_duplicate_vertices(self):
        closed = square_ring_around(MUPPANDAL_LON, MUPPANDAL_LAT, 5)
        corner = closed[0]
        with_duplicate = [(corner[0], corner[1]), *closed]
        aoi = validate_aoi(polygon_of(with_duplicate))
        assert len(aoi.ring) == 5
        assert aoi.is_point_mode is True

    def test_ignores_interior_hole_rings(self):
        outer = square_ring_around(MUPPANDAL_LON, MUPPANDAL_LAT, 5)
        hole = square_ring_around(MUPPANDAL_LON, MUPPANDAL_LAT, 1)
        geometry = {
            "type": "Polygon",
            "coordinates": [
                [[lon, lat] for lon, lat in outer],
                [[lon, lat] for lon, lat in hole],
            ],
        }
        aoi = validate_aoi(geometry)
        # hole does not reduce the area
        assert aoi.area_km2 >= 24
        assert aoi.area_km2 <= 26
        assert aoi.is_point_mode is True

    def test_accepts_ring_with_exactly_100_distinct_vertices(self):
        # closing repeat must NOT count against the cap
        ring = circle_ring(78.0, 15.0, 0.1, 100)
        aoi = validate_aoi(polygon_of(ring))
        assert aoi.is_point_mode is False
        assert aoi.area_km2 > 1


# ── validate_aoi error codes ────────────────────────────────────────────────


class TestValidateAoiErrorCodes:
    def test_self_intersecting_bowtie(self):
        bowtie = [
            (77.0, 15.0),
            (77.2, 15.2),
            (77.2, 15.0),
            (77.0, 15.2),
            (77.0, 15.0),
        ]
        expect_geometry_error(polygon_of(bowtie), "SELF_INTERSECTING")

    def test_area_too_large(self):
        # 60x60 km square ~= 3600 km^2
        ring = square_ring_around(76.5, 15.0, 60)
        expect_geometry_error(polygon_of(ring), "AREA_TOO_LARGE")

    def test_area_too_small(self):
        # 0.5x0.5 km square ~= 0.25 km^2
        ring = square_ring_around(MUPPANDAL_LON, MUPPANDAL_LAT, 0.5)
        expect_geometry_error(polygon_of(ring), "AREA_TOO_SMALL")

    def test_out_of_india_karachi(self):
        ring = square_ring_around(KARACHI_LON, KARACHI_LAT, 5)
        expect_geometry_error(polygon_of(ring), "OUT_OF_INDIA")

    def test_too_many_vertices(self):
        ring = circle_ring(78.0, 15.0, 0.1, 101)
        expect_geometry_error(polygon_of(ring), "TOO_MANY_VERTICES")

    def test_invalid_geometry_fewer_than_4_points(self):
        two_points = [
            (77.0, 15.0),
            (77.1, 15.0),
        ]
        expect_geometry_error(polygon_of(two_points), "INVALID_GEOMETRY")

    def test_invalid_geometry_canonicalization_collapses_to_point(self):
        # All vertices differ only at the 7th decimal -> identical after 6-dp.
        collapsing = [
            (77.0, 15.0),
            (77.0000001, 15.0),
            (77.0, 15.0000001),
            (77.0, 15.0),
        ]
        expect_geometry_error(polygon_of(collapsing), "INVALID_GEOMETRY")

    def test_invalid_geometry_empty_outer_ring(self):
        geometry = {"type": "Polygon", "coordinates": [[]]}
        expect_geometry_error(geometry, "INVALID_GEOMETRY")

    def test_invalid_geometry_non_polygon(self):
        geometry = {"type": "LineString", "coordinates": [[77, 15], [78, 16]]}
        expect_geometry_error(geometry, "INVALID_GEOMETRY")


# ── Point-mode fingerprint edges ────────────────────────────────────────────


class TestValidateAoiPointModeFingerprint:
    def test_axis_aligned_rectangle_outside_band_is_not_point_mode(self):
        # 6x6 km square ~= 36 km^2 — axis-aligned but too big
        ring = square_ring_around(77.5, 11.0, 6)
        aoi = validate_aoi(polygon_of(ring))
        assert aoi.is_point_mode is False

    def test_rotated_25_km2_diamond_is_not_point_mode(self):
        lon = 77.5
        lat = 11.0
        d_lat = 3.5355 / 110.574
        d_lon = 3.5355 / (111.32 * math.cos((lat * math.pi) / 180))
        diamond = [
            (lon - d_lon, lat),
            (lon, lat - d_lat),
            (lon + d_lon, lat),
            (lon, lat + d_lat),
            (lon - d_lon, lat),
        ]
        aoi = validate_aoi(polygon_of(diamond))
        # area in band but not axis-aligned -> not point mode
        assert aoi.area_km2 >= 24
        assert aoi.area_km2 <= 26
        assert aoi.is_point_mode is False


# ── canonical_geometry_string ───────────────────────────────────────────────


class TestCanonicalGeometryString:
    def test_stable_across_9th_decimal_jitter(self):
        base = square_ring_around(MUPPANDAL_LON, MUPPANDAL_LAT, 5)
        jittered = [(lon + 1e-9, lat - 1e-9) for lon, lat in base]
        base_key = canonical_geometry_string(validate_aoi(polygon_of(base)))
        jittered_key = canonical_geometry_string(validate_aoi(polygon_of(jittered)))
        assert base_key == jittered_key

    def test_emits_compact_json_with_no_whitespace(self):
        aoi = validate_aoi(
            polygon_of(square_ring_around(MUPPANDAL_LON, MUPPANDAL_LAT, 5))
        )
        key = canonical_geometry_string(aoi)
        assert (" " in key) is False
        assert ("\n" in key) is False
        assert key.startswith("[[") is True

    def test_differs_for_genuinely_different_geometry(self):
        a = canonical_geometry_string(
            validate_aoi(polygon_of(square_ring_around(MUPPANDAL_LON, MUPPANDAL_LAT, 5)))
        )
        b = canonical_geometry_string(
            validate_aoi(polygon_of(square_ring_around(77.6, 8.3, 5)))
        )
        assert a != b
