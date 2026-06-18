"""Wind Site Analysis — Screening Score (plan §2.6).

Verbatim port of ``apps/api/src/services/analysis/score.ts`` ``computeScore``.
Pure function from section stats to the 0-100 score with full per-component
breakdown. No I/O, no clock, no randomness — fully unit-tested in
``tests/test_score.py``.

Rounding decision (documented per plan §3):
- Per component: ``points`` = weight · normalized, rounded to 1 decimal place
  for display (``round1`` from the numeric foundation == ``Math.round(x*10)/10``).
- Headline ``value`` = ``js_round(Σ UNROUNDED weight · normalized)`` (JS
  ``Math.round``, half toward +inf), so the headline is exact and never drifts
  from per-component display rounding by more than the rounding slack.
- The plan §3 example inputs (7.4 m/s, cf 0.34, 8.2 km, 3.1°) yield value 95
  under the v2 India-calibrated breakpoints below (resource 43.5 + cf 21.2 +
  grid 20 + terrain 10).

Missing data decision: a null (or non-finite) raw input → normalized 0,
points 0, raw None. Conservative screening default when a data section is
unavailable; the UI shows the zero row transparently.

Hard rule (plan §6): validation confidence is passed through verbatim into
``score.confidence`` and NEVER feeds the arithmetic.

BREAKPOINTS live HERE (not in config), exactly as the legacy splits config
across constants.ts (weights/bands) and score.ts (breakpoints).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Literal, Optional

from app.config import SCORE_WEIGHTS
from app.engine.numeric import clamp01, js_round, round1

# ── Component / score result types (types.ts:163-176) ───────────────────────

ScoreComponentKey = Literal["resource", "cf", "grid", "terrain"]
ScoreConfidence = Literal["high", "medium", "low"]


@dataclass(frozen=True)
class ScoreComponent:
    key: ScoreComponentKey
    weight: float
    raw: Optional[float]
    normalized: float
    points: float


@dataclass(frozen=True)
class AnalysisScore:
    value: float  # 0-100 (always integer-valued from js_round)
    confidence: ScoreConfidence
    components: list[ScoreComponent]


@dataclass(frozen=True)
class ScoreInputs:
    """Raw stats feeding the score; None = that section was unavailable."""

    mean_speed: Optional[float]  # AOI mean wind speed @100 m, m/s (section A)
    cf_iec3: Optional[float]  # AOI mean IEC-III capacity factor, 0-1 (section A)
    nearest_ehv_km: Optional[float]  # distance to nearest EHV grid feature, km (D)
    slope_90th_deg: Optional[float]  # 90th-pct terrain slope across AOI, deg (E)


# ── Normalization breakpoints (plan §2.6, v2 — calibrated to India) ─────────

# Resource: 0 at <=4.5 m/s (India median), 1 at >=7.5 m/s (~q98).
RESOURCE_ZERO_SPEED_MS = 4.5
RESOURCE_FULL_SPEED_MS = 7.5

# CF: 0 at <=0.12, 1 at >=0.38 (best Indian onshore IEC-III), linear between.
CF_ZERO_FRACTION = 0.12
CF_FULL_FRACTION = 0.38

# Grid: 1 at <=10 km from EHV, 0 at >=50 km, linear between.
GRID_FULL_DISTANCE_KM = 10
GRID_ZERO_DISTANCE_KM = 50

# Terrain: 1 at <=5° slope (90th percentile), 0 at >=20°, linear between.
TERRAIN_FULL_SLOPE_DEG = 5
TERRAIN_ZERO_SLOPE_DEG = 20


# ── Pure helpers ────────────────────────────────────────────────────────────


def normalize_resource(mean_speed: float) -> float:
    return clamp01(
        (mean_speed - RESOURCE_ZERO_SPEED_MS)
        / (RESOURCE_FULL_SPEED_MS - RESOURCE_ZERO_SPEED_MS)
    )


def normalize_cf(cf: float) -> float:
    return clamp01((cf - CF_ZERO_FRACTION) / (CF_FULL_FRACTION - CF_ZERO_FRACTION))


def normalize_grid(distance_km: float) -> float:
    return clamp01(
        (GRID_ZERO_DISTANCE_KM - distance_km)
        / (GRID_ZERO_DISTANCE_KM - GRID_FULL_DISTANCE_KM)
    )


def normalize_terrain(slope_deg: float) -> float:
    return clamp01(
        (TERRAIN_ZERO_SLOPE_DEG - slope_deg)
        / (TERRAIN_ZERO_SLOPE_DEG - TERRAIN_FULL_SLOPE_DEG)
    )


def build_component(
    key: ScoreComponentKey,
    weight: float,
    raw: Optional[float],
    normalize: Callable[[float], float],
) -> ScoreComponent:
    """Build one component row; None/non-finite raw → conservative zero row."""
    if raw is None or not math.isfinite(raw):
        return ScoreComponent(key=key, weight=weight, raw=None, normalized=0, points=0)
    normalized = normalize(raw)
    return ScoreComponent(
        key=key,
        weight=weight,
        raw=raw,
        normalized=normalized,
        points=round1(weight * normalized),
    )


# ── Public API ──────────────────────────────────────────────────────────────


def compute_score(inputs: ScoreInputs, confidence: ScoreConfidence) -> AnalysisScore:
    """Compute the Screening Score (plan §2.6): Resource 45 · CF 25 · Grid 20 ·
    Terrain 10. ``confidence`` is attached verbatim and never affects ``value``
    or ``components``.
    """
    components: list[ScoreComponent] = [
        build_component(
            "resource",
            SCORE_WEIGHTS["resource"],
            inputs.mean_speed,
            normalize_resource,
        ),
        build_component("cf", SCORE_WEIGHTS["cf"], inputs.cf_iec3, normalize_cf),
        build_component(
            "grid", SCORE_WEIGHTS["grid"], inputs.nearest_ehv_km, normalize_grid
        ),
        build_component(
            "terrain",
            SCORE_WEIGHTS["terrain"],
            inputs.slope_90th_deg,
            normalize_terrain,
        ),
    ]

    # Headline from UNROUNDED weight·normalized (components keep `normalized`
    # unrounded, so the exact total is recoverable from the breakdown).
    exact_total = 0.0
    for component in components:
        exact_total += component.weight * component.normalized

    return AnalysisScore(value=js_round(exact_total), confidence=confidence, components=components)
