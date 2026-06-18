"""tiles.py tests -- ported from tiles.test.ts.

Offline tests inject a synthetic fetcher (the ``fetch_impl`` seam) serving real
float32 GeoTIFF bytes encoded with rasterio's MemoryFile (the Python analogue of
geotiff's ``writeArrayBuffer``), and point ``TILE_CACHE_DIR`` at a per-test tmp
dir.

The LIVE suite at the bottom (skipped unless RUN_LIVE=1) is the Phase-1 risk-item
proof that rasterio decodes real GWA tiler tiles, asserted against the exact pixel
values pinned in VERIFIED.md. It needs the network, so it is skipped by default.

Dropped vs tiles.test.ts: none -- every TS case is ported. (Helper-only cases for
mercator live in tests/test_mercator.py; tiles.test.ts has none.)
"""
from __future__ import annotations

import math
import os
import re
import warnings

import numpy as np
import pytest

from app.config import ANALYSIS_ZOOM, GWA_LAYERS, GWA_TILER_BASE
from app.engine.mercator import (
    TILE_SIZE,
    lat_to_tile_y,
    lng_to_tile_x,
    square_ring_around,
    tile_cover_for_bbox,
    tile_x_to_lng,
    tile_y_to_lat,
)
from app.engine.types import LayerPatch, TileCover
from app.engine.tiles import (
    fetch_layer_patch,
    fetch_point_value,
    stitch_tiles,
)

TILE_PIXELS = TILE_SIZE * TILE_SIZE


# ── Helpers ──────────────────────────────────────────────────────────────────


def encode_float32_tile(values: np.ndarray) -> bytes:
    """Encode a flat row-major (TILE_PIXELS,) float32 array as GeoTIFF bytes --
    the rasterio analogue of the TS ``encodeFloat32Tile`` (geotiff writeArrayBuffer
    with BitsPerSample=32, SampleFormat=IEEE-float, single band)."""
    from rasterio.errors import NotGeoreferencedWarning
    from rasterio.io import MemoryFile

    arr = np.asarray(values, dtype=np.float32).reshape(TILE_SIZE, TILE_SIZE)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", NotGeoreferencedWarning)
        with MemoryFile() as memfile:
            with memfile.open(
                driver="GTiff",
                width=TILE_SIZE,
                height=TILE_SIZE,
                count=1,
                dtype="float32",
            ) as ds:
                ds.write(arr, 1)
            return memfile.read()


def constant_tile(value: float) -> np.ndarray:
    return np.full(TILE_PIXELS, value, dtype=np.float32)


class _FakeResponse:
    """Mirrors the subset of ``new Response(...)`` the loader touches."""

    def __init__(self, status: int, body: bytes = b"") -> None:
        self.status = status
        self.ok = 200 <= status < 300
        self._body = body

    def array_buffer(self) -> bytes:
        return self._body


_URL_RE = re.compile(r"/tiles/(\d+)/(\d+)/(\d+)\.tif$")


def make_tile_fetcher(tile_for):
    """Fetcher serving encode_float32_tile(tile_for(x, y)); records every call.
    Mirrors the TS ``makeTileFetcher`` (404 when tile_for returns None)."""
    calls: list[dict] = []

    def fetch_impl(url: str, headers: dict, timeout_ms: int) -> _FakeResponse:
        calls.append({"url": url, "userAgent": headers.get("User-Agent")})
        match = _URL_RE.search(url)
        if not match:
            return _FakeResponse(400, b"bad url")
        tile = tile_for(int(match.group(2)), int(match.group(3)))
        if tile is None:
            return _FakeResponse(404, b"not found")
        return _FakeResponse(200, encode_float32_tile(tile))

    return fetch_impl, calls


def patch_pixel(patch: LayerPatch, row: int, col: int) -> float:
    return float(patch.data[row * patch.width_px + col])


def count_finite(patch: LayerPatch) -> int:
    return int(np.isfinite(patch.data).sum())


def bbox_of_ring(ring) -> tuple[float, float, float, float]:
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return (min(lons), min(lats), max(lons), max(lats))


