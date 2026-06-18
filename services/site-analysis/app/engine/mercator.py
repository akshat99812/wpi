"""Web-mercator tile/pixel math — verbatim port of mercator.ts. Pure functions.

XYZ tiles, 256 px, EPSG:3857, matching build_wind_atlas.py so values sampled
here line up with the baked atlas pixels. All math is float64 (JS ``number``).
"""
from __future__ import annotations

import math

from .types import TileCover

TILE_SIZE = 256


def lng_to_tile_x(lng: float, z: int) -> float:
    """Continuous tile-space X for a longitude at zoom ``n = 2**z``."""
    return ((lng + 180) / 360) * 2**z


def lat_to_tile_y(lat: float, z: int) -> float:
    """Continuous tile-space Y for a latitude at zoom ``n = 2**z``."""
    r = (lat * math.pi) / 180
    return ((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2) * 2**z


def tile_x_to_lng(x: float, z: int) -> float:
    """Longitude of a continuous tile-space X."""
    return (x / 2**z) * 360 - 180


def tile_y_to_lat(y: float, z: int) -> float:
    """Latitude of a continuous tile-space Y."""
    n = math.pi - (2 * math.pi * y) / 2**z
    return (180 / math.pi) * math.atan(0.5 * (math.exp(n) - math.exp(-n)))


def tile_cover_for_bbox(
    bbox: tuple[float, float, float, float], z: int
) -> TileCover:
    """Tiles covering a lon/lat bbox ``[W, S, E, N]`` at zoom ``z`` (inclusive)."""
    n = 2**z

    def clamp(v: float) -> int:
        return min(n - 1, max(0, math.floor(v)))

    return TileCover(
        z=z,
        min_x=clamp(lng_to_tile_x(bbox[0], z)),
        max_x=clamp(lng_to_tile_x(bbox[2], z)),
        # bbox N (max lat) maps to the SMALLER tile Y.
        min_y=clamp(lat_to_tile_y(bbox[3], z)),
        max_y=clamp(lat_to_tile_y(bbox[1], z)),
    )


def tile_count_of(cover: TileCover) -> int:
    return (cover.max_x - cover.min_x + 1) * (cover.max_y - cover.min_y + 1)


def patch_pixel_center_lng_lat(
    min_tile_x: int, min_tile_y: int, col: int, row: int, z: int
) -> tuple[float, float]:
    """Lon/lat of a pixel CENTER in a stitched patch whose top-left pixel is the
    top-left of tile ``(min_tile_x, min_tile_y)``. ``col``/``row`` are patch-pixel
    indices."""
    tx = min_tile_x + (col + 0.5) / TILE_SIZE
    ty = min_tile_y + (row + 0.5) / TILE_SIZE
    return (tile_x_to_lng(tx, z), tile_y_to_lat(ty, z))


EARTH_RADIUS_KM = 6371.0088


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km (substation distance engine)."""
    rad = math.pi / 180
    d_lat = (lat2 - lat1) * rad
    d_lon = (lon2 - lon1) * rad
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(d_lon / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * math.asin(min(1, math.sqrt(a)))


def square_ring_around(
    lon: float, lat: float, side_km: float
) -> list[tuple[float, float]]:
    """Axis-aligned square of ``side_km`` centered on ``[lon, lat]`` as a closed
    GeoJSON-style ring. Used by point mode (5x5 km) on client and server."""
    half_km = side_km / 2
    d_lat = half_km / 110.574  # km per degree latitude
    d_lon = half_km / (111.32 * math.cos((lat * math.pi) / 180))
    return [
        (lon - d_lon, lat - d_lat),
        (lon + d_lon, lat - d_lat),
        (lon + d_lon, lat + d_lat),
        (lon - d_lon, lat + d_lat),
        (lon - d_lon, lat - d_lat),
    ]
