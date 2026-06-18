"""Section A — resource statistics. Pure functions over stitched GWA layer
patches + the AOI pixel mask. No I/O except indiacdf's one-time artifact read
(degrades to None) and a warning on sanity-clamp events.

Verbatim port of apps/api/src/services/analysis/resource.ts. Sources of truth:
plan.md §2/§3 (domain decisions, response contract) and VERIFIED.md §1 (layer
units, CF negative-artifact clamp, the pinned barometric formula, shear ln-ratio
least-squares method).

The shared scalar helpers (round_to/mean_of/percentile_of_sorted) and the mask
reducer (collect_inside_finite) live in the foundation (numeric.py / types.py)
and are IMPORTED, not redefined — same float64 semantics, tested in
tests/test_numeric.py.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Optional

from app.config import SITE_CLASS_BANDS
from app.engine.indiacdf import india_percentile_of
from app.engine.numeric import (
    clamp,
    js_round,
    mean_of,
    percentile_of_sorted,
    round_to,
)
from app.engine.types import (
    AoiMask,
    LayerPatch,
    SiteClass,
    collect_inside_finite,
)

logger = logging.getLogger(__name__)

# resource.ts:15-24 — keys of the seven layers Section A reduces over.
RESOURCE_LAYER_KEYS = (
    "cfIec3",
    "cfIec2",
    "ws50",
    "ws100",
    "ws150",
    "pd100",
    "elevation",
)

# ── Pinned formula constants (plan §2.4 / VERIFIED.md §1) ──────────────────

SEA_LEVEL_AIR_DENSITY_KG_M3 = 1.225
BAROMETRIC_LAPSE_PER_M = 2.2558e-5
BAROMETRIC_EXPONENT = 5.256

# Heights of the three GWA mean-speed layers used for the shear fit.
SHEAR_FIT_HEIGHTS_M = (50, 100, 150)
SHEAR_ALPHA_MIN = 0
SHEAR_ALPHA_MAX = 0.6
# 1/7 power law — used only if the 50/150 m layers are empty in-mask.
SHEAR_ALPHA_FALLBACK = 1 / 7

# 10th percentile of pixel speeds => "90% of site area exceeds X m/s".
AREA_EXCEEDANCE_QUANTILE = 0.1
QUARTILE_LOWER = 0.25
QUARTILE_MEDIAN = 0.5
QUARTILE_UPPER = 0.75

# ── Rounding policy (presentation-grade; airDensity 3 dp per plan) ─────────

SPEED_DECIMALS = 2
POWER_DENSITY_DECIMALS = 0
AIR_DENSITY_DECIMALS = 3
CF_DECIMALS = 4
SHEAR_DECIMALS = 4


# ── Resource section result (types.ts:85-107 ResourceData) ─────────────────


@dataclass(frozen=True)
class ResourceData:
    mean_speed: float
    min_speed: float
    max_speed: float
    p25_speed: float
    p50_speed: float
    p75_speed: float
    area_exceedance90: float
    power_density: Optional[float]
    power_density_raw: Optional[float]
    air_density: float
    cf_iec3: Optional[float]
    cf_iec2: Optional[float]
    shear_alpha: float
    weibull: Optional[dict]
    india_percentile: Optional[int]
    site_class: SiteClass


# ResourcePatches is a dict keyed by RESOURCE_LAYER_KEYS -> LayerPatch.
ResourcePatches = dict


# ── Small pure helpers (exported for tests and sibling modules) ────────────
#
# roundTo / meanOf / percentileOfSorted / collectInsideFinite from resource.ts
# now live in the foundation (numeric.py / types.py) — imported above. Their
# parity is covered by tests/test_numeric.py.


def fit_shear_alpha(mean_speeds) -> float:
    """Shear exponent α: least-squares slope of ln(v) vs ln(h) across the AOI
    mean speeds at 50/100/150 m. Returns NaN if any mean is missing or <= 0
    (ln undefined). Raw value — sanity clamping happens in compute_resource.
    (resource.ts:108-132)
    """
    log_heights: list[float] = []
    log_speeds: list[float] = []
    for i in range(len(SHEAR_FIT_HEIGHTS_M)):
        speed = mean_speeds[i] if i < len(mean_speeds) else None
        if speed is None or not math.isfinite(speed) or speed <= 0:
            return math.nan
        log_heights.append(math.log(SHEAR_FIT_HEIGHTS_M[i]))
        log_speeds.append(math.log(speed))
    x_mean = mean_of(log_heights)
    y_mean = mean_of(log_speeds)
    numerator = 0.0
    denominator = 0.0
    for i in range(len(log_heights)):
        dx = log_heights[i] - x_mean
        dy = log_speeds[i] - y_mean
        numerator += dx * dy
        denominator += dx * dx
    return numerator / denominator


def air_density_at_elevation(elevation_m: float) -> float:
    """Pinned barometric formula: ρ = 1.225·(1 − 2.2558e-5·h)^5.256 (plan §2.4).
    (resource.ts:135-138)
    """
    base = 1 - BAROMETRIC_LAPSE_PER_M * elevation_m
    return SEA_LEVEL_AIR_DENSITY_KG_M3 * base**BAROMETRIC_EXPONENT


def classify_site(mean_speed: float) -> SiteClass:
    """Site-class banding on AOI mean speed @100 m (plan §3 contract).
    (resource.ts:141-146)
    """
    if mean_speed >= SITE_CLASS_BANDS["excellent"]:
        return "excellent"
    if mean_speed >= SITE_CLASS_BANDS["good"]:
        return "good"
    if mean_speed >= SITE_CLASS_BANDS["moderate"]:
        return "moderate"
    return "marginal"


# ── Internal stages ─────────────────────────────────────────────────────────


def _assert_patches_match_mask(patches: ResourcePatches, mask: AoiMask) -> None:
    """resource.ts:150-159 assertPatchesMatchMask."""
    for key, patch in patches.items():
        if patch.width_px != mask.width_px or patch.height_px != mask.height_px:
            raise ValueError(
                f'computeResource: patch "{key}" is '
                f"{patch.width_px}×{patch.height_px}px "
                f"but mask is {mask.width_px}×{mask.height_px}px"
            )


def resolve_shear_alpha(raw_alpha: float) -> float:
    """Clamps a raw shear fit into the sanity band, warning with the raw value.
    (resource.ts:162-178)
    """
    if not math.isfinite(raw_alpha):
        logger.warning(
            "[resource] shear fit not computable (raw=%s); "
            "falling back to 1/7 power law (%s)",
            raw_alpha,
            f"{SHEAR_ALPHA_FALLBACK:.4f}",
        )
        return SHEAR_ALPHA_FALLBACK
    if raw_alpha < SHEAR_ALPHA_MIN or raw_alpha > SHEAR_ALPHA_MAX:
        logger.warning(
            "[resource] shear alpha %s outside sanity band [%s, %s]; clamping",
            raw_alpha,
            SHEAR_ALPHA_MIN,
            SHEAR_ALPHA_MAX,
        )
        return clamp(raw_alpha, SHEAR_ALPHA_MIN, SHEAR_ALPHA_MAX)
    return raw_alpha


def mean_capacity_factor(patch: LayerPatch, mask: AoiMask) -> Optional[float]:
    """Mean in-mask capacity factor, clamped >= 0 (VERIFIED.md: GWA resampling
    produces tiny negatives). None when the patch is entirely NaN in-mask.
    (resource.ts:184-188)
    """
    values = collect_inside_finite(patch, mask)
    if len(values) == 0:
        return None
    return max(0, mean_of(values))


@dataclass(frozen=True)
class DensityCorrectedPower:
    power_density: Optional[float]
    power_density_raw: Optional[float]
    air_density: float


def compute_density_corrected_power(
    patches: ResourcePatches,
    mask: AoiMask,
) -> DensityCorrectedPower:
    """Air-density correction (plan §2.4): ρ from the AOI mean elevation, applied
    multiplicatively to the GWA power density (which assumes sea-level ρ).
    Missing elevation degrades to sea level (correction becomes identity);
    missing pd100 degrades both power fields to None — only ws100 is fatal.
    (resource.ts:202-232)
    """
    elevations = collect_inside_finite(patches["elevation"], mask)
    if len(elevations) == 0:
        logger.warning(
            "[resource] elevation layer empty in-mask; "
            "assuming sea level for the density correction"
        )
    mean_elevation = 0 if len(elevations) == 0 else mean_of(elevations)
    air_density = air_density_at_elevation(mean_elevation)

    raw_values = collect_inside_finite(patches["pd100"], mask)
    if len(raw_values) == 0:
        logger.warning(
            "[resource] pd_mean_hgt100m layer empty in-mask; power density unavailable"
        )
        return DensityCorrectedPower(
            power_density=None,
            power_density_raw=None,
            air_density=round_to(air_density, AIR_DENSITY_DECIMALS),
        )
    power_density_raw = mean_of(raw_values)
    power_density = power_density_raw * (air_density / SEA_LEVEL_AIR_DENSITY_KG_M3)

    return DensityCorrectedPower(
        power_density=round_to(power_density, POWER_DENSITY_DECIMALS),
        power_density_raw=round_to(power_density_raw, POWER_DENSITY_DECIMALS),
        air_density=round_to(air_density, AIR_DENSITY_DECIMALS),
    )


# ── Main entry point ────────────────────────────────────────────────────────


def compute_resource(
    patches: ResourcePatches,
    mask: AoiMask,
    weibull: Optional[dict],
) -> ResourceData:
    """Section A statistics for one AOI. Throws when ws100 has zero valid in-mask
    pixels (the section becomes ``unavailable`` upstream); every other gap
    degrades per-field. Inputs are never mutated. (resource.ts:241-295)
    """
    _assert_patches_match_mask(patches, mask)

    ws100_values = collect_inside_finite(patches["ws100"], mask)
    if len(ws100_values) == 0:
        raise ValueError(
            "computeResource: zero valid ws_mean_hgt100m pixels inside the AOI mask"
        )
    sorted_ws100 = sorted(ws100_values)
    mean_speed = round_to(mean_of(ws100_values), SPEED_DECIMALS)

    raw_alpha = fit_shear_alpha(
        [
            mean_of(collect_inside_finite(patches["ws50"], mask)),
            mean_of(ws100_values),
            mean_of(collect_inside_finite(patches["ws150"], mask)),
        ]
    )
    shear_alpha = resolve_shear_alpha(raw_alpha)

    power = compute_density_corrected_power(patches, mask)

    cf_iec3 = mean_capacity_factor(patches["cfIec3"], mask)
    if cf_iec3 is None:
        logger.warning(
            "[resource] cf_iec3 layer empty in-mask; value will serialize as null"
        )
    cf_iec2 = mean_capacity_factor(patches["cfIec2"], mask)

    india_percentile = india_percentile_of(mean_speed)

    return ResourceData(
        mean_speed=mean_speed,
        min_speed=round_to(sorted_ws100[0], SPEED_DECIMALS),
        max_speed=round_to(sorted_ws100[len(sorted_ws100) - 1], SPEED_DECIMALS),
        p25_speed=round_to(
            percentile_of_sorted(sorted_ws100, QUARTILE_LOWER), SPEED_DECIMALS
        ),
        p50_speed=round_to(
            percentile_of_sorted(sorted_ws100, QUARTILE_MEDIAN), SPEED_DECIMALS
        ),
        p75_speed=round_to(
            percentile_of_sorted(sorted_ws100, QUARTILE_UPPER), SPEED_DECIMALS
        ),
        area_exceedance90=round_to(
            percentile_of_sorted(sorted_ws100, AREA_EXCEEDANCE_QUANTILE),
            SPEED_DECIMALS,
        ),
        power_density=power.power_density,
        power_density_raw=power.power_density_raw,
        air_density=power.air_density,
        cf_iec3=None if cf_iec3 is None else round_to(cf_iec3, CF_DECIMALS),
        cf_iec2=None if cf_iec2 is None else round_to(cf_iec2, CF_DECIMALS),
        shear_alpha=round_to(shear_alpha, SHEAR_DECIMALS),
        weibull=None if weibull is None else {"A": weibull["A"], "k": weibull["k"]},
        india_percentile=None if india_percentile is None else js_round(india_percentile),
        site_class=classify_site(mean_speed),
    )