# A bbox chosen to span 2 tiles wide x 1 tile tall at z10 (tile x boundary at
# lng 77.6953125 ~= tile 733; y stays in tile 488).
TWO_TILE_BBOX: tuple[float, float, float, float] = (77.6, 8.25, 77.8, 8.3)


# ── Cache dir isolation (beforeEach/afterEach) ───────────────────────────────


@pytest.fixture
def cache_dir(tmp_path, monkeypatch):
    """Per-test tmp cache dir, exported via TILE_CACHE_DIR (resolve_tile_cache_dir
    reads it per call)."""
    d = tmp_path / "gwa-tiles-test"
    d.mkdir()
    monkeypatch.setenv("TILE_CACHE_DIR", str(d))
    return d


# ── stitch_tiles (pure) ──────────────────────────────────────────────────────


def test_stitch_tiles_places_a_single_tile_verbatim_in_a_1x1_cover():
    # Arrange
    cover = TileCover(z=10, min_x=5, max_x=5, min_y=7, max_y=7)
    tile = np.arange(TILE_PIXELS, dtype=np.float32)

    # Act
    patch = stitch_tiles(cover, [tile])

    # Assert
    assert patch.zoom == 10
    assert patch.min_tile_x == 5
    assert patch.min_tile_y == 7
    assert patch.width_px == TILE_SIZE
    assert patch.height_px == TILE_SIZE
    assert patch_pixel(patch, 0, 0) == 0
    assert patch_pixel(patch, 1, 0) == TILE_SIZE
    assert patch_pixel(patch, 255, 255) == TILE_PIXELS - 1


def test_stitch_tiles_stitches_2x2_row_major_and_leaves_a_missing_tile_as_nan():
    # Arrange: row-major order is (x10,y20), (x11,y20), (x10,y21), missing.
    cover = TileCover(z=10, min_x=10, max_x=11, min_y=20, max_y=21)
    tiles = [constant_tile(1), constant_tile(2), constant_tile(3), None]

    # Act
    patch = stitch_tiles(cover, tiles)

    # Assert
    assert patch.width_px == 2 * TILE_SIZE
    assert patch.height_px == 2 * TILE_SIZE
    assert patch_pixel(patch, 0, 0) == 1  # NW tile
    assert patch_pixel(patch, 0, TILE_SIZE) == 2  # NE tile
    assert patch_pixel(patch, TILE_SIZE, 0) == 3  # SW tile
    assert math.isnan(patch_pixel(patch, TILE_SIZE + 10, TILE_SIZE + 10))  # SE missing


def test_stitch_tiles_throws_when_tile_count_does_not_match_cover():
    # Arrange
    cover = TileCover(z=10, min_x=0, max_x=1, min_y=0, max_y=0)

    # Act + Assert
    with pytest.raises(ValueError, match=r"needs 2 tiles"):
        stitch_tiles(cover, [constant_tile(1)])


def test_stitch_tiles_does_not_mutate_its_input_tiles():
    # Arrange
    cover = TileCover(z=10, min_x=0, max_x=0, min_y=0, max_y=0)
    tile = constant_tile(4)
    copy_before = np.array(tile, dtype=np.float32)

    # Act
    patch = stitch_tiles(cover, [tile])
    patch.data.fill(99)

    # Assert
    assert np.array_equal(tile, copy_before)


# ── fetch_layer_patch (injected fetcher) ─────────────────────────────────────


