"""Section D parity: grid infrastructure (grid.py).

Ported from apps/api/src/services/analysis/grid.test.ts. The pure cases
(parseVoltageKv, maxVoltageKvOf, pointToSegmentKm, padBboxKm, newTileCoords,
summarizeGridFeatures, constants) run offline verbatim.

The legacy ``computeGrid (live)`` case is ``test.skipIf(SKIP_LIVE)`` — a real
network hit against openinframap.org. It is preserved here, skipped by default
(see ``deferred``). An EXTRA offline test exercises the expanding-ring
orchestration with an INJECTED synthetic MVT fetcher (the module-note seam) so
the search/accumulate/summary pipeline is covered without the network.
"""
from __future__ import annotations

import math
import os

import mapbox_vector_tile
import pytest

from app.engine.geometry import validate_aoi
from app.engine.grid import (
    EHV_MIN_KV,
    GRID_SEARCH_PADS_KM,
    PowerLineFeature,
    SubstationFeature,
    compute_grid,
    max_voltage_kv_of,
    new_tile_coords,
    pad_bbox_km,
    parse_voltage_kv,
    point_to_segment_km,
    project_tile_point,
    summarize_grid_features,
    tile_key,
)
from app.engine.mercator import square_ring_around

KM_PER_DEG = 111.195  # EARTH_RADIUS_KM · π/180


def line_of(parts, voltage_kv, max_voltage_kv=...):
    """grid.test.ts lineOf helper: id-less line; maxVoltageKv defaults to voltageKv."""
    mv = voltage_kv if max_voltage_kv is ... else max_voltage_kv
    return PowerLineFeature(id=None, voltage_kv=voltage_kv, max_voltage_kv=mv, parts=parts)


def substation_of(lon, lat, voltage_kv, name=None, max_voltage_kv=...):
    """grid.test.ts substationOf helper: id-less substation."""
    mv = voltage_kv if max_voltage_kv is ... else max_voltage_kv
    return SubstationFeature(
        id=None, name=name, voltage_kv=voltage_kv, max_voltage_kv=mv, lon=lon, lat=lat
    )


# ── parseVoltageKv (grid.test.ts:39-59) ─────────────────────────────────────


class TestParseVoltageKv:
    def test_passes_numeric_kv_through(self):
        assert parse_voltage_kv(400) == 400

    def test_parses_float_noise_substation_strings(self):
        assert parse_voltage_kv("110.0000000000000000") == 110

    def test_takes_the_max_of_semicolon_joined_multi_voltage_strings(self):
        assert parse_voltage_kv("220;400") == 400

    def test_returns_null_for_garbage_zero_negative_empty_null(self):
        assert parse_voltage_kv("substation") is None
        assert parse_voltage_kv(0) is None
        assert parse_voltage_kv(-5) is None
        assert parse_voltage_kv("") is None
        assert parse_voltage_kv(None) is None


# ── maxVoltageKvOf (grid.test.ts:61-70) ─────────────────────────────────────


class TestMaxVoltageKvOf:
    def test_takes_the_max_across_voltage_voltage2_voltage3(self):
        assert max_voltage_kv_of({"voltage": 110, "voltage_2": "220", "voltage_3": 66}) == 220

    def test_returns_null_when_no_prop_parses(self):
        assert max_voltage_kv_of({}) is None
        assert max_voltage_kv_of({"voltage": "?"}) is None


# ── pointToSegmentKm (grid.test.ts:72-89) ───────────────────────────────────


class TestPointToSegmentKm:
    def test_point_abeam_segment_measures_perpendicular_distance(self):
        # Segment along lat=0.1° from lon −1…1; ref at the origin sits abeam.
        d = point_to_segment_km(0, 0, 0.1, -1, 0.1, 1)
        assert d == pytest.approx(0.1 * KM_PER_DEG, abs=0.05)

    def test_point_beyond_an_endpoint_measures_distance_to_that_endpoint(self):
        # Segment receding to the northeast; nearest point is endpoint A (1,1).
        d = point_to_segment_km(0, 0, 1, 1, 2, 1)
        assert d == pytest.approx(math.sqrt(2) * KM_PER_DEG, abs=0.5)

    def test_degenerate_zero_length_segment_collapses_to_point_distance(self):
        d = point_to_segment_km(0, 0, 0.5, 0, 0.5, 0)
        assert d == pytest.approx(0.5 * KM_PER_DEG, abs=0.05)


# ── padBboxKm (grid.test.ts:91-101) ─────────────────────────────────────────


class TestPadBboxKm:
    def test_grows_every_side_by_the_pad_at_the_mid_lat(self):
        w, s, e, n = pad_bbox_km((77, 8, 78, 9), 10)
        d_lat = 10 / 110.574
        d_lon = 10 / (111.32 * math.cos((8.5 * math.pi) / 180))
        assert w == pytest.approx(77 - d_lon, abs=1e-6)
        assert s == pytest.approx(8 - d_lat, abs=1e-6)
        assert e == pytest.approx(78 + d_lon, abs=1e-6)
        assert n == pytest.approx(9 + d_lat, abs=1e-6)


