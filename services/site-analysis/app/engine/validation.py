"""Section C — mast validation against WRA met masts (plan §2.3, Phase 2).

Verbatim port of apps/api/src/services/analysis/validation.ts.

Delta methodology (EXACT per plan §2.3; hard rules in plan §6):
  - The GWA model speed is sampled AT THE MAST'S OWN COORDINATES
    (ws_mean_hgt100m, one pixel through the shared disk cache in tiles.py).
    NEVER compared against the AOI-average GWA speed.
  - The 100 m value is shear-adjusted to the mast's measurement height with the
    AOI's α:  v_mastH = v100 · (mastH / 100)^α.
  - modelDeltaPct = ((mast.maws_ms − v_mastH) / v_mastH) · 100, 1 dp. Sign
    convention: POSITIVE = measurement above model (model runs low); negative =
    model runs high.
  - Delta is SUPPRESSED (None) when the nearest mast is farther than
    MAST_DELTA_MAX_KM (25 km). Suppression compares the UNROUNDED distance.
  - GWA pixel nodata/missing at the mast coords → delta None (warn logged).

nearestMast vs delta suppression (documented decision):
  nearestMast is returned whenever a delta-eligible mast exists within
  MAST_NEAREST_SEARCH_KM (100 km) of the AOI centroid — useful context beyond
  25 km; only the DELTA is suppressed past 25 km. Beyond 100 km nearestMast is
  None.

Candidate filtering (documented decision):
  Masts with NULL maws_ms or NULL/0 mast_height_m cannot produce a delta, so
  they are excluded from nearest-mast candidacy AND from the 20/25 km confidence
  counts. They DO count in mastCountInAoi.

Confidence badge (plan §2.3): high = ≥MAST_CONFIDENCE_HIGH_COUNT delta-eligible
masts within MAST_CONFIDENCE_HIGH_KM of the centroid · medium = ≥1 within
MAST_DELTA_MAX_KM (25 km) · low = none within 25 km.

DEPENDENCY-INJECTION SEAMS (RUNBOOK parity rule):
  - ``fetch_impl``: the GWA tile fetch seam (passed straight through to
    app.engine.tiles.fetch_point_value). Tests inject a synthetic point fetch.
  - ``query_counts`` / ``query_nearest``: the two PostGIS reads. They default to
    real pool-backed runners (app.db.get_pool()); the offline ported tests
    inject fakes that return synthetic rows so no live DB is touched. This is
    the Python analogue of the TS ``pool`` injection — the TS test skips the DB
    path entirely, the Python port makes it injectable so the delta/confidence/
    suppression logic runs offline.

The shared scalar helper roundTo lives in the foundation (numeric.round_to,
imported via the resource module in the TS) and is IMPORTED, not redefined.
"""
from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass
from typing import Callable, Optional

from app.config import (
    GWA_LAYERS,
    MAST_CONFIDENCE_HIGH_COUNT,
    MAST_CONFIDENCE_HIGH_KM,
    MAST_DELTA_MAX_KM,
)
from app.engine.numeric import round_to
from app.engine.tiles import TileFetchImpl, fetch_point_value
from app.engine.types import ValidatedAoi

logger = logging.getLogger(__name__)

# ── Local constants (validation.ts:48-60) ───────────────────────────────────

# KNN sanity cap: nearestMast is None beyond this centroid distance.
MAST_NEAREST_SEARCH_KM = 100
METERS_PER_KM = 1_000
# Height of the GWA mean-speed layer the delta is shear-adjusted from.
SHEAR_REFERENCE_HEIGHT_M = 100
DISTANCE_DECIMALS = 1
DELTA_DECIMALS = 1

# Static SQL fragment (no user input): a mast that can produce a delta.
DELTA_ELIGIBLE_SQL = (
    "w.maws_ms IS NOT NULL AND w.mast_height_m IS NOT NULL AND w.mast_height_m > 0"
)


# ── Pure helpers (exported for tests) (validation.ts:62-120) ─────────────────


def shear_adjust_speed(v100: float, mast_height_m: float, alpha: float) -> float:
    """Power-law shear adjustment from the 100 m GWA reference height to the
    mast's measurement height: v_mastH = v100 · (mastH / 100)^α.
    (validation.ts:68-85)"""
    if not math.isfinite(v100) or v100 < 0:
        raise ValueError(
            f"shearAdjustSpeed: v100 must be a finite speed >= 0, got {v100}"
        )
    if not math.isfinite(mast_height_m) or mast_height_m <= 0:
        raise ValueError(
            f"shearAdjustSpeed: mastHeightM must be a finite height > 0, got {mast_height_m}"
        )
    if not math.isfinite(alpha):
        raise ValueError(f"shearAdjustSpeed: alpha must be finite, got {alpha}")
    return v100 * (mast_height_m / SHEAR_REFERENCE_HEIGHT_M) ** alpha


