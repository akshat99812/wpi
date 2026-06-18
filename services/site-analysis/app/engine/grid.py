"""grid.py -- Section D (grid infrastructure) of the Wind Site Analysis.

Verbatim port of apps/api/src/services/analysis/grid.ts.

Decodes OpenInfraMap MVT power tiles (OSM-derived) in an expanding ring around
the AOI and reports the nearest substation / transmission line plus EHV
proximity (plan.md §4 Phase 2, §3 contract). Decode semantics are pinned by
VERIFIED.md §4:
  - z10 ONLY (z7 silently drops minor substations and ALL untagged lines).
  - ``power_substation_point`` is the canonical substation layer.
  - ``power_generator`` is NEVER decoded.
  - Tile voltages are ALREADY kV. Multi-voltage arrives as voltage_2/voltage_3
    props (semicolon strings handled defensively too).
  - Missing-voltage features are KEPT with voltageKv null.

Every distance is measured from the AOI CENTROID. Substation distance is the
great-circle ``haversine_km``; line distance is an EQUIRECTANGULAR
point-to-segment projection -- TWO distinct distance engines, deliberately NOT
unified (the .ts keeps both).

The ehvWithin25Km flag AND the min-EHV selection use UNROUNDED distances; only
the reported ``distanceKm`` / ``nearestEhvKm`` are round1. Infinity sentinels
become None via ``math.isfinite``.

ASYNC NOTE: the legacy TS is async (fetch/fs). The Python engine is synchronous;
this port is synchronous too -- ``map_with_concurrency`` is preserved by name but
runs the work SEQUENTIALLY in cover order (order-preserving, behaviourally
identical to the order-preserving async pool).

MVT DECODE: the TS uses ``@mapbox/vector-tile`` + ``pbf``; the Python analogue is
``mapbox_vector_tile.decode`` (decoded with ``y_coord_down=True`` so tile-pixel
coordinates survive un-flipped, exactly the coords ``loadGeometry()`` yields).
``feature.toGeoJSON(x, y, z)`` is then reproduced here as ``project_tile_point``.
"""
from __future__ import annotations

import math
import os
import re
import time
from pathlib import Path
from typing import Optional

import mapbox_vector_tile

from app.config import ANALYSIS_ZOOM
from app.engine.mercator import haversine_km, tile_cover_for_bbox
from app.engine.tiles import TileFetchImpl, _default_fetch_impl

# ── Constants (grid.ts:45-89) ───────────────────────────────────────────────

# Expanding-ring search pads (km) around the AOI bbox (plan §4 Phase 2: start at
# +10 km, expand until hit or the 100 km cap).
GRID_SEARCH_PADS_KM = (10, 25, 50, 100)

# India EHV convention: >=220 kV is extra-high-voltage transmission.
EHV_MIN_KV = 220

# Radius for the ``ehvWithin25Km`` flag (plan §3 contract).
EHV_PROXIMITY_KM = 25

# VERIFIED.md §4: decode at z10 only.
POWER_DECODE_ZOOM = ANALYSIS_ZOOM

POWER_UPSTREAM_BASE = "https://openinframap.org/map/power"
POWER_TILE_TIMEOUT_MS = 5_000
# OSM-derived tiles go stale -- unlike the infinite-TTL GWA cache.
POWER_TILE_TTL_MS = 7 * 24 * 60 * 60 * 1000
POWER_TILE_FETCH_CONCURRENCY = 4
POWER_TILE_USER_AGENT = "wce-analysis"
CACHE_NAMESPACE = "power-mvt"

LINE_LAYER = "power_line"
SUBSTATION_LAYER = "power_substation_point"

GRID_DATA_NOTE = "OSM-derived; may be incomplete"

EARTH_RADIUS_KM = 6371.0088
DEG = math.pi / 180
# Same flat-earth pad factors square_ring_around uses (mercator.ts).
KM_PER_DEG_LAT = 110.574
KM_PER_DEG_LON_EQUATOR = 111.32

# Cache root resolution mirrors tiles.ts. The TS resolves apps/api/.cache/tiles
# from import.meta.dir; the Python port lives under the service's own .cache/tiles
# so a local run never writes outside the repo (same convention as tiles.py).
PROD_CACHE_DIR = "/var/cache/tiles"
_SERVICE_ROOT_DIR = Path(__file__).resolve().parents[2]
DEV_CACHE_DIR = _SERVICE_ROOT_DIR / ".cache" / "tiles"


