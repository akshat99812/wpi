"""Request-geometry validation + canonicalization for POST /api/analyze.

Verbatim port of apps/api/src/services/analysis/geometry.ts (the parity oracle).

Pipeline (order is load-bearing — see plan.md §4 Phase 1 and §2.7):
  structure -> outer ring only (holes ignored) -> closure -> vertex cap ->
  canonical 6-dp rounding -> consecutive-duplicate dedupe ->
  self-intersection -> geodesic area caps -> India bbox ->
  centroid / bbox / point-mode fingerprint.

Everything downstream of canonicalization (kinks, area, centroid, bbox,
point-mode detection, the result-cache key) operates on the ROUNDED
coordinates. Plan hard rule: never hash — or analyze — unrounded geometry.

The turf calls (``area``/``centroid``/``kinks``) are ported VERBATIM from the
vendored @turf CJS bundles so the float64 geodesic math matches bit-for-bit:
  - turf @turf/area ``ringArea`` (earthRadius = 6371008.8, FACTOR = R^2/2)
  - turf @turf/centroid (mean of OPEN-ring vertices, excludeWrapCoord=true)
  - turf @turf/kinks (segment-intersection over the ring's edges)

Exports:
  - ``validate_analyze_request`` — zod-equivalent request-structure check
  - ``geo_json_polygon_schema_check`` — zod-equivalent GeoJSON Polygon check
  - ``validate_aoi(geometry)`` — full pipeline, raises GeometryError on failure
  - ``canonical_geometry_string(aoi)`` — deterministic ring JSON for cache keys
"""
from __future__ import annotations

import math
from typing import Any

from app import config
from app.engine.numeric import round_to
from app.engine.types import GeometryError, ValidatedAoi
from app.serialize import js_dumps

# ── Local constants ─────────────────────────────────────────────────────────

# A closed linear ring needs at least 4 points (triangle + closing repeat).
MIN_CLOSED_RING_POINTS = 4
# Same bound expressed on the OPEN ring (closing repeat stripped).
MIN_OPEN_RING_VERTICES = MIN_CLOSED_RING_POINTS - 1

SQUARE_METERS_PER_KM2 = 1_000_000

# Point-mode fingerprint: the client converts a map click into
# square_ring_around(lon, lat, 5) — an axis-aligned 4-corner rectangle whose
# geodesic area lands within ~1 km^2 of 25 km^2 at any Indian latitude.
POINT_MODE_CORNER_COUNT = 4
POINT_MODE_AREA_MIN_KM2 = 24
POINT_MODE_AREA_MAX_KM2 = 26
# Tolerance (degrees) when grouping lons/lats for axis-alignment checks.
AXIS_ALIGNED_TOLERANCE_DEG = 1e-9

# ── turf @turf/helpers constants (vendored) ─────────────────────────────────

# @turf/helpers earthRadius (meters).
EARTH_RADIUS_M = 6371008.8
# @turf/area module-level constants.
FACTOR = EARTH_RADIUS_M * EARTH_RADIUS_M / 2
PI_OVER_180 = math.pi / 180


Vertex = tuple[float, float]


# ── Zod boundary schema (analyzeRequestSchema / geoJsonPolygonSchema) ────────


def _is_finite_number(value: Any) -> bool:
    """``z.number().refine(Number.isFinite)``: a real JS number AND finite.

    In JS ``z.number()`` rejects non-numbers; the refine rejects NaN/Inf. Match
    that: reject bool (JS distinguishes number from boolean), require ``float``/
    ``int`` (not bool), then require finite.
    """
    if isinstance(value, bool):
        return False
    if not isinstance(value, (int, float)):
        return False
    return math.isfinite(value)


