"""Shared scalar numeric primitives — the parity-critical foundation.

Every ported module rounds, averages and interpolates through THESE helpers so
the float64 semantics match the legacy TypeScript engine exactly. The two facts
that bite hardest (FP_AUDIT.md):

1. JS ``Math.round`` rounds half toward +infinity; Python's built-in ``round``
   is banker's rounding (half to even). They disagree on every ``x.5`` value, so
   we never use the built-in — ``js_round``/``round_to`` reproduce JS.
2. ``roundTo`` (resource.ts:56-60) passes non-finite values through UNCHANGED;
   the non-finite -> null mapping happens later, at serialization.

All arithmetic is float64 (Python ``float`` is IEEE-754 double, same as a JS
``number``). Reductions sum SEQUENTIALLY to match the legacy loops bit-for-bit.
"""
from __future__ import annotations

import math
from typing import Iterable, Sequence


def js_round(x: float) -> int:
    """JS ``Math.round`` for finite ``x``: nearest integer, half toward +inf.

    NOT ``floor(x + 0.5)`` — that adds a rounding step that breaks the edge case
    ``0.49999999999999994`` (the sum rounds up to 1.0, so floor gives 1 where V8
    gives 0). Comparing the exact fractional part ``x - floor(x)`` against 0.5
    reproduces the ECMAScript spec exactly: ``< 0.5`` rounds down, ``>= 0.5``
    (incl. the exact tie) rounds up toward +inf. ``x - floor(x)`` is exact for
    ``|x| < 2**52``. Callers guard non-finite inputs; ``round_to`` does.
    """
    floor = math.floor(x)
    return floor if (x - floor) < 0.5 else floor + 1


def round_to(value: float, decimals: int) -> float:
    """``roundTo(v, d) = Math.round(v * 10**d) / 10**d`` (resource.ts:56-60).

    Non-finite values pass through unchanged — the serializer maps them to null.
    """
    if not math.isfinite(value):
        return value
    factor = 10**decimals
    return js_round(value * factor) / factor


def round1(value: float) -> float:
    """1-dp ``Math.round(x*10)/10`` — grid/terrain/sizing display fields."""
    return round_to(value, 1)


def clamp01(x: float) -> float:
    """``Math.min(1, Math.max(0, x))`` — score normalization clamp."""
    return min(1.0, max(0.0, x))


def clamp(value: float, low: float, high: float) -> float:
    """``Math.min(high, Math.max(low, value))`` (shear-alpha sanity band)."""
    return min(high, max(low, value))


def mean_of(values: Sequence[float]) -> float:
    """Arithmetic mean; ``NaN`` for an empty input (meanOf, resource.ts:63-68).

    Sequential float64 accumulation — matches the legacy ``for`` loop exactly so
    the 2-dp rounded mean can never drift from the TS value.
    """
    if len(values) == 0:
        return math.nan
    total = 0.0
    for value in values:
        total += value
    return total / len(values)


def percentile_of_sorted(sorted_values: Sequence[float], q: float) -> float:
    """Linear / R-7 percentile of an ASCENDING-sorted array (resource.ts:75-89).

    ``position = q*(n-1)``; interpolate between the two bracketing elements.
    Raises on an empty array or ``q`` outside ``[0, 1]`` (same as the original).
    """
    n = len(sorted_values)
    if n == 0:
        raise ValueError("percentile_of_sorted: empty input")
    if not math.isfinite(q) or q < 0 or q > 1:
        raise ValueError(f"percentile_of_sorted: q must be in [0, 1], got {q}")
    position = q * (n - 1)
    lower_index = math.floor(position)
    upper_index = min(lower_index + 1, n - 1)
    fraction = position - lower_index
    lower = sorted_values[lower_index]
    upper = sorted_values[upper_index]
    return lower + fraction * (upper - lower)


def to_finite_number(value: object) -> float:
    """Coerce a DB/parsed value to float, REJECTING non-finite (toFiniteNumber).

    Mirrors the legacy guard used on psycopg ``Decimal``/string columns and grid
    voltages: ``Number(x)`` then throw if not finite. The validation/grid ports
    may wrap this with their own error type; the coercion + reject rule is shared.
    """
    number = float(value)  # raises ValueError/TypeError on garbage, like Number()
    if not math.isfinite(number):
        raise ValueError(f"expected a finite number, got {value!r}")
    return number


def all_finite(values: Iterable[float]) -> bool:
    return all(math.isfinite(v) for v in values)