# ── Public types (grid.ts:91-114) ───────────────────────────────────────────


class PowerLineFeature:
    """One transmission-line feature (LineString/MultiLineString)."""

    __slots__ = ("id", "voltage_kv", "max_voltage_kv", "parts")

    def __init__(
        self,
        id: Optional[int],
        voltage_kv: Optional[float],
        max_voltage_kv: Optional[float],
        parts: list[list[tuple[float, float]]],
    ) -> None:
        # MVT feature id (cross-tile dedupe key); None when the tile omits ids.
        self.id = id
        # Primary ``voltage`` prop -- the value REPORTED as voltageKv.
        self.voltage_kv = voltage_kv
        # max(voltage, voltage_2, voltage_3) -- used ONLY for EHV classification.
        self.max_voltage_kv = max_voltage_kv
        # Line parts as [lon, lat] vertex runs (LineString -> 1 part).
        self.parts = parts


class SubstationFeature:
    __slots__ = ("id", "name", "voltage_kv", "max_voltage_kv", "lon", "lat")

    def __init__(
        self,
        id: Optional[int],
        name: Optional[str],
        voltage_kv: Optional[float],
        max_voltage_kv: Optional[float],
        lon: float,
        lat: float,
    ) -> None:
        self.id = id
        self.name = name
        self.voltage_kv = voltage_kv
        self.max_voltage_kv = max_voltage_kv
        self.lon = lon
        self.lat = lat


# computeGrid result: the GridData contract + the score's grid input
# (nearestEhvKm). Returned as a plain dict mirroring the TS object literal.
GridResult = dict


# ── Voltage parsing (semantics per VERIFIED.md §4) (grid.ts:116-146) ────────


def parse_voltage_kv(raw: object) -> Optional[float]:
    """Parse one voltage prop into kV. Numbers pass through; float-noise strings
    ("110.0000000000000000") parse cleanly; semicolon-joined multi-voltage strings
    ("220;400") take the max. Not finite or <=0 -> None. The FEATURE is always kept
    either way (grid.ts:125-133)."""
    if raw is None or raw == "":
        return None
    parts: list[float] = []
    for part in _js_string(raw).split(";"):
        n = _parse_float(part)
        if math.isfinite(n) and n > 0:
            parts.append(n)
    if len(parts) == 0:
        return None
    return max(parts)


def max_voltage_kv_of(props: dict) -> Optional[float]:
    """Highest voltage across ``voltage``, ``voltage_2``, ``voltage_3`` -- the EHV
    classification value. The primary ``voltage`` is still what gets reported as
    voltageKv in the response (grid.ts:140-146)."""
    candidates = [
        v
        for v in (
            parse_voltage_kv(props.get("voltage")),
            parse_voltage_kv(props.get("voltage_2")),
            parse_voltage_kv(props.get("voltage_3")),
        )
        if v is not None
    ]
    if len(candidates) == 0:
        return None
    return max(candidates)


def _js_string(value: object) -> str:
    """``String(value)`` for the inputs parseVoltageKv sees (numbers / strings).
    A finite float that is integral renders without the ``.0`` suffix, matching
    JS ``String(400)`` === "400" (irrelevant to parse_float, but keeps the
    semicolon split identical for stringified numbers)."""
    if isinstance(value, bool):  # JS String(true) — never a real voltage prop
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _parse_float(text: str) -> float:
    """``Number.parseFloat`` analogue: parse the leading numeric prefix, ignoring
    trailing garbage; NaN when no numeric prefix exists (e.g. "substation")."""
    text = text.lstrip()
    match = _FLOAT_PREFIX.match(text)
    if match is None:
        return math.nan
    try:
        return float(match.group(0))
    except ValueError:
        return math.nan


# JS Number.parseFloat grammar: optional sign, digits with optional fraction, or a
# leading-dot fraction, plus an optional exponent. Leading numeric prefix only.
_FLOAT_PREFIX = re.compile(r"[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?")


# ── Distance helpers (grid.ts:148-193) ──────────────────────────────────────