def delta_pct(measured: float, model_at_mast_height: float) -> float:
    """((measured − model) / model) · 100, rounded to 1 dp. Positive =
    measurement above model (model runs low). (validation.ts:91-102)"""
    if not math.isfinite(measured):
        raise ValueError(f"deltaPct: measured must be finite, got {measured}")
    if not math.isfinite(model_at_mast_height) or model_at_mast_height <= 0:
        raise ValueError(
            f"deltaPct: model speed must be a finite value > 0, got {model_at_mast_height}"
        )
    pct = ((measured - model_at_mast_height) / model_at_mast_height) * 100
    return round_to(pct, DELTA_DECIMALS)


def confidence_from(count_within_20: float, count_within_25: float) -> str:
    """Badge per plan §2.3 — counts are of delta-eligible masts near the
    centroid. (validation.ts:105-120)"""
    for label, count in (
        ("countWithin20", count_within_20),
        ("countWithin25", count_within_25),
    ):
        if not _is_integer(count) or count < 0:
            raise ValueError(
                f"confidenceFrom: {label} must be a non-negative integer, got {count}"
            )
    if count_within_20 >= MAST_CONFIDENCE_HIGH_COUNT:
        return "high"
    if count_within_25 >= 1:
        return "medium"
    return "low"


def _is_integer(value: object) -> bool:
    """JS ``Number.isInteger`` — a finite float with no fractional part (and not
    a bool). Mirrors the TS guard exactly so non-integer counts throw."""
    if isinstance(value, bool):
        return False
    if not isinstance(value, (int, float)):
        return False
    return math.isfinite(value) and float(value).is_integer()


# ── Row coercion (pg/psycopg return NUMERIC/bigint as strings/Decimal) ───────
# (validation.ts:124-143)


def to_finite_number(value: object, label: str) -> float:
    """``Number(x)`` then throw if not finite — the validation-specific error
    message (NOT numeric.to_finite_number, which raises a generic message).
    Handles psycopg Decimal/str/int/float identically to the TS String→Number.
    (validation.ts:124-130)"""
    parsed = _js_number(value)
    if parsed is None or not math.isfinite(parsed):
        raise ValueError(
            f"validation: column {label} is not a finite number (got {value})"
        )
    return parsed


def to_count(value: object, label: str) -> int:
    """A non-negative integer column (COUNT(*) → string/Decimal/int).
    (validation.ts:132-138)"""
    parsed = to_finite_number(value, label)
    if not _is_integer(parsed) or parsed < 0:
        raise ValueError(
            f"validation: count {label} is not a non-negative integer (got {parsed})"
        )
    return int(parsed)


def to_nullable_finite_number(value: object, label: str) -> Optional[float]:
    """NULL → None; otherwise to_finite_number. (validation.ts:140-143)"""
    if value is None:
        return None
    return to_finite_number(value, label)


def _js_number(value: object) -> Optional[float]:
    """JS ``Number(value)`` semantics for the inputs psycopg yields:
    str → numeric parse (None on garbage, mirroring ``Number("x") === NaN``);
    bool excluded; int/float/Decimal → float. Returns None for an unparseable
    value so the caller raises the not-finite error."""
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    try:
        return float(value)  # int / float / Decimal
    except (TypeError, ValueError):
        return None


# ── DB query seams (validation.ts:145-245) ──────────────────────────────────

# A query runner: ``(sql, params) -> list[dict]`` row dicts (column → value).
# The TS calls ``pool.query(sql, params)`` and reads ``result.rows``; the Python
# seam returns the same row dicts. psycopg3 placeholders are ``%s`` (the SQL body
# is identical to the TS; only the $1..$n markers translate — QUERY_INVENTORY).
QueryRunner = Callable[[str, list[object]], "list[dict[str, object]]"]


@dataclass(frozen=True)
class MastCounts:
    mast_count_in_aoi: int
    within20: int
    within25: int


