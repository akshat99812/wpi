"""Parity tests for the mast-validation section (validation.py, plan §2.3).

Ported from apps/api/src/services/analysis/validation.test.ts. The SAME cases
and anchor values are kept, with the SAME exact-vs-approx distinction the TS
used: ``toBe`` → exact ``==``; ``toBeCloseTo(x, 12)`` → ``pytest.approx(x,
abs=1e-12)``; ``toThrow("substr")`` → ``pytest.raises(..., match=...)``.

Pure helpers (shear adjustment, delta, confidence badge) are tested exhaustively
offline (verbatim ports of the .ts describe-blocks).

The full ``computeValidation`` path needs the live PostGIS masts DB + GWA tiler.
The .ts gates that single case behind ``DATABASE_URL`` (``liveTest``); it is
preserved here as a skipped live test (see ``deferred``). EXTRA offline tests
exercise the delta/confidence/suppression orchestration with the injected query
runner + injected GWA point fetch (the DI seams the module note calls out), so
the orchestration is covered without a live DB — mirroring the
test_grid.py offline-orchestration precedent. Recorded in parity_notes.

Run with ANALYSIS_DATA_DIR=apps/api/data (config resolution).
"""
from __future__ import annotations

import math
import os

import pytest

from app.engine.mercator import square_ring_around
from app.engine.geometry import validate_aoi
from app.engine.validation import (
    compute_validation,
    confidence_from,
    delta_pct,
    shear_adjust_speed,
)

FLOAT_ABS = 1e-12

# Muppandal golden point (VERIFIED.md) + the AOI α measured there.
MUPPANDAL_LON = 77.55
MUPPANDAL_LAT = 8.26
MUPPANDAL_SHEAR_ALPHA = 0.2315


# ── shearAdjustSpeed (validation.test.ts:30-85) ─────────────────────────────


def test_shear_returns_v100_unchanged_at_100m_reference():
    # Arrange
    v100 = 9.4894
    # Act
    adjusted = shear_adjust_speed(v100, 100, 0.2315)
    # Assert
    assert adjusted == pytest.approx(v100, abs=FLOAT_ABS)


def test_shear_scales_speed_up_for_120m_mast_alpha_0_2():
    # Arrange
    v100 = 8
    # Act
    adjusted = shear_adjust_speed(v100, 120, 0.2)
    # Assert — v_mastH = 8 · (120/100)^0.2
    assert adjusted == pytest.approx(8 * 1.2**0.2, abs=FLOAT_ABS)
    assert adjusted > v100


def test_shear_scales_speed_down_for_80m_mast_alpha_0_2():
    # Arrange
    v100 = 8
    # Act
    adjusted = shear_adjust_speed(v100, 80, 0.2)
    # Assert — v_mastH = 8 · (80/100)^0.2
    assert adjusted == pytest.approx(8 * 0.8**0.2, abs=FLOAT_ABS)
    assert adjusted < v100


def test_shear_alpha_zero_is_identity_at_any_height():
    assert shear_adjust_speed(7.3, 50, 0) == pytest.approx(7.3, abs=FLOAT_ABS)
    assert shear_adjust_speed(7.3, 150, 0) == pytest.approx(7.3, abs=FLOAT_ABS)


def test_shear_throws_when_height_zero_or_negative():
    with pytest.raises(ValueError, match="mastHeightM"):
        shear_adjust_speed(8, 0, 0.2)
    with pytest.raises(ValueError, match="mastHeightM"):
        shear_adjust_speed(8, -50, 0.2)


def test_shear_throws_when_v100_negative_or_non_finite():
    with pytest.raises(ValueError, match="v100"):
        shear_adjust_speed(-1, 100, 0.2)
    with pytest.raises(ValueError, match="v100"):
        shear_adjust_speed(math.nan, 100, 0.2)


def test_shear_throws_when_alpha_non_finite():
    with pytest.raises(ValueError, match="alpha"):
        shear_adjust_speed(8, 100, math.inf)


# ── deltaPct (validation.test.ts:89-124) ────────────────────────────────────


def test_delta_is_positive_when_measurement_runs_above_model():
    # (7.7 − 7.0) / 7.0 = +10%
    assert delta_pct(7.7, 7.0) == 10


def test_delta_is_negative_when_measurement_runs_below_model():
    # (6.3 − 7.0) / 7.0 = −10%
    assert delta_pct(6.3, 7.0) == -10


def test_delta_is_zero_when_measurement_equals_model():
    assert delta_pct(7.0, 7.0) == 0


def test_delta_rounds_to_one_decimal_place():
    # (7.1 − 7.0) / 7.0 · 100 = 1.42857… → 1.4
    assert delta_pct(7.1, 7.0) == 1.4


