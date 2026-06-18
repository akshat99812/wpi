"""context.py — Section E (site context & sizing) of the Wind Site Analysis.

Verbatim port of apps/api/src/services/analysis/context.ts. Sub-results:

states        — which states the AOI touches (centroid + ring vertices vs the
                India states GeoJSON; screening-grade point SAMPLING, not true
                intersection) joined to StateCapacity numbers.
windfarms     — proprietary farm boundaries rasterized onto the SAME z10 pixel
                grid as the AOI mask (reuses build_aoi_mask), so overlapFraction
                needs no polygon-clipping dependency.
terrain       — elevation stats + per-pixel slope (central differences on the
                elevation patch; ground pixel size derived per row from the
                web-mercator scale at that latitude).
sizing        — plan §2.5 EXACT: usable = area × (1 − overlap) × 0.7;
                capacity = usable × 5 MW/km²; energy = MW × 8.76 × cfIec3.

Degradation rules: DB down → states keep null capacity numbers; farms file absent
→ {count: 0, overlapFraction: 0} (warn); states GeoJSON undownloadable → []
(warn); all-NaN elevation → terrain null.

The shared scalar helpers (js_round / round1) and the AOI mask builder
(build_aoi_mask) live in the foundation (numeric.py / mask.py) and are IMPORTED,
not redefined. The pure helpers below keep the legacy names so the .py diffs
line-for-line against the .ts.
"""
from __future__ import annotations

import json
import logging
import math
from typing import Callable, Optional

import numpy as np

from app.config import (
    FARMS_GEOJSON_PATH,
    SIZING_ASSUMPTIONS,
    SIZING_MW_PER_KM2,
    SIZING_USABLE_LAND_FRACTION,
    STATES_GEOJSON_PATH,
)
from app.engine.mask import PatchFrame, build_aoi_mask
from app.engine.mercator import patch_pixel_center_lng_lat
from app.engine.numeric import js_round, round1
from app.engine.types import AoiMask, LayerPatch, ValidatedAoi

logger = logging.getLogger(__name__)

# ── Constants (context.ts:50-57) ────────────────────────────────────────────

# Web-mercator ground resolution at the equator, z0, meters per pixel.
MERCATOR_M_PER_PX_Z0 = 156_543.033_92
DEG = math.pi / 180

# MW × 8.76 × CF = GWh/yr (8,760 h / 1,000).
HOURS_PER_YEAR_OVER_1000 = 8.76

SLOPE_90TH_QUANTILE = 0.9


# ── Pure helpers (exported for tests) ───────────────────────────────────────


def point_in_geometry(lon: float, lat: float, geometry: dict) -> bool:
    """Even-odd ray cast over Polygon/MultiPolygon rings (holes handled by
    even-odd parity). (context.ts:106-130)"""
    if geometry["type"] == "Polygon":
        polygons = [geometry["coordinates"]]
    else:
        polygons = geometry["coordinates"]
    inside = False
    for rings in polygons:
        for ring in rings:
            n = len(ring)
            j = n - 1
            for i in range(n):
                xi = _ring_component(ring, i, 0)
                yi = _ring_component(ring, i, 1)
                xj = _ring_component(ring, j, 0)
                yj = _ring_component(ring, j, 1)
                if (yi > lat) != (yj > lat) and lon < (
                    (xj - xi) * (lat - yi)
                ) / (yj - yi) + xi:
                    inside = not inside
                j = i
    return inside


def _ring_component(ring, i: int, axis: int) -> float:
    """``ring[i]?.[axis] ?? Number.NaN`` — JS optional-chain + nullish fallback."""
    vertex = ring[i] if 0 <= i < len(ring) else None
    if vertex is None or axis >= len(vertex):
        return math.nan
    value = vertex[axis]
    return math.nan if value is None else value


def states_for_aoi(aoi, states: dict) -> list[str]:
    """State names (ST_NM) hit by the AOI centroid or any ring vertex.
    (context.ts:133-148)

    ``aoi`` carries ``ring`` and ``centroid`` (Pick<ValidatedAoi, ...>)."""
    samples = [aoi["centroid"], *aoi["ring"]]
    hits: set[str] = set()
    for feature in states["features"]:
        props = feature.get("properties")
        name = props.get("ST_NM") if props else None
        geometry = feature.get("geometry")
        if not name or not geometry:
            continue
        if any(point_in_geometry(lon, lat, geometry) for lon, lat in samples):
            hits.add(name)
    return sorted(hits)