def geo_json_polygon_schema_check(geometry: Any) -> bool:
    """Mirror ``geoJsonPolygonSchema.safeParse(...).success``.

    Structural GeoJSON Polygon: ``type === "Polygon"`` and ``coordinates`` is an
    array of >=1 rings, each an array of ``[lon, lat]`` finite-number tuples.
    """
    if not isinstance(geometry, dict):
        return False
    if geometry.get("type") != "Polygon":
        return False
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list):
        return False
    if len(coordinates) < 1:  # .min(1)
        return False
    for ring in coordinates:
        if not isinstance(ring, list):
            return False
        for vertex in ring:
            # z.tuple([finiteCoordinate, finiteCoordinate]): exactly 2 finite.
            if not isinstance(vertex, (list, tuple)):
                return False
            if len(vertex) != 2:
                return False
            if not _is_finite_number(vertex[0]) or not _is_finite_number(vertex[1]):
                return False
    return True


def validate_analyze_request(body: Any) -> bool:
    """Mirror ``analyzeRequestSchema.safeParse(body).success``.

    Request body for POST /api/analyze: ``{ geometry: <GeoJsonPolygon> }``.
    """
    if not isinstance(body, dict):
        return False
    if "geometry" not in body:
        return False
    return geo_json_polygon_schema_check(body["geometry"])


# ── Internal helpers ────────────────────────────────────────────────────────


def round_coordinate(value: float) -> float:
    """Round one coordinate to GEOMETRY_HASH_DECIMALS, normalizing -0 to 0."""
    rounded = round_to(value, config.GEOMETRY_HASH_DECIMALS)
    return 0.0 if rounded == 0 else rounded


def is_same_vertex(a: Vertex, b: Vertex) -> bool:
    return a[0] == b[0] and a[1] == b[1]


def extract_outer_ring(geometry: Any) -> list[Vertex]:
    """Pull the OUTER ring out of the polygon, re-checking structure defensively
    (validate_aoi must be safe even for callers that skipped the schema).

    Holes (rings at index >=1) are intentionally IGNORED: screening operates on
    the outer footprint only; a donut AOI is analyzed as its full outer shape.
    """
    if (
        geometry is None
        or not isinstance(geometry, dict)
        or geometry.get("type") != "Polygon"
        or not isinstance(geometry.get("coordinates"), list)
    ):
        raise GeometryError("INVALID_GEOMETRY", "geometry must be a GeoJSON Polygon")
    coordinates = geometry["coordinates"]
    outer = coordinates[0] if len(coordinates) > 0 else None
    if not isinstance(outer, list) or len(outer) == 0:
        raise GeometryError("INVALID_GEOMETRY", "Polygon has no outer ring")
    result: list[Vertex] = []
    for position in outer:
        if not isinstance(position, (list, tuple)) or len(position) < 2:
            raise GeometryError(
                "INVALID_GEOMETRY", "every vertex must be a [lon, lat] pair"
            )
        lon = position[0]
        lat = position[1]
        if (
            not isinstance(lon, (int, float))
            or isinstance(lon, bool)
            or not isinstance(lat, (int, float))
            or isinstance(lat, bool)
            or not math.isfinite(lon)
            or not math.isfinite(lat)
        ):
            raise GeometryError(
                "INVALID_GEOMETRY", "vertex coordinates must be finite numbers"
            )
        result.append((float(lon), float(lat)))
    return result


def to_open_ring(ring: list[Vertex]) -> list[Vertex]:
    """Strip the closing repeat if the ring arrived closed; unclosed rings are
    accepted as-is (auto-close contract — we always re-close after dedupe).
    Returns a new list; never mutates the input.
    """
    first = ring[0] if len(ring) > 0 else None
    last = ring[-1] if len(ring) > 0 else None
    if (
        len(ring) > 1
        and first is not None
        and last is not None
        and is_same_vertex(first, last)
    ):
        return list(ring[:-1])
    return list(ring)


def canonicalize_ring(open_ring: list[Vertex]) -> list[Vertex]:
    """Round every vertex to the canonical decimal grid (new list)."""
    return [(round_coordinate(lon), round_coordinate(lat)) for lon, lat in open_ring]


def dedupe_consecutive(open_ring: list[Vertex]) -> list[Vertex]:
    """Drop consecutive duplicate vertices (zero-length edges — including ones
    CREATED by canonical rounding), plus any trailing vertex that collapsed onto
    the first (wrap-around duplicate). Returns a new list.
    """
    result: list[Vertex] = []
    for vertex in open_ring:
        previous = result[-1] if len(result) > 0 else None
        if previous is None or not is_same_vertex(previous, vertex):
            result.append((vertex[0], vertex[1]))
    while len(result) > 1:
        first = result[0]
        last = result[-1]
        if first is None or last is None or not is_same_vertex(first, last):
            break
        result.pop()
    return result