def test_delta_throws_when_model_speed_zero_negative_or_non_finite():
    with pytest.raises(ValueError, match="model speed"):
        delta_pct(7, 0)
    with pytest.raises(ValueError, match="model speed"):
        delta_pct(7, -2)
    with pytest.raises(ValueError, match="model speed"):
        delta_pct(7, math.nan)


def test_delta_throws_when_measured_speed_non_finite():
    with pytest.raises(ValueError, match="measured"):
        delta_pct(math.nan, 7)


# ── confidenceFrom (validation.test.ts:128-153) ─────────────────────────────


def test_confidence_high_at_exactly_2_within_20km_boundary():
    assert confidence_from(2, 2) == "high"


def test_confidence_high_when_many_within_20km():
    assert confidence_from(5, 9) == "high"


def test_confidence_medium_with_exactly_1_within_25km_boundary():
    assert confidence_from(1, 1) == "medium"


def test_confidence_medium_when_only_mast_between_20_and_25km():
    assert confidence_from(0, 1) == "medium"


def test_confidence_low_when_nothing_within_25km():
    assert confidence_from(0, 0) == "low"


def test_confidence_throws_on_negative_or_non_integer_counts():
    with pytest.raises(ValueError, match="countWithin20"):
        confidence_from(-1, 0)
    with pytest.raises(ValueError, match="countWithin25"):
        confidence_from(0, 1.5)


# ── computeValidation (offline, injected query runner + point fetch) ─────────
#
# validation.test.ts only exercises computeValidation via the skipped live case.
# These drive the same delta/confidence/suppression orchestration OFFLINE with a
# fake query runner (the pool seam) + an injected GWA point fetch (the fetchImpl
# seam). Not 1:1 .ts ports — recorded in parity_notes.


def _aoi():
    ring = square_ring_around(MUPPANDAL_LON, MUPPANDAL_LAT, 5)
    return validate_aoi({"type": "Polygon", "coordinates": [ring]})


def _runner(counts_row, nearest_row):
    """Build a fake QueryRunner: the first call (counts) returns ``counts_row``,
    the second (nearest) returns ``nearest_row`` (or [] for no mast). Dispatch on
    a token unique to each SQL body so order is irrelevant."""

    def run_query(sql, params):
        if "in_aoi" in sql:
            return [counts_row]
        if "distance_m" in sql:
            return [] if nearest_row is None else [nearest_row]
        raise AssertionError(f"unexpected SQL: {sql[:40]}")

    return run_query


def test_compute_validation_no_mast_returns_null_nearest_and_delta():
    data = compute_validation(
        _aoi(),
        MUPPANDAL_SHEAR_ALPHA,
        db_available=lambda: True,
        run_query=_runner({"in_aoi": "3", "within20": "0", "within25": "0"}, None),
    )
    assert data["mastCountInAoi"] == 3
    assert data["nearestMast"] is None
    assert data["modelDeltaPct"] is None
    assert data["confidence"] == "low"


def test_compute_validation_suppresses_delta_beyond_25km(monkeypatch):
    # Nearest mast 30 km out → delta suppressed (None) but nearestMast returned.
    import app.engine.validation as v

    # compute_model_delta must NOT be called when >25 km; sentinel proves it.
    monkeypatch.setattr(
        v, "compute_model_delta", lambda *a, **k: pytest.fail("delta not suppressed")
    )
    nearest_row = {
        "id": 42,
        "station": "Far Mast",
        "mast_height_m": "80",
        "maws_ms": "7.5",
        "mawpd_wm2": "450",
        "lon": "77.6",
        "lat": "8.3",
        "distance_m": "30000",  # 30 km > 25 km → suppressed
    }
    data = compute_validation(
        _aoi(),
        MUPPANDAL_SHEAR_ALPHA,
        db_available=lambda: True,
        run_query=_runner(
            {"in_aoi": "1", "within20": "0", "within25": "0"}, nearest_row
        ),
    )
    assert data["nearestMast"] is not None
    assert data["nearestMast"]["station"] == "Far Mast"
    assert data["nearestMast"]["distanceKm"] == 30
    assert data["nearestMast"]["id"] == "42"
    assert data["modelDeltaPct"] is None  # suppressed past 25 km
    assert data["confidence"] == "low"