def join_state_capacities(names, rows) -> list[dict]:
    """Join sampled state names to capacity rows (null rows → null numbers).
    (context.ts:151-167)"""
    by_state = {r["state"]: r for r in (rows if rows is not None else [])}
    joined = []
    for name in names:
        row = by_state.get(name)
        if row is None and rows is not None:
            logger.warning('[context] no StateCapacity row for state "%s"', name)
        joined.append(
            {
                "name": name,
                "installedMw": row["installedMw"] if row else None,
                "potentialMw": row["potentialMw"] if row else None,
            }
        )
    return joined


def farm_overlap(
    aoi, farms: dict, frame: PatchFrame, aoi_mask: AoiMask
) -> dict:
    """Farm count + overlap fraction by rasterizing each candidate farm's rings
    onto the AOI's own patch grid. A farm counts when it shares >=1 pixel with
    the AOI mask; overlapFraction = |union of farm pixels ∩ AOI| / |AOI|.
    (context.ts:174-221)

    ``aoi`` carries ``bbox`` (Pick<ValidatedAoi, "bbox">)."""
    total_pixels = aoi_mask.width_px * aoi_mask.height_px
    union = np.zeros(total_pixels, dtype=np.uint8)
    count = 0

    for feature in farms["features"]:
        geometry = feature.get("geometry")
        if not geometry:
            continue
        if geometry["type"] == "Polygon":
            coords = geometry["coordinates"]
            outer_rings = [coords[0] if len(coords) > 0 else []]
        else:
            outer_rings = [
                poly[0] if len(poly) > 0 else [] for poly in geometry["coordinates"]
            ]

        farm_touches_aoi = False
        for outer in outer_rings:
            if len(outer) < 4 or not _ring_bbox_intersects(outer, aoi["bbox"]):
                continue
            try:
                farm_mask = build_aoi_mask(outer, frame)
            except Exception as err:  # noqa: BLE001 — mirror the TS catch-all
                logger.warning(
                    "[context] skipping malformed farm ring %s", str(err)
                )
                continue
            for i in range(total_pixels):
                if farm_mask.inside[i] == 1 and aoi_mask.inside[i] == 1:
                    farm_touches_aoi = True
                    union[i] = 1
        if farm_touches_aoi:
            count += 1

    overlap_pixels = 0
    for i in range(total_pixels):
        if union[i] == 1:
            overlap_pixels += 1
    overlap_fraction = (
        0
        if aoi_mask.inside_count == 0
        else js_round((overlap_pixels / aoi_mask.inside_count) * 10_000) / 10_000
    )
    return {"count": count, "overlapFraction": overlap_fraction}


def _ring_bbox_intersects(ring, bbox) -> bool:
    """context.ts:223-241 ringBboxIntersects."""
    west = math.inf
    south = math.inf
    east = -math.inf
    north = -math.inf
    for v in ring:
        lon = v[0] if v is not None and len(v) > 0 else None
        lat = v[1] if v is not None and len(v) > 1 else None
        if not _is_number(lon) or not _is_number(lat):
            continue
        if lon < west:
            west = lon
        if lon > east:
            east = lon
        if lat < south:
            south = lat
        if lat > north:
            north = lat
    return west <= bbox[2] and east >= bbox[0] and south <= bbox[3] and north >= bbox[1]


