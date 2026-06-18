"""AOI polygon -> pixel-center mask over a stitched LayerPatch grid.

Marks every patch pixel whose CENTER (web-mercator, ANALYSIS_ZOOM tile space --
see mercator.py) falls inside the AOI's outer ring, via an even-odd ray cast.
AOIs are small at z10 (<= 2,500 km^2 ~= 110k pixels), so per-pixel
point-in-polygon is plenty fast; a bbox pre-pass keeps the hot loop off the
patch pixels that cannot possibly be inside.

Winding-agnostic and accepts open or closed rings (the closing repeat is
stripped before testing). Never mutates its inputs.

NOTE: weibull.py carries its own tiny ray-cast for the plain lon/lat COG grid --
a deliberate, documented DRY tradeoff (its grid model does not fit LayerPatch);
keep the two in sync if the predicate ever changes.

Verbatim port of mask.ts (buildAoiMask + centerIndexRange + isInsideRing +
toOpenRingCoords).
"""
from __future__ import annotations

import math
from typing import Protocol, Sequence

import numpy as np

from .mercator import (
    TILE_SIZE,
    lat_to_tile_y,
    lng_to_tile_x,
    tile_x_to_lng,
    tile_y_to_lat,
)
from .types import AoiMask, GeometryError


class PatchFrame(Protocol):
    """The grid placement of a patch -- everything build_aoi_mask needs; callers
    may pass a full LayerPatch (structural subset)."""

    zoom: int
    min_tile_x: int
    min_tile_y: int
    width_px: int
    height_px: int


# A ring must keep >=3 distinct vertices once the closing repeat is gone.
MIN_DISTINCT_RING_VERTICES = 3

LngLat = Sequence[float]


def _is_finite_number(value: object) -> bool:
    """JS ``typeof v === "number" && Number.isFinite(v)`` for a ring component."""
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def to_open_ring_coords(ring: Sequence[LngLat]) -> tuple[list[float], list[float]]:
    """Validate the ring and strip the closing repeat(s). Returns NEW flat
    coordinate arrays (xs/ys) for the cast loop. Raises GeometryError -- the
    same machine-readable contract the rest of the pipeline uses."""
    for vertex in ring:
        lon = vertex[0] if vertex is not None and len(vertex) > 0 else None
        lat = vertex[1] if vertex is not None and len(vertex) > 1 else None
        if not _is_finite_number(lon) or not _is_finite_number(lat):
            raise GeometryError(
                "INVALID_GEOMETRY", "mask ring vertices must be finite [lon, lat] pairs"
            )
    end = len(ring)
    first = ring[0] if len(ring) > 0 else None
    while end > 1:
        last = ring[end - 1]
        if first is None or last is None:
            break
        if last[0] != first[0] or last[1] != first[1]:
            break
        end -= 1
    if end < MIN_DISTINCT_RING_VERTICES:
        raise GeometryError(
            "INVALID_GEOMETRY",
            f"mask ring has {end} distinct vertex/vertices "
            f"(need >={MIN_DISTINCT_RING_VERTICES})",
        )
    xs: list[float] = []
    ys: list[float] = []
    for i in range(end):
        vertex = ring[i]
        xs.append(vertex[0])
        ys.append(vertex[1])
    return xs, ys


def is_inside_ring(
    lon: float, lat: float, xs: Sequence[float], ys: Sequence[float]
) -> bool:
    """Even-odd ray cast over the flat ring arrays (implicitly closed)."""
    is_inside = False
    n = len(xs)
    j = n - 1
    for i in range(n):
        xi = xs[i]
        yi = ys[i]
        xj = xs[j]
        yj = ys[j]
        crosses_ray = (yi > lat) != (yj > lat) and lon < (
            (xj - xi) * (lat - yi)
        ) / (yj - yi) + xi
        if crosses_ray:
            is_inside = not is_inside
        j = i
    return is_inside


def center_index_range(
    min_tile_coord: float, cont_min: float, cont_max: float, size_px: int
) -> tuple[int, int]:
    """Inclusive patch-pixel index range whose centers fall within
    [min, max] along one axis, clamped to [0, size_px). Centers sit at
    origin + (index + 0.5)/TILE_SIZE in continuous tile space."""
    start = max(0, math.ceil((cont_min - min_tile_coord) * TILE_SIZE - 0.5))
    end = min(size_px - 1, math.floor((cont_max - min_tile_coord) * TILE_SIZE - 0.5))
    return start, end


def build_aoi_mask(ring: Sequence[LngLat], patch: PatchFrame) -> AoiMask:
    """Build the AOI pixel mask for ``patch``: inside[row*width_px + col] = 1 when
    that pixel's center lies inside ``ring``. Pixels outside the patch (or the
    ring) stay 0; a ring entirely off-patch yields an all-zero mask."""
    zoom = patch.zoom
    min_tile_x = patch.min_tile_x
    min_tile_y = patch.min_tile_y
    width_px = patch.width_px
    height_px = patch.height_px
    if (
        not _is_int(width_px)
        or not _is_int(height_px)
        or width_px <= 0
        or height_px <= 0
        or not math.isfinite(zoom)
    ):
        raise ValueError(
            f"build_aoi_mask: malformed patch frame "
            f"(zoom={zoom}, {width_px}x{height_px}px)"
        )
    xs, ys = to_open_ring_coords(ring)

    west = math.inf
    south = math.inf
    east = -math.inf
    north = -math.inf
    for i in range(len(xs)):
        west = min(west, xs[i])
        east = max(east, xs[i])
        south = min(south, ys[i])
        north = max(north, ys[i])

    # Bbox pre-pass in continuous tile space (north = smaller tile Y).
    cols = center_index_range(
        min_tile_x, lng_to_tile_x(west, zoom), lng_to_tile_x(east, zoom), width_px
    )
    rows = center_index_range(
        min_tile_y, lat_to_tile_y(north, zoom), lat_to_tile_y(south, zoom), height_px
    )
    cols_start, cols_end = cols
    rows_start, rows_end = rows

    inside = np.zeros(width_px * height_px, dtype=np.uint8)
    inside_count = 0

    if cols_start <= cols_end and rows_start <= rows_end:
        # Lon depends only on the column -- compute each once.
        lon_by_col = [0.0] * (cols_end - cols_start + 1)
        for col in range(cols_start, cols_end + 1):
            lon_by_col[col - cols_start] = tile_x_to_lng(
                min_tile_x + (col + 0.5) / TILE_SIZE, zoom
            )
        for row in range(rows_start, rows_end + 1):
            lat = tile_y_to_lat(min_tile_y + (row + 0.5) / TILE_SIZE, zoom)
            row_offset = row * width_px
            for col in range(cols_start, cols_end + 1):
                if is_inside_ring(lon_by_col[col - cols_start], lat, xs, ys):
                    inside[row_offset + col] = 1
                    inside_count += 1

    return AoiMask(
        width_px=width_px,
        height_px=height_px,
        inside=inside,
        inside_count=inside_count,
    )


def _is_int(value: object) -> bool:
    """JS ``Number.isInteger`` -- a finite number with no fractional part."""
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    if isinstance(value, float):
        return math.isfinite(value) and value == math.floor(value)
    return False