# Q1 SQL (validation.ts:157-166) — $1..$5 → %s, body character-identical.
_COUNTS_SQL = f"""
    WITH p AS (SELECT ST_SetSRID(ST_MakePoint(%s, %s), 4326) AS pt)
    SELECT
      COUNT(*) FILTER (WHERE ST_Intersects(w.geom, ST_GeomFromGeoJSON(%s)))  AS in_aoi,
      COUNT(*) FILTER (WHERE {DELTA_ELIGIBLE_SQL}
        AND ST_DWithin(w.geom::geography, p.pt::geography, %s))              AS within20,
      COUNT(*) FILTER (WHERE {DELTA_ELIGIBLE_SQL}
        AND ST_DWithin(w.geom::geography, p.pt::geography, %s))              AS within25
    FROM windmills w CROSS JOIN p
"""


def query_mast_counts(aoi: ValidatedAoi, run_query: QueryRunner) -> MastCounts:
    """All three counts in one pass (validation.ts:154-189).

    NOTE the psycopg param ORDER: the TS SQL references $1=GeoJSON, $2=lon,
    $3=lat, $4/$5=radii, but passes the array [aoiGeoJson, lon, lat, r20, r25].
    With %s positional placeholders the params must be supplied in TEXTUAL
    placeholder order, so the SQL is written with %s for lon, lat, GeoJSON, r20,
    r25 in that textual order and the params list matches. (Same values, same
    units; only the positional mapping is made explicit for psycopg.)"""
    aoi_geojson = json.dumps({"type": "Polygon", "coordinates": [aoi.ring]})
    lon, lat = aoi.centroid
    try:
        rows = run_query(
            _COUNTS_SQL,
            [
                lon,
                lat,
                aoi_geojson,
                MAST_CONFIDENCE_HIGH_KM * METERS_PER_KM,
                MAST_DELTA_MAX_KM * METERS_PER_KM,
            ],
        )
    except Exception as err:  # noqa: BLE001 — mirror the TS try/catch re-wrap
        raise RuntimeError(f"validation: mast counts query failed: {err}") from err
    row = rows[0] if rows else None
    if not row:
        raise RuntimeError("validation: mast counts query returned no row")
    return MastCounts(
        mast_count_in_aoi=to_count(row.get("in_aoi"), "in_aoi"),
        within20=to_count(row.get("within20"), "within20"),
        within25=to_count(row.get("within25"), "within25"),
    )


@dataclass(frozen=True)
class NearestMastCandidate:
    id: str
    station: str
    height_m: float
    maws: float
    mawpd: Optional[float]
    lon: float
    lat: float
    distance_km: float


# Q2 SQL (validation.ts:207-223) — $1..$3 → %s, body character-identical
# (THREE distance engines preserved: ST_DWithin::geography, <-> KNN,
# ST_DistanceSphere).
_NEAREST_SQL = f"""
    WITH p AS (SELECT ST_SetSRID(ST_MakePoint(%s, %s), 4326) AS pt)
    SELECT
      w.id::text                          AS id,
      w.station                           AS station,
      w.mast_height_m                     AS mast_height_m,
      w.maws_ms                           AS maws_ms,
      w.mawpd_wm2                         AS mawpd_wm2,
      ST_X(w.geom)                        AS lon,
      ST_Y(w.geom)                        AS lat,
      ST_DistanceSphere(w.geom, p.pt)     AS distance_m
    FROM windmills w CROSS JOIN p
    WHERE {DELTA_ELIGIBLE_SQL}
      AND ST_DWithin(w.geom::geography, p.pt::geography, %s)
    ORDER BY w.geom <-> p.pt
    LIMIT 1
"""


def query_nearest_mast(
    lon: float, lat: float, run_query: QueryRunner
) -> Optional[NearestMastCandidate]:
    """Nearest delta-eligible mast to the centroid; unrounded km distance.
    (validation.ts:203-245)"""
    try:
        rows = run_query(
            _NEAREST_SQL, [lon, lat, MAST_NEAREST_SEARCH_KM * METERS_PER_KM]
        )
    except Exception as err:  # noqa: BLE001 — mirror the TS try/catch re-wrap
        raise RuntimeError(f"validation: nearest mast query failed: {err}") from err
    row = rows[0] if rows else None
    if not row:
        return None
    station = row.get("station")
    station_str = (
        station if isinstance(station, str) and len(station) > 0 else "Unknown"
    )
    return NearestMastCandidate(
        id=str(row.get("id")),
        station=station_str,
        height_m=to_finite_number(row.get("mast_height_m"), "mast_height_m"),
        maws=to_finite_number(row.get("maws_ms"), "maws_ms"),
        mawpd=to_nullable_finite_number(row.get("mawpd_wm2"), "mawpd_wm2"),
        lon=to_finite_number(row.get("lon"), "lon"),
        lat=to_finite_number(row.get("lat"), "lat"),
        distance_km=to_finite_number(row.get("distance_m"), "distance_m")
        / METERS_PER_KM,
    )


