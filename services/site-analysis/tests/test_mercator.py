"""Foundation parity: web-mercator tile/pixel math (mercator.py).

Ported from mercator.test.ts. Anchor: Muppandal (77.55 E, 8.26 N) lands in z10
tile x=732 y=488 (the Phase-0 power-decode probe).
"""
import math

import pytest

from app.engine.mercator import (
    haversine_km,
    lat_to_tile_y,
    lng_to_tile_x,
    square_ring_around,
    tile_count_of,
    tile_cover_for_bbox,
    tile_x_to_lng,
    tile_y_to_lat,
)

Z10 = 10
MUPPANDAL = (77.55, 8.26)  # lon, lat
BHADLA = (71.92, 27.53)


class TestRoundTrips:
    @pytest.mark.parametrize("z", [0, 5, Z10])
    @pytest.mark.parametrize("lng", [-179.9, -77.3, 0, 77.55, 179.9])
    def test_x_round_trip(self, z, lng):
        assert tile_x_to_lng(lng_to_tile_x(lng, z), z) == pytest.approx(lng, abs=1e-9)

    @pytest.mark.parametrize("z", [0, 5, Z10])
    @pytest.mark.parametrize("lat", [-60, -8.26, 0, 8.26, 27.53, 60])
    def test_y_round_trip(self, z, lat):
        assert tile_y_to_lat(lat_to_tile_y(lat, z), z) == pytest.approx(lat, abs=1e-9)

    def test_muppandal_tile(self):
        assert math.floor(lng_to_tile_x(MUPPANDAL[0], Z10)) == 732
        assert math.floor(lat_to_tile_y(MUPPANDAL[1], Z10)) == 488


class TestTileCover:
    def test_degenerate_single_tile(self):
        cover = tile_cover_for_bbox((MUPPANDAL[0], MUPPANDAL[1], MUPPANDAL[0], MUPPANDAL[1]), Z10)
        assert (cover.min_x, cover.max_x, cover.min_y, cover.max_y) == (732, 732, 488, 488)
        assert tile_count_of(cover) == 1

    def test_east_seam_inclusive(self):
        seam_lng = tile_x_to_lng(733, Z10)
        cover = tile_cover_for_bbox((77.6, 8.2, seam_lng, 8.3), Z10)
        assert cover.min_x == 732
        assert cover.max_x == 733

    def test_west_seam_starts_at_owner(self):
        seam_lng = tile_x_to_lng(733, Z10)
        cover = tile_cover_for_bbox((seam_lng, 8.2, 77.75, 8.3), Z10)
        assert cover.min_x == 733
        assert cover.max_x >= 733

    def test_north_to_min_y(self):
        cover = tile_cover_for_bbox((77.5, 8.0, 77.6, 8.5), Z10)
        assert cover.min_y == math.floor(lat_to_tile_y(8.5, Z10))
        assert cover.max_y == math.floor(lat_to_tile_y(8.0, Z10))
        assert cover.min_y < cover.max_y

    def test_world_spanning_clamps(self):
        z = 2
        tiles_per_side = 2**z
        cover = tile_cover_for_bbox((-180, -85, 180, 85), z)
        assert (cover.min_x, cover.max_x) == (0, tiles_per_side - 1)
        assert (cover.min_y, cover.max_y) == (0, tiles_per_side - 1)
        assert tile_count_of(cover) == tiles_per_side * tiles_per_side

    def test_tile_count_multiplies(self):
        from app.engine.types import TileCover

        assert tile_count_of(TileCover(z=Z10, min_x=2, max_x=4, min_y=1, max_y=2)) == 6


class TestHaversine:
    def test_identical_is_zero(self):
        assert haversine_km(MUPPANDAL[1], MUPPANDAL[0], MUPPANDAL[1], MUPPANDAL[0]) == 0

    def test_symmetric(self):
        ab = haversine_km(MUPPANDAL[1], MUPPANDAL[0], BHADLA[1], BHADLA[0])
        ba = haversine_km(BHADLA[1], BHADLA[0], MUPPANDAL[1], MUPPANDAL[0])
        assert ab == pytest.approx(ba, abs=1e-9)

    def test_muppandal_to_bhadla(self):
        d = haversine_km(MUPPANDAL[1], MUPPANDAL[0], BHADLA[1], BHADLA[0])
        assert abs(d - 2223) <= 15


class TestSquareRing:
    def test_closed_five_points(self):
        ring = square_ring_around(MUPPANDAL[0], MUPPANDAL[1], 5)
        assert len(ring) == 5
        assert ring[0] == ring[4]

    def test_centered(self):
        ring = square_ring_around(BHADLA[0], BHADLA[1], 5)
        corners = ring[:4]
        mean_lon = sum(p[0] for p in corners) / 4
        mean_lat = sum(p[1] for p in corners) / 4
        assert mean_lon == pytest.approx(BHADLA[0], abs=1e-9)
        assert mean_lat == pytest.approx(BHADLA[1], abs=1e-9)
