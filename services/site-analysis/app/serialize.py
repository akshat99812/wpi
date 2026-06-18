"""Serialization parity: Express `res.json` (plain JSON.stringify) maps NaN /
Infinity / -Infinity to `null`. Python's json.dumps emits those as invalid JSON
literals, so the port must sanitize non-finite floats to None (FP_AUDIT.md §0).
This is the belt-and-suspenders net; per-field null guards remain the primary
mechanism in the ported engine.
"""
from __future__ import annotations
import math
from typing import Any


def sanitize_non_finite(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {k: sanitize_non_finite(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize_non_finite(v) for v in value]
    return value