def test_compute_validation_computes_delta_within_25km(monkeypatch):
    # Nearest mast 5 km out → delta computed from an injected GWA ws100 pixel.
    import app.engine.validation as v

    # Inject the GWA point fetch: ws100 = 7.0 m/s at the mast pixel.
    monkeypatch.setattr(v, "fetch_point_value", lambda *a, **k: 7.0)
    nearest_row = {
        "id": "7",
        "station": "Near Mast",
        "mast_height_m": "100",  # 100 m → no shear adjustment (α exponent on 1.0)
        "maws_ms": "7.7",  # (7.7 − 7.0)/7.0 → +10%
        "mawpd_wm2": None,
        "lon": "77.56",
        "lat": "8.27",
        "distance_m": "5000",  # 5 km ≤ 25 km → delta eligible
    }
    data = compute_validation(
        _aoi(),
        0.0,  # alpha 0 → shear identity, model = v100 = 7.0
        db_available=lambda: True,
        run_query=_runner(
            {"in_aoi": "2", "within20": "2", "within25": "2"}, nearest_row
        ),
    )
    assert data["nearestMast"]["station"] == "Near Mast"
    assert data["nearestMast"]["distanceKm"] == 5
    assert data["nearestMast"]["maws"] == 7.7  # RAW, not rounded
    assert data["nearestMast"]["mawpd"] is None
    assert data["nearestMast"]["heightM"] == 100
    assert data["modelDeltaPct"] == 10  # (7.7−7.0)/7.0 → +10%
    assert data["confidence"] == "high"


def test_compute_validation_delta_null_when_pixel_empty(monkeypatch):
    # GWA pixel nodata (None) at the mast coords → delta suppressed to None.
    import app.engine.validation as v

    monkeypatch.setattr(v, "fetch_point_value", lambda *a, **k: None)
    nearest_row = {
        "id": "9",
        "station": "Pixel Empty",
        "mast_height_m": "80",
        "maws_ms": "7.0",
        "mawpd_wm2": "400",
        "lon": "77.5",
        "lat": "8.2",
        "distance_m": "3000",
    }
    data = compute_validation(
        _aoi(),
        MUPPANDAL_SHEAR_ALPHA,
        db_available=lambda: True,
        run_query=_runner(
            {"in_aoi": "1", "within20": "1", "within25": "1"}, nearest_row
        ),
    )
    assert data["nearestMast"] is not None
    assert data["modelDeltaPct"] is None  # nodata pixel → suppressed
    assert data["confidence"] == "medium"


def test_compute_validation_blank_station_falls_back_to_unknown(monkeypatch):
    import app.engine.validation as v

    monkeypatch.setattr(v, "fetch_point_value", lambda *a, **k: 7.0)
    nearest_row = {
        "id": "1",
        "station": "",  # blank → "Unknown"
        "mast_height_m": "100",
        "maws_ms": "7.0",
        "mawpd_wm2": "300",
        "lon": "77.55",
        "lat": "8.26",
        "distance_m": "1000",
    }
    data = compute_validation(
        _aoi(),
        0.0,
        db_available=lambda: True,
        run_query=_runner(
            {"in_aoi": "1", "within20": "1", "within25": "1"}, nearest_row
        ),
    )
    assert data["nearestMast"]["station"] == "Unknown"


def test_compute_validation_raises_when_db_unavailable():
    with pytest.raises(RuntimeError, match="masts DB unavailable"):
        compute_validation(_aoi(), MUPPANDAL_SHEAR_ALPHA, db_available=lambda: False)


def test_compute_validation_raises_when_alpha_non_finite():
    with pytest.raises(ValueError, match="shearAlpha"):
        compute_validation(
            _aoi(),
            math.inf,
            db_available=lambda: True,
            run_query=_runner({"in_aoi": "0", "within20": "0", "within25": "0"}, None),
        )


# ── computeValidation against the live masts DB (validation.test.ts:157-194) ─
#
# DEFERRED: needs the live PostGIS masts DB + GWA tiler. Skipped by default;
# enable with DATABASE_URL set and SKIP_LIVE=0 (mirrors the .ts liveTest gate).


@pytest.mark.skipif(
    not os.environ.get("DATABASE_URL") or os.environ.get("SKIP_LIVE", "1") == "1",
    reason="live: needs PostGIS masts DB + GWA tiler (set DATABASE_URL & SKIP_LIVE=0)",
)
def test_validates_the_muppandal_5x5_km_square_with_plausible_mast_facts():
    aoi = validate_aoi(
        {"type": "Polygon", "coordinates": [square_ring_around(MUPPANDAL_LON, MUPPANDAL_LAT, 5)]}
    )

    data = compute_validation(aoi, MUPPANDAL_SHEAR_ALPHA)

    assert data["mastCountInAoi"] >= 0
    assert data["confidence"] in ("high", "medium", "low")
    mast = data["nearestMast"]
    assert mast is not None, "expected a nearest WRA mast near Muppandal"
    assert len(mast["station"]) > 0
    assert mast["distanceKm"] >= 0
    assert mast["maws"] > 0
    assert mast["heightM"] > 0
    if mast["distanceKm"] > 25:
        assert data["modelDeltaPct"] is None
    if data["modelDeltaPct"] is not None:
        assert abs(data["modelDeltaPct"]) < 60
