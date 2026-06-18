"""Internal engine types — Python mirror of the non-response half of types.ts.

The HTTP response contract lives in ``app/models`` (Pydantic). These are the
in-flight structures the stages pass around: stitched raster patches, the AOI
pixel mask, the validated AOI, and the machine-readable geometry error.

Raster ``data`` is float32 (matches a JS ``Float32Array`` — nodata = NaN); every
reduction widens to float64 by casting each sampled element to ``float`` (exactly
what reading a ``Float32Array`` element into a JS ``number`` does).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

# ── Machine-readable 400 codes (types.ts:55-72) ─────────────────────────────

GeometryErrorCode = Literal[
    "INVALID_GEOMETRY",
    "TOO_MANY_VERTICES",
    "AREA_TOO_LARGE",
    "AREA_TOO_SMALL",
    "OUT_OF_INDIA",
    "SELF_INTERSECTING",
]


class GeometryError(Exception):
    """Carries a machine-readable ``code`` the route maps to a 400 body."""

    def __init__(self, code: GeometryErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: GeometryErrorCode = code
        self.message = message


SiteClass = Literal["excellent", "good", "moderate", "marginal"]
SectionStatus = Literal["ok", "unavailable"]


# ── Internal raster model (types.ts:16-43) ──────────────────────────────────


@dataclass(frozen=True)
class LayerPatch:
    """Stitched web-mercator mosaic for ONE layer at ANALYSIS_ZOOM, row-major,
    row 0 = north, nodata = NaN. ``data`` length == width_px * height_px."""

    zoom: int
    min_tile_x: int
    min_tile_y: int
    width_px: int
    height_px: int
    data: np.ndarray  # float32, shape (height_px * width_px,)


@dataclass(frozen=True)
class AoiMask:
    """1 where a pixel CENTER is inside the AOI ring; same grid as LayerPatch."""

    width_px: int
    height_px: int
    inside: np.ndarray  # uint8, shape (height_px * width_px,)
    inside_count: int


@dataclass(frozen=True)
class ValidatedAoi:
    """Result of validating + canonicalizing the request geometry (types.ts:45-53)."""

    ring: list[tuple[float, float]]  # CLOSED outer ring, lon/lat, 6-dp canonical
    area_km2: float
    centroid: tuple[float, float]  # [lon, lat]
    bbox: tuple[float, float, float, float]  # [W, S, E, N]
    is_point_mode: bool


@dataclass(frozen=True)
class TileCover:
    z: int
    min_x: int
    max_x: int
    min_y: int
    max_y: int


def collect_inside_finite(patch: LayerPatch, mask: AoiMask) -> list[float]:
    """All finite pixel values whose mask cell is 1, in ascending-index order,
    each widened to float64 (resource.ts:91-101 ``collectInsideFinite``).

    Verbatim port: ascending index order preserves the legacy sequential-sum
    order so ``mean_of``/``percentile_of_sorted`` reproduce the TS values.
    """
    selected = patch.data[mask.inside == 1]
    finite = selected[np.isfinite(selected)]
    return [float(v) for v in finite]
