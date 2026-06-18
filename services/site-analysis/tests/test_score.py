"""Unit tests for the Screening Score (plan §2.6 normalizations).

Port of ``apps/api/src/services/analysis/score.test.ts``. Covers every
breakpoint of every normalization (below floor, at floor, mid, at ceiling,
above ceiling), null/non-finite inputs, the plan §3 example reproduction,
confidence pass-through independence (plan §6 hard rule), points-sum-vs-value
consistency, and input immutability.

Parity notes vs the TS oracle:
- ``toBeCloseTo(x, n)`` (V8: ``|actual - expected| < 0.5 * 10**-n``) maps to
  ``pytest.approx(x, abs=0.5 * 10**-n)``.
- ``toBe(x)`` exact maps to ``==``.
- The TS ``Object.freeze`` immutability check is reproduced via Python's
  ``frozen=True`` dataclass: mutating it raises, and the snapshot must be
  unchanged after ``compute_score``.
- Helper-only TS cases (rounding semantics etc.) are NOT re-ported here — they
  live in ``tests/test_numeric.py``.
"""
from __future__ import annotations

import dataclasses
import math

import pytest

from app.config import SCORE_WEIGHTS
from app.engine.numeric import js_round
from app.engine.score import (
    AnalysisScore,
    ScoreComponent,
    ScoreInputs,
    compute_score,
)

# ``toBeCloseTo`` tolerance for the two digit counts the TS test uses.
APPROX_12 = 0.5e-12
APPROX_8 = 0.5e-8

# Plan §3 example inputs — also a convenient "all sections present" base.
BASE_INPUTS = ScoreInputs(
    mean_speed=7.4,
    cf_iec3=0.34,
    nearest_ehv_km=8.2,
    slope_90th_deg=3.1,
)


def score_with(**overrides) -> AnalysisScore:
    inputs = dataclasses.replace(BASE_INPUTS, **overrides)
    return compute_score(inputs, "high")


def component_by_key(score: AnalysisScore, key: str) -> ScoreComponent:
    for component in score.components:
        if component.key == key:
            return component
    raise AssertionError(f"missing score component: {key}")


# ── Resource normalization: clamp((mean_speed − 4.5) / 3) ───────────────────

RESOURCE_CASES = [
    ("below floor (4 m/s)", 4, 0),
    ("at floor (4.5 m/s)", 4.5, 0),
    ("midpoint (6 m/s)", 6, 0.5),
    ("at ceiling (7.5 m/s)", 7.5, 1),
    ("above ceiling (9 m/s)", 9, 1),
]


@pytest.mark.parametrize("label,mean_speed,normalized", RESOURCE_CASES)
def test_resource_normalization_breakpoints(label, mean_speed, normalized):
    resource = component_by_key(score_with(mean_speed=mean_speed), "resource")

    assert resource.normalized == pytest.approx(normalized, abs=APPROX_12)
    assert resource.raw == mean_speed
    assert resource.points == pytest.approx(
        js_round(SCORE_WEIGHTS["resource"] * normalized * 10) / 10, abs=APPROX_12
    )


# ── CF normalization: clamp((cf_iec3 − 0.12) / 0.26) ────────────────────────

CF_CASES = [
    ("below floor (0.10)", 0.1, 0),
    ("at floor (0.12)", 0.12, 0),
    ("midpoint (0.25)", 0.25, 0.5),
    ("at ceiling (0.38)", 0.38, 1),
    ("above ceiling (0.50)", 0.5, 1),
]


@pytest.mark.parametrize("label,cf_iec3,normalized", CF_CASES)
def test_cf_normalization_breakpoints(label, cf_iec3, normalized):
    cf = component_by_key(score_with(cf_iec3=cf_iec3), "cf")

    assert cf.normalized == pytest.approx(normalized, abs=APPROX_12)
    assert cf.raw == cf_iec3
    assert cf.points == pytest.approx(
        js_round(SCORE_WEIGHTS["cf"] * normalized * 10) / 10, abs=APPROX_12
    )