# ── Vendored turf ports ──────────────────────────────────────────────────────


def ring_area(coords: list[Vertex]) -> float:
    """@turf/area ``ringArea`` — verbatim. ``coords`` is the CLOSED ring."""
    coords_length = len(coords) - 1
    if coords_length <= 2:
        return 0.0
    total = 0.0
    i = 0
    while i < coords_length:
        lower = coords[i]
        middle = coords[0 if i + 1 == coords_length else i + 1]
        upper = coords[(i + 2) % coords_length if i + 2 >= coords_length else i + 2]
        lower_x = lower[0] * PI_OVER_180
        middle_y = middle[1] * PI_OVER_180
        upper_x = upper[0] * PI_OVER_180
        total += (upper_x - lower_x) * math.sin(middle_y)
        i += 1
    return total * FACTOR


def turf_area_polygon(closed_ring: list[Vertex]) -> float:
    """@turf/area for a single-ring Polygon: ``abs(ringArea(outer))``."""
    return abs(ring_area(closed_ring))


def turf_centroid_polygon(closed_ring: list[Vertex]) -> tuple[float, float]:
    """@turf/centroid for a single-ring Polygon — verbatim.

    ``coordEach(..., excludeWrapCoord=true)`` skips the closing repeat of each
    ring, so this averages the OPEN-ring vertices (mean over closedRing[:-1]).
    """
    x_sum = 0.0
    y_sum = 0.0
    length = 0
    # excludeWrapCoord => iterate coords[: len - 1] for a Polygon ring.
    for k in range(len(closed_ring) - 1):
        coord = closed_ring[k]
        x_sum += coord[0]
        y_sum += coord[1]
        length += 1
    return (x_sum / length, y_sum / length)


def _line_intersects(
    line1_start_x: float,
    line1_start_y: float,
    line1_end_x: float,
    line1_end_y: float,
    line2_start_x: float,
    line2_start_y: float,
    line2_end_x: float,
    line2_end_y: float,
) -> tuple[float, float] | None:
    """@turf/kinks ``lineIntersects`` — verbatim. Returns [x, y] or None."""
    denominator = (line2_end_y - line2_start_y) * (line1_end_x - line1_start_x) - (
        line2_end_x - line2_start_x
    ) * (line1_end_y - line1_start_y)
    if denominator == 0:
        # result.x/result.y start as null in the JS source, so this returns false.
        return None
    a = line1_start_y - line2_start_y
    b = line1_start_x - line2_start_x
    numerator1 = (line2_end_x - line2_start_x) * a - (line2_end_y - line2_start_y) * b
    numerator2 = (line1_end_x - line1_start_x) * a - (line1_end_y - line1_start_y) * b
    a = numerator1 / denominator
    b = numerator2 / denominator
    result_x = line1_start_x + a * (line1_end_x - line1_start_x)
    result_y = line1_start_y + a * (line1_end_y - line1_start_y)
    on_line1 = 0 <= a <= 1
    on_line2 = 0 <= b <= 1
    if on_line1 and on_line2:
        return (result_x, result_y)
    return None


def turf_kinks_polygon(closed_ring: list[Vertex]) -> int:
    """@turf/kinks for a single-ring Polygon — verbatim. Returns feature count.

    ``coordinates = feature.coordinates`` (the rings); for a single-ring
    polygon both loops iterate the one ring (``line1 === line2``).
    """
    coordinates: list[list[Vertex]] = [closed_ring]
    feature_count = 0
    for line1 in coordinates:
        for line2 in coordinates:
            for i in range(len(line1) - 1):
                for k in range(i, len(line2) - 1):
                    if line1 is line2:
                        if abs(i - k) == 1:
                            continue
                        if (
                            i == 0
                            and k == len(line1) - 2
                            and line1[i][0] == line1[len(line1) - 1][0]
                            and line1[i][1] == line1[len(line1) - 1][1]
                        ):
                            continue
                    intersection = _line_intersects(
                        line1[i][0],
                        line1[i][1],
                        line1[i + 1][0],
                        line1[i + 1][1],
                        line2[k][0],
                        line2[k][1],
                        line2[k + 1][0],
                        line2[k + 1][1],
                    )
                    if intersection is not None:
                        feature_count += 1
    return feature_count