# ── Delta computation (validation.ts:247-283) ───────────────────────────────


def compute_model_delta(
    mast: NearestMastCandidate,
    shear_alpha: float,
    fetch_impl: Optional[TileFetchImpl] = None,
) -> Optional[float]:
    """Sample GWA ws100 at the mast's own pixel and compute the delta. Returns
    None (with a warn carrying full context — never silent) when the pixel is
    nodata/missing or the tile fetch fails. (validation.ts:255-283)"""
    try:
        v100 = fetch_point_value(GWA_LAYERS["ws100"], mast.lon, mast.lat, fetch_impl)
    except Exception as err:  # noqa: BLE001 — mirror the TS try/catch
        logger.warning(
            "[validation] GWA fetch failed at mast coords; delta suppressed %s",
            {
                "station": mast.station,
                "lon": mast.lon,
                "lat": mast.lat,
                "err": str(err),
            },
        )
        return None
    if v100 is None or v100 <= 0:
        logger.warning(
            "[validation] GWA ws100 pixel empty at mast coords; delta suppressed %s",
            {
                "station": mast.station,
                "lon": mast.lon,
                "lat": mast.lat,
                "v100": v100,
            },
        )
        return None
    model_at_mast_height = shear_adjust_speed(v100, mast.height_m, shear_alpha)
    return delta_pct(mast.maws, model_at_mast_height)


# ── Default pool-backed query runner (live-DB path; never hit offline) ───────


def _default_run_query(sql: str, params: list[object]) -> list[dict[str, object]]:
    """Pool-backed query runner: ``pool.query`` analogue (app.db.get_pool()).
    Returns row dicts (column name → value). The offline ported tests inject a
    fake in its place, so this path is exercised only against a live PostGIS."""
    from app.db import get_pool

    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            columns = [d[0] for d in cur.description]
            return [dict(zip(columns, record)) for record in cur.fetchall()]


# ── Public entry point (validation.ts:285-333) ──────────────────────────────


def compute_validation(
    aoi: ValidatedAoi,
    shear_alpha: float,
    fetch_impl: Optional[TileFetchImpl] = None,
    *,
    db_available: Optional[Callable[[], bool]] = None,
    run_query: Optional[QueryRunner] = None,
) -> dict:
    """Compute the validation section for an AOI. Raises when the masts DB is
    unavailable or a query fails — the orchestrator maps rejections to status
    "unavailable" (plan §3: a section failure never 500s the response).
    (validation.ts:292-333)

    ``db_available`` / ``run_query`` are injectable seams (default to
    app.db.db_available + a pool-backed runner) so the ported tests run offline.
    ``fetch_impl`` is the GWA point-fetch seam, passed through to tiles.
    """
    if db_available is None:
        from app.db import db_available as _db_available

        db_available = _db_available
    if run_query is None:
        run_query = _default_run_query

    if not db_available():
        raise RuntimeError(
            "validation: DATABASE_URL not set — masts DB unavailable"
        )
    if not math.isfinite(shear_alpha):
        raise ValueError(f"validation: shearAlpha must be finite, got {shear_alpha}")

    lon, lat = aoi.centroid
    # The TS runs both queries via Promise.all; the sync port runs them in the
    # same order (counts, then nearest) — order is irrelevant to the result.
    counts = query_mast_counts(aoi, run_query)
    nearest = query_nearest_mast(lon, lat, run_query)

    # Suppression compares the UNROUNDED distance against the 25 km rule.
    is_delta_eligible = nearest is not None and nearest.distance_km <= MAST_DELTA_MAX_KM
    model_delta_pct = (
        compute_model_delta(nearest, shear_alpha, fetch_impl)
        if is_delta_eligible and nearest is not None
        else None
    )

    return {
        "mastCountInAoi": counts.mast_count_in_aoi,
        "nearestMast": None
        if nearest is None
        else {
            "station": nearest.station,
            "distanceKm": round_to(nearest.distance_km, DISTANCE_DECIMALS),
            "maws": nearest.maws,
            "mawpd": nearest.mawpd,
            "heightM": nearest.height_m,
            "id": nearest.id,
        },
        "modelDeltaPct": model_delta_pct,
        "confidence": confidence_from(counts.within20, counts.within25),
    }