def test_fetch_layer_patch_fetches_decodes_and_stitches_with_correct_urls_and_user_agent(
    cache_dir,
):
    # Arrange
    layer = GWA_LAYERS["ws100"]
    cover = tile_cover_for_bbox(TWO_TILE_BBOX, ANALYSIS_ZOOM)
    assert (cover.max_x - cover.min_x + 1) * (cover.max_y - cover.min_y + 1) == 2
    fetch_impl, calls = make_tile_fetcher(lambda x, y: constant_tile(x * 1000 + y))

    # Act
    patch = fetch_layer_patch(layer, TWO_TILE_BBOX, fetch_impl)

    # Assert
    assert patch.width_px == 2 * TILE_SIZE
    assert patch.height_px == TILE_SIZE
    assert patch_pixel(patch, 10, 10) == cover.min_x * 1000 + cover.min_y
    assert patch_pixel(patch, 10, TILE_SIZE + 10) == (cover.min_x + 1) * 1000 + cover.min_y
    assert len(calls) == 2
    expected_urls = [
        f"{GWA_TILER_BASE}/{layer}/tiles/{ANALYSIS_ZOOM}/{cover.min_x}/{cover.min_y}.tif",
        f"{GWA_TILER_BASE}/{layer}/tiles/{ANALYSIS_ZOOM}/{cover.min_x + 1}/{cover.min_y}.tif",
    ]
    assert sorted(c["url"] for c in calls) == sorted(expected_urls)
    assert all(c["userAgent"] == "wce-analysis" for c in calls)


def test_fetch_layer_patch_writes_raw_tif_bytes_to_cache_layout(cache_dir):
    # Arrange
    layer = GWA_LAYERS["cfIec3"]
    cover = tile_cover_for_bbox(TWO_TILE_BBOX, ANALYSIS_ZOOM)
    fetch_impl, _ = make_tile_fetcher(lambda x, y: constant_tile(0.5))

    # Act
    fetch_layer_patch(layer, TWO_TILE_BBOX, fetch_impl)

    # Assert
    for x in (cover.min_x, cover.min_x + 1):
        file_path = (
            cache_dir / "gwa" / layer / str(ANALYSIS_ZOOM) / str(x) / f"{cover.min_y}.tif"
        )
        assert file_path.stat().st_size > TILE_PIXELS * 4  # raw float32 + tif headers


def test_fetch_layer_patch_serves_cached_tiles_without_calling_the_fetcher_again(
    cache_dir,
):
    # Arrange: warm the cache, then hand over a fetcher that always fails.
    layer = GWA_LAYERS["ws100"]
    warm_impl, _ = make_tile_fetcher(lambda x, y: constant_tile(7.5))
    fetch_layer_patch(layer, TWO_TILE_BBOX, warm_impl)

    cold_calls: list = []

    def tracked_cold(url, headers, timeout_ms):
        cold_calls.append(url)
        raise RuntimeError("network down")

    # Act
    patch = fetch_layer_patch(layer, TWO_TILE_BBOX, tracked_cold)

    # Assert
    assert len(cold_calls) == 0
    assert patch_pixel(patch, 0, 0) == 7.5
    assert count_finite(patch) == 2 * TILE_PIXELS


def test_fetch_layer_patch_treats_upstream_404_as_all_nan_tile_not_an_error(cache_dir):
    # Arrange
    layer = GWA_LAYERS["rix"]
    fetch_impl, _ = make_tile_fetcher(lambda x, y: None)  # every tile 404s

    # Act
    patch = fetch_layer_patch(layer, TWO_TILE_BBOX, fetch_impl)

    # Assert
    assert count_finite(patch) == 0
    # No bytes were cached for 404s.
    assert not (cache_dir / "gwa" / layer).exists()


def test_fetch_layer_patch_throws_descriptive_error_on_upstream_500_no_cache(cache_dir):
    # Arrange
    def fetch_impl(url, headers, timeout_ms):
        return _FakeResponse(500, b"boom")

    # Act + Assert
    with pytest.raises(RuntimeError, match=r"HTTP 500.*no cached copy"):
        fetch_layer_patch(GWA_LAYERS["ws100"], TWO_TILE_BBOX, fetch_impl)


def test_fetch_layer_patch_throws_descriptive_error_when_fetch_itself_rejects(cache_dir):
    # Arrange
    def fetch_impl(url, headers, timeout_ms):
        raise RuntimeError("socket reset")

    # Act + Assert
    with pytest.raises(RuntimeError, match=r"GWA tile fetch failed.*socket reset"):
        fetch_layer_patch(GWA_LAYERS["ws100"], TWO_TILE_BBOX, fetch_impl)