def point_to_segment_km(
    ref_lat: float,
    ref_lon: float,
    a_lat: float,
    a_lon: float,
    b_lat: float,
    b_lon: float,
) -> float:
    """Point-to-segment distance in km. Projects both endpoints onto a local
    tangent plane about the reference point (equirectangular), clamps the
    projection parameter to the segment, and measures planar distance. Degenerate
    zero-length segments collapse to point distance (grid.ts:157-178)."""
    cos_ref = math.cos(ref_lat * DEG)
    ax = (a_lon - ref_lon) * DEG * cos_ref * EARTH_RADIUS_KM
    ay = (a_lat - ref_lat) * DEG * EARTH_RADIUS_KM
    bx = (b_lon - ref_lon) * DEG * cos_ref * EARTH_RADIUS_KM
    by = (b_lat - ref_lat) * DEG * EARTH_RADIUS_KM
    dx = bx - ax
    dy = by - ay
    seg_len_sq = dx * dx + dy * dy
    t = 0.0 if seg_len_sq == 0 else max(0.0, min(1.0, (-ax * dx - ay * dy) / seg_len_sq))
    cx = ax + t * dx
    cy = ay + t * dy
    return math.sqrt(cx * cx + cy * cy)


def _min_line_distance_km(lat: float, lon: float, line: PowerLineFeature) -> float:
    """Min distance from (lat, lon) to any segment of the line; inf if degenerate
    (grid.ts:181-193)."""
    best = math.inf
    for part in line.parts:
        for i in range(len(part) - 1):
            a = part[i]
            b = part[i + 1]
            if not a or not b:
                continue
            d = point_to_segment_km(lat, lon, a[1], a[0], b[1], b[0])
            if d < best:
                best = d
    return best


# ── Expanding-ring tile-set helpers (pure) (grid.ts:195-230) ────────────────


def pad_bbox_km(
    bbox: tuple[float, float, float, float], pad_km: float
) -> tuple[float, float, float, float]:
    """Bbox grown by ``pad_km`` on every side (flat-earth degrees at the mid-lat)
    (grid.ts:198-207)."""
    west, south, east, north = bbox
    mid_lat = (south + north) / 2
    d_lat = pad_km / KM_PER_DEG_LAT
    d_lon = pad_km / (KM_PER_DEG_LON_EQUATOR * math.cos(mid_lat * DEG))
    return (west - d_lon, south - d_lat, east + d_lon, north + d_lat)


def tile_key(x: int, y: int) -> str:
    return f"{x}/{y}"


def new_tile_coords(
    bbox: tuple[float, float, float, float], z: int, seen: frozenset[str] | set[str]
) -> list[tuple[int, int]]:
    """z-cover of ``bbox`` MINUS tiles already in ``seen`` -- each expansion round
    fetches only its NEW tiles. Pure: never mutates ``seen`` (grid.ts:217-230)."""
    cover = tile_cover_for_bbox(bbox, z)
    coords: list[tuple[int, int]] = []
    for y in range(cover.min_y, cover.max_y + 1):
        for x in range(cover.min_x, cover.max_x + 1):
            if tile_key(x, y) not in seen:
                coords.append((x, y))
    return coords


# ── Disk cache (namespace "power-mvt", 7-day TTL) (grid.ts:232-286) ─────────


def _resolve_tile_cache_dir() -> Path:
    """Same resolution order as tiles.ts: env override -> prod path -> dev path
    (grid.ts:235-239)."""
    from_env = os.environ.get("TILE_CACHE_DIR")
    if from_env:
        return Path(from_env)
    return Path(PROD_CACHE_DIR) if os.environ.get("NODE_ENV") == "production" else DEV_CACHE_DIR


def _power_tile_cache_path(base_dir: Path, x: int, y: int) -> Path:
    return Path(base_dir) / CACHE_NAMESPACE / str(POWER_DECODE_ZOOM) / str(x) / f"{y}.pbf"


class _CachedPowerTile:
    __slots__ = ("bytes", "is_fresh")

    def __init__(self, data: bytes, is_fresh: bool) -> None:
        self.bytes = data
        # Within the 7-day TTL. Stale entries are refetch-then-fallback.
        self.is_fresh = is_fresh


