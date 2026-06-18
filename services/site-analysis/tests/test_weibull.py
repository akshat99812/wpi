"""weibull.py tests — port of apps/api/src/services/analysis/weibull.test.ts.

Pure tests: geotransform→window math with synthetic transforms, ray-cast
point-in-ring, Lanczos gamma. Live tests (need the COGs on disk under
config.WEIBULL_A_PATH/K_PATH and SKIP_LIVE != "1"): Muppandal 5×5 km area means
vs VERIFIED.md §2 truth, the NaN-mask-null path, and reset round-trip.

Parity notes vs the .test.ts:
  - The TS imports WEIBULL_COG_PATHS (a frozen object resolved off import.meta.url)
    to existsSync-gate the live tests. The Python module pins the paths in
    config.WEIBULL_A_PATH / WEIBULL_K_PATH (DATA_DIR-relative); the gate reads
    those instead — same files, same skip behaviour. Run with
    ANALYSIS_DATA_DIR=apps/api/data to resolve them.
  - No helpers were dropped to the foundation: bbox_pixel_window /
    pixel_center_lng_lat / is_inside_ring / gamma_fn are all weibull's OWN tiny
    ray-cast/window helpers (the documented dual ray-cast — mask.py's grid model
    differs), so every case is kept. Only square_ring_around is imported from the
    foundation (mercator.py), exactly as the .ts imports it from ./mercator.
"""
from __future__ import annotations

import math
import os

import pytest

from app import config
from app.engine.mercator import square_ring_around
from app.engine.weibull import (
    GeoTransform,
    MAX_WINDOW_PIXELS,
    PixelWindow,
    aoi_weibull_means,
    bbox_pixel_window,
    gamma_fn,
    is_inside_ring,
    pixel_center_lng_lat,
    reset_weibull_cogs,
)

# Synthetic north-up transform: lon 70–80, lat 20–30, 0.01° pixels.
SYNTH_TRANSFORM = GeoTransform(
    origin_x=70,
    origin_y=30,
    pixel_width=0.01,
    pixel_height=-0.01,
    width_px=1000,
    height_px=1000,
)


# ── bboxPixelWindow ──────────────────────────────────────────────────────────


def test_maps_a_pixel_aligned_interior_bbox_to_the_exact_pixel_range():
    # Arrange
    bbox = (72, 27, 73, 28)

    # Act
    window = bbox_pixel_window(SYNTH_TRANSFORM, bbox)

    # Assert
    assert window == PixelWindow(x0=200, y0=200, x1=300, y1=300)


def test_expands_a_fractional_bbox_outward_to_whole_covering_pixels():
    # Arrange — bbox straddles pixel edges by half a pixel on every side
    bbox = (72.005, 27.995, 72.015, 28.005)

    # Act
    window = bbox_pixel_window(SYNTH_TRANSFORM, bbox)

    # Assert
    assert window == PixelWindow(x0=200, y0=199, x1=202, y1=201)


def test_clamps_a_bbox_overhanging_the_north_west_corner_to_the_image():
    # Arrange
    bbox = (69, 29.5, 70.5, 31)

    # Act
    window = bbox_pixel_window(SYNTH_TRANSFORM, bbox)

    # Assert
    assert window == PixelWindow(x0=0, y0=0, x1=50, y1=50)


def test_returns_none_when_the_bbox_lies_entirely_off_the_raster():
    # Arrange
    bbox = (81, 20, 82, 21)

    # Act
    window = bbox_pixel_window(SYNTH_TRANSFORM, bbox)

    # Assert
    assert window is None


def test_throws_when_the_window_would_exceed_the_defensive_pixel_cap():
    # Arrange — a country-sized raster with a bbox covering all of it
    huge_transform = GeoTransform(
        origin_x=SYNTH_TRANSFORM.origin_x,
        origin_y=SYNTH_TRANSFORM.origin_y,
        pixel_width=0.001,
        pixel_height=-0.001,
        width_px=10_000,
        height_px=10_000,
    )
    bbox = (70, 20, 80, 30)

    # Act + Assert
    with pytest.raises(ValueError, match=str(MAX_WINDOW_PIXELS)):
        bbox_pixel_window(huge_transform, bbox)


