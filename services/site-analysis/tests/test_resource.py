"""Parity tests for Section A resource statistics (resource.py).

Ported from apps/api/src/services/analysis/resource.test.ts. The SAME cases and
anchor values are kept, with the SAME exact-vs-approx distinction the TS used:
``toBe`` -> exact ``==``; ``toBeCloseTo(x, d)`` -> ``pytest.approx(x, abs=...)``.

DROPPED from this file (covered by tests/test_numeric.py, where the shared
foundation helpers now live):
  - describe("roundTo")            -> numeric.round_to / js_round
  - describe("meanOf")             -> numeric.mean_of
  - describe("percentileOfSorted") -> numeric.percentile_of_sorted
  - describe("collectInsideFinite")-> types.collect_inside_finite
The resource-SPECIFIC functions (fit_shear_alpha, air_density_at_elevation,
classify_site, compute_resource) are tested here verbatim.

india_percentile in the full-section test needs the committed 101-quantile
artifact, which is absent from the default (Docker) config.INDIA_CDF_PATH. The
``_real_india_cdf`` fixture points the loader at the legacy committed artifact
and resets the lazy cache, exactly like tests/test_indiacdf.py does.
"""
from __future__ import annotations

import math

import numpy as np
import pytest

from app import config
from app.engine import indiacdf
from app.engine.indiacdf import reset_cache_for_tests
from app.engine.resource import (
    air_density_at_elevation,
    classify_site,
    compute_resource,
    fit_shear_alpha,
)
from app.engine.types import AoiMask, LayerPatch

# Real committed artifact in the legacy tree (101 quantiles).
REAL_CDF_PATH = "/Users/akshatpatel/Desktop/wind/wce/apps/api/data/analysis/india-ws100-cdf.json"


# ── Test fixtures / builders (resource.test.ts:15-50) ──────────────────────


def patch_of(values: list[float]) -> LayerPatch:
    """2×2 patch with the given pixel values (row-major)."""
    return LayerPatch(
        zoom=10,
        min_tile_x=0,
        min_tile_y=0,
        width_px=2,
        height_px=2,
        data=np.asarray(values, dtype=np.float32),
    )


def mask_all_inside() -> AoiMask:
    return AoiMask(
        width_px=2,
        height_px=2,
        inside=np.asarray([1, 1, 1, 1], dtype=np.uint8),
        inside_count=4,
    )


def synthetic_patches(overrides: dict | None = None) -> dict:
    """Synthetic but physically coherent AOI: shear-consistent speeds."""
    ws100 = [8, 9, 10, 11]
    alpha = 0.2
    base = {
        "ws100": patch_of(ws100),
        "ws50": patch_of([v * 0.5**alpha for v in ws100]),
        "ws150": patch_of([v * 1.5**alpha for v in ws100]),
        "pd100": patch_of([400, 400, 400, 400]),
        "elevation": patch_of([1500, 1500, 1500, 1500]),
        "cfIec3": patch_of([0.4, 0.45, 0.5, 0.55]),
        "cfIec2": patch_of([0.35, 0.4, 0.45, 0.5]),
    }
    if overrides:
        base.update(overrides)
    return base


@pytest.fixture
def _real_india_cdf(monkeypatch):
    """Point indiacdf at the real committed artifact + reset the lazy cache so
    india_percentile is computable for the full-section test."""
    reset_cache_for_tests()
    monkeypatch.setattr(config, "INDIA_CDF_PATH", REAL_CDF_PATH)
    monkeypatch.setattr(indiacdf.config, "INDIA_CDF_PATH", REAL_CDF_PATH)
    yield
    reset_cache_for_tests()


# ── fitShearAlpha (resource.test.ts:122-140) ───────────────────────────────


def test_fit_shear_alpha_recovers_clean_power_law_exponent():
    # v(h) = 8·(h/100)^0.3
    alpha = 0.3
    speeds = [8 * 0.5**alpha, 8, 8 * 1.5**alpha]
    assert fit_shear_alpha(speeds) == pytest.approx(alpha, abs=5e-7)


