"""Climate section (plan §4 Phase 2): one year of hourly 100 m reanalysis wind
at the AOI centroid -> 16-sector rose + 12 monthly means + 24 diurnal means.

Verbatim port of apps/api/src/services/analysis/climate.ts. The .py is kept
line-traceable against the .ts so diffs stay obvious.

LICENSING GATE — the load-bearing part (plan §2.9 + §6, VERIFIED.md §3):
  The keyless Open-Meteo tier is non-commercial; this is a commercial Pro
  feature. This module therefore only ever targets the COMMERCIAL endpoint
  (customer-archive-api.open-meteo.com) and only when BOTH
  ``CLIMATE_SECTION_ENABLED`` is true AND ``OPEN_METEO_API_KEY`` is present.
  Either gate failing raises ClimateDisabledError synchronously, before any
  network or disk activity. There is deliberately NO keyless fallback path
  anywhere in this file. The integrator maps ClimateDisabledError to section
  status "unavailable" silently.

Year is pinned via LAST_COMPLETE_YEAR, never derived from a clock: determinism
(same input -> same output forever) and stable cache keys.

Disk cache — FOREVER, namespace "climate" (key = centroid rounded to 0.05° +
ANALYSIS_VERSION; no TTL). What is cached is the AGGREGATED ClimateData, not the
raw hourly arrays; the upstream fetch is made AT the rounded bucket coordinates
so the cached value is identical regardless of which point inside a 0.05° bucket
populated it first. Same cache-root resolution as tiles.ts / resultCache.ts;
temp+rename writes; a corrupt entry is deleted and treated as a miss.

Dependency-injection seams (CURRENT_STATE.md sec 7): the legacy injects
``options.fetchImpl``; here that is the ``fetch_impl`` callable parameter so the
ported tests run OFFLINE. The cache root is resolved per call from the
``TILE_CACHE_DIR`` env var (same seam tests point at a tmp dir).
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional, Sequence

from app.config import ANALYSIS_VERSION, CLIMATE_SECTION_ENABLED
from app.engine.numeric import js_round

logger = logging.getLogger(__name__)

# Pinned data year (leap -> 8784 hours). Bump deliberately, never compute.
LAST_COMPLETE_YEAR = 2024

# Commercial endpoint ONLY — the keyless host must never appear here.
OPEN_METEO_COMMERCIAL_BASE = "https://customer-archive-api.open-meteo.com/v1/archive"
CLIMATE_FETCH_TIMEOUT_MS = 20_000
CLIMATE_TIMEZONE = "Asia/Kolkata"  # monthly/diurnal are local-time
CLIMATE_USER_AGENT = "wce-analysis"
# A full non-leap year of hours — the strict lower bound on the response.
MIN_HOURS_PER_YEAR = 8_760


# ── Gating ──────────────────────────────────────────────────────────────────


class ClimateDisabledError(Exception):
    """Raised when the climate section must not run. Integrator contract: map to
    section status "unavailable" with NO server-side error log. (climate.ts:63)
    """

    def __init__(self, reason: str) -> None:
        super().__init__(f"climate section disabled: {reason}")
        self.name = "ClimateDisabledError"


@dataclass(frozen=True)
class ClimateGateInput:
    is_flag_enabled: bool
    api_key: Optional[str]


def assert_climate_enabled(gate: ClimateGateInput) -> str:
    """Both gates, in order, fully synchronous. Returns the API key on success so
    callers cannot accidentally proceed without one. Defense in depth: even with
    the flag on, a missing key refuses to run rather than ever reaching a keyless
    request (plan §6 hard rule). (climate.ts:81-93)
    """
    if not gate.is_flag_enabled:
        raise ClimateDisabledError("CLIMATE_SECTION_ENABLED is off")
    if gate.api_key is None or len(gate.api_key) == 0:
        logger.warning(
            "[climate] CLIMATE_SECTION_ENABLED=true but OPEN_METEO_API_KEY is "
            "missing — refusing to run (the keyless endpoint is non-commercial; "
            "plan §6)"
        )
        raise ClimateDisabledError("OPEN_METEO_API_KEY missing")
    return gate.api_key


# ── Fetch seam (mirrors tiles.ts TileFetchImpl) ─────────────────────────────
#
# The TS signature is (url, init) -> Response. Here the injected callable takes
# (url, headers) and returns a response-like object exposing ``ok`` (bool),
# ``status`` (int) and ``json()`` -> parsed body. The ported tests never reach
# this seam (the flag is off), so the shape is documented, not exercised.
ClimateFetchImpl = Callable[[str, dict], object]


# ── Hourly sample model ─────────────────────────────────────────────────────


@dataclass(frozen=True)
class ClimateHourSample:
    """One hour of the archive response, local time (Asia/Kolkata). (climate.ts:109)

    ``time`` is "YYYY-MM-DDTHH:MM" — month/hour are parsed positionally from it.
    ``speed`` is m/s at 100 m; None = missing upstream. ``direction`` is degrees
    the wind comes FROM (meteorological); None = missing.
    """

    time: str
    speed: Optional[float]
    direction: Optional[float]


# ── Aggregation (pure) ──────────────────────────────────────────────────────

# 16-wind compass, index 0 = N, clockwise. Exact contract order.
ROSE_SECTOR_NAMES = (
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
)

SECTOR_WIDTH_DEG = 22.5
ROUND_1DP = 10
ROUND_2DP = 100


def sector_index_for(direction: float) -> int:
    """Compass sector for a from-direction: sectors are CENTERED on the compass
    points (N spans 348.75-11.25). Index = round(dir/22.5) % 16. JS Math.round
    rounds .5 halves UP, so each sector's upper edge belongs to the NEXT sector:
    11.24° -> N, 11.25° -> NNE, 348.75° -> N (16 % 16 wraps to 0). Directions are
    normalized into [0, 360) first as a defensive guard. (climate.ts:137-140)
    """
    normalized = ((direction % 360) + 360) % 360
    return js_round(normalized / SECTOR_WIDTH_DEG) % len(ROSE_SECTOR_NAMES)


def _round1(value: float) -> float:
    return js_round(value * ROUND_1DP) / ROUND_1DP


def _round2(value: float) -> float:
    return js_round(value * ROUND_2DP) / ROUND_2DP


def _is_finite_value(value: Optional[float]) -> bool:
    """climate.ts:150-152 isFiniteValue: not None and Number.isFinite."""
    return value is not None and math.isfinite(value)


@dataclass(frozen=True)
class ClimateRoseSector:
    sector: str
    freqPct: float
    meanSpeed: float


def aggregate_rose(
    samples: Sequence[ClimateHourSample],
) -> list[ClimateRoseSector]:
    """16-sector rose. An hour counts only when BOTH speed and direction are
    finite (a direction without a speed cannot contribute a mean; a speed without
    a direction cannot be placed). freqPct is relative to the VALID hour count
    (sums to ~100 regardless of upstream gaps), 1 dp. Per-sector meanSpeed 2 dp;
    empty sectors report 0/0 (probe convention). (climate.ts:161-183)
    """
    counts = [0] * len(ROSE_SECTOR_NAMES)
    speed_sums = [0.0] * len(ROSE_SECTOR_NAMES)
    valid_count = 0
    for sample in samples:
        if not _is_finite_value(sample.speed) or not _is_finite_value(sample.direction):
            continue
        idx = sector_index_for(sample.direction)
        counts[idx] = counts[idx] + 1
        speed_sums[idx] = speed_sums[idx] + sample.speed
        valid_count += 1
    result: list[ClimateRoseSector] = []
    for i, sector in enumerate(ROSE_SECTOR_NAMES):
        count = counts[i]
        speed_sum = speed_sums[i]
        result.append(
            ClimateRoseSector(
                sector=sector,
                freqPct=0 if valid_count == 0 else _round1((100 * count) / valid_count),
                meanSpeed=0 if count == 0 else _round2(speed_sum / count),
            )
        )
    return result


def _means_by_slot(
    samples: Sequence[ClimateHourSample],
    slot_count: int,
    slot_of: Callable[[str], float],
) -> list[float]:
    """Mean speed per slot (month or local hour). Hours with a null/non-finite
    speed are skipped; direction is irrelevant here. Empty slot -> 0 (mirrors the
    empty-sector rose convention; cannot occur on a full healthy year).
    (climate.ts:188-206)
    """
    sums = [0.0] * slot_count
    counts = [0] * slot_count
    for sample in samples:
        if not _is_finite_value(sample.speed):
            continue
        slot = slot_of(sample.time)
        if not _is_integer(slot) or slot < 0 or slot >= slot_count:
            continue
        slot = int(slot)
        sums[slot] = sums[slot] + sample.speed
        counts[slot] = counts[slot] + 1
    return [0 if counts[i] == 0 else _round2(sums[i] / counts[i]) for i in range(slot_count)]


def _is_integer(value: float) -> bool:
    """Number.isInteger: finite and equal to its truncation."""
    return math.isfinite(value) and value == math.trunc(value)


MONTH_SLOT_COUNT = 12
HOUR_SLOT_COUNT = 24


def aggregate_monthly(samples: Sequence[ClimateHourSample]) -> list[float]:
    """12 monthly mean speeds (2 dp), Jan..Dec, local time. (climate.ts:212-218)"""
    return _means_by_slot(
        samples,
        MONTH_SLOT_COUNT,
        lambda time: _parse_int(time[5:7]) - 1,
    )


def aggregate_diurnal(samples: Sequence[ClimateHourSample]) -> list[float]:
    """24 diurnal mean speeds (2 dp) by local hour 00..23. (climate.ts:221-227)"""
    return _means_by_slot(
        samples,
        HOUR_SLOT_COUNT,
        lambda time: _parse_int(time[11:13]),
    )


def _parse_int(text: str) -> float:
    """Number.parseInt(text, 10): leading-integer parse; NaN when none.

    JS parseInt reads an optional sign + leading digits and ignores trailing
    junk; an empty/garbage start yields NaN (which fails the isInteger guard).
    """
    match = re.match(r"^[+-]?\d+", text)
    if match is None:
        return math.nan
    return float(int(match.group(0)))


@dataclass(frozen=True)
class ClimateData:
    rose: list[ClimateRoseSector]  # 16
    monthly: list[float]  # 12 mean speeds
    diurnal: list[float]  # 24 mean speeds


def aggregate_climate(samples: Sequence[ClimateHourSample]) -> ClimateData:
    """Full ClimateData from one year of hourly samples. Pure. (climate.ts:230-238)"""
    return ClimateData(
        rose=aggregate_rose(samples),
        monthly=aggregate_monthly(samples),
        diurnal=aggregate_diurnal(samples),
    )


# ── Response validation (strict — fail loud on surprises) ──────────────────

# Local-time stamps as served with timezone= set: "2024-01-01T00:00".
TIME_PATTERN = re.compile(
    r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$"
)


def _assert_time_series(series: object) -> list[str]:
    """climate.ts:246-259 assertTimeSeries."""
    if not isinstance(series, list):
        raise ValueError("open-meteo response: hourly.time is not an array")
    for i in range(len(series)):
        value = series[i]
        if not isinstance(value, str) or TIME_PATTERN.match(value) is None:
            raise ValueError(
                f"open-meteo response: hourly.time[{i}] is not a local-time stamp: "
                f"{value}"
            )
    return series


def _assert_finite_or_null_series(name: str, series: object) -> list[Optional[float]]:
    """climate.ts:261-278 assertFiniteOrNullSeries."""
    if not isinstance(series, list):
        raise ValueError(f"open-meteo response: hourly.{name} is not an array")
    for i in range(len(series)):
        value = series[i]
        if value is None:
            continue
        if not _is_js_number(value) or not math.isfinite(value):
            raise ValueError(
                f"open-meteo response: hourly.{name}[{i}] is not finite-or-null: "
                f"{value}"
            )
    return series


def _is_js_number(value: object) -> bool:
    """typeof value === "number": a JS number is float-or-int but NOT bool.

    In Python ``bool`` is a subclass of ``int``; JSON booleans must not pass the
    finite-number guard, so exclude them explicitly.
    """
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def parse_hourly_samples(payload: object) -> list[ClimateHourSample]:
    """Strictly validate the archive payload and flatten it into hourly samples.
    Raises (-> section "unavailable" + server-side error log) on ANY surprise:
    error envelope, missing arrays, length mismatch, short year, non-finite
    non-null values, malformed timestamps. (climate.ts:286-322)
    """
    if payload is None or not isinstance(payload, dict):
        raise ValueError("open-meteo response: body is not a JSON object")
    body = payload
    if body.get("error"):
        raise ValueError(
            f"open-meteo response: API error: {body.get('reason', 'no reason given')}"
        )
    hourly_raw = body.get("hourly")
    if hourly_raw is None or not isinstance(hourly_raw, dict):
        raise ValueError("open-meteo response: missing hourly block")
    hourly = hourly_raw
    times = _assert_time_series(hourly.get("time"))
    speeds = _assert_finite_or_null_series("wind_speed_100m", hourly.get("wind_speed_100m"))
    directions = _assert_finite_or_null_series(
        "wind_direction_100m", hourly.get("wind_direction_100m")
    )
    if len(times) != len(speeds) or len(times) != len(directions):
        raise ValueError(
            "open-meteo response: hourly array length mismatch "
            f"(time={len(times)}, speed={len(speeds)}, direction={len(directions)})"
        )
    if len(times) < MIN_HOURS_PER_YEAR:
        raise ValueError(
            f"open-meteo response: {len(times)} hours is short of a full year "
            f"(>= {MIN_HOURS_PER_YEAR})"
        )
    return [
        ClimateHourSample(
            time=time,
            speed=speeds[i] if speeds[i] is not None else None,
            direction=directions[i] if directions[i] is not None else None,
        )
        for i, time in enumerate(times)
    ]


# ── Disk cache (forever, namespace "climate") ───────────────────────────────

CACHE_NAMESPACE = "climate"
PROD_CACHE_DIR = "/var/cache/tiles"
# apps/api root = three levels up from src/services/analysis/. In the Python
# service the equivalent dev cache lives under the legacy data dir's parent; the
# tests always override TILE_CACHE_DIR, so this default is only a fallback.
_API_ROOT_DIR = Path(__file__).resolve().parents[3]
DEV_CACHE_DIR = str(_API_ROOT_DIR / ".cache" / "tiles")
# Shard fanout, same convention as resultCache.ts ({key[0:2]}/).
SHARD_PREFIX_LENGTH = 2
# 0.05° bucket (plan: "centroid rounded to 0.05°").
CACHE_COORD_BUCKET_DEG = 0.05


def _resolve_cache_base_dir() -> str:
    """Resolved per call (not at import) so tests can point TILE_CACHE_DIR at a
    tmp dir after import — same seam as tiles.ts / resultCache.ts.
    (climate.ts:338-342)
    """
    from_env = os.environ.get("TILE_CACHE_DIR")
    if from_env and len(from_env) > 0:
        return from_env
    return PROD_CACHE_DIR if os.environ.get("NODE_ENV") == "production" else DEV_CACHE_DIR


def round_coord_to_bucket(value: float) -> str:
    """Snap one coordinate to its 0.05° bucket center, as a stable 2-dp string
    (every multiple of 0.05 has <= 2 decimals, so the 2-dp format erases float
    noise). Half-up at bucket edges: 77.575 -> "77.60". Two points belong to the
    same bucket iff they are within ±0.025° of the same multiple of 0.05.
    (climate.ts:350-352)

    Parity: JS ``(Math.round(value/0.05)*0.05).toFixed(2)``. ``js_round``
    reproduces Math.round; Python's ``f"{x:.2f}"`` matches ``toFixed(2)`` for
    every multiple-of-0.05 double (verified across the India bbox sweep). The
    ``+ 0.0`` normalizes a possible -0.0 to "0.00" exactly as toFixed does.
    """
    snapped = js_round(value / CACHE_COORD_BUCKET_DEG) * CACHE_COORD_BUCKET_DEG
    return f"{snapped + 0.0:.2f}"


def climate_cache_key(centroid: Sequence[float]) -> str:
    """md5(`{lonBucket}_{latBucket}_{ANALYSIS_VERSION}`) — plan cache rule.
    (climate.ts:355-360)
    """
    lon, lat = centroid[0], centroid[1]
    payload = f"{round_coord_to_bucket(lon)}_{round_coord_to_bucket(lat)}_{ANALYSIS_VERSION}"
    return hashlib.md5(payload.encode("utf-8")).hexdigest()


def _entry_path_for(key: str) -> str:
    return os.path.join(
        _resolve_cache_base_dir(),
        CACHE_NAMESPACE,
        key[:SHARD_PREFIX_LENGTH],
        f"{key}.json",
    )


def _is_rose_sector(value: object) -> bool:
    """climate.ts:371-379 isRoseSector."""
    if value is None or not isinstance(value, dict):
        return False
    return (
        isinstance(value.get("sector"), str)
        and _is_finite_value(_as_number_or_none(value.get("freqPct")))
        and _is_finite_value(_as_number_or_none(value.get("meanSpeed")))
    )


def _as_number_or_none(value: object) -> Optional[float]:
    """Number.isFinite(x) is false for non-numbers; mirror by mapping non-JS-
    numbers to None so the finite guard rejects them."""
    if not _is_js_number(value):
        return None
    return float(value)


def _is_number_array_of_length(value: object, length: int) -> bool:
    """climate.ts:381-387 isNumberArrayOfLength."""
    return (
        isinstance(value, list)
        and len(value) == length
        and all(_is_finite_value(_as_number_or_none(entry)) for entry in value)
    )


def _is_climate_data(value: object) -> bool:
    """Shape guard so a foreign/truncated file can't masquerade as ClimateData.
    (climate.ts:390-400)
    """
    if value is None or not isinstance(value, dict):
        return False
    rose = value.get("rose")
    return (
        isinstance(rose, list)
        and len(rose) == len(ROSE_SECTOR_NAMES)
        and all(_is_rose_sector(entry) for entry in rose)
        and _is_number_array_of_length(value.get("monthly"), MONTH_SLOT_COUNT)
        and _is_number_array_of_length(value.get("diurnal"), HOUR_SLOT_COUNT)
    )


def _delete_corrupt_entry(entry_path: str, reason: str) -> None:
    """Best-effort delete of a corrupt entry; never raises. (climate.ts:403-416)"""
    logger.warning(
        "[climate-cache] corrupt entry treated as miss (%s) entryPath=%s",
        reason,
        entry_path,
    )
    try:
        os.unlink(entry_path)
    except FileNotFoundError:
        pass
    except OSError as err:
        logger.warning(
            "[climate-cache] failed to delete corrupt entry entryPath=%s err=%s",
            entry_path,
            err,
        )


def get_cached_climate(key: str) -> Optional[ClimateData]:
    """Cached ClimateData for ``key``, or None on miss. Corrupt -> delete + miss.
    Never raises. (climate.ts:420-446)
    """
    entry_path = _entry_path_for(key)
    try:
        with open(entry_path, "r", encoding="utf-8") as handle:
            raw = handle.read()
    except FileNotFoundError:
        return None
    except OSError as err:
        logger.warning(
            "[climate-cache] read failed; treating as miss entryPath=%s err=%s",
            entry_path,
            err,
        )
        return None
    try:
        parsed = json.loads(raw)
    except (ValueError, json.JSONDecodeError) as err:
        _delete_corrupt_entry(entry_path, f"unparseable JSON: {err}")
        return None
    if not _is_climate_data(parsed):
        _delete_corrupt_entry(entry_path, "shape mismatch")
        return None
    return _climate_data_from_dict(parsed)


def _climate_data_from_dict(parsed: dict) -> ClimateData:
    """Reconstruct the dataclass from a validated dict (post-shape-guard)."""
    return ClimateData(
        rose=[
            ClimateRoseSector(
                sector=sector["sector"],
                freqPct=float(sector["freqPct"]),
                meanSpeed=float(sector["meanSpeed"]),
            )
            for sector in parsed["rose"]
        ],
        monthly=[float(v) for v in parsed["monthly"]],
        diurnal=[float(v) for v in parsed["diurnal"]],
    )


def _climate_data_to_dict(data: ClimateData) -> dict:
    """Serialize the dataclass to the plain-JSON shape the cache file stores."""
    return {
        "rose": [
            {"sector": s.sector, "freqPct": s.freqPct, "meanSpeed": s.meanSpeed}
            for s in data.rose
        ],
        "monthly": list(data.monthly),
        "diurnal": list(data.diurnal),
    }


def put_cached_climate(key: str, data: ClimateData) -> None:
    """Temp-file + rename write (no torn reads). A failed cache write must never
    fail the analysis — logged, never raised. (climate.ts:450-463)
    """
    entry_path = _entry_path_for(key)
    try:
        os.makedirs(os.path.dirname(entry_path), exist_ok=True)
        tmp_path = f"{entry_path}.tmp-{os.getpid()}-{int(time.time() * 1000)}"
        with open(tmp_path, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(_climate_data_to_dict(data)))
        os.replace(tmp_path, entry_path)
    except OSError as err:
        logger.warning("[climate-cache] write failed entryPath=%s err=%s", entry_path, err)


# ── Fetch + orchestration ───────────────────────────────────────────────────


def _fetch_archive_year(
    lon_bucket: str,
    lat_bucket: str,
    api_key: str,
    fetch_impl: ClimateFetchImpl,
) -> object:
    """One year of hourly speed+direction from the COMMERCIAL archive endpoint.
    Errors never include the URL (it carries the API key). (climate.ts:469-510)

    Live-only: the ported tests never reach this (the flag is off, so
    computeClimate raises ClimateDisabledError first). Faithful, deferred.
    """
    from urllib.parse import urlencode

    params = urlencode(
        {
            "apikey": api_key,
            "latitude": lat_bucket,
            "longitude": lon_bucket,
            "start_date": f"{LAST_COMPLETE_YEAR}-01-01",
            "end_date": f"{LAST_COMPLETE_YEAR}-12-31",
            "hourly": "wind_speed_100m,wind_direction_100m",
            "wind_speed_unit": "ms",
            "timezone": CLIMATE_TIMEZONE,
        }
    )
    try:
        res = fetch_impl(
            f"{OPEN_METEO_COMMERCIAL_BASE}?{params}",
            {"User-Agent": CLIMATE_USER_AGENT},
        )
    except Exception as err:  # noqa: BLE001 — mirror the TS catch-all
        raise ValueError(
            f"open-meteo archive fetch failed at {lat_bucket},{lon_bucket}: {err}"
        ) from err
    if not getattr(res, "ok", False):
        raise ValueError(
            f"open-meteo archive returned HTTP {getattr(res, 'status', '?')} "
            f"at {lat_bucket},{lon_bucket}"
        )
    try:
        return res.json()
    except Exception as err:  # noqa: BLE001
        raise ValueError(
            f"open-meteo archive returned unparseable JSON at {lat_bucket},{lon_bucket}"
        ) from err


def compute_climate(
    centroid: Sequence[float],
    fetch_impl: Optional[ClimateFetchImpl] = None,
) -> ClimateData:
    """Climate section entry point. Gating runs synchronously FIRST — when the
    section is off (flag or key), this raises ClimateDisabledError before touching
    cache, disk, or network. Real failures (fetch, shape, empty year) raise plain
    ValueErrors for the integrator to log. (climate.ts:518-552)
    """
    api_key = assert_climate_enabled(
        ClimateGateInput(
            is_flag_enabled=CLIMATE_SECTION_ENABLED,
            api_key=os.environ.get("OPEN_METEO_API_KEY"),
        )
    )
    lon, lat = centroid[0], centroid[1]
    if not math.isfinite(lon) or not math.isfinite(lat):
        raise ValueError(f"computeClimate: non-finite centroid lon={lon} lat={lat}")

    key = climate_cache_key(centroid)
    cached = get_cached_climate(key)
    if cached is not None:
        return cached

    lon_bucket = round_coord_to_bucket(lon)
    lat_bucket = round_coord_to_bucket(lat)
    payload = _fetch_archive_year(
        lon_bucket,
        lat_bucket,
        api_key,
        fetch_impl if fetch_impl is not None else _default_fetch_impl,
    )
    samples = parse_hourly_samples(payload)
    data = aggregate_climate(samples)
    if all(sector.freqPct == 0 for sector in data.rose):
        raise ValueError(
            f"open-meteo response: no valid speed+direction hours at "
            f"{lat_bucket},{lon_bucket}"
        )
    put_cached_climate(key, data)
    return data


def _default_fetch_impl(url: str, headers: dict) -> object:  # pragma: no cover
    """Live default — performs a real HTTPS GET. Never exercised offline; the
    flag is off in every test environment so computeClimate raises first."""
    import urllib.request

    request = urllib.request.Request(url, headers=headers)
    raw = urllib.request.urlopen(request, timeout=CLIMATE_FETCH_TIMEOUT_MS / 1000)

    class _Response:
        ok = True
        status = raw.status

        @staticmethod
        def json() -> object:
            return json.loads(raw.read().decode("utf-8"))

    return _Response()