# ── newTileCoords (grid.test.ts:103-119) ────────────────────────────────────


class TestNewTileCoords:
    def test_returns_only_tiles_not_in_seen_and_never_mutates_it(self):
        bbox = (77.5, 8.2, 77.6, 8.3)
        first = new_tile_coords(bbox, 10, set())
        assert len(first) > 0
        seen = {tile_key(first[0][0], first[0][1])}

        rest = new_tile_coords(bbox, 10, seen)

        assert len(rest) == len(first) - 1
        assert not any(tile_key(c[0], c[1]) == tile_key(first[0][0], first[0][1]) for c in rest)
        assert len(seen) == 1


# ── summarizeGridFeatures (grid.test.ts:121-188) ────────────────────────────


class TestSummarizeGridFeatures:
    CENTROID = (77.55, 8.26)

    def test_picks_nearest_substation_and_line_reporting_primary_voltage(self):
        # near sub ~1.1 km north; far sub ~11 km.
        subs = [
            substation_of(77.55, 8.27, 110, "Near"),
            substation_of(77.55, 8.36, 400, "Far"),
        ]
        # Line passing ~2.2 km east of the centroid, untagged voltage.
        lines = [line_of([[(77.57, 8.0), (77.57, 8.5)]], None)]

        result = summarize_grid_features(self.CENTROID, lines, subs)

        assert result["nearestSubstation"]["name"] == "Near"
        assert result["nearestSubstation"]["voltageKv"] == 110
        assert result["nearestSubstation"]["distanceKm"] == pytest.approx(1.1, abs=0.5)
        # Null-voltage line is KEPT and reported with voltageKv null.
        assert result["nearestLine"] is not None
        assert result["nearestLine"]["voltageKv"] is None
        assert "OSM" in result["dataNote"]

    def test_ehv_classification_uses_max_voltage_not_primary(self):
        # Substation whose primary is 110 but voltage_2 carries 400 — EHV.
        subs = [substation_of(77.55, 8.27, 110, "Dual", 400)]

        result = summarize_grid_features(self.CENTROID, [], subs)

        assert result["nearestSubstation"]["voltageKv"] == 110
        assert result["ehvWithin25Km"] is True
        assert result["nearestEhvKm"] == pytest.approx(1.1, abs=0.5)

    def test_sub_ehv_voltages_never_set_the_ehv_flag(self):
        subs = [substation_of(77.55, 8.27, EHV_MIN_KV - 1, "SubEhv")]

        result = summarize_grid_features(self.CENTROID, [], subs)

        assert result["ehvWithin25Km"] is False
        assert result["nearestEhvKm"] is None

    def test_ehv_beyond_25_km_reports_distance_but_not_within_flag(self):
        # ~55.6 km north — EHV exists, flag stays false.
        subs = [substation_of(77.55, 8.76, 400, "FarEhv")]

        result = summarize_grid_features(self.CENTROID, [], subs)

        assert result["ehvWithin25Km"] is False
        assert result["nearestEhvKm"] == pytest.approx(55.6, abs=0.5)

    def test_empty_inputs_produce_the_all_null_degraded_shape(self):
        result = summarize_grid_features(self.CENTROID, [], [])

        assert result["nearestSubstation"] is None
        assert result["nearestLine"] is None
        assert result["ehvWithin25Km"] is False
        assert result["nearestEhvKm"] is None


# ── constants (grid.test.ts:190-194) ────────────────────────────────────────


class TestConstants:
    def test_search_pads_expand_monotonically_to_the_100_km_cap(self):
        assert list(GRID_SEARCH_PADS_KM) == [10, 25, 50, 100]


# ── computeGrid (live) — grid.test.ts:196-217 ───────────────────────────────


@pytest.mark.skipif(
    os.environ.get("SKIP_LIVE", "1") == "1",
    reason="live: hits openinframap.org (set SKIP_LIVE=0 to run)",
)
def test_finds_the_muppandal_substation_and_a_nearby_line():
    aoi = validate_aoi({"type": "Polygon", "coordinates": [square_ring_around(77.55, 8.26, 5)]})

    result = compute_grid(aoi)

    assert result["nearestSubstation"] is not None
    assert result["nearestSubstation"]["distanceKm"] < 5
    assert result["nearestLine"] is not None
    assert result["nearestLine"]["distanceKm"] < 5


# ── computeGrid (offline, injected MVT) — extra orchestration coverage ───────
#
# grid.test.ts only exercises computeGrid via the skipped live case. This drives
# the same expanding-ring/accumulate/summary path OFFLINE with a synthetic MVT
# fetcher (the options.fetchImpl seam the module note calls out), so the orchestration
# is covered without the network. Not a 1:1 .ts port — recorded in parity_notes.