def assert_not_self_intersecting(closed_ring: list[Vertex]) -> None:
    kink_count = turf_kinks_polygon(closed_ring)
    if kink_count > 0:
        raise GeometryError(
            "SELF_INTERSECTING",
            f"polygon outer ring self-intersects ({kink_count} crossing point(s))",
        )


def assert_inside_india_bbox(open_ring: list[Vertex]) -> None:
    """Every vertex must sit inside INDIA_BBOX — bbox check only, per plan §2.7."""
    west, south, east, north = config.INDIA_BBOX
    for lon, lat in open_ring:
        if lon < west or lon > east or lat < south or lat > north:
            bbox_join = ", ".join(_js_number_str(v) for v in config.INDIA_BBOX)
            raise GeometryError(
                "OUT_OF_INDIA",
                f"vertex [{_js_number_str(lon)}, {_js_number_str(lat)}] is outside "
                f"the India bbox [{bbox_join}]",
            )


def ring_bbox(open_ring: list[Vertex]) -> tuple[float, float, float, float]:
    west = math.inf
    south = math.inf
    east = -math.inf
    north = -math.inf
    for lon, lat in open_ring:
        west = min(west, lon)
        south = min(south, lat)
        east = max(east, lon)
        north = max(north, lat)
    return (west, south, east, north)


def approx_equal(a: float, b: float) -> bool:
    return abs(a - b) <= AXIS_ALIGNED_TOLERANCE_DEG


def distinct_within_tolerance(values: list[float]) -> list[float]:
    """Distinct values under the axis-alignment tolerance, in first-seen order."""
    distinct: list[float] = []
    for value in values:
        if not any(approx_equal(seen, value) for seen in distinct):
            distinct.append(value)
    return distinct


def detect_point_mode(open_ring: list[Vertex], area_km2: float) -> bool:
    """Point-mode fingerprint: exactly 4 distinct corners forming an axis-aligned
    rectangle (2 distinct lons x 2 distinct lats, all four combinations present)
    AND geodesic area within 24-26 km^2.
    """
    if len(open_ring) != POINT_MODE_CORNER_COUNT:
        return False
    if area_km2 < POINT_MODE_AREA_MIN_KM2 or area_km2 > POINT_MODE_AREA_MAX_KM2:
        return False
    lons = distinct_within_tolerance([vertex[0] for vertex in open_ring])
    lats = distinct_within_tolerance([vertex[1] for vertex in open_ring])
    if len(lons) != 2 or len(lats) != 2:
        return False
    return all(
        all(
            any(
                approx_equal(vertex[0], lon) and approx_equal(vertex[1], lat)
                for vertex in open_ring
            )
            for lat in lats
        )
        for lon in lons
    )


def compute_centroid(closed_ring: list[Vertex]) -> tuple[float, float]:
    lon, lat = turf_centroid_polygon(closed_ring)
    if not math.isfinite(lon) or not math.isfinite(lat):
        raise GeometryError(
            "INVALID_GEOMETRY", "could not compute a finite centroid for the AOI"
        )
    return (lon, lat)


# ── JS Number -> string helpers (error-message parity) ──────────────────────


def _js_number_str(value: float) -> str:
    """JS ``String(number)`` for the magnitudes this engine emits.

    Used inside template literals (e.g. OUT_OF_INDIA messages and bbox join).
    Integer-valued floats drop the ``.0`` (``67.0`` -> ``"67"``); otherwise the
    shortest round-trip ``repr`` matches V8 for these lon/lat magnitudes.
    """
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return repr(value)