def _is_number(value: object) -> bool:
    """JS ``typeof v === "number"`` — finite OR non-finite, but not bool/None."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def terrain_stats(elevation: LayerPatch, mask: AoiMask) -> dict:
    """Elevation stats + slope over in-mask pixels. Slope uses central
    differences; a pixel needs all four finite neighbors (edge / nodata-adjacent
    pixels are skipped). Ground pixel size is identical in x and y at a given
    latitude: dx = dy = 156543.03392 · cos(lat) / 2^zoom meters, per row.
    (context.ts:250-316)

    Returns ``{"terrain": ContextData["terrain"] | None, "slope90thDeg": float | None}``.
    """
    width_px = elevation.width_px
    height_px = elevation.height_px
    data = elevation.data
    elevations: list[float] = []
    slopes: list[float] = []

    for row in range(height_px):
        row_lat = patch_pixel_center_lng_lat(
            elevation.min_tile_x,
            elevation.min_tile_y,
            0,
            row,
            elevation.zoom,
        )[1]
        pixel_meters = (
            MERCATOR_M_PER_PX_Z0 * math.cos(row_lat * DEG)
        ) / 2**elevation.zoom

        for col in range(width_px):
            i = row * width_px + col
            if mask.inside[i] != 1:
                continue
            center = _patch_value(data, i)
            if center is None or not math.isfinite(center):
                continue
            elevations.append(center)

            if col < 1 or col >= width_px - 1 or row < 1 or row >= height_px - 1:
                continue
            west = _patch_value(data, i - 1)
            east = _patch_value(data, i + 1)
            north = _patch_value(data, i - width_px)
            south = _patch_value(data, i + width_px)
            if (
                west is None
                or east is None
                or north is None
                or south is None
                or not math.isfinite(west)
                or not math.isfinite(east)
                or not math.isfinite(north)
                or not math.isfinite(south)
            ):
                continue
            dzdx = (east - west) / (2 * pixel_meters)
            dzdy = (south - north) / (2 * pixel_meters)
            slopes.append(math.atan(math.hypot(dzdx, dzdy)) * (180 / math.pi))

    if len(elevations) == 0:
        logger.warning("[context] elevation layer empty in-mask; terrain unavailable")
        return {"terrain": None, "slope90thDeg": None}

    sorted_slopes = sorted(slopes)
    slope90th = (
        None if len(sorted_slopes) == 0 else quantile_sorted(sorted_slopes, SLOPE_90TH_QUANTILE)
    )
    mean_slope = (
        0 if len(slopes) == 0 else _sequential_sum(slopes) / len(slopes)
    )

    return {
        "terrain": {
            "elevMean": js_round(_sequential_sum(elevations) / len(elevations)),
            "elevMin": js_round(min(elevations)),
            "elevMax": js_round(max(elevations)),
            "slopeMeanDeg": round1(mean_slope),
            "slopeSteep10Deg": 0 if slope90th is None else round1(slope90th),
        },
        "slope90thDeg": None if slope90th is None else round1(slope90th),
    }


def _patch_value(data, i: int) -> Optional[float]:
    """``data[i]`` widened to float64, or ``None`` when out of range (the JS
    ``Float32Array`` index returns ``undefined`` past the end)."""
    if 0 <= i < len(data):
        return float(data[i])
    return None


def _sequential_sum(values) -> float:
    """``values.reduce((a, b) => a + b, 0)`` — sequential float64 accumulation."""
    total = 0.0
    for value in values:
        total += value
    return total


def quantile_sorted(sorted_values, q: float) -> float:
    """Linear interpolated quantile over an ASCENDING-sorted array, with the
    legacy ``?? 0`` / ``?? loV`` fallbacks. (context.ts:318-325)"""
    pos = q * (len(sorted_values) - 1)
    lo = math.floor(pos)
    hi = min(lo + 1, len(sorted_values) - 1)
    lo_v = sorted_values[lo] if 0 <= lo < len(sorted_values) else 0
    hi_v = sorted_values[hi] if 0 <= hi < len(sorted_values) else lo_v
    return lo_v + (hi_v - lo_v) * (pos - lo)


def compute_sizing(
    area_km2: float, overlap_fraction: float, cf_iec3: Optional[float]
) -> dict:
    """Plan §2.5, verbatim formulas. cfIec3 null → 0 GWh (no CF, no energy).
    (context.ts:328-338)"""
    usable_km2 = area_km2 * (1 - overlap_fraction) * SIZING_USABLE_LAND_FRACTION
    capacity_mw = js_round(usable_km2 * SIZING_MW_PER_KM2 * 10) / 10
    energy_gwh = (
        js_round(capacity_mw * HOURS_PER_YEAR_OVER_1000 * (cf_iec3 if cf_iec3 is not None else 0) * 10)
        / 10
    )
    return {
        "capacityMw": capacity_mw,
        "energyGwh": energy_gwh,
        "assumptions": list(SIZING_ASSUMPTIONS),
    }


# ── Default loaders (disk / DB) ──────────────────────────────────────────────

_states_geo_cache: Optional[dict] = None
_states_geo_loaded = False


def load_states_geo_default() -> Optional[dict]:
    """Read the committed states GeoJSON (ST_NM) from config.STATES_GEOJSON_PATH.

    The TS default also network-fetches + caches on a miss; in the ported service
    the cache file is the committed artifact under ANALYSIS_DATA_DIR, so we read
    it (and degrade to None on any failure, like the TS catch). (context.ts:344-368)
    """
    global _states_geo_cache, _states_geo_loaded
    if _states_geo_loaded:
        return _states_geo_cache
    try:
        with open(STATES_GEOJSON_PATH, "r", encoding="utf-8") as fh:
            parsed = json.load(fh)
        if not isinstance(parsed.get("features"), list):
            raise ValueError("not a FeatureCollection")
        _states_geo_cache = parsed
    except Exception as err:  # noqa: BLE001 — mirror the TS catch-all
        logger.warning("[context] states geojson unavailable: %s", str(err))
        _states_geo_cache = None
    _states_geo_loaded = True
    return _states_geo_cache


# Mirror of the web app's STATE_DATA — used when the StateCapacity table is
# absent (local dev DB carries only PostGIS + windmills) or empty. installedMw =
# MNRE installed base; potentialMw = NIWE @120 m, in MW. (context.ts:376-386)
STATE_CAPACITY_FALLBACK: list[dict] = [
    {"state": "Gujarat", "installedMw": 12677, "potentialMw": 180800},
    {"state": "Tamil Nadu", "installedMw": 11740, "potentialMw": 95100},
    {"state": "Karnataka", "installedMw": 7351, "potentialMw": 169300},
    {"state": "Maharashtra", "installedMw": 5285, "potentialMw": 173900},
    {"state": "Rajasthan", "installedMw": 5209, "potentialMw": 284200},
    {"state": "Andhra Pradesh", "installedMw": 4377, "potentialMw": 123300},
    {"state": "Madhya Pradesh", "installedMw": 3195, "potentialMw": 55400},
    {"state": "Telangana", "installedMw": 128, "potentialMw": 54700},
    {"state": "Kerala", "installedMw": 71, "potentialMw": 3000},
]


def load_capacity_rows_default(
    db_available: Optional[Callable[[], bool]] = None,
    query_state_capacity: Optional[Callable[[], list[dict]]] = None,
) -> Optional[list[dict]]:
    """StateCapacity rows, falling back to the hardcoded STATE_DATA table when the
    DB is absent/empty/erroring — that IS the dev path. (context.ts:388-419)

    The DB seam is injected so the ported tests stay offline. ``db_available``
    defaults to ``app.db.db_available``; ``query_state_capacity`` returns rows of
    ``{state, installedMw, potentialMw120m, potentialMw150m}``.
    """
    if db_available is None:
        from app.db import db_available as _db_available

        db_available = _db_available

    if not db_available():
        logger.warning("[context] DB unavailable; using STATE_DATA fallback capacities")
        return list(STATE_CAPACITY_FALLBACK)
    try:
        rows = query_state_capacity() if query_state_capacity else _query_state_capacity()
        if len(rows) == 0:
            logger.warning(
                "[context] StateCapacity table empty; using STATE_DATA fallback"
            )
            return list(STATE_CAPACITY_FALLBACK)
        return [
            {
                "state": r["state"],
                "installedMw": _to_finite(r["installedMw"]),
                # NIWE @120 m is the standard reference; 150 m only as fallback.
                "potentialMw": _to_finite(r["potentialMw120m"])
                if _to_finite(r["potentialMw120m"]) is not None
                else _to_finite(r["potentialMw150m"]),
            }
            for r in rows
        ]
    except Exception as err:  # noqa: BLE001 — mirror the TS catch-all
        logger.warning(
            "[context] StateCapacity query failed; using STATE_DATA fallback: %s",
            str(err),
        )
        return list(STATE_CAPACITY_FALLBACK)


def _query_state_capacity() -> list[dict]:
    """Default PostGIS read of the StateCapacity table (live-DB path)."""
    from app.db import get_pool

    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                'SELECT state, "installedMw", "potentialMw120m", "potentialMw150m" '
                'FROM "StateCapacity"'
            )
            columns = [d[0] for d in cur.description]
            return [dict(zip(columns, record)) for record in cur.fetchall()]


def _to_finite(v) -> Optional[float]:
    """context.ts:421-425 toFinite — null/NaN passthrough to None."""
    if v is None:
        return None
    n = v if isinstance(v, (int, float)) and not isinstance(v, bool) else _parse_float(v)
    return n if n is not None and math.isfinite(n) else None


def _parse_float(v) -> Optional[float]:
    """JS ``Number.parseFloat`` — leading-numeric parse, NaN on failure → None."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