def _read_cached_power_tile(file_path: Path) -> Optional[_CachedPowerTile]:
    """Cached pbf bytes + freshness, or None on a miss. A non-ENOENT read failure
    is logged and treated as a miss (grid.ts:257-270)."""
    file_path = Path(file_path)
    try:
        data = file_path.read_bytes()
        mtime_ms = file_path.stat().st_mtime * 1000
        return _CachedPowerTile(data, (time.time() * 1000) - mtime_ms <= POWER_TILE_TTL_MS)
    except FileNotFoundError:
        return None
    except OSError as err:  # noqa: BLE001 -- mirror the TS catch-all-but-ENOENT
        print(
            "[power-tiles] cache read failed; treating as miss",
            {"filePath": str(file_path), "err": str(err)},
        )
        return None


def _write_cached_power_tile(file_path: Path, data: bytes) -> None:
    """Temp-file + rename (no torn reads); a failed write never fails the analysis
    -- log and continue (grid.ts:274-286)."""
    file_path = Path(file_path)
    try:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = file_path.with_name(
            f"{file_path.name}.tmp-{os.getpid()}-{int(time.time() * 1000)}"
        )
        tmp_path.write_bytes(data)
        tmp_path.replace(file_path)
    except OSError as err:  # noqa: BLE001
        print("[power-tiles] cache write failed", {"filePath": str(file_path), "err": str(err)})


# ── Fetch + decode (grid.ts:288-400) ────────────────────────────────────────


def _fetch_power_tile_bytes(x: int, y: int, fetch_impl: TileFetchImpl) -> bytes:
    """Fetch one power tile from upstream. 404/204 (and empty 200 bodies) return
    zero-length bytes -- the cached "empty tile" marker. Any other failure raises;
    the caller decides whether a stale cached copy can stand in (grid.ts:296-310)."""
    url = f"{POWER_UPSTREAM_BASE}/{POWER_DECODE_ZOOM}/{x}/{y}.pbf"
    res = fetch_impl(url, {"User-Agent": POWER_TILE_USER_AGENT}, POWER_TILE_TIMEOUT_MS)
    if res.status == 404 or res.status == 204:
        return b""
    if not res.ok:
        raise RuntimeError(f"upstream HTTP {res.status} for {url}")
    return res.array_buffer()


def project_tile_point(
    px: float, py: float, extent: int, x: int, y: int, z: int
) -> tuple[float, float]:
    """Reproduce ``@mapbox/vector-tile`` VectorTileFeature.toGeoJSON's projectPoint
    (index.js:165-170): a tile-pixel coordinate (extent-space, y DOWN) -> [lon, lat].

        size = extent * 2**z;  x0 = extent*x;  y0 = extent*y
        lon = (px + x0) * 360 / size - 180
        lat = 360/π * atan(exp((1 - (py + y0)*2/size)*π)) - 90
    """
    size = extent * (2**z)
    x0 = extent * x
    y0 = extent * y
    lon = (px + x0) * 360 / size - 180
    lat = 360 / math.pi * math.atan(math.exp((1 - (py + y0) * 2 / size) * math.pi)) - 90
    return (lon, lat)


def _geometry_line_parts(
    geometry: dict, extent: int, x: int, y: int
) -> list[list[tuple[float, float]]]:
    """LineString -> 1 part; MultiLineString -> N parts; else [] (grid.ts:314-322).
    Each raw tile-pixel vertex is projected to [lon, lat]."""
    gtype = geometry["type"]
    if gtype == "LineString":
        return [_project_line(geometry["coordinates"], extent, x, y)]
    if gtype == "MultiLineString":
        return [_project_line(line, extent, x, y) for line in geometry["coordinates"]]
    return []


def _geometry_point(
    geometry: dict, extent: int, x: int, y: int
) -> Optional[tuple[float, float]]:
    """Point -> projected [lon, lat]; MultiPoint -> first vertex (or None); else
    None (grid.ts:324-330)."""
    gtype = geometry["type"]
    if gtype == "Point":
        c = geometry["coordinates"]
        return project_tile_point(c[0], c[1], extent, x, y, POWER_DECODE_ZOOM)
    if gtype == "MultiPoint":
        coords = geometry["coordinates"]
        if len(coords) == 0:
            return None
        c = coords[0]
        return project_tile_point(c[0], c[1], extent, x, y, POWER_DECODE_ZOOM)
    return None


def _project_line(
    line: list, extent: int, x: int, y: int
) -> list[tuple[float, float]]:
    return [project_tile_point(p[0], p[1], extent, x, y, POWER_DECODE_ZOOM) for p in line]


