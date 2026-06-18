"""India-wide ws@100m percentile context — "this site's mean speed beats X%
of India". Backed by a tiny committed artifact of 101 quantiles (q0..q100 of
all valid India ws@100m grid cells) built by scripts/build-india-cdf.ts from
the baked wind-atlas cursor grid.

Loading is lazy, happens once, and NEVER throws: a missing or corrupt artifact
logs one warning and india_percentile_of returns None thereafter (section A
simply omits the stat).

Line-for-line port of apps/api/src/services/analysis/indiacdf.ts. The TS module
resolves the artifact relative to import.meta.url; here we read the pinned
config.INDIA_CDF_PATH (Docker path /app/data/...; absent locally) so the loader
fails closed just like the oracle does when the file is missing.
"""
from __future__ import annotations

import json
import logging
import math
from typing import Optional, Sequence

from app import config

logger = logging.getLogger(__name__)

EXPECTED_QUANTILE_COUNT = 101
MAX_PERCENTILE = 100

# Sentinel for "load not attempted yet", mirroring the TS `undefined`. After a
# load attempt the cache is either a tuple of floats (success) or None
# (attempted and unavailable). Distinct object so None can mean "unavailable".
_NOT_ATTEMPTED = object()

# undefined (not attempted) = _NOT_ATTEMPTED; None = attempted and unavailable.
_cached_quantiles: object = _NOT_ATTEMPTED


def percentile_from_cdf(quantiles: Sequence[float], speed: float) -> float:
    """Percentile rank of ``speed`` against a sorted (non-decreasing) quantile
    array, linearly interpolated between bracketing quantiles. Clamps to 0 below
    the first quantile and 100 above the last. Flat (duplicate) runs resolve to
    the upper edge of the run — deterministic by construction.

    Generic over array length: with N quantiles, index i maps to percentile
    i·(100/(N−1)); the production artifact has 101, so index == percentile.
    """
    if len(quantiles) < 2:
        raise ValueError(
            f"percentileFromCdf: need at least 2 quantiles, got {len(quantiles)}"
        )
    first = quantiles[0]
    last = quantiles[len(quantiles) - 1]
    if speed <= first:
        return 0
    if speed >= last:
        return MAX_PERCENTILE
    step = MAX_PERCENTILE / (len(quantiles) - 1)
    for i in range(len(quantiles) - 1):
        lower = quantiles[i]
        upper = quantiles[i + 1]
        if speed < upper:
            # Invariants here: lower <= speed < upper, hence upper > lower.
            return (i + (speed - lower) / (upper - lower)) * step
    # Unreachable: speed < last guarantees a bracket above.
    return MAX_PERCENTILE


def parse_quantiles(raw_json: str) -> Sequence[float]:
    """Parses + validates the artifact JSON; raises with a precise reason."""
    parsed = json.loads(raw_json)
    quantiles = parsed.get("quantiles") if isinstance(parsed, dict) else None
    if not isinstance(quantiles, list) or len(quantiles) != EXPECTED_QUANTILE_COUNT:
        got = (
            f"length {len(quantiles)}" if isinstance(quantiles, list) else type(quantiles).__name__
        )
        raise ValueError(f"expected {EXPECTED_QUANTILE_COUNT} quantiles, got {got}")
    for i in range(len(quantiles)):
        q = quantiles[i]
        # JS: typeof q !== "number" || !Number.isFinite(q). booleans are not
        # numbers in JS; in Python bool is an int subclass, so reject explicitly.
        if isinstance(q, bool) or not isinstance(q, (int, float)) or not math.isfinite(q):
            raise ValueError(f"quantile[{i}] is not a finite number")
        if i > 0 and q < quantiles[i - 1]:
            raise ValueError(f"quantiles are not non-decreasing at index {i}")
    return quantiles


def load_quantiles_once() -> Optional[Sequence[float]]:
    global _cached_quantiles
    if _cached_quantiles is not _NOT_ATTEMPTED:
        return _cached_quantiles  # type: ignore[return-value]
    try:
        with open(config.INDIA_CDF_PATH, "r", encoding="utf8") as handle:
            raw_json = handle.read()
        _cached_quantiles = parse_quantiles(raw_json)
    except Exception as error:  # noqa: BLE001 — mirror TS catch-all, never throws
        reason = str(error)
        logger.warning(
            "[indiaCdf] India ws100 CDF artifact unavailable (%s); "
            "indiaPercentile will be null. Regenerate with: bun run scripts/build-india-cdf.ts",
            reason,
        )
        _cached_quantiles = None
    return _cached_quantiles  # type: ignore[return-value]


def india_percentile_of(speed: float) -> Optional[float]:
    """Percentile rank (0–100, unrounded) of a mean speed within the all-India
    ws@100m distribution, or None when the artifact is absent/unreadable or the
    input is not finite. Never throws.
    """
    if not isinstance(speed, (int, float)) or isinstance(speed, bool) or not math.isfinite(speed):
        return None
    quantiles = load_quantiles_once()
    if quantiles is None:
        return None
    return percentile_from_cdf(quantiles, speed)


def reset_cache_for_tests() -> None:
    """Reset the module-level lazy cache so tests can re-trigger loadQuantilesOnce
    after monkeypatching config.INDIA_CDF_PATH. Not part of the oracle surface —
    the TS module's cache is reset between Bun test files automatically.
    """
    global _cached_quantiles
    _cached_quantiles = _NOT_ATTEMPTED