# ── fetch_point_value (injected fetcher) ─────────────────────────────────────


def test_fetch_point_value_returns_the_exact_pixel_containing_the_coordinate(cache_dir):
    # Arrange: one marked pixel; query the lon/lat of that pixel's center.
    layer = GWA_LAYERS["ws100"]
    tile_x = 732
    tile_y = 488
    marked_col = 100
    marked_row = 50
    marked_value = 9.4894
    tile = constant_tile(1)
    tile[marked_row * TILE_SIZE + marked_col] = marked_value
    fetch_impl, _ = make_tile_fetcher(
        lambda x, y: tile if (x == tile_x and y == tile_y) else None
    )
    lon = tile_x_to_lng(tile_x + (marked_col + 0.5) / TILE_SIZE, ANALYSIS_ZOOM)
    lat = tile_y_to_lat(tile_y + (marked_row + 0.5) / TILE_SIZE, ANALYSIS_ZOOM)

    # Act
    value = fetch_point_value(layer, lon, lat, fetch_impl)

    # Assert
    assert value == pytest.approx(marked_value, abs=1e-4)


def test_fetch_point_value_returns_none_for_a_nodata_nan_pixel(cache_dir):
    # Arrange
    fetch_impl, _ = make_tile_fetcher(lambda x, y: constant_tile(np.nan))

    # Act
    value = fetch_point_value(GWA_LAYERS["rix"], 77.55, 8.26, fetch_impl)

    # Assert
    assert value is None


def test_fetch_point_value_returns_none_when_containing_tile_is_missing_404(cache_dir):
    # Arrange
    fetch_impl, _ = make_tile_fetcher(lambda x, y: None)

    # Act
    value = fetch_point_value(GWA_LAYERS["ws100"], 77.55, 8.26, fetch_impl)

    # Assert
    assert value is None


def test_fetch_point_value_throws_on_non_finite_coordinates():
    # Act + Assert
    with pytest.raises(ValueError, match=r"non-finite coordinates"):
        fetch_point_value(GWA_LAYERS["ws100"], math.nan, 8.26)


# ── LIVE integration (Phase-1 risk item: rasterio vs real GWA tiles) ─────────
# Needs the network -- skipped unless RUN_LIVE=1. Faithfully ported from the
# liveTest block of tiles.test.ts (deferred[]: live-network only).

_RUN_LIVE = os.environ.get("RUN_LIVE") == "1"
live = pytest.mark.skipif(not _RUN_LIVE, reason="live network (set RUN_LIVE=1)")


@live
def test_live_fetch_point_value_at_muppandal_matches_verified_pixel(cache_dir):
    # Act
    value = fetch_point_value(GWA_LAYERS["ws100"], 77.55, 8.26)

    # Assert: VERIFIED.md §1 pins ws_mean_hgt100m = 9.4894 at this pixel.
    print("[live] Muppandal ws_mean_hgt100m point value:", value)
    assert value is not None
    assert abs(value - 9.4894) <= 0.02


@live
def test_live_fetch_layer_patch_over_muppandal_5x5km_yields_ge_300_finite(cache_dir):
    # Arrange
    bbox = bbox_of_ring(square_ring_around(77.55, 8.26, 5))

    # Act
    patch = fetch_layer_patch(GWA_LAYERS["ws100"], bbox)

    # Assert
    finite = count_finite(patch)
    print(
        "[live] Muppandal patch:",
        {"widthPx": patch.width_px, "heightPx": patch.height_px, "finitePixels": finite},
    )
    assert patch.zoom == ANALYSIS_ZOOM
    assert finite >= 300


@live
def test_live_a_second_point_read_is_served_from_the_disk_cache(cache_dir):
    # Arrange: first read warms the tmp cache dir.
    first = fetch_point_value(GWA_LAYERS["ws100"], 77.55, 8.26)

    def failing_fetch(url, headers, timeout_ms):
        raise RuntimeError("network must not be hit")

    # Act
    second = fetch_point_value(GWA_LAYERS["ws100"], 77.55, 8.26, failing_fetch)

    # Assert
    assert second == first