def _feature_id(feature: dict) -> Optional[int]:
    """The MVT feature id, or None when the tile omits ids (grid.ts: ``typeof
    feature.id === "number" ? feature.id : null``)."""
    fid = feature.get("id")
    return fid if isinstance(fid, int) and not isinstance(fid, bool) else None


def _extract_lines(layer: dict, x: int, y: int) -> list[PowerLineFeature]:
    """grid.ts:332-349."""
    extent = layer["extent"]
    lines: list[PowerLineFeature] = []
    for feature in layer["features"]:
        geometry = feature["geometry"]
        parts = _geometry_line_parts(geometry, extent, x, y)
        if len(parts) == 0:
            continue
        props = feature["properties"]
        lines.append(
            PowerLineFeature(
                id=_feature_id(feature),
                voltage_kv=parse_voltage_kv(props.get("voltage")),
                max_voltage_kv=max_voltage_kv_of(props),
                parts=parts,
            )
        )
    return lines


def _extract_substations(layer: dict, x: int, y: int) -> list[SubstationFeature]:
    """grid.ts:351-374."""
    extent = layer["extent"]
    substations: list[SubstationFeature] = []
    for feature in layer["features"]:
        geometry = feature["geometry"]
        point = _geometry_point(geometry, extent, x, y)
        if point is None:
            continue
        props = feature["properties"]
        name_prop = props.get("name")
        name = name_prop if isinstance(name_prop, str) and len(name_prop) > 0 else None
        substations.append(
            SubstationFeature(
                id=_feature_id(feature),
                name=name,
                voltage_kv=parse_voltage_kv(props.get("voltage")),
                max_voltage_kv=max_voltage_kv_of(props),
                lon=point[0],
                lat=point[1],
            )
        )
    return substations


class _DecodedPowerTile:
    __slots__ = ("lines", "substations")

    def __init__(
        self, lines: list[PowerLineFeature], substations: list[SubstationFeature]
    ) -> None:
        self.lines = lines
        self.substations = substations


def _decode_power_tile(data: bytes, x: int, y: int) -> Optional[_DecodedPowerTile]:
    """Zero-length bytes = the cached empty marker. Decode failures -> None (never
    raises -- one bad tile must never fail the section) (grid.ts:383-400).

    ``mapbox_vector_tile.decode(..., y_coord_down=True)`` keeps tile-pixel coords
    un-flipped (matching @mapbox/vector-tile's loadGeometry); per-layer extent and
    feature geometry are then projected in _extract_* via project_tile_point."""
    if len(data) == 0:
        return _DecodedPowerTile([], [])
    try:
        decoded = mapbox_vector_tile.decode(data, default_options={"y_coord_down": True})
        line_layer = decoded.get(LINE_LAYER)
        sub_layer = decoded.get(SUBSTATION_LAYER)
        return _DecodedPowerTile(
            lines=_extract_lines(line_layer, x, y) if line_layer else [],
            substations=_extract_substations(sub_layer, x, y) if sub_layer else [],
        )
    except Exception as err:  # noqa: BLE001 -- mirror the TS catch-all
        print(
            "[power-tiles] tile decode failed",
            {"tile": f"{POWER_DECODE_ZOOM}/{x}/{y}", "err": str(err)},
        )
        return None


class _TileLoadResult:
    __slots__ = ("ok", "decoded")

    def __init__(self, ok: bool, decoded: Optional[_DecodedPowerTile]) -> None:
        self.ok = ok
        self.decoded = decoded


def _load_power_tile(x: int, y: int, fetch_impl: TileFetchImpl) -> _TileLoadResult:
    """One tile through the cache: fresh cache wins; TTL miss refetches; on upstream
    failure a stale cached copy is served; otherwise the tile is skipped with a
    warning (ok=False). Never raises (grid.ts:409-447)."""
    file_path = _power_tile_cache_path(_resolve_tile_cache_dir(), x, y)
    cached = _read_cached_power_tile(file_path)
    if cached is not None and cached.is_fresh:
        decoded = _decode_power_tile(cached.bytes, x, y)
        if decoded is not None:
            return _TileLoadResult(True, decoded)
        print("[power-tiles] fresh cached tile corrupt; refetching", {"filePath": str(file_path)})
    fetched_bytes: Optional[bytes] = None
    try:
        fetched_bytes = _fetch_power_tile_bytes(x, y, fetch_impl)
    except Exception as err:  # noqa: BLE001 -- mirror the TS try/catch around fetch
        print(
            "[power-tiles] upstream fetch failed",
            {"tile": f"{POWER_DECODE_ZOOM}/{x}/{y}", "err": str(err)},
        )
    if fetched_bytes is not None:
        decoded = _decode_power_tile(fetched_bytes, x, y)
        if decoded is not None:
            _write_cached_power_tile(file_path, fetched_bytes)
            return _TileLoadResult(True, decoded)
    if cached is not None:
        decoded = _decode_power_tile(cached.bytes, x, y)
        if decoded is not None:
            print(
                "[power-tiles] serving stale cached tile after upstream failure",
                {"filePath": str(file_path)},
            )
            return _TileLoadResult(True, decoded)
    return _TileLoadResult(False, None)