_farms_geo_cache: Optional[dict] = None
_farms_geo_loaded = False


def load_farms_geo_default() -> Optional[dict]:
    """Read the proprietary farm boundaries from config.FARMS_GEOJSON_PATH,
    degrading to None on any failure (windfarms → 0). (context.ts:429-445)"""
    global _farms_geo_cache, _farms_geo_loaded
    if _farms_geo_loaded:
        return _farms_geo_cache
    try:
        with open(FARMS_GEOJSON_PATH, "r", encoding="utf-8") as fh:
            parsed = json.load(fh)
        if not isinstance(parsed.get("features"), list):
            raise ValueError("not a FeatureCollection")
        _farms_geo_cache = parsed
    except Exception as err:  # noqa: BLE001 — mirror the TS catch-all
        logger.warning(
            "[context] farm boundaries unavailable (windfarms degrade to 0): %s",
            str(err),
        )
        _farms_geo_cache = None
    _farms_geo_loaded = True
    return _farms_geo_cache


def reset_context_caches_for_testing() -> None:
    """Test hook: drop the module-level lazy caches. (context.ts:448-451)"""
    global _states_geo_cache, _states_geo_loaded, _farms_geo_cache, _farms_geo_loaded
    _states_geo_cache = None
    _states_geo_loaded = False
    _farms_geo_cache = None
    _farms_geo_loaded = False