class _FakeResponse:
    """Mirrors the tiles.py TileResponse protocol (status / ok / array_buffer())."""

    def __init__(self, status: int, body: bytes) -> None:
        self._status = status
        self._body = body

    @property
    def status(self) -> int:
        return self._status

    @property
    def ok(self) -> bool:
        return 200 <= self._status < 300

    def array_buffer(self) -> bytes:
        return self._body


def _encode_power_tile(lon: float, lat: float, voltage, name, tile_x: int, tile_y: int, z: int):
    """Encode a power MVT tile holding ONE substation point + ONE line at [lon, lat].

    The tile-pixel coordinates are the inverse of project_tile_point so the decoded
    feature lands back at the intended lon/lat. extent=4096, y_coord_down=True."""
    extent = 4096
    size = extent * (2**z)
    # invert project_tile_point for the point coords
    px = (lon + 180) / 360 * size - extent * tile_x
    merc_y = 1 - math.log(math.tan((lat + 90) * math.pi / 360)) / math.pi
    py = merc_y / 2 * size - extent * tile_y
    layers = [
        {
            "name": "power_substation_point",
            "features": [
                {
                    "geometry": f"POINT({px} {py})",
                    "properties": {"voltage": voltage, "name": name},
                    "id": 1,
                }
            ],
        },
        {
            "name": "power_line",
            "features": [
                {
                    "geometry": f"LINESTRING({px} {py - 50}, {px} {py + 50})",
                    "properties": {"voltage": voltage},
                    "id": 2,
                }
            ],
        },
    ]
    return mapbox_vector_tile.encode(
        layers, default_options={"extents": extent, "y_coord_down": True}
    )


def test_compute_grid_offline_finds_injected_substation_and_line():
    lon, lat = 77.55, 8.26
    aoi = validate_aoi({"type": "Polygon", "coordinates": [square_ring_around(lon, lat, 5)]})
    z = 10
    # The tile containing the AOI centroid.
    tile_x = math.floor((lon + 180) / 360 * (2**z))
    merc_y = 1 - math.log(math.tan((lat + 90) * math.pi / 360)) / math.pi
    tile_y = math.floor(merc_y / 2 * (2**z))
    target = _encode_power_tile(lon, lat, "220", "Injected", tile_x, tile_y, z)

    def fake_fetch(url, headers, timeout_ms):
        # Serve the populated tile only for the centroid tile; 404 elsewhere.
        if f"/{tile_x}/{tile_y}.pbf" in url:
            return _FakeResponse(200, target)
        return _FakeResponse(404, b"")

    result = compute_grid(aoi, fetch_impl=fake_fetch)

    assert result["nearestSubstation"] is not None
    assert result["nearestSubstation"]["name"] == "Injected"
    assert result["nearestSubstation"]["voltageKv"] == 220
    assert result["nearestSubstation"]["distanceKm"] < 5
    assert result["nearestLine"] is not None
    assert result["nearestLine"]["distanceKm"] < 5
    assert result["ehvWithin25Km"] is True
    assert result["nearestEhvKm"] is not None and result["nearestEhvKm"] < 5
    assert result["dataNote"] == "OSM-derived; may be incomplete"


def test_compute_grid_first_ring_total_failure_raises():
    aoi = validate_aoi({"type": "Polygon", "coordinates": [square_ring_around(77.55, 8.26, 5)]})

    def failing_fetch(url, headers, timeout_ms):
        raise RuntimeError("network down")

    # No cached fallback (point a tmp empty cache dir), first ring fails entirely.
    old = os.environ.get("TILE_CACHE_DIR")
    os.environ["TILE_CACHE_DIR"] = "/tmp/grid-test-empty-cache-does-not-exist"
    try:
        with pytest.raises(RuntimeError, match="first search ring"):
            compute_grid(aoi, fetch_impl=failing_fetch)
    finally:
        if old is None:
            os.environ.pop("TILE_CACHE_DIR", None)
        else:
            os.environ["TILE_CACHE_DIR"] = old


def test_project_tile_point_roundtrips_through_mercator():
    # project_tile_point must invert the encode coords (sanity for the fixture math).
    z, extent = 10, 4096
    lon, lat = 77.55, 8.26
    tile_x = math.floor((lon + 180) / 360 * (2**z))
    merc_y = 1 - math.log(math.tan((lat + 90) * math.pi / 360)) / math.pi
    tile_y = math.floor(merc_y / 2 * (2**z))
    size = extent * (2**z)
    px = (lon + 180) / 360 * size - extent * tile_x
    py = merc_y / 2 * size - extent * tile_y
    out_lon, out_lat = project_tile_point(px, py, extent, tile_x, tile_y, z)
    assert out_lon == pytest.approx(lon, abs=1e-6)
    assert out_lat == pytest.approx(lat, abs=1e-6)