# ── Cross-tile feature accumulation (grid.ts:449-498) ───────────────────────


class _FeatureAccumulator:
    __slots__ = ("lines_by_id", "loose_lines", "subs_by_id", "loose_subs")

    def __init__(self) -> None:
        self.lines_by_id: dict[int, PowerLineFeature] = {}
        self.loose_lines: list[PowerLineFeature] = []
        self.subs_by_id: dict[int, SubstationFeature] = {}
        self.loose_subs: list[SubstationFeature] = []


def _new_accumulator() -> _FeatureAccumulator:
    return _FeatureAccumulator()


def _accumulate_tile(acc: _FeatureAccumulator, decoded: _DecodedPowerTile) -> None:
    """Dedupe across tiles by MVT feature id (grid.ts:471-490):
      - lines: the same id in adjacent tiles carries DIFFERENT clipped geometry,
        so parts are UNIONED. The merge builds a NEW object -- never mutates a
        stored feature.
      - substations: identical point in every tile -> first wins.
      - id-less features are kept as-is (consumers are min()/any(), idempotent)."""
    for line in decoded.lines:
        if line.id is None:
            acc.loose_lines.append(line)
            continue
        existing = acc.lines_by_id.get(line.id)
        acc.lines_by_id[line.id] = (
            PowerLineFeature(
                id=existing.id,
                voltage_kv=existing.voltage_kv,
                max_voltage_kv=existing.max_voltage_kv,
                parts=[*existing.parts, *line.parts],
            )
            if existing is not None
            else line
        )
    for sub in decoded.substations:
        if sub.id is None:
            acc.loose_subs.append(sub)
            continue
        if sub.id not in acc.subs_by_id:
            acc.subs_by_id[sub.id] = sub


def _all_lines(acc: _FeatureAccumulator) -> list[PowerLineFeature]:
    return [*acc.lines_by_id.values(), *acc.loose_lines]


def _all_substations(acc: _FeatureAccumulator) -> list[SubstationFeature]:
    return [*acc.subs_by_id.values(), *acc.loose_subs]


# ── Summary (pure) (grid.ts:500-581) ────────────────────────────────────────


def _round1(value: float) -> float:
    """grid.ts:502-504 — local Math.round(v*10)/10. Kept inline (the foundation's
    numeric.round1 is identical; this preserves the line-for-line grid decode)."""
    return js_round_local(value * 10) / 10


def js_round_local(x: float) -> int:
    """``Math.round`` for finite x: half toward +inf (numeric.js_round semantics).
    Inlined to keep _round1 a faithful copy of grid.ts:502-504."""
    floor = math.floor(x)
    return floor if (x - floor) < 0.5 else floor + 1


def _index_of_min(values: list[float]) -> int:
    """Index of the smallest finite value; -1 when none (empty / all inf)
    (grid.ts:507-518)."""
    best_index = -1
    best = math.inf
    for i in range(len(values)):
        v = values[i]
        if v is not None and v < best:
            best = v
            best_index = i
    return best_index


def _is_ehv(max_kv: Optional[float]) -> bool:
    return max_kv is not None and max_kv >= EHV_MIN_KV


def _nearest_ehv_distance_km(
    lines: list[PowerLineFeature],
    line_distances: list[float],
    substations: list[SubstationFeature],
    sub_distances: list[float],
) -> Optional[float]:
    """Unrounded distance to the nearest >=EHV_MIN_KV feature; None if none
    (grid.ts:525-541)."""
    best = math.inf
    for i, line in enumerate(lines):
        d = line_distances[i]
        if _is_ehv(line.max_voltage_kv) and d is not None and d < best:
            best = d
    for i, sub in enumerate(substations):
        d = sub_distances[i]
        if _is_ehv(sub.max_voltage_kv) and d is not None and d < best:
            best = d
    return best if math.isfinite(best) else None


