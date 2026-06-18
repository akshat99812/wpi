"""Serialization parity with Express ``res.json`` (plain ``JSON.stringify``).

Two JS behaviours Python's ``json`` does NOT reproduce by default, both
parity-relevant (FP_AUDIT.md sec 0):

1. ``JSON.stringify`` emits ``null`` for ``NaN``/``Infinity``/``-Infinity``;
   Python emits the invalid literals ``NaN``/``Infinity`` (and orjson raises).
2. JS ``number`` has no int/float split: ``JSON.stringify(8.0)`` -> ``"8"`` and
   ``JSON.stringify(-0)`` -> ``"0"``. Python's ``json.dumps(8.0)`` -> ``"8.0"``.
   Every ``roundTo(x, 0)`` field (powerDensity, terrain elevations) and any
   rounded value that lands on an integer would otherwise diverge.

``js_jsonify`` walks the payload mapping non-finite floats -> ``None`` and
integer-valued finite floats -> ``int``, so the remaining floats serialize via
Python's shortest-round-trip ``repr`` (which agrees with V8's Number->String for
the lon/lat/speed/distance magnitudes this engine emits — no exponential range).
The per-field ``null`` guards in the ported stages remain the PRIMARY mechanism;
this is the belt-and-suspenders net that matches ``res.json`` exactly.
"""
from __future__ import annotations

import json
import math
from typing import Any


def js_jsonify(value: Any) -> Any:
    """Recursively coerce a payload to JS-``JSON.stringify`` equivalent values.

    - non-finite float -> ``None`` (JS ``null``)
    - integer-valued finite float (incl. ``-0.0``) -> ``int`` (JS drops ``.0``)
    - dict/list/tuple -> recursed (tuples become lists, matching JSON arrays)
    - bool is left untouched (``bool`` is an ``int`` subclass — guard first)
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        if value == int(value):
            return int(value)
        return value
    if isinstance(value, dict):
        return {k: js_jsonify(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [js_jsonify(v) for v in value]
    return value


def sanitize_non_finite(value: Any) -> Any:
    """Backwards-compatible alias: only the non-finite -> ``None`` mapping.

    Retained for callers that just need the NaN/Inf net; new code should use
    ``js_jsonify`` (which also fixes integer-valued-float formatting).
    """
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {k: sanitize_non_finite(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize_non_finite(v) for v in value]
    return value


def js_dumps(value: Any) -> str:
    """Serialize ``value`` to JSON bytes-compatible with Express ``res.json``.

    ``separators=(",", ":")`` matches ``JSON.stringify`` default (no spaces).
    """
    return json.dumps(js_jsonify(value), separators=(",", ":"), allow_nan=False)