# ── Entry point (context.ts:455-486) ────────────────────────────────────────


def compute_context(
    aoi: ValidatedAoi,
    inputs: dict,
    deps: Optional[dict] = None,
) -> dict:
    """Assemble Section E. ``inputs`` carries ``elevation`` (LayerPatch),
    ``aoiMask`` (AoiMask) and ``cfIec3`` (float | None). ``deps`` may inject
    ``loadStatesGeo`` / ``loadCapacityRows`` / ``loadFarmsGeo`` callables so the
    module never touches network/DB/disk in tests.

    Returns ContextData + ``slope90thDeg`` (score-only extra).
    """
    deps = deps or {}
    load_states = deps.get("loadStatesGeo") or load_states_geo_default
    load_capacity = deps.get("loadCapacityRows") or load_capacity_rows_default
    load_farms = deps.get("loadFarmsGeo") or load_farms_geo_default

    states_geo = load_states()
    capacity_rows = load_capacity()
    farms_geo = load_farms()

    aoi_sample = {"ring": aoi.ring, "centroid": aoi.centroid}
    state_names = states_for_aoi(aoi_sample, states_geo) if states_geo else []
    if not states_geo:
        logger.warning("[context] states list degraded to []")

    windfarms = (
        farm_overlap(
            {"bbox": aoi.bbox}, farms_geo, inputs["elevation"], inputs["aoiMask"]
        )
        if farms_geo
        else {"count": 0, "overlapFraction": 0}
    )

    terrain_result = terrain_stats(inputs["elevation"], inputs["aoiMask"])
    terrain = terrain_result["terrain"]
    slope90th_deg = terrain_result["slope90thDeg"]

    return {
        "states": join_state_capacities(state_names, capacity_rows),
        "windfarms": windfarms,
        "terrain": terrain,
        "sizing": compute_sizing(
            aoi.area_km2, windfarms["overlapFraction"], inputs["cfIec3"]
        ),
        "slope90thDeg": slope90th_deg,
    }