def test_fit_shear_alpha_returns_nan_when_any_mean_non_positive():
    assert math.isnan(fit_shear_alpha([0, 8, 9]))
    assert math.isnan(fit_shear_alpha([math.nan, 8, 9]))


# ── airDensityAtElevation (resource.test.ts:142-151) ───────────────────────


def test_air_density_sea_level_is_isa_reference():
    assert air_density_at_elevation(0) == pytest.approx(1.225, abs=5e-7)


def test_air_density_1500m_matches_barometric_formula():
    # 1.225·(1 − 2.2558e-5·1500)^5.256 — computed independently.
    assert air_density_at_elevation(1500) == pytest.approx(1.0222, abs=5e-4)


# ── classifySite (resource.test.ts:153-162) ────────────────────────────────


def test_classify_site_bands_exactly_per_plan_contract():
    assert classify_site(8) == "excellent"
    assert classify_site(7.99) == "good"
    assert classify_site(7) == "good"
    assert classify_site(6.99) == "moderate"
    assert classify_site(6) == "moderate"
    assert classify_site(5.99) == "marginal"


# ── computeResource (resource.test.ts:164-247) ─────────────────────────────


def test_compute_resource_full_section_from_coherent_synthetic_patches(
    _real_india_cdf,
):
    # Arrange
    patches = synthetic_patches()
    mask = mask_all_inside()

    # Act
    result = compute_resource(patches, mask, {"A": 10.2, "k": 2.4})

    # Assert — speeds (ws100 = [8, 9, 10, 11])
    assert result.mean_speed == 9.5
    assert result.min_speed == 8
    assert result.max_speed == 11
    assert result.p25_speed == 8.75
    assert result.p50_speed == 9.5
    assert result.p75_speed == 10.25
    assert result.area_exceedance90 == 8.3  # 10th percentile, LOW tail
    # Shear recovered from the synthetic 0.2 profile.
    assert result.shear_alpha == pytest.approx(0.2, abs=5e-4)
    # Power density corrected DOWN at 1500 m: 400·(1.0222/1.225) ≈ 334.
    assert result.air_density == pytest.approx(1.022, abs=5e-4)
    assert result.power_density_raw == 400
    assert result.power_density == 334
    # CF means.
    assert result.cf_iec3 == pytest.approx(0.475, abs=5e-5)
    assert result.cf_iec2 == pytest.approx(0.425, abs=5e-5)
    # Pass-throughs and banding.
    assert result.weibull == {"A": 10.2, "k": 2.4}
    assert result.site_class == "excellent"
    # 9.5 m/s is near the top of the India distribution (committed artifact).
    assert result.india_percentile >= 90
    assert result.india_percentile <= 100


def test_compute_resource_clamps_negative_cf_mean_to_zero():
    patches = synthetic_patches(
        {"cfIec3": patch_of([-0.02, -0.01, -0.03, -0.02])}
    )

    result = compute_resource(patches, mask_all_inside(), None)

    assert result.cf_iec3 == 0


def test_compute_resource_returns_null_cf_power_when_layers_empty():
    nan_patch = patch_of([math.nan, math.nan, math.nan, math.nan])
    patches = synthetic_patches(
        {"cfIec3": nan_patch, "cfIec2": nan_patch, "pd100": nan_patch}
    )

    result = compute_resource(patches, mask_all_inside(), None)

    assert result.cf_iec3 is None
    assert result.cf_iec2 is None
    assert result.power_density is None
    assert result.power_density_raw is None
    # Speeds still computed — the section itself stays usable.
    assert result.mean_speed == 9.5


def test_compute_resource_throws_when_ws100_zero_valid_pixels():
    patches = synthetic_patches(
        {"ws100": patch_of([math.nan, math.nan, math.nan, math.nan])}
    )

    with pytest.raises(ValueError, match="zero valid"):
        compute_resource(patches, mask_all_inside(), None)


def test_compute_resource_throws_on_patch_mask_dimension_mismatch():
    patches = synthetic_patches()
    mask = AoiMask(
        width_px=3,
        height_px=3,
        inside=np.ones(9, dtype=np.uint8),
        inside_count=9,
    )

    with pytest.raises(ValueError, match="mask is 3×3"):
        compute_resource(patches, mask, None)