def _to_fixed(value: float, digits: int) -> str:
    """JS ``Number.prototype.toFixed(digits)`` — round-half-away-from-zero on the
    decimal string, reproduced via Python's ``format`` (which is round-half-even)
    corrected to match V8.

    For the magnitudes this engine emits (area in km^2, 1-3 dp) JS toFixed and
    Python ``f"{x:.{digits}f}"`` agree, because toFixed rounds the IEEE-754 double
    and the tie cases do not arise at these scales. We use Python formatting
    directly; the area assertions in the ported tests confirm parity.
    """
    return f"{value:.{digits}f}"


# ── Public pipeline ─────────────────────────────────────────────────────────


def validate_aoi(geometry: Any) -> ValidatedAoi:
    """Validate + canonicalize the request polygon into a ValidatedAoi.

    Raises GeometryError with a machine-readable code (types.py) on every
    failure; the route maps those to 400 responses. Never mutates the input.

    Note on the vertex cap: "distinct vertices" means the closing repeat does not
    count, and the cap applies to the ring AS SENT (before canonical rounding) so
    oversized inputs fail fast.
    """
    # 1. Outer ring only; auto-close; >=4 points after closing.
    raw_open_ring = to_open_ring(extract_outer_ring(geometry))
    if len(raw_open_ring) < MIN_OPEN_RING_VERTICES:
        raise GeometryError(
            "INVALID_GEOMETRY",
            f"outer ring has fewer than {MIN_CLOSED_RING_POINTS} points after closing",
        )

    # 2. Vertex cap (closing repeat excluded).
    if len(raw_open_ring) > config.AOI_MAX_VERTICES:
        raise GeometryError(
            "TOO_MANY_VERTICES",
            f"outer ring has {len(raw_open_ring)} vertices "
            f"(max {config.AOI_MAX_VERTICES})",
        )

    # 3. Canonicalize FIRST — all downstream math uses rounded coordinates.
    # 4a. Dedupe zero-length edges (incl. ones created by rounding).
    open_ring = dedupe_consecutive(canonicalize_ring(raw_open_ring))
    if len(open_ring) < MIN_OPEN_RING_VERTICES:
        raise GeometryError(
            "INVALID_GEOMETRY",
            f"outer ring degenerates to {len(open_ring)} distinct point(s) "
            f"after canonicalization",
        )
    first_vertex = open_ring[0] if len(open_ring) > 0 else None
    if first_vertex is None:
        raise GeometryError(
            "INVALID_GEOMETRY", "outer ring is empty after canonicalization"
        )
    closed_ring: list[Vertex] = [*open_ring, (first_vertex[0], first_vertex[1])]

    # 4b. Self-intersection on the canonical, deduped ring.
    assert_not_self_intersecting(closed_ring)

    # 5. Geodesic area caps.
    area_km2 = turf_area_polygon(closed_ring) / SQUARE_METERS_PER_KM2
    if area_km2 < config.AOI_MIN_KM2:
        raise GeometryError(
            "AREA_TOO_SMALL",
            f"AOI is {_to_fixed(area_km2, 3)} km² (min {config.AOI_MIN_KM2} km²)",
        )
    if area_km2 > config.AOI_MAX_KM2:
        raise GeometryError(
            "AREA_TOO_LARGE",
            f"AOI is {_to_fixed(area_km2, 1)} km² (max {config.AOI_MAX_KM2} km²)",
        )

    # 6. India bbox — every vertex (bbox check only, per plan).
    assert_inside_india_bbox(open_ring)

    # 7. Derived fields.
    return ValidatedAoi(
        ring=closed_ring,
        area_km2=area_km2,
        centroid=compute_centroid(closed_ring),
        bbox=ring_bbox(open_ring),
        is_point_mode=detect_point_mode(open_ring, area_km2),
    )


def canonical_geometry_string(aoi: ValidatedAoi) -> str:
    """Deterministic, whitespace-free JSON of the canonical closed ring — the
    geometry half of the result-cache key (md5 with ANALYSIS_VERSION happens in
    the cache layer).

    ``JSON.stringify(aoi.ring)`` where ring is a list of ``[lon, lat]`` arrays.
    ``js_dumps`` maps integer-valued floats -> int and uses ``(",", ":")``
    separators, matching V8 ``JSON.stringify`` for these coordinate magnitudes.
    """
    return js_dumps(aoi.ring)