def test_throws_on_a_transform_that_is_not_north_up():
    # Arrange
    south_up = GeoTransform(
        origin_x=SYNTH_TRANSFORM.origin_x,
        origin_y=SYNTH_TRANSFORM.origin_y,
        pixel_width=SYNTH_TRANSFORM.pixel_width,
        pixel_height=0.01,
        width_px=SYNTH_TRANSFORM.width_px,
        height_px=SYNTH_TRANSFORM.height_px,
    )

    # Act + Assert
    with pytest.raises(ValueError, match="north-up"):
        bbox_pixel_window(south_up, (72, 27, 73, 28))


# ── pixelCenterLngLat ────────────────────────────────────────────────────────


def test_returns_the_half_pixel_offset_center_of_a_full_image_pixel():
    # Act
    lon, lat = pixel_center_lng_lat(SYNTH_TRANSFORM, 200, 200)

    # Assert
    assert lon == pytest.approx(72.005, abs=1e-10)
    assert lat == pytest.approx(27.995, abs=1e-10)


def test_returns_the_center_of_pixel_0_0_just_inside_the_origin_corner():
    # Act
    lon, lat = pixel_center_lng_lat(SYNTH_TRANSFORM, 0, 0)

    # Assert
    assert lon == pytest.approx(70.005, abs=1e-10)
    assert lat == pytest.approx(29.995, abs=1e-10)


# ── isInsideRing ─────────────────────────────────────────────────────────────

UNIT_SQUARE = [(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)]


def test_returns_true_for_a_point_inside_the_ring():
    assert is_inside_ring(0.5, 0.5, UNIT_SQUARE) is True


def test_returns_false_for_a_point_outside_the_ring():
    assert is_inside_ring(1.5, 0.5, UNIT_SQUARE) is False
    assert is_inside_ring(-0.2, 0.5, UNIT_SQUARE) is False
    assert is_inside_ring(0.5, 2, UNIT_SQUARE) is False


def test_handles_a_non_convex_ring_correctly():
    # Arrange — an L-shape with the notch at the top-right
    l_shape = [(0, 0), (2, 0), (2, 1), (1, 1), (1, 2), (0, 2), (0, 0)]

    # Act + Assert
    assert is_inside_ring(0.5, 1.5, l_shape) is True  # in the upright part
    assert is_inside_ring(1.5, 0.5, l_shape) is True  # in the base
    assert is_inside_ring(1.5, 1.5, l_shape) is False  # in the notch


# ── gammaFn (Lanczos) ────────────────────────────────────────────────────────


def test_gamma_matches_1_5_equals_sqrt_pi_over_2():
    assert gamma_fn(1.5) == pytest.approx(0.886227, abs=5e-6)


def test_gamma_matches_2_equals_1():
    assert gamma_fn(2) == pytest.approx(1, abs=1e-10)


def test_gamma_matches_1_349_muppandal_one_plus_one_over_k():
    assert gamma_fn(1.349) == pytest.approx(0.8911, abs=5e-4)


# ── resetWeibullCogs (cold-module safety) ────────────────────────────────────


def test_reset_resolves_cleanly_when_no_cog_load_has_happened_yet():
    # Act + Assert — must be safe to call on a cold module
    reset_weibull_cogs()


def test_reset_is_idempotent_back_to_back_resets_never_throw():
    # Act + Assert
    reset_weibull_cogs()
    reset_weibull_cogs()


# ── Live tests against the local COGs (VERIFIED.md §2 ground truth) ──────────

MUPPANDAL_LON = 77.55
MUPPANDAL_LAT = 8.26
POINT_SQUARE_KM = 5

# Point truth at the exact Muppandal pixel (VERIFIED.md §2).
MUPPANDAL_POINT_A = 10.65
MUPPANDAL_POINT_K = 2.87
# GWA ws_mean_hgt100m at the same pixel — A·Γ(1+1/k) matches it exactly.
MUPPANDAL_MEAN_SPEED = 9.49
# Area mean vs point value: the corridor gradient justifies wide bands.
AREA_MEAN_A_TOLERANCE = 0.8
AREA_MEAN_K_TOLERANCE = 0.25
IMPLIED_MEAN_REL_TOLERANCE = 0.05

_IS_LIVE_DISABLED = os.environ.get("SKIP_LIVE") == "1"
_ARE_COGS_PRESENT = os.path.exists(config.WEIBULL_A_PATH) and os.path.exists(
    config.WEIBULL_K_PATH
)