def summarize_grid_features(
    centroid: tuple[float, float],
    lines: list[PowerLineFeature],
    substations: list[SubstationFeature],
) -> GridResult:
    """Pure reduction of the accumulated features to the GridData contract. Reported
    distances are rounded to 1 dp; the ehvWithin25Km flag and the EHV minimum are
    decided on UNROUNDED distances. EHV classification uses maxVoltageKv; the
    REPORTED voltageKv stays the primary ``voltage`` prop (grid.ts:550-581)."""
    lon, lat = centroid
    sub_distances = [haversine_km(lat, lon, s.lat, s.lon) for s in substations]
    line_distances = [_min_line_distance_km(lat, lon, l) for l in lines]
    sub_index = _index_of_min(sub_distances)
    line_index = _index_of_min(line_distances)
    nearest_sub = substations[sub_index] if sub_index >= 0 else None
    nearest_ln = lines[line_index] if line_index >= 0 else None
    ehv_km = _nearest_ehv_distance_km(lines, line_distances, substations, sub_distances)
    return {
        "nearestSubstation": (
            {
                "name": nearest_sub.name,
                "voltageKv": nearest_sub.voltage_kv,
                "distanceKm": _round1(sub_distances[sub_index]),
            }
            if nearest_sub is not None
            else None
        ),
        "nearestLine": (
            {
                "voltageKv": nearest_ln.voltage_kv,
                "distanceKm": _round1(line_distances[line_index]),
            }
            if nearest_ln is not None
            else None
        ),
        "ehvWithin25Km": ehv_km is not None and ehv_km <= EHV_PROXIMITY_KM,
        "nearestEhvKm": None if ehv_km is None else _round1(ehv_km),
        "dataNote": GRID_DATA_NOTE,
    }


# ── Orchestration (grid.ts:583-650) ─────────────────────────────────────────


def map_with_concurrency(items, limit, fn):
    """Run ``fn`` over ``items`` order-preserving. Synchronous port of the
    order-preserving async pool (grid.ts:587-604): the work runs sequentially in
    input order -- exactly the order the async version writes its results array in.
    ``limit`` is accepted for trace parity."""
    results = [None] * len(items)
    for i in range(len(items)):
        results[i] = fn(items[i])
    return results


def compute_grid(aoi, fetch_impl: Optional[TileFetchImpl] = None) -> GridResult:
    """Section D entry point: expanding-ring power-tile search around the AOI.

    Each round pads the AOI bbox (10 -> 25 -> 50 -> 100 km), fetches only the tiles
    NOT already seen, and stops at the first round after which at least one line AND
    one substation have been accumulated -- or at the 100 km cap, returning whatever
    was found (fields null when truly nothing).

    Error contract: a failed tile is skipped with a warning; the ONLY raising path
    is the first ring failing entirely (no fetchable tile, no cached copy), which
    the section layer maps to status "unavailable" (grid.ts:620-650)."""
    impl = fetch_impl if fetch_impl is not None else _default_fetch_impl
    acc = _new_accumulator()
    seen: set[str] = set()
    for round_index, pad_km in enumerate(GRID_SEARCH_PADS_KM):
        coords = new_tile_coords(pad_bbox_km(aoi.bbox, pad_km), POWER_DECODE_ZOOM, seen)
        for c in coords:
            seen.add(tile_key(c[0], c[1]))
        results = map_with_concurrency(
            coords,
            POWER_TILE_FETCH_CONCURRENCY,
            lambda c: _load_power_tile(c[0], c[1], impl),
        )
        ok_count = 0
        for result in results:
            if not result.ok:
                continue
            ok_count += 1
            _accumulate_tile(acc, result.decoded)
        if round_index == 0 and ok_count == 0 and len(coords) > 0:
            raise RuntimeError(
                f"grid: first search ring ({pad_km} km pad, {len(coords)} power tiles) "
                "failed entirely with no cached fallback"
            )
        if len(_all_lines(acc)) > 0 and len(_all_substations(acc)) > 0:
            break
    return summarize_grid_features(aoi.centroid, _all_lines(acc), _all_substations(acc))