# ── Grid normalization: 1 at ≤10 km, clamp((50 − d) / 40), 0 at ≥50 km ──────

GRID_CASES = [
    ("closer than full-credit distance (5 km)", 5, 1),
    ("at full-credit distance (10 km)", 10, 1),
    ("midpoint (30 km)", 30, 0.5),
    ("at zero-credit distance (50 km)", 50, 0),
    ("beyond zero-credit distance (80 km)", 80, 0),
]


@pytest.mark.parametrize("label,nearest_ehv_km,normalized", GRID_CASES)
def test_grid_normalization_breakpoints(label, nearest_ehv_km, normalized):
    grid = component_by_key(score_with(nearest_ehv_km=nearest_ehv_km), "grid")

    assert grid.normalized == pytest.approx(normalized, abs=APPROX_12)
    assert grid.raw == nearest_ehv_km
    assert grid.points == pytest.approx(
        js_round(SCORE_WEIGHTS["grid"] * normalized * 10) / 10, abs=APPROX_12
    )


# ── Terrain normalization: 1 at ≤5°, clamp((20 − s) / 15), 0 at ≥20° ────────

TERRAIN_CASES = [
    ("below full-credit slope (2°)", 2, 1),
    ("at full-credit slope (5°)", 5, 1),
    ("midpoint (12.5°)", 12.5, 0.5),
    ("at zero-credit slope (20°)", 20, 0),
    ("above zero-credit slope (25°)", 25, 0),
]


@pytest.mark.parametrize("label,slope_90th_deg,normalized", TERRAIN_CASES)
def test_terrain_normalization_breakpoints(label, slope_90th_deg, normalized):
    terrain = component_by_key(score_with(slope_90th_deg=slope_90th_deg), "terrain")

    assert terrain.normalized == pytest.approx(normalized, abs=APPROX_12)
    assert terrain.raw == slope_90th_deg
    assert terrain.points == pytest.approx(
        js_round(SCORE_WEIGHTS["terrain"] * normalized * 10) / 10, abs=APPROX_12
    )


# ── Plan §3 example reproduction ────────────────────────────────────────────


def test_plan_example_reproduces_points_and_value():
    # Plan §3 example: 7.4 m/s, cf 0.34, EHV 8.2 km, slope 3.1°.
    #   resource (7.4−4.5)/3 = 0.9667 → 43.5 · cf (0.34−0.12)/0.26 = 0.8462
    #   → 21.2 · grid 20 · terrain 10 → round(94.65) = 95.
    score = compute_score(BASE_INPUTS, "high")

    resource = component_by_key(score, "resource")
    assert resource.normalized == pytest.approx(0.9666666667, abs=APPROX_8)
    assert resource.points == 43.5

    cf = component_by_key(score, "cf")
    assert cf.normalized == pytest.approx(0.8461538462, abs=APPROX_8)
    assert cf.points == 21.2

    grid = component_by_key(score, "grid")
    assert grid.normalized == 1
    assert grid.points == 20

    terrain = component_by_key(score, "terrain")
    assert terrain.normalized == 1
    assert terrain.points == 10

    # Headline rounds the unrounded total (94.65… → 95).
    assert score.value == 95


def test_echoes_weights_in_contract_order():
    score = compute_score(BASE_INPUTS, "medium")

    assert [c.key for c in score.components] == ["resource", "cf", "grid", "terrain"]
    assert [c.weight for c in score.components] == [
        SCORE_WEIGHTS["resource"],
        SCORE_WEIGHTS["cf"],
        SCORE_WEIGHTS["grid"],
        SCORE_WEIGHTS["terrain"],
    ]


# ── Null / non-finite inputs ────────────────────────────────────────────────