_LIVE_SKIP_REASON = (
    "SKIP_LIVE=1 set"
    if _IS_LIVE_DISABLED
    else "Weibull COGs absent — run `bun scripts/fetch-weibull-cogs.ts` "
    "and export ANALYSIS_DATA_DIR to enable the live tests"
)
_skip_live = pytest.mark.skipif(
    _IS_LIVE_DISABLED or not _ARE_COGS_PRESENT, reason=_LIVE_SKIP_REASON
)


def _bbox_of_ring(ring):
    lons = [lon for lon, _ in ring]
    lats = [lat for _, lat in ring]
    return (min(lons), min(lats), max(lons), max(lats))


@pytest.fixture(autouse=True)
def _reset_cogs_around_each_test():
    """Keep degraded/live paths isolated — drop any open singleton before and
    after each test so a monkeypatched path or reset case never leaks state."""
    reset_weibull_cogs()
    yield
    reset_weibull_cogs()


@_skip_live
def test_aoi_weibull_means_over_muppandal_5x5_matches_verified_truth_bands():
    # Arrange
    ring = square_ring_around(MUPPANDAL_LON, MUPPANDAL_LAT, POINT_SQUARE_KM)
    bbox = _bbox_of_ring(ring)

    # Act
    means = aoi_weibull_means(bbox, ring)

    # Assert
    assert means is not None
    a = means["A"]
    k = means["k"]
    implied_mean = a * gamma_fn(1 + 1 / k)
    assert a > MUPPANDAL_POINT_A - AREA_MEAN_A_TOLERANCE
    assert a < MUPPANDAL_POINT_A + AREA_MEAN_A_TOLERANCE
    assert k > MUPPANDAL_POINT_K - AREA_MEAN_K_TOLERANCE
    assert k < MUPPANDAL_POINT_K + AREA_MEAN_K_TOLERANCE
    assert (
        abs(implied_mean - MUPPANDAL_MEAN_SPEED) / MUPPANDAL_MEAN_SPEED
        < IMPLIED_MEAN_REL_TOLERANCE
    )


@_skip_live
def test_aoi_weibull_means_returns_none_for_in_bounds_bbox_outside_india_mask():
    # Arrange — inside the COG raster bounds but all-NaN: Sri Lanka interior.
    # (Verified empirically 2026-06-11: the IND country COG covers India's EEZ —
    # the Lakshadweep Sea has DATA — but is NaN over Sri Lanka, Pakistan, and
    # open sea beyond the EEZ.)
    ring = square_ring_around(80.64, 7.29, POINT_SQUARE_KM)
    bbox = _bbox_of_ring(ring)

    # Act
    means = aoi_weibull_means(bbox, ring)

    # Assert — country COGs are NaN outside India's land/EEZ mask there
    assert means is None


@_skip_live
def test_reset_weibull_cogs_closes_handles_and_next_read_reopens_identically():
    # Arrange
    ring = square_ring_around(MUPPANDAL_LON, MUPPANDAL_LAT, POINT_SQUARE_KM)
    bbox = _bbox_of_ring(ring)
    before = aoi_weibull_means(bbox, ring)

    # Act — drop the singleton (closing both fds), then read again
    reset_weibull_cogs()
    after = aoi_weibull_means(bbox, ring)

    # Assert — the reload must reproduce the pre-reset means exactly
    assert before is not None
    assert after == before


# ── Degraded mode (no COGs) — offline, no fixtures needed ────────────────────


def test_aoi_weibull_means_returns_none_when_cogs_absent(monkeypatch, tmp_path):
    # Arrange — point both COG paths at non-existent files: the loader degrades
    # to None (warns once) and aoi_weibull_means returns null. Never throws.
    monkeypatch.setattr(config, "WEIBULL_A_PATH", tmp_path / "missing-A.tif")
    monkeypatch.setattr(config, "WEIBULL_K_PATH", tmp_path / "missing-k.tif")
    reset_weibull_cogs()

    ring = square_ring_around(MUPPANDAL_LON, MUPPANDAL_LAT, POINT_SQUARE_KM)
    bbox = _bbox_of_ring(ring)

    # Act
    means = aoi_weibull_means(bbox, ring)

    # Assert
    assert means is None
    # And a second call must not throw (cache now None).
    assert aoi_weibull_means(bbox, ring) is None
