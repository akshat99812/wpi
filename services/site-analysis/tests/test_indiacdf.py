"""Parity tests for the India ws@100m CDF percentile context (indiacdf.py).

There is NO indiaCdf.test.ts upstream; these cases are derived directly from the
oracle's documented behaviour (apps/api/src/services/analysis/indiacdf.ts):

  percentileFromCdf:
    - <2 quantiles raises
    - speed <= first  -> 0
    - speed >= last   -> 100
    - interior speed   -> linear interp between bracketing quantiles
    - flat (duplicate) runs resolve to the UPPER edge of the run
    - step == 100/(n-1); on a 101-element ramp index == percentile

  india_percentile_of:
    - None for non-finite speed (NaN/Inf)
    - None when the artifact is missing (default config.INDIA_CDF_PATH is the
      Docker path /app/data/... which is absent locally) — never throws
    - finite percentile when pointed at the real committed 101-quantile artifact
"""
from __future__ import annotations

import math

import pytest

from app import config
from app.engine import indiacdf
from app.engine.indiacdf import (
    india_percentile_of,
    load_quantiles_once,
    percentile_from_cdf,
    reset_cache_for_tests,
)

# Real committed artifact in the legacy tree (101 quantiles). Absent from the
# service Docker mount, present in apps/api/data for the optional live check.
REAL_CDF_PATH = "/Users/akshatpatel/Desktop/wind/wce/apps/api/data/analysis/india-ws100-cdf.json"

# A synthetic 101-element ramp [0, 1, 2, ..., 100]: index == value == percentile.
RAMP_101 = [float(i) for i in range(101)]


@pytest.fixture(autouse=True)
def _reset_cdf_cache():
    """Each test starts and ends with a clean lazy cache so monkeypatched paths
    are honoured and no cross-test state leaks."""
    reset_cache_for_tests()
    yield
    reset_cache_for_tests()


# ── percentileFromCdf ───────────────────────────────────────────────────────


def test_raises_when_fewer_than_two_quantiles():
    with pytest.raises(ValueError):
        percentile_from_cdf([5.0], 5.0)
    with pytest.raises(ValueError):
        percentile_from_cdf([], 5.0)


def test_ramp_midpoint_maps_to_its_own_percentile():
    # speed 50.5 sits between quantiles[50]=50 and quantiles[51]=51:
    # (50 + (50.5-50)/(51-50)) * 1.0 == 50.5
    assert percentile_from_cdf(RAMP_101, 50.5) == 50.5


def test_speed_below_first_clamps_to_zero():
    assert percentile_from_cdf(RAMP_101, -10.0) == 0
    # Exactly equal to the first quantile is also 0 (<=).
    assert percentile_from_cdf(RAMP_101, 0.0) == 0


def test_speed_above_last_clamps_to_hundred():
    assert percentile_from_cdf(RAMP_101, 1000.0) == 100
    # Exactly equal to the last quantile is also 100 (>=).
    assert percentile_from_cdf(RAMP_101, 100.0) == 100


def test_interior_interpolation_between_bracketing_quantiles():
    # Non-uniform quantiles, step = 100/(4-1) = 33.333...
    quantiles = [0.0, 2.0, 4.0, 10.0]
    step = 100 / 3
    # speed 3.0 is between quantiles[1]=2 and quantiles[2]=4:
    # (1 + (3-2)/(4-2)) * step == 1.5 * step
    expected = 1.5 * step
    assert percentile_from_cdf(quantiles, 3.0) == pytest.approx(expected)
    # speed 7.0 between quantiles[2]=4 and quantiles[3]=10:
    # (2 + (7-4)/(10-4)) * step == 2.5 * step
    assert percentile_from_cdf(quantiles, 7.0) == pytest.approx(2.5 * step)


def test_flat_run_resolves_to_upper_edge_of_run():
    # Duplicate run at value 5 spanning indices 1,2,3. With speed exactly 5,
    # the loop skips every bracket whose upper == 5 (speed < upper is False)
    # and resolves at the first index where upper > 5, i.e. the run's upper edge.
    quantiles = [0.0, 5.0, 5.0, 5.0, 10.0]
    step = 100 / 4  # == 25
    # First bracket with upper > 5 is i=3 (quantiles[3]=5, quantiles[4]=10):
    # (3 + (5-5)/(10-5)) * 25 == 3 * 25 == 75
    assert percentile_from_cdf(quantiles, 5.0) == 75
    # Confirm it is strictly the UPPER edge: the lower edge of the run would be
    # 1*25 == 25, which we must NOT return.
    assert percentile_from_cdf(quantiles, 5.0) != 25


def test_step_uses_n_minus_one():
    # Two quantiles -> step == 100/(2-1) == 100. Midpoint -> 50.
    assert percentile_from_cdf([0.0, 10.0], 5.0) == pytest.approx(50.0)


# ── india_percentile_of: non-finite + missing-artifact guards ───────────────


def test_returns_none_for_nan():
    assert india_percentile_of(float("nan")) is None


def test_returns_none_for_positive_infinity():
    assert india_percentile_of(float("inf")) is None


def test_returns_none_for_negative_infinity():
    assert india_percentile_of(float("-inf")) is None


def test_returns_none_when_artifact_missing(monkeypatch, tmp_path):
    # Default config path is the Docker mount (absent locally); make the absence
    # explicit and deterministic by pointing at a non-existent file.
    missing = tmp_path / "does-not-exist.json"
    monkeypatch.setattr(config, "INDIA_CDF_PATH", missing)
    reset_cache_for_tests()
    assert india_percentile_of(6.5) is None
    # And it must never throw on subsequent calls (cache now None).
    assert india_percentile_of(7.0) is None


def test_returns_none_for_corrupt_artifact(monkeypatch, tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("{ not json")
    monkeypatch.setattr(config, "INDIA_CDF_PATH", bad)
    reset_cache_for_tests()
    assert india_percentile_of(6.5) is None


def test_returns_none_for_wrong_quantile_count(monkeypatch, tmp_path):
    short = tmp_path / "short.json"
    short.write_text('{"quantiles": [1, 2, 3]}')  # not 101
    monkeypatch.setattr(config, "INDIA_CDF_PATH", short)
    reset_cache_for_tests()
    assert india_percentile_of(6.5) is None


def test_loader_is_lazy_and_cached(monkeypatch, tmp_path):
    quantiles = list(range(101))
    good = tmp_path / "good.json"
    import json

    good.write_text(json.dumps({"quantiles": quantiles}))
    monkeypatch.setattr(config, "INDIA_CDF_PATH", good)
    reset_cache_for_tests()
    first = load_quantiles_once()
    assert first is not None and len(first) == 101
    # Second call returns the cached object identity (no re-read).
    assert load_quantiles_once() is first


# ── india_percentile_of: live read of the real committed artifact (optional) ─


def test_real_artifact_yields_finite_percentile(monkeypatch):
    import os

    if not os.path.exists(REAL_CDF_PATH):
        pytest.skip("real india-ws100-cdf.json not present locally")
    monkeypatch.setattr(config, "INDIA_CDF_PATH", REAL_CDF_PATH)
    reset_cache_for_tests()
    # A mid-range mean speed must land at a finite, in-range percentile.
    pct = india_percentile_of(6.0)
    assert pct is not None
    assert math.isfinite(pct)
    assert 0 <= pct <= 100
    # Unrounded: india_percentile_of does NOT round (Math.round happens later in
    # resource), so a fractional input that brackets distinct quantiles should be
    # allowed to produce a non-integer.
    assert india_percentile_of(0.0) == 0  # at/below first quantile -> 0