def test_all_null_inputs_give_value_zero_and_four_zero_rows():
    all_null = ScoreInputs(
        mean_speed=None, cf_iec3=None, nearest_ehv_km=None, slope_90th_deg=None
    )

    score = compute_score(all_null, "low")

    assert score.value == 0
    assert len(score.components) == 4
    for component in score.components:
        assert component.raw is None
        assert component.normalized == 0
        assert component.points == 0


def test_null_cf_zeroes_only_cf_component():
    score = score_with(cf_iec3=None)

    cf = component_by_key(score, "cf")
    assert cf.raw is None
    assert cf.normalized == 0
    assert cf.points == 0
    assert score.value == 74  # round(43.5 + 0 + 20 + 10)


def test_non_finite_input_treated_as_missing():
    score = score_with(mean_speed=math.nan)

    resource = component_by_key(score, "resource")
    assert resource.raw is None
    assert resource.normalized == 0
    assert resource.points == 0
    assert math.isfinite(score.value)


# ── Confidence pass-through (plan §6 hard rule) ─────────────────────────────


def test_confidence_does_not_change_value_or_components():
    high = compute_score(BASE_INPUTS, "high")
    medium = compute_score(BASE_INPUTS, "medium")
    low = compute_score(BASE_INPUTS, "low")

    assert medium.value == high.value
    assert low.value == high.value
    assert medium.components == high.components
    assert low.components == high.components


@pytest.mark.parametrize("confidence", ["high", "medium", "low"])
def test_confidence_passed_through_verbatim(confidence):
    assert compute_score(BASE_INPUTS, confidence).confidence == confidence


# ── Points-sum vs headline value consistency ────────────────────────────────

POINTS_SUM_CASES = [
    ("plan §3 example", BASE_INPUTS),
    (
        "mid-range site",
        ScoreInputs(mean_speed=6.3, cf_iec3=0.22, nearest_ehv_km=37.2, slope_90th_deg=9.7),
    ),
    (
        "strong site",
        ScoreInputs(mean_speed=8.85, cf_iec3=0.41, nearest_ehv_km=12.3, slope_90th_deg=17.2),
    ),
    (
        "weak site",
        ScoreInputs(mean_speed=5.4, cf_iec3=0.17, nearest_ehv_km=48.9, slope_90th_deg=19.4),
    ),
    (
        "partially missing data",
        ScoreInputs(mean_speed=7.1, cf_iec3=None, nearest_ehv_km=22.6, slope_90th_deg=None),
    ),
    (
        "all data missing",
        ScoreInputs(mean_speed=None, cf_iec3=None, nearest_ehv_km=None, slope_90th_deg=None),
    ),
]


@pytest.mark.parametrize("label,inputs", POINTS_SUM_CASES)
def test_rounded_points_sum_within_half_of_value(label, inputs):
    score = compute_score(inputs, "medium")
    points_sum = 0.0
    for component in score.components:
        points_sum += component.points

    # Golden-test recompute rule: components reproduce the headline within 0.5.
    assert abs(points_sum - score.value) <= 0.5
    assert score.value >= 0
    assert score.value <= 100
    assert float(score.value).is_integer()


def test_value_equals_rounded_sum_of_unrounded_weight_times_normalized():
    score = compute_score(BASE_INPUTS, "high")
    exact_total = 0.0
    for component in score.components:
        exact_total += component.weight * component.normalized

    # Headline is exactly the rounded unrounded total.
    assert score.value == js_round(exact_total)


# ── Immutability ────────────────────────────────────────────────────────────


def test_does_not_mutate_inputs():
    # frozen=True makes any attribute write raise; the snapshot must survive.
    snapshot = dataclasses.replace(BASE_INPUTS)

    score = compute_score(BASE_INPUTS, "high")

    assert score.value == 95
    assert BASE_INPUTS == snapshot
    with pytest.raises(dataclasses.FrozenInstanceError):
        BASE_INPUTS.mean_speed = 0.0  # type: ignore[misc]
